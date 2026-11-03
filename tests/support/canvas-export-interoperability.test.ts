import { describe, expect, it } from "vitest";
import {
  CanvasObjectSchema,
  CanvasColorSchema,
  CanvasShapeVariantSchema,
  IdeaBoardCanvasSchema,
  type CanvasObject,
} from "../../packages/contracts/src/index.ts";
import { renderCanvasSvg } from "../../apps/server/src/canvas-export.ts";
import { validateClosedCanvasSvg } from "../../apps/web/components/canvas-boards/canvas-export-client.ts";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const base = {
  id: id(1),
  type: "sticky",
  version: 1,
  x: 20,
  y: 30,
  width: 200,
  height: 160,
  text: "Synthetic canvas note",
};

async function acceptsRendererOutput(objects: CanvasObject[]) {
  const document = await renderCanvasSvg({
    objects,
    region: null,
    loadImage: async () => {
      throw new Error("No image requested");
    },
  });
  const svg = document.svg.toString();
  expect(validateClosedCanvasSvg(svg)).toEqual({
    width: document.width,
    height: document.height,
  });
  return svg;
}

// Cross-application compatibility belongs in repository tests, outside the isolated web image.
describe("server SVG and browser closed-document interoperability", () => {
  it("accepts the scaled native content of an approved participant composition", async () => {
    const canvas = IdeaBoardCanvasSchema.parse({
      schemaVersion: 1,
      x: 40,
      y: 50,
      width: 400,
      height: 300,
      objects: [
        {
          id: id(100),
          type: "sticky",
          x: 0,
          y: 0,
          width: 200,
          height: 160,
          text: "Participant composition",
        },
      ],
    });
    const objects = [
      CanvasObjectSchema.parse({
        ...base,
        type: "idea_ref",
        text: "",
        ideaId: id(2),
        width: 800,
        height: 450,
        idea: {
          id: id(2),
          status: "approved",
          body: "An original composition",
          alias: null,
          groupId: null,
          createdAt: "2026-11-03T12:00:00.000Z",
          voteCount: null,
          canvas,
        },
      }),
    ];
    const svg = await acceptsRendererOutput(objects);
    expect(svg).toContain('transform="scale(1.48667 1.48667)"');
    expect(svg).toContain('transform="translate(102.66667 2) rotate(0 0 0)"');
  });
  it("accepts the actual renderer output for the original closed scene primitives", async () => {
    const objects = ["sticky", "text", "rect", "ellipse", "frame", "link"].map((type, index) =>
      CanvasObjectSchema.parse({
        ...base,
        id: id(index + 100),
        type,
        rotation: -30,
        ...(type === "link" ? { url: "https://example.test/?x=1&y=2" } : {}),
      }),
    );
    objects.push(
      CanvasObjectSchema.parse({
        ...base,
        type: "pen",
        points: [
          [0, 0],
          [100, 100],
        ],
      }),
    );
    await acceptsRendererOutput(objects);
  });

  it("accepts labeled diagram routes and both local arrow markers from the real renderer", async () => {
    const objects = [
      CanvasObjectSchema.parse({ ...base, type: "diamond", id: id(2), rotation: 30 }),
      CanvasObjectSchema.parse({ ...base, type: "parallelogram", id: id(3), x: 400 }),
      CanvasObjectSchema.parse({
        ...base,
        id: id(4),
        type: "connector",
        text: "Synthetic <route> — 確認",
        from: { objectId: id(2), anchor: "right", x: 0, y: 0 },
        to: { objectId: id(3), anchor: "left", x: 0, y: 0 },
        routing: "elbow",
        lineStyle: "dashed",
        lineColor: "blue",
        startMarker: "arrow",
        endMarker: "arrow",
      }),
    ];
    const svg = await acceptsRendererOutput(objects);
    expect(svg).toContain('marker-start="url(#export-arrow-blue)"');
    expect(svg).toContain('marker-end="url(#export-arrow-blue)"');
    expect(svg).toContain("stroke-dasharray=");
    expect(svg).toContain("Synthetic &lt;route&gt;");
  });
});

describe("Canvas V4 SVG language interoperability", () => {
  it("accepts every shared shape variant with bounded text, stroke and opacity styles", async () => {
    const colors = CanvasColorSchema.options;
    const objects = CanvasShapeVariantSchema.options.map((shapeVariant, index) =>
      CanvasObjectSchema.parse({
        ...base,
        id: id(300 + index),
        type: "rect",
        shapeVariant,
        width: 137.5,
        height: 93.25,
        x: index * 160,
        color: colors[index % colors.length],
        fontFamily: ["sans", "serif", "mono"][index % 3],
        fontSize: 10 + index * 4,
        fontWeight: index % 2 ? "normal" : "bold",
        fontStyle: index % 2 ? "normal" : "italic",
        textDecoration: index % 2 ? "none" : "underline",
        textAlign: ["left", "center", "right"][index % 3],
        opacity: index % 2 ? 1 : 0.35,
        strokeWidth: index + 1,
      }),
    );
    const svg = await acceptsRendererOutput(objects);
    expect(svg).toContain('font-family="Georgia, serif"');
    expect(svg).toContain('font-family="Courier New, monospace"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('opacity="0.35"');
  });
  it("accepts every palette's local start/end marker and styled connector label", async () => {
    const objects = CanvasColorSchema.options.map((lineColor, index) =>
      CanvasObjectSchema.parse({
        ...base,
        id: id(400 + index),
        type: "connector",
        text: "Styled route",
        from: { objectId: null, x: 0, y: index * 40 },
        to: { objectId: null, x: 300, y: index * 40 + 25 },
        lineColor,
        startMarker: "arrow",
        endMarker: "arrow",
        fontFamily: "serif",
        fontWeight: "bold",
        fontStyle: "italic",
        textDecoration: "underline",
        textAlign: "right",
        opacity: 0.1,
        strokeWidth: 24,
      }),
    );
    const svg = await acceptsRendererOutput(objects);
    for (const color of CanvasColorSchema.options) {
      expect(svg).toContain(`marker-start="url(#export-arrow-${color})"`);
      expect(svg).toContain(`marker-end="url(#export-arrow-${color})"`);
    }
  });
});
