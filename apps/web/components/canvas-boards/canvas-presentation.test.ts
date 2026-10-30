import { describe, expect, it } from "vitest";
import { canvasVisibleRegion, followCanvasRegion } from "./canvas-presentation";
import { MAX_ZOOM, MIN_ZOOM } from "./canvas-geometry";

describe("presenter world-region geometry", () => {
  it("converts the visible viewport to exact world coordinates, including fractional pan and zoom", () => {
    expect(canvasVisibleRegion({ x: -120, y: 80, zoom: 2 }, 800, 600)).toEqual({
      x: 60,
      y: -40,
      width: 400,
      height: 300,
    });
    expect(canvasVisibleRegion({ x: 15.5, y: -7.25, zoom: 0.5 }, 390, 844)).toEqual({
      x: -31,
      y: 14.5,
      width: 780,
      height: 1688,
    });
  });
  it("fits the shared region in the follower's own aspect ratio and keeps its world centre", () => {
    const region = { x: -100, y: 50, width: 400, height: 200 };
    const viewport = followCanvasRegion(region, 320, 600)!;
    expect(viewport).toEqual({ zoom: 0.8, x: 80, y: 180 });
    expect((160 - viewport.x) / viewport.zoom).toBe(region.x + region.width / 2);
    expect((300 - viewport.y) / viewport.zoom).toBe(region.y + region.height / 2);
  });
  it("clamps supported zoom while preserving the world centre, and rejects invalid regions", () => {
    expect(followCanvasRegion({ x: 10, y: 20, width: 1, height: 1 }, 800, 600)?.zoom).toBe(
      MAX_ZOOM,
    );
    expect(
      followCanvasRegion({ x: -10000, y: -10000, width: 100000, height: 100000 }, 320, 600)?.zoom,
    ).toBe(MIN_ZOOM);
    expect(followCanvasRegion({ x: 0, y: 0, width: -1, height: 10 }, 320, 600)).toBeNull();
    expect(followCanvasRegion({ x: 0, y: 0, width: 10, height: 10 }, 0, 600)).toBeNull();
    expect(canvasVisibleRegion({ x: 0, y: 0, zoom: 0 }, 320, 600)).toBeNull();
    expect(canvasVisibleRegion({ x: 0, y: 0, zoom: 1 }, 0, 600)).toBeNull();
    expect(canvasVisibleRegion({ x: Number.NaN, y: 0, zoom: 1 }, 320, 600)).toBeNull();
    expect(canvasVisibleRegion({ x: -100001, y: 0, zoom: 1 }, 320, 600)).toBeNull();
  });
});
