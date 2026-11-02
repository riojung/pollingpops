/** Original, locally authored palette data and SVG paths, licensed with Polling Pops (Apache-2.0). */
export const canvasToolColors = [
  "yellow",
  "blue",
  "green",
  "pink",
  "purple",
  "white",
  "orange",
  "red",
  "teal",
  "lime",
  "gray",
  "black",
  "amber",
  "lavender",
  "mint",
  "sky",
] as const;
export type CanvasToolColor = (typeof canvasToolColors)[number];
export type CanvasDrawSettings = {
  mode: "pen" | "highlighter" | "eraser";
  color: CanvasToolColor;
  width: number;
};
export const defaultCanvasDrawSettings: CanvasDrawSettings = {
  mode: "pen",
  color: "black",
  width: 3,
};
export type CanvasPaletteShapeVariant =
  | "rectangle"
  | "rounded_rectangle"
  | "triangle"
  | "star"
  | "pentagon"
  | "hexagon"
  | "octagon"
  | "cylinder"
  | "speech_bubble"
  | "cloud"
  | "cross"
  | "chevron"
  | "document"
  | "trapezoid"
  | "arrow_right"
  | "arrow_left"
  | "arrow_double";
export type CanvasPaletteObjectType =
  "sticky" | "text" | "rect" | "ellipse" | "frame" | "diamond" | "parallelogram";
export type CanvasConnectorPreset = "line" | "arrow" | "elbow";
export type CanvasShapeCategory = "basics" | "flowchart" | "connectors";
export type CanvasShapeCatalogEntry = {
  id: string;
  label: CanvasShapeLabel;
  category: CanvasShapeCategory;
  path: string;
} & (
  | { type: CanvasPaletteObjectType; shapeVariant?: CanvasPaletteShapeVariant; preset?: never }
  | { type?: never; shapeVariant?: never; preset: CanvasConnectorPreset }
);
export type CanvasShapeLabel =
  | "rectangle"
  | "roundedRectangle"
  | "oval"
  | "triangle"
  | "star"
  | "pentagon"
  | "hexagon"
  | "octagon"
  | "cross"
  | "speechBubble"
  | "cloud"
  | "frame"
  | "diamond"
  | "parallelogram"
  | "cylinder"
  | "document"
  | "trapezoid"
  | "chevron"
  | "arrowRight"
  | "arrowLeft"
  | "arrowDouble"
  | "line"
  | "arrow"
  | "elbow";

