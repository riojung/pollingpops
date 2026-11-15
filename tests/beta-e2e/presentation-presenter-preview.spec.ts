import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { InteractiveQuestionBlockDraft } from "../../packages/contracts/src/index.ts";
import {
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 20_000 });

const privateMarker = "PRIVATE_PREVIEW_REHEARSAL";
const activityPrompt =
  "Which action gives this fictional team a clear owner, an agreed review date and enough evidence to decide what should happen after the current release rehearsal?";

function notesFor(slide: string) {
  return Array.from(
    { length: 14 },
    (_, index) =>
      `${privateMarker} ${slide} cue ${index + 1}. Pause, name the next owner and leave a quiet moment to review the evidence.`,
  ).join("\n\n");
}

async function previewFixture(page: Page) {
  await signInBeta(page);
  const opening = e01Slide("A clear opening for the review");
  const context = e01Slide("Evidence before the next decision");
  const closing = e01Slide("An owner and a date for the next step");
  opening.speakerNotes = notesFor("opening");
  context.speakerNotes = notesFor("context");
  closing.speakerNotes = notesFor("closing");
  for (const slide of [opening, context, closing])
    expect(slide.speakerNotes.length).toBeLessThanOrEqual(2000);
  const activity: InteractiveQuestionBlockDraft = {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type: "single_select",
      prompt: activityPrompt,
      choices: [
        "Agree one accountable owner, record the evidence that will support the decision and choose a review date before sharing the next project update.",
        "Invite the group to compare the open dependencies, identify which questions still need an owner and document when those answers should be reviewed.",
        "Ask the delivery team to check the proposed next step, describe what evidence is missing and record the handoff needed before the next meeting.",
        "Review the planned communication order, name who will approve the next update and leave time for the team to inspect the supporting evidence.",
      ].map((label, index) => ({ id: randomUUID(), label, isCorrect: index === 0 })),
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 30,
      basePoints: 100,
      explanation: "PRIVATE_PREVIEW_ANSWER_RATIONALE",
      mediaId: null,
      mediaAlt: null,
    },
  };
  const blocks = [opening, context, activity, closing];
  const initial = await createE01Deck(page, blocks, 14);
  const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${initial.id}/draft`, {
    data: {
      draft: {
        ...initial.draft,
        title: "A draft rehearsal with spatial context",
        spatial: {
          schemaVersion: 1,
          frames: blocks.map((block, index) => ({
            blockId: block.id,
            x: index * 2400,
            y: index % 2 === 0 ? 0 : 1600,
            width: 1280,
            height: 720,
          })),
        },
      },
      expectedRevision: initial.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  const record = await readE01Record(page, initial.id);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return;
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith(`/v1/presentations/${record.id}`) ||
      /\/v1\/presentation-sessions(?:\/|$)|\/responses(?:\/|$)/.test(path)
    )
      writes.push(`${request.method()} ${path}`);
  });
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload === "string" && /presentation\.(?:command|response)/.test(payload))
        writes.push(payload);
    });
  });
  return { record, opening, context, closing, writes };
}

async function bounds(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result!;
}

async function expectLayout(page: Page, preview: Locator) {
  const header = preview.locator("[data-preview-header]");
  const footer = preview.locator("[data-preview-footer]");
  const body = preview.locator("[data-preview-body]");
  const path = preview.getByRole("region", { name: "Presentation spatial path", exact: true });
  for (const part of [header, footer, body, path]) await expect(part).toBeInViewport({ ratio: 1 });
  const [top, bottom, workspace, map] = await Promise.all([
    bounds(header),
    bounds(footer),
    bounds(body),
    bounds(path),
  ]);
  expect(top.y + top.height).toBeLessThanOrEqual(map.y + 1);
  expect(map.y + map.height).toBeLessThanOrEqual(workspace.y + 1);
  expect(workspace.y + workspace.height).toBeLessThanOrEqual(bottom.y + 1);
  expect(workspace.height).toBeGreaterThan(0);
  expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const notesRegion = preview.getByRole("region", { name: "Private presenter notes", exact: true });
  const [slide, notes, paper] = await Promise.all([
    bounds(preview.locator("[data-preview-slide-viewport]")),
    bounds(notesRegion),
    bounds(preview.locator('article[data-native-scene="true"]')),
  ]);
  const overlaps =
    slide.x < notes.x + notes.width - 1 &&
    slide.x + slide.width > notes.x + 1 &&
    slide.y < notes.y + notes.height - 1 &&
    slide.y + slide.height > notes.y + 1;
  expect(overlaps, "The slide and private notes occupy separate space").toBe(false);
  expect(slide.y).toBeGreaterThanOrEqual(workspace.y - 1);
  expect(paper.x).toBeGreaterThanOrEqual(slide.x - 1);
  expect(paper.y).toBeGreaterThanOrEqual(slide.y - 1);
  expect(paper.x + paper.width).toBeLessThanOrEqual(slide.x + slide.width + 1);
  expect(paper.y + paper.height).toBeLessThanOrEqual(slide.y + slide.height + 1);
  if (page.viewportSize()!.width > 700) {
    expect(paper.width / paper.height).toBeCloseTo(16 / 9, 1);
    expect(slide.y + slide.height).toBeLessThanOrEqual(bottom.y + 1);
    expect(notes.y + notes.height).toBeLessThanOrEqual(bottom.y + 1);
  } else {
    expect(paper.y + paper.height).toBeLessThanOrEqual(notes.y + 1);
  }
  const notesHeading = notesRegion.getByRole("heading", { name: "Speaker notes", exact: true });
  await notesRegion.scrollIntoViewIfNeeded();
  await notesHeading.scrollIntoViewIfNeeded();
  await expect(notesHeading).toBeInViewport({ ratio: 1 });
  await notesHeading.click({ trial: true });
  if (page.viewportSize()!.width <= 700) {
    const [scrolledPaper, scrolledNotes] = await Promise.all([
      bounds(preview.locator('article[data-native-scene="true"]')),
      bounds(notesRegion),
    ]);
    expect(scrolledPaper.y + scrolledPaper.height).toBeLessThanOrEqual(scrolledNotes.y + 1);
  }
  await body.evaluate((element) => element.scrollTo({ top: 0, left: 0 }));
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(1);
}

async function expectAccessible(preview: Locator) {
  const { violations } = await new AxeBuilder({ page: preview.page() })
    .include("[data-presentation-preview]")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(violations).toEqual([]);
}

async function expectModalFocus(page: Page, preview: Locator, trigger: Locator) {
  const close = preview.getByRole("button", { name: "Close preview", exact: true });
  await expect
    .poll(() => preview.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  for (const key of ["Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(
      await preview.evaluate((element) => {
        const active = document.activeElement;
        return (
          element.contains(active) ||
          active === document.body ||
          active === document.documentElement
        );
      }),
    ).toBe(true);
  }
  await close.focus();
  await trigger.evaluate((element) => {
    if (element instanceof HTMLElement) element.focus();
  });
  await expect(close).toBeFocused();
}

for (const suffix of ["", " @mobile"]) {
  test(`presenter preview separates spatial context, readable slides and private notes${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    const mobile = Boolean(suffix);
    const viewports = mobile
      ? [{ width: 320, height: 740 }]
      : [
          { width: 1280, height: 800 },
          { width: 1280, height: 500 },
        ];
    await page.setViewportSize(viewports[0]!);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    const fixture = await previewFixture(page);
    await enterE01Editor(page, fixture.record.id, mobile);
    await closeE01Overlays(page);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const trigger = page.getByRole("button", { name: "Preview", exact: true });
      await trigger.focus();
      await trigger.press("Enter");
      const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
      const slide = preview.getByRole("region", { name: "Slide preview", exact: true });
      const notes = preview.getByRole("region", { name: "Private presenter notes", exact: true });
      const notesText = preview.getByRole("group", { name: "Speaker notes text", exact: true });
      const path = preview.getByRole("region", { name: "Presentation spatial path", exact: true });
      const disclosure = path.locator("details");
      const summary = disclosure.locator("summary");
      const diagram = path.locator("[data-spatial-view]");
      const next = preview.getByRole("button", { name: "Next", exact: true });
      const previous = preview.getByRole("button", { name: "Previous", exact: true });
      const screenshot = `${viewport.width}x${viewport.height}`;
      await expect(preview).toBeVisible();
      await expectModalFocus(page, preview, trigger);
      await expect(
        preview.getByRole("button", { name: "Audience view", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(notes).toHaveCount(0);
      expect(await preview.textContent()).not.toContain(privateMarker);
      await expect(slide).toContainText("A clear opening for the review");
      await expect(path).toHaveAttribute("data-spatial-compact", "true");
      await expect(summary).toHaveAccessibleName("Presentation spatial path");
      await expect(disclosure).not.toHaveAttribute("open", "");
      await expect(diagram).toBeHidden();
      expect((await bounds(path)).height).toBeLessThanOrEqual(70);
      await expect(previous).toBeDisabled();
      await preview.getByRole("button", { name: "Presenter view", exact: true }).click();
      await expect(notesText).toHaveText(fixture.opening.speakerNotes);
      await expect(notes).toContainText("Slide 1 of 4");
      await expectLayout(page, preview);
      await expectAccessible(preview);
      await page.screenshot({
        path: info.outputPath(`presenter-collapsed-${screenshot}.png`),
        scale: "css",
      });

      await summary.click();
      await expect(disclosure).toHaveAttribute("open", "");
      await path.getByRole("button", { name: "Show overview", exact: true }).click();
      await expect(diagram).toHaveAttribute("data-spatial-view", "overview");
      await expect(path.locator("[data-spatial-page]")).toHaveCount(4);
      await diagram.scrollIntoViewIfNeeded();
      await expect(diagram).toBeInViewport({ ratio: 0.98 });
      const diagramBounds = await bounds(diagram);
      const scrollport = await diagram.evaluate((element) => {
        let parent = element.parentElement;
        while (parent && !["auto", "scroll"].includes(getComputedStyle(parent).overflowY))
          parent = parent.parentElement;
        if (!parent) return null;
        const rect = parent.getBoundingClientRect();
        const left = rect.left + parent.clientLeft;
        const top = rect.top + parent.clientTop;
        return { left, top, right: left + parent.clientWidth, bottom: top + parent.clientHeight };
      });
      expect(scrollport, "The open map has a bounded scrollport").not.toBeNull();
      expect(diagramBounds.x).toBeGreaterThanOrEqual(scrollport!.left - 1);
      expect(diagramBounds.y).toBeGreaterThanOrEqual(scrollport!.top - 1);
      expect(diagramBounds.x + diagramBounds.width).toBeLessThanOrEqual(scrollport!.right + 1);
      expect(diagramBounds.y + diagramBounds.height).toBeLessThanOrEqual(scrollport!.bottom + 1);
      await expectLayout(page, preview);
      await expectAccessible(preview);
      await page.screenshot({
        path: info.outputPath(`presenter-map-open-${screenshot}.png`),
        scale: "css",
      });
      const expanded = await bounds(path);
      await path.getByRole("button", { name: "Use linear view", exact: true }).click();
      await expect(diagram).toBeHidden();
      expect((await bounds(path)).height).toBeLessThan(expanded.height - 1);
      await expectLayout(page, preview);
      await page.screenshot({
        path: info.outputPath(`presenter-linear-${screenshot}.png`),
        scale: "css",
      });
      await path.getByRole("button", { name: "Use spatial view", exact: true }).click();
      await summary.click();
      await expect(disclosure).not.toHaveAttribute("open", "");

      expect(
        await notesText.evaluate((element) => element.scrollHeight > element.clientHeight),
      ).toBe(true);
      await notesText.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await notesText.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await preview.locator("[data-preview-body]").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await next.click();
      await expect(slide).toContainText("Evidence before the next decision");
      await expect(notesText).toHaveText(fixture.context.speakerNotes);
      await expect(notes).toContainText("Slide 2 of 4");
      await expect
        .poll(() => notesText.evaluate((element) => element.scrollTop))
        .toBeLessThanOrEqual(1);
      await expect
        .poll(() => preview.locator("[data-preview-body]").evaluate((element) => element.scrollTop))
        .toBeLessThanOrEqual(1);
      await expect(slide.locator('[data-native-scene="true"]')).toBeInViewport({ ratio: 1 });
      await expectLayout(page, preview);
      await next.click();
      await expect(slide.getByRole("heading", { name: activityPrompt, exact: true })).toBeVisible();
      await expect(notes).toContainText("Slide 3 of 4");
      await expect(notesText).toContainText("No speaker notes for this slide yet.");
      expect(await notes.textContent()).not.toContain(privateMarker);
      expect(await slide.textContent()).not.toContain("PRIVATE_PREVIEW_ANSWER_RATIONALE");
      await next.click();
      await expect(slide).toContainText("An owner and a date for the next step");
      await expect(notesText).toHaveText(fixture.closing.speakerNotes);
      await expect(notes).toContainText("Slide 4 of 4");
      await expect(next).toBeDisabled();
      await previous.click();
      await expect(slide).toContainText(activityPrompt);
      await expect(notesText).toContainText("No speaker notes for this slide yet.");
      await preview.getByRole("button", { name: "Audience view", exact: true }).click();
      await expect(notes).toHaveCount(0);
      expect(await preview.textContent()).not.toContain(privateMarker);
      await expectAccessible(preview);
      await page.screenshot({
        path: info.outputPath(`audience-activity-${screenshot}.png`),
        scale: "css",
      });
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await readE01Record(page, fixture.record.id)).toEqual(fixture.record);
      expect(fixture.writes).toEqual([]);
    }
  });
}
