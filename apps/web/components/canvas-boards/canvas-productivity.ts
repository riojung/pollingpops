import {
  CANVAS_MAX_OBJECTS,
  CANVAS_MAX_OPERATIONS,
  CanvasBoardMutationSchema,
  CanvasObjectCreateSchema,
  type CanvasBoardCommand,
  type CanvasBoardView,
  type CanvasObject,
  type CanvasObjectCreate,
} from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import {
  canChangeObject,
  canControlCanvasObject,
  duplicateCanvasObject,
  moveCanvasPatch,
} from "./canvas-model";
import {
  canvasAncestors,
  canvasDescendants,
  canvasGroupId,
  canvasObjectBounds,
  canvasSelectionBounds,
  canvasSelectionClosure,
  canvasSelectionRoots,
} from "./canvas-hierarchy";
import type { CanvasBounds, CanvasPoint } from "./canvas-geometry";
import type { CanvasPatch } from "./canvas-surface";

export type CanvasBatch = Extract<CanvasBoardCommand, { type: "batch" }>;
export type CanvasPlanReason =
  | "empty"
  | "limit"
  | "permission"
  | "locked"
  | "protected"
  | "bounds"
  | "anchors"
  | "objects"
  | "parent";
export interface CanvasPlan {
  command: CanvasBatch | null;
  reason: CanvasPlanReason | null;
  selection: string[];
}
export type CanvasTransform =
  { type: "move"; dx: number; dy: number } | { type: "resize"; bounds: CanvasBounds };
export type CanvasArrange =
  "left" | "center" | "right" | "top" | "middle" | "bottom" | "horizontal" | "vertical";
