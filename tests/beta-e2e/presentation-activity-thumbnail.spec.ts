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

async function expectUnobscuredChoices(thumbnail: Locator, mediaState: MediaState) {
  const plane = thumbnail.locator(
    '[data-presentation-activity][data-static-thumbnail="true"] > div',
  );
  // Scrolling mounts thumbnail artwork through IntersectionObserver. Wait for its
  // canonical layout before measuring scaled coordinates, including WebKit's first frame.
  await expect
    .poll(() =>
      plane.evaluate((element) => {
        const node = element as HTMLElement;
        return [node.offsetWidth, node.offsetHeight];
      }),
    )
    .toEqual([960, 540]);
  const metrics = await plane.evaluate((element) => {
    const node = element as HTMLElement;
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      logicalWidth: node.offsetWidth,
      logicalHeight: node.offsetHeight,
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
      await choice.evaluate((element) => {
        // Inline-span client/scroll dimensions differ across browser engines.
        // Preserved trailing spaces may hang into card padding; every authored
        // line must stay inside the card and clear of its answer badge.
        const label = element.parentElement!.getBoundingClientRect();
        const card = element.closest('[role="listitem"]')!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const lines = Array.from(range.getClientRects());
        return (
          lines.length > 0 &&
          lines.every(
            (line) =>
              line.left >= label.left - 1 &&
              line.top >= card.top - 1 &&
              line.right <= card.right + 1 &&
              line.bottom <= card.bottom + 1,
          )
        );
      }),
    ).toBe(true);
    boxes.push(box);
  }
  // The filmstrip uses the same two-column answer artwork as the full slide. All authored
  // labels must fit in that plane, including the long first answer beside the media column.
  for (let first = 0; first < boxes.length; first++) {
    for (let second = first + 1; second < boxes.length; second++) {
      const left = boxes[first]!;
      const right = boxes[second]!;
      const overlap =
        left.left < right.right - 0.5 &&
        left.right > right.left + 0.5 &&
        left.top < right.bottom - 0.5 &&
        left.bottom > right.top + 0.5;
      expect(overlap, `answers ${first + 1} and ${second + 1} remain separate`).toBe(false);
    }
  }
  const answerGrid = thumbnail.locator('[role="list"][aria-label="Answer choices"]');
  const cells = await answerGrid.locator('[role="listitem"]').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }),
  );
  expect(cells).toHaveLength(4);
  expect(Math.abs(cells[0]!.top - cells[1]!.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(cells[2]!.top - cells[3]!.top)).toBeLessThanOrEqual(1);
  expect(cells[0]!.right).toBeLessThanOrEqual(cells[1]!.left + 0.5);
  expect(cells[2]!.right).toBeLessThanOrEqual(cells[3]!.left + 0.5);
  expect(cells[0]!.bottom).toBeLessThanOrEqual(cells[2]!.top + 0.5);
  expect(cells[1]!.bottom).toBeLessThanOrEqual(cells[3]!.top + 0.5);
  if (mediaState === "none") {
    await expect(thumbnail.locator('[data-has-media="false"]')).toHaveCount(1);
    await expect(thumbnail.locator("img,[data-thumbnail-image-state]")).toHaveCount(0);
    return;
  }
  await expect(thumbnail.locator("[data-has-media]")).toHaveAttribute("data-has-media", "true");
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
  expect(image.left).toBeGreaterThanOrEqual(-1);
  expect(image.top).toBeGreaterThanOrEqual(-1);
  expect(image.right).toBeLessThanOrEqual(metrics.logicalWidth + 1);
  expect(image.bottom).toBeLessThanOrEqual(metrics.logicalHeight + 1);
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
  test(`activity thumbnails keep media and all four answer choices readable${suffix}`, async ({
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
      await expect(prompt).toHaveText(prompts[promptIndex]!);
      expect(
        await prompt.evaluate(
          (element) =>
            element.scrollHeight <= element.clientHeight + 1 &&
            element.scrollWidth <= element.clientWidth + 1,
        ),
        "The full prompt remains visible in the shared slide artwork",
      ).toBe(true);
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
