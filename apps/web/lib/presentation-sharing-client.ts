import {
  CreatePresentationShareSchema,
  PresentationReviewSchema,
  PresentationShareCreatedSchema,
  PresentationShareListSchema,
  PresentationShareAccessSchema,
  type CreatePresentationShare,
} from "@openround/contracts";
import { API_URL, apiFetch, ApiClientError } from "./api";
import { clientUuid } from "./uuid";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const presentationReviewTokenKey = (shareId: string) =>
  `openround:presentation-review:${shareId}`;
export const presentationShareIntentKey = (presentationId: string) =>
  `openround:presentation-share-intent:${presentationId}`;
export function capturePresentationReviewToken({
  shareId,
  location,
  history,
  storage,
}: {
  shareId: string;
  location: Pick<Location, "href">;
  history: Pick<History, "state" | "replaceState">;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}) {
  const url = new URL(location.href),
    values = new URLSearchParams(url.hash.slice(1)).getAll("token");
  if (url.hash || url.searchParams.has("token")) {
    const candidate =
      !url.searchParams.has("token") && values.length === 1 && tokenPattern.test(values[0] ?? "")
        ? values[0]!
        : null;
    url.hash = "";
    url.searchParams.delete("token");
    history.replaceState(history.state, "", `${url.pathname}${url.search}`);
    try {
      if (candidate) storage.setItem(presentationReviewTokenKey(shareId), candidate);
      else storage.removeItem(presentationReviewTokenKey(shareId));
    } catch {
      /* This launch still works when per-tab storage is unavailable. */
    }
    return candidate;
  }
  try {
    const candidate = storage.getItem(presentationReviewTokenKey(shareId));
    return candidate && tokenPattern.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
export function clearPresentationReviewToken(shareId: string) {
  try {
    sessionStorage.removeItem(presentationReviewTokenKey(shareId));
  } catch {
    /* In-memory access is also cleared by the caller. */
  }
}
function sharePath(shareId: string) {
  if (!uuid.test(shareId)) throw new Error("Presentation unavailable");
  return `/v1/shared-presentations/${shareId}`;
}
export async function fetchPresentationReview(shareId: string, token: string, signal: AbortSignal) {
  return PresentationReviewSchema.parse(
    await apiFetch<unknown>(sharePath(shareId), {
      headers: { authorization: `Bearer ${token}` },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    }),
  );
}
export async function fetchPresentationShareAccess(
  shareId: string,
  token: string,
  signal: AbortSignal,
) {
  return PresentationShareAccessSchema.parse(
    await apiFetch<unknown>(`${sharePath(shareId)}/access`, {
      headers: { authorization: `Bearer ${token}` },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    }),
  );
}
let reads = 0;
export class PresentationReviewImageError extends Error {
  constructor(public readonly retryable: boolean) {
    super(retryable ? "Image is temporarily unavailable" : "Image unavailable");
  }
}
interface ImageWaiter {
  signal: AbortSignal;
  resolve: () => void;
  reject: (reason: unknown) => void;
  onAbort: () => void;
}
const waiting: ImageWaiter[] = [];
function imageAbort(signal: AbortSignal) {
  return signal.reason ?? new DOMException("Image request canceled", "AbortError");
}
async function acquireImageRead(signal: AbortSignal) {
  signal.throwIfAborted();
  if (reads < 2) {
    reads++;
    return;
  }
  if (waiting.length >= 64) throw new PresentationReviewImageError(true);
  await new Promise<void>((resolve, reject) => {
    const entry: ImageWaiter = {
      signal,
      resolve,
      reject,
      onAbort: () => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        signal.removeEventListener("abort", entry.onAbort);
        reject(imageAbort(signal));
      },
    };
    waiting.push(entry);
    signal.addEventListener("abort", entry.onAbort, { once: true });
    if (signal.aborted) entry.onAbort();
  });
}
function releaseImageRead() {
  for (;;) {
    const next = waiting.shift();
    if (!next) {
      reads--;
      return;
    }
    next.signal.removeEventListener("abort", next.onAbort);
    if (next.signal.aborted) {
      next.reject(imageAbort(next.signal));
      continue;
    }
    next.resolve();
    return;
  }
}
function imageRetryDelay(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(imageAbort(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
export async function fetchPresentationReviewImage(
  shareId: string,
  token: string,
  mediaId: string,
  signal: AbortSignal,
) {
  return fetchPresentationPrivateImage(sharePath(shareId), token, mediaId, signal);
}
/** Shared bounded image transport for credential-protected published presentations. */
export async function fetchPresentationPrivateImage(
  path: string,
  token: string,
  mediaId: string,
  signal: AbortSignal,
) {
  if (!uuid.test(mediaId)) throw new PresentationReviewImageError(false);
  await acquireImageRead(signal);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      const response = await fetch(`${API_URL}${path}/media/${mediaId}`, {
        headers: { authorization: `Bearer ${token}` },
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal,
      });
      if (response.status === 503 || response.status === 429) {
        await response.body?.cancel().catch(() => undefined);
        if (attempt === 2) throw new PresentationReviewImageError(true);
        const requested = Number(response.headers.get("retry-after") ?? 1);
        const seconds = Number.isFinite(requested) ? Math.min(2, Math.max(1, requested)) : 1;
        await imageRetryDelay(seconds * 1000 + Math.floor(Math.random() * 251), signal);
        continue;
      }
      if (!response.ok) throw new PresentationReviewImageError(response.status >= 500);
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(
          response.headers.get("content-type")?.split(";", 1)[0] ?? "",
        )
      )
        throw new PresentationReviewImageError(false);
      const blob = await response.blob();
      if (blob.size > 10 * 1024 * 1024) throw new PresentationReviewImageError(false);
      return blob;
    }
    throw new PresentationReviewImageError(true);
  } catch (error) {
    if (signal.aborted) throw imageAbort(signal);
    if (error instanceof PresentationReviewImageError) throw error;
    throw new PresentationReviewImageError(true);
  } finally {
    releaseImageRead();
  }
}
export function presentationShareIntent(
  versionId: string,
  days: number,
  now = Date.now(),
): CreatePresentationShare {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Choose 1–30 days");
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return CreatePresentationShareSchema.parse({
    requestId: clientUuid(),
    versionId,
    token,
    expiresAt: new Date(now + days * 86_400_000).toISOString(),
  });
}
export function loadPresentationShareIntent(
  presentationId: string,
): CreatePresentationShare | null {
  try {
    const raw = sessionStorage.getItem(presentationShareIntentKey(presentationId));
    return raw ? CreatePresentationShareSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function savePresentationShareIntent(
  presentationId: string,
  intent: CreatePresentationShare | null,
) {
  try {
    if (intent)
      sessionStorage.setItem(presentationShareIntentKey(presentationId), JSON.stringify(intent));
    else sessionStorage.removeItem(presentationShareIntentKey(presentationId));
  } catch {
    /* Retain the exact in-memory intent while this dialog is open. */
  }
}

/** A late acknowledgement must not erase a newer dialog's pending request. */
export function clearPresentationShareIntent(
  presentationId: string,
  expected: CreatePresentationShare,
) {
  const saved = loadPresentationShareIntent(presentationId);
  if (
    saved?.requestId === expected.requestId &&
    saved.versionId === expected.versionId &&
    saved.expiresAt === expected.expiresAt &&
    saved.token === expected.token
  )
    savePresentationShareIntent(presentationId, null);
}

/** Only the server can confirm that an unaccepted request is permanently expired. */
export function isExpiredPresentationShareRequest(error: unknown) {
  return (
    error instanceof ApiClientError &&
    error.status === 410 &&
    error.code === "PRESENTATION_SHARE_REQUEST_EXPIRED"
  );
}

export async function createPresentationShare(
  presentationId: string,
  request: CreatePresentationShare,
) {
  const result = PresentationShareCreatedSchema.parse(
    await apiFetch<unknown>(`/v1/presentations/${encodeURIComponent(presentationId)}/shares`, {
      method: "POST",
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(20_000),
    }),
  );
  if (
    result.share.versionId.toLowerCase() !== request.versionId.toLowerCase() ||
    result.share.expiresAt !== request.expiresAt ||
    !result.url
  )
    throw new Error(
      "The share acknowledgement does not match this request. Retry the same request.",
    );
  if (result.url) {
    const url = new URL(result.url),
      values = new URLSearchParams(url.hash.slice(1)).getAll("token");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.pathname !== `/presentation-review/${result.share.id}` ||
      values.length !== 1 ||
      !tokenPattern.test(values[0] ?? "") ||
      values[0] !== request.token
    )
      throw new Error("The share link could not be verified. Retry the same request.");
  }
  return result;
}
export async function listPresentationShares(presentationId: string, signal?: AbortSignal) {
  return PresentationShareListSchema.parse(
    await apiFetch<unknown>(`/v1/presentations/${encodeURIComponent(presentationId)}/shares`, {
      cache: "no-store",
      signal,
    }),
  ).shares;
}
export async function revokePresentationShare(presentationId: string, shareId: string) {
  await apiFetch(
    `/v1/presentations/${encodeURIComponent(presentationId)}/shares/${encodeURIComponent(shareId)}`,
    { method: "DELETE", signal: AbortSignal.timeout(20_000) },
  );
}
