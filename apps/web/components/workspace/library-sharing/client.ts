import {
  LibraryShareCreateSchema,
  LibraryShareCopyResultSchema,
  LibraryShareListSchema,
  LibraryShareRecipientsSchema,
  LibraryShareSummarySchema,
  PresentationReviewSchema,
  type LibraryShareCreate,
  type LibraryShareSummary,
  type PresentationReview,
} from "@openround/contracts";
import { apiFetch } from "../../../lib/api";

export type LibraryScope = "workspace" | "organization" | "shared" | "managed";
export type SharedLibraryScope = Exclude<LibraryScope, "workspace">;
export type SharedArtifactType = "round" | "presentation" | "survey";
export type { LibraryShareSummary };
export interface LibraryShareSource {
  artifactType: SharedArtifactType;
  artifactId: string;
  versionId: string;
  title: string;
}
export interface SharedQuestion {
  id: string;
  type: string;
  prompt: string;
  mediaId: string | null;
  mediaAlt: string | null;
  choices?: Array<{ id: string; label: string }>;
  unit?: string | null;
  min?: number;
  max?: number;
  minLabel?: string | null;
  maxLabel?: string | null;
  required?: boolean;
}
export interface SharedLibraryDetail {
  share: LibraryShareSummary;
  review?: PresentationReview;
  questions?: SharedQuestion[];
}

export function libraryScope(value: string | null): LibraryScope {
  return value === "organization" || value === "shared" || value === "managed"
    ? value
    : "workspace";
}

export function libraryScopeHref(scope: LibraryScope, type: string) {
  const query = new URLSearchParams();
  if (scope !== "workspace") query.set("scope", scope);
  if (type === "surveys" || type === "presentations") query.set("type", type);
  return `/library${query.size ? `?${query}` : ""}`;
}

export function librarySharePath(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new Error("Shared content unavailable");
  return `/v1/library/shares/${id}`;
}

export async function listLibraryShares(
  scope: SharedLibraryScope,
  signal?: AbortSignal,
  cursor?: string | null,
) {
  const query = new URLSearchParams({ scope });
  if (cursor) query.set("cursor", cursor);
  return LibraryShareListSchema.parse(
    await apiFetch(`/v1/library/shares?${query}`, { signal, cache: "no-store" }),
  );
}

export async function listLibraryShareRecipients(search: string, signal: AbortSignal) {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  return LibraryShareRecipientsSchema.parse(
    await apiFetch(`/v1/library/share-recipients${query.size ? `?${query}` : ""}`, {
      signal,
      cache: "no-store",
    }),
  ).recipients;
}

export async function createLibraryShare(intent: LibraryShareCreate, signal?: AbortSignal) {
  const response = await apiFetch<{ share: unknown }>("/v1/library/shares", {
    method: "POST",
    body: JSON.stringify(LibraryShareCreateSchema.parse(intent)),
    signal,
  });
  const share = LibraryShareSummarySchema.parse(response.share);
  if (
    share.artifactType !== intent.artifactType ||
    share.artifactId.toLowerCase() !== intent.artifactId.toLowerCase() ||
    share.versionId.toLowerCase() !== intent.versionId.toLowerCase() ||
    share.permission !== intent.permission ||
    share.audience !== intent.audience
  )
    throw new Error("The share acknowledgement could not be verified");
  return share;
}

export async function readLibraryShare(
  id: string,
  signal: AbortSignal,
): Promise<SharedLibraryDetail> {
  const response = await apiFetch<SharedLibraryDetail>(librarySharePath(id), {
    signal,
    cache: "no-store",
  });
  const share = LibraryShareSummarySchema.parse(response.share);
  if (share.id.toLowerCase() !== id.toLowerCase()) throw new Error("Shared content unavailable");
  if (share.artifactType === "presentation")
    return { share, review: PresentationReviewSchema.parse(response.review) };
  if (!Array.isArray(response.questions)) throw new Error("Shared content unavailable");
  return { share, questions: response.questions };
}

export async function updateLibraryShareProgress(
  id: string,
  status: "in_progress" | "done",
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ share: unknown }>(`${librarySharePath(id)}/progress`, {
    method: "PUT",
    body: JSON.stringify({ status }),
    signal,
  });
  const share = LibraryShareSummarySchema.parse(result.share);
  if (share.id.toLowerCase() !== id.toLowerCase()) throw new Error("Shared content unavailable");
  return share;
}

export async function copyLibraryShare(id: string, requestId: string, signal?: AbortSignal) {
  const result = LibraryShareCopyResultSchema.parse(
    await apiFetch(`${librarySharePath(id)}/copy`, {
      method: "POST",
      body: JSON.stringify({ requestId }),
      signal,
    }),
  );
  librarySharePath(result.artifactId);
  const expected =
    result.artifactType === "round"
      ? `/quiz/${result.artifactId}`
      : result.artifactType === "presentation"
        ? `/presentation/${result.artifactId}`
        : result.artifactType === "survey"
          ? `/surveys/${result.artifactId}`
          : null;
  if (!expected || result.href !== expected) throw new Error("The copy could not be verified");
  return result;
}

export async function revokeLibraryShare(id: string, signal?: AbortSignal) {
  await apiFetch(librarySharePath(id), { method: "DELETE", signal });
}
