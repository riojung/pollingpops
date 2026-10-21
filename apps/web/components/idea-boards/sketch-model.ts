import type { IdeaBoardSketch, IdeaBoardSketchElement } from "@openround/contracts";

export const SKETCH_WIDTH = 1000;
export const SKETCH_HEIGHT = 600;
export const SKETCH_MAX_ELEMENTS = 32;
export const SKETCH_MAX_POINTS = 1024;
export type SketchTool = "select" | IdeaBoardSketchElement["type"];
export type SketchPoint = [number, number];
export type SketchBounds = { x: number; y: number; width: number; height: number };

export function emptySketch(): IdeaBoardSketch {
  return { schemaVersion: 1, width: SKETCH_WIDTH, height: SKETCH_HEIGHT, elements: [] };
}

export function sketchPoint(x: number, y: number): SketchPoint {
  return [
    Math.round(Math.max(0, Math.min(SKETCH_WIDTH, x))),
    Math.round(Math.max(0, Math.min(SKETCH_HEIGHT, y))),
  ];
}

export function sketchElementBounds(element: IdeaBoardSketchElement): SketchBounds {
  if (element.type === "rect" || element.type === "ellipse") return element;
  if (element.type === "text") {
    return {
      x: element.x,
      y: Math.max(0, element.y - element.fontSize),
      width: Math.min(
        SKETCH_WIDTH - element.x,
        Math.max(element.fontSize, element.text.length * element.fontSize * 0.6),
      ),
      height: element.fontSize * 1.3,
    };
  }
  const points =
    element.type === "freehand"
      ? element.points
      : [
          [element.x1, element.y1],
          [element.x2, element.y2],
        ];
  const xs = points.map((point) => point[0]!);
  const ys = points.map((point) => point[1]!);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Translate the whole element together so paths and endpoints cannot leave the canvas. */
export function moveSketchElement(
  element: IdeaBoardSketchElement,
  dx: number,
  dy: number,
): IdeaBoardSketchElement {
  const bounds = sketchElementBounds(element);
  const x = Math.round(Math.max(-bounds.x, Math.min(SKETCH_WIDTH - bounds.x - bounds.width, dx)));
  const y = Math.round(Math.max(-bounds.y, Math.min(SKETCH_HEIGHT - bounds.y - bounds.height, dy)));
  if (element.type === "rect" || element.type === "ellipse" || element.type === "text") {
    return { ...element, x: element.x + x, y: element.y + y };
  }
  if (element.type === "freehand")
    return { ...element, points: element.points.map(([px, py]) => [px + x, py + y]) };
  return {
    ...element,
    x1: element.x1 + x,
    y1: element.y1 + y,
    x2: element.x2 + x,
    y2: element.y2 + y,
  };
}

export function sketchPointCount(sketch: IdeaBoardSketch) {
  return sketch.elements.reduce(
    (total, element) => total + (element.type === "freehand" ? element.points.length : 0),
    0,
  );
}

export function updateDrawnElement(
  element: IdeaBoardSketchElement,
  start: SketchPoint,
  end: SketchPoint,
  pointsRemaining = 128,
): IdeaBoardSketchElement {
  if (element.type === "rect" || element.type === "ellipse") {
    return {
      ...element,
      x: Math.min(SKETCH_WIDTH - 1, start[0], end[0]),
      y: Math.min(SKETCH_HEIGHT - 1, start[1], end[1]),
      width: Math.max(1, Math.abs(start[0] - end[0])),
      height: Math.max(1, Math.abs(start[1] - end[1])),
    };
  }
  if (element.type === "line" || element.type === "arrow")
    return { ...element, x2: end[0], y2: end[1] };
  if (element.type === "freehand") {
    const previous = element.points.at(-1)!;
    if (previous[0] === end[0] && previous[1] === end[1]) return element;
    // Continue following the pen when a gesture reaches its sample budget.
    const limit = Math.max(2, Math.min(128, pointsRemaining));
    const points =
      element.points.length >= limit
        ? element.points.filter((_, index) => index % 2 === 0)
        : element.points;
    return { ...element, points: [...points, end] };
  }
  return element;
}

export function newSketchElement(
  type: Exclude<SketchTool, "select">,
  id: string,
  text: string,
  point: SketchPoint = [120, 120],
): IdeaBoardSketchElement {
  const common = { id, color: "ink" as const, strokeWidth: 4 as const };
  const [x, y] = sketchPoint(Math.min(800, point[0]), Math.min(480, point[1]));
  if (type === "rect" || type === "ellipse")
    return { ...common, type, x, y, width: 180, height: 100 };
  if (type === "line" || type === "arrow")
    return { ...common, type, x1: x, y1: y, x2: x + 180, y2: y + 80 };
  if (type === "text") return { ...common, type, x, y: Math.max(32, y), text, fontSize: 32 };
  return {
    ...common,
    type,
    points: [
      [x, y],
      [x + 1, y + 1],
    ],
  };
}

export type SketchHistory = {
  past: IdeaBoardSketch[];
  present: IdeaBoardSketch;
  future: IdeaBoardSketch[];
};
export type SketchHistoryAction =
  { type: "commit"; sketch: IdeaBoardSketch } | { type: "undo" } | { type: "redo" };
export function sketchHistory(sketch: IdeaBoardSketch): SketchHistory {
  return { past: [], present: sketch, future: [] };
}
export function sketchHistoryReducer(
  history: SketchHistory,
  action: SketchHistoryAction,
): SketchHistory {
  if (action.type === "undo") {
    const previous = history.past.at(-1);
    return previous
      ? {
          past: history.past.slice(0, -1),
          present: previous,
          future: [history.present, ...history.future],
        }
      : history;
  }
  if (action.type === "redo") {
    const next = history.future[0];
    return next
      ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) }
      : history;
  }
  if (JSON.stringify(history.present) === JSON.stringify(action.sketch)) return history;
  return {
    past: [...history.past.slice(-49), history.present],
    present: action.sketch,
    future: [],
  };
}