/** Previews use their own stable view box and never load remote or user-supplied markup. */
export const canvasShapeCatalog: readonly CanvasShapeCatalogEntry[] = [
  {
    id: "rectangle",
    label: "rectangle",
    category: "basics",
    type: "rect",
    shapeVariant: "rectangle",
    path: "M10 9h44v30H10Z",
  },
  {
    id: "rounded_rectangle",
    label: "roundedRectangle",
    category: "basics",
    type: "rect",
    shapeVariant: "rounded_rectangle",
    path: "M18 9h28q8 0 8 8v14q0 8-8 8H18q-8 0-8-8V17q0-8 8-8Z",
  },
  {
    id: "ellipse",
    label: "oval",
    category: "basics",
    type: "ellipse",
    path: "M55 24a23 16 0 1 1-46 0 23 16 0 0 1 46 0Z",
  },
  {
    id: "triangle",
    label: "triangle",
    category: "basics",
    type: "rect",
    shapeVariant: "triangle",
    path: "M32 6 57 41H7Z",
  },
  {
    id: "star",
    label: "star",
    category: "basics",
    type: "rect",
    shapeVariant: "star",
    path: "m32 4 6.5 13.5 15 2-11 10.5 2.5 15-13-7-13 7 2.5-15-11-10.5 15-2Z",
  },
  {
    id: "pentagon",
    label: "pentagon",
    category: "basics",
    type: "rect",
    shapeVariant: "pentagon",
    path: "m32 5 24 15-9 23H17L8 20Z",
  },
  {
    id: "hexagon",
    label: "hexagon",
    category: "basics",
    type: "rect",
    shapeVariant: "hexagon",
    path: "M19 7h26l13 17-13 17H19L6 24Z",
  },
  {
    id: "octagon",
    label: "octagon",
    category: "basics",
    type: "rect",
    shapeVariant: "octagon",
    path: "M21 5h22l14 12v14L43 43H21L7 31V17Z",
  },
  {
    id: "cross",
    label: "cross",
    category: "basics",
    type: "rect",
    shapeVariant: "cross",
    path: "M25 5h14v12h15v14H39v12H25V31H10V17h15Z",
  },
  {
    id: "speech_bubble",
    label: "speechBubble",
    category: "basics",
    type: "rect",
    shapeVariant: "speech_bubble",
    path: "M14 7h36q7 0 7 7v17q0 7-7 7H29L16 45v-7h-2q-7 0-7-7V14q0-7 7-7Z",
  },
  {
    id: "cloud",
    label: "cloud",
    category: "basics",
    type: "rect",
    shapeVariant: "cloud",
    path: "M17 38C3 39 2 20 14 17 13 4 29 2 35 11 46 3 57 12 54 22 66 30 54 42 45 38Z",
  },
  {
    id: "frame",
    label: "frame",
    category: "basics",
    type: "frame",
    path: "M8 16V7h12m24 0h12v9m0 16v9H44m-24 0H8v-9M17 15h30v18H17Z",
  },
  {
    id: "diamond",
    label: "diamond",
    category: "flowchart",
    type: "diamond",
    path: "m32 4 27 20-27 20L5 24Z",
  },
  {
    id: "parallelogram",
    label: "parallelogram",
    category: "flowchart",
    type: "parallelogram",
    path: "M19 8h39L45 40H6Z",
  },
  {
    id: "cylinder",
    label: "cylinder",
    category: "flowchart",
    type: "rect",
    shapeVariant: "cylinder",
    path: "M10 12c0-11 44-11 44 0v24c0 11-44 11-44 0ZM10 12c0 11 44 11 44 0",
  },
  {
    id: "document",
    label: "document",
    category: "flowchart",
    type: "rect",
    shapeVariant: "document",
    path: "M10 7h44v30c-17-9-27 14-44 3Z",
  },
  {
    id: "trapezoid",
    label: "trapezoid",
    category: "flowchart",
    type: "rect",
    shapeVariant: "trapezoid",
    path: "M18 8h28l13 32H5Z",
  },
  {
    id: "chevron",
    label: "chevron",
    category: "flowchart",
    type: "rect",
    shapeVariant: "chevron",
    path: "M7 8h34l16 16-16 16H7l16-16Z",
  },
  {
    id: "arrow_right",
    label: "arrowRight",
    category: "connectors",
    type: "rect",
    shapeVariant: "arrow_right",
    path: "M7 16h31V6l20 18-20 18V32H7Z",
  },
  {
    id: "arrow_left",
    label: "arrowLeft",
    category: "connectors",
    type: "rect",
    shapeVariant: "arrow_left",
    path: "M57 16H26V6L6 24l20 18V32h31Z",
  },
  {
    id: "arrow_double",
    label: "arrowDouble",
    category: "connectors",
    type: "rect",
    shapeVariant: "arrow_double",
    path: "M5 24 21 8v9h22V8l16 16-16 16v-9H21v9Z",
  },
  { id: "line", label: "line", category: "connectors", preset: "line", path: "M8 36 56 12" },
  {
    id: "arrow",
    label: "arrow",
    category: "connectors",
    preset: "arrow",
    path: "M8 36 56 12m-15 0h15v15",
  },
  {
    id: "elbow",
    label: "elbow",
    category: "connectors",
    preset: "elbow",
    path: "M8 39V12h48m-11-9 11 9-11 9",
  },
];

export function filterCanvasShapes(
  query: string,
  category: CanvasShapeCategory | "all",
  labels: Record<CanvasShapeLabel, string>,
) {
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase();
  return canvasShapeCatalog.filter(
    (entry) =>
      (category === "all" || entry.category === category) &&
      (!normalized ||
        `${labels[entry.label]} ${entry.id.replaceAll("_", " ")}`
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(normalized)),
  );
}

export function boundedStickyStackCount(value: number, limit = 20) {
  return Math.max(
    1,
    Math.min(
      Math.max(1, Math.min(20, Math.floor(limit))),
      Math.floor(Number.isFinite(value) ? value : 1),
    ),
  );
}
