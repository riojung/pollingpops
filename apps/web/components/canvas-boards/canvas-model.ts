import {
  CanvasObjectCreateSchema,
  CanvasBoardCommandSchema,
  type CanvasBoardCommand,
  type CanvasBoardMutation,
  type CanvasBoardView,
  type CanvasObject,
  type CanvasObjectCreate,
} from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import type { CanvasPoint } from "./canvas-geometry";
import { canvasAncestors, canvasDescendants } from "./canvas-hierarchy";

export function canvasObjectLabel(object: CanvasObject, fallback: string) {
  const description = object.type === "image" ? object.altText : object.text;
  return description.trim().slice(0, 80) || fallback;
}

/** Prefer a nearby free cell so repeated toolbar creation does not hide the prior object. */
export function nextCanvasPosition(
  objects: readonly CanvasObject[],
  preferred: CanvasPoint,
  width = 220,
  height = 160,
): CanvasPoint {
  const candidates = [{ x: preferred.x, y: preferred.y }];
  for (let ring = 1; ring <= 10; ring++) {
    candidates.push(
      { x: preferred.x + ring * (width + 24), y: preferred.y },
      { x: preferred.x - ring * (width + 24), y: preferred.y },
      { x: preferred.x, y: preferred.y + ring * (height + 24) },
      { x: preferred.x, y: preferred.y - ring * (height + 24) },
    );
  }
  return (
    candidates.find((point) =>
      objects.every(
        (object) =>
          object.type === "connector" ||
          object.type === "frame" ||
          point.x + width + 12 <= object.x ||
          point.x >= object.x + object.width + 12 ||
          point.y + height + 12 <= object.y ||
          point.y >= object.y + object.height + 12,
      ),
    ) ?? { x: preferred.x + 24, y: preferred.y + 24 }
  );
}

export function newCanvasObject(
  type: Exclude<CanvasObjectCreate["type"], "idea_ref" | "pen">,
  point: CanvasPoint,
  text = "",
): CanvasObjectCreate {
  return CanvasObjectCreateSchema.parse({
    id: clientUuid(),
    type,
    x: Math.round(point.x),
    y: Math.round(point.y),
    width: type === "text" ? 280 : 220,
    height: type === "text" ? 100 : 160,
    color: type === "sticky" ? "yellow" : "white",
    text,
    ...(type === "connector"
      ? {
          from: { objectId: null, ...point },
          to: { objectId: null, x: point.x + 200, y: point.y + 100 },
        }
      : {}),
    ...(type === "link" ? { url: "https://example.com" } : {}),
  });
}

export function duplicateCanvasObject(object: CanvasObject): CanvasObjectCreate | null {
  if (object.type === "idea_ref") return null;
  const content = Object.fromEntries(
    Object.entries(object).filter(([key]) => key !== "version" && key !== "idea"),
  );
  const copy = CanvasObjectCreateSchema.safeParse({
    ...content,
    id: clientUuid(),
    x: object.x + 28,
    y: object.y + 28,
    ...(object.type === "pen" ? { points: object.points.map(([x, y]) => [x + 28, y + 28]) } : {}),
    ...(object.type === "connector"
      ? {
          from: { ...object.from, x: object.from.x + 28, y: object.from.y + 28 },
          to: { ...object.to, x: object.to.x + 28, y: object.to.y + 28 },
        }
      : {}),
  });
  return copy.success ? copy.data : null;
}

export function canControlCanvasObject(board: CanvasBoardView, object: CanvasObject) {
  return (
    board.capabilities.edit &&
    (object.type !== "idea_ref" || board.capabilities.facilitate) &&
    (board.boardType !== "workshop" ||
      board.capabilities.facilitate ||
      (object.visibility !== "published" &&
        !canvasDescendants(board.objects, [object.id]).some(
          (child) => child.type === "idea_ref" || child.visibility === "published",
        )))
  );
}
export function canChangeObject(board: CanvasBoardView, object: CanvasObject) {
  return (
    canControlCanvasObject(board, object) &&
    !object.locked &&
    !canvasAncestors(board.objects, object).some((parent) => parent.locked) &&
    !canvasDescendants(board.objects, [object.id]).some((child) => child.locked)
  );
}
export function canPublishCanvasObject(board: CanvasBoardView, object: CanvasObject) {
  return (
    board.boardType === "workshop" &&
    board.capabilities.facilitate &&
    canChangeObject(board, object) &&
    object.type !== "idea_ref"
  );
}

export function moveCanvasPatch(object: CanvasObject, dx: number, dy: number) {
  const x = object.x + dx;
  const y = object.y + dy;
  const movedX = x - object.x,
    movedY = y - object.y;
  if (object.type === "pen")
    return {
      x,
      y,
      points: object.points.map(([px, py]) => [px + movedX, py + movedY] as [number, number]),
    };
  if (object.type === "connector")
    return {
      x,
      y,
      from: { ...object.from, x: object.from.x + movedX, y: object.from.y + movedY },
      to: { ...object.to, x: object.to.x + movedX, y: object.to.y + movedY },
    };
  return { x, y };
}

/** A conflict is only rebased after an explicit review action; missing targets are never recreated. */
export function reviewedCanvasCommand(
  board: CanvasBoardView,
  command: CanvasBoardMutation["command"],
): Extract<CanvasBoardCommand, { type: "batch" }> | null {
  if (command.type !== "batch") return null;
  if (command.operations.some((operation) => operation.type === "create")) return null;
  const operations = [];
  for (const operation of command.operations) {
    if (operation.type === "create") return null;
    const object = board.objects.find((item) => item.id === operation.id);
    if (!object || !canChangeObject(board, object)) return null;
    operations.push({ ...operation, expectedVersion: object.version });
  }
  const result = CanvasBoardCommandSchema.parse({ type: "batch", operations });
  return result.type === "batch" ? result : null;
}
