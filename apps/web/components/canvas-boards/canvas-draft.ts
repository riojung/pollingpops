import type { CanvasBoardView, CanvasObject } from "@openround/contracts";
import { canChangeObject } from "./canvas-model";

/** Only the locally edited fields are retained, never guest idea projections or remote history. */
export interface CanvasObjectDraft {
  id: string;
  version: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: CanvasObject["color"];
  visibility: CanvasObject["visibility"];
  rotation: number;
  fromId?: string;
  toId?: string;
}
export type CanvasDraftRecoveryReason = "missing" | "unavailable" | "readOnly";
export function canvasObjectDraft(object: CanvasObject): CanvasObjectDraft {
  return {
    id: object.id,
    version: object.version,
    text: object.text,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    color: object.color,
    visibility: object.visibility,
    rotation: object.rotation,
    ...(object.type === "connector"
      ? { fromId: object.from.objectId ?? "", toId: object.to.objectId ?? "" }
      : {}),
  };
}
export function resolveCanvasDraft(
  board: CanvasBoardView | null,
  selectedId: string | null,
  draft: CanvasObjectDraft | null,
) {
  const selected = board?.objects.find((object) => object.id === selectedId);
  const target = draft ? board?.objects.find((object) => object.id === draft.id) : undefined;
  const recovery: CanvasDraftRecoveryReason | null = !draft
    ? null
    : !board
      ? "unavailable"
      : !target
        ? "missing"
        : !canChangeObject(board, target)
          ? "readOnly"
          : null;
  return {
    selected,
    localDraft: selected ? (draft?.id === selected.id ? draft : canvasObjectDraft(selected)) : null,
    dirty: draft !== null,
    recovery,
  };
}
