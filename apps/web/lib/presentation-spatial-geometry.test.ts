import { describe, expect, it } from "vitest";
import {
  fitPresentationSpatialFrames,
  presentationSpatialBounds,
  presentationSpatialWorldPoint,
  zoomPresentationSpatialAt,
} from "./presentation-spatial-geometry";

describe("presentation spatial viewport geometry", () => {
  it("fits all 200 bounded frames on a phone without the Canvas editor zoom floor", () => {
    const frames = Array.from({ length: 200 }, (_, index) => ({
      x: (index % 12) * 1600,
      y: Math.floor(index / 12) * 960,
      width: 1280,
      height: 720,
    }));
    const viewport = fitPresentationSpatialFrames(frames, 320, 150);
    expect(viewport.zoom).toBeLessThan(0.15);
    for (const frame of frames) {
      expect(frame.x * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(31.999);
      expect(frame.y * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(31.999);
      expect((frame.x + frame.width) * viewport.zoom + viewport.x).toBeLessThanOrEqual(288.001);
      expect((frame.y + frame.height) * viewport.zoom + viewport.y).toBeLessThanOrEqual(118.001);
    }
  });

  it("fits an offset current frame and updates the camera when its viewport changes", () => {
    const frame = { x: 18_000, y: 17_000, width: 1280, height: 720 };
    const wide = fitPresentationSpatialFrames([frame], 800, 240);
    const narrow = fitPresentationSpatialFrames([frame], 320, 150);
    expect(wide.zoom).toBeGreaterThan(narrow.zoom);
    for (const [viewport, width, height] of [
      [wide, 800, 240],
      [narrow, 320, 150],
    ] as const) {
      expect((frame.x + frame.width / 2) * viewport.zoom + viewport.x).toBeCloseTo(width / 2);
      expect((frame.y + frame.height / 2) * viewport.zoom + viewport.y).toBeCloseTo(height / 2);
    }
  });

  it("preserves Canvas's maximum fit zoom and handles tiny or unmounted previews", () => {
    expect(fitPresentationSpatialFrames([], 800, 240)).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(fitPresentationSpatialFrames([{ x: 0, y: 0, width: 320, height: 180 }], 0, 0)).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
    expect(
      fitPresentationSpatialFrames([{ x: 0, y: 0, width: 320, height: 180 }], 3000, 2000).zoom,
    ).toBe(1.5);
    expect(
      fitPresentationSpatialFrames([{ x: 0, y: 0, width: 320, height: 180 }], 20, 10).zoom,
    ).toBeGreaterThan(0);
  });

  it("unions complete rectangles rather than just frame origins", () => {
    expect(presentationSpatialBounds([])).toBeNull();
    expect(
      presentationSpatialBounds([
        { x: 100, y: 20, width: 320, height: 180 },
        { x: 10, y: 90, width: 640, height: 360 },
      ]),
    ).toEqual({ x: 10, y: 20, width: 640, height: 430 });
  });

  it("keeps the pointer's world point stable during bounded authoring zoom", () => {
    const viewport = { x: -100, y: 30, zoom: 0.01 };
    const point = { x: 180, y: 90 };
    const world = presentationSpatialWorldPoint(point, viewport);
    for (const requested of [0.00001, 0.02, 100]) {
      const next = zoomPresentationSpatialAt(viewport, point, requested);
      expect(next.zoom).toBeGreaterThanOrEqual(0.001);
      expect(next.zoom).toBeLessThanOrEqual(4);
      expect(presentationSpatialWorldPoint(point, next)).toEqual(world);
    }
  });
});
