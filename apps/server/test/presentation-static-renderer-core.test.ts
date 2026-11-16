import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type * as CanvasModule from "@napi-rs/canvas";
import {
  PRESENTATION_MOTION_BACKGROUND_PRESETS,
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
    motionBackground?: NonNullable<PresentationScene["design"]>["motionBackground"];
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
      schemaVersion: options.motionBackground ? 8 : 6,
      aspectRatio: "16:9",
      nodes: ordered,
      readingOrder: options.readingOrder ?? ordered.map((node) => node.id),
      ...(options.theme || options.motionBackground
        ? {
            design: {
              theme: options.theme ?? "paper",
              font: "sans",
              spacing: "relaxed",
              ...(options.motionBackground ? { motionBackground: options.motionBackground } : {}),
            },
          }
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
  it.each([
    ["fr", "Choisir ensemble"],
    ["ja", "一緒に決めましょう"],
  ] as const)(
    "annotates the generated English link notice separately from authored %s rich text",
    async (lang, label) => {
      const block = native([
        {
          id: "translated-link",
          type: "text",
          role: "body",
          text: label,
          lang,
          richText: {
            paragraphs: [
              {
                kind: "paragraph",
                runs: [{ text: label, bold: true, href: "https://example.test/evidence" }],
              },
            ],
          },
          frame: { x: 5, y: 25, width: 90, height: 20 },
        },
      ]);
      block.scene!.schemaVersion = 7;
      const title = block.scene!.nodes.find(
        (node) => node.type === "text" && node.role === "title",
      );
      if (title?.type !== "text") throw new Error("Expected a native title");
      title.text = label;
      title.lang = lang;
      const result = await renderPresentationStaticCore({
        review: review([block]),
        images: new Map(),
        format: "offline_html",
      });
      expect(result.bytes.toString()).toContain(`Page 1: <span lang="${lang}">${label}</span></a>`);
      const html = result.bytes.toString("utf8");
      expect(html).toContain(`<div lang="${lang}"><p><a href="https://example.test/evidence"`);
      expect(html).toContain(
        `<strong>${label}</strong><span class="external-notice" lang="en"> (leaves this file; may require internet access)</span></a>`,
      );
    },
  );

  it.each(["html", "offline_html"] as const)(
    "retains separate language annotations on plain and formatted text in %s",
    async (format) => {
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
        format,
      });
      const html = result.bytes.toString("utf8");
      expect(html).toContain('<p lang="fr">Choisir ensemble</p>');
      expect(html).toContain('<div lang="ja"><p><strong>一緒に決めましょう</strong></p></div>');
      expect(html).toContain("<h3>Published visual</h3>");
    },
  );
  it.each(["html", "offline_html"] as const)(
    "preserves semantic order, tables, full panel text and safe links in %s without scripts or remote resources",
    async (format) => {
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
        format,
      });
      const html = result.bytes.toString("utf8");
      expect(result.contentType).toBe(format === "html" ? "text/html; charset=utf-8" : "text/html");
      expect(html).toContain("Deck &lt;script&gt; &amp; &quot;quoted&quot;");
      expect(html.indexOf("READING_FIRST")).toBeLessThan(html.indexOf("READING_LAST"));
      expect(html.indexOf("LEGACY_FIRST")).toBeLessThan(html.indexOf("LEGACY_LAST"));
      expect(html).toContain("<ul><li><em>Safe </em>");
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<caption>Decision &lt;table&gt;</caption>");
      expect(html).toContain("<tr><td>A &amp; B</td><td>7</td></tr>");
      expect(html).toContain(
        format === "html" ? "<h3>Public reveal</h3>" : "<summary>Public reveal</summary>",
      );
      expect(html).toContain(
        "&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt; &amp; final detail.",
      );
      expect(html).toContain("Readable detail. ".repeat(100));
      expect(html).toContain("HOTSPOT_COMPLETE");
      expect(html).toContain("Approves: Decision start → Decision finish");
      expect(html).toContain(`href="#page-${legacy.id}"`);
      expect(html).toContain(
        format === "html"
          ? `href="#page-${nativeBlock.id}">Public section`
          : 'href="#section-1">Public section',
      );
      expect(html).toContain('alt="Red, green and blue workflow bands"');
      expect(html).toContain('href="https://example.test/source?a=1&amp;b=2"');
      expect(html).toContain("default-src 'none'; img-src data:");
      expect(html).not.toMatch(
        /<(?:script|form|input|button|iframe|object|embed|link|video|audio)\b|\son(?:load|error)=|\bsrc=["']https?:/i,
      );
      const imageSources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]);
      expect(imageSources).toHaveLength(3);
      expect(imageSources.every((src) => src!.startsWith("data:image/png;base64,"))).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      if (format === "offline_html") {
        expect(html.match(/<details>/g)).toHaveLength(3);
        expect(html).not.toMatch(/<details[^>]+\bopen\b/i);
        expect(html).toContain(
          "Published broadcast reveal content is a local disclosure in this file",
        );
        expect(html).toContain("revoking access cannot revoke downloaded copies");
        expect(html).toContain(
          "no responses, submissions, answer keys, scoring, live results or completion tracking",
        );
        expect(html).toContain("Next page</a>");
        expect(html).toContain("Previous page</a>");
        expect(html).toContain('id="presentation-index"');
        expect(html.match(/leaves this file; may require internet access/g)).toHaveLength(2);
        expect(html.match(/class="external-notice" lang="en"/g)).toHaveLength(2);
        for (const directive of [
          "script-src",
          "connect-src",
          "frame-src",
          "object-src",
          "base-uri",
          "form-action",
        ])
          expect(html).toContain(`${directive} 'none'`);
        const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
        expect(new Set(ids).size).toBe(ids.length);
        for (const match of html.matchAll(/href="#([^"]+)"/g)) expect(ids).toContain(match[1]);
        expect(html).not.toMatch(/url\s*\(|@import|\b(?:srcset|action|ping|poster)=/i);
      } else expect(html).not.toContain("<details");
    },
  );

  it("renders unavailable local navigation and empty external links as readable labels without inventing destinations", async () => {
    const block = native([
      {
        id: "unavailable-navigation",
        type: "navigation",
        label: "Unavailable page",
        targetBlockId: id(90),
        frame: { x: 5, y: 30, width: 40, height: 10 },
      },
      {
        id: "empty-link",
        type: "link",
        label: "Source not provided",
        href: "",
        frame: { x: 5, y: 50, width: 40, height: 10 },
      },
      {
        id: "early-dialog",
        type: "dialog",
        scope: "local",
        label: "Read a detail",
        detailTitle: "Detail before the page title",
        body: "Public body",
        frame: { x: 5, y: 70, width: 40, height: 10 },
      },
    ]);
    block.scene!.readingOrder = [
      ...block.scene!.readingOrder.filter((id) => id !== "title"),
      "title",
    ];
    const result = await renderPresentationStaticCore({
      review: review([block]),
      images: new Map(),
      format: "offline_html",
    });
    const html = result.bytes.toString("utf8");
    expect(html).toContain("Unavailable page (target unavailable in this file)");
    expect(html).toContain("<p>Source not provided</p>");
    expect(html).not.toContain(`href="#page-${id(90)}"`);
    expect(html).not.toContain('href=""');
    expect(html).toContain("<h3>Detail before the page title</h3>");
    expect(html.indexOf("<h3>Detail before the page title</h3>")).toBeLessThan(
      html.indexOf("<h3>Published visual</h3>"),
    );
    expect(html).not.toContain("<h4>");
    expect(html).not.toMatch(/versionId|expiresAt|2099-01-01|schemaVersion/);
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

  it.each(["png", "html", "offline_html"] as const)(
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

describe("Presentation static motion posters", () => {
  const themes = [
    { theme: "paper", background: "#fffdf7", text: "#172b4d" },
    { theme: "midnight", background: "#111b2e", text: "#f6f8ff" },
    { theme: "ocean", background: "#eaf8fa", text: "#113945" },
    { theme: "sunset", background: "#fff0e5", text: "#522a20" },
  ] as const;
  const renderPng = (block: Content) =>
    renderPresentationStaticCore({
      review: review([block]),
      images: new Map(),
      format: "png",
      blockId: block.id,
    });
  function luminance(channels: number[]) {
    const linear = channels.slice(0, 3).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  }

  it.each(
    themes.flatMap((theme) =>
      PRESENTATION_MOTION_BACKGROUND_PRESETS.map((motionBackground) => ({
        ...theme,
        motionBackground,
      })),
    ),
  )(
    "paints a deterministic, opaque, readable $motionBackground still in the $theme theme",
    async ({ theme, background, text, motionBackground }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("Network forbidden"))),
      );
      const block = native([], { theme, motionBackground });
      const first = await renderPng(block),
        second = await renderPng(block);
      expect(first.bytes.equals(second.bytes)).toBe(true);
      expect(decoded.loadImage).not.toHaveBeenCalled();
      const ctx = await png(block);
      expect(countColor(ctx, background, [0, 140, 1280, 580])).toBeLessThan(1280 * 580 - 100);
      const textLuminance = luminance(rgb(text));
      for (let y = 144; y < 720; y += 24)
        for (let x = 0; x < 1280; x += 24) {
          const color = pixel(ctx, x, y),
            backgroundLuminance = luminance(color);
          expect(color[3]).toBe(255);
          expect(
            (Math.max(textLuminance, backgroundLuminance) + 0.05) /
              (Math.min(textLuminance, backgroundLuminance) + 0.05),
          ).toBeGreaterThanOrEqual(7);
        }
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(themes)(
    "preserves every legacy $theme pixel when the motion token is omitted",
    async ({ theme, background }) => {
      const legacy = native([], { theme }),
        current = structuredClone(legacy);
      current.scene!.schemaVersion = 8;
      const before = await renderPng(legacy),
        after = await renderPng(current);
      expect(after.bytes.equals(before.bytes)).toBe(true);
      const ctx = await png(current);
      expect(countColor(ctx, background, [0, 140, 1280, 580])).toBe(1280 * 580);
    },
  );

  it.each(["html", "offline_html"] as const)(
    "embeds the exact PNG still for all six presets in self-contained %s with readable content",
    async (format) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("Network forbidden"))),
      );
      const blocks = PRESENTATION_MOTION_BACKGROUND_PRESETS.map((motionBackground, index) => ({
        ...native([], { theme: "midnight", motionBackground }),
        id: id(index + 1),
      }));
      const result = await renderPresentationStaticCore({
        review: review(blocks),
        images: new Map(),
        format,
      });
      const html = result.bytes.toString("utf8"),
        snapshots = [...html.matchAll(/class="snapshot" src="data:image\/png;base64,([^"]+)"/g)];
      expect(snapshots).toHaveLength(6);
      expect(new Set(snapshots.map((snapshot) => snapshot[1])).size).toBe(6);
      for (const [index, block] of blocks.entries()) {
        const expected = await renderPng(block);
        expect(Buffer.from(snapshots[index]![1]!, "base64").equals(expected.bytes)).toBe(true);
      }
      expect(html.match(/<h3>Published visual<\/h3>/g)).toHaveLength(6);
      expect(html).not.toMatch(
        /<(?:script|iframe|object|embed|video|audio|link)\b|\son(?:load|error)=|\bsrc=["']https?:|url\s*\(|@import|animation|requestAnimationFrame/i,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("round-trips all six poster compositions through flattened PDF pages", async () => {
    const blocks = PRESENTATION_MOTION_BACKGROUND_PRESETS.map((motionBackground, index) => ({
      ...native([], { theme: "ocean", motionBackground }),
      id: id(index + 1),
    }));
    const result = await renderPresentationStaticCore({
      review: review(blocks),
      images: new Map(),
      format: "pdf",
    });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"),
      task = pdfjs.getDocument({
        data: new Uint8Array(result.bytes),
        useSystemFonts: false,
        verbosity: 0,
      });
    const document = await task.promise;
    try {
      expect(document.numPages).toBe(6);
      expect(await document.getJSActions()).toBeNull();
      for (const [index, block] of blocks.entries()) {
        const expected = await png(block),
          page = await document.getPage(index + 1),
          canvas = createCanvas(1280, 720),
          ctx = canvas.getContext("2d");
        await page.render({
          canvas: null,
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport: page.getViewport({ scale: 1 }),
        }).promise;
        expect(await page.getAnnotations()).toEqual([]);
        for (const [x, y] of [
          [64, 180],
          [1050, 490],
          [640, 650],
        ])
          expect(pixel(ctx, x!, y!)).toEqual(pixel(expected, x!, y!));
      }
    } finally {
      await task.destroy();
    }
  }, 20_000);

  it.each([
    "https://example.test/motion.svg",
    "url(https://example.test/motion)",
    "unknown",
    { preset: "aurora" },
  ])(
    "rejects an unrecognized motion token before any image or network work: %j",
    async (motionBackground) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("Network forbidden"))),
      );
      const block = native([], { motionBackground: "aurora" });
      Object.assign(block.scene!.design!, { motionBackground });
      await expect(renderPng(block)).rejects.toMatchObject({ code: "EXPORT_INVALID" });
      expect(decoded.loadImage).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
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
