import { randomUUID } from "node:crypto";
import { loadImage } from "@napi-rs/canvas";
import { describe, it, expect } from "vitest";
import { PresentationReviewSchema } from "@openround/contracts";
import {
  renderPresentationStatic,
  PresentationStaticExportError,
  PRESENTATION_STATIC_RENDER_LIMITS as limits,
} from "../src/presentation-static-renderer.js";
function review() {
  return PresentationReviewSchema.parse({
    schemaVersion: 1,
    versionId: randomUUID(),
    version: 1,
    title: "Published static deck",
    expiresAt: "2020-01-01T00:00:00.000Z",
    sections: [],
    blocks: [
      {
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        scene: {
          schemaVersion: 6,
          aspectRatio: "16:9",
          design: { theme: "midnight", font: "sans", spacing: "relaxed" },
          nodes: [
            {
              id: "title",
              type: "text",
              role: "title",
              text: "Français 한국어 🧠",
              frame: { x: 5, y: 5, width: 90, height: 15 },
            },
            {
              id: "detail",
              type: "dialog",
              scope: "local",
              label: "Read detail",
              detailTitle: "Public detail",
              body: "Public <dialog> & complete detail",
              frame: { x: 5, y: 30, width: 35, height: 15 },
            },
          ],
          readingOrder: ["title", "detail"],
        },
      },
      {
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        textElements: [
          { id: "title", role: "title", text: "Legacy slide", region: "top_center", order: 0 },
          { id: "body", role: "body", text: "Published body", region: "middle_center", order: 1 },
        ],
        mediaId: null,
        mediaAlt: null,
      },
      {
        id: randomUUID(),
        kind: "question",
        question: {
          type: "poll",
          prompt: "Activity preview only",
          mediaId: null,
          mediaAlt: null,
          choices: [
            { id: randomUUID(), label: "First" },
            { id: randomUUID(), label: "Second" },
          ],
        },
      },
    ],
  });
}
describe("isolated static Presentation renderer", () => {
  it("returns a real three-page 16:9 PDF and selected 1280x720 PNG through its owned worker", async () => {
    const deck = review();
    const pdf = await renderPresentationStatic({ review: deck, images: new Map(), format: "pdf" });
    expect(pdf).toMatchObject({ contentType: "application/pdf", extension: "pdf" });
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(pdf.bytes),
      useSystemFonts: false,
      verbosity: 0,
    });
    const document = await task.promise;
    try {
      expect(document.numPages).toBe(3);
      for (let index = 1; index <= 3; index++) {
        const page = await document.getPage(index);
        const viewport = page.getViewport({ scale: 1 });
        expect([viewport.width, viewport.height]).toEqual([1280, 720]);
        expect(await page.getAnnotations()).toEqual([]);
      }
    } finally {
      await task.destroy();
    }
    const png = await renderPresentationStatic({
      review: deck,
      images: new Map(),
      format: "png",
      blockId: deck.blocks[0]!.id.toUpperCase(),
    });
    expect(png).toMatchObject({ contentType: "image/png", extension: "png" });
    const image = await loadImage(png.bytes);
    expect([image.width, image.height]).toEqual([1280, 720]);
  }, 20_000);
  it("exports complete escaped public HTML without expiry semantics or assessment authority", async () => {
    const html = await renderPresentationStatic({
      review: review(),
      images: new Map(),
      format: "html",
    });
    const text = html.bytes.toString();
    expect(html).toMatchObject({ contentType: "text/html; charset=utf-8", extension: "html" });
    expect(text).toContain("Public &lt;dialog&gt; &amp; complete detail");
    expect(text).toContain("<main>");
    expect(text).toContain("<ol>");
    expect(text).toContain("Français 한국어 🧠");
    expect(text).not.toMatch(
      /<script\b|<form\b|src=["']https?:|<link\b|correctValue|isCorrect|speakerNotes|idempotencyKey|controlToken/i,
    );
  }, 20_000);
  it("exports a whole-deck offline interactive readable companion through the same worker", async () => {
    const deck = review();
    const result = await renderPresentationStatic({
      review: deck,
      images: new Map(),
      format: "offline_html",
    });
    const html = result.bytes.toString("utf8");
    expect(result).toMatchObject({ contentType: "text/html", extension: "html" });
    expect(html.match(/class="snapshot"/g)).toHaveLength(3);
    expect(html).toContain("<details><summary>Read detail</summary>");
    expect(html).toContain("Public &lt;dialog&gt; &amp; complete detail");
    expect(html).toContain("Français 한국어 🧠");
    expect(html).toContain(
      "No responses, submissions, answer keys, scoring, live results or completion tracking",
    );
    expect(html).not.toMatch(
      /<details[^>]+\bopen\b|<(?:script|form|input|iframe|object)\b|src=["']https?:|versionId|expiresAt|2020-01-01|correctValue|isCorrect|speakerNotes|idempotencyKey|controlToken/i,
    );
    for (const block of deck.blocks) expect(html).toContain(`id="page-${block.id.toLowerCase()}"`);
  }, 20_000);
  it.each(["pdf", "offline_html"] as const)(
    "cancels %s only after its owned render worker terminates and leaves later renders usable",
    async (format) => {
      const base = review(),
        controller = new AbortController();
      const deck = {
        ...base,
        blocks: Array.from({ length: 100 }, () => ({ ...base.blocks[0]!, id: randomUUID() })),
      };
      let heartbeat = false;
      const active = renderPresentationStatic({
        review: deck,
        images: new Map(),
        format,
        signal: controller.signal,
      });
      const timer = setTimeout(() => {
        heartbeat = true;
        controller.abort();
      }, 25);
      try {
        await expect(active).rejects.toMatchObject({ code: "EXPORT_CANCELLED" });
        expect(heartbeat).toBe(true);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
      const next = await renderPresentationStatic({
        review: base,
        images: new Map(),
        format: "png",
        blockId: base.blocks[1]!.id,
      });
      expect(next.bytes.byteLength).toBeGreaterThan(100);
    },
    20_000,
  );
  it.each(["pdf", "offline_html"] as const)(
    "rejects malformed selection, private input fields, page and byte limits before rendering %s",
    async (format) => {
      const base = review();
      await expect(
        renderPresentationStatic({ review: base, images: new Map(), format: "png" }),
      ).rejects.toMatchObject({ code: "EXPORT_INVALID" });
      await expect(
        renderPresentationStatic({
          review: base,
          images: new Map(),
          format: "offline_html",
          blockId: base.blocks[0]!.id,
        }),
      ).rejects.toMatchObject({ code: "EXPORT_INVALID" });
      await expect(
        renderPresentationStatic({
          review: base,
          images: new Map(),
          format: "png",
          blockId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "EXPORT_INVALID" });
      await expect(
        renderPresentationStatic({
          review: { ...base, privateNotes: "NEVER EXPORT" } as typeof base,
          images: new Map(),
          format,
        }),
      ).rejects.toBeInstanceOf(PresentationStaticExportError);
      await expect(
        renderPresentationStatic({
          review: {
            ...base,
            blocks: Array.from({ length: 101 }, () => ({ ...base.blocks[0]!, id: randomUUID() })),
          },
          images: new Map(),
          format,
        }),
      ).rejects.toMatchObject({ code: "EXPORT_LIMIT" });
      await expect(
        renderPresentationStatic({
          review: base,
          images: new Map([
            [
              randomUUID(),
              { bytes: Buffer.alloc(limits.imageBytes + 1), contentType: "image/png" },
            ],
          ]),
          format,
        }),
      ).rejects.toMatchObject({ code: "EXPORT_LIMIT" });
      const controller = new AbortController();
      controller.abort();
      await expect(
        renderPresentationStatic({
          review: base,
          images: new Map(),
          format,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: "EXPORT_CANCELLED" });
    },
  );
});
