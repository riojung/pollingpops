import { MediaUploadRequestSchema, MediaUploadTicketSchema } from "@openround/contracts";
import { API_URL, apiFetch, ApiClientError } from "../../lib/api";
import { canvasPath } from "./canvas-client";

export interface CanvasArtifactImageContext {
  kind: "round" | "presentation";
  targetId: string;
  linkId: string;
}
export function canvasArtifactImagePath(context: CanvasArtifactImageContext, mediaId: string) {
  if (!context || !["round", "presentation"].includes(context.kind))
    throw new Error("Invalid activity image context");
  canvasPath(context.targetId);
  canvasPath(context.linkId);
  canvasPath(mediaId);
  return `/v1/${context.kind === "round" ? "quizzes" : "presentations"}/${context.targetId}/canvas-snapshot-links/${context.linkId}/media/${mediaId}`;
}

export function canvasMediaPath(boardId: string, mediaId: string) {
  canvasPath(mediaId);
  return `${canvasPath(boardId)}/media/${mediaId}`;
}

/** The creator session never accompanies the direct object-storage upload. */
export async function uploadCanvasImage(
  boardId: string,
  file: File,
  altText: string,
  signal?: AbortSignal,
) {
  const input = MediaUploadRequestSchema.parse({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    altText: altText.trim(),
  });
  const ticket = MediaUploadTicketSchema.parse(
    await apiFetch(`${canvasPath(boardId)}/media`, {
      method: "POST",
      signal,
      body: JSON.stringify(input),
    }),
  );
  const destination = new URL(ticket.uploadUrl);
  if (
    !["https:", "http:"].includes(destination.protocol) ||
    destination.username ||
    destination.password ||
    destination.hash
  )
    throw new Error("Invalid image upload destination");
  const uploaded = await fetch(destination.href, {
    method: "PUT",
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { "content-type": input.mimeType },
    body: file,
    signal,
  });
  if (!uploaded.ok)
    throw new ApiClientError("Image upload did not finish", "UPLOAD_FAILED", uploaded.status);
  const result = await apiFetch<{ media: { id: string; scanStatus: string; altText: string } }>(
    `${canvasMediaPath(boardId, ticket.mediaId)}/complete`,
    { method: "POST", signal, body: "{}" },
  );
  if (result.media.id !== ticket.mediaId || result.media.scanStatus !== "clean")
    throw new ApiClientError("This image could not be approved", "MEDIA_REJECTED", 422);
  return { mediaId: ticket.mediaId, altText: input.altText };
}

/** Guests use their source-workshop credential with explicit cookie omission. */
export async function fetchCanvasImage(
  boardId: string,
  mediaId: string,
  signal?: AbortSignal,
  guest?: { sourceBoardId: string; token: string },
  versionId?: string,
  artifactLink?: CanvasArtifactImageContext,
): Promise<Blob> {
  let path = canvasMediaPath(boardId, mediaId);
  if (versionId !== undefined) {
    canvasPath(versionId);
    if (guest) throw new Error("Saved versions require team access");
    path = `${canvasPath(boardId)}/versions/${versionId}/media/${mediaId}`;
  }
  if (artifactLink !== undefined) {
    if (guest) throw new Error("Activity snapshots require team access");
    path = canvasArtifactImagePath(artifactLink, mediaId);
  }
  if (guest) {
    canvasPath(guest.sourceBoardId);
    if (!/^[a-f0-9]{64}$/.test(guest.token)) throw new Error("Invalid workshop credential");
    path = `/v1/canvas-boards/workshop/${guest.sourceBoardId}/guest/media/${mediaId}`;
  }
  const response = await fetch(`${API_URL}${path}`, {
    credentials: guest ? "omit" : "include",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
    ...(guest ? { headers: { authorization: `Bearer ${guest.token}` } } : {}),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ApiClientError(
      "This canvas image is unavailable",
      error?.error?.code ?? "NOT_FOUND",
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (!mime || !["image/jpeg", "image/png", "image/webp"].includes(mime))
    throw new Error("Invalid canvas image response");
  const blob = await response.blob();
  if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("Invalid canvas image size");
  return blob;
}
