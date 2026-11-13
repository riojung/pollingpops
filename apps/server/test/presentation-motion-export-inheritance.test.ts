import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationReviewSchema,
  preparePresentationPublication,
  type PresentationReview,
  type PresentationSceneDesign,
} from "@openround/contracts";
import type { PresentationVersionRecord } from "@openround/db";
import { describe, expect, it, vi } from "vitest";
import { presentationBlockDesign } from "../src/presentation-block-design.js";
import { paintPresentationMotionPoster } from "../src/presentation-motion-poster.js";
import { projectPresentationReview } from "../src/presentation-sharing-projection.js";
import { renderPresentationStaticCore } from "../src/presentation-static-renderer-core.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const ocean: PresentationSceneDesign = {
  theme: "ocean",
  font: "serif",
  spacing: "compact",
  motionBackground: "waves",
};
const sunset: PresentationSceneDesign = { ...ocean, theme: "sunset", motionBackground: "ribbons" };
const still: PresentationSceneDesign = { theme: "paper", font: "sans", spacing: "relaxed" };
function ordinary(value: number) {
  return {
    id: id(value),
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [
      { id: "title", role: "title", text: `Public page ${value}`, region: "top_center", order: 0 },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE_SPEAKER_NOTES",
  };
}
function native(value: number, design?: PresentationSceneDesign) {
  return {
    ...ordinary(value),
    textElements: [],
    scene: {
      schemaVersion: design?.motionBackground ? 8 : design ? 3 : 1,
      aspectRatio: "16:9",
      ...(design ? { design } : {}),
      nodes: [
        {
          id: "title",
          type: "text",
          role: "title",
          text: `Public page ${value}`,
          frame: { x: 2, y: 2, width: 90, height: 12 },
        },
      ],
      readingOrder: ["title"],
    },
  };
}
function question(value: number) {
  return {
    id: id(value),
    kind: "question" as const,
    question: {
      id: id(value + 100),
      type: "single_select",
      prompt: `Public question ${value}`,
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 20,
      basePoints: 1000,
      explanation: "PRIVATE_ANSWER_EXPLANATION",
      mediaId: null,
      mediaAlt: null,
      choices: [
        { id: id(value + 200), label: "Public first option", isCorrect: true },
        { id: id(value + 300), label: "Public second option", isCorrect: false },
      ],
    },
  };
}
function fixture(staticFont?: PresentationSceneDesign["font"]) {
  const draft = PresentationDraftSchema.parse({
    schemaVersion: 17,
    title: "Inherited public motion",
    sections: [],
    blocks: [
      question(1),
      ordinary(2),
      { ...native(3, { ...ocean, theme: "midnight", motionBackground: "stars" }), hidden: true },
      native(4, ocean),
      native(5),
      ordinary(6),
      question(7),
      native(8, still),
      ordinary(9),
      native(10, sunset),
      question(11),
    ],
  });
  if (staticFont)
    for (const block of draft.blocks)
      if (block.kind === "content" && block.scene?.design) {
        delete block.scene.design.motionBackground;
        if (block.scene.design.theme === "ocean") block.scene.design.font = staticFont;
      }
  const version: PresentationVersionRecord = {
    id: id(500),
    workspaceId: id(501),
    presentationId: id(502),
    version: 1,
    content: PresentationContentSchema.parse(preparePresentationPublication(draft)),
    contentSchemaVersion: 17,
    contentHash: "a".repeat(64),
    sourceDraftRevision: 1,
    publishedAt: new Date("2026-11-13T00:00:00.000Z"),
  };
  return { draft, version };
}
function project(version: PresentationVersionRecord) {
  return projectPresentationReview(version, { expiresAt: new Date("2099-01-01T00:00:00.000Z") });
}
const render = (review: PresentationReview, format: "png" | "pdf" | "html" | "offline_html") =>
  renderPresentationStaticCore({
    review,
    images: new Map(),
    format,
    ...(format === "png" ? { blockId: review.blocks[0]!.id } : {}),
  });
async function decode(bytes: Buffer) {
  const image = await loadImage(bytes),
    ctx = createCanvas(1280, 720).getContext("2d");
  ctx.drawImage(image, 0, 0);
  return ctx;
}
const samples = [
  [64, 400],
  [640, 540],
  [1160, 680],
] as const;

describe("static export inherited presentation design", () => {
  it("uses the complete visible donor context, keeps static barriers and preserves source bytes/privacy", () => {
    const { draft, version } = fixture(),
      frozen = JSON.stringify(version);
    for (const blockId of [1, 2, 5, 6, 7]) {
      expect(presentationBlockDesign(draft.blocks, id(blockId))).toEqual(ocean);
      expect(presentationBlockDesign(version.content.blocks, id(blockId))).toEqual(ocean);
    }
    expect(presentationBlockDesign(draft.blocks, id(9))).toEqual(still);
    expect(presentationBlockDesign(draft.blocks, id(11))).toEqual(sunset);
    const review = project(version);
    expect(review.blocks).toHaveLength(10);
    expect(review.blocks.some((block) => block.id === id(3))).toBe(false);
    for (const blockId of [1, 2, 5, 6, 7])
      expect(review.blocks.find((block) => block.id === id(blockId))!.design).toEqual(ocean);
    expect(review.blocks.find((block) => block.id === id(9))!.design).toEqual(still);
    const native = review.blocks.find((block) => block.id === id(5))!;
    expect(native).toMatchObject({ scene: { schemaVersion: 1 } });
    expect(native).not.toHaveProperty("scene.design");
    expect(JSON.stringify(review)).not.toMatch(
      /PRIVATE_|isCorrect|speakerNotes|explanation|hidden/,
    );
    expect(JSON.stringify(version)).toBe(frozen);
  });

  it("paints inherited native, ordinary and question single-page PNGs after their donors are omitted", async () => {
    const { version } = fixture(),
      frozen = JSON.stringify(version),
      review = project(version);
    for (const blockId of [1, 2, 5, 6, 7, 11]) {
      const block = review.blocks.find((block) => block.id === id(blockId))!,
        result = await render({ ...review, blocks: [block] }, "png"),
        ctx = await decode(result.bytes),
        expected = createCanvas(1280, 720).getContext("2d"),
        design = block.design!;
      expected.fillStyle = design.theme === "ocean" ? "#eaf8fa" : "#fff0e5";
      expected.fillRect(0, 0, 1280, 720);
      paintPresentationMotionPoster(expected, design, 1280, 720);
      for (const [x, y] of samples)
        expect(ctx.getImageData(x, y, 1, 1).data).toEqual(expected.getImageData(x, y, 1, 1).data);
    }
    expect(JSON.stringify(version)).toBe(frozen);
  });

  it.each(["html", "offline_html"] as const)(
    "preserves every page's PNG poster in %s without private content or motion code",
    async (format) => {
      const review = project(fixture().version),
        result = await render(review, format),
        html = result.bytes.toString("utf8"),
        snapshots = [...html.matchAll(/class="snapshot" src="data:image\/png;base64,([^"]+)"/g)];
      expect(snapshots).toHaveLength(review.blocks.length);
      for (const [index, block] of review.blocks.entries()) {
        const png = await render({ ...review, blocks: [block] }, "png");
        expect(Buffer.from(snapshots[index]![1]!, "base64").equals(png.bytes)).toBe(true);
      }
      expect(html).toContain("Public question 7");
      expect(html).toContain("Public first option");
      expect(html).not.toMatch(/PRIVATE_|isCorrect|speakerNotes|explanation/);
      expect(html).not.toMatch(/<(?:script|iframe|video|audio)\b|animation|requestAnimationFrame/i);
    },
  );

  it("round-trips the mixed deck's inherited posters through PDF", async () => {
    const review = project(fixture().version),
      result = await render(review, "pdf"),
      pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"),
      task = pdfjs.getDocument({
        data: new Uint8Array(result.bytes),
        useSystemFonts: false,
        verbosity: 0,
      });
    const document = await task.promise;
    try {
      expect(document.numPages).toBe(review.blocks.length);
      expect(await document.getJSActions()).toBeNull();
      for (const [index, block] of review.blocks.entries()) {
        if (!block.design) continue;
        const expected = await decode((await render({ ...review, blocks: [block] }, "png")).bytes),
          page = await document.getPage(index + 1),
          ctx = createCanvas(1280, 720).getContext("2d");
        await page.render({
          canvas: null,
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport: page.getViewport({ scale: 1 }),
        }).promise;
        for (const [x, y] of samples)
          expect(ctx.getImageData(x, y, 1, 1).data).toEqual(expected.getImageData(x, y, 1, 1).data);
      }
    } finally {
      await task.destroy();
    }
  }, 20_000);

  it.each(["serif", "mono"] as const)(
    "paints inherited static palettes and %s fonts on native, ordinary and question single-page PNGs",
    async (font) => {
      const { draft, version } = fixture(font),
        frozen = JSON.stringify(version),
        review = project(version),
        design: PresentationSceneDesign = { theme: "ocean", font, spacing: "compact" };
      for (const blockId of [1, 2, 5, 6, 7]) {
        expect(presentationBlockDesign(draft.blocks, id(blockId))).toEqual(design);
        const block = review.blocks.find((block) => block.id === id(blockId))!;
        expect(block.design).toEqual(design);
        // Render the selected page without its source donors, as an isolated PNG export does.
        const fontSetter = vi.spyOn(
          Object.getPrototypeOf(createCanvas(1, 1).getContext("2d")),
          "font",
          "set",
        );
        let bytes: Buffer;
        try {
          bytes = (await render({ ...review, blocks: [block] }, "png")).bytes;
          // Generic families can share a fallback on export hosts. Verify the requested
          // family at the real canvas boundary while checking rendered palette pixels below.
          const expectedFamily = font === "mono" ? "monospace" : "serif";
          expect(fontSetter.mock.calls.length).toBeGreaterThan(0);
          expect(
            fontSetter.mock.calls.every(([value]) =>
              String(value).endsWith(` ${expectedFamily}, StaticCJK, StaticEmoji`),
            ),
          ).toBe(true);
        } finally {
          fontSetter.mockRestore();
        }
        const ctx = await decode(bytes);
        for (const [x, y] of samples)
          expect(Array.from(ctx.getImageData(x, y, 1, 1).data)).toEqual([234, 248, 250, 255]);
        const pixels = ctx.getImageData(0, 0, 1280, 320).data;
        let textPixels = 0;
        for (let index = 0; index < pixels.length; index += 4)
          if (
            pixels[index] === 17 &&
            pixels[index + 1] === 57 &&
            pixels[index + 2] === 69 &&
            pixels[index + 3] === 255
          )
            textPixels++;
        expect(textPixels).toBeGreaterThan(100);
        if (block.kind === "content" && block.scene) {
          const explicit = await render(
            {
              ...review,
              blocks: [
                {
                  ...block,
                  design: undefined,
                  scene: { ...block.scene, schemaVersion: 3, design },
                },
              ],
            },
            "png",
          );
          expect(bytes.equals(explicit.bytes)).toBe(true);
        }
      }
      expect(review.blocks.find((block) => block.id === id(9))!.design).toEqual(still);
      expect(JSON.stringify(review)).not.toMatch(
        /PRIVATE_|isCorrect|speakerNotes|explanation|hidden/,
      );
      expect(JSON.stringify(version)).toBe(frozen);
    },
  );

  it.each(["html", "offline_html"] as const)(
    "embeds every static design page in %s with identical PNG appearance",
    async (format) => {
      const { version } = fixture("mono"),
        frozen = JSON.stringify(version),
        review = project(version),
        result = await render(review, format),
        html = result.bytes.toString("utf8"),
        snapshots = [...html.matchAll(/class="snapshot" src="data:image\/png;base64,([^"]+)"/g)];
      expect(snapshots).toHaveLength(review.blocks.length);
      for (const [index, block] of review.blocks.entries()) {
        const png = await render({ ...review, blocks: [block] }, "png");
        expect(Buffer.from(snapshots[index]![1]!, "base64").equals(png.bytes)).toBe(true);
      }
      expect(html).not.toMatch(/PRIVATE_|isCorrect|speakerNotes|explanation/);
      expect(html).not.toMatch(/<(?:script|iframe|video|audio)\b|animation|requestAnimationFrame/i);
      expect(JSON.stringify(version)).toBe(frozen);
    },
  );

  it("round-trips static palette and font rasters for every page type through PDF", async () => {
    const { version } = fixture("mono"),
      frozen = JSON.stringify(version),
      review = project(version),
      result = await render(review, "pdf"),
      pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"),
      task = pdfjs.getDocument({
        data: new Uint8Array(result.bytes),
        useSystemFonts: false,
        verbosity: 0,
      });
    const document = await task.promise;
    try {
      expect(document.numPages).toBe(review.blocks.length);
      expect(await document.getJSActions()).toBeNull();
      for (const [index, block] of review.blocks.entries()) {
        const expected = await decode((await render({ ...review, blocks: [block] }, "png")).bytes),
          page = await document.getPage(index + 1),
          ctx = createCanvas(1280, 720).getContext("2d");
        await page.render({
          canvas: null,
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport: page.getViewport({ scale: 1 }),
        }).promise;
        // The PDF embeds lossless page images, including the text's font rasterization.
        expect(
          Buffer.from(ctx.getImageData(0, 0, 1280, 720).data).equals(
            Buffer.from(expected.getImageData(0, 0, 1280, 720).data),
          ),
        ).toBe(true);
      }
      expect(JSON.stringify(version)).toBe(frozen);
    } finally {
      await task.destroy();
    }
  }, 20_000);

  it("leaves donor-less legacy exports unchanged and rejects non-public design fields", async () => {
    const { version } = fixture();
    for (const block of version.content.blocks)
      if (block.kind === "content" && block.scene) delete block.scene.design;
    const review = project(version);
    expect(review.blocks.every((block) => block.design === undefined)).toBe(true);
    for (const blockId of [1, 2, 5, 6, 7]) {
      const block = review.blocks.find((block) => block.id === id(blockId))!,
        ctx = await decode((await render({ ...review, blocks: [block] }, "png")).bytes),
        expected = createCanvas(1280, 720).getContext("2d");
      if (block.kind === "content" && !block.scene) {
        const gradient = expected.createLinearGradient(0, 0, 1280, 720);
        gradient.addColorStop(0, "#f8fbff");
        gradient.addColorStop(1, "#fff");
        expected.fillStyle = gradient;
      } else expected.fillStyle = block.kind === "question" ? "#f8fbff" : "#fff";
      expected.fillRect(0, 0, 1280, 720);
      for (const [x, y] of samples)
        expect(ctx.getImageData(x, y, 1, 1).data).toEqual(expected.getImageData(x, y, 1, 1).data);
    }
    const question = review.blocks.find((block) => block.kind === "question")!;
    for (const design of [
      { ...ocean, motionBackground: "url(untrusted)" },
      { ...ocean, speakerNotes: "PRIVATE" },
    ])
      expect(
        PresentationReviewSchema.safeParse({ ...review, blocks: [{ ...question, design }] })
          .success,
      ).toBe(false);
  });
});
