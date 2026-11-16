import { fitViewport } from "../components/canvas-boards/canvas-geometry";

export interface PresentationSpatialBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PresentationSpatialViewport {
  x: number;
  y: number;
  zoom: number;
}
type Point = { x: number; y: number };

export function presentationSpatialBounds(
  frames: readonly PresentationSpatialBounds[],
): PresentationSpatialBounds | null {
  if (!frames.length) return null;
  const x = Math.min(...frames.map((frame) => frame.x));
  const y = Math.min(...frames.map((frame) => frame.y));
  return {
    x,
    y,
    width: Math.max(...frames.map((frame) => frame.x + frame.width)) - x,
    height: Math.max(...frames.map((frame) => frame.y + frame.height)) - y,
  };
}

/** Canvas fitting with configurable padding and no editor zoom floor that could clip a large path. */
export function fitPresentationSpatialFrames(
  frames: readonly PresentationSpatialBounds[],
  width: number,
  height: number,
  padding = 32,
): PresentationSpatialViewport {
  const bounds = presentationSpatialBounds(frames);
  if (!bounds || width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  const inset = Math.max(0, Math.min(padding, width / 3, height / 3));
  const canvasFit = fitViewport(frames, width + 96 - inset * 2, height + 96 - inset * 2);
  const zoom = Math.min(
    canvasFit.zoom,
    (width - inset * 2) / Math.max(1, bounds.width),
    (height - inset * 2) / Math.max(1, bounds.height),
  );
  return {
    zoom,
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

export function presentationSpatialWorldPoint(point: Point, viewport: PresentationSpatialViewport) {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}

export function zoomPresentationSpatialAt(
  viewport: PresentationSpatialViewport,
  point: Point,
  nextZoom: number,
  minZoom = 0.001,
  maxZoom = 4,
): PresentationSpatialViewport {
  const zoom = Math.max(minZoom, Math.min(maxZoom, nextZoom));
  const world = presentationSpatialWorldPoint(point, viewport);
  return { zoom, x: point.x - world.x * zoom, y: point.y - world.y * zoom };
}
