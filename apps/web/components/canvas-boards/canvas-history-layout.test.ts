import { describe, expect, it } from "vitest";
import { CanvasObjectSchema, type CanvasObject } from "@openround/contracts";
import { canvasBoard, canvasObject } from "./canvas-test-fixtures";
import { planCanvasHistoryLayout } from "./canvas-history-layout";
function object(index: number, patch: Record<string, unknown> = {}) {
  return CanvasObjectSchema.parse({
    ...canvasObject,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    ...patch,
  });
}
function plan(current: CanvasObject[], saved: CanvasObject[]) {
  return planCanvasHistoryLayout({ ...canvasBoard, objects: current }, saved);
}
describe("saved layout restoration", () => {
  it("updates current versions and geometry while preserving current text, visibility and media identity", () => {
    const current = object(1, {
      x: 200,
      y: 100,
      version: 9,
      text: "Current content",
      visibility: "published",
    });
    const saved = object(1, {
      x: 20,
      y: 40,
      width: 120,
      height: 80,
      rotation: 45,
      text: "Old content",
      visibility: "team",
    });
    const result = plan([current], [saved]);
    expect(result.command?.operations).toEqual([
      {
        type: "update",
        id: current.id,
        expectedVersion: 9,
        patch: {
          x: 20,
          y: 40,
          width: 120,
          height: 80,
          rotation: 45,
          zIndex: 0,
          parentId: null,
          geometricGroupId: null,
        },
      },
    ]);
  });
  it("never recreates deleted objects or guest ideas, and flattens a missing historical parent", () => {
    const current = object(1, { x: 100 });
    const missing = object(9, { type: "idea_ref", ideaId: object(8).id, text: "" });
    const result = plan([current], [object(1, { x: 20, parentId: object(7).id }), missing]);
    expect(result.command?.operations).toHaveLength(1);
    expect(result.command?.operations[0]).toMatchObject({
      type: "update",
      id: current.id,
      patch: { parentId: null },
    });
    expect(plan([], [missing]).reason).toBe("empty");
  });
  it("permits child-only layout changes and coherent frame translations, but rejects diverged descendants atomically", () => {
    const frame = object(1, { type: "frame", x: 100, y: 100 });
    const child = object(2, { parentId: frame.id, x: 120, y: 130 });
    const savedFrame = object(1, { ...frame, x: 50, y: 50 });
    const savedChild = object(2, { ...child, x: 70, y: 80 });
    expect(plan([frame, child], [savedFrame, savedChild]).command?.operations).toHaveLength(2);
    expect(
      plan([frame, child], [object(2, { ...child, x: 140 })]).command?.operations,
    ).toHaveLength(1);
    expect(plan([frame, child], [savedFrame, object(2, { ...savedChild, x: 80 })])).toMatchObject({
      command: null,
      reason: "bounds",
    });
  });
  it("rejects diverged group translations and preserves locked/protected permissions", () => {
    const group = object(90).id;
    const a = object(1, { geometricGroupId: group, x: 100 });
    const b = object(2, { geometricGroupId: group, x: 200 });
    expect(plan([a, b], [object(1, { ...a, x: 50 }), object(2, { ...b, x: 140 })]).reason).toBe(
      "bounds",
    );
    expect(plan([{ ...a, locked: true }], [object(1, { ...a, x: 20 })]).reason).toBe("locked");
    const published = object(3, { visibility: "published" });
    expect(
      planCanvasHistoryLayout(
        {
          ...canvasBoard,
          boardType: "workshop",
          capabilities: { ...canvasBoard.capabilities, facilitate: false },
          objects: [published],
        },
        [object(3, { ...published, x: 0 })],
      ).reason,
    ).toBe("protected");
  });
  it("does not require moving a protected sibling to restore an ordinary child's layout", () => {
    const frame = object(1, { type: "frame" });
    const child = object(2, { parentId: frame.id, x: 100 });
    const idea = object(3, {
      parentId: frame.id,
      type: "idea_ref",
      text: "",
      ideaId: object(99).id,
    });
    const result = planCanvasHistoryLayout(
      {
        ...canvasBoard,
        boardType: "workshop",
        capabilities: { ...canvasBoard.capabilities, facilitate: false },
        objects: [frame, child, idea],
      },
      [object(2, { ...child, x: 50 })],
    );
    expect(result.command?.operations).toHaveLength(1);
    expect(result.command?.operations[0]).toMatchObject({
      type: "update",
      id: child.id,
      patch: { x: 50 },
    });
  });
  it("rescales current pen points and connector geometry without restoring historical attachments", () => {
    const pen = object(1, {
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
    const connector = object(2, {
      type: "connector",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      from: { objectId: null, x: 10, y: 20 },
      to: { objectId: null, x: 110, y: 70 },
    });
    const result = plan(
      [pen, connector],
      [
        object(1, { ...pen, width: 200, height: 100 }),
        object(2, {
          ...connector,
          width: 200,
          height: 100,
          from: { objectId: object(99).id, x: 50, y: 50 },
        }),
      ],
    );
    expect(result.command?.operations[0]).toMatchObject({
      patch: {
        points: [
          [10, 20],
          [210, 120],
        ],
      },
    });
    expect(result.command?.operations[1]).toMatchObject({
      patch: { from: { objectId: null, x: 10, y: 20 }, to: { objectId: null, x: 210, y: 120 } },
    });
  });
  it("rejects over50 updates and cycles formed by current and historical parent relationships", () => {
    const current = Array.from({ length: 51 }, (_, index) => object(index + 1));
    expect(
      plan(
        current,
        current.map((entry) => object(1, { ...entry, x: 0 })),
      ),
    ).toMatchObject({ command: null, reason: "limit" });
    const parent = object(1, { type: "frame" });
    const nested = object(2, { type: "frame", parentId: parent.id });
    expect(plan([parent, nested], [object(1, { ...parent, parentId: nested.id })])).toMatchObject({
      command: null,
      reason: "parent",
    });
  });
});
