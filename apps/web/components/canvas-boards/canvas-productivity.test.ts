import { describe, expect, it } from "vitest";
import { CanvasObjectSchema, type CanvasObject, type CanvasBoardView } from "@openround/contracts";
import { canvasBoard, canvasObject } from "./canvas-test-fixtures";
import { canvasSelectionClosure } from "./canvas-hierarchy";
import {
  newCanvasPen,
  canvasCreationFull,
  planCanvasArrange,
  planCanvasDelete,
  planCanvasDuplicate,
  planCanvasFrame,
  planCanvasGroup,
  planCanvasLock,
  planCanvasReparent,
  planCanvasTransform,
  planCanvasUngroup,
  resizeCanvasPatch,
  sampleCanvasStroke,
} from "./canvas-productivity";
function id(index: number) {
  return "00000000-0000-4000-8000-" + String(index).padStart(12, "0");
}
function object(index: number, patch: Record<string, unknown> = {}): CanvasObject {
  return CanvasObjectSchema.parse({ ...canvasObject, id: id(index), ...patch });
}
function board(objects: CanvasObject[], patch: Partial<CanvasBoardView> = {}): CanvasBoardView {
  return { ...canvasBoard, objects, ...patch };
}
function patchOf(plan: ReturnType<typeof planCanvasTransform>, target: string) {
  const operation = plan.command?.operations.find(
    (operation) => operation.type === "update" && operation.id === target,
  );
  if (operation?.type !== "update") throw new Error("Missing update");
  return operation.patch;
}
describe("atomic canvas productivity planning", () => {
  it.each([30, 45, 90, -45])(
    "resizes one %s-degree object to the requested model dimensions without changing its position or rotation",
    (rotation) => {
      const rotated = object(1, {
        x: 120,
        y: 80,
        width: 240,
        height: 90,
        rotation,
        version: 7,
      });
      const initial = board([rotated]);
      const plan = planCanvasTransform(initial, [rotated.id], {
        type: "resize",
        bounds: { x: 120, y: 80, width: 280, height: 120 },
      });
      expect(plan.reason).toBeNull();
      expect(plan.command?.operations).toEqual([
        {
          type: "update",
          id: rotated.id,
          expectedVersion: 7,
          patch: { x: 120, y: 80, width: 280, height: 120 },
        },
      ]);
      expect({ ...rotated, ...patchOf(plan, rotated.id) }.rotation).toBe(rotation);
      expect(initial.objects).toEqual([rotated]);
    },
  );
  it("scales a rotated pen's world points using its model width and height", () => {
    const pen = object(1, {
      type: "pen",
      x: 50,
      y: 60,
      width: 120,
      height: 40,
      rotation: 45,
      points: [
        [50, 60],
        [110, 80],
        [170, 100],
      ],
    });
    const plan = planCanvasTransform(board([pen]), [pen.id], {
      type: "resize",
      bounds: { x: 50, y: 60, width: 240, height: 120 },
    });
    expect(patchOf(plan, pen.id)).toEqual({
      x: 50,
      y: 60,
      width: 240,
      height: 120,
      points: [
        [50, 60],
        [170, 120],
        [290, 180],
      ],
    });
  });
  it("resizes only the rotated frame border and leaves child world coordinates untouched", () => {
    const frame = object(1, {
      type: "frame",
      x: 100,
      y: 200,
      width: 300,
      height: 100,
      rotation: 90,
    });
    const child = object(2, { parentId: frame.id, x: 140, y: 220, width: 20, height: 20 });
    const initial = board([frame, child]);
    const plan = planCanvasTransform(initial, [frame.id], {
      type: "resize",
      bounds: { x: 100, y: 200, width: 600, height: 200 },
    });
    expect(plan.command?.operations).toEqual([
      {
        type: "update",
        id: frame.id,
        expectedVersion: frame.version,
        patch: { x: 100, y: 200, width: 600, height: 200 },
      },
    ]);
    expect(initial.objects[1]).toEqual(child);
  });
  it.each([
    { axis: "horizontal", x: 99_980, y: 100 },
    { axis: "vertical", x: 100, y: 99_980 },
  ])("rejects an out-of-bounds $axis copy without throwing", ({ x, y }) => {
    const edge = object(1, { x, y });
    const initial = board([edge]);
    expect(() => planCanvasDuplicate(initial, [edge.id])).not.toThrow();
    expect(planCanvasDuplicate(initial, [edge.id])).toEqual({
      command: null,
      reason: "bounds",
      selection: [],
    });
  });
  it.each([
    { axis: "horizontal", x: -99_990, y: 100 },
    { axis: "vertical", x: 100, y: -99_990 },
  ])("rejects an out-of-bounds $axis frame origin without throwing", ({ x, y }) => {
    const edge = object(1, { x, y });
    const initial = board([edge]);
    expect(() => planCanvasFrame(initial, [edge.id], "Boundary frame")).not.toThrow();
    expect(planCanvasFrame(initial, [edge.id], "Boundary frame")).toEqual({
      command: null,
      reason: "bounds",
      selection: [],
    });
  });
  it("rejects the whole mixed copy when only one selected object exceeds the coordinate limit", () => {
    const safe = object(1),
      edge = object(2, { x: 99_980 });
    const initial = board([safe, edge]);
    expect(planCanvasDuplicate(initial, [safe.id]).command?.operations).toHaveLength(1);
    expect(() => planCanvasDuplicate(initial, [safe.id, edge.id])).not.toThrow();
    expect(planCanvasDuplicate(initial, [safe.id, edge.id])).toEqual({
      command: null,
      reason: "bounds",
      selection: [],
    });
    expect(initial.objects).toEqual([safe, edge]);
  });
  it("rejects a pen copy whose translated points exceed the limit even when its copied origin fits", () => {
    const pen = object(1, {
      type: "pen",
      x: 99_950,
      y: 0,
      width: 49,
      height: 5,
      points: [
        [99_950, 0],
        [99_999, 5],
      ],
    });
    const initial = board([pen]);
    expect(() => planCanvasDuplicate(initial, [pen.id])).not.toThrow();
    expect(planCanvasDuplicate(initial, [pen.id])).toMatchObject({
      command: null,
      reason: "bounds",
    });
  });
  it("keeps neighbouring valid copy and frame operations available at the coordinate boundaries", () => {
    const high = object(1, { x: 99_972, y: 99_972, width: 1, height: 1 });
    expect(planCanvasDuplicate(board([high]), [high.id]).command?.operations).toEqual([
      { type: "create", object: expect.objectContaining({ x: 100_000, y: 100_000 }) },
    ]);
    const low = object(2, { x: -99_976, y: -99_960 });
    expect(planCanvasFrame(board([low]), [low.id], "Boundary frame").command?.operations).toEqual([
      {
        type: "create",
        object: expect.objectContaining({ x: -100_000, y: -100_000, type: "frame" }),
      },
      expect.objectContaining({ type: "update", id: low.id }),
    ]);
  });
  it("keeps the existing300 ordinary-object workshop quota while reserving guest idea slots", () => {
    const objects = Array.from({ length: 299 }, (_, index) => object(index + 1));
    const workshop = board(objects, { boardType: "workshop" });
    expect(canvasCreationFull(workshop)).toBe(false);
    expect(planCanvasDuplicate(workshop, [objects[0]!.id]).command).toBeTruthy();
    expect(planCanvasDuplicate(workshop, [objects[0]!.id, objects[1]!.id]).reason).toBe("objects");
    expect(canvasCreationFull(board([...objects, object(500)], { boardType: "workshop" }))).toBe(
      true,
    );
  });
  it("moves a frame, nested frame and pen once even when parent and descendant are both selected", () => {
    const frame = object(1, { type: "frame", x: 10, y: 20 }),
      nested = object(2, { type: "frame", parentId: frame.id, x: 40, y: 60 }),
      pen = object(3, {
        type: "pen",
        parentId: nested.id,
        x: 70,
        y: 80,
        points: [
          [70, 80],
          [90, 100],
        ],
        version: 8,
      });
    const initial = board([frame, nested, pen]);
    const plan = planCanvasTransform(initial, [frame.id, pen.id], { type: "move", dx: 15, dy: -5 });
    expect(plan.reason).toBeNull();
    expect(plan.command?.operations).toHaveLength(3);
    expect(
      new Set(
        plan.command?.operations.map((operation) =>
          operation.type === "create" ? operation.object.id : operation.id,
        ),
      ).size,
    ).toBe(3);
    expect(patchOf(plan, pen.id)).toMatchObject({
      x: 85,
      y: 75,
      points: [
        [85, 75],
        [105, 95],
      ],
    });
    expect(plan.command?.operations[2]).toMatchObject({ expectedVersion: 8 });
    expect(initial.objects[2]!.x).toBe(70);
  });
  it("resizes only a frame border and scales pen geometry consistently", () => {
    const frame = object(1, { type: "frame" }),
      child = object(2, { parentId: frame.id });
    const plan = planCanvasTransform(board([frame, child]), [frame.id], {
      type: "resize",
      bounds: { x: frame.x, y: frame.y, width: 500, height: 400 },
    });
    expect(plan.command?.operations).toHaveLength(1);
    expect(patchOf(plan, frame.id).width).toBe(500);
    const pen = object(3, {
      type: "pen",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      points: [
        [10, 20],
        [110, 70],
      ],
    });
    expect(resizeCanvasPatch(pen, { x: 30, y: 40, width: 200, height: 100 })).toMatchObject({
      points: [
        [30, 40],
        [230, 140],
      ],
    });
  });
  it("creates true same-parent geometric groups, and keeps grouping separate from frames", () => {
    const a = object(1),
      b = object(2);
    const initial = board([a, b]);
    const grouped = planCanvasGroup(initial, [a.id, b.id]);
    expect(grouped.command?.operations.every((operation) => operation.type === "update")).toBe(
      true,
    );
    const groupId = patchOf(grouped, a.id).geometricGroupId;
    expect(groupId).toBeTruthy();
    expect(patchOf(grouped, b.id).geometricGroupId).toBe(groupId);
    expect(patchOf(grouped, a.id)).not.toHaveProperty("parentId");
    const groupedBoard = board([
      object(1, { geometricGroupId: groupId }),
      object(2, { geometricGroupId: groupId }),
    ]);
    expect(planCanvasUngroup(groupedBoard, [a.id]).command?.operations).toHaveLength(2);
    expect(canvasSelectionClosure(groupedBoard.objects, [a.id])).toHaveLength(2);
    const frame = object(4, { type: "frame" });
    expect(
      planCanvasGroup(board([a, object(2, { parentId: frame.id }), frame]), [a.id, b.id]).reason,
    ).toBe("parent");
    const framed = planCanvasFrame(initial, [a.id, b.id], "Planning frame");
    expect(framed.command?.operations[0]).toMatchObject({
      type: "create",
      object: { type: "frame", text: "Planning frame", visibility: "team" },
    });
  });
  it("duplicates frame hierarchies and remaps group and connector identities without joining the originals", () => {
    const frame = object(1, { type: "frame" }),
      groupId = id(88),
      a = object(2, { parentId: frame.id, geometricGroupId: groupId }),
      b = object(3, { parentId: frame.id, geometricGroupId: groupId });
    const line = object(4, {
      type: "connector",
      parentId: frame.id,
      from: { objectId: a.id, x: 0, y: 0 },
      to: { objectId: b.id, x: 20, y: 30 },
    });
    const plan = planCanvasDuplicate(board([frame, a, b, line]), [frame.id]);
    const copies = plan.command!.operations.map((operation) => {
      if (operation.type !== "create") throw new Error("Expected create");
      return operation.object;
    });
    expect(copies).toHaveLength(4);
    expect(copies[1]!.parentId).toBe(copies[0]!.id);
    expect(copies[1]!.geometricGroupId).not.toBe(groupId);
    expect(copies[2]!.geometricGroupId).toBe(copies[1]!.geometricGroupId);
    expect(copies[3]).toMatchObject({
      type: "connector",
      from: { objectId: copies[1]!.id },
      to: { objectId: copies[2]!.id },
    });
  });
  it("enforces locks, publication and protected references before any mutation and allows lock-only unlock", () => {
    const frame = object(1, { type: "frame", locked: true }),
      child = object(2, { parentId: frame.id, locked: true });
    expect(
      planCanvasTransform(board([frame, child]), [frame.id], { type: "move", dx: 10, dy: 0 })
        .reason,
    ).toBe("locked");
    expect(planCanvasLock(board([frame, child]), [frame.id], false).command?.operations).toEqual([
      { type: "update", id: frame.id, expectedVersion: frame.version, patch: { locked: false } },
    ]);
    expect(planCanvasLock(board([frame, child]), [child.id], false).reason).toBe("locked");
    const published = object(3, { visibility: "published" });
    const workshop = board([published], {
      boardType: "workshop",
      capabilities: { ...canvasBoard.capabilities, facilitate: false },
    });
    expect(planCanvasLock(workshop, [published.id], true).reason).toBe("protected");
    const ref = object(4, { type: "idea_ref", text: "", ideaId: id(90) });
    expect(planCanvasDelete(board([ref]), [ref.id]).reason).toBe("protected");
    expect(planCanvasDuplicate(board([ref]), [ref.id]).reason).toBe("protected");
    expect(
      planCanvasLock(board([ref], { boardType: "workshop" }), [ref.id], true).command,
    ).toBeTruthy();
  });
  it("counts the full atomic closure and connector cleanup against50 without sending partial commands", () => {
    const frame = object(1, { type: "frame" }),
      children = Array.from({ length: 50 }, (_, index) =>
        object(index + 2, { parentId: frame.id }),
      );
    const initial = board([frame, ...children]);
    expect(planCanvasTransform(initial, [frame.id], { type: "move", dx: 1, dy: 1 })).toMatchObject({
      command: null,
      reason: "limit",
    });
    expect(planCanvasDuplicate(initial, [frame.id])).toMatchObject({
      command: null,
      reason: "limit",
    });
    const oneLess = board([frame, ...children.slice(0, 49)]);
    expect(planCanvasDelete(oneLess, [frame.id]).command?.operations).toHaveLength(50);
    const line = object(70, {
      type: "connector",
      from: { objectId: children[0]!.id, x: 0, y: 0 },
      to: { objectId: null, x: 10, y: 10 },
    });
    expect(planCanvasDelete(board([...oneLess.objects, line]), [frame.id])).toMatchObject({
      command: null,
      reason: "limit",
    });
  });
  it("aligns/distributes units atomically and moves group peers together", () => {
    const groupId = id(80),
      a = object(1, { x: 0, width: 50, geometricGroupId: groupId }),
      b = object(2, { x: 70, width: 50, geometricGroupId: groupId }),
      c = object(3, { x: 400, width: 50 });
    const plan = planCanvasArrange(board([a, b, c]), [a.id, c.id], "left");
    expect(plan.command?.operations).toHaveLength(3);
    expect(patchOf(plan, a.id).x).toBe(0);
    expect(patchOf(plan, b.id).x).toBe(70);
    expect(patchOf(plan, c.id).x).toBe(0);
    const d = object(4, { x: 200, width: 50, geometricGroupId: null });
    const distributed = planCanvasArrange(
      board([object(1, { x: 0, width: 50 }), d, object(3, { x: 500, width: 50 })]),
      [a.id, d.id, c.id],
      "horizontal",
    );
    expect(patchOf(distributed, d.id).x).toBe(250);
  });
  it("reparents complete groups and rejects parent cycles", () => {
    const frame = object(1, { type: "frame" }),
      groupId = id(99),
      a = object(2, { geometricGroupId: groupId }),
      b = object(3, { geometricGroupId: groupId });
    expect(
      planCanvasReparent(board([frame, a, b]), [a.id], frame.id).command?.operations,
    ).toHaveLength(2);
    expect(
      planCanvasReparent(
        board([frame, object(4, { type: "frame", parentId: frame.id })]),
        [frame.id],
        id(4),
      ).reason,
    ).toBe("parent");
  });
  it("resamples long freehand strokes while preserving both endpoints and full bounds", () => {
    const points = Array.from(
      { length: 900 },
      (_, index) => [index, Math.sin(index)] as [number, number],
    );
    points[301] = [1200, -700];
    points[405] = [-250, 800];
    const sampled = sampleCanvasStroke(points);
    expect(sampled).toHaveLength(128);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled.at(-1)).toEqual(points.at(-1));
    expect(sampled).toContainEqual(points[301]);
    expect(sampled).toContainEqual(points[405]);
    expect(newCanvasPen(points)).toMatchObject({
      type: "pen",
      x: -250,
      y: -700,
      width: 1450,
      height: 1500,
    });
  });
});
