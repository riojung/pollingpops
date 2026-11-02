import type { CanvasShapeVariant } from "./canvas-boards";

/** Original, bounded geometry shared by the interactive canvas and closed SVG export. */
export interface CanvasDiagramPoint {
  x: number;
  y: number;
}
export interface CanvasDiagramBounds extends CanvasDiagramPoint {
  width: number;
  height: number;
}
export interface CanvasDiagramNode extends CanvasDiagramBounds {
  id: string;
  type?: string;
  shapeVariant?: CanvasShapeVariant;
  rotation?: number;
}
export interface CanvasDiagramEndpoint extends CanvasDiagramPoint {
  objectId: string | null;
  anchor?: "center" | "top" | "right" | "bottom" | "left";
}
export interface CanvasDiagramConnector {
  from: CanvasDiagramEndpoint;
  to: CanvasDiagramEndpoint;
  routing?: "straight" | "elbow";
  text?: string;
  fontSize?: number;
  strokeWidth?: number;
}
const number = (value: number) => String(Object.is(value, -0) ? 0 : value);
export function canvasDiagramShapePath(
  type: "diamond" | "parallelogram",
  width: number,
  height: number,
) {
  const points =
    type === "diamond"
      ? [
          [width / 2, 0],
          [width, height / 2],
          [width / 2, height],
          [0, height / 2],
        ]
      : [
          [width * 0.2, 0],
          [width, 0],
          [width * 0.8, height],
          [0, height],
        ];
  return (
    points.map(([x, y], index) => `${index ? "L" : "M"}${number(x!)} ${number(y!)}`).join(" ") +
    " Z"
  );
}
/** Every path is constructed from bounded geometry, never from supplied SVG/CSS. */
export function canvasShapeVariantPath(variant: CanvasShapeVariant, width: number, height: number) {
  const w = width,
    h = height;
  const polygon = (points: number[][]) =>
    points.map(([x, y], index) => `${index ? "L" : "M"}${number(x!)} ${number(y!)}`).join(" ") +
    " Z";
  const regular = (sides: number, inset = 0) =>
    polygon(
      Array.from({ length: sides }, (_, index) => {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides;
        return [
          w / 2 + (w / 2 - inset) * Math.cos(angle),
          h / 2 + (h / 2 - inset) * Math.sin(angle),
        ];
      }),
    );
  switch (variant) {
    case "rectangle":
      return polygon([
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ]);
    case "rounded_rectangle": {
      const r = Math.min(18, w / 5, h / 5);
      return `M${number(r)} 0 H${number(w - r)} Q${number(w)} 0 ${number(w)} ${number(r)} V${number(h - r)} Q${number(w)} ${number(h)} ${number(w - r)} ${number(h)} H${number(r)} Q0 ${number(h)} 0 ${number(h - r)} V${number(r)} Q0 0 ${number(r)} 0 Z`;
    }
    case "triangle":
      return polygon([
        [w / 2, 0],
        [w, h],
        [0, h],
      ]);
    case "star":
      return polygon(
        Array.from({ length: 10 }, (_, index) => {
          const angle = -Math.PI / 2 + (index * Math.PI) / 5,
            radius = index % 2 ? 0.23 : 0.5;
          return [w / 2 + w * radius * Math.cos(angle), h / 2 + h * radius * Math.sin(angle)];
        }),
      );
    case "pentagon":
      return regular(5);
    case "hexagon":
      return polygon([
        [w * 0.25, 0],
        [w * 0.75, 0],
        [w, h * 0.5],
        [w * 0.75, h],
        [w * 0.25, h],
        [0, h * 0.5],
      ]);
    case "octagon":
      return polygon([
        [w * 0.3, 0],
        [w * 0.7, 0],
        [w, h * 0.3],
        [w, h * 0.7],
        [w * 0.7, h],
        [w * 0.3, h],
        [0, h * 0.7],
        [0, h * 0.3],
      ]);
    case "cylinder":
      return `M0 ${number(h * 0.15)} C0 0 ${number(w)} 0 ${number(w)} ${number(h * 0.15)} V${number(h * 0.85)} C${number(w)} ${number(h)} 0 ${number(h)} 0 ${number(h * 0.85)} Z M0 ${number(h * 0.15)} C0 ${number(h * 0.35)} ${number(w)} ${number(h * 0.35)} ${number(w)} ${number(h * 0.15)} Z`;
    case "speech_bubble":
      return polygon([
        [0, 0],
        [w, 0],
        [w, h * 0.78],
        [w * 0.4, h * 0.78],
        [w * 0.2, h],
        [w * 0.2, h * 0.78],
        [0, h * 0.78],
      ]);
    case "cloud":
      return `M${number(w * 0.2)} ${number(h * 0.85)} C${number(0)} ${number(h * 0.85)} ${number(0)} ${number(h * 0.35)} ${number(w * 0.18)} ${number(h * 0.35)} C${number(w * 0.12)} ${number(0)} ${number(w * 0.48)} ${number(0)} ${number(w * 0.52)} ${number(h * 0.2)} C${number(w * 0.7)} ${number(0)} ${number(w * 0.97)} ${number(h * 0.15)} ${number(w * 0.88)} ${number(h * 0.4)} C${number(w)} ${number(h * 0.42)} ${number(w)} ${number(h * 0.86)} ${number(w * 0.8)} ${number(h * 0.85)} Z`;
    case "cross":
      return polygon([
        [w * 0.33, 0],
        [w * 0.67, 0],
        [w * 0.67, h * 0.33],
        [w, h * 0.33],
        [w, h * 0.67],
        [w * 0.67, h * 0.67],
        [w * 0.67, h],
        [w * 0.33, h],
        [w * 0.33, h * 0.67],
        [0, h * 0.67],
        [0, h * 0.33],
        [w * 0.33, h * 0.33],
      ]);
    case "chevron":
      return polygon([
        [0, 0],
        [w * 0.7, 0],
        [w, h * 0.5],
        [w * 0.7, h],
        [0, h],
        [w * 0.3, h * 0.5],
      ]);
    case "document":
      return `M0 0 H${number(w)} V${number(h * 0.88)} C${number(w * 0.66)} ${number(h * 0.62)} ${number(w * 0.33)} ${number(h)} 0 ${number(h * 0.88)} Z`;
    case "trapezoid":
      return polygon([
        [w * 0.2, 0],
        [w * 0.8, 0],
        [w, h],
        [0, h],
      ]);
    case "arrow_right":
      return polygon([
        [0, h * 0.25],
        [w * 0.62, h * 0.25],
        [w * 0.62, 0],
        [w, h * 0.5],
        [w * 0.62, h],
        [w * 0.62, h * 0.75],
        [0, h * 0.75],
      ]);
    case "arrow_left":
      return polygon([
        [0, h * 0.5],
        [w * 0.38, 0],
        [w * 0.38, h * 0.25],
        [w, h * 0.25],
        [w, h * 0.75],
        [w * 0.38, h * 0.75],
        [w * 0.38, h],
      ]);
    case "arrow_double":
      return polygon([
        [0, h * 0.5],
        [w * 0.28, 0],
        [w * 0.28, h * 0.25],
        [w * 0.72, h * 0.25],
        [w * 0.72, 0],
        [w, h * 0.5],
        [w * 0.72, h],
        [w * 0.72, h * 0.75],
        [w * 0.28, h * 0.75],
        [w * 0.28, h],
      ]);
  }
}
type CanvasSideAnchor = Exclude<CanvasDiagramEndpoint["anchor"], "center" | undefined>;
type CanvasOutlineSegment = readonly CanvasDiagramPoint[];
const outlineTolerance = 1e-12;
const variantPorts = new Map<CanvasShapeVariant, Record<CanvasSideAnchor, CanvasDiagramPoint>>();

