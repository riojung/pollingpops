import {
  CanvasBoardMutationSchema,
  type CanvasBoardView,
  type CanvasObject,
} from "@openround/contracts";
import { canvasAncestors, canvasDescendants, canvasSelectionClosure } from "./canvas-hierarchy";
import { canChangeObject } from "./canvas-model";
import { resizeCanvasPatch, type CanvasBatch, type CanvasPlan } from "./canvas-productivity";
import type { CanvasPatch } from "./canvas-surface";

const invalid = (reason: CanvasPlan["reason"]): CanvasPlan => ({
  command: null,
  reason,
  selection: [],
});
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6;

/** Checkpoints restore layout only. Current content, identity and permissions remain authoritative. */
export function planCanvasHistoryLayout(
  board: CanvasBoardView,
  saved: readonly CanvasObject[],
): CanvasPlan {
  if (!board.capabilities.edit) return invalid("permission");
  const current = new Map(board.objects.map((object) => [object.id, object]));
  const patches = new Map<string, CanvasPatch>();
  for (const previous of saved) {
    const object = current.get(previous.id);
    if (!object || object.type !== previous.type) continue;
    const parent = previous.parentId ? current.get(previous.parentId) : null;
    const next = {
      ...resizeCanvasPatch(object, {
        x: previous.x,
        y: previous.y,
        width: previous.width,
        height: previous.height,
      }),
      rotation: previous.rotation,
      zIndex: previous.zIndex,
      parentId: parent?.type === "frame" ? parent.id : null,
      geometricGroupId: previous.geometricGroupId,
    };
    if (
      Object.entries(next).every(
        ([key, value]) =>
          JSON.stringify(object[key as keyof CanvasObject]) === JSON.stringify(value),
      )
    )
      continue;
    if (
      object.locked ||
      canvasAncestors(board.objects, object).some((item) => item.locked) ||
      canvasDescendants(board.objects, [object.id]).some((item) => item.locked) ||
      (parent &&
        parent.id !== object.parentId &&
        (parent.locked || canvasAncestors(board.objects, parent).some((item) => item.locked)))
    )
      return invalid("locked");
    if (
      !canChangeObject(board, object) ||
      (parent && parent.id !== object.parentId && !canChangeObject(board, parent))
    )
      return invalid("protected");
    patches.set(object.id, next);
  }
  if (!patches.size) return invalid("empty");
  if (patches.size > 50) return invalid("limit");
  for (const object of board.objects) {
    const seen = new Set([object.id]);
    const initial = patches.get(object.id);
    let parentId = initial && "parentId" in initial ? (initial.parentId ?? null) : object.parentId;
    while (parentId) {
      if (seen.has(parentId)) return invalid("parent");
      seen.add(parentId);
      const parent = current.get(parentId);
      if (!parent || parent.type !== "frame") return invalid("parent");
      const patch = patches.get(parent.id);
      parentId = patch && "parentId" in patch ? (patch.parentId ?? null) : parent.parentId;
    }
  }
  // Existing groups and frame descendants must translate together in one atomic command.
  for (const object of board.objects) {
    const patch = patches.get(object.id);
    if (!patch) continue;
    const dx = (patch.x ?? object.x) - object.x;
    const dy = (patch.y ?? object.y) - object.y;
    if (close(dx, 0) && close(dy, 0)) continue;
    for (const related of canvasSelectionClosure(board.objects, [object.id])) {
      const next = patches.get(related.id);
      if (
        !close((next?.x ?? related.x) - related.x, dx) ||
        !close((next?.y ?? related.y) - related.y, dy)
      )
        return invalid("bounds");
    }
  }
  // Historical group membership cannot connect different parents or resurrect missing members.
  const groups = new Map<string, Set<string | null>>();
  for (const object of board.objects) {
    const next = patches.get(object.id);
    const group =
      next?.geometricGroupId === undefined ? object.geometricGroupId : next.geometricGroupId;
    if (!group) continue;
    const parents = groups.get(group) ?? new Set<string | null>();
    parents.add(next?.parentId === undefined ? object.parentId : next.parentId);
    groups.set(group, parents);
    if (parents.size > 1) return invalid("parent");
  }
  const operations: CanvasBatch["operations"] = board.objects.flatMap((object) =>
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
  const command: CanvasBatch = { type: "batch", operations };
  const parsed = CanvasBoardMutationSchema.safeParse({
    schemaVersion: 2,
    operationId: "00000000-0000-4000-8000-000000000001",
    command,
  });
  return parsed.success ? { command, reason: null, selection: [] } : invalid("bounds");
}
