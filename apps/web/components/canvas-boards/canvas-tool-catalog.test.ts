import { describe, expect, it } from "vitest";
import { canvasToolCopy } from "../../lib/i18n/canvas-tool-messages";
import {
  boundedStickyStackCount,
  canvasShapeCatalog,
  canvasToolColors,
  filterCanvasShapes,
} from "./canvas-tool-catalog";

describe("canvas palette catalog", () => {
  it("searches localized labels and stable names within meaningful categories", () => {
    const french = canvasToolCopy("fr-FR");
    expect(filterCanvasShapes("  ÉTOILE  ", "all", french).map((entry) => entry.id)).toEqual([
      "star",
    ]);
    expect(filterCanvasShapes("rounded rectangle", "all", french).map((entry) => entry.id)).toEqual(
      ["rounded_rectangle"],
    );
    expect(filterCanvasShapes("triangle", "connectors", french)).toEqual([]);
    expect(new Set(canvasShapeCatalog.map((entry) => entry.category))).toEqual(
      new Set(["basics", "flowchart", "connectors"]),
    );
  });
  it("maps every preview to a usable creation type or connector preset", () => {
    expect(new Set(canvasShapeCatalog.map((entry) => entry.id)).size).toBe(
      canvasShapeCatalog.length,
    );
    expect(
      new Set(
        canvasShapeCatalog.flatMap((entry) => (entry.shapeVariant ? [entry.shapeVariant] : [])),
      ).size,
    ).toBe(17);
    expect(canvasShapeCatalog.flatMap((entry) => (entry.preset ? [entry.preset] : []))).toEqual([
      "line",
      "arrow",
      "elbow",
    ]);
    for (const entry of canvasShapeCatalog) {
      expect(entry.type || entry.preset).toBeTruthy();
      expect(entry.path).toMatch(/^[Mm]/);
      expect(entry.path).not.toMatch(/https?:|<|>|script/i);
    }
    expect(new Set(canvasToolColors).size).toBe(16);
  });
  it("bounds atomic sticky stacks by both the batch and remaining board capacity", () => {
    expect(boundedStickyStackCount(200)).toBe(20);
    expect(boundedStickyStackCount(8.9, 3)).toBe(3);
    expect(boundedStickyStackCount(Number.NaN)).toBe(1);
    expect(boundedStickyStackCount(-4)).toBe(1);
  });
});
