import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasObjectSchema, type CanvasObject } from "@openround/contracts";
import {
  CANVAS_EXPORT_MAX_BYTES,
  CANVAS_EXPORT_MAX_IMAGE_BYTES,
  CANVAS_EXPORT_TIMEOUT_MS,
  renderCanvasSvg,
} from "../src/canvas-export.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
function object(value: Record<string, unknown> = {}): CanvasObject {
  return CanvasObjectSchema.parse({
    id: id(1),
    version: 1,
    type: "sticky",
    x: 20,
    y: 30,
    width: 200,
    height: 160,
    text: "Synthetic note",
    ...value,
  });
}
const region = { x: 0, y: 0, width: 800, height: 600 };
const unavailable = async () => {
  throw new Error("Private storage location must not be returned");
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP4sAAAAASUVORK5CYII=",
  "base64",
);
function largePng(length: number) {
  const bytes = Buffer.alloc(length);
  png.copy(bytes);
  return bytes;
}
afterEach(() => vi.useRealTimers());

describe("closed current-scene canvas SVG export", () => {
  it("escapes plain text and titles while links remain inert URL labels", async () => {
    const result = await renderCanvasSvg({
      objects: [
        object({ text: "<script>&\"' Synthetic" }),
        object({
          id: id(2),
          type: "link",
          x: 240,
          width: 500,
          text: "Link label",
          url: "https://example.test/?q=%22&x=1",
        }),
      ],
      region,
      title: '<svg onload="bad">',
      loadImage: unavailable,
    });
    const svg = result.svg.toString();
    expect(svg).toContain("&lt;script&gt;&amp;&quot;&apos;");
    expect(svg).toContain("&lt;svg onload=&quot;bad&quot;&gt;");
    expect(svg).toContain("https://example.test/?q=%22&amp;x=1");
    expect(svg).not.toMatch(/<script|<foreignObject|<style|<a\b|\sonload="|href="https?:/);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it("omits unpublished idea content and never resolves missing or private endpoint fallbacks", async () => {
    const hidden = object({
      id: id(3),
      type: "idea_ref",
      ideaId: id(30),
      text: "",
      idea: {
        id: id(30),
        body: "Pending synthetic body",
        alias: "Synthetic identity",
        groupId: null,
        status: "pending",
        createdAt: "2026-10-01T00:00:00.000Z",
        voteCount: 99,
      },
    });
    const connector = object({
      id: id(4),
      type: "connector",
      from: { objectId: id(1), x: 0, y: 0 },
      to: { objectId: id(3), x: 777, y: 888 },
    });
    const absent = object({ ...connector, id: id(5), to: { objectId: id(99), x: 555, y: 666 } });
    const downstream = object({
      ...connector,
      id: id(6),
      from: { objectId: connector.id, x: 321, y: 432 },
      to: { objectId: id(1), x: 0, y: 0 },
    });
    const result = await renderCanvasSvg({
      objects: [object(), hidden, downstream, connector, absent],
      region,
      loadImage: unavailable,
    });
    expect(result.svg.toString()).not.toMatch(/Pending|identity|voteCount|<line/);
  });

  it("renders only approved idea bodies and authorized native attachments without author metadata", async () => {
    const loadImage = vi.fn(async () => ({ bytes: png, mime: "image/png" as const }));
    const idea = object({
      type: "idea_ref",
      ideaId: id(30),
      text: "",
      idea: {
        id: id(30),
        body: "Approved body",
        alias: "Synthetic identity",
        groupId: id(31),
        status: "approved",
        createdAt: "2026-10-01T00:00:00.000Z",
        voteCount: 99,
        attachments: [{ mediaId: id(40), alt: '<image "description">' }],
        links: [{ url: "https://example.test/private-preview", label: "Excluded preview" }],
      },
    });
    const result = await renderCanvasSvg({ objects: [idea], region, loadImage });
    const svg = result.svg.toString();
    expect(svg).toContain("Approved body");
    expect(svg).toContain("data:image/png;base64,");
    expect(svg).toContain("&lt;image &quot;description&quot;&gt;");
    for (const excluded of [
      "Synthetic identity",
      id(30),
      id(31),
      id(40),
      "voteCount",
      "createdAt",
      "private-preview",
      "Excluded preview",
    ])
      expect(svg).not.toContain(excluded);
    expect(result.mediaIds).toEqual([id(40)]);
    expect(loadImage).toHaveBeenCalledWith(id(40), expect.any(AbortSignal));
  });

  it("clips the world region, keeps rotation and visible endpoint geometry, and omits distant media", async () => {
    const loadImage = vi.fn(unavailable);
    const target = object({ rotation: 90 });
    const line = object({
      id: id(2),
      type: "connector",
      from: { objectId: id(1), anchor: "right", x: 1, y: 2 },
      to: { objectId: null, x: 350, y: 200 },
    });
    const distant = object({
      id: id(3),
      type: "image",
      x: 2000,
      y: 2000,
      mediaId: id(40),
      altText: "Distant image",
    });
    const result = await renderCanvasSvg({
      objects: [target, line, distant],
      region: { x: 25, y: 35, width: 400, height: 300 },
      loadImage,
    });
    expect(result.svg.toString()).toContain('viewBox="25 35 400 300"');
    expect(result.svg.toString()).toContain('clip-path="url(#export-region)"');
    expect(result.svg.toString()).toContain("rotate(90 100 80)");
    expect(result.svg.toString()).toContain('<path d="M120 210 L350 200"');
    expect(loadImage).not.toHaveBeenCalled();
    expect(result.mediaIds).toEqual([]);
  });

  it("exports polygon shapes, routed ports, labels and both coloured arrow markers", async () => {
    const decision = object({ type: "diamond", text: "Decision", width: 200, height: 160 });
    const input = object({
      id: id(2),
      type: "parallelogram",
      x: 300,
      y: 200,
      width: 200,
      height: 160,
      text: "Input",
    });
    const connector = object({
      id: id(3),
      type: "connector",
      text: "Yes <approved>",
      from: { objectId: decision.id, x: 0, y: 0, anchor: "right" },
      to: { objectId: input.id, x: 0, y: 0, anchor: "left" },
      routing: "elbow",
      lineStyle: "dashed",
      startMarker: "arrow",
      endMarker: "arrow",
      lineColor: "blue",
    });
    const result = await renderCanvasSvg({
      objects: [decision, input, connector],
      region: null,
      loadImage: unavailable,
    });
    const svg = result.svg.toString();
    expect(svg).toContain('d="M100 0 L200 80 L100 160 L0 80 Z"');
    expect(svg).toContain('d="M40 0 L200 0 L160 160 L0 160 Z"');
    expect(svg).toContain('d="M220 110 L270 110 L270 280 L320 280"');
    expect(svg).toContain(
      'stroke="#175ca5" stroke-width="2" stroke-dasharray="8 6" marker-start="url(#export-arrow-blue)" marker-end="url(#export-arrow-blue)"',
    );
    expect(svg).toContain("Yes &lt;approved&gt;");
    expect(svg).not.toContain("<foreignObject");
    const removed = await renderCanvasSvg({
      objects: [decision, connector],
      region: null,
      loadImage: unavailable,
    });
    expect(removed.svg.toString()).not.toContain("Yes &lt;approved&gt;");
  });

  it("fits rotated objects and scales output to 4096 without raising world or object caps", async () => {
    const fitted = await renderCanvasSvg({
      objects: [object({ rotation: 90 })],
      region: null,
      loadImage: unavailable,
    });
    expect(fitted.region).toEqual({ x: 39, y: 9, width: 162, height: 202 });
    const large = await renderCanvasSvg({
      objects: [],
      region: { x: 0, y: 0, width: 100000, height: 50000 },
      loadImage: unavailable,
    });
    expect([large.width, large.height]).toEqual([4096, 2048]);
    for (const invalid of [
      { ...region, width: Infinity },
      { ...region, width: 100001 },
      { ...region, height: 0 },
      { ...region, width: Number.MIN_VALUE },
    ])
      await expect(
        renderCanvasSvg({ objects: [], region: invalid, loadImage: unavailable }),
      ).rejects.toMatchObject({ code: "EXPORT_LIMIT" });
    await expect(
      renderCanvasSvg({ objects: Array(501).fill(object()), region, loadImage: unavailable }),
    ).rejects.toMatchObject({ code: "INVALID_EXPORT" });
  });

  it("supports every closed primitive with portable fixed colors and no HTML", async () => {
    const objects = ["sticky", "text", "rect", "ellipse", "frame"].map((type, index) =>
      object({ id: id(index + 1), type }),
    );
    objects.push(
      object({
        id: id(9),
        type: "pen",
        points: [
          [0, 0],
          [100, 100],
        ],
        color: "blue",
      }),
    );
    const result = await renderCanvasSvg({
      objects,
      region,
      background: "transparent",
      loadImage: unavailable,
    });
    expect(result.svg.toString()).toContain("<ellipse");
    expect(result.svg.toString()).toContain('<polyline points="0,0 100,100"');
    expect(result.svg.toString()).toContain('stroke="#175ca5"');
    expect(result.svg.toString()).toContain('font-family="Arial, sans-serif"');
    expect(result.svg.toString()).not.toMatch(/foreignObject|var\(|<style|<html/);
  });

  it("rejects image count, individual size, total SVG bytes and non-native image payloads atomically", async () => {
    const image = (index: number) =>
      object({
        id: id(index + 1),
        type: "image",
        mediaId: id(index + 101),
        altText: "Synthetic image",
      });
    const loadImage = vi.fn(async () => ({ bytes: png, mime: "image/png" as const }));
    await expect(
      renderCanvasSvg({
        objects: Array.from({ length: 26 }, (_, index) => image(index)),
        region,
        loadImage,
      }),
    ).rejects.toMatchObject({ code: "EXPORT_LIMIT" });
    expect(loadImage).not.toHaveBeenCalled();
    await expect(
      renderCanvasSvg({
        objects: [image(0)],
        region,
        loadImage: async () => ({
          bytes: largePng(CANVAS_EXPORT_MAX_IMAGE_BYTES + 1),
          mime: "image/png",
        }),
      }),
    ).rejects.toMatchObject({ code: "EXPORT_LIMIT" });
    await expect(
      renderCanvasSvg({
        objects: [image(0), image(1)],
        region,
        loadImage: async () => ({ bytes: largePng(8 * 1024 * 1024), mime: "image/png" }),
      }),
    ).rejects.toMatchObject({ code: "EXPORT_LIMIT" });
    expect((16 * 1024 * 1024 * 4) / 3).toBeGreaterThan(CANVAS_EXPORT_MAX_BYTES);
    await expect(
      renderCanvasSvg({
        objects: [image(0)],
        region,
        loadImage: async () => ({ bytes: Buffer.from('<svg onload="bad"/>'), mime: "image/png" }),
      }),
    ).rejects.toMatchObject({ code: "EXPORT_MEDIA_UNAVAILABLE" });
    await expect(
      renderCanvasSvg({ objects: [image(0)], region, loadImage: unavailable }),
    ).rejects.toMatchObject({ message: "EXPORT_MEDIA_UNAVAILABLE" });
  });

  it("aborts media work on cancellation and timeout without returning partial bytes", async () => {
    vi.useFakeTimers();
    const image = object({ type: "image", mediaId: id(101), altText: "Synthetic image" });
    let mediaSignal: AbortSignal | undefined;
    const loadImage = vi.fn((_id: string, signal: AbortSignal) => {
      mediaSignal = signal;
      return new Promise<{ bytes: Uint8Array; mime: "image/png" }>(() => undefined);
    });
    const controller = new AbortController();
    const cancelled = renderCanvasSvg({
      objects: [image],
      region,
      loadImage,
      signal: controller.signal,
    });
    const rejection = expect(cancelled).rejects.toMatchObject({ code: "EXPORT_CANCELLED" });
    controller.abort();
    await rejection;
    expect(mediaSignal?.aborted).toBe(true);
    const timed = renderCanvasSvg({ objects: [image], region, loadImage });
    const timeout = expect(timed).rejects.toMatchObject({ code: "EXPORT_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(CANVAS_EXPORT_TIMEOUT_MS);
    await timeout;
    expect(mediaSignal?.aborted).toBe(true);
  });
});
