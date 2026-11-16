import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";
import type {
  PresentationHostSnapshot,
  PresentationMotionBackground,
} from "../../packages/contracts/src/index.ts";
import { createE01Deck, e01ApiUrl, e01Slide } from "./presentation-e01-support";
import { specialistLocale } from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 20_000 });

const presets = [
  "aurora",
  "waves",
  "orbs",
  "mesh",
  "ribbons",
  "stars",
] as const satisfies readonly PresentationMotionBackground[];
const reducedMessage = "Reduced motion is enabled; backgrounds stay still.";
const preferenceKey = "openround:experience-preferences";

function motionSlide(preset: PresentationMotionBackground) {
  const slide = e01Slide(`Playback ${preset}`);
  slide.scene!.schemaVersion = 8;
  slide.scene!.design = {
    theme: "paper",
    font: "sans",
    spacing: "relaxed",
    motionBackground: preset,
  };
  return slide;
}

async function expectVisiblePlayback(layer: Locator, playing: boolean) {
  await layer.page().bringToFront();
  await layer.scrollIntoViewIfNeeded();
  await expect(layer).toHaveAttribute("data-motion-playing", String(playing));
  // Timelines can advance while the artwork remains imperceptibly still. Measure
  // rendered translation over a short interval without seeking or replacing CSS.
  const sample = await layer.evaluate(async (element) => {
    const children = Array.from(element.children);
    const positions = () =>
      children.map((child) => {
        const transform = getComputedStyle(child).transform;
        const matrix = new DOMMatrixReadOnly(transform === "none" ? undefined : transform);
        return { x: matrix.m41, y: matrix.m42 };
      });
    const before = positions();
    await new Promise((resolve) => setTimeout(resolve, 750));
    const after = positions();
    return {
      connected: element.isConnected && children.every((child) => child.isConnected),
      width: element.getBoundingClientRect().width,
      running: element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.playState === "running").length,
      movement: after.map((position, index) =>
        Math.hypot(position.x - before[index]!.x, position.y - before[index]!.y),
      ),
    };
  });
  expect(sample.connected).toBe(true);
  expect(sample.movement).toHaveLength(3);
  expect(sample.width).toBeGreaterThan(0);
  const displacement = Math.max(...sample.movement);
  if (playing) {
    expect(sample.running).toBeGreaterThan(0);
    // The same visible travel scales with the canvas on desktop and phones.
    expect(displacement, JSON.stringify(sample)).toBeGreaterThanOrEqual(sample.width * 0.001);
  } else {
    expect(sample.running).toBe(0);
    expect(displacement, JSON.stringify(sample)).toBeLessThanOrEqual(0.1);
  }
}

