import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardCreateSchema,
  CanvasBoardInviteSchema,
  CanvasBoardMutationResponseSchema,
  CanvasBoardMutationSchema,
  CanvasBoardViewSchema,
  CanvasBoardInvitationSchema,
  type CanvasBoardCommand,
  type CanvasBoardCreate,
  type CanvasBoardMutation,
} from "@openround/contracts";
import { API_URL, apiFetch, ApiClientError } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";

export function canvasPath(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new Error("Invalid canvas");
  return `/v1/canvas-boards/${id}`;
}
export function canvasIntent(command: CanvasBoardCommand): CanvasBoardMutation {
  return CanvasBoardMutationSchema.parse({
    schemaVersion: CANVAS_SCHEMA_VERSION,
    operationId: clientUuid(),
    command,
  });
}
export async function readCanvas(id: string, signal?: AbortSignal) {
  const result = await apiFetch<{ board: unknown }>(canvasPath(id), { signal, cache: "no-store" });
  const board = CanvasBoardViewSchema.parse(result.board);
  if (board.id !== id) throw new Error("Mismatched canvas");
  return board;
}
/** A retry may follow a lost success response; absent boards need no further deletion. */
export async function deleteCanvas(id: string, signal?: AbortSignal) {
  try {
    await apiFetch(canvasPath(id), { method: "DELETE", signal });
  } catch (error) {
    if (!(error instanceof ApiClientError && error.status === 404)) throw error;
  }
}
export async function writeCanvas(
  id: string,
  operation: CanvasBoardMutation,
  signal?: AbortSignal,
) {
  const result = CanvasBoardMutationResponseSchema.parse(
    await apiFetch(`${canvasPath(id)}/commands`, {
      method: "POST",
      signal,
      body: JSON.stringify(CanvasBoardMutationSchema.parse(operation)),
    }),
  );
  if (result.board.id !== id || result.receipt.operationId !== operation.operationId)
    throw new Error("Mismatched canvas acknowledgement");
  return result;
}
export async function listCanvases(
  scope: "all" | "owned" | "shared" | "archived",
  signal?: AbortSignal,
  cursor?: string | null,
  search = "",
) {
  if (cursor) canvasPath(cursor);
  const result = await apiFetch<{ boards: unknown[]; nextCursor: string | null }>(
    `/v1/canvas-boards?scope=${scope}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    {
      signal,
      cache: "no-store",
    },
  );
  const nextCursor = result.nextCursor ?? null;
  if (nextCursor) canvasPath(nextCursor);
  return { boards: result.boards.map((board) => CanvasBoardViewSchema.parse(board)), nextCursor };
}
export async function createCanvas(
  input: CanvasBoardCreate,
  signal?: AbortSignal,
  setupContext?: { userId: string; workspaceId: string },
) {
  const result = await apiFetch<{ board: unknown }>("/v1/canvas-boards", {
    method: "POST",
    signal,
    body: JSON.stringify({
      ...CanvasBoardCreateSchema.parse(input),
      ...(setupContext ? { setupContext } : {}),
    }),
  });
  return CanvasBoardViewSchema.parse(result.board);
}
export async function inviteCanvas(
  id: string,
  email: string,
  role: "editor" | "viewer" | "facilitator",
  operationId: string,
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ invitation: unknown }>(`${canvasPath(id)}/invitations`, {
    method: "POST",
    signal,
    body: JSON.stringify(CanvasBoardInviteSchema.parse({ email, role, operationId })),
  });
  const invitation = CanvasBoardInvitationSchema.parse(result.invitation);
  if (invitation.boardId !== id) throw new Error("Mismatched canvas invitation");
  return { invitation };
}

/** Notifications carry metadata only; every displayed object comes from a fresh authorized read. */
export async function watchCanvas(
  id: string,
  signal: AbortSignal,
  onChange: () => void,
  onRevoked: () => void,
) {
  const response = await fetch(`${API_URL}${canvasPath(id)}/events`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok || !response.body)
    throw new ApiClientError("Canvas live updates unavailable", "UNAVAILABLE", response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      if (buffer.length > 65536) throw new Error("Invalid canvas event");
      let end = buffer.indexOf("\n");
      while (end >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line) {
          const event = JSON.parse(line) as { type?: string; boardId?: string };
          if (event.boardId && event.boardId !== id) throw new Error("Mismatched canvas event");
          if (["access.revoked", "canvas.deleted"].includes(event.type ?? "")) {
            onRevoked();
            return;
          }
          if (["canvas.changed", "canvas.ready"].includes(event.type ?? "")) onChange();
        }
        end = buffer.indexOf("\n");
      }
    }
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!signal.aborted) throw new Error("Canvas live updates interrupted");
}