const invalid = (reason: CanvasPlanReason): CanvasPlan => ({
  command: null,
  reason,
  selection: [],
});
export function canvasCreationFull(board: CanvasBoardView) {
  return (
    board.objects.length >= CANVAS_MAX_OBJECTS ||
    (board.boardType === "workshop" &&
      board.objects.filter((object) => object.type !== "idea_ref").length >= 300)
  );
}
function failure(board: CanvasBoardView, objects: CanvasObject[]): CanvasPlanReason | null {
  if (!objects.length) return "empty";
  if (!board.capabilities.edit) return "permission";
  for (const object of objects) {
    if (
      object.locked ||
      canvasAncestors(board.objects, object).some((parent) => parent.locked) ||
      canvasDescendants(board.objects, [object.id]).some((child) => child.locked)
    )
      return "locked";
    if (!canChangeObject(board, object)) return "protected";
  }
  return null;
}
function finish(
  board: CanvasBoardView,
  operations: CanvasBatch["operations"],
  selection: string[],
): CanvasPlan {
  if (!operations.length) return invalid("empty");
  if (
    new Set(
      operations.map((operation) =>
        operation.type === "create" ? operation.object.id : operation.id,
      ),
    ).size !== operations.length
  )
    return invalid("bounds");
  if (operations.length > CANVAS_MAX_OPERATIONS) return invalid("limit");
  const creates = operations.filter((operation) => operation.type === "create").length,
    deletes = operations.filter((operation) => operation.type === "delete").length;
  if (board.objects.length + creates - deletes > CANVAS_MAX_OBJECTS) return invalid("objects");
  if (board.boardType === "workshop") {
    const deletedIds = new Set(
      operations.flatMap((operation) => (operation.type === "delete" ? [operation.id] : [])),
    );
    const ordinary =
      board.objects.filter((object) => object.type !== "idea_ref" && !deletedIds.has(object.id))
        .length +
      operations.filter(
        (operation) => operation.type === "create" && operation.object.type !== "idea_ref",
      ).length;
    if (ordinary > 300) return invalid("objects");
  }
  const command: CanvasBatch = { type: "batch", operations };
  const parsed = CanvasBoardMutationSchema.safeParse({
    schemaVersion: 2,
    operationId: "00000000-0000-4000-8000-000000000001",
    command,
  });
  if (!parsed.success)
    return invalid(
      new TextEncoder().encode(JSON.stringify(command)).byteLength > 63000 ? "limit" : "bounds",
    );
  return { command: parsed.data.command as CanvasBatch, reason: null, selection };
}
function updates(
  objects: CanvasObject[],
  patches: Map<string, CanvasPatch>,
): CanvasBatch["operations"] {
  return objects.flatMap((object) =>
    patches.has(object.id)
      ? [
          {
            type: "update" as const,
            id: object.id,
            expectedVersion: object.version,
            patch: patches.get(object.id)!,
          },
        ]
      : [],
  );
}
export function resizeCanvasPatch(object: CanvasObject, next: CanvasBounds): CanvasPatch {
  const sx = next.width / object.width,
    sy = next.height / object.height;
  const point = (x: number, y: number) => ({
    x: next.x + (x - object.x) * sx,
    y: next.y + (y - object.y) * sy,
  });
  return {
    ...next,
    ...(object.type === "pen"
      ? {
          points: object.points.map(([x, y]) => {
            const nextPoint = point(x, y);
            return [nextPoint.x, nextPoint.y] as [number, number];
          }),
        }
      : {}),
    ...(object.type === "connector"
      ? {
          from: { ...object.from, ...point(object.from.x, object.from.y) },
          to: { ...object.to, ...point(object.to.x, object.to.y) },
        }
      : {}),
  };
}
export function canvasTransformPatches(
  objects: CanvasObject[],
  ids: readonly string[],
  transform: CanvasTransform,
) {
  const affected =
      transform.type === "move"
        ? canvasSelectionClosure(objects, ids)
        : objects.filter((object) => ids.includes(object.id)),
    patches = new Map<string, CanvasPatch>();
  const bounds =
    transform.type === "resize" && affected.length === 1
      ? canvasObjectBounds(affected[0]!, objects)
      : canvasSelectionBounds(objects, ids);
  if (!bounds) return patches;
  for (const object of affected) {
    if (transform.type === "move")
      patches.set(object.id, moveCanvasPatch(object, transform.dx, transform.dy));
    else {
      const sx = transform.bounds.width / bounds.width,
        sy = transform.bounds.height / bounds.height;
      patches.set(
        object.id,
        resizeCanvasPatch(object, {
          x: transform.bounds.x + (object.x - bounds.x) * sx,
          y: transform.bounds.y + (object.y - bounds.y) * sy,
          width: Math.max(1, object.width * sx),
          height: Math.max(1, object.height * sy),
        }),
      );
    }
  }
  return patches;
}
export function planCanvasTransform(
  board: CanvasBoardView,
  ids: readonly string[],
  transform: CanvasTransform,
): CanvasPlan {
  const affected =
      transform.type === "move"
        ? canvasSelectionClosure(board.objects, ids)
        : board.objects.filter((object) => ids.includes(object.id)),
    reason = failure(board, affected);
  if (affected.length > CANVAS_MAX_OPERATIONS) return invalid("limit");
  if (reason) return invalid(reason);
  if (ids.some((id) => !board.objects.some((object) => object.id === id))) return invalid("empty");
  if (
    affected.length === 1 &&
    affected[0]!.type === "connector" &&
    (affected[0]!.from.objectId || affected[0]!.to.objectId)
  )
    return invalid("anchors");
  return finish(board, updates(affected, canvasTransformPatches(board.objects, ids, transform)), [
    ...ids,
  ]);
}
export function planCanvasArrange(
  board: CanvasBoardView,
  ids: readonly string[],
  mode: CanvasArrange,
): CanvasPlan {
  const selected = canvasSelectionClosure(board.objects, ids);
  const roots = canvasSelectionRoots(
    board.objects,
    selected.map((object) => object.id),
  ).filter((object) => object.type !== "connector");
  const units = new Map<string, CanvasObject[]>();
  for (const object of roots) {
    const key = canvasGroupId(object) ?? object.id;
    units.set(key, [...(units.get(key) ?? []), object]);
  }
  if (units.size < (mode === "horizontal" || mode === "vertical" ? 3 : 2)) return invalid("empty");
  const affected = canvasSelectionClosure(
      board.objects,
      roots.map((object) => object.id),
    ),
    reason = failure(board, affected);
  if (reason) return invalid(reason);
  const bounds = [...units.values()].map((objects) => ({
    objects,
    bounds: canvasSelectionBounds(
      board.objects,
      objects.map((object) => object.id),
    )!,
  }));
  const all = canvasSelectionBounds(
    board.objects,
    roots.map((object) => object.id),
  )!;
  const patches = new Map<string, CanvasPatch>();
  let cursor = 0,
    gap = 0;
  if (mode === "horizontal" || mode === "vertical") {
    const horizontal = mode === "horizontal";
    bounds.sort((a, b) => (horizontal ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
    const first = bounds[0]!.bounds,
      last = bounds.at(-1)!.bounds;
    cursor = horizontal ? first.x : first.y;
    const span = horizontal ? last.x + last.width - first.x : last.y + last.height - first.y;
    gap =
      (span -
        bounds.reduce(
          (total, value) => total + (horizontal ? value.bounds.width : value.bounds.height),
          0,
        )) /
      (bounds.length - 1);
  }
  for (const { objects, bounds: box } of bounds) {
    const dx =
      mode === "left"
        ? all.x - box.x
        : mode === "right"
          ? all.x + all.width - box.x - box.width
          : mode === "center"
            ? all.x + all.width / 2 - box.x - box.width / 2
            : mode === "horizontal"
              ? cursor - box.x
              : 0;
    const dy =
      mode === "top"
        ? all.y - box.y
        : mode === "bottom"
          ? all.y + all.height - box.y - box.height
          : mode === "middle"
            ? all.y + all.height / 2 - box.y - box.height / 2
            : mode === "vertical"
              ? cursor - box.y
              : 0;
    for (const child of canvasSelectionClosure(
      board.objects,
      objects.map((object) => object.id),
    ))
      patches.set(child.id, moveCanvasPatch(child, dx, dy));
    if (mode === "horizontal") cursor += box.width + gap;
    if (mode === "vertical") cursor += box.height + gap;
  }
  return finish(board, updates(affected, patches), [...ids]);
}
export function planCanvasGroup(board: CanvasBoardView, ids: readonly string[]): CanvasPlan {
  const affected = canvasSelectionClosure(board.objects, ids),
    reason = failure(board, affected);
  if (reason) return invalid(reason);
  const roots = canvasSelectionRoots(
    board.objects,
    affected.map((object) => object.id),
  );
  if (roots.length < 2) return invalid("empty");
  if (!roots.every((object) => object.parentId === roots[0]!.parentId)) return invalid("parent");
  const groupId = clientUuid();
  return finish(
    board,
    roots.map((object) => ({
      type: "update",
      id: object.id,
      expectedVersion: object.version,
      patch: { geometricGroupId: groupId },
    })),
    roots.map((object) => object.id),
  );
}
export function planCanvasUngroup(board: CanvasBoardView, ids: readonly string[]): CanvasPlan {
  const affected = canvasSelectionClosure(board.objects, ids),
    reason = failure(board, affected);
  if (reason) return invalid(reason);
  const roots = canvasSelectionRoots(
    board.objects,
    affected.map((object) => object.id),
  ).filter((object) => canvasGroupId(object));
  return finish(
    board,
    roots.map((object) => ({
      type: "update",
      id: object.id,
      expectedVersion: object.version,
      patch: { geometricGroupId: null },
    })),
    roots.map((object) => object.id),
  );
}
export function planCanvasFrame(
  board: CanvasBoardView,
  ids: readonly string[],
  title: string,
): CanvasPlan {
  const roots = canvasSelectionRoots(
    board.objects,
    canvasSelectionClosure(board.objects, ids).map((object) => object.id),
  );
  const affected = canvasSelectionClosure(board.objects, ids),
    reason = failure(board, affected);
  if (reason) return invalid(reason);
  if (!roots.every((object) => object.parentId === roots[0]!.parentId)) return invalid("parent");
  const bounds = canvasSelectionBounds(board.objects, ids)!;
  const candidate = CanvasObjectCreateSchema.safeParse({
    id: clientUuid(),
    type: "frame",
    x: Math.round(bounds.x - 24),
    y: Math.round(bounds.y - 40),
    width: bounds.width + 48,
    height: bounds.height + 64,
    parentId: roots[0]!.parentId,
    zIndex: Math.max(-10000, Math.min(...affected.map((object) => object.zIndex)) - 1),
    color: "white",
    text: title,
  });
  if (!candidate.success) return invalid("bounds");
  const frame = candidate.data;
  return finish(
    board,
    [
      { type: "create", object: frame },
      ...roots.map((object) => ({
        type: "update" as const,
        id: object.id,
        expectedVersion: object.version,
        patch: { parentId: frame.id },
      })),
    ],
    [frame.id],
  );
}
export function planCanvasDelete(board: CanvasBoardView, ids: readonly string[]): CanvasPlan {
  const removed = new Set(canvasSelectionClosure(board.objects, ids).map((object) => object.id));
  for (const object of board.objects)
    if (
      object.type === "connector" &&
      ((object.from.objectId && removed.has(object.from.objectId)) ||
        (object.to.objectId && removed.has(object.to.objectId)))
    )
      removed.add(object.id);
  const affected = board.objects.filter((object) => removed.has(object.id)),
    reason = failure(board, affected);
  if (reason) return invalid(reason);
  if (affected.some((object) => object.type === "idea_ref")) return invalid("protected");
  return finish(
    board,
    affected.map((object) => ({ type: "delete", id: object.id, expectedVersion: object.version })),
    [],
  );
}
export function planCanvasDuplicate(board: CanvasBoardView, ids: readonly string[]): CanvasPlan {
  const affected = canvasSelectionClosure(board.objects, ids),
    reason = failure(board, affected);
  if (reason) return invalid(reason);
  if (affected.some((object) => object.type === "idea_ref")) return invalid("protected");
  if (affected.length > CANVAS_MAX_OPERATIONS) return invalid("limit");
  const remap = new Map(affected.map((object) => [object.id, clientUuid()]));
  const groups = new Map(
    affected
      .filter((object) => canvasGroupId(object))
      .map((object) => [canvasGroupId(object)!, clientUuid()]),
  );
  const copies: CanvasObjectCreate[] = [];
  for (const object of affected) {
    const copy = duplicateCanvasObject(object);
    if (!copy) return invalid("bounds");
    copy.id = remap.get(object.id)!;
    copy.geometricGroupId = groups.get(canvasGroupId(object) ?? "") ?? null;
    copy.parentId = remap.get(object.parentId ?? "") ?? object.parentId;
    if (board.boardType === "workshop") copy.visibility = "team";
    if (copy.type === "connector") {
      copy.from = {
        ...copy.from,
        objectId: remap.get(copy.from.objectId ?? "") ?? copy.from.objectId,
      };
      copy.to = { ...copy.to, objectId: remap.get(copy.to.objectId ?? "") ?? copy.to.objectId };
    }
    copies.push(copy);
  }
  return finish(
    board,
    copies.map((object) => ({ type: "create", object })),
    canvasSelectionRoots(board.objects, ids).map((object) => remap.get(object.id)!),
  );
}
export function planCanvasReparent(
  board: CanvasBoardView,
  ids: readonly string[],
  parentId: string | null,
): CanvasPlan {
  const affected = canvasSelectionClosure(board.objects, ids),
    reason = failure(board, affected);
  if (reason) return invalid(reason);
  if (parentId) {
    const parent = board.objects.find((object) => object.id === parentId);
    if (!parent || parent.type !== "frame" || affected.some((object) => object.id === parentId))
      return invalid("parent");
    const blocked = failure(board, [parent]);
    if (blocked) return invalid(blocked);
  }
  const roots = canvasSelectionRoots(
    board.objects,
    affected.map((object) => object.id),
  );
  return finish(
    board,
    roots
      .filter((object) => object.parentId !== parentId)
      .map((object) => ({
        type: "update",
        id: object.id,
        expectedVersion: object.version,
        patch: { parentId },
      })),
    [...ids],
  );
}
export function planCanvasLock(
  board: CanvasBoardView,
  ids: readonly string[],
  locked: boolean,
): CanvasPlan {
  const roots = canvasSelectionRoots(
    board.objects,
    canvasSelectionClosure(board.objects, ids).map((object) => object.id),
  );
  if (!roots.length) return invalid("empty");
  for (const object of roots.filter((object) => object.locked !== locked)) {
    if (!canControlCanvasObject(board, object)) return invalid("protected");
    if (canvasAncestors(board.objects, object).some((parent) => parent.locked))
      return invalid("locked");
  }
  return finish(
    board,
    roots
      .filter((object) => object.locked !== locked)
      .map((object) => ({
        type: "update",
        id: object.id,
        expectedVersion: object.version,
        patch: { locked },
      })),
    [...ids],
  );
}
export function sampleCanvasStroke(points: readonly [number, number][]): [number, number][] {
  if (points.length <= 128) return points.map(([x, y]) => [x, y]);
  const keep = new Set([0, points.length - 1]);
  for (const axis of [0, 1] as const) {
    let low = 0,
      high = 0;
    points.forEach((point, index) => {
      if (point[axis] < points[low]![axis]) low = index;
      if (point[axis] > points[high]![axis]) high = index;
    });
    keep.add(low);
    keep.add(high);
  }
  const count = 128 - keep.size;
  for (let index = 0; index < count; index++)
    keep.add(Math.round((index * (points.length - 1)) / Math.max(1, count - 1)));
  for (let index = 1; keep.size < 128 && index < points.length - 1; index++) keep.add(index);
  return [...keep]
    .sort((a, b) => a - b)
    .slice(0, 128)
    .map((index) => [points[index]![0], points[index]![1]]);
}
export function newCanvasPen(points: readonly [number, number][]): CanvasObjectCreate | null {
  if (points.length < 2) return null;
  const sampled = sampleCanvasStroke(points),
    x = Math.min(...sampled.map((point) => point[0])),
    y = Math.min(...sampled.map((point) => point[1]));
  return CanvasObjectCreateSchema.parse({
    id: clientUuid(),
    type: "pen",
    x,
    y,
    width: Math.max(1, Math.max(...sampled.map((point) => point[0])) - x),
    height: Math.max(1, Math.max(...sampled.map((point) => point[1])) - y),
    points: sampled,
    color: "blue",
  });
}
export function canvasObjectsInRect(objects: CanvasObject[], rect: CanvasBounds) {
  return objects
    .filter((object) => {
      const box = canvasObjectBounds(object, objects);
      return (
        box.x >= rect.x &&
        box.y >= rect.y &&
        box.x + box.width <= rect.x + rect.width &&
        box.y + box.height <= rect.y + rect.height
      );
    })
    .map((object) => object.id);
}
export function canvasDragRect(a: CanvasPoint, b: CanvasPoint): CanvasBounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
