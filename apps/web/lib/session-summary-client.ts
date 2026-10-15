import {
  CreatedSummaryShareSchema,
  SessionSummaryPreviewSchema,
  SharedSessionSummarySchema,
  SummaryShareListSchema,
  SummarySourceSchema,
  type CreateSummaryShare,
  type CreatedSummaryShare,
  type SessionSummaryPreview,
  type SummaryExportFormat,
  type SummaryExportRequest,
  type SummarySource,
} from "@openround/contracts";
import { API_URL, ApiClientError, apiFetch } from "./api";

export function sessionSummaryPath(source: SummarySource) {
  const parsed = SummarySourceSchema.parse(source);
  return `/v1/session-summaries/${parsed.kind}/${parsed.id}`;
}

export async function fetchSummaryPreview(source: SummarySource, signal: AbortSignal) {
  const result = SessionSummaryPreviewSchema.parse(
    await apiFetch<unknown>(sessionSummaryPath(source), { cache: "no-store", signal }),
  );
  if (
    result.source.kind !== source.kind ||
    result.source.id !== source.id ||
    result.summary.kind !== source.kind
  )
    throw new Error("The summary does not match this session. Refresh and try again.");
  return result;
}

export async function fetchSummaryShares(source: SummarySource, signal?: AbortSignal) {
  return SummaryShareListSchema.parse(
    await apiFetch<unknown>(`${sessionSummaryPath(source)}/shares`, {
      cache: "no-store",
      signal,
    }),
  ).shares;
}

export interface SummaryCreateIntent {
  content: string;
  request: CreateSummaryShare;
}

/** getRandomValues supports LAN HTTP sessions where randomUUID is unavailable. */
function summaryMutationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Preserve one write intent after an uncertain response; never mint a replacement on retry. */
export function summaryCreateIntent(
  previous: SummaryCreateIntent | null,
  values: Omit<CreateSummaryShare, "idempotencyKey">,
  makeId: () => string = summaryMutationId,
): SummaryCreateIntent {
  const normalized = { ...values, nextSteps: values.nextSteps.trim() };
  const content = JSON.stringify(normalized);
  return previous?.content === content
    ? previous
    : { content, request: { ...normalized, idempotencyKey: makeId() } };
}

export function summaryTokenFromFragment(fragment: string): string | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const tokens = params.getAll("token");
  return tokens.length === 1 && /^[A-Za-z0-9_-]{20,1000}$/.test(tokens[0] ?? "")
    ? tokens[0]!
    : null;
}

export function validateCreatedSummaryShare(value: unknown): CreatedSummaryShare {
  const created = CreatedSummaryShareSchema.parse(value);
  if (created.url) {
    const url = new URL(created.url);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      !url.pathname.endsWith(`/summary/${created.share.id}`) ||
      !summaryTokenFromFragment(url.hash)
    )
      throw new Error("The share link could not be verified. Refresh the share list.");
  }
  return created;
}

export async function createSummaryShare(source: SummarySource, request: CreateSummaryShare) {
  return validateCreatedSummaryShare(
    await apiFetch<unknown>(`${sessionSummaryPath(source)}/shares`, {
      method: "POST",
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(20_000),
    }),
  );
}

export async function revokeSummaryShare(source: SummarySource, shareId: string) {
  await apiFetch(`${sessionSummaryPath(source)}/shares/${encodeURIComponent(shareId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(20_000),
  });
}

function sharedPath(shareId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shareId))
    throw new Error("Summary unavailable");
  return `/v1/shared-session-summaries/${shareId}`;
}

export async function fetchSharedSummary(shareId: string, token: string, signal: AbortSignal) {
  return SharedSessionSummarySchema.parse(
    await apiFetch<unknown>(sharedPath(shareId), {
      headers: { authorization: `Bearer ${token}` },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    }),
  );
}

export type SummaryDownloadAccess = { source: SummarySource } | { shareId: string; token: string };

const exportMime: Record<SummaryExportFormat, string> = {
  pdf: "application/pdf",
  png: "image/png",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function fetchSummaryExport(
  access: SummaryDownloadAccess,
  request: SummaryExportRequest,
  signal: AbortSignal,
) {
  const publicAccess = "shareId" in access;
  const path = publicAccess ? sharedPath(access.shareId) : sessionSummaryPath(access.source);
  const { nextSteps, ...publicRequest } = request;
  const response = await fetch(`${API_URL}${path}/export`, {
    method: "POST",
    credentials: publicAccess ? "omit" : "include",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: {
      "content-type": "application/json",
      accept: exportMime[request.format],
      ...(publicAccess ? { authorization: `Bearer ${access.token}` } : {}),
    },
    body: JSON.stringify(publicAccess ? publicRequest : { ...publicRequest, nextSteps }),
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiClientError(
      publicAccess ? "Summary unavailable" : (body?.error?.message ?? "Download failed"),
      body?.error?.code,
      response.status,
    );
  }
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== exportMime[request.format])
    throw new Error("The download format could not be verified.");
  return response.blob();
}

export function summaryExpiry(preview: SessionSummaryPreview, days: number, now = Date.now()) {
  return new Date(Math.min(now + days * 86_400_000, Date.parse(preview.sourceExpiresAt)));
}

export function downloadSummaryBlob(blob: Blob, format: SummaryExportFormat) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `polling-pops-session-summary.${format}`;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
