import { describe, expect, it } from "vitest";
import {
  canvasConnectorGeometry,
  canvasConnectorLabel,
  canvasDiagramPort,
  canvasDiagramShapePath,
} from "../src/canvas-diagram-geometry";
describe("shared manual diagram geometry", () => {
  it("places polygon ports on the real edge and rotates them about the model centre", () => {
    const node = {
      id: "node",
      type: "parallelogram",
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      rotation: 0,
    };
    const endpoint = { objectId: "node", x: -1, y: -1, anchor: "left" as const };
    expect(canvasDiagramPort(endpoint, [node])).toEqual({ x: 30, y: 70 });
    const rotated = canvasDiagramPort(endpoint, [{ ...node, rotation: 90 }]);
    expect(rotated.x).toBeCloseTo(110);
    expect(rotated.y).toBeCloseTo(-10);
    expect(canvasDiagramPort({ ...endpoint, anchor: "center" }, [node])).toEqual({ x: 110, y: 70 });
    expect(canvasDiagramPort(endpoint, [])).toEqual({ x: -1, y: -1 });
  });
  it("keeps old straight arrows and computes elbow labels at half the travelled path", () => {
    const connector = {
      from: { objectId: null, x: 0, y: 0 },
      to: { objectId: null, x: 120, y: 60 },
      text: "Yes",
    };
    expect(canvasConnectorGeometry(connector, []).path).toBe("M0 0 L120 60");
    const elbow = canvasConnectorGeometry({ ...connector, routing: "elbow" }, []);
    expect(elbow.points).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 60 },
      { x: 120, y: 60 },
    ]);
    expect(elbow.label).toEqual({ x: 60, y: 30 });
    const box = canvasConnectorLabel(connector.text, elbow.label)!;
    expect(box.x).toBeGreaterThanOrEqual(elbow.bounds.x);
    expect(box.y + box.height).toBeLessThanOrEqual(elbow.bounds.y + elbow.bounds.height);
    const zero = canvasConnectorGeometry(
      {
        from: { objectId: null, x: -0.5, y: 1.25 },
        to: { objectId: null, x: -0.5, y: 1.25 },
        routing: "elbow",
      },
      [],
    );
    expect(zero.label).toEqual({ x: -0.5, y: 1.25 });
    expect(Object.values(zero.bounds).every(Number.isFinite)).toBe(true);
  });
  it("bounds long multiline CJK labels and generates only original MLZ shape paths", () => {
    const label = canvasConnectorLabel("漢".repeat(500), { x: 0, y: 0 })!;
    expect(label.lines).toHaveLength(4);
    expect(label.lines.at(-1)).toMatch(/…$/);
    expect(label.width).toBeLessThanOrEqual(252);
    expect(label.height).toBe(84);
    expect(canvasConnectorLabel("  ", { x: 0, y: 0 })).toBeNull();
    expect(canvasDiagramShapePath("diamond", 200, 100)).toBe("M100 0 L200 50 L100 100 L0 50 Z");
    expect(canvasDiagramShapePath("parallelogram", 200, 100)).toBe(
      "M40 0 L200 0 L160 100 L0 100 Z",
    );
  });
});
