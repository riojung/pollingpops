export interface CanvasPoint {
  x: number;
  y: number;
}
export interface CanvasBounds extends CanvasPoint {
  width: number;
  height: number;
}
export interface CanvasViewport extends CanvasPoint {
  zoom: number;
}
export const INITIAL_VIEWPORT: CanvasViewport = { x: 80, y: 80, zoom: 1 };
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;

export function worldPoint(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}

/** Keep the world point under the pointer fixed when zooming. */
export function zoomAt(
  viewport: CanvasViewport,
  point: CanvasPoint,
  nextZoom: number,
): CanvasViewport {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
  const world = worldPoint(point, viewport);
  return { zoom, x: point.x - world.x * zoom, y: point.y - world.y * zoom };
}

export function fitViewport(
  bounds: readonly CanvasBounds[],
  width: number,
  height: number,
): CanvasViewport {
  if (!bounds.length || width <= 0 || height <= 0) return INITIAL_VIEWPORT;
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(
      1.5,
      (width - 96) / Math.max(1, right - left),
      (height - 96) / Math.max(1, bottom - top),
    ),
  );
  return {
    zoom,
    x: width / 2 - ((left + right) / 2) * zoom,
    y: height / 2 - ((top + bottom) / 2) * zoom,
  };
}

export function boundedPosition(point: CanvasPoint): CanvasPoint {
  return {
    x: Math.round(Math.max(-10000, Math.min(10000, point.x))),
    y: Math.round(Math.max(-10000, Math.min(10000, point.y))),
  };
}

export function connectorPoint(
  anchor: {
    objectId: string | null;
    x: number;
    y: number;
    anchor?: "center" | "top" | "right" | "bottom" | "left";
  },
  objects: readonly (CanvasBounds & { id: string; rotation?: number })[],
): CanvasPoint {
  const target = objects.find((item) => item.id === anchor.objectId);
  if (!target) return { x: anchor.x, y: anchor.y };
  const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const offset = {
    x:
      anchor.anchor === "left"
        ? -target.width / 2
        : anchor.anchor === "right"
          ? target.width / 2
          : 0,
    y:
      anchor.anchor === "top"
        ? -target.height / 2
        : anchor.anchor === "bottom"
          ? target.height / 2
          : 0,
  };
  const radians = ((target.rotation ?? 0) * Math.PI) / 180;
  return {
    x: center.x + offset.x * Math.cos(radians) - offset.y * Math.sin(radians),
    y: center.y + offset.x * Math.sin(radians) + offset.y * Math.cos(radians),
  };
}
