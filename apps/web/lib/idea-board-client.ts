import {
  IdeaBoardGuestViewSchema,
  IdeaBoardPublicInfoSchema,
  IdeaBoardViewSchema,
  MediaUploadRequestSchema,
  MediaUploadTicketSchema,
  type IdeaBoardCreate,
  type IdeaBoardHostCommand,
  type IdeaBoardSubmitSchema,
} from "@openround/contracts";
import { API_URL, ApiClientError, apiFetch, retryDelaySeconds } from "./api";
import { clientUuid } from "./uuid";

export function ideaBoardPath(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new Error("Invalid board");
  return `/v1/idea-boards/${id}`;
}

export function ideaBoardCredential(id: string, create = false) {
  ideaBoardPath(id);
  const key = `pollingpops:idea-board:${id}`;
  const existing = window.localStorage.getItem(key);
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  if (!create) return null;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  window.localStorage.setItem(key, token);
  return token;
}

function guestOptions(token?: string): RequestInit {
  return {
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  };
}

export async function fetchIdeaBoard(id: string, signal?: AbortSignal) {
  const result = await apiFetch<{ board: unknown }>(ideaBoardPath(id), {
    signal,
    cache: "no-store",
  });
  const board = IdeaBoardViewSchema.parse(result.board);
  if (board.id !== id) throw new Error("Mismatched board");
  return board;
}
export async function listIdeaBoards(search = "", signal?: AbortSignal, cursor?: string | null) {
  if (cursor) ideaBoardPath(cursor);
  const result = await apiFetch<{ boards: unknown[]; nextCursor: string | null }>(
    `/v1/idea-boards?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    { signal, cache: "no-store" },
  );
  const nextCursor = result.nextCursor ?? null;
  if (nextCursor) ideaBoardPath(nextCursor);
  return { boards: result.boards.map((board) => IdeaBoardViewSchema.parse(board)), nextCursor };
}

export async function fetchPublicIdeaBoard(id: string, signal?: AbortSignal) {
  const result = await apiFetch<{ board: unknown }>(`${ideaBoardPath(id)}/public`, {
    ...guestOptions(),
    signal,
  });
  const board = IdeaBoardPublicInfoSchema.parse(result.board);
  if (board.id !== id) throw new Error("Mismatched board");
  return board;
}

export async function fetchGuestIdeaBoard(id: string, token: string, signal?: AbortSignal) {
  const guest = IdeaBoardGuestViewSchema.parse(
    await apiFetch(`${ideaBoardPath(id)}/guest`, {
      ...guestOptions(token),
      signal,
    }),
  );
  if (guest.board.id !== id) throw new Error("Mismatched board");
  return guest;
}

export async function joinIdeaBoard(
  id: string,
  token: string,
  alias?: string,
  signal?: AbortSignal,
) {
  return IdeaBoardGuestViewSchema.parse(
    await apiFetch(`${ideaBoardPath(id)}/join`, {
      ...guestOptions(token),
      method: "POST",
      signal,
      body: JSON.stringify(alias === undefined ? {} : { alias }),
    }),
  );
}

export function ideaBoardCreateIntent(input: IdeaBoardCreate) {
  return { ...input, schemaVersion: 1 as const, idempotencyKey: clientUuid() };
}

export async function createIdeaBoard(
  input: ReturnType<typeof ideaBoardCreateIntent>,
  signal?: AbortSignal,
  setupContext?: { userId: string; workspaceId: string },
) {
  const result = await apiFetch<{ board: unknown }>("/v1/idea-boards", {
    method: "POST",
    body: JSON.stringify({ ...input, ...(setupContext ? { setupContext } : {}) }),
    signal,
  });
  return IdeaBoardViewSchema.parse(result.board);
}

export function ideaBoardCommandIntent(revision: number, command: IdeaBoardHostCommand) {
  return {
    schemaVersion: 1 as const,
    idempotencyKey: clientUuid(),
    expectedRevision: revision,
    command,
  };
}

export async function commandIdeaBoard(
  id: string,
  input: ReturnType<typeof ideaBoardCommandIntent>,
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ board: unknown }>(`${ideaBoardPath(id)}/commands`, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
  return IdeaBoardViewSchema.parse(result.board);
}

export async function submitBoardIdea(
  id: string,
  token: string,
  input: ReturnType<typeof IdeaBoardSubmitSchema.parse>,
  signal?: AbortSignal,
) {
  return IdeaBoardGuestViewSchema.parse(
    await apiFetch(`${ideaBoardPath(id)}/ideas`, {
      ...guestOptions(token),
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
  );
}

function boardMediaPath(id: string, mediaId: string) {
  ideaBoardPath(mediaId);
  return `${ideaBoardPath(id)}/media/${mediaId}`;
}

/** A board credential is sent only to the board API, never to an object-storage URL. */
export async function uploadIdeaBoardImage(
  id: string,
  token: string,
  file: File,
  altText: string,
  signal?: AbortSignal,
): Promise<{ mediaId: string; scanStatus: "clean"; altText: string }> {
  const input = MediaUploadRequestSchema.parse({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    altText,
  });
  const ticket = MediaUploadTicketSchema.parse(
    await apiFetch(`${ideaBoardPath(id)}/media`, {
      ...guestOptions(token),
      signal,
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  const destination = new URL(ticket.uploadUrl);
  if (
    !["http:", "https:"].includes(destination.protocol) ||
    destination.username ||
    destination.password
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
    throw new ApiClientError("The image upload could not finish", "UPLOAD_FAILED", uploaded.status);
  const completed = await apiFetch<{
    media: { id: string; scanStatus: string; altText: string };
  }>(`${boardMediaPath(id, ticket.mediaId)}/complete`, {
    ...guestOptions(token),
    signal,
    method: "POST",
  });
  if (completed?.media?.id !== ticket.mediaId || completed.media.scanStatus !== "clean")
    throw new ApiClientError("The image could not be approved for use", "MEDIA_REJECTED", 422);
  return { mediaId: ticket.mediaId, scanStatus: "clean", altText: input.altText };
}

/** Authenticated bytes avoid putting audience credentials or reusable signed links in markup. */
export async function fetchIdeaBoardImage(
  id: string,
  mediaId: string,
  token?: string,
  signal?: AbortSignal,
  canvasId?: string,
): Promise<Blob> {
  const sourcePath = boardMediaPath(id, mediaId);
  const path =
    canvasId && token === undefined
      ? `/v1/canvas-boards/${canvasId}/media/${mediaId}`
      : `${sourcePath}/content`;
  if (canvasId) ideaBoardPath(canvasId);
  const response = await fetch(`${API_URL}${path}`, {
    ...guestOptions(token),
    credentials: token === undefined ? "include" : "omit",
    signal,
  });
  if (!response.ok) {
    const details = (await response.json().catch(() => null)) as {
      error?: { code?: string; retryAfterSeconds?: number };
    } | null;
    throw new ApiClientError(
      "This board image is unavailable",
      details?.error?.code ?? "NOT_FOUND",
      response.status,
      retryDelaySeconds(details?.error?.retryAfterSeconds, response.headers.get("retry-after")),
    );
  }
  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (!mediaType || !["image/jpeg", "image/png", "image/webp"].includes(mediaType))
    throw new Error("Invalid board image response");
  const content = await response.blob();
  if (content.size < 1 || content.size > 10 * 1024 * 1024)
    throw new Error("Invalid board image size");
  return content;
}

export async function submitBoardVotes(
  id: string,
  token: string,
  input: { schemaVersion: 1; idempotencyKey: string; expectedRevision: number; ideaIds: string[] },
  signal?: AbortSignal,
) {
  return IdeaBoardGuestViewSchema.parse(
    await apiFetch(`${ideaBoardPath(id)}/votes`, {
      ...guestOptions(token),
      method: "PUT",
      body: JSON.stringify(input),
      signal,
    }),
  );
}
