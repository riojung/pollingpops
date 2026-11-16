import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  ContentSlideDraft,
  PresentationDraft,
  PresentationMotionBackground,
  PresentationScene,
} from "../../packages/contracts/src/index.ts";
import { motionBackgroundCopy } from "../../apps/web/components/presentation/motion-background-copy.ts";
import {
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  openE01Inspector,
  openE01Navigator,
  readE01Record,
  selectE01Body,
} from "./presentation-e01-support";
import { specialistLocale } from "./option-b-specialist-support";
import { tabKey } from "./option-b-accessibility-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 20_000 });

const pauseKey = "polling-pops:presentation-motion-paused";
const presets = [
  ["aurora", "Aurora"],
  ["waves", "Soft waves"],
  ["orbs", "Floating orbs"],
  ["mesh", "Gradient mesh"],
  ["ribbons", "Flowing ribbons"],
  ["stars", "Star drift"],
] as const satisfies readonly (readonly [PresentationMotionBackground, string])[];
const design = { theme: "paper", font: "sans", spacing: "relaxed" } as const;

function native(draft: PresentationDraft, index = 0) {
  const block = draft.blocks[index];
  if (block?.kind !== "content" || !block.scene) throw new Error("Expected native content");
  return block as ContentSlideDraft & { scene: PresentationScene };
}

function designedSlide(title: string, motionBackground?: PresentationMotionBackground) {
  const slide = e01Slide(title);
  slide.scene!.schemaVersion = motionBackground ? 8 : 3;
  slide.scene!.design = { ...design, ...(motionBackground ? { motionBackground } : {}) };
  return slide;
}

function editorLayer(page: Page) {
  return page.locator(
    '[data-native-scene-canvas="true"] [data-native-scene] [data-motion-background]',
  );
}

async function expectPlayback(layer: Locator, playing: boolean) {
  // Real pages pause hidden/offscreen work. Observe the foreground scene, not a background tab.
  await layer.page().bringToFront();
  // Initial realtime connection can replace the scene while it is being scrolled into view.
  // Retry observation, retaining both real animation-state and timeline requirements.
  await expect(async () => {
    await layer.scrollIntoViewIfNeeded({ timeout: 3_000 });
    await expect(layer).toHaveAttribute("data-motion-playing", String(playing), {
      timeout: 3_000,
    });
    const running = () =>
      layer.evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      );
    if (playing) await expect.poll(running, { timeout: 3_000 }).toBeGreaterThan(0);
    else await expect.poll(running, { timeout: 3_000 }).toBe(0);
    const sample = await layer.evaluate(async (element) => {
      const animations = element.getAnimations({ subtree: true });
      const before = animations.map((animation) => Number(animation.currentTime ?? 0));
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        connected: element.isConnected,
        changes: animations.map(
          (animation, index) => Number(animation.currentTime ?? 0) - before[index]!,
        ),
      };
    });
    expect(sample.connected).toBe(true);
    if (playing) expect(sample.changes.some((change) => change > 0)).toBe(true);
    else expect(sample.changes.every((change) => Math.abs(change) < 1)).toBe(true);
  }).toPass({ timeout: 15_000, intervals: [100, 250, 500] });
}

async function expectStillThumbnails(layers: Locator, count: number) {
  await expect(layers).toHaveCount(count);
  for (const layer of await layers.all()) {
    await expect(layer).toHaveAttribute("data-motion-static", "true");
    await expect(layer).toHaveAttribute("data-motion-playing", "false");
    expect(
      await layer.evaluate((element) =>
        element
          .getAnimations({ subtree: true })
          .some((animation) => animation.playState === "running"),
      ),
    ).toBe(false);
  }
}

async function expectStillFilmstrip(navigator: Locator, count: number) {
  const thumbnails = navigator.locator("[data-slide-thumbnail]");
  await expect(thumbnails).toHaveCount(count);
  // Filmstrip artwork is virtualized; each visible row mounts its own renderer.
  for (let index = 0; index < count; index++) {
    const thumbnail = thumbnails.nth(index);
    await thumbnail.scrollIntoViewIfNeeded();
    await expectStillThumbnails(thumbnail.locator("[data-motion-background]"), 1);
  }
}

