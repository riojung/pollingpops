import { zoomAt, type CanvasViewport } from "./canvas-geometry";

/** View navigation only: keyboard gestures never produce object operations. */
export function readOnlyKeyViewport(
  viewport: CanvasViewport,
  key: string,
  width: number,
  height: number,
  shift = false,
): CanvasViewport | null {
  const step = shift ? 160 : 64;
  if (key === "ArrowLeft") return { ...viewport, x: viewport.x + step };
  if (key === "ArrowRight") return { ...viewport, x: viewport.x - step };
  if (key === "ArrowUp") return { ...viewport, y: viewport.y + step };
  if (key === "ArrowDown") return { ...viewport, y: viewport.y - step };
  const zoom =
    key === "+" || key === "="
      ? viewport.zoom * 1.2
      : key === "-" || key === "_"
        ? viewport.zoom / 1.2
        : null;
  return zoom === null ? null : zoomAt(viewport, { x: width / 2, y: height / 2 }, zoom);
}
