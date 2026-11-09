import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import {
  PresentationDraftSchema,
  type PresentationScene,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  openE01Inspector,
  selectE01Object,
  closeE01Overlays,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  type E01Record,
} from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

function scene(record: E01Record): PresentationScene {
  const block = record.draft.blocks[0];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected a native image slide");
  return block.scene;
}

function image(record: E01Record) {
  const node = scene(record).nodes.find((node) => node.type === "image");
  if (node?.type !== "image") throw new Error("Expected an image object");
  return node;
}

async function expectImageCss(stage: Locator, narrow: boolean, cover: boolean) {
  const wrapper = stage.locator('[data-node-id="fixture-image"] [data-image-fit]');
  await expect(wrapper).toHaveAttribute("data-image-fit", cover ? "cover" : "contain");
  const rendered = wrapper.getByRole("img", {
    name: "Synthetic image framing fixture",
    exact: true,
  });
  await expect(rendered).toBeVisible();
  await expect(rendered).toHaveCSS("object-fit", cover && !narrow ? "cover" : "contain");
  await expect(rendered).toHaveCSS("object-position", cover && !narrow ? "25% 75%" : "50% 50%");
  await expect
    .poll(() => rendered.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  if (!narrow) {
    const [wrapperBounds, imageBounds] = await Promise.all([
      wrapper.boundingBox(),
      rendered.boundingBox(),
    ]);
    expect(wrapperBounds).not.toBeNull();
    expect(imageBounds).not.toBeNull();
    expect(imageBounds!.width).toBeCloseTo(wrapperBounds!.width, 0);
    expect(imageBounds!.height).toBeCloseTo(wrapperBounds!.height, 0);
  }
}

for (const suffix of ["", " @mobile"]) {
  test(`synthetic media UI preserves image fit, focal point and image layouts through undo and reload${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const created = await page.request.post(`${e01ApiUrl}/v1/presentations`, {
      data: { title: `Image framing UI ${randomUUID().slice(0, 8)}` },
    });
    expect(created.status()).toBe(201);
    let record = (await created.json()).presentation as E01Record & Record<string, unknown>;
    const slide = e01Slide("Image framing");
    slide.speakerNotes = "PRIVATE synthetic media UI cue";
    slide.citations = [{ locator: "Synthetic image fixture", excerpt: "UI rendering only" }];
    const native = slide.scene!;
    const title = native.nodes[0]!;
    if (title.type !== "text") throw new Error("Expected title text");
    title.frame = { x: 7, y: 7, width: 86, height: 20 };
    const body = native.nodes[1]!;
    if (body.type !== "text") throw new Error("Expected body text");
    body.text = "Keep the subject visible.";
    body.frame = { x: 7, y: 33, width: 40, height: 59 };
    const mediaId = randomUUID();
    native.nodes.push({
      id: "fixture-image",
      type: "image",
      mediaId,
      altText: "Synthetic image framing fixture",
      frame: { x: 53, y: 33, width: 40, height: 59 },
    });
    native.readingOrder.push("fixture-image");
    record = {
      ...record,
      draft: PresentationDraftSchema.parse({ ...record.draft, schemaVersion: 4, blocks: [slide] }),
      draftSchemaVersion: 4,
      hasUnpublishedChanges: true,
    };
    const original = structuredClone(record.draft);
    const imageUrl = new URL(`/design-image-fixture-${mediaId}.png`, page.url()).href;
    const imageBytes = await readFile("apps/web/public/brand/polling-pops-social.png");
    const saveEnvelopes: number[] = [];
    // This case exercises the real editor, AuthenticatedMedia and CSS with a synthetic asset.
    // Only this deck's GET/PUT and this media ID/PNG are fixtures. It does not publish or claim
    // asset ownership; the other design journeys and API/PG suites cover those real boundaries.
    await page.route(`${e01ApiUrl}/v1/presentations/${record.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({ json: { presentation: record } });
    });
    await page.route(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const envelope = route.request().postDataJSON();
      expect(envelope.expectedRevision).toBe(record.draftRevision);
      saveEnvelopes.push(envelope.schemaVersion);
      const draft = PresentationDraftSchema.parse(envelope.draft);
      record = {
        ...record,
        draft,
        draftRevision: record.draftRevision + 1,
        draftSchemaVersion: draft.schemaVersion,
      };
      await route.fulfill({ json: { presentation: record } });
    });
    await page.route(`${e01ApiUrl}/v1/media/${mediaId}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({ json: { downloadUrl: imageUrl } });
    });
    await page.route(imageUrl, (route) =>
      route.fulfill({ contentType: "image/png", body: imageBytes }),
    );
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    const stage = page.locator("[data-native-scene]");
    await expectImageCss(stage, narrow, false);
    const selectImage = () => selectE01Object(page, "3. Synthetic image framing fixture", "Media");
    await selectImage();
    await page.getByRole("combobox", { name: "Image fit", exact: true }).selectOption("cover");
    await page.getByRole("spinbutton", { name: "Image focal X (%)", exact: true }).fill("25");
    await page.getByRole("spinbutton", { name: "Image focal Y (%)", exact: true }).fill("75");
    await expect.poll(() => image(record).focalPoint).toEqual({ x: 25, y: 75 });
    expect(record.draft.schemaVersion).toBe(7);
    expect(scene(record).schemaVersion).toBe(3);
    await expectImageCss(stage, narrow, true);
    const beforeLayout = structuredClone(scene(record));
    await openE01Inspector(page, "Layout");
    await page.getByRole("button", { name: "Image left", exact: true }).click();
    await expect.poll(() => image(record).frame).toEqual({ x: 7, y: 33, width: 40, height: 59 });
    expect(scene(record).nodes.find((node) => node.id === body.id)).toMatchObject({
      frame: { x: 53, y: 33, width: 40, height: 59 },
    });
    const left = structuredClone(scene(record));
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => scene(record)).toEqual(beforeLayout);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(() => scene(record)).toEqual(left);
    await page.getByRole("button", { name: "Image right", exact: true }).click();
    await expect.poll(() => image(record).frame).toEqual({ x: 53, y: 33, width: 40, height: 59 });
    await expectImageCss(stage, narrow, true);
    await openE01Inspector(page, "Media");
    await page.getByRole("combobox", { name: "Image fit", exact: true }).selectOption("contain");
    await expect.poll(() => image(record).fit).toBe("contain");
    expect(image(record)).not.toHaveProperty("focalPoint");
    await expectImageCss(stage, narrow, false);
    await expect(
      page.getByRole("spinbutton", { name: "Image focal X (%)", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => image(record).focalPoint).toEqual({ x: 25, y: 75 });
    await expectImageCss(stage, narrow, true);
    const expected = {
      ...original,
      schemaVersion: 7,
      blocks: original.blocks.map((block) =>
        block.kind === "content" && block.scene
          ? {
              ...block,
              scene: {
                ...block.scene,
                schemaVersion: 3,
                nodes: block.scene.nodes.map((node) =>
                  node.type === "image"
                    ? { ...node, fit: "cover", focalPoint: { x: 25, y: 75 } }
                    : node,
                ),
              },
            }
          : block,
      ),
    };
    expect(record.draft).toEqual(expected);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /^Saved$/ })
        .first(),
    ).toBeVisible();
    await page.reload();
    if (narrow) {
      await closeE01Overlays(page);
    }
    await expectImageCss(page.locator("[data-native-scene]"), narrow, true);
    await selectImage();
    await expect(page.getByRole("combobox", { name: "Image fit", exact: true })).toHaveValue(
      "cover",
    );
    await expect(
      page.getByRole("spinbutton", { name: "Image focal X (%)", exact: true }),
    ).toHaveValue("25");
    await expect(
      page.getByRole("spinbutton", { name: "Image focal Y (%)", exact: true }),
    ).toHaveValue("75");
    expect(record.draft).toEqual(expected);
    expect(saveEnvelopes.length).toBeGreaterThan(3);
    expect(saveEnvelopes.every((version) => version === 2)).toBe(true);
    if (narrow) await closeE01Overlays(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expectImageCss(preview.locator("[data-native-scene]"), narrow, true);
    expect(await preview.innerText()).not.toContain("PRIVATE");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("synthetic-image-framing-preview.png"),
      fullPage: true,
    });
  });
}
