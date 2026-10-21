import { describe, expect, it } from "vitest";
import { IdeaBoardSketchSchema, type IdeaBoardSketchElement } from "@openround/contracts";
import {
  emptySketch,
  moveSketchElement,
  newSketchElement,
  sketchElementBounds,
  sketchHistory,
  sketchHistoryReducer,
  sketchPoint,
  updateDrawnElement,
} from "./sketch-model";

const id = "00000000-0000-4000-8000-000000000001";

describe("idea drawing geometry and history", () => {
  it("keeps reversed pointer boxes and canvas-edge clicks inside the drawing", () => {
    const rectangle = newSketchElement("rect", id, "Text");
    const reversed = updateDrawnElement(rectangle, [900, 550], [100, 50]);
    expect(reversed).toMatchObject({ x: 100, y: 50, width: 800, height: 500 });
    const edge = updateDrawnElement(rectangle, [1000, 600], [1000, 600]);
    expect(() => IdeaBoardSketchSchema.parse({ ...emptySketch(), elements: [edge] })).not.toThrow();
    expect(sketchPoint(-10.8, 1200)).toEqual([0, 600]);
  });

  it.each(["rect", "ellipse", "arrow", "line", "freehand", "text"] as const)(
    "translates a %s as a whole without losing valid coordinates",
    (tool) => {
      const element = newSketchElement(tool, id, "Text");
      const moved = moveSketchElement(element, -10_000, 10_000);
      expect(() =>
        IdeaBoardSketchSchema.parse({ ...emptySketch(), elements: [moved] }),
      ).not.toThrow();
      const bounds = sketchElementBounds(moved);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(601);
      if (element.type === "freehand" && moved.type === "freehand") {
        expect(moved.points[1]![0] - moved.points[0]![0]).toBe(
          element.points[1]![0] - element.points[0]![0],
        );
      }
    },
  );

  it("caps pen samples and allows undo/redo of a complete gesture", () => {
    let stroke = newSketchElement("freehand", id, "Text");
    for (let point = 0; point < 500; point++)
      stroke = updateDrawnElement(stroke, [120, 120], [point, point], 12);
    const samples = (stroke as Extract<IdeaBoardSketchElement, { type: "freehand" }>).points;
    expect(samples.length).toBeLessThanOrEqual(12);
    expect(samples.at(-1)).toEqual([499, 499]);
    const initial = sketchHistory(emptySketch());
    const committed = sketchHistoryReducer(initial, {
      type: "commit",
      sketch: { ...emptySketch(), elements: [stroke] },
    });
    const undone = sketchHistoryReducer(committed, { type: "undo" });
    expect(undone.present.elements).toHaveLength(0);
    expect(sketchHistoryReducer(undone, { type: "redo" }).present.elements).toEqual([stroke]);
    const changed = sketchHistoryReducer(undone, {
      type: "commit",
      sketch: { ...emptySketch(), elements: [newSketchElement("arrow", id, "Text")] },
    });
    expect(changed.future).toHaveLength(0);
  });
});
