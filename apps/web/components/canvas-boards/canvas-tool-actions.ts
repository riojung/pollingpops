import {
  CANVAS_MAX_OBJECTS,
  CANVAS_MAX_OPERATIONS,
  CanvasBoardCommandSchema,
  CanvasObjectCreateSchema,
  type CanvasObjectPatchSchema,
  instantiateCanvasTemplate,
  type CanvasBoardView,
  type CanvasObject,
  type CanvasObjectCreate,
  type CanvasTemplateId,
} from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import { canChangeObject, nextCanvasPosition } from "./canvas-model";
import { planCanvasDelete, type CanvasPlan, type CanvasPlanReason } from "./canvas-productivity";
import type { CanvasPoint } from "./canvas-geometry";

const invalid = (reason: CanvasPlanReason): CanvasPlan => ({
  command: null,
  reason,
  selection: [],
});
const simpleTypes = new Set(["sticky", "text", "rect", "ellipse", "diamond", "parallelogram"]);
function creationReason(board: CanvasBoardView, count: number) {
  if (!board.capabilities.edit) return "permission" as const;
  if (count > CANVAS_MAX_OPERATIONS) return "limit" as const;
  if (
    board.objects.length + count > CANVAS_MAX_OBJECTS ||
    (board.boardType === "workshop" &&
      board.objects.filter((object) => object.type !== "idea_ref").length + count > 300)
  )
    return "objects" as const;
  return null;
}
function creates(board: CanvasBoardView, objects: CanvasObjectCreate[]): CanvasPlan {
  const reason = creationReason(board, objects.length);
  if (reason) return invalid(reason);
  const parsed = CanvasBoardCommandSchema.safeParse({
    type: "batch",
    operations: objects.map((object) => ({ type: "create", object })),
  });
  return parsed.success && parsed.data.type === "batch"
    ? { command: parsed.data, reason: null, selection: objects.map((object) => object.id) }
    : invalid("bounds");
}

/** Every quick action uses the versions currently shown by the selection, never a rebased retry. */
export function planCanvasQuickStyle(
  board: CanvasBoardView,
  ids: readonly string[],
  input: ReturnType<typeof CanvasObjectPatchSchema.parse>,
): CanvasPlan {
  if (!board.capabilities.edit) return invalid("permission");
  const objects = [...new Set(ids)].map((id) => board.objects.find((object) => object.id === id));
  if (!objects.length || objects.some((object) => !object)) return invalid("empty");
  if (objects.length > CANVAS_MAX_OPERATIONS) return invalid("limit");
  for (const object of objects) {
    if (object!.type === "idea_ref" || !canChangeObject(board, object!))
      return invalid(object!.locked ? "locked" : "protected");
    if (input.type && (!simpleTypes.has(object!.type) || !simpleTypes.has(input.type)))
      return invalid("protected");
  }
  const parsed = CanvasBoardCommandSchema.safeParse({
    type: "batch",
    operations: objects.map((object) => {
      const patch = { ...input };
      if (object!.type === "connector" && patch.color) {
        patch.lineColor = patch.color;
        delete patch.color;
      }
      if (patch.type === "rect" && object!.type !== "rect") patch.shapeVariant = "rectangle";
      return { type: "update", id: object!.id, expectedVersion: object!.version, patch };
    }),
  });
  return parsed.success && parsed.data.type === "batch"
    ? { command: parsed.data, reason: null, selection: objects.map((object) => object!.id) }
    : invalid("bounds");
}

export function planCanvasStickyStack(
  board: CanvasBoardView,
  point: CanvasPoint,
  count: number,
  color: CanvasObject["color"],
  allocateId = clientUuid,
): CanvasPlan {
  if (!Number.isInteger(count) || count < 1 || count > 20) return invalid("limit");
  const reason = creationReason(board, count);
  if (reason) return invalid(reason);
  const start = nextCanvasPosition(
    board.objects,
    point,
    220 + (count - 1) * 14,
    160 + (count - 1) * 14,
  );
  const objects: CanvasObjectCreate[] = [];
  for (let index = 0; index < count; index++) {
    const object = CanvasObjectCreateSchema.safeParse({
      id: allocateId(),
      type: "sticky",
      x: start.x + index * 14,
      y: start.y + index * 14,
      width: 220,
      height: 160,
      color,
      visibility: "team",
      zIndex: index,
    });
    if (!object.success) return invalid("bounds");
    objects.push(object.data);
  }
  return creates(board, objects);
}

/** Starters become a new private selection; no existing object or guest visibility is overwritten. */
export function planCanvasTemplateInsert(
  board: CanvasBoardView,
  point: CanvasPoint,
  templateId: CanvasTemplateId,
  allocateId = clientUuid,
): CanvasPlan {
  const objects = instantiateCanvasTemplate(templateId, allocateId);
  const reason = creationReason(board, objects.length);
  if (reason) return invalid(reason);
  const left = Math.min(...objects.map((object) => object.x)),
    top = Math.min(...objects.map((object) => object.y));
  const width = Math.max(...objects.map((object) => object.x + object.width)) - left;
  const height = Math.max(...objects.map((object) => object.y + object.height)) - top;
  const start = nextCanvasPosition(board.objects, point, width, height),
    dx = start.x - left,
    dy = start.y - top;
  const translated = objects.map((object) => ({
    ...object,
    x: object.x + dx,
    y: object.y + dy,
    visibility: "team" as const,
    ...(object.type === "connector"
      ? {
          from: { ...object.from, x: object.from.x + dx, y: object.from.y + dy },
          to: { ...object.to, x: object.to.x + dx, y: object.to.y + dy },
        }
      : {}),
    ...(object.type === "pen"
      ? { points: object.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) }
      : {}),
  }));
  return creates(board, translated);
}

/** An eraser never expands a stroke hit into deletion of connected or grouped objects. */
export function planCanvasEraseStrokes(
  board: CanvasBoardView,
  strokes: Extract<CanvasObject, { type: "pen" }>[],
): CanvasPlan {
  if (!strokes.length) return invalid("empty");
  const originals = new Map(strokes.map((object) => [object.id, object]));
  if (strokes.some((object) => !board.objects.some((current) => current.id === object.id)))
    return invalid("empty");
  const snapshot = {
    ...board,
    objects: board.objects.map((object) => originals.get(object.id) ?? object),
  };
  const plan = planCanvasDelete(
    snapshot,
    strokes.map((object) => object.id),
  );
  if (
    plan.command?.operations.some(
      (operation) => operation.type !== "delete" || !originals.has(operation.id),
    )
  )
    return invalid("protected");
  return plan;
}
