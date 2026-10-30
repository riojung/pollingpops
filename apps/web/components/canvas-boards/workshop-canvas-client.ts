import { CanvasBoardGuestViewSchema, CanvasBoardViewSchema } from "@openround/contracts";
import { API_URL, apiFetch, ApiClientError } from "../../lib/api";
import { ideaBoardPath } from "../../lib/idea-board-client";

export function workshopCanvasPath(sourceBoardId: string) {
  ideaBoardPath(sourceBoardId);
  return `/v1/canvas-boards/workshop/${sourceBoardId}`;
}

export async function readWorkshopCanvas(sourceBoardId: string, signal?: AbortSignal) {
  const result = await apiFetch<{ board: unknown }>(workshopCanvasPath(sourceBoardId), {
    signal,
    cache: "no-store",
  });
  const board = CanvasBoardViewSchema.parse(result.board);
  if (board.sourceBoardId !== sourceBoardId) throw new Error("Mismatched workshop canvas");
  return board;
}

export async function readGuestWorkshopCanvas(
  sourceBoardId: string,
  token: string,
  signal?: AbortSignal,
) {
  const result = await apiFetch<{ board: unknown }>(`${workshopCanvasPath(sourceBoardId)}/guest`, {
    signal,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { authorization: `Bearer ${token}` },
  });
  const board = CanvasBoardGuestViewSchema.parse(result.board);
  if (board.sourceBoardId !== sourceBoardId || board.sourceBoard.id !== sourceBoardId)
    throw new Error("Mismatched workshop canvas");
  return board;
}

export async function watchGuestWorkshopCanvas(
  sourceBoardId: string,
  token: string,
  signal: AbortSignal,
  onChange: () => void,
  onRevoked: () => void,
) {
  const response = await fetch(`${API_URL}${workshopCanvasPath(sourceBoardId)}/guest/events`, {
    signal,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { authorization: `Bearer ${token}` },
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
      if (buffer.length > 65536) throw new Error("Canvas event exceeds its size limit");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const event = JSON.parse(line) as { type?: string; sourceBoardId?: string };
          if (event.sourceBoardId && event.sourceBoardId !== sourceBoardId)
            throw new Error("Mismatched canvas event");
          if (["access.revoked", "canvas.deleted"].includes(event.type ?? "")) {
            onRevoked();
            return;
          }
          if (["canvas.ready", "canvas.changed"].includes(event.type ?? "")) onChange();
        }
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!signal.aborted) throw new Error("Canvas live updates interrupted");
}