for (const suffix of ["", " @mobile"]) {
  test(`live backgrounds visibly move, honor reduced motion and keep report actions readable${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
    await signInBeta(page);
    await specialistLocale(page, "en-CA");
    await page.evaluate((key) => {
      localStorage.removeItem(key);
      localStorage.removeItem("polling-pops:presentation-motion-paused");
      document.documentElement.removeAttribute("data-openround-motion");
    }, preferenceKey);
    const record = await createE01Deck(page, presets.map(motionSlide), 17);
    const published = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      { data: { expectedDraftRevision: record.draftRevision } },
    );
    expect(published.status()).toBe(200);
    const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
      data: { presentationId: record.id },
    });
    expect(created.status()).toBe(201);
    const { snapshot: lobby, controlToken } = (await created.json()) as {
      snapshot: PresentationHostSnapshot;
      controlToken: string;
    };
    const sessionId = lobby.sessionId;
    await page.evaluate(
      ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
      { id: sessionId, token: controlToken },
    );
    await page.goto(`/presentation-session/${sessionId}/host`);
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    const current = page.getByRole("region", { name: "Current slide", exact: true });
    const layer = current.locator("[data-native-scene] [data-motion-background]");
    for (const [index, preset] of presets.entries()) {
      await expect(
        current.getByRole("heading", { name: `Playback ${preset}`, exact: true }),
      ).toBeVisible();
      await expect(layer).toHaveAttribute("data-motion-background", preset);
      await expectVisiblePlayback(layer, true);
      await current.getByRole("button", { name: "Pause background motion", exact: true }).click();
      await expectVisiblePlayback(layer, false);
      await current.getByRole("button", { name: "Play background motion", exact: true }).click();
      await expect(layer).toHaveAttribute("data-motion-playing", "true");
      if (index < presets.length - 1)
        await page.getByRole("button", { name: "Next block", exact: true }).click();
    }
    await current.screenshot({ path: info.outputPath("host-background-playback.png") });

    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
    const contextOptions = {
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      locale: "en-CA",
      reducedMotion: "no-preference" as const,
      colorScheme: "light" as const,
    };
    const participantContext = await browser.newContext(contextOptions);
    const stageContext = await browser.newContext(contextOptions);
    try {
      const participant = await participantContext.newPage();
      await participant.goto(`/join?code=${lobby.code}`);
      await participant.getByLabel("Nickname", { exact: true }).fill("Playback guest");
      await participant.getByRole("button", { name: "Join presentation", exact: true }).click();
      await expect(participant).toHaveURL(`/presentation-session/${sessionId}/play`);
      const passResponse = await page.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/stage-pass`,
      );
      expect(passResponse.status()).toBe(201);
      const { stageToken } = (await passResponse.json()) as { stageToken: string };
      const stage = await stageContext.newPage();
      await stage.goto(
        `/presentation-session/${sessionId}/stage#pass=${encodeURIComponent(stageToken)}`,
      );
      for (const surface of [participant, stage]) {
        const audienceLayer = surface.locator("[data-native-scene] [data-motion-background]");
        await expect(audienceLayer).toHaveAttribute("data-motion-background", "stars");
        await expectVisiblePlayback(audienceLayer, true);
        await surface.getByRole("button", { name: "Pause background motion", exact: true }).click();
        await expectVisiblePlayback(audienceLayer, false);
      }
    } finally {
      await participantContext.close();
      await stageContext.close();
    }

    await page.bringToFront();
    await page.evaluate(() => {
      document.documentElement.dataset.openroundMotion = "reduced";
    });
    await expect(current.getByRole("status")).toHaveText(reducedMessage);
    await expectVisiblePlayback(layer, false);
    await page.evaluate(() => {
      document.documentElement.removeAttribute("data-openround-motion");
    });
    await expect(
      current.getByRole("button", { name: "Pause background motion", exact: true }),
    ).toBeVisible();
    await expectVisiblePlayback(layer, true);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(current.getByRole("status")).toHaveText(reducedMessage);
    await expectVisiblePlayback(layer, false);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expectVisiblePlayback(layer, true);

    // Saved app preferences also apply on routes without an accessibility menu.
    await page.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({ reducedMotion: true }));
    }, preferenceKey);
    await page.reload();
    await expect(page.locator("html")).not.toHaveAttribute("data-openround-motion", "reduced");
    await expect(current.getByRole("status")).toHaveText(reducedMessage);
    await expectVisiblePlayback(layer, false);
    await page.evaluate((key) => localStorage.removeItem(key), preferenceKey);
    await page.reload();
    await expectVisiblePlayback(layer, true);

    await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
    const reportSelector = `main > header a[href="/presentation-session/${sessionId}/report"]`;
    const reportLink = page.locator(reportSelector);
    await expect(reportLink).toHaveAccessibleName("View report");
    for (const mode of ["light", "dark"]) {
      await page.evaluate((value) => {
        localStorage.setItem("openround:color-mode", value);
        window.dispatchEvent(new Event("openround:color-mode-change"));
      }, mode);
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
      await reportLink.scrollIntoViewIfNeeded();
      const contrast = await new AxeBuilder({ page })
        .include(reportSelector)
        .withRules(["color-contrast"])
        .analyze();
      expect(contrast.violations).toEqual([]);
      expect(contrast.passes.map((rule) => rule.id)).toContain("color-contrast");
      await reportLink.screenshot({ path: info.outputPath(`view-report-${mode}.png`) });
    }
    await reportLink.click();
    await expect(page).toHaveURL(`/presentation-session/${sessionId}/report`);
    await expect(
      page.getByRole("heading", { name: record.draft.title, exact: true }),
    ).toBeVisible();
  });
}
