import { describe, expect, it } from "vitest";
import { CanvasShapeVariantSchema } from "../src/canvas-boards";
import {
  canvasConnectorGeometry,
  canvasConnectorLabel,
  canvasDiagramPort,
  canvasDiagramShapePath,
  canvasShapeVariantPath,
} from "../src/canvas-diagram-geometry";
type Point = { x: number; y: number };
type Side = "left" | "right" | "top" | "bottom";
const sides: Side[] = ["left", "right", "top", "bottom"];

/** Independent oracle: flatten the actual rendered silhouette, without production root solving. */
function sampledOutline(path: string): Point[] {
  const outline: Point[] = [];
  let current = { x: 0, y: 0 },
    start = current;
  for (const [, command, argumentsText] of path.matchAll(/([MLHVQCZ])([^MLHVQCZ]*)/g)) {
    const values = argumentsText!.trim().split(/\s+/).map(Number);
    const point = (index: number) => ({ x: values[index]!, y: values[index + 1]! });
    if (command === "M") {
      current = point(0);
      start = current;
      outline.push(current);
    } else if (command === "Z") {
      outline.push(start);
      break;
    } else if (command === "Q" || command === "C") {
      const a = current,
        b = point(0),
        c = point(2),
        d = point(4);
      // Dense curve sampling is an independent approximation to the SVG outline.
      for (let index = 1; index <= 2048; index++) {
        const t = index / 2048,
          u = 1 - t;
        const at = (axis: "x" | "y") =>
          command === "Q"
            ? u * u * a[axis] + 2 * u * t * b[axis] + t * t * c[axis]
            : u * u * u * a[axis] +
              3 * u * u * t * b[axis] +
              3 * u * t * t * c[axis] +
              t * t * t * d[axis];
        outline.push({ x: at("x"), y: at("y") });
      }
      current = outline.at(-1)!;
    } else {
      current =
        command === "H"
          ? { x: values[0]!, y: current.y }
          : command === "V"
            ? { x: current.x, y: values[0]! }
            : point(0);
      outline.push(current);
    }
  }
  return outline;
}
function sampledPort(outline: Point[], side: Side, width: number, height: number) {
  const horizontal = side === "left" || side === "right";
  const fixed = horizontal ? "y" : "x",
    moving = horizontal ? "x" : "y";
  const origin = horizontal ? width / 2 : height / 2;
  const fixedCoordinate = horizontal ? height / 2 : width / 2;
  const direction = side === "left" || side === "top" ? -1 : 1;
  const distances: number[] = [];
  for (let index = 1; index < outline.length; index++) {
    const a = outline[index - 1]!,
      b = outline[index]!;
    if (Math.abs(a[fixed] - fixedCoordinate) < 1e-10)
      distances.push(direction * (a[moving] - origin));
    if (a[fixed] === b[fixed]) continue;
    const t = (fixedCoordinate - a[fixed]) / (b[fixed] - a[fixed]);
    if (t >= 0 && t <= 1)
      distances.push(direction * (a[moving] + t * (b[moving] - a[moving]) - origin));
  }
  const distance = Math.min(...distances.filter((value) => value > 1e-10));
  expect(Number.isFinite(distance)).toBe(true);
  return horizontal
    ? { x: origin + direction * distance, y: fixedCoordinate }
    : { x: fixedCoordinate, y: origin + direction * distance };
}
function insideOutline(point: Point, outline: Point[]) {
  let inside = false;
  for (let index = 1; index < outline.length; index++) {
    const a = outline[index - 1]!,
      b = outline[index]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y)
    )
      inside = !inside;
  }
  return inside;
}
function rotate(point: Point, width: number, height: number, angle: number, x = 0, y = 0) {
  const radians = (angle * Math.PI) / 180,
    dx = point.x - width / 2,
    dy = point.y - height / 2;
  return {
    x: x + width / 2 + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: y + height / 2 + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

describe("shared manual diagram geometry", () => {
  it("places polygon ports on the real edge and rotates them about the model centre", () => {
    const node = {
      id: "node",
      type: "parallelogram",
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      rotation: 0,
    };
    const endpoint = { objectId: "node", x: -1, y: -1, anchor: "left" as const };
    expect(canvasDiagramPort(endpoint, [node])).toEqual({ x: 30, y: 70 });
    const rotated = canvasDiagramPort(endpoint, [{ ...node, rotation: 90 }]);
    expect(rotated.x).toBeCloseTo(110);
    expect(rotated.y).toBeCloseTo(-10);
    expect(canvasDiagramPort({ ...endpoint, anchor: "center" }, [node])).toEqual({ x: 110, y: 70 });
    expect(canvasDiagramPort(endpoint, [])).toEqual({ x: -1, y: -1 });
  });
  it("keeps old straight arrows and computes elbow labels at half the travelled path", () => {
    const connector = {
      from: { objectId: null, x: 0, y: 0 },
      to: { objectId: null, x: 120, y: 60 },
      text: "Yes",
    };
    expect(canvasConnectorGeometry(connector, []).path).toBe("M0 0 L120 60");
    const elbow = canvasConnectorGeometry({ ...connector, routing: "elbow" }, []);
    expect(elbow.points).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 60 },
      { x: 120, y: 60 },
    ]);
    expect(elbow.label).toEqual({ x: 60, y: 30 });
    const box = canvasConnectorLabel(connector.text, elbow.label)!;
    expect(box.x).toBeGreaterThanOrEqual(elbow.bounds.x);
    expect(box.y + box.height).toBeLessThanOrEqual(elbow.bounds.y + elbow.bounds.height);
    const zero = canvasConnectorGeometry(
      {
        from: { objectId: null, x: -0.5, y: 1.25 },
        to: { objectId: null, x: -0.5, y: 1.25 },
        routing: "elbow",
      },
      [],
    );
    expect(zero.label).toEqual({ x: -0.5, y: 1.25 });
    expect(Object.values(zero.bounds).every(Number.isFinite)).toBe(true);
  });
  it("bounds long multiline CJK labels and generates only original MLZ shape paths", () => {
    const label = canvasConnectorLabel("漢".repeat(500), { x: 0, y: 0 })!;
    expect(label.lines).toHaveLength(4);
    expect(label.lines.at(-1)).toMatch(/…$/);
    expect(label.width).toBeLessThanOrEqual(252);
    expect(label.height).toBe(84);
    expect(canvasConnectorLabel("  ", { x: 0, y: 0 })).toBeNull();
    expect(canvasDiagramShapePath("diamond", 200, 100)).toBe("M100 0 L200 50 L100 100 L0 50 Z");
    expect(canvasDiagramShapePath("parallelogram", 200, 100)).toBe(
      "M40 0 L200 0 L160 100 L0 100 Z",
    );
  });
  it("constructs every bounded variant locally and keeps converted shape ports attached", () => {
    for (const variant of CanvasShapeVariantSchema.options) {
      const path = canvasShapeVariantPath(variant, 240, 120);
      expect(path).toMatch(/^M/);
      expect(path).toMatch(/Z$/);
      expect(path).not.toMatch(/NaN|Infinity|undefined|<|>|url|href/);
      expect(path).toMatch(/^[MLHVQCZ0-9e. +-]+$/);
    }
    const object = {
      id: "shape",
      type: "rect",
      shapeVariant: "triangle" as const,
      x: 10,
      y: 20,
      width: 200,
      height: 100,
    };
    expect(
      canvasDiagramPort({ objectId: object.id, anchor: "left", x: -1, y: -1 }, [object]),
    ).toEqual({ x: 60, y: 70 });
    const label = canvasConnectorLabel("Large label", { x: 0, y: 0 }, 32)!;
    const geometry = canvasConnectorGeometry(
      {
        from: { objectId: null, x: 0, y: 0 },
        to: { objectId: null, x: 120, y: 60 },
        fontSize: 32,
        text: "Large label",
      },
      [],
    );
    expect(label.height).toBeGreaterThan(30);
    expect(geometry.bounds.height).toBeGreaterThanOrEqual(label.height);
  });
  it.each(CanvasShapeVariantSchema.options)(
    "places every %s cardinal port on the rendered silhouette",
    (shapeVariant) => {
      const node = {
        id: "variant",
        type: "rect",
        shapeVariant,
        x: 10,
        y: -20,
        width: 320,
        height: 160,
      };
      const outline = sampledOutline(canvasShapeVariantPath(shapeVariant, node.width, node.height));
      for (const anchor of sides) {
        const expected = sampledPort(outline, anchor, node.width, node.height);
        const port = canvasDiagramPort({ objectId: node.id, anchor, x: -999, y: -999 }, [node]);
        expect(port.x).toBeCloseTo(node.x + expected.x, 4);
        expect(port.y).toBeCloseTo(node.y + expected.y, 4);
        // The port exits the filled silhouette, rather than landing on a box or interior seam.
        const horizontal = anchor === "left" || anchor === "right";
        const delta = anchor === "left" || anchor === "top" ? -0.01 : 0.01;
        const local = { x: port.x - node.x, y: port.y - node.y };
        expect(
          insideOutline(
            { x: local.x - (horizontal ? delta : 0), y: local.y - (horizontal ? 0 : delta) },
            outline,
          ),
        ).toBe(true);
        expect(
          insideOutline(
            { x: local.x + (horizontal ? delta : 0), y: local.y + (horizontal ? 0 : delta) },
            outline,
          ),
        ).toBe(false);
        for (const rotation of [-180, -37, 90, 180]) {
          const actual = canvasDiagramPort({ objectId: node.id, anchor, x: -999, y: -999 }, [
            { ...node, rotation },
          ]);
          const rotated = rotate(expected, node.width, node.height, rotation, node.x, node.y);
          expect(actual.x).toBeCloseTo(rotated.x, 4);
          expect(actual.y).toBeCloseTo(rotated.y, 4);
        }
      }
      expect(
        canvasDiagramPort({ objectId: node.id, anchor: "center", x: -999, y: -999 }, [node]),
      ).toEqual({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
    },
  );
  it("keeps star, pentagon and arrow ports off their empty bounding-box edges", () => {
    const node = { id: "shape", type: "rect", x: 0, y: 0, width: 200, height: 100 };
    const port = (shapeVariant: (typeof CanvasShapeVariantSchema.options)[number], anchor: Side) =>
      canvasDiagramPort({ objectId: node.id, anchor, x: -1, y: -1 }, [{ ...node, shapeVariant }]);
    expect(port("star", "left").x).toBeGreaterThan(0);
    expect(port("star", "right").x).toBeLessThan(node.width);
    expect(port("pentagon", "bottom").y).toBeLessThan(node.height);
    for (const variant of ["arrow_left", "arrow_right", "arrow_double"] as const) {
      expect(port(variant, "top")).toEqual({ x: 100, y: 25 });
      expect(port(variant, "bottom")).toEqual({ x: 100, y: 75 });
    }
  });
  it("finds curved outline exits without attaching to the cylinder's decorative cap", () => {
    const cylinder = {
      id: "cylinder",
      type: "rect",
      shapeVariant: "cylinder" as const,
      x: 10,
      y: 20,
      width: 200,
      height: 100,
    };
    expect(canvasShapeVariantPath("cylinder", 200, 100)).toBe(
      "M0 15 C0 0 200 0 200 15 V85 C200 100 0 100 0 85 Z M0 15 C0 35 200 35 200 15 Z",
    );
    const top = canvasDiagramPort({ objectId: cylinder.id, anchor: "top", x: 0, y: 0 }, [cylinder]);
    const bottom = canvasDiagramPort({ objectId: cylinder.id, anchor: "bottom", x: 0, y: 0 }, [
      cylinder,
    ]);
    expect(top.x).toBeCloseTo(110, 12);
    expect(top.y).toBeCloseTo(23.75, 12);
    expect(bottom.x).toBeCloseTo(110, 12);
    expect(bottom.y).toBeCloseTo(116.25, 12);
    const document = {
      ...cylinder,
      id: "document",
      shapeVariant: "document" as const,
      x: 360,
      rotation: 37,
    };
    const sourceExpected = rotate(
      sampledPort(
        sampledOutline(canvasShapeVariantPath("cylinder", cylinder.width, cylinder.height)),
        "top",
        cylinder.width,
        cylinder.height,
      ),
      cylinder.width,
      cylinder.height,
      0,
      cylinder.x,
      cylinder.y,
    );
    const targetExpected = rotate(
      sampledPort(
        sampledOutline(canvasShapeVariantPath("document", document.width, document.height)),
        "bottom",
        document.width,
        document.height,
      ),
      document.width,
      document.height,
      document.rotation,
      document.x,
      document.y,
    );
    for (const routing of ["straight", "elbow"] as const) {
      const geometry = canvasConnectorGeometry(
        {
          from: { objectId: cylinder.id, anchor: "top", x: -999, y: -999 },
          to: { objectId: document.id, anchor: "bottom", x: -999, y: -999 },
          routing,
        },
        [cylinder, document],
      );
      expect(geometry.points[0]!.x).toBeCloseTo(sourceExpected.x, 4);
      expect(geometry.points[0]!.y).toBeCloseTo(sourceExpected.y, 4);
      expect(geometry.points.at(-1)!.x).toBeCloseTo(targetExpected.x, 4);
      expect(geometry.points.at(-1)!.y).toBeCloseTo(targetExpected.y, 4);
      expect(geometry.path).not.toMatch(/NaN|Infinity/);
    }
  });
  it("keeps all variants finite and bounded at the smallest and largest supported aspect ratios", () => {
    for (const shapeVariant of CanvasShapeVariantSchema.options)
      for (const [width, height] of [
        [1, 1],
        [1, 10000],
        [10000, 1],
        [10000, 10000],
      ] as const)
        for (const anchor of sides) {
          const node = {
            id: "bounded",
            type: "rect",
            shapeVariant,
            x: -100000,
            y: 100000,
            width,
            height,
          };
          const port = canvasDiagramPort({ objectId: node.id, anchor, x: 0, y: 0 }, [node]);
          expect(Number.isFinite(port.x) && Number.isFinite(port.y)).toBe(true);
          expect(port.x).toBeGreaterThanOrEqual(node.x);
          expect(port.x).toBeLessThanOrEqual(node.x + width);
          expect(port.y).toBeGreaterThanOrEqual(node.y);
          expect(port.y).toBeLessThanOrEqual(node.y + height);
        }
  });
  it("preserves existing rectangular and legacy diagram ports", () => {
    for (const type of ["rect", "sticky", "ellipse", "diamond", "parallelogram"] as const) {
      const node = { id: "legacy", type, x: 10, y: 20, width: 200, height: 100 };
      expect(canvasDiagramPort({ objectId: node.id, anchor: "top", x: -1, y: -1 }, [node])).toEqual(
        { x: 110, y: 20 },
      );
      expect(
        canvasDiagramPort({ objectId: node.id, anchor: "bottom", x: -1, y: -1 }, [node]),
      ).toEqual({ x: 110, y: 120 });
      expect(
        canvasDiagramPort({ objectId: node.id, anchor: "left", x: -1, y: -1 }, [node]),
      ).toEqual({ x: type === "parallelogram" ? 30 : 10, y: 70 });
      expect(
        canvasDiagramPort({ objectId: node.id, anchor: "right", x: -1, y: -1 }, [node]),
      ).toEqual({ x: type === "parallelogram" ? 190 : 210, y: 70 });
    }
  });
});
