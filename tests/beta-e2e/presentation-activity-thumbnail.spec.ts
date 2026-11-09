import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import {
  PresentationDraftSchema,
  type InteractiveQuestionBlockDraft,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import { e01ApiUrl, e01Slide, enterE01Editor, type E01Record } from "./presentation-e01-support";

const choices = [
  "Coordinate the launch plan with regional leads, then confirm the owner and timing for each customer announcement.",
  "Align the team",
  "Review the risk",
  "Share an update",
];
const prompts = ["Choose the next step", "Which launch action should the project team take next?"];
type MediaState = "ready" | "none" | "unavailable";

test.use({ actionTimeout: 30_000 });

async function textLines(locator: Locator) {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getClientRects().length;
  });
}

async function expectUnobscuredChoices(thumbnail: Locator, mediaState: MediaState) {
  const plane = thumbnail.locator("[data-has-media]");
  const metrics = await plane.evaluate((element) => {
    const node = element as HTMLElement;
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      logicalWidth: node.clientWidth,
      logicalHeight: node.clientHeight,
    };
  });
  expect(metrics.logicalWidth).toBe(960);
  expect(metrics.logicalHeight).toBe(540);
  const scaleX = metrics.width / metrics.logicalWidth;
  const scaleY = metrics.height / metrics.logicalHeight;
  const boxes = [];
  for (const label of choices) {
    const choice = thumbnail.getByText(label, { exact: true });
    await expect(choice).toHaveCount(1);
    const bounds = await choice.boundingBox();
    expect(bounds).not.toBeNull();
    const box = {
      left: (bounds!.x - metrics.x) / scaleX,
      top: (bounds!.y - metrics.y) / scaleY,
      right: (bounds!.x + bounds!.width - metrics.x) / scaleX,
      bottom: (bounds!.y + bounds!.height - metrics.y) / scaleY,
    };
    expect(box.left, `${label} stays within the thumbnail`).toBeGreaterThanOrEqual(-1);
    expect(box.right, `${label} stays within the thumbnail`).toBeLessThanOrEqual(
      metrics.logicalWidth + 1,
    );
    expect(box.top).toBeGreaterThanOrEqual(-1);
    expect(box.bottom, `${label} remains visible in the 540px plane`).toBeLessThanOrEqual(
      metrics.logicalHeight + 1,
    );
    expect(
      await choice.evaluate(
        (element) =>
          element.scrollHeight <= element.clientHeight + 1 &&
          element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    boxes.push(box);
  }
  expect(await textLines(thumbnail.getByText(choices[0]!, { exact: true }))).toBe(2);
  for (let index = 1; index < boxes.length; index++)
    expect(boxes[index - 1]!.bottom).toBeLessThanOrEqual(boxes[index]!.top + 1);
  if (mediaState === "none") {
    await expect(plane).toHaveAttribute("data-has-media", "false");
    await expect(thumbnail.locator("img,[data-thumbnail-image-state]")).toHaveCount(0);
    return;
  }
  await expect(plane).toHaveAttribute("data-has-media", "true");
  const media = thumbnail.locator(`[data-thumbnail-image-state="${mediaState}"]`);
  await expect(media).toHaveCount(1);
  const bounds = await media.boundingBox();
  expect(bounds).not.toBeNull();
  const image = {
    left: (bounds!.x - metrics.x) / scaleX,
    top: (bounds!.y - metrics.y) / scaleY,
    right: (bounds!.x + bounds!.width - metrics.x) / scaleX,
    bottom: (bounds!.y + bounds!.height - metrics.y) / scaleY,
  };
  for (const [index, choice] of boxes.entries()) {
    const overlap =
      image.left < choice.right - 0.5 &&
      image.right > choice.left + 0.5 &&
      image.top < choice.bottom - 0.5 &&
      image.bottom > choice.top + 0.5;
    expect(overlap, `media must not cover choice ${index + 1}`).toBe(false);
  }
}

for (const suffix of ["", " @mobile"]) {
  test(`activity thumbnails keep media and all four answer rows readable${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const created = await page.request.post(`${e01ApiUrl}/v1/presentations`, {
      data: { title: `Activity image layout ${randomUUID().slice(0, 8)}` },
    });
    expect(created.status()).toBe(201);
    const initial = (await created.json()).presentation as E01Record;
    const scenarios = (["ready", "none", "unavailable"] as const).flatMap((mediaState) =>
      prompts.map((prompt, promptIndex) => {
        const mediaId = mediaState === "none" ? null : randomUUID();
        const block: InteractiveQuestionBlockDraft = {
          id: randomUUID(),
          kind: "question",
          question: {
            id: randomUUID(),
            type: "poll",
            prompt,
            choices: choices.map((label) => ({ id: randomUUID(), label, isCorrect: false })),
            purpose: "opinion",
            confidence: "off",
            delivery: "main",
            conceptKeys: [],
            linkedRecheckQuestionId: null,
            timeLimitSeconds: 20,
            basePoints: 0,
            explanation: "",
            maxSelections: 1,
            mediaId,
            mediaAlt: mediaId ? `Private launch reference ${promptIndex + 1}` : null,
          },
        };
        return { block, mediaId, mediaState, promptIndex };
      }),
    );
    const record = {
      ...initial,
      draft: PresentationDraftSchema.parse({
        ...initial.draft,
        schemaVersion: 9,
        blocks: [
          e01Slide("Review the activity thumbnails"),
          ...scenarios.map(({ block }) => block),
        ],
      }),
    };
    const imageBytes = await readFile("apps/web/public/brand/polling-pops-social.png");
    const mediaStates = new Map<string, MediaState>(
      scenarios
        .filter((scenario) => scenario.mediaId !== null)
        .map((scenario) => [scenario.mediaId!, scenario.mediaState]),
    );
    const imageUrl = (mediaId: string) =>
      new URL(`/private-activity-thumbnail-${mediaId}.png?signature=synthetic`, page.url()).href;
    const imageReads: string[] = [];
    // These synthetic clean/private asset responses isolate thumbnail geometry and reader policy;
    // real ownership and scanner behavior remain covered by the API/asset qualification suites.
    await page.route(`${e01ApiUrl}/v1/presentations/${record.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({ json: { presentation: record } });
    });
    await page.route(`${e01ApiUrl}/v1/media/*`, async (route) => {
      const mediaId = new URL(route.request().url()).pathname.split("/").at(-1)!;
      const state = mediaStates.get(mediaId);
      if (!state) return route.continue();
      if (state === "unavailable")
        return route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "Media not found" } },
        });
      await route.fulfill({ json: { downloadUrl: imageUrl(mediaId) } });
    });
    await page.route("**/private-activity-thumbnail-*.png?signature=synthetic", async (route) => {
      imageReads.push(route.request().url());
      expect(route.request().headers().referer).toBeUndefined();
      await route.fulfill({ contentType: "image/png", body: imageBytes });
    });
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    const mapTrigger = page.locator('button[aria-controls="presentation-slide-navigator"]');
    if ((await mapTrigger.getAttribute("aria-expanded")) === "false") await mapTrigger.click();
    const map = page.locator("#presentation-slide-navigator");
    await expect(map).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    for (const { block, mediaState, promptIndex, mediaId } of scenarios) {
      const thumbnail = map.locator(`[data-slide-thumbnail="${block.id}"]`);
      await thumbnail.scrollIntoViewIfNeeded();
      await expect(thumbnail).toHaveAttribute("inert", "");
      await expect(thumbnail).toHaveAttribute("aria-hidden", "true");
      await expect(thumbnail.locator("button,input,a")).toHaveCount(0);
      if (mediaState === "ready") {
        const image = thumbnail.locator('img[data-thumbnail-image-state="ready"]');
        await expect(image).toHaveAttribute("src", imageUrl(mediaId!));
        await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
        await expect
          .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
          .toBeGreaterThan(0);
      } else if (mediaState === "unavailable") {
        await expect(thumbnail.locator('[data-thumbnail-image-state="unavailable"]')).toHaveCount(
          1,
        );
        await expect(thumbnail.locator("img")).toHaveCount(0);
        expect(imageReads).not.toContain(imageUrl(mediaId!));
      }
      const prompt = thumbnail.getByText(prompts[promptIndex]!, { exact: true });
      await expect(prompt).toBeVisible();
      expect(await textLines(prompt)).toBe(promptIndex === 0 ? 1 : 2);
      await expectUnobscuredChoices(thumbnail, mediaState);
      await thumbnail.screenshot({
        path: testInfo.outputPath(`activity-${mediaState}-${promptIndex + 1}.png`),
      });
    }
    expect(
      await page.evaluate(() =>
        [localStorage, sessionStorage].some((storage) =>
          Object.values(storage).some((value) =>
            String(value).includes("private-activity-thumbnail-"),
          ),
        ),
      ),
    ).toBe(false);
  });
}
