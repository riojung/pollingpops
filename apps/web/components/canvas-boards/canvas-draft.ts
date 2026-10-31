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
  fromAnchor?: Extract<CanvasObject, { type: "connector" }>["from"]["anchor"];
  toAnchor?: Extract<CanvasObject, { type: "connector" }>["to"]["anchor"];
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  routing?: "straight" | "elbow";
  lineStyle?: "solid" | "dashed";
  startMarker?: "none" | "arrow";
  endMarker?: "none" | "arrow";
  lineColor?: "neutral" | CanvasObject["color"];
  altText?: string;
  url?: string;
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
      ? {
          fromId: object.from.objectId ?? "",
          toId: object.to.objectId ?? "",
          fromAnchor: object.from.anchor,
          toAnchor: object.to.anchor,
          fromX: object.from.x,
          fromY: object.from.y,
          toX: object.to.x,
          toY: object.to.y,
          routing: object.routing,
          lineStyle: object.lineStyle,
          startMarker: object.startMarker,
          endMarker: object.endMarker,
          lineColor: object.lineColor,
        }
      : {}),
    ...(object.type === "image" ? { altText: object.altText } : {}),
    ...(object.type === "link" ? { url: object.url } : {}),
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
