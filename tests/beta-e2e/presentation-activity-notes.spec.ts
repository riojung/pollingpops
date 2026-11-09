import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type {
  ContentSlideDraft,
  InteractiveQuestionBlockDraft,
  PresentationDraft,
  PresentationHostSnapshot,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  clickNavigatorAction,
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  openE01Inspector,
  readE01Record,
  selectE01Block,
} from "./presentation-e01-support";

const design = { theme: "sunset", font: "serif", spacing: "relaxed" } as const;
const prompt =
  "Which launch response would best help this fictional project team agree on clear ownership, timing and evidence before the next customer update?";
const answers = [
  "Bring the regional leads together to compare the launch checklist, choose one accountable owner for each announcement, and record the evidence needed before sharing an update.",
  "Ask the support team to review the customer messages, identify the questions that need an owner, and confirm when each answer can be included in the next planned announcement.",
  "Invite the delivery group to check the release timeline, describe the dependencies still open, and agree which evidence will support the next decision about the launch date.",
  "Arrange a review with the project sponsor to confirm the proposed communication order, document the unresolved handoffs, and name who will approve each update before publication.",
];
const privateMarker = "PRIVATE_ACTIVITY_NOTES_REHEARSAL";

function nativeSlide(title: string): ContentSlideDraft {
  const block = e01Slide(title);
  block.scene!.schemaVersion = 3;
  block.scene!.design = { ...design };
  block.citations = [{ locator: "Synthetic launch brief", excerpt: "Review the next owner." }];
  return block;
}

function pollBlock(): InteractiveQuestionBlockDraft {
  return {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type: "poll",
      prompt,
      choices: answers.map((label) => ({ id: randomUUID(), label, isCorrect: false })),
      maxSelections: 1,
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 60,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    },
    sourceDisclosure: {
      sourceName: "Synthetic activity copy",
      sourceDigest: "a".repeat(64),
      provider: "local",
      model: "activity-notes-browser-fixture",
    },
  };
}

function questionIn(draft: PresentationDraft, id: string) {
  const block = draft.blocks.find((candidate) => candidate.id === id);
  if (block?.kind !== "question" || block.question.type !== "poll")
    throw new Error("Expected the synthetic poll");
  return block.question;
}

function contentIn(draft: PresentationDraft, id: string) {
  const block = draft.blocks.find((candidate) => candidate.id === id);
  if (block?.kind !== "content") throw new Error("Expected the synthetic content slide");
  return block;
}

function trackDeliveryWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return;
    const path = new URL(request.url()).pathname;
    if (
      /\/v1\/presentation-sessions(?:\/|$)/.test(path) ||
      /\/v1\/presentations\/[^/]+\/publish$/.test(path) ||
      /\/responses(?:\/|$)/.test(path)
    )
      writes.push(`${request.method()} ${path}`);
  });
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload === "string" && /presentation\.(?:command|response)/.test(payload))
        writes.push(payload);
    });
  });
  return writes;
}

async function hideInspector(page: Page) {
  const trigger = page.locator('button[aria-controls="presentation-object-inspector"]');
  if ((await trigger.getAttribute("aria-expanded")) === "true") await trigger.click();
  await expect(page.locator("#presentation-object-inspector")).toBeHidden();
}

async function accessibleAndContained(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(violations).toEqual([]);
}

async function expectDialogInViewport(dialog: Locator) {
  await expect
    .poll(async () => {
      const bounds = await dialog.boundingBox();
      const viewport = dialog.page().viewportSize();
      return Boolean(
        bounds &&
        viewport &&
        bounds.x >= -1 &&
        bounds.y >= -1 &&
        bounds.x + bounds.width <= viewport.width + 1 &&
        bounds.y + bounds.height <= viewport.height + 1,
      );
    })
    .toBe(true);
}

