import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type * as CanvasModule from "@napi-rs/canvas";
import {
  type PresentationReview,
  type PresentationReviewBlock,
  type PresentationScene,
  type PresentationSceneNode,
} from "@openround/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderPresentationStaticCore } from "../src/presentation-static-renderer-core.js";

const decoded = vi.hoisted(() => ({ loadImage: vi.fn<typeof CanvasModule.loadImage>() }));
vi.mock("@napi-rs/canvas", async (original) => {
  const canvas = await original<typeof CanvasModule>();
  decoded.loadImage.mockImplementation(canvas.loadImage);
  return { ...canvas, loadImage: decoded.loadImage };
});

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
type Content = Extract<PresentationReviewBlock, { kind: "content" }>;
type Chart = Extract<PresentationSceneNode, { type: "chart" }>;
type ImageNode = Extract<PresentationSceneNode, { type: "image" }>;
const title: PresentationSceneNode = {
  id: "title",
  type: "text",
  role: "title",
  text: "Published visual",
  frame: { x: 2, y: 2, width: 90, height: 12 },
};
function native(
  nodes: PresentationSceneNode[],
  options: {
    theme?: NonNullable<PresentationScene["design"]>["theme"];
    readingOrder?: string[];
  } = {},
): Content {
  const ordered = [structuredClone(title), ...nodes];
  return {
    id: id(1),
    kind: "content",
    layout: "title_body",
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    scene: {
      schemaVersion: 6,
      aspectRatio: "16:9",
      nodes: ordered,
      readingOrder: options.readingOrder ?? ordered.map((node) => node.id),
      ...(options.theme
        ? { design: { theme: options.theme, font: "sans", spacing: "relaxed" } }
        : {}),
    },
  };
}
function review(blocks: PresentationReviewBlock[]): PresentationReview {
  return {
    schemaVersion: 1,
    versionId: id(99),
    version: 3,
    title: "Published presentation",
    blocks,
    sections: [],
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}
function bands() {
  const canvas = createCanvas(30, 10),
    ctx = canvas.getContext("2d");
  for (const [index, color] of ["#ff0000", "#00ff00", "#0000ff"].entries()) {
    ctx.fillStyle = color;
    ctx.fillRect(index * 10, 0, 10, 10);
  }
  return canvas.toBuffer("image/png");
}
function images(bytes = bands()) {
  return new Map([[id(10), { bytes, contentType: "image/png" }]]);
}
function imageNode(patch: Partial<ImageNode> = {}): ImageNode {
  return {
    id: "image",
    type: "image",
    mediaId: id(10),
    altText: "Red, green and blue workflow bands",
    frame: { x: 30, y: 30, width: 18.75, height: 100 / 3 },
    ...patch,
  };
}
async function png(
  block: Content,
  media = new Map<string, { bytes: Buffer; contentType: string }>(),
) {
  const result = await renderPresentationStaticCore({
    review: review([block]),
    images: media,
    format: "png",
    blockId: block.id,
  });
  expect(result.contentType).toBe("image/png");
  expect(result.extension).toBe("png");
  const image = await loadImage(result.bytes),
    canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  expect([image.width, image.height]).toEqual([1280, 720]);
  return ctx;
}
function rgb(hex: string) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
}
function pixel(ctx: SKRSContext2D, x: number, y: number) {
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}
function countColor(ctx: SKRSContext2D, hex: string, bounds = [0, 0, 1280, 720]) {
  const [x, y, width, height] = bounds as [number, number, number, number];
  const data = ctx.getImageData(x, y, width, height).data,
    target = rgb(hex);
  let count = 0;
  for (let index = 0; index < data.length; index += 4)
    if (
      target.every((value, channel) => data[index + channel] === value) &&
      data[index + 3] === 255
    )
      count++;
  return count;
}
function chart(chartType: Chart["chartType"]): Chart {
  return {
    id: "chart",
    type: "chart",
    chartType,
    title: "Accepted responses",
    summary: "A declared data summary",
    categories: ["First", "Second", "Third"],
    series: [{ name: "Responses", values: [2, 4, 1] }],
    frame: { x: 5, y: 20, width: 90, height: 75 },
  };
}
beforeEach(() => {
  decoded.loadImage.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("Presentation static renderer visual output", () => {
  it.each([
    ["paper", "#fffdf7"],
    ["midnight", "#111b2e"],
    ["ocean", "#eaf8fa"],
    ["sunset", "#fff0e5"],
  ] as const)(
    "preserves the %s background across the complete slide without adding a footer",
    async (theme, color) => {
      const ctx = await png(native([], { theme }));
      expect(pixel(ctx, 1270, 500)).toEqual([...rgb(color), 255]);
      expect(countColor(ctx, color, [0, 680, 1280, 40])).toBe(1280 * 40);
    },
  );

  it("contains a wide image with letterboxing and preserves its three bands", async () => {
    const ctx = await png(native([imageNode({ fit: "contain" })]), images());
    expect(pixel(ctx, 504, 230)).toEqual([255, 255, 255, 255]);
    expect(pixel(ctx, 400, 336)).toEqual([255, 0, 0, 255]);
    expect(pixel(ctx, 504, 336)).toEqual([0, 255, 0, 255]);
    expect(pixel(ctx, 600, 336)).toEqual([0, 0, 255, 255]);
    expect(pixel(ctx, 300, 336)).toEqual([255, 255, 255, 255]);
  });

  it.each([
    [0, [255, 0, 0, 255]],
    [100, [0, 0, 255, 255]],
  ] as const)("cover-crops to the authored horizontal focal point %s", async (x, expected) => {
    const ctx = await png(
      native([imageNode({ fit: "cover", focalPoint: { x, y: 50 } })]),
      images(),
    );
    expect(pixel(ctx, 504, 336)).toEqual(expected);
    expect(pixel(ctx, 400, 230)).toEqual(expected);
    expect(pixel(ctx, 300, 336)).toEqual([255, 255, 255, 255]);
  });

  it("rotates a shape in the physical slide plane and attaches its connector to the rotated anchor", async () => {
    const ctx = await png(
      native([
        {
          id: "start",
          type: "shape",
          shape: "rectangle",
          color: "red",
          label: "Start",
          frame: { x: 20, y: 30, width: 20, height: 10 },
          rotation: 90,
        },
        {
          id: "finish",
          type: "shape",
          shape: "ellipse",
          color: "blue",
          label: "Finish",
          frame: { x: 70, y: 30, width: 10, height: 15 },
        },
        {
          id: "route",
          type: "connector",
          from: { nodeId: "start", anchor: "right" },
          to: { nodeId: "finish", anchor: "left" },
          label: "Routes",
          color: "black",
        },
      ]),
    );
    expect(pixel(ctx, 384, 150)).toEqual([255, 209, 204, 255]);
    expect(pixel(ctx, 270, 252)).toEqual([255, 255, 255, 255]);
    expect(pixel(ctx, 960, 300)).toEqual([205, 231, 255, 255]);
    expect(countColor(ctx, "#202938", [638, 323, 5, 5])).toBeGreaterThan(0);
  });

  it.each(
    [
      { theme: undefined, background: "#ffffff", palette: "default white" },
      { theme: "paper" as const, background: "#fffdf7", palette: "paper" },
      { theme: "midnight" as const, background: "#111b2e", palette: "midnight" },
    ].flatMap((palette) => (["table", "chart"] as const).map((kind) => ({ ...palette, kind }))),
  )(
    "paints an opaque $kind frame over lower shape and image layers with the $palette palette",
    async ({ theme, background, kind }) => {
      const dataFrame = { x: 20, y: 25, width: 60, height: 60 };
      const data: PresentationSceneNode =
        kind === "table"
          ? {
              id: "table",
              type: "table",
              caption: "Count",
              headers: ["Value"],
              rows: [["7"]],
              frame: dataFrame,
            }
          : { ...chart("bar"), frame: dataFrame };
      const ctx = await png(
        native(
          [
            {
              id: "lower-shape",
              type: "shape",
              shape: "rectangle",
              color: "red",
              label: "",
              frame: { x: 10, y: 20, width: 80, height: 70 },
            },
            imageNode({
              id: "lower-image",
              fit: "cover",
              focalPoint: { x: 100, y: 50 },
              frame: { x: 50, y: 20, width: 40, height: 70 },
            }),
            data,
          ],
          { theme },
        ),
        images(),
      );
      // The overlay covers its own authored frame, preserving both lower layers outside it.
      expect(pixel(ctx, 200, 500)).toEqual([255, 209, 204, 255]);
      expect(pixel(ctx, 1100, 500)).toEqual([0, 0, 255, 255]);
      expect(pixel(ctx, 1200, 700)).toEqual([...rgb(background), 255]);
      expect([pixel(ctx, 300, 560), pixel(ctx, 900, 560)]).toEqual([
        [...rgb(background), 255],
        [...rgb(background), 255],
      ]);
    },
  );

  it("keeps a rotated table opaque only within its rotated frame", async () => {
    const ctx = await png(
      native(
        [
          {
            id: "lower-shape",
            type: "shape",
            shape: "rectangle",
            color: "red",
            label: "",
            frame: { x: 20, y: 15, width: 60, height: 75 },
          },
          imageNode({
            id: "lower-image",
            fit: "cover",
            focalPoint: { x: 100, y: 50 },
            frame: { x: 50, y: 15, width: 30, height: 75 },
          }),
          {
            id: "table",
            type: "table",
            caption: "Count",
            headers: ["Value"],
            rows: [["7"]],
            frame: { x: 30, y: 40, width: 40, height: 20 },
            rotation: 90,
          },
        ],
        { theme: "midnight" },
      ),
      images(),
    );
    expect(pixel(ctx, 450, 360)).toEqual([255, 209, 204, 255]);
    expect(pixel(ctx, 850, 360)).toEqual([0, 0, 255, 255]);
    expect(pixel(ctx, 640, 630)).toEqual([0, 0, 255, 255]);
    expect([pixel(ctx, 582, 504), pixel(ctx, 697, 504)]).toEqual([
      [17, 27, 46, 255],
      [17, 27, 46, 255],
    ]);
  });

  it("renders distinct bar, line and pie geometry while retaining the complete chart data", async () => {
    const colors = new Map<string, number>();
    for (const kind of ["bar", "line", "pie"] as const) {
      const result = await renderPresentationStaticCore({
        review: review([native([chart(kind)])]),
        images: new Map(),
        format: "html",
      });
      const html = result.bytes.toString("utf8");
      expect(html).toContain("<caption>Accepted responses - chart data</caption>");
      expect(html).toContain('<th scope="col">Responses</th>');
      expect(html).toContain("<tr><td>First</td><td>2</td></tr>");
      expect(html).toContain("<tr><td>Second</td><td>4</td></tr>");
      expect(html).toContain("<tr><td>Third</td><td>1</td></tr>");
      const bytes = Buffer.from(
        html.match(/class="snapshot" src="data:image\/png;base64,([^"]+)"/)![1]!,
        "base64",
      );
      const image = await loadImage(bytes),
        canvas = createCanvas(1280, 720),
        ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const painted = countColor(ctx, "#3676ac");
      expect(painted).toBeGreaterThan(300);
      colors.set(kind, painted);
    }
    expect(colors.get("bar")!).toBeGreaterThan(colors.get("line")! * 4);
    expect(colors.get("pie")!).toBeGreaterThan(colors.get("line")! * 2);
    expect(colors.get("bar")).not.toBe(colors.get("pie"));
  });
});

describe("Presentation static HTML readable companion", () => {
  it("retains separate language annotations on plain and formatted text in the readable export", async () => {
    const block = native([
      {
        id: "translated-body",
        type: "text",
        role: "body",
        text: "Choisir ensemble",
        lang: "fr",
        frame: { x: 8, y: 25, width: 84, height: 20 },
      },
      {
        id: "formatted-body",
        type: "text",
        role: "body",
        text: "一緒に決めましょう",
        lang: "ja",
        richText: {
          paragraphs: [{ kind: "paragraph", runs: [{ text: "一緒に決めましょう", bold: true }] }],
        },
        frame: { x: 8, y: 55, width: 84, height: 20 },
      },
    ]);
    block.scene!.schemaVersion = 7;
    const result = await renderPresentationStaticCore({
      review: review([block]),
      images: new Map(),
      format: "html",
    });
    const html = result.bytes.toString("utf8");
    expect(html).toContain('<p lang="fr">Choisir ensemble</p>');
    expect(html).toContain('<div lang="ja"><p><strong>一緒に決めましょう</strong></p></div>');
    expect(html).toContain("<h3>Published visual</h3>");
  });
  it("preserves semantic order, tables, full panel text and safe links without scripts or remote resources", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const panelBody = `Full public detail <script>alert("unsafe")</script> & final detail.`;
    const first: PresentationSceneNode = {
      id: "first",
      type: "text",
      role: "body",
      text: "READING_FIRST\nSafe bold\nSecond item",
      richText: {
        paragraphs: [
          { kind: "paragraph", runs: [{ text: "READING_FIRST" }] },
          {
            kind: "bullet",
            runs: [
              { text: "Safe ", italic: true },
              { text: "bold", bold: true, href: "https://example.test/evidence?a=1&b=2" },
            ],
          },
          { kind: "bullet", runs: [{ text: "Second item" }] },
        ],
      },
      frame: { x: 5, y: 16, width: 40, height: 12 },
    };
    const nodes: PresentationSceneNode[] = [
      {
        id: "last",
        type: "text",
        role: "body",
        text: "READING_LAST",
        frame: { x: 5, y: 80, width: 40, height: 10 },
      },
      first,
      imageNode(),
      {
        id: "table",
        type: "table",
        caption: "Decision <table>",
        headers: ["Option", "Count"],
        rows: [
          ["A & B", "7"],
          ["C", "2"],
        ],
        frame: { x: 5, y: 40, width: 40, height: 25 },
      },
      {
        id: "reveal",
        type: "reveal",
        scope: "broadcast",
        label: "Public reveal",
        body: panelBody,
        frame: { x: 55, y: 16, width: 40, height: 10 },
      },
      {
        id: "detail",
        type: "dialog",
        scope: "local",
        label: "Local details",
        detailTitle: "All detail text",
        body: "DIALOG_END " + "Readable detail. ".repeat(100),
        frame: { x: 55, y: 75, width: 40, height: 10 },
      },
      {
        id: "hotspot",
        type: "hotspot",
        scope: "local",
        imageNodeId: "image",
        label: "Image detail",
        detailTitle: "Workflow detail",
        body: "HOTSPOT_COMPLETE",
        frame: { x: 35, y: 35, width: 5, height: 5 },
      },
      {
        id: "link",
        type: "link",
        label: "Source & evidence",
        href: "https://example.test/source?a=1&b=2",
        frame: { x: 55, y: 88, width: 40, height: 8 },
      },
      {
        id: "navigation",
        type: "navigation",
        label: "Read next",
        targetBlockId: id(2),
        frame: { x: 5, y: 90, width: 40, height: 8 },
      },
      {
        id: "start",
        type: "shape",
        shape: "diamond",
        color: "green",
        label: "Decision start",
        frame: { x: 60, y: 40, width: 10, height: 12 },
      },
      {
        id: "finish",
        type: "shape",
        shape: "ellipse",
        color: "blue",
        label: "Decision finish",
        frame: { x: 80, y: 40, width: 10, height: 12 },
      },
      {
        id: "route",
        type: "connector",
        from: { nodeId: "start", anchor: "right" },
        to: { nodeId: "finish", anchor: "left" },
        label: "Approves",
        color: "blue",
      },
    ];
    const nativeBlock = native(nodes, {
      readingOrder: [
        "title",
        "first",
        "table",
        "image",
        "reveal",
        "detail",
        "hotspot",
        "link",
        "navigation",
        "start",
        "route",
        "finish",
        "last",
      ],
    });
    const legacy: Content = {
      id: id(2),
      kind: "content",
      layout: "title_body",
      mediaId: null,
      mediaAlt: null,
      textElements: [
        { id: "late", role: "body", text: "LEGACY_LAST", region: "middle_left", order: 2 },
        { id: "heading", role: "title", text: "Legacy heading", region: "top_center", order: 0 },
        { id: "early", role: "body", text: "LEGACY_FIRST", region: "middle_right", order: 1 },
      ],
    };
    const value = review([nativeBlock, legacy]);
    value.title = 'Deck <script> & "quoted"';
    value.sections = [
      { id: id(5), title: "Public section", blockIds: [nativeBlock.id, legacy.id] },
    ];
    const result = await renderPresentationStaticCore({
      review: value,
      images: images(),
      format: "html",
    });
    const html = result.bytes.toString("utf8");
    expect(result.contentType).toBe("text/html; charset=utf-8");
    expect(html).toContain("Deck &lt;script&gt; &amp; &quot;quoted&quot;");
    expect(html.indexOf("READING_FIRST")).toBeLessThan(html.indexOf("READING_LAST"));
    expect(html.indexOf("LEGACY_FIRST")).toBeLessThan(html.indexOf("LEGACY_LAST"));
    expect(html).toContain("<ul><li><em>Safe </em>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<caption>Decision &lt;table&gt;</caption>");
    expect(html).toContain("<tr><td>A &amp; B</td><td>7</td></tr>");
    expect(html).toContain("<h3>Public reveal</h3>");
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt; &amp; final detail.",
    );
    expect(html).toContain("Readable detail. ".repeat(100));
    expect(html).toContain("HOTSPOT_COMPLETE");
    expect(html).toContain("Approves: Decision start → Decision finish");
    expect(html).toContain(`href="#page-${legacy.id}"`);
    expect(html).toContain(`href="#page-${nativeBlock.id}">Public section`);
    expect(html).toContain('alt="Red, green and blue workflow bands"');
    expect(html).toContain('href="https://example.test/source?a=1&amp;b=2"');
    expect(html).toContain("default-src 'none'; img-src data:");
    expect(html).not.toMatch(
      /<(?:script|iframe|object|link)\b|\son(?:load|error)=|\bsrc=["']https?:/i,
    );
    const imageSources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]);
    expect(imageSources).toHaveLength(3);
    expect(imageSources.every((src) => src!.startsWith("data:image/png;base64,"))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders CJK and emoji text with the bundled glyph coverage and retains its exact readable text", async () => {
    const block = native([]);
    const heading = block.scene!.nodes[0]!;
    if (heading.type !== "text") throw new Error("Title fixture required");
    heading.text = "中文 日本語 한국어 😀";
    const result = await renderPresentationStaticCore({
      review: review([block]),
      images: new Map(),
      format: "html",
    });
    const html = result.bytes.toString("utf8");
    expect(html).toContain(`<h3>${heading.text}</h3>`);
    expect(html).not.toContain("\uFFFD");
    const ctx = await png(block);
    expect(countColor(ctx, "#ffffff", [25, 14, 600, 70])).toBeLessThan(600 * 70 - 100);
  });

  it.each(["png", "html"] as const)(
    "fails clearly for an unsupported visible glyph in %s",
    async (format) => {
      const block = native([]),
        heading = block.scene!.nodes[0]!;
      if (heading.type !== "text") throw new Error("Title fixture required");
      heading.text = "Unsupported " + String.fromCodePoint(0x10ffff);
      await expect(
        renderPresentationStaticCore({
          review: review([block]),
          images: new Map(),
          format,
          ...(format === "png" ? { blockId: block.id } : {}),
        }),
      ).rejects.toMatchObject({
        code: "EXPORT_INVALID",
        message: expect.stringContaining("supported characters"),
      });
    },
  );
});

