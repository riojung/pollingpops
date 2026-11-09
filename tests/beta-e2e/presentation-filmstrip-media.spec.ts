import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  PresentationDraftSchema,
  type ContentSlideDraft,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  openE01Inspector,
  type E01Record,
} from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

for (const suffix of ["", " @mobile"]) {
  test(`private image filmstrip preserves crops, authorizes only visible rows and cancels on close${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Observe real browser fetch cancellation without changing its transport or authorization.
    await page.addInitScript(() => {
      const state = window as typeof window & { __filmstripMediaAborts: string[] };
      state.__filmstripMediaAborts = [];
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/v1/media/") && init?.signal)
          init.signal.addEventListener("abort", () => state.__filmstripMediaAborts.push(url), {
            once: true,
          });
        return original(input, init);
      };
    });
    await signInBeta(page);
    const created = await page.request.post(`${e01ApiUrl}/v1/presentations`, {
      data: { title: `Private filmstrip ${randomUUID().slice(0, 8)}` },
    });
    expect(created.status()).toBe(201);
    let record = (await created.json()).presentation as E01Record;
    const shared = randomUUID(),
      legacyMedia = randomUUID(),
      failedMedia = randomUUID(),
      deniedMedia = randomUUID(),
      slowMedia = randomUUID();
    const imageSlide = (title: string, mediaId: string) => {
      const slide = e01Slide(title);
      slide.scene!.schemaVersion = 3;
      const body = slide.scene!.nodes[1]!;
      if (body.type !== "text") throw new Error("Expected body text");
      body.frame = { x: 7, y: 35, width: 38, height: 55 };
      slide.scene!.nodes.push({
        id: `image-${mediaId}`,
        type: "image",
        mediaId,
        altText: title,
        fit: "cover",
        focalPoint: { x: 25, y: 75 },
        frame: { x: 53, y: 35, width: 40, height: 55 },
      });
      slide.scene!.readingOrder.push(`image-${mediaId}`);
      return slide;
    };
    const first = imageSlide("Private image story", shared);
    const duplicate = imageSlide("Shared image on another slide", shared);
    const legacy: ContentSlideDraft = {
      id: randomUUID(),
      kind: "content",
      layout: "media",
      textElements: [
        {
          id: randomUUID(),
          role: "title",
          text: "Legacy image story",
          region: "top_center",
          order: 0,
        },
      ],
      mediaId: legacyMedia,
      mediaAlt: "Legacy reference",
      speakerNotes: "PRIVATE legacy cue",
    };
    const failed = imageSlide("Unavailable signed image", failedMedia);
    const denied = imageSlide("Revoked private image", deniedMedia);
    const slow = imageSlide("Pending thumbnail image", slowMedia);
    const farMedia: string[] = Array.from({ length: 20 }, () => randomUUID());
    const blocks = [
      first,
      duplicate,
      legacy,
      failed,
      denied,
      slow,
      ...farMedia.map((id, index) => imageSlide(`Later image ${index + 1}`, id)),
    ];
    record = {
      ...record,
      draft: PresentationDraftSchema.parse({ ...record.draft, schemaVersion: 7, blocks }),
    };
    const metadataReads: string[] = [];
    const imageReads: string[] = [];
    const imageBytes = await readFile("apps/web/public/brand/polling-pops-social.png");
    const allMedia = new Set<string>([
      shared,
      legacyMedia,
      failedMedia,
      deniedMedia,
      slowMedia,
      ...farMedia,
    ]);
    const imageUrl = (id: string) =>
      new URL(`/private-filmstrip-fixture-${id}.png?signature=synthetic-private`, page.url()).href;
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let slowFinished!: () => void;
    const slowReturned = new Promise<void>((resolve) => {
      slowFinished = resolve;
    });
    // Synthetic creator-owned asset responses isolate browser rendering/lifetimes. These fixtures
    // do not upload unscanned assets or replace the API ownership/scanner qualification suites.
    await page.route(`${e01ApiUrl}/v1/presentations/${record.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({ json: { presentation: record } });
    });
    await page.route(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const body = route.request().postDataJSON();
      expect(body.expectedRevision).toBe(record.draftRevision);
      record = {
        ...record,
        draft: PresentationDraftSchema.parse(body.draft),
        draftRevision: record.draftRevision + 1,
      };
      await route.fulfill({ json: { presentation: record } });
    });
    await page.route(`${e01ApiUrl}/v1/media/*`, async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      if (!allMedia.has(id)) return route.continue();
      metadataReads.push(id);
      if (id === deniedMedia)
        return route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "Media not found" } },
        });
      if (id === slowMedia) {
        await slowGate;
        await route.fulfill({ json: { downloadUrl: imageUrl(id) } }).catch(() => undefined);
        slowFinished();
        return;
      }
      await route.fulfill({ json: { downloadUrl: imageUrl(id) } });
    });
    await page.route(
      "**/private-filmstrip-fixture-*.png?signature=synthetic-private",
      async (route) => {
        const id = new URL(route.request().url()).pathname.slice(
          "/private-filmstrip-fixture-".length,
          -".png".length,
        );
        imageReads.push(id);
        // The selected canvas also reads the shared first image through its existing renderer.
        if (id !== shared) expect(route.request().headers().referer).toBeUndefined();
        if (id === failedMedia) return route.fulfill({ status: 404, body: "Image unavailable" });
        await route.fulfill({ contentType: "image/png", body: imageBytes });
      },
    );
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    const map = page.locator("#presentation-slide-navigator");
    const mapTrigger = page.locator('button[aria-controls="presentation-slide-navigator"]');
    const openMap = async () => {
      if ((await mapTrigger.getAttribute("aria-expanded")) === "false") await mapTrigger.click();
      await expect(map).toBeVisible();
    };
    const thumbnail = (id: string) => map.locator(`[data-slide-thumbnail="${id}"]`);
    const nativeImage = thumbnail(first.id).locator("[data-thumbnail-scene] [data-image-fit] img");
    await openMap();
    await expect(nativeImage).toBeVisible();
    await expect(nativeImage).toHaveCSS("object-fit", "cover");
    await expect(nativeImage).toHaveCSS("object-position", "25% 75%");
    await expect
      .poll(() => nativeImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(thumbnail(first.id)).toHaveAttribute("inert", "");
    await expect(thumbnail(first.id)).toHaveAttribute("aria-hidden", "true");
    expect(metadataReads.some((id) => farMedia.includes(id))).toBe(false);
    if (!narrow) {
      await expect(map.locator('[data-thumbnail-image-state="loading"]')).toHaveCount(0);
      const beforeEdits = metadataReads.filter((id) => id === shared).length;
      await openE01Inspector(page, "Content");
      const title = page.getByRole("textbox", { name: "Native slide title", exact: true });
      await title.fill("Private image story edited once");
      await title.fill("Private image story edited twice");
      await openE01Inspector(page, "Layout");
      await page.getByRole("spinbutton", { name: "Object x (%)", exact: true }).fill("9");
      await expect
        .poll(() => {
          const block = record.draft.blocks[0];
          const node = block?.kind === "content" ? block.scene?.nodes[0] : null;
          return node?.type === "text" ? { text: node.text, x: node.frame.x } : null;
        })
        .toEqual({ text: "Private image story edited twice", x: 9 });
      await expect(nativeImage).toHaveCSS("object-position", "25% 75%");
      expect(metadataReads.filter((id) => id === shared)).toHaveLength(beforeEdits);
    }
    const legacyThumb = thumbnail(legacy.id);
    await legacyThumb.scrollIntoViewIfNeeded();
    await expect(legacyThumb.locator("img")).toHaveAttribute("src", imageUrl(legacyMedia));
    await expect
      .poll(() =>
        legacyThumb.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await thumbnail(failed.id).scrollIntoViewIfNeeded();
    await expect(
      thumbnail(failed.id).locator('[data-thumbnail-image-state="unavailable"]'),
    ).toHaveCount(1);
    await thumbnail(denied.id).scrollIntoViewIfNeeded();
    await expect(
      thumbnail(denied.id).locator('[data-thumbnail-image-state="unavailable"]'),
    ).toHaveCount(1);
    expect(metadataReads.filter((id) => id === deniedMedia)).toHaveLength(1);
    await thumbnail(slow.id).scrollIntoViewIfNeeded();
    await expect.poll(() => metadataReads.filter((id) => id === slowMedia).length).toBe(1);
    await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    await expect(map.locator("img")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          (url) =>
            (
              window as typeof window & { __filmstripMediaAborts: string[] }
            ).__filmstripMediaAborts.includes(url),
          `${e01ApiUrl}/v1/media/${slowMedia}`,
        ),
      )
      .toBe(true);
    releaseSlow();
    await slowReturned;
    expect(imageReads).not.toContain(slowMedia);
    await openMap();
    await thumbnail(slow.id).scrollIntoViewIfNeeded();
    await expect(thumbnail(slow.id).locator("img")).toHaveAttribute("src", imageUrl(slowMedia));
    await expect.poll(() => metadataReads.filter((id) => id === slowMedia).length).toBe(2);
    await page.evaluate(() => window.dispatchEvent(new Event("pollingpops:auth-change")));
    await expect(map.locator("img")).toHaveCount(0);
    await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    await openMap();
    await thumbnail(slow.id).scrollIntoViewIfNeeded();
    await expect(thumbnail(slow.id).locator("img")).toHaveAttribute("src", imageUrl(slowMedia));
    expect(
      await page.evaluate(() =>
        [localStorage, sessionStorage].some((storage) =>
          Object.values(storage).some((value) =>
            String(value).includes("private-filmstrip-fixture-"),
          ),
        ),
      ),
    ).toBe(false);
    expect(metadataReads.some((id) => id === farMedia[10])).toBe(false);
    expect(new Set(metadataReads).size).toBeLessThan(blocks.length / 2);
    await page.screenshot({
      path: testInfo.outputPath("private-filmstrip-images.png"),
      fullPage: true,
    });
  });
}
