import { describe, expect, it } from "vitest";
import { CanvasObjectSchema, type CanvasObject } from "../../packages/contracts/src/index.ts";
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
