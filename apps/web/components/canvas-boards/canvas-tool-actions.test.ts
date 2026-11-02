import { describe, expect, it } from "vitest";
import { CanvasObjectSchema } from "@openround/contracts";
import { canvasBoard, canvasObject } from "./canvas-test-fixtures";
import {
  planCanvasQuickStyle,
  planCanvasStickyStack,
  planCanvasTemplateInsert,
  planCanvasEraseStrokes,
} from "./canvas-tool-actions";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
function allocator() {
  let value = 1000;
  return () => id(++value);
}
describe("canvas tool action boundaries", () => {
  it("uses selected versions, preserves IDs during conversion and maps connector colors to their visible line", () => {
    const styled = planCanvasQuickStyle(canvasBoard, [canvasObject.id], {
      fontWeight: "bold",
      fontSize: 24,
      textAlign: "center",
    });
    expect(styled.command?.operations).toEqual([
      {
        type: "update",
        id: canvasObject.id,
        expectedVersion: canvasObject.version,
        patch: { fontWeight: "bold", fontSize: 24, textAlign: "center" },
      },
    ]);
    expect(
      planCanvasQuickStyle(canvasBoard, [canvasObject.id], { type: "rect" }).command?.operations[0],
    ).toMatchObject({ id: canvasObject.id, patch: { type: "rect", shapeVariant: "rectangle" } });
    const line = CanvasObjectSchema.parse({
      ...canvasObject,
      id: id(99),
      type: "connector",
      from: { objectId: null, x: 0, y: 0 },
      to: { objectId: null, x: 300, y: 100 },
    });
    const board = { ...canvasBoard, objects: [canvasObject, line] };
    expect(
      planCanvasQuickStyle(board, [canvasObject.id, line.id], { color: "teal" }).command
        ?.operations,
    ).toMatchObject([{ patch: { color: "teal" } }, { patch: { lineColor: "teal" } }]);
    expect(canvasObject.fontWeight).toBe("normal");
  });
  it("rejects protected, locked, oversized and read-only style mutations", () => {
    const locked = { ...canvasObject, locked: true };
    expect(
      planCanvasQuickStyle({ ...canvasBoard, objects: [locked] }, [locked.id], { fontSize: 24 })
        .command,
    ).toBeNull();
    expect(
      planCanvasQuickStyle(
        { ...canvasBoard, capabilities: { ...canvasBoard.capabilities, edit: false } },
        [canvasObject.id],
        { fontSize: 24 },
      ).reason,
    ).toBe("permission");
    const protectedIdea = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "idea_ref",
      ideaId: id(98),
      text: "",
    });
    expect(
      planCanvasQuickStyle({ ...canvasBoard, objects: [protectedIdea] }, [protectedIdea.id], {
        fontWeight: "bold",
      }).reason,
    ).toBe("protected");
    const image = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "image",
      mediaId: id(97),
      altText: "Synthetic image",
    });
    expect(
      planCanvasQuickStyle({ ...canvasBoard, objects: [image] }, [image.id], { type: "text" })
        .command,
    ).toBeNull();
    const objects = Array.from({ length: 51 }, (_, index) => ({
      ...canvasObject,
      id: id(index + 200),
    }));
    expect(
      planCanvasQuickStyle(
        { ...canvasBoard, objects },
        objects.map((object) => object.id),
        { fontSize: 24 },
      ).reason,
    ).toBe("limit");
  });
  it("creates bounded private stacks atomically and honors both total and workshop capacity", () => {
    const plan = planCanvasStickyStack(canvasBoard, { x: 500, y: 500 }, 4, "orange", allocator());
    expect(plan.command?.operations).toHaveLength(4);
    for (const operation of plan.command!.operations)
      expect(operation).toMatchObject({
        type: "create",
        object: { type: "sticky", color: "orange", visibility: "team" },
      });
    expect(new Set(plan.selection).size).toBe(4);
    expect(planCanvasStickyStack(canvasBoard, { x: 0, y: 0 }, 21, "yellow").reason).toBe("limit");
    const objects = Array.from({ length: 499 }, (_, index) => ({
      ...canvasObject,
      id: id(index + 200),
    }));
    expect(
      planCanvasStickyStack({ ...canvasBoard, objects }, { x: 0, y: 0 }, 2, "yellow").reason,
    ).toBe("objects");
    expect(
      planCanvasStickyStack(
        { ...canvasBoard, boardType: "workshop", objects: objects.slice(0, 299) },
        { x: 0, y: 0 },
        2,
        "yellow",
      ).reason,
    ).toBe("objects");
  });
  it("inserts a complete team-visible template with local IDs and translated connector endpoints", () => {
    const before = JSON.stringify(canvasBoard);
    const plan = planCanvasTemplateInsert(
      canvasBoard,
      { x: 1600, y: 800 },
      "flow-to-action",
      allocator(),
    );
    expect(plan.command).not.toBeNull();
    const objects = plan.command!.operations.flatMap((operation) =>
      operation.type === "create" ? [operation.object] : [],
    );
    const ids = new Set(objects.map((object) => object.id));
    expect(ids.size).toBe(objects.length);
    expect(objects.every((object) => object.visibility === "team")).toBe(true);
    for (const object of objects) {
      expect(object.x).toBeGreaterThanOrEqual(1600);
      expect(object.y).toBeGreaterThanOrEqual(800);
      if (object.parentId) expect(ids.has(object.parentId)).toBe(true);
      if (object.type === "connector") {
        if (object.from.objectId) expect(ids.has(object.from.objectId)).toBe(true);
        expect(object.from.x).toBeGreaterThanOrEqual(1600);
        expect(object.to.y).toBeGreaterThanOrEqual(800);
      }
    }
    expect(JSON.stringify(canvasBoard)).toBe(before);
  });
  it("erases only hit strokes using frozen versions without cascading into other objects", () => {
    const pen = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "pen",
      id: id(100),
      points: [
        [0, 0],
        [100, 100],
      ],
    });
    if (pen.type !== "pen") throw new Error("Expected a pen fixture");
    const board = { ...canvasBoard, objects: [canvasObject, { ...pen, version: 9 }] };
    expect(planCanvasEraseStrokes(board, [pen]).command?.operations).toEqual([
      { type: "delete", id: pen.id, expectedVersion: pen.version },
    ]);
    const connector = CanvasObjectSchema.parse({
      ...canvasObject,
      id: id(101),
      type: "connector",
      from: { objectId: pen.id, x: 0, y: 0 },
      to: { objectId: canvasObject.id, x: 30, y: 30 },
    });
    expect(
      planCanvasEraseStrokes({ ...board, objects: [...board.objects, connector] }, [pen]).command,
    ).toBeNull();
    const group = id(102),
      grouped = { ...pen, geometricGroupId: group };
    expect(
      planCanvasEraseStrokes(
        { ...board, objects: [grouped, { ...canvasObject, geometricGroupId: group }] },
        [grouped],
      ).command,
    ).toBeNull();
    expect(
      planCanvasEraseStrokes({ ...board, objects: [{ ...pen, locked: true }] }, [
        { ...pen, locked: true },
      ]).command,
    ).toBeNull();
  });
});
