import { CanvasExportRegionSchema, type CanvasExportRegion } from "@openround/contracts";
import { MIN_ZOOM, MAX_ZOOM, type CanvasViewport } from "./canvas-geometry";

export function canvasVisibleRegion(viewport: CanvasViewport, width: number, height: number) {
  const parsed = CanvasExportRegionSchema.safeParse({
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: width / viewport.zoom,
    height: height / viewport.zoom,
  });
  return parsed.success ? parsed.data : null;
}
export function followCanvasRegion(
  region: CanvasExportRegion,
  width: number,
  height: number,
): CanvasViewport | null {
  if (width <= 0 || height <= 0 || !CanvasExportRegionSchema.safeParse(region).success) return null;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, width / region.width, height / region.height));
  return {
    zoom,
    x: width / 2 - (region.x + region.width / 2) * zoom,
    y: height / 2 - (region.y + region.height / 2) * zoom,
  };
}
