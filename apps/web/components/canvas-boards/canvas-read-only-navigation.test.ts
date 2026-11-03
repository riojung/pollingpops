import { describe, expect, it } from "vitest";
import { readOnlyKeyViewport } from "./canvas-read-only-navigation";
import { MIN_PREVIEW_ZOOM, worldPoint } from "./canvas-geometry";

describe("read-only canvas navigation", () => {
  const viewport = { x: 40, y: -20, zoom: 1 };
  it("moves the view with arrow keys without changing the scene", () => {
    expect(readOnlyKeyViewport(viewport, "ArrowRight", 800, 600)).toEqual({
      x: -24,
      y: -20,
      zoom: 1,
    });
    expect(readOnlyKeyViewport(viewport, "ArrowUp", 800, 600, true)).toEqual({
      x: 40,
      y: 140,
      zoom: 1,
    });
    expect(viewport).toEqual({ x: 40, y: -20, zoom: 1 });
  });
  it("keeps the viewport center fixed through zoom and clamps its supported range", () => {
    const center = { x: 400, y: 300 };
    const next = readOnlyKeyViewport(viewport, "+", 800, 600)!;
    expect(next.zoom).toBe(1.2);
    expect(worldPoint(center, next)).toEqual(worldPoint(center, viewport));
    expect(readOnlyKeyViewport({ ...viewport, zoom: 3 }, "=", 800, 600)?.zoom).toBe(3);
    expect(readOnlyKeyViewport({ ...viewport, zoom: 0.15 }, "-", 800, 600)?.zoom).toBe(0.15);
  });
  it.each(["Delete", "Backspace", "Enter", "z", "0", "Escape", "Tab"])(
    "does not map %s to a scene operation or navigation",
    (key) => {
      expect(readOnlyKeyViewport(viewport, key, 800, 600)).toBeNull();
    },
  );
  it("zooms a fitted preview out and back in without jumping to the editor minimum", () => {
    const fitted = { x: 200, y: 100, zoom: 0.04 };
    const out = readOnlyKeyViewport(fitted, "-", 800, 600, false, MIN_PREVIEW_ZOOM)!;
    expect(out.zoom).toBeCloseTo(fitted.zoom / 1.2);
    const restored = readOnlyKeyViewport(out, "+", 800, 600, false, MIN_PREVIEW_ZOOM)!;
    expect(restored.zoom).toBeCloseTo(fitted.zoom);
    expect(worldPoint({ x: 400, y: 300 }, restored)).toEqual(
      worldPoint({ x: 400, y: 300 }, fitted),
    );
    expect(
      readOnlyKeyViewport(
        { ...fitted, zoom: MIN_PREVIEW_ZOOM },
        "-",
        800,
        600,
        false,
        MIN_PREVIEW_ZOOM,
      )?.zoom,
    ).toBe(MIN_PREVIEW_ZOOM);
  });
});
