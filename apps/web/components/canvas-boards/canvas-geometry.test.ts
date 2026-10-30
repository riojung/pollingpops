import { describe, expect, it } from "vitest";
import { connectorPoint, fitViewport, worldPoint, zoomAt } from "./canvas-geometry";

describe("canvas navigation geometry", () => {
  it("keeps the same world position under a zoom focal point", () => {
    const viewport = { x: 50, y: -20, zoom: 0.5 };
    const pointer = { x: 350, y: 220 };
    const before = worldPoint(pointer, viewport);
    expect(worldPoint(pointer, zoomAt(viewport, pointer, 2))).toEqual(before);
  });
  it("fits negative and positive coordinates into a bounded viewport", () => {
    const items = [
      { x: -300, y: -200, width: 200, height: 200 },
      { x: 500, y: 300, width: 200, height: 100 },
    ];
    const view = fitViewport(items, 1000, 700);
    for (const item of items) {
      expect(item.x * view.zoom + view.x).toBeGreaterThanOrEqual(40);
      expect((item.x + item.width) * view.zoom + view.x).toBeLessThanOrEqual(960);
    }
  });
  it("keeps connector anchors attached as a target moves, with a safe unanchored fallback", () => {
    const anchor = { objectId: "note", x: 10, y: 20 };
    expect(
      connectorPoint(anchor, [{ id: "note", x: 100, y: 200, width: 200, height: 100 }]),
    ).toEqual({ x: 200, y: 250 });
    expect(connectorPoint(anchor, [])).toEqual({ x: 10, y: 20 });
  });
});