/** Parse only our generated, absolute path commands, never user-supplied SVG. */
function variantOutline(variant: CanvasShapeVariant): CanvasOutlineSegment[] {
  const tokens = canvasShapeVariantPath(variant, 1, 1).match(
    /[MLHVQCZ]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/g,
  )!;
  const segments: CanvasOutlineSegment[] = [];
  let cursor = 0;
  const next = () => Number(tokens[cursor++]);
  const point = () => ({ x: next(), y: next() });
  let current = { x: 0, y: 0 },
    start = current;
  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    if (command === "M") {
      current = point();
      start = current;
    } else if (command === "Z") {
      segments.push([current, start]);
      // The first closed subpath is the silhouette. Later subpaths, such as
      // the cylinder's cap seam, decorate its interior and are not ports.
      break;
    } else {
      const controls = command === "Q" ? [point()] : command === "C" ? [point(), point()] : [];
      const end =
        command === "H"
          ? { x: next(), y: current.y }
          : command === "V"
            ? { x: current.x, y: next() }
            : point();
      segments.push([current, ...controls, end]);
      current = end;
    }
  }
  return segments;
}
function segmentPolynomial(segment: CanvasOutlineSegment, axis: "x" | "y") {
  const [a = 0, b = 0, c = 0, d = 0] = segment.map((point) => point[axis]);
  if (segment.length === 2) return [a, b - a];
  if (segment.length === 3) return [a, 2 * (b - a), a - 2 * b + c];
  return [a, 3 * (b - a), 3 * (a - 2 * b + c), -a + 3 * b - 3 * c + d];
}
function polynomialAt(coefficients: readonly number[], t: number) {
  return coefficients.reduceRight((value, coefficient) => value * t + coefficient, 0);
}
function derivative(coefficients: readonly number[]) {
  return coefficients.slice(1).map((value, index) => value * (index + 1));
}
/** Degree <= 3: derivative roots split the curve into bounded monotone intervals. */
function unitRoots(input: readonly number[]): number[] {
  const coefficients = [...input];
  while (coefficients.length > 1 && Math.abs(coefficients.at(-1)!) <= outlineTolerance)
    coefficients.pop();
  if (coefficients.length === 1) return [];
  if (coefficients.length === 2) {
    const root = -coefficients[0]! / coefficients[1]!;
    return root >= -outlineTolerance && root <= 1 + outlineTolerance
      ? [Math.max(0, Math.min(1, root))]
      : [];
  }
  const stops = [0, ...unitRoots(derivative(coefficients)), 1].sort((a, b) => a - b);
  const roots = stops.filter((t) => Math.abs(polynomialAt(coefficients, t)) <= outlineTolerance);
  for (let index = 1; index < stops.length; index++) {
    let low = stops[index - 1]!,
      high = stops[index]!;
    let lowValue = polynomialAt(coefficients, low);
    if (lowValue * polynomialAt(coefficients, high) >= 0) continue;
    for (let iteration = 0; iteration < 48; iteration++) {
      const middle = (low + high) / 2;
      const value = polynomialAt(coefficients, middle);
      if (value === 0) {
        low = high = middle;
        break;
      }
      if (lowValue * value < 0) high = middle;
      else {
        low = middle;
        lowValue = value;
      }
    }
    roots.push((low + high) / 2);
  }
  return roots;
}
function variantOutlinePort(variant: CanvasShapeVariant, anchor: CanvasSideAnchor) {
  let ports = variantPorts.get(variant);
  if (!ports) {
    const outline = variantOutline(variant);
    ports = {} as Record<CanvasSideAnchor, CanvasDiagramPoint>;
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const horizontal = side === "left" || side === "right";
      const direction = side === "left" || side === "top" ? -1 : 1;
      let distance = Infinity;
      for (const segment of outline) {
        const across = segmentPolynomial(segment, horizontal ? "y" : "x");
        const along = segmentPolynomial(segment, horizontal ? "x" : "y");
        across[0] = across[0]! - 0.5;
        const roots = across.every((value) => Math.abs(value) <= outlineTolerance)
          ? [0, ...unitRoots(derivative(along)), 1]
          : unitRoots(across);
        for (const t of roots) {
          const candidate = direction * (polynomialAt(along, t) - 0.5);
          if (candidate >= -outlineTolerance) distance = Math.min(distance, Math.max(0, candidate));
        }
      }
      // All current silhouettes enclose their centre and meet each cardinal ray.
      const offset = direction * (Number.isFinite(distance) ? distance : 0);
      ports[side] = horizontal ? { x: 0.5 + offset, y: 0.5 } : { x: 0.5, y: 0.5 + offset };
    }
    variantPorts.set(variant, ports);
  }
  return ports[anchor];
}
export function canvasDiagramPort(
  endpoint: CanvasDiagramEndpoint,
  objects: readonly CanvasDiagramNode[],
): CanvasDiagramPoint {
  const object = objects.find((entry) => entry.id === endpoint.objectId);
  if (!object) return { x: endpoint.x, y: endpoint.y };
  let x =
    endpoint.anchor === "left"
      ? -object.width / 2
      : endpoint.anchor === "right"
        ? object.width / 2
        : 0;
  let y =
    endpoint.anchor === "top"
      ? -object.height / 2
      : endpoint.anchor === "bottom"
        ? object.height / 2
        : 0;
  if (
    object.type === "parallelogram" &&
    (endpoint.anchor === "left" || endpoint.anchor === "right")
  )
    x *= 0.8;
  if (
    object.type === "rect" &&
    object.shapeVariant &&
    object.shapeVariant !== "rectangle" &&
    object.shapeVariant !== "rounded_rectangle" &&
    endpoint.anchor &&
    endpoint.anchor !== "center"
  ) {
    // Variants scale with their bounds. Rounded rectangles keep the exact old
    // cardinal midpoints: their capped corner radius cannot reach those points.
    const port = variantOutlinePort(object.shapeVariant, endpoint.anchor);
    x = (port.x - 0.5) * object.width;
    y = (port.y - 0.5) * object.height;
  }
  const angle = ((object.rotation ?? 0) * Math.PI) / 180;
  return {
    x: object.x + object.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    y: object.y + object.height / 2 + x * Math.sin(angle) + y * Math.cos(angle),
  };
}
export function canvasConnectorLabel(text: string, point: CanvasDiagramPoint, fontSize = 13) {
  const scale = fontSize / 13;
  const content = text.trim();
  if (!content) return null;
  const lines: string[] = [];
  let line = "",
    used = 0;
  const characters = Array.from(content);
  let consumed = 0;
  for (const character of characters) {
    const width = (/[\u2e80-\uffff]/u.test(character) ? 13 : /\s/u.test(character) ? 4 : 7) * scale;
    if (character === "\n" || used + width > 228) {
      lines.push(line);
      line = "";
      used = 0;
      if (lines.length === 4) break;
      if (character === "\n") {
        consumed++;
        continue;
      }
    }
    line += character;
    used += width;
    consumed++;
  }
  if (line && lines.length < 4) lines.push(line);
  if (consumed < characters.length && lines.length)
    lines[lines.length - 1] = lines.at(-1)!.slice(0, -1) + "…";
  const width = Math.max(
    28,
    Math.min(
      252,
      Math.max(
        ...lines.map((value) =>
          Array.from(value).reduce(
            (total, character) =>
              total +
              (/[\u2e80-\uffff]/u.test(character) ? 13 : /\s/u.test(character) ? 4 : 7) * scale,
            0,
          ),
        ),
      ) + 16,
    ),
  );
  const height = lines.length * 18 * scale + 12;
  return { x: point.x - width / 2, y: point.y - height / 2, width, height, lines };
}
export function canvasConnectorGeometry(
  connector: CanvasDiagramConnector,
  objects: readonly CanvasDiagramNode[],
) {
  const from = canvasDiagramPort(connector.from, objects),
    to = canvasDiagramPort(connector.to, objects);
  let points = [from, to];
  if (connector.routing === "elbow" && from.x !== to.x && from.y !== to.y) {
    const source = objects.find((entry) => entry.id === connector.from.objectId);
    const center = source
      ? { x: source.x + source.width / 2, y: source.y + source.height / 2 }
      : from;
    const vector = { x: from.x - center.x, y: from.y - center.y };
    const horizontal =
      vector.x || vector.y
        ? Math.abs(vector.x) >= Math.abs(vector.y)
        : Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
    points = horizontal
      ? [from, { x: (from.x + to.x) / 2, y: from.y }, { x: (from.x + to.x) / 2, y: to.y }, to]
      : [from, { x: from.x, y: (from.y + to.y) / 2 }, { x: to.x, y: (from.y + to.y) / 2 }, to];
  }
  points = points.filter(
    (point, index) =>
      !index || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y,
  );
  if (points.length === 1) points.push({ ...points[0]! });
  const length = points
    .slice(1)
    .reduce(
      (total, point, index) =>
        total + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
      0,
    );
  let distance = length / 2,
    label = { ...from };
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!,
      b = points[index]!;
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (distance <= segment) {
      const ratio = segment ? distance / segment : 0;
      label = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
      break;
    }
    distance -= segment;
  }
  const box = canvasConnectorLabel(connector.text ?? "", label, connector.fontSize);
  const padding = Math.max(8, (connector.strokeWidth ?? 0) * 7);
  const x = Math.min(...points.map((point) => point.x - padding), box?.x ?? Infinity);
  const y = Math.min(...points.map((point) => point.y - padding), box?.y ?? Infinity);
  return {
    points,
    path: points
      .map((point, index) => `${index ? "L" : "M"}${number(point.x)} ${number(point.y)}`)
      .join(" "),
    label,
    bounds: {
      x,
      y,
      width:
        Math.max(...points.map((point) => point.x + padding), box ? box.x + box.width : -Infinity) -
        x,
      height:
        Math.max(
          ...points.map((point) => point.y + padding),
          box ? box.y + box.height : -Infinity,
        ) - y,
    },
  };
}
