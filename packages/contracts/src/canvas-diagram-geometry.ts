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
  const y =
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
  const angle = ((object.rotation ?? 0) * Math.PI) / 180;
  return {
    x: object.x + object.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    y: object.y + object.height / 2 + x * Math.sin(angle) + y * Math.cos(angle),
  };
}
export function canvasConnectorLabel(text: string, point: CanvasDiagramPoint) {
  const content = text.trim();
  if (!content) return null;
  const lines: string[] = [];
  let line = "",
    used = 0;
  const characters = Array.from(content);
  let consumed = 0;
  for (const character of characters) {
    const width = /[\u2e80-\uffff]/u.test(character) ? 13 : /\s/u.test(character) ? 4 : 7;
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
              total + (/[\u2e80-\uffff]/u.test(character) ? 13 : /\s/u.test(character) ? 4 : 7),
            0,
          ),
        ),
      ) + 16,
    ),
  );
  const height = lines.length * 18 + 12;
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
  const box = canvasConnectorLabel(connector.text ?? "", label);
  const x = Math.min(...points.map((point) => point.x - 8), box?.x ?? Infinity);
  const y = Math.min(...points.map((point) => point.y - 8), box?.y ?? Infinity);
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
        Math.max(...points.map((point) => point.x + 8), box ? box.x + box.width : -Infinity) - x,
      height:
        Math.max(...points.map((point) => point.y + 8), box ? box.y + box.height : -Infinity) - y,
    },
  };
}