describe("Presentation static renderer image admission", () => {
  function claimedDimensions(width: number, height: number) {
    const bytes = Buffer.from(bands());
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
  }

  it("rejects a claimed image larger than 16 million pixels before native decoding", async () => {
    await expect(
      renderPresentationStaticCore({
        review: review([native([imageNode()])]),
        images: images(claimedDimensions(4001, 4000)),
        format: "png",
        blockId: id(1),
      }),
    ).rejects.toMatchObject({ code: "EXPORT_LIMIT" });
    expect(decoded.loadImage).not.toHaveBeenCalled();
  });

  it("rejects aggregate claimed pixels above 32 million before decoding any one image", async () => {
    const media = new Map(
      [10, 11, 12].map((value) => [
        id(value),
        { bytes: claimedDimensions(4000, 3000), contentType: "image/png" },
      ]),
    );
    const nodes = [10, 11, 12].map((value) =>
      imageNode({ id: `image-${value}`, mediaId: id(value) }),
    );
    await expect(
      renderPresentationStaticCore({
        review: review([native(nodes)]),
        images: media,
        format: "png",
        blockId: id(1),
      }),
    ).rejects.toMatchObject({ code: "EXPORT_LIMIT" });
    expect(decoded.loadImage).not.toHaveBeenCalled();
  });

  it("fails closed when a referenced published image is missing", async () => {
    await expect(
      renderPresentationStaticCore({
        review: review([native([imageNode()])]),
        images: new Map(),
        format: "html",
      }),
    ).rejects.toMatchObject({ code: "EXPORT_MEDIA_UNAVAILABLE" });
    expect(decoded.loadImage).not.toHaveBeenCalled();
  });

  it("decodes a shared image once across repeated nodes and pages", async () => {
    const first = native([
      imageNode(),
      imageNode({ id: "second-image", frame: { x: 5, y: 65, width: 20, height: 20 } }),
    ]);
    const second = structuredClone(first);
    second.id = id(2);
    const result = await renderPresentationStaticCore({
      review: review([first, second]),
      images: images(),
      format: "html",
    });
    expect(decoded.loadImage).toHaveBeenCalledTimes(1);
    expect(result.bytes.toString("utf8").match(/class="snapshot"/g)).toHaveLength(2);
  });
});
