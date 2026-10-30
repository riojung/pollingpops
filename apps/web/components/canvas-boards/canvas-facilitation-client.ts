import {
  CanvasFacilitationMutationSchema,
  CanvasFacilitationResponseSchema,
  CanvasFacilitationViewSchema,
  CanvasVersionViewSchema,
  type CanvasFacilitationCommand,
  type CanvasFacilitationMutation,
} from "@openround/contracts";
import { apiFetch } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import { canvasPath } from "./canvas-client";

export function facilitationIntent(command: CanvasFacilitationCommand) {
  return CanvasFacilitationMutationSchema.parse({
    schemaVersion: 1,
    operationId: clientUuid(),
    command,
  });
}
export async function readCanvasFacilitation(id: string, signal?: AbortSignal) {
  const result = await apiFetch<{ facilitation: unknown }>(`${canvasPath(id)}/facilitation`, {
    signal,
    cache: "no-store",
  });
  const view = CanvasFacilitationViewSchema.parse(result.facilitation);
  if (view.boardId !== id) throw new Error("Mismatched facilitation board");
  return view;
}
export async function writeCanvasFacilitation(
  id: string,
  operation: CanvasFacilitationMutation,
  signal?: AbortSignal,
) {
  const result = CanvasFacilitationResponseSchema.parse(
    await apiFetch(`${canvasPath(id)}/facilitation/commands`, {
      method: "POST",
      signal,
      body: JSON.stringify(CanvasFacilitationMutationSchema.parse(operation)),
    }),
  );
  if (result.facilitation.boardId !== id || result.receipt.operationId !== operation.operationId)
    throw new Error("Mismatched facilitation acknowledgement");
  return result;
}
export async function readCanvasVersion(id: string, versionId: string, signal?: AbortSignal) {
  canvasPath(versionId);
  const view = CanvasVersionViewSchema.parse(
    await apiFetch(`${canvasPath(id)}/versions/${versionId}`, { signal, cache: "no-store" }),
  );
  if (view.boardId !== id || view.version.id !== versionId)
    throw new Error("Mismatched saved version");
  return view;
}