async function expectCompleteActivity(activity: Locator, copy: string[], editable: boolean) {
  await expect(activity).toBeVisible();
  await expect(activity).toHaveAttribute("data-activity-theme", "sunset");
  const surface = activity.getByRole("article", { name: "Activity content", exact: true });
  const choices = activity.getByRole("list", { name: "Answer choices", exact: true });
  await expect(choices.getByRole("listitem")).toHaveCount(copy.length);
  const boxes = [];
  for (const [index, label] of copy.entries()) {
    const item = choices.getByRole("listitem").nth(index);
    const badge = item.locator(':scope > span[aria-hidden="true"]');
    const text = editable
      ? item.getByRole("textbox", { name: `Slide answer ${String.fromCharCode(65 + index)}` })
      : item.getByText(label, { exact: true });
    if (editable) await expect(text).toHaveValue(label);
    else await expect(text).toHaveText(label);
    await expect(text).toBeVisible();
    const [bounds, badgeBounds, surfaceBounds] = await Promise.all([
      text.boundingBox(),
      badge.boundingBox(),
      surface.boundingBox(),
    ]);
    expect(bounds).not.toBeNull();
    expect(badgeBounds).not.toBeNull();
    expect(surfaceBounds).not.toBeNull();
    expect(bounds!.width, `Answer ${index + 1} has room beyond its badge`).toBeGreaterThan(
      badgeBounds!.width,
    );
    expect(bounds!.x).toBeGreaterThanOrEqual(surfaceBounds!.x - 1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      surfaceBounds!.x + surfaceBounds!.width + 1,
    );
    expect(bounds!.y).toBeGreaterThanOrEqual(surfaceBounds!.y - 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
      surfaceBounds!.y + surfaceBounds!.height + 1,
    );
    expect(
      await text.evaluate((element) => {
        if (element instanceof HTMLTextAreaElement)
          return (
            element.scrollHeight <= element.clientHeight + 1 &&
            element.scrollWidth <= element.clientWidth + 1
          );
        // Inline spans have no client box; Firefox and Chromium report different
        // scroll dimensions. Preserved trailing spaces may hang into card padding.
        // Keep every rendered line inside its card and clear of the answer badge.
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
      `Answer ${index + 1} shows the full authored label`,
    ).toBe(true);
    boxes.push(bounds!);
  }
  for (let first = 0; first < boxes.length; first++) {
    for (let second = first + 1; second < boxes.length; second++) {
      const left = boxes[first]!;
      const right = boxes[second]!;
      const overlaps =
        left.x < right.x + right.width - 1 &&
        left.x + left.width > right.x + 1 &&
        left.y < right.y + right.height - 1 &&
        left.y + left.height > right.y + 1;
      expect(overlaps, `Answers ${first + 1} and ${second + 1} remain separate`).toBe(false);
    }
  }
  expect(
    await surface.evaluate(
      (element) =>
        element.scrollHeight <= element.clientHeight + 1 &&
        element.scrollWidth <= element.clientWidth + 1,
    ),
    "The ordinary slide layout fits its authored content",
  ).toBe(true);
}

async function publicContext(browser: Browser, page: Page, info: TestInfo) {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  expect(await context.cookies()).toEqual([]);
  return context;
}

async function safeLiveSnapshot(
  page: Page,
  sessionId: string,
  role: "stage" | "participant" | "companion",
) {
  const token = await page.evaluate(
    ({ id, projection }) => sessionStorage.getItem(`openround:presentation-${projection}:${id}`),
    { id: sessionId, projection: role },
  );
  expect(token).toBeTruthy();
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/${role}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.status()).toBe(200);
  const snapshot = (await response.json()).snapshot;
  expect(snapshot).not.toHaveProperty("presenter");
  expect(snapshot).not.toHaveProperty("participants");
  expect(snapshot.currentBlock).not.toHaveProperty("speakerNotes");
  expect(JSON.stringify(snapshot)).not.toMatch(
    /PRIVATE_ACTIVITY_NOTES_REHEARSAL|NEWER_PRIVATE_ACTIVITY_NOTES|"speakerNotes"|"sourceCitations"|"isCorrect"/,
  );
  return snapshot;
}

for (const suffix of ["", " @mobile"]) {
  test(`activity slides inherit the deck design and keep long editable answers readable${suffix}`, async ({
    page,
  }, info) => {
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    const viewport = narrow ? { width: 390, height: 844 } : { width: 1280, height: 900 };
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    expect(prompt.length).toBeGreaterThanOrEqual(140);
    for (const label of answers) expect(label.length).toBeGreaterThanOrEqual(170);
    const context = nativeSlide("Synthetic sunset launch context");
    const activityBlock = pollBlock();
    const record = await createE01Deck(page, [context, activityBlock], 9);
    const writes = trackDeliveryWrites(page);
    await enterE01Editor(page, record.id, narrow);
    const native = page.locator("main [data-native-scene]");
    const nativeColors = await native.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor, font: style.fontFamily };
    });
    await selectE01Block(page, prompt, narrow);
    await hideInspector(page);
    const activity = page.locator('main [data-presentation-activity="true"]');
    await expectCompleteActivity(activity, answers, true);
    expect(
      await activity.evaluate((element) => {
        const style = getComputedStyle(element);
        const stage = element.firstElementChild!;
        return {
          color: style.color,
          background: getComputedStyle(stage).backgroundColor,
          font: style.fontFamily,
        };
      }),
    ).toEqual(nativeColors);
    const settings = page.getByRole("region", { name: "Activity settings", exact: true });
    await expect(
      settings.getByRole("combobox", { name: "Maximum selections", exact: true }),
    ).toBeVisible();
    await expect(activity.getByRole("combobox")).toHaveCount(0);
    await accessibleAndContained(page);
    await page.screenshot({
      path: info.outputPath("sunset-activity-full-copy.png"),
      fullPage: true,
    });

    const revisedPrompt = prompt.replace("Which launch response", "Which revised response");
    const revisedAnswer = answers[2]!.replace(
      "check the release timeline",
      "review the release timeline",
    );
    await activity
      .getByRole("textbox", { name: "Question prompt", exact: true })
      .fill(revisedPrompt);
    await expect
      .poll(
        async () =>
          questionIn((await readE01Record(page, record.id)).draft, activityBlock.id).prompt,
      )
      .toBe(revisedPrompt);
    const answerC = activity.getByRole("textbox", { name: "Slide answer C", exact: true });
    await answerC.fill(revisedAnswer);
    await expect(answerC).toBeFocused();
    await expect(answerC.locator('xpath=ancestor::*[@role="listitem"]')).toHaveAttribute(
      "data-selected",
      "true",
    );
    await expect
      .poll(
        async () =>
          questionIn((await readE01Record(page, record.id)).draft, activityBlock.id).choices[2]!
            .label,
      )
      .toBe(revisedAnswer);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(answerC).toHaveValue(answers[2]!);
    await expect
      .poll(
        async () =>
          questionIn((await readE01Record(page, record.id)).draft, activityBlock.id).choices[2]!
            .label,
      )
      .toBe(answers[2]!);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(answerC).toHaveValue(revisedAnswer);
    await expect
      .poll(
        async () =>
          questionIn((await readE01Record(page, record.id)).draft, activityBlock.id).choices[2]!
            .label,
      )
      .toBe(revisedAnswer);
    const revisedAnswers = answers.map((label, index) => (index === 2 ? revisedAnswer : label));
    const beforePreview = await readE01Record(page, record.id);
    expect(questionIn(beforePreview.draft, activityBlock.id).prompt).toBe(revisedPrompt);
    expect(contentIn(beforePreview.draft, context.id)).toEqual(context);
    await page.getByRole("button", { name: "Preview this slide", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expect(
      preview.getByRole("region", { name: "Slide preview", exact: true }),
    ).toHaveAttribute("tabindex", "0");
    await expect(
      preview.getByRole("button", { name: "Audience view", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(preview.getByRole("heading", { name: revisedPrompt, exact: true })).toBeVisible();
    await expectCompleteActivity(
      preview.locator("[data-presentation-activity]"),
      revisedAnswers,
      false,
    );
    await expect(preview.getByRole("button", { name: /submit/i })).toHaveCount(0);
    await accessibleAndContained(page);
    await page.screenshot({ path: info.outputPath("sunset-activity-preview.png"), fullPage: true });
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    expect(await readE01Record(page, record.id)).toEqual(beforePreview);

    for (const name of ["Content slide", "New slide", "Blank slide"]) {
      const before = await readE01Record(page, record.id);
      await clickNavigatorAction(page, name);
      if (name !== "New slide")
        await expect(
          page
            .locator('summary[aria-label="Insert & import"]')
            .locator("xpath=ancestor::details[1]"),
        ).not.toHaveAttribute("open", "");
      await expect
        .poll(async () => (await readE01Record(page, record.id)).draft.blocks.length)
        .toBe(before.draft.blocks.length + 1);
      const after = await readE01Record(page, record.id);
      for (const existing of before.draft.blocks)
        expect(after.draft.blocks.find((block) => block.id === existing.id)).toEqual(existing);
      const added = after.draft.blocks.find(
        (block) => !before.draft.blocks.some((existing) => existing.id === block.id),
      );
      if (added?.kind !== "content" || !added.scene)
        throw new Error("New content inherits through a native scene");
      expect(added.scene.design).toEqual(design);
      expect(after.draft.schemaVersion).toBeGreaterThanOrEqual(before.draft.schemaVersion);
    }

    await selectE01Block(page, revisedPrompt, narrow);
    await closeE01Overlays(page);
    await page.setViewportSize({ width: 320, height: 844 });
    await closeE01Overlays(page);
    await expectCompleteActivity(activity, revisedAnswers, true);
    await accessibleAndContained(page);
    await page.screenshot({ path: info.outputPath("sunset-activity-320.png"), fullPage: true });
    await closeE01Overlays(page);
    await page.setViewportSize(viewport);
    if (!narrow) await expect(page.locator("#presentation-object-inspector")).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    if (!narrow) await expect(page.locator("#presentation-object-inspector")).toBeHidden();
    try {
      await closeE01Overlays(page);
      const surface = activity.getByRole("article", { name: "Activity content", exact: true });
      const overflow = await surface.evaluate(
        (element) => element.scrollHeight > element.clientHeight + 1,
      );
      if (overflow) {
        // Preserve readable type when maximum-length answers outgrow a zoomed slide.
        await activity.getByRole("button", { name: "Reading view", exact: true }).click();
        await expect(activity).toHaveAttribute("data-activity-reading-view", "true");
      }
      await expectCompleteActivity(activity, revisedAnswers, true);
      await accessibleAndContained(page);
      await page.screenshot({
        path: info.outputPath("sunset-activity-zoom-200.png"),
        fullPage: true,
      });
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
    }
    const final = await readE01Record(page, record.id);
    expect(contentIn(final.draft, context.id)).toEqual(context);
    expect(
      (final as typeof final & { currentVersionId: string | null }).currentVersionId,
    ).toBeNull();
    expect(writes).toEqual([]);
  });

  test(`speaker notes provide room to write and a private current-slide rehearsal${suffix}`, async ({
    page,
  }, info) => {
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    const viewport = narrow ? { width: 390, height: 844 } : { width: 1280, height: 900 };
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const first = nativeSlide("Opening context before the private rehearsal");
    const current = nativeSlide("Current launch review with private notes");
    current.speakerNotes = Array.from(
      { length: 12 },
      (_, index) =>
        `${privateMarker} ${index + 1}. Pause for the fictional team, confirm one owner and ask what evidence is still needed.`,
    ).join("\n\n");
    const record = await createE01Deck(page, [first, current], 7);
    const writes = trackDeliveryWrites(page);
    await enterE01Editor(page, record.id, narrow);
    await selectE01Block(page, "Current launch review with private notes", narrow);
    await openE01Inspector(page, "Notes");
    const editor = page.getByRole("region", { name: "Speaker notes editor", exact: true });
    const field = editor.getByRole("textbox", { name: "Speaker notes", exact: true });
    await expect(field).toHaveValue(current.speakerNotes);
    const fieldBounds = await field.boundingBox();
    expect(fieldBounds).not.toBeNull();
    expect(fieldBounds!.height).toBeGreaterThanOrEqual(300);
    expect(fieldBounds!.width).toBeGreaterThanOrEqual(200);
    const revised = `${current.speakerNotes}\n\nPrivate transition: agree the next owner before the next slide.`;
    await field.fill(revised);
    await expect
      .poll(
        async () =>
          contentIn((await readE01Record(page, record.id)).draft, current.id).speakerNotes,
      )
      .toBe(revised);
    await accessibleAndContained(page);
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("speaker-notes-writing-space.png"),
      fullPage: true,
    });

    const expand = editor.getByRole("button", { name: "Expand notes editor", exact: true });
    await expand.click();
    const expanded = page.getByRole("dialog", { name: "Room to write", exact: true });
    const expandedField = expanded.getByRole("textbox", { name: "Speaker notes", exact: true });
    await expect(expandedField).toBeFocused();
    await expectDialogInViewport(expanded);
    await expect(expandedField).toHaveValue(revised);
    const expandedCopy = `${revised}\nPrivate reminder: allow a quiet moment before collecting questions.`;
    await expandedField.fill(expandedCopy);
    await expect
      .poll(
        async () =>
          contentIn((await readE01Record(page, record.id)).draft, current.id).speakerNotes,
      )
      .toBe(expandedCopy);
    await accessibleAndContained(page);
    await page.screenshot({ path: info.outputPath("speaker-notes-expanded.png"), fullPage: true });
    await expandedField.press("Escape");
    await expect(expanded).toHaveCount(0);
    await expect(expand).toBeFocused();
    await expect(field).toHaveValue(expandedCopy);
    await expand.click();
    await expanded.getByRole("button", { name: "Close notes editor", exact: true }).click();
    await expect(expanded).toHaveCount(0);
    await expect(expand).toBeFocused();

    const beforePreview = await readE01Record(page, record.id);
    await editor.getByRole("button", { name: "Preview presenter view", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expect(
      preview.getByRole("button", { name: "Presenter view", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      preview.getByRole("heading", {
        name: "Current launch review with private notes",
        exact: true,
      }),
    ).toBeVisible();
    const privateNotes = preview.getByRole("region", {
      name: "Private presenter notes",
      exact: true,
    });
    await expect(privateNotes).toContainText(expandedCopy);
    await expect(preview).toContainText("Draft rehearsal");
    await accessibleAndContained(page);
    await page.screenshot({
      path: info.outputPath("private-presenter-rehearsal.png"),
      fullPage: true,
    });
    await preview.getByRole("button", { name: "Audience view", exact: true }).click();
    await expect(privateNotes).toHaveCount(0);
    expect(
      await preview.evaluate(
        (element, marker) => element.textContent!.includes(marker),
        privateMarker,
      ),
    ).toBe(false);
    await expect(
      preview.getByRole("heading", {
        name: "Current launch review with private notes",
        exact: true,
      }),
    ).toBeVisible();
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    expect(await readE01Record(page, record.id)).toEqual(beforePreview);
    await closeE01Overlays(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
      preview.getByRole("button", { name: "Audience view", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(privateNotes).toHaveCount(0);
    expect(
      await preview.evaluate(
        (element, marker) => element.textContent!.includes(marker),
        privateMarker,
      ),
    ).toBe(false);
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    expect(await readE01Record(page, record.id)).toEqual(beforePreview);

    await page.setViewportSize({ width: 320, height: 844 });
    if (!narrow) await expect(page.locator("#presentation-object-inspector")).toBeHidden();
    await openE01Inspector(page, "Notes");
    await expect(field).toBeVisible();
    expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(300);
    await expand.click();
    await expect(expandedField).toHaveValue(expandedCopy);
    await accessibleAndContained(page);
    await page.screenshot({
      path: info.outputPath("speaker-notes-expanded-320.png"),
      fullPage: true,
    });
    await expanded.getByRole("button", { name: "Done writing", exact: true }).click();
    await expect(expand).toBeFocused();
    await closeE01Overlays(page);
    await page.setViewportSize(viewport);
    if (!narrow) await expect(page.locator("#presentation-object-inspector")).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    if (!narrow) await expect(page.locator("#presentation-object-inspector")).toBeHidden();
    try {
      await openE01Inspector(page, "Notes");
      await expand.click();
      await expect(expandedField).toHaveValue(expandedCopy);
      await expectDialogInViewport(expanded);
      await accessibleAndContained(page);
      await page.screenshot({
        path: info.outputPath("speaker-notes-expanded-zoom-200.png"),
        fullPage: true,
      });
      await expanded.getByRole("button", { name: "Done writing", exact: true }).click();
      await expect(expand).toBeFocused();
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
    }
    const final = await readE01Record(page, record.id);
    expect(final).toEqual(beforePreview);
    expect(contentIn(final.draft, first.id)).toEqual(first);
    expect(
      (final as typeof final & { currentVersionId: string | null }).currentVersionId,
    ).toBeNull();
    expect(writes).toEqual([]);
  });

  test(`live activity design and private presenter notes stay frozen while guests respond${suffix}`, async ({
    page,
    browser,
  }, info) => {
    // This includes three scoped browser contexts, real publication/session startup and one
    // participant response, matching the bounded live-delivery fixtures in this suite.
    test.setTimeout(120_000);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    const viewport = narrow ? { width: 390, height: 844 } : { width: 1280, height: 900 };
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const opening = nativeSlide("Frozen sunset delivery context");
    opening.speakerNotes = `${privateMarker}\n\nPause for the fictional team.\n  Confirm the owner, then allow time for questions.`;
    const poll = pollBlock();
    const next = nativeSlide("Frozen sunset delivery follow-up");
    const record = await createE01Deck(page, [opening, poll, next], 9);
    const publication = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
      { data: { expectedDraftRevision: record.draftRevision } },
    );
    expect(publication.status()).toBe(200);
    const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
      data: { presentationId: record.id, timeMode: "flex" },
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
    const contexts = await Promise.all([
      publicContext(browser, page, info),
      publicContext(browser, page, info),
      publicContext(browser, page, info),
    ]);
    try {
      const [guestContext, stageContext, companionContext] = contexts;
      const guest = await guestContext!.newPage();
      await guest.goto(`/join?code=${lobby.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("Synthetic activity guest");
      await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);

      const stagePass = await page.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/stage-pass`,
      );
      expect(stagePass.status()).toBe(201);
      const { stageToken } = await stagePass.json();
      const stage = await stageContext!.newPage();
      await stage.setViewportSize(viewport);
      await stage.goto(
        `/presentation-session/${sessionId}/stage#pass=${encodeURIComponent(stageToken)}`,
      );
      await expect(
        stage.getByRole("region", { name: "Join this Presentation", exact: true }),
      ).toBeVisible();

      const companionPass = await page.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/companion-pass`,
      );
      expect(companionPass.status()).toBe(201);
      const { companionToken } = await companionPass.json();
      const companion = await companionContext!.newPage();
      await companion.goto(
        `/presentation-session/${sessionId}/companion#pass=${encodeURIComponent(companionToken)}`,
      );
      await expect(
        companion.getByRole("heading", { name: "Presentation Companion", exact: true }),
      ).toBeVisible();

      await page.goto(`/presentation-session/${sessionId}/host`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      const current = page.getByRole("region", { name: "Current slide", exact: true });
      const notes = page.getByRole("region", { name: "Private speaker notes", exact: true });
      const notesText = notes.getByRole("group", { name: "Speaker notes text", exact: true });
      await expect(current).toContainText("Frozen sunset delivery context");
      await expect(notesText).toContainText(privateMarker);
      expect(await notesText.locator("p").textContent()).toBe(opening.speakerNotes);
      await expect(notesText).toHaveCSS("white-space", "pre-wrap");
      expect(
        await notesText
          .locator("p")
          .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
      ).toBeGreaterThanOrEqual(18);
      const frozenColors = await current.locator("[data-native-scene]").evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor, font: style.fontFamily };
      });
      await expect(
        stage.getByText("Frozen sunset delivery context", { exact: true }),
      ).toBeVisible();
      await expect(
        guest.getByText("Frozen sunset delivery context", { exact: true }),
      ).toBeVisible();
      for (const [target, role] of [
        [stage, "stage"],
        [guest, "participant"],
        [companion, "companion"],
      ] as const) {
        const snapshot = await safeLiveSnapshot(target, sessionId, role);
        expect(snapshot.currentBlock.scene.design).toEqual(design);
        expect(await target.locator("body").innerText()).not.toContain(privateMarker);
      }
      await notes.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath("live-frozen-private-notes.png"),
        fullPage: true,
      });

      const latest = await readE01Record(page, record.id);
      const revised = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
        data: {
          draft: {
            ...latest.draft,
            blocks: latest.draft.blocks.map((block) =>
              block.kind === "content" && block.scene
                ? {
                    ...block,
                    speakerNotes: "NEWER_PRIVATE_ACTIVITY_NOTES from a later publication",
                    scene: { ...block.scene, design: { ...design, theme: "ocean" } },
                  }
                : block,
            ),
          },
          expectedRevision: latest.draftRevision,
          mutationId: randomUUID(),
          schemaVersion: 2,
        },
      });
      expect(revised.status()).toBe(200);
      const republished = await page.request.post(
        `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
        { data: { expectedDraftRevision: (await revised.json()).presentation.draftRevision } },
      );
      expect(republished.status()).toBe(200);
      await page.reload();
      await expect(notesText).toContainText(privateMarker);
      expect(await notesText.locator("p").textContent()).toBe(opening.speakerNotes);
      await expect(current.locator("[data-native-scene]")).toHaveAttribute(
        "data-native-theme",
        "sunset",
      );
      expect(await page.locator("body").innerText()).not.toContain("NEWER_PRIVATE_ACTIVITY_NOTES");

      await page.getByRole("button", { name: "Next block", exact: true }).click();
      const hostActivity = current.locator("[data-presentation-activity]");
      const stageActivity = stage.locator("[data-presentation-activity]");
      await expect(current.getByRole("heading", { name: prompt, exact: true })).toBeVisible();
      await expect(stage.getByRole("heading", { name: prompt, exact: true })).toBeVisible();
      await expect(guest.getByRole("heading", { name: prompt, exact: true })).toBeVisible();
      await expectCompleteActivity(hostActivity, answers, false);
      await expectCompleteActivity(stageActivity, answers, false);
      for (const activity of [hostActivity, stageActivity]) {
        expect(
          await activity.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              color: style.color,
              background: getComputedStyle(element.firstElementChild!).backgroundColor,
              font: style.fontFamily,
            };
          }),
        ).toEqual(frozenColors);
      }
      for (const [target, role] of [
        [stage, "stage"],
        [guest, "participant"],
        [companion, "companion"],
      ] as const) {
        const snapshot = await safeLiveSnapshot(target, sessionId, role);
        expect(snapshot.presentationVersionId).toBe(lobby.presentationVersionId);
        expect(snapshot.currentBlock.id).toBe(poll.id);
        expect(snapshot.currentBlock.design).toEqual(design);
        expect(snapshot.currentBlock.question.prompt).toBe(prompt);
        expect(
          snapshot.currentBlock.question.choices.map((choice: { label: string }) => choice.label),
        ).toEqual(answers);
        expect(await target.locator("body").innerText()).not.toMatch(
          /PRIVATE_ACTIVITY_NOTES_REHEARSAL|NEWER_PRIVATE_ACTIVITY_NOTES/,
        );
      }

      await guest.getByRole("button", { name: answers[2]!, exact: true }).click();
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(
        guest.getByText("Response saved. You can stay here while the facilitator continues.", {
          exact: true,
        }),
      ).toBeVisible();
      expect((await safeLiveSnapshot(guest, sessionId, "participant")).responseSubmitted).toBe(
        true,
      );
      const hostResponse = await page.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${sessionId}`,
      );
      expect(hostResponse.status()).toBe(200);
      const host = (await hostResponse.json()).snapshot as PresentationHostSnapshot;
      expect(host.presentationVersionId).toBe(lobby.presentationVersionId);
      expect(host.roomStatus.responseCount).toBe(1);
      expect(host.currentBlock).toMatchObject({ id: poll.id, design });
      await expectCompleteActivity(stageActivity, answers, false);
      await accessibleAndContained(stage);
      await stage.screenshot({
        path: info.outputPath("live-sunset-activity-stage.png"),
        fullPage: true,
      });
      await page.screenshot({
        path: info.outputPath("live-sunset-activity-host.png"),
        fullPage: true,
      });
      const savedDraft = await readE01Record(page, record.id);
      expect(contentIn(savedDraft.draft, opening.id).scene!.design!.theme).toBe("ocean");
      expect(contentIn(savedDraft.draft, opening.id).speakerNotes).toBe(
        "NEWER_PRIVATE_ACTIVITY_NOTES from a later publication",
      );
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}
