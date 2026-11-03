import { describe, expect, it } from "vitest";
import {
  connectorPoint,
  fitViewport,
  revealCanvasBounds,
  MIN_PREVIEW_ZOOM,
  worldPoint,
  zoomAt,
} from "./canvas-geometry";

describe("canvas navigation geometry", () => {
  it("reveals an offscreen fractional insertion without changing its world coordinates or unnecessary zoom", () => {
    const bounds = { x: -433, y: 57.5, width: 320, height: 220 };
    const original = { ...bounds };
    const view = revealCanvasBounds({ x: 80, y: 80, zoom: 1 }, bounds, 610, 650);
    expect(view.zoom).toBe(1);
    expect(bounds.x * view.zoom + view.x).toBeGreaterThanOrEqual(32);
    expect((bounds.x + bounds.width) * view.zoom + view.x).toBeLessThanOrEqual(578);
    expect(bounds).toEqual(original);
  });
  it("reduces zoom only when an inserted object cannot fit the available canvas", () => {
    const view = revealCanvasBounds(
      { x: 80, y: 80, zoom: 2 },
      { x: 500.25, y: 700.75, width: 640, height: 400 },
      500,
      600,
    );
    expect(view.zoom).toBeLessThan(2);
    expect(500.25 * view.zoom + view.x).toBeCloseTo(32);
    expect((500.25 + 640) * view.zoom + view.x).toBeCloseTo(468);
  });
  it("keeps the same world position under a zoom focal point", () => {
    const viewport = { x: 50, y: -20, zoom: 0.5 };
    const pointer = { x: 350, y: 220 };
    const before = worldPoint(pointer, viewport);
    expect(worldPoint(pointer, zoomAt(viewport, pointer, 2))).toEqual(before);
  });
  it("supports preview zoom below 15% while keeping the focal point and default editor limits", () => {
    const viewport = { x: 200, y: -30, zoom: 0.04 };
    const pointer = { x: 350, y: 220 };
    const next = zoomAt(viewport, pointer, 0.03, MIN_PREVIEW_ZOOM);
    expect(next.zoom).toBe(0.03);
    expect(worldPoint(pointer, next)).toEqual(worldPoint(pointer, viewport));
    expect(zoomAt(viewport, pointer, 0, MIN_PREVIEW_ZOOM).zoom).toBe(MIN_PREVIEW_ZOOM);
    expect(zoomAt(viewport, pointer, 0.03).zoom).toBe(0.15);
    expect(zoomAt(viewport, pointer, 4, MIN_PREVIEW_ZOOM).zoom).toBe(3);
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
