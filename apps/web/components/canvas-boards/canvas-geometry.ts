import { canvasDiagramPort } from "@openround/contracts";
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
/** Reveal an insertion after the inspector layout settles, retaining the current zoom when it fits. */
export function revealCanvasBounds(
  viewport: CanvasViewport,
  bounds: CanvasBounds,
  width: number,
  height: number,
): CanvasViewport {
  if (width <= 0 || height <= 0) return viewport;
  const padding = Math.min(32, width / 5, height / 5);
  const availableWidth = width - padding * 2,
    availableHeight = height - padding * 2;
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(viewport.zoom, availableWidth / bounds.width, availableHeight / bounds.height),
  );
  const left = bounds.x * zoom + viewport.x,
    top = bounds.y * zoom + viewport.y;
  const right = left + bounds.width * zoom,
    bottom = top + bounds.height * zoom;
  const dx =
    bounds.width * zoom > availableWidth
      ? width / 2 - (left + right) / 2
      : left < padding
        ? padding - left
        : right > width - padding
          ? width - padding - right
          : 0;
  const dy =
    bounds.height * zoom > availableHeight
      ? height / 2 - (top + bottom) / 2
      : top < padding
        ? padding - top
        : bottom > height - padding
          ? height - padding - bottom
          : 0;
  return { zoom, x: viewport.x + dx, y: viewport.y + dy };
}

export function connectorPoint(
  anchor: {
    objectId: string | null;
    x: number;
    y: number;
    anchor?: "center" | "top" | "right" | "bottom" | "left";
  },
  objects: readonly (CanvasBounds & { id: string; type?: string; rotation?: number })[],
): CanvasPoint {
  return canvasDiagramPort(anchor, objects);
}