async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
}

async function localizedPanels(page: Page, inspectorOpen: boolean) {
  for (const id of ["presentation-slide-navigator", "presentation-object-inspector"]) {
    const trigger = page.locator(`button[aria-controls="${id}"]`);
    const wanted = id === "presentation-object-inspector" && inspectorOpen;
    if (((await trigger.getAttribute("aria-expanded")) === "true") !== wanted)
      await trigger.click();
  }
  if (inspectorOpen) await page.locator("#inspector-tab-layout").click();
}

async function capture(surface: Locator, name: string) {
  await mkdir("artifacts/presentation-motion", { recursive: true });
  await surface.screenshot({ path: `artifacts/presentation-motion/${name}.png` });
}

for (const suffix of ["", " @mobile"]) {
  test(`motion backgrounds save, undo, animate and retain local playback preferences${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
    await signInBeta(page);
    await specialistLocale(page, "en-CA");
    const opening = designedSlide("Motion opening");
    const closing = designedSlide("Motion closing");
    const record = await createE01Deck(page, [opening, closing], 7);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    const artifact = `${info.project.name}-${record.id.slice(0, 8)}`;
    const saved = async () => (await readE01Record(page, record.id)).draft;
    const expectSavedMotion = async (preset: PresentationMotionBackground | undefined) => {
      await expect
        .poll(async () => native(await saved()).scene.design?.motionBackground)
        .toBe(preset);
      if (preset) {
        const draft = await saved();
        expect(draft.schemaVersion).toBe(17);
        expect(native(draft).scene.schemaVersion).toBe(8);
      }
    };
    await enterE01Editor(page, record.id, narrow);
    await expect(editorLayer(page)).toHaveCount(0);
    const inspector = await openE01Inspector(page, "Layout");
    const picker = inspector.getByRole("group", { name: "Motion background", exact: true });
    await expect(
      picker.getByRole("button", { name: "None · static", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expectStillThumbnails(picker.locator("[data-motion-background]"), 6);

    await picker.getByRole("button", { name: "Aurora", exact: true }).click();
    await expectSavedMotion("aurora");
    if (narrow) await closeE01Overlays(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expectSavedMotion(undefined);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expectSavedMotion("aurora");
    await openE01Inspector(page, "Layout");
    for (const [preset, label] of presets) {
      const option = picker.getByRole("button", { name: label, exact: true });
      await option.click();
      await expect(option).toHaveAttribute("aria-pressed", "true");
      await expectSavedMotion(preset);
      await expectStillThumbnails(picker.locator("[data-motion-background]"), 6);
      const beforePreview = await saved();
      await inspector.getByRole("button", { name: "Play preview", exact: true }).click();
      await expectPlayback(picker.locator(`[data-motion-background="${preset}"]`), true);
      await expect(picker.locator('[data-motion-playing="true"]')).toHaveCount(1);
      await inspector.getByRole("button", { name: "Pause preview", exact: true }).click();
      await expectStillThumbnails(picker.locator("[data-motion-background]"), 6);
      expect(await saved()).toEqual(beforePreview);
    }
    await capture(picker, `${artifact}-picker`);

    await inspector
      .getByRole("button", { name: "Apply style to native slides", exact: true })
      .click();
    await expect
      .poll(async () => native(await saved(), 1).scene.design?.motionBackground)
      .toBe("stars");
    expect(native(await saved(), 1).scene.schemaVersion).toBe(8);
    if (narrow) await closeE01Overlays(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => native(await saved(), 1).scene.design?.motionBackground)
      .toBeUndefined();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(async () => native(await saved(), 1).scene.design?.motionBackground)
      .toBe("stars");
    for (const [index, slide] of [opening, closing].entries()) {
      expect(native(await saved(), index).scene.nodes).toEqual(slide.scene!.nodes);
      expect(native(await saved(), index).scene.readingOrder).toEqual(slide.scene!.readingOrder);
      expect(native(await saved(), index).speakerNotes).toBe(slide.speakerNotes);
    }
    const navigator = await openE01Navigator(page);
    await expectStillFilmstrip(navigator, 2);
    await closeE01Overlays(page);
    await expectPlayback(editorLayer(page), true);
    await expect(editorLayer(page)).toHaveAttribute("aria-hidden", "true");
    await expect(editorLayer(page)).toHaveCSS("pointer-events", "none");
    await capture(
      page.locator('[data-native-scene-canvas="true"] [data-native-scene]'),
      `${artifact}-scene`,
    );

    const beforePlayback = await saved();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    const previewLayer = preview.locator("[data-native-scene] [data-motion-background]");
    await expectPlayback(previewLayer, true);
    await expect(preview.locator("[data-native-scene] [data-motion-controls]")).toHaveCount(0);
    const originalStorageWrite = await page.evaluateHandle((blockedKey) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (key === blockedKey)
          throw new DOMException("Storage quota exceeded", "QuotaExceededError");
        return original.call(this, key, value);
      };
      return original;
    }, pauseKey);
    try {
      await preview.getByRole("button", { name: "Pause background motion", exact: true }).click();
      await expectPlayback(previewLayer, false);
      await expect(
        preview.getByRole("button", { name: "Play background motion", exact: true }),
      ).toBeVisible();
      expect(await saved()).toEqual(beforePlayback);
    } finally {
      try {
        await originalStorageWrite.evaluate((original) => {
          Storage.prototype.setItem = original;
        });
      } finally {
        await originalStorageWrite.dispose();
      }
    }
    await preview.getByRole("button", { name: "Play background motion", exact: true }).click();
    await expectPlayback(previewLayer, true);
    await preview.getByRole("button", { name: "Pause background motion", exact: true }).click();
    await expectPlayback(previewLayer, false);
    expect(await page.evaluate((key) => localStorage.getItem(key), pauseKey)).toBe("true");
    await preview.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      preview.getByRole("heading", { name: "Motion closing", exact: true }),
    ).toBeVisible();
    await expectPlayback(previewLayer, false);
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
      preview.getByRole("button", { name: "Play background motion", exact: true }),
    ).toBeVisible();
    await expectPlayback(previewLayer, false);
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    await page.reload();
    await closeE01Overlays(page);
    await expectPlayback(editorLayer(page), false);
    await page
      .locator('[data-native-scene-canvas="true"]')
      .getByRole("button", { name: "Play background motion", exact: true })
      .click();
    await expectPlayback(editorLayer(page), true);
    expect(await saved()).toEqual(beforePlayback);
    await noOverflow(page);

    const publication = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const published = await publication;
    expect(published.status()).toBe(200);
    const version = (await published.json()).version;
    expect(version.content.schemaVersion).toBe(17);
    expect(version.content.blocks[0].scene).toMatchObject({
      schemaVersion: 8,
      design: { motionBackground: "stars" },
    });
    await page.getByRole("button", { name: "Share review link", exact: true }).click();
    const share = page.getByRole("dialog", { name: "Share a private review link", exact: true });
    await share.getByRole("button", { name: "Create link", exact: true }).click();
    const link = share.getByRole("textbox", { name: "Your private link", exact: true });
    await expect(link).toHaveValue(/#token=/);
    const shareUrl = await link.inputValue();
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
    const readerContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "no-preference",
    });
    try {
      const reader = await readerContext.newPage();
      await reader.goto(shareUrl);
      const current = reader.getByRole("region", {
        name: "Current presentation page",
        exact: true,
      });
      const readerLayer = current.locator("[data-native-scene] [data-motion-background]");
      await expectPlayback(readerLayer, true);
      await current.getByRole("button", { name: "Pause background motion", exact: true }).click();
      await expectPlayback(readerLayer, false);
      await reader
        .getByRole("navigation", { name: "Presentation pages", exact: true })
        .getByRole("button", { name: /Motion closing/ })
        .click();
      await expect(
        current.getByRole("heading", { name: "Motion closing", exact: true }),
      ).toBeVisible();
      await expectPlayback(readerLayer, false);
      await reader.reload();
      await expectPlayback(readerLayer, false);
      await current.getByRole("button", { name: "Play background motion", exact: true }).click();
      await expectPlayback(readerLayer, true);
      expect(await current.innerText()).not.toContain("PRIVATE");
      await noOverflow(reader);
      await capture(current.locator("[data-native-scene]"), `${artifact}-private-reader`);
    } finally {
      await readerContext.close();
    }
    await page.bringToFront();
    await share.getByRole("button", { name: "Close", exact: true }).click();
    expect(await saved()).toEqual(beforePlayback);

    const hosted = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
      data: { presentationId: record.id },
    });
    expect(hosted.status()).toBe(201);
    const { snapshot: lobby, controlToken } = await hosted.json();
    const sessionId = lobby.sessionId as string;
    await page.evaluate(
      ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
      { id: sessionId, token: controlToken },
    );
    await page.goto(`/presentation-session/${sessionId}/host`);
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    const currentSlide = page.getByRole("region", { name: "Current slide", exact: true });
    const liveLayer = currentSlide.locator("[data-native-scene] [data-motion-background]");
    await expectPlayback(liveLayer, true);
    await currentSlide
      .getByRole("button", { name: "Pause background motion", exact: true })
      .click();
    await expectPlayback(liveLayer, false);
    await page.getByRole("button", { name: "Next block", exact: true }).click();
    await expect(
      currentSlide.getByRole("heading", { name: "Motion closing", exact: true }),
    ).toBeVisible();
    await expectPlayback(liveLayer, false);
    await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();

    await enterE01Editor(page, record.id, narrow);
    await openE01Inspector(page, "Layout");
    await picker.getByRole("button", { name: "None · static", exact: true }).click();
    await expectSavedMotion(undefined);
    const cleared = await saved();
    expect(cleared.schemaVersion).toBe(17);
    expect(native(cleared).scene.schemaVersion).toBe(8);
    expect(native(cleared).scene.design).not.toHaveProperty("motionBackground");
    expect(native(cleared, 1).scene.design?.motionBackground).toBe("stars");
    await page.reload();
    await closeE01Overlays(page);
    await expect(editorLayer(page)).toHaveCount(0);
    await noOverflow(page);
  });

  test(`language-tagged motion slides retain editable text and pronunciation${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    await specialistLocale(page, "en-CA");
    const slide = designedSlide("Motion with pronunciation", "aurora");
    const originalBody = slide.scene!.nodes.find(
      (node) => node.type === "text" && node.role === "body",
    );
    if (originalBody?.type !== "text") throw new Error("Expected body text");
    originalBody.lang = "fr";
    const record = await createE01Deck(page, [slide], 17);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    const savedBody = async () => {
      const draft = (await readE01Record(page, record.id)).draft;
      const block = native(draft);
      const body = block.scene.nodes.find((node) => node.id === originalBody.id);
      if (body?.type !== "text") throw new Error("Expected saved body text");
      return {
        documentVersion: draft.schemaVersion,
        sceneVersion: block.scene.schemaVersion,
        motion: block.scene.design?.motionBackground,
        text: body.text,
        lang: body.lang,
      };
    };
    await enterE01Editor(page, record.id, narrow);
    await selectE01Body(page);
    await page
      .getByRole("textbox", { name: "Node text", exact: true })
      .fill("Examinez les faits et choisissez une action.");
    await expect.poll(savedBody).toEqual({
      documentVersion: 17,
      sceneVersion: 8,
      motion: "aurora",
      text: "Examinez les faits et choisissez une action.",
      lang: "fr",
    });
    const inspector = await openE01Inspector(page, "Access");
    await inspector.getByRole("combobox", { name: "Text language", exact: true }).selectOption("");
    await expect.poll(async () => (await savedBody()).lang).toBeUndefined();
    await inspector
      .getByRole("combobox", { name: "Text language", exact: true })
      .selectOption("ja");
    await expect.poll(async () => (await savedBody()).lang).toBe("ja");
    await page.reload();
    await selectE01Body(page);
    await page
      .getByRole("textbox", { name: "Node text", exact: true })
      .fill("The revised wording remains editable after reload.");
    await expect.poll(savedBody).toEqual({
      documentVersion: 17,
      sceneVersion: 8,
      motion: "aurora",
      text: "The revised wording remains editable after reload.",
      lang: "ja",
    });
    await openE01Inspector(page, "Layout");
    await page
      .getByRole("group", { name: "Motion background", exact: true })
      .getByRole("button", { name: "None · static", exact: true })
      .click();
    await expect.poll(async () => (await savedBody()).motion).toBeUndefined();
    await selectE01Body(page);
    await page
      .getByRole("textbox", { name: "Node text", exact: true })
      .fill("Editing after disabling motion also retains the scene version.");
    await expect.poll(savedBody).toEqual({
      documentVersion: 17,
      sceneVersion: 8,
      motion: undefined,
      text: "Editing after disabling motion also retains the scene version.",
      lang: "ja",
    });
  });

  test(`Korean reduced-motion picker stays accessible and still at 320px${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await page.setViewportSize({ width: 320, height: 844 });
    await signInBeta(page);
    const opening = designedSlide("Original authored title 日本語", "aurora");
    const closing = designedSlide("Original authored closing", "waves");
    const record = await createE01Deck(page, [opening, closing], 17);
    const copy = motionBackgroundCopy("ko-KR");
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
      await localizedPanels(page, true);
      const inspector = page.locator("#presentation-object-inspector");
      const picker = inspector.getByRole("group", { name: copy("Motion background"), exact: true });
      const choices = picker.getByRole("button");
      await expect(choices).toHaveCount(7);
      for (const label of ["None · static", ...presets.map(([, label]) => label)] as const) {
        const choice = picker.getByRole("button", { name: copy(label), exact: true });
        await expect(choice).toHaveAccessibleName(copy(label));
        await choice.scrollIntoViewIfNeeded();
        const bounds = await choice.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.width).toBeGreaterThanOrEqual(44);
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
      await expectStillThumbnails(picker.locator("[data-motion-background]"), 6);
      const stars = picker.getByRole("button", { name: copy("Star drift"), exact: true });
      await stars.focus();
      await page.keyboard.press(tabKey(page, true));
      await expect(
        picker.getByRole("button", { name: copy("Flowing ribbons"), exact: true }),
      ).toBeFocused();
      await page.keyboard.press(tabKey(page));
      await expect(stars).toBeFocused();
      await stars.press("Enter");
      await expect(stars).toBeFocused();
      await expect(stars).toHaveAttribute("aria-pressed", "true");
      await expect(stars).toHaveCSS("outline-style", "solid");
      await expect
        .poll(
          async () =>
            native((await readE01Record(page, record.id)).draft).scene.design?.motionBackground,
        )
        .toBe("stars");
      const saved = (await readE01Record(page, record.id)).draft;
      expect(saved.schemaVersion).toBe(17);
      expect(native(saved).scene.schemaVersion).toBe(8);
      expect(native(saved).scene.nodes).toEqual(opening.scene!.nodes);
      expect(native(saved).scene.readingOrder).toEqual(opening.scene!.readingOrder);
      const play = inspector.getByRole("button", { name: copy("Play preview"), exact: true });
      await play.click();
      await expectPlayback(picker.locator('[data-motion-background="stars"]'), false);
      await expect(picker.locator('[data-motion-playing="true"]')).toHaveCount(0);
      await noOverflow(page);
      const pickerAxe = await new AxeBuilder({ page })
        .include("#presentation-object-inspector")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(pickerAxe.violations.map(({ id }) => id)).toEqual([]);
      await capture(picker, `${info.project.name}-${record.id.slice(0, 8)}-korean-320-picker`);
      await localizedPanels(page, false);
      await expectPlayback(editorLayer(page), false);
      const motionControls = page.locator(
        '[data-native-scene-canvas="true"] [data-motion-controls]',
      );
      await expect(motionControls.getByRole("status")).toHaveText(
        copy("Reduced motion is enabled; backgrounds stay still."),
      );
      await expect(motionControls.getByRole("button")).toHaveCount(0);
      await noOverflow(page);
      const sceneAxe = await new AxeBuilder({ page })
        .include("#presentation-canvas")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(sceneAxe.violations.map(({ id }) => id)).toEqual([]);
      const mapTrigger = page.locator('button[aria-controls="presentation-slide-navigator"]');
      await mapTrigger.click();
      await expectStillFilmstrip(page.locator("#presentation-slide-navigator"), 2);
      await noOverflow(page);
      expect((await readE01Record(page, record.id)).draft).toEqual(saved);
    } finally {
      await specialistLocale(page, "en-CA");
    }
  });
}
