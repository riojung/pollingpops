import {
  CanvasObjectPatchSchema,
  canvasDiagramPort,
  type CanvasObject,
} from "@openround/contracts";
import type { CanvasObjectDraft } from "./canvas-draft";

export function canvasConnectorDraftPatch(
  object: Extract<CanvasObject, { type: "connector" }>,
  draft: CanvasObjectDraft,
) {
  return CanvasObjectPatchSchema.safeParse({
    text: draft.text,
    from: {
      objectId: draft.fromId || null,
      anchor: draft.fromAnchor ?? object.from.anchor,
      x: draft.fromX ?? object.from.x,
      y: draft.fromY ?? object.from.y,
    },
    to: {
      objectId: draft.toId || null,
      anchor: draft.toAnchor ?? object.to.anchor,
      x: draft.toX ?? object.to.x,
      y: draft.toY ?? object.to.y,
    },
    routing: draft.routing ?? object.routing,
    lineStyle: draft.lineStyle ?? object.lineStyle,
    startMarker: draft.startMarker ?? object.startMarker,
    endMarker: draft.endMarker ?? object.endMarker,
    lineColor: draft.lineColor ?? object.lineColor,
  });
}
/** Detaching keeps the current world endpoint instead of jumping to an old fallback coordinate. */
export function changeCanvasEndpoint(
  object: Extract<CanvasObject, { type: "connector" }>,
  draft: CanvasObjectDraft,
  side: "from" | "to",
  objectId: string,
  objects: CanvasObject[],
): CanvasObjectDraft {
  const endpoint = {
    objectId: draft[`${side}Id`] || null,
    anchor: draft[`${side}Anchor`] ?? object[side].anchor,
    x: draft[`${side}X`] ?? object[side].x,
    y: draft[`${side}Y`] ?? object[side].y,
  };
  const point = canvasDiagramPort(endpoint, objects);
  return { ...draft, [`${side}Id`]: objectId, [`${side}X`]: point.x, [`${side}Y`]: point.y };
}
