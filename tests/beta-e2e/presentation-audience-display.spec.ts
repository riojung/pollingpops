import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";
import { stageDisplayCopy } from "../../apps/web/components/presentation-live/stage-display-copy";
import koreanDelivery from "../../apps/web/lib/i18n/domains/live-delivery/ko-KR";
import { presentationAudienceCopy } from "../../apps/web/lib/i18n/presentation-audience-copy";
import { presentationWorkspaceCopy } from "../../apps/web/lib/i18n/presentation-workspace-copy";
import { sectionsSpatialCopy } from "../../apps/web/lib/i18n/sections-spatial-copy";
import {
  LOCALE_COOKIE_NAME,
  ScopedQnaAcknowledgementSchema,
  type InteractiveQuestionBlockDraft,
  type PresentationHostSnapshot,
} from "../../packages/contracts/src/index.ts";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";

test.use({ actionTimeout: 25_000 });
const privateNotes = "PRIVATE_AUDIENCE_DISPLAY_FACILITATOR_CUE";
const questionPrompt = "Which next step has a clear owner?";
const selectedAnswer = "Name an owner and a date";
const pendingQuestion = "Which evidence should the fictional team review before the next handoff?";

async function createRoom(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await signInBeta(page);
  const opening = e01Slide("A review with room for questions");
  const closing = e01Slide("Agree the next owner and review date");
  opening.speakerNotes = `${privateNotes}\nPause and ask the fictional team about the next handoff.`;
  closing.speakerNotes = `${privateNotes}\nPrivately confirm who owns the next review.`;
  const check: InteractiveQuestionBlockDraft = {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type: "single_select",
      prompt: questionPrompt,
      choices: [
        { id: randomUUID(), label: selectedAnswer, isCorrect: true },
        { id: randomUUID(), label: "Leave the next step open", isCorrect: false },
      ],
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 300,
      basePoints: 100,
      explanation: "UNREVEALED_AUDIENCE_DISPLAY_RATIONALE",
      mediaId: null,
      mediaAlt: null,
    },
  };
  const initial = await createE01Deck(page, [opening, check, closing], 14);
  const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${initial.id}/draft`, {
    data: {
      draft: {
        ...initial.draft,
        title: "A shared review and a private presenter workspace",
        spatial: {
          schemaVersion: 1,
          frames: [opening, check, closing].map((block, index) => ({
            blockId: block.id,
            x: index * 2400,
            y: index % 2 === 0 ? 0 : 1400,
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
  const published = await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/publish`, {
    data: { expectedDraftRevision: record.draftRevision },
  });
  expect(published.status()).toBe(200);
  const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
    data: { presentationId: record.id, timeMode: "flex" },
  });
  expect(created.status()).toBe(201);
  const { snapshot, controlToken } = (await created.json()) as {
    snapshot: PresentationHostSnapshot;
    controlToken: string;
  };
  await page.evaluate(
    ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
    { id: snapshot.sessionId, token: controlToken },
  );
  await page.goto(`/presentation-session/${snapshot.sessionId}/host`);
  return { id: snapshot.sessionId, code: snapshot.code, controlToken, record };
}

type Room = Awaited<ReturnType<typeof createRoom>>;

async function joinGuest(
  browser: Browser,
  host: Page,
  info: TestInfo,
  room: Room,
  alias = "Synthetic review guest",
) {
  const { isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({
    baseURL: new URL(host.url()).origin,
    viewport: host.viewportSize(),
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const guest = await context.newPage();
  await guest.goto(`/join?code=${room.code}`);
  await guest.getByLabel("Nickname", { exact: true }).fill(alias);
  await guest.getByRole("button", { name: "Join presentation", exact: true }).click();
  await expect(guest).toHaveURL(`/presentation-session/${room.id}/play`);
  return { context, guest };
}

async function seedPublishedQuestions(host: Page, author: Page, room: Room) {
  const endpoint = `${e01ApiUrl}/v1/audience-scopes/${room.id}/qna/commands`;
  const token = await author.evaluate(
    (id) => sessionStorage.getItem(`openround:presentation-participant:${id}`),
    room.id,
  );
  expect(token).toBeTruthy();
  for (let index = 0; index < 5; index++) {
    const created = await author.request.post(endpoint, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        kind: "presentation",
        command: {
          type: "question.create",
          body: `Review question ${index + 1}: Which synthetic evidence supports the next decision, and who will bring it to the next project review?`,
          idempotencyKey: randomUUID(),
        },
      },
    });
    expect(created.status()).toBe(200);
    const { receipt } = ScopedQnaAcknowledgementSchema.parse(await created.json());
    const published = await host.request.post(endpoint, {
      headers: { authorization: `Bearer ${room.controlToken}` },
      data: {
        kind: "presentation",
        command: {
          type: "question.moderate",
          questionId: receipt.resourceId,
          status: "published",
          label: null,
          banAuthor: false,
          expectedAudienceSeq: receipt.audienceSeq,
          idempotencyKey: randomUUID(),
        },
      },
    });
    expect(published.status()).toBe(200);
  }
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result!;
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(
    true,
  );
}

async function accessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(violations).toEqual([]);
}

async function openQna(guest: Page) {
  const toggle = guest.getByRole("button", { name: "Questions and answers", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await expect(guest.locator("[data-audience-qna]")).toBeVisible();
  const composer = guest.getByRole("textbox", { name: "Ask the facilitator", exact: true });
  await expect(composer).toBeVisible();
  // A wrapping label's DOM text also includes React's populated textarea text.
  // Check its accessible name and native label association independently of that value.
  expect(
    await composer.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) return false;
      const labels = [...(element.labels ?? [])];
      return labels.length > 0 && labels.every((label) => label.control === element);
    }),
  ).toBe(true);
  return toggle;
}

async function closeQna(guest: Page, mobile: boolean) {
  const toggle = guest.getByRole("button", { name: "Questions and answers", exact: true });
  if (mobile) {
    await guest.getByRole("button", { name: "Close questions and answers", exact: true }).click();
  } else await toggle.click();
  await expect(guest.locator("[data-audience-qna]")).toBeHidden();
  return toggle;
}

async function expectAudienceLayout(guest: Page, mobile: boolean) {
  const header = guest.locator("[data-audience-header]");
  const content = guest.locator("[data-audience-content]");
  await expect(header).toBeInViewport({ ratio: 1 });
  await expect(content).toBeInViewport({ ratio: 1 });
  const [top, current] = await Promise.all([box(header), box(content)]);
  expect(current.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
  if (!mobile) {
    const aside = guest.locator("[data-audience-qna]");
    await expect(aside).toBeInViewport({ ratio: 1 });
    const sidebar = await box(aside);
    expect(current.x + current.width).toBeLessThanOrEqual(sidebar.x + 1);
    expect(sidebar.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
  }
  await noPageOverflow(guest);
}

async function expectHeaderPopover(guest: Page, panel: Locator) {
  await expect(panel).toBeInViewport({ ratio: 0.98 });
  const [header, popover] = await Promise.all([
    box(guest.locator("[data-audience-header]")),
    box(panel),
  ]);
  expect(popover.x).toBeGreaterThanOrEqual(-1);
  expect(popover.x + popover.width).toBeLessThanOrEqual(guest.viewportSize()!.width + 1);
  expect(popover.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(popover.y + popover.height).toBeLessThanOrEqual(guest.viewportSize()!.height + 1);
}

async function openSetupPopup(
  surface: Page,
  kind: "launcher" | "display",
  locale: "en-CA" | "ko-KR",
) {
  const container = surface.locator(
    kind === "launcher" ? '[data-stage-launcher-compact="true"]' : "[data-stage-header]",
  );
  const summary = container.locator("summary").filter({ hasText: stageDisplayCopy(locale).setup });
  if ((await summary.locator("..").getAttribute("open")) === null) await summary.click();
  const popup = surface.locator(`[data-stage-setup-popup="${kind}"]`);
  await expect(popup).toBeInViewport({ ratio: 0.98 });
  const bounds = await box(popup);
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.y).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(surface.viewportSize()!.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(surface.viewportSize()!.height + 1);
  expect(await popup.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  if (kind === "launcher") {
    const revoke = popup.getByRole("button", {
      name: presentationWorkspaceCopy(locale)("Revoke audience stage access"),
      exact: true,
    });
    await expect(revoke).toBeEnabled();
    await revoke.click({ trial: true });
    await expect(revoke).toBeInViewport({ ratio: 1 });
  } else {
    const privacy = popup.getByText(stageDisplayCopy(locale).privacy, { exact: true });
    await privacy.scrollIntoViewIfNeeded();
    await expect(privacy).toBeInViewport({ ratio: 1 });
  }
  await summary.click({ trial: true });
  return { summary, popup };
}

async function hostAccessAfterSnapshot(page: Page, room: Room) {
  const accountUrl = `${e01ApiUrl}/v1/auth/me`;
  let releaseAccount = () => {};
  const accountGate = new Promise<void>((resolve) => {
    releaseAccount = resolve;
  });
  let accountHeld = false;
  let accountReleased = false;
  const holdAccount = async (route: Route) => {
    if (route.request().method() !== "GET") return route.continue();
    accountHeld = true;
    await accountGate;
    await route.continue();
  };
  await page.route(accountUrl, holdAccount);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => accountHeld).toBe(true);
    await expect(
      page
        .getByRole("region", { name: "Facilitation controls", exact: true })
        .getByRole("heading", { name: room.record.draft.title, exact: true }),
    ).toBeVisible();
    // The real snapshot mounts the launcher with canEdit=false while account access waits.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    expect(accountReleased).toBe(false);
    await expect(page.locator('[data-stage-launcher-compact="true"]')).toHaveCount(0);
    const accountResponse = page.waitForResponse(
      (response) =>
        response.url() === accountUrl &&
        response.request().method() === "GET" &&
        response.status() === 200,
    );
    accountReleased = true;
    releaseAccount();
    const account = await accountResponse;
    expect(account.status()).toBe(200);
    expect(["owner", "editor"]).toContain((await account.json()).creator.role);
    const launcher = page.locator('[data-stage-launcher-compact="true"]');
    await expect(
      launcher.getByRole("button", { name: stageDisplayCopy("en-CA").launch, exact: true }),
    ).toBeVisible();
    const summary = launcher
      .locator("summary")
      .filter({ hasText: stageDisplayCopy("en-CA").setup });
    const details = summary.locator("..");
    const popup = launcher.locator('[data-stage-setup-popup="launcher"]');
    await summary.click();
    await expect(popup).toBeVisible();
    await expect
      .poll(() =>
        popup.evaluate((element) => {
          if (!(element instanceof HTMLElement)) return false;
          return [
            element.style.left,
            element.style.top,
            element.style.width,
            element.style.maxHeight,
          ].every((value) => value.endsWith("px") && Number.isFinite(parseFloat(value)));
        }),
      )
      .toBe(true);
    await expect(popup).toHaveCSS("position", "fixed");
    const bounds = await box(popup);
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.y).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    await summary.click();
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await expect
      .poll(() => page.evaluate(() => document.activeElement === document.body))
      .toBe(true);
    // Match summary activation on browsers that keep focus on body; Escape belongs to the popup.
    await details.evaluate((element) => {
      (element as HTMLDetailsElement).open = true;
    });
    await expect(popup).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(summary).toBeFocused();
    await summary.click();
    await expect(popup).toBeVisible();
    await page.locator("main > header").click({ position: { x: 4, y: 4 } });
    await expect(details).not.toHaveAttribute("open", "");
  } finally {
    releaseAccount();
    await page.unroute(accountUrl, holdAccount);
  }
}

for (const suffix of ["", " @mobile"]) {
  test(`audience Q&A and header path preserve the current slide, draft and quiz response${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(180_000);
    const mobile = Boolean(suffix);
    await page.setViewportSize(mobile ? { width: 320, height: 740 } : { width: 1280, height: 800 });
    const room = await createRoom(page);
    await page.getByRole("button", { name: "Activate audience Q&A", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Enable Q&A", exact: true })).toBeChecked();
    const peer = await joinGuest(browser, page, info, room, "Synthetic review peer");
    try {
      await seedPublishedQuestions(page, peer.guest, room);
    } finally {
      await peer.context.close();
    }
    const { context, guest } = await joinGuest(browser, page, info, room);
    try {
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      const current = guest.locator("[data-audience-content]");
      const sidebar = guest.locator("[data-audience-qna]");
      const qnaScroll = guest
        .locator("[data-audience-qna-scroll]")
        .getByRole("region", { name: "Questions and answers", exact: true });
      const composer = guest.getByRole("textbox", { name: "Ask the facilitator", exact: true });
      await expect(current).toContainText("A review with room for questions");
      const toggle = guest.getByRole("button", { name: "Questions and answers", exact: true });
      await expect(toggle).toHaveAttribute("aria-controls", "presentation-audience-qna");
      await expect(toggle).toHaveAttribute("aria-expanded", mobile ? "false" : "true");
      await openQna(guest);
      await expect(sidebar.locator(".qna-question")).toHaveCount(5);
      await composer.fill(pendingQuestion);
      if (mobile) {
        await expect(sidebar).toHaveRole("dialog");
        await expect(sidebar).toHaveAccessibleName("Questions and answers");
        await expect(sidebar).toHaveAttribute("aria-modal", "true");
        await expect(
          guest.getByRole("button", { name: "Close questions and answers", exact: true }),
        ).toBeInViewport({ ratio: 1 });
        const close = guest.getByRole("button", {
          name: "Close questions and answers",
          exact: true,
        });
        await close.focus();
        await guest.keyboard.press("Shift+Tab");
        expect(await sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
        await close.focus();
        await guest
          .locator('button[aria-controls="presentation-audience-qna"]')
          .evaluate((element) => {
            if (element instanceof HTMLElement) element.focus();
          });
        await expect(close).toBeFocused();
        await composer.focus();
        await guest.keyboard.press("Escape");
        await expect(sidebar).toBeHidden();
        await expect(toggle).toBeFocused();
      } else await closeQna(guest, false);
      const path = guest.getByRole("region", { name: "Presentation spatial path", exact: true });
      await expect(path).toHaveAttribute("data-spatial-header", "true");
      const summary = path.locator("summary");
      await summary.click();
      await expect(path.locator("details")).toHaveAttribute("open", "");
      const panel = path.locator("details > div");
      await expectHeaderPopover(guest, panel);
      await guest.screenshot({ path: info.outputPath("audience-header-path.png"), scale: "css" });
      await path.getByRole("button", { name: "Use linear view", exact: true }).click();
      await guest.keyboard.press("Escape");
      await expect(path.locator("details")).not.toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
      await summary.click();
      await expect(
        path.getByRole("button", { name: "Use spatial view", exact: true }),
      ).toBeVisible();
      await path.getByRole("button", { name: "Use spatial view", exact: true }).click();
      await guest.locator("[data-audience-header]").click({ position: { x: 4, y: 4 } });
      await expect(path.locator("details")).not.toHaveAttribute("open", "");
      await openQna(guest);
      await expect(composer).toHaveValue(pendingQuestion);
      await closeQna(guest, mobile);
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(
        current.getByRole("heading", { name: questionPrompt, exact: true }),
      ).toBeVisible();
      const answer = current.getByRole("button", {
        name: selectedAnswer,
        exact: true,
        includeHidden: true,
      });
      await answer.click();
      await openQna(guest);
      await expect(composer).toHaveValue(pendingQuestion);
      await expect(answer).toHaveAttribute("aria-pressed", "true");
      await guest.getByRole("button", { name: "Ask question", exact: true }).click();
      await expect(composer).toHaveValue("");
      await expect(
        sidebar.locator(".qna-question").filter({ hasText: pendingQuestion }),
      ).toHaveCount(1);
      const published = sidebar.locator(".qna-question").filter({ hasText: "Review question 1:" });
      await published.getByRole("button", { name: "I have this question", exact: true }).click();
      await expect(
        published.getByRole("button", { name: "Remove vote", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(answer).toHaveAttribute("aria-pressed", "true");
      if (mobile) {
        await expect(sidebar).toBeInViewport({ ratio: 1 });
        await noPageOverflow(guest);
        await accessible(guest);
        await guest.screenshot({
          path: info.outputPath("audience-qna-drawer-320.png"),
          scale: "css",
        });
        await closeQna(guest, true);
        await expectAudienceLayout(guest, true);
        await expect(answer).toBeInViewport({ ratio: 1 });
        await expect(
          current.getByRole("button", { name: "Submit response", exact: true }),
        ).toBeInViewport({ ratio: 1 });
        await guest.screenshot({ path: info.outputPath("audience-quiz-320.png"), scale: "css" });
      } else {
        for (const height of [800, 500]) {
          await guest.setViewportSize({ width: 1280, height });
          await expectAudienceLayout(guest, false);
          const before = await current.evaluate((element) => element.scrollTop);
          expect(
            await qnaScroll.evaluate((element) =>
              ["auto", "scroll"].includes(getComputedStyle(element).overflowY),
            ),
          ).toBe(true);
          expect(
            await qnaScroll.evaluate((element) => element.scrollHeight > element.clientHeight),
          ).toBe(true);
          await qnaScroll.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
          });
          expect(await qnaScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
          expect(await current.evaluate((element) => element.scrollTop)).toBe(before);
          await expect(answer).toBeInViewport({ ratio: 1 });
          await expect(
            current.getByRole("button", { name: "Submit response", exact: true }),
          ).toBeInViewport({ ratio: 1 });
          await summary.click();
          await expectHeaderPopover(guest, panel);
          await expect(answer).toHaveAttribute("aria-pressed", "true");
          await guest.screenshot({
            path: info.outputPath(`audience-header-path-1280x${height}.png`),
            scale: "css",
          });
          await guest.keyboard.press("Escape");
          await expect(path.locator("details")).not.toHaveAttribute("open", "");
          await noPageOverflow(guest);
          await accessible(guest);
          await guest.screenshot({
            path: info.outputPath(`audience-quiz-qna-1280x${height}.png`),
            scale: "css",
          });
        }
      }
      await expect(
        current.getByRole("button", { name: "Submit response", exact: true }),
      ).toBeEnabled();
      const snapshot = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${room.id}`);
      expect(
        ((await snapshot.json()).snapshot as PresentationHostSnapshot).roomStatus.responseCount,
      ).toBe(0);
      await current.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(current).toContainText(
        "Response saved. You can stay here while the facilitator continues.",
      );
      const accepted = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${room.id}`);
      expect(
        ((await accepted.json()).snapshot as PresentationHostSnapshot).roomStatus.responseCount,
      ).toBe(1);
      await openQna(guest);
      await composer.fill("Keep this follow-up while the presentation moves on.");
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await closeQna(guest, mobile);
      await expect(current).toContainText("Agree the next owner and review date");
      await openQna(guest);
      await expect(composer).toHaveValue("Keep this follow-up while the presentation moves on.");
      if (mobile) await closeQna(guest, true);
      else await expectAudienceLayout(guest, false);
      await noPageOverflow(guest);
      expect(await guest.locator("body").textContent()).not.toContain(privateNotes);
      const finalDraft = await readE01Record(page, room.record.id);
      expect(finalDraft.draft).toEqual(room.record.draft);
      expect(finalDraft.draftRevision).toBe(room.record.draftRevision);
      if (mobile) {
        // Complete the pending question before this reload-only locale geometry check.
        await openQna(guest);
        await guest.getByRole("button", { name: "Ask question", exact: true }).click();
        await expect(composer).toHaveValue("");
        await closeQna(guest, true);
        const localeCookie = (await context.cookies()).find(
          (cookie) => cookie.name === LOCALE_COOKIE_NAME,
        );
        try {
          await context.addCookies([
            {
              name: LOCALE_COOKIE_NAME,
              value: "ko-KR",
              url: new URL(guest.url()).origin,
              sameSite: "Lax",
            },
          ]);
          await guest.reload();
          await expect(guest.locator("html")).toHaveAttribute("lang", "ko-KR");
          const spatialCopy = sectionsSpatialCopy("ko-KR");
          const koreanPath = guest.getByRole("region", {
            name: spatialCopy("Presentation spatial path"),
            exact: true,
          });
          const koreanSummary = koreanPath.locator("summary");
          await koreanSummary.click();
          await expect(koreanSummary).toHaveAccessibleName(
            spatialCopy("Presentation spatial path"),
          );
          await expectHeaderPopover(guest, koreanPath.locator("details > div"));
          await noPageOverflow(guest);
          await guest.screenshot({
            path: info.outputPath("audience-header-path-ko-320.png"),
            scale: "css",
          });
          await guest.keyboard.press("Escape");
          await expect(koreanSummary).toBeFocused();
          const koreanToggle = guest.getByRole("button", {
            name: koreanDelivery["live.qna.title"],
            exact: true,
          });
          await koreanToggle.click();
          const koreanDrawer = guest.getByRole("dialog", {
            name: koreanDelivery["live.qna.title"],
            exact: true,
          });
          await expect(koreanDrawer).toBeInViewport({ ratio: 1 });
          const close = koreanDrawer.getByRole("button", {
            name: presentationAudienceCopy("ko-KR").closeQuestions,
            exact: true,
          });
          await expect(close).toBeInViewport({ ratio: 1 });
          await close.click({ trial: true });
          await noPageOverflow(guest);
          await accessible(guest);
          await guest.screenshot({
            path: info.outputPath("audience-qna-drawer-ko-320.png"),
            scale: "css",
          });
          await close.click();
          await expect(koreanDrawer).toBeHidden();
          await expect(koreanToggle).toBeFocused();
        } finally {
          await context.addCookies([
            {
              name: LOCALE_COOKIE_NAME,
              value: localeCookie?.value ?? "en-CA",
              url: new URL(guest.url()).origin,
              sameSite: "Lax",
            },
          ]);
        }
      }
    } finally {
      await context.close();
    }
  });
}

type FullscreenAudit = {
  lastClickTrusted: boolean;
  requests: Array<{ stageTarget: boolean; userActivation: boolean | null; trustedClick: boolean }>;
};

async function expectSlideOnly(stage: Page) {
  const screen = stage.locator("[data-audience-stage]");
  const slide = stage.locator("[data-stage-slide]");
  await expect(screen).toHaveAttribute("data-stage-focus", "true");
  for (const selector of ["[data-stage-header]", "[data-stage-spatial]", "[data-stage-footer]"])
    await expect(stage.locator(selector)).toBeHidden();
  await expect(slide).toBeInViewport({ ratio: 1 });
  const [surface, paper] = await Promise.all([
    box(slide),
    box(slide.locator('article[data-native-scene="true"]')),
  ]);
  expect(paper.x).toBeGreaterThanOrEqual(surface.x - 1);
  expect(paper.y).toBeGreaterThanOrEqual(surface.y - 1);
  expect(paper.x + paper.width).toBeLessThanOrEqual(surface.x + surface.width + 1);
  expect(paper.y + paper.height).toBeLessThanOrEqual(surface.y + surface.height + 1);
  expect(paper.width / paper.height).toBeCloseTo(16 / 9, 1);
  await noPageOverflow(stage);
  expect(await stage.locator("body").textContent()).not.toContain(privateNotes);
  await expect(stage.getByRole("button", { name: "Next block", exact: true })).toHaveCount(0);
  await expect(stage.getByRole("button", { name: "Submit response", exact: true })).toHaveCount(0);
}

for (const suffix of ["", " @mobile"]) {
  test(`presenter launches an isolated audience screen with gesture-bound slide-only fullscreen${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    const mobile = Boolean(suffix);
    const viewport = mobile ? { width: 320, height: 740 } : { width: 1280, height: 800 };
    await page.setViewportSize(viewport);
    const room = await createRoom(page);
    await hostAccessAfterSnapshot(page, room);
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    const hostNotes = page.getByRole("region", { name: "Private speaker notes", exact: true });
    await expect(hostNotes).toContainText(privateNotes);
    info.annotations.push({
      type: "fullscreen",
      description:
        "The stage delegates to native fullscreen where available. A capability shim exercises rejection fallback on unsupported engines; a separate rejected request verifies the controlled fallback. This emulates a separate audience window, not a physical second monitor.",
    });
    await page.context().addInitScript(() => {
      const audit: FullscreenAudit = { lastClickTrusted: false, requests: [] };
      Object.assign(window, { __stageFullscreenAudit: audit });
      document.addEventListener(
        "click",
        (event) => {
          audit.lastClickTrusted = event.isTrusted;
        },
        true,
      );
      const native = Element.prototype.requestFullscreen;
      Object.defineProperty(Element.prototype, "requestFullscreen", {
        configurable: true,
        value: function (this: Element, options?: FullscreenOptions) {
          audit.requests.push({
            stageTarget: this.matches("[data-audience-stage]"),
            userActivation: navigator.userActivation?.isActive ?? null,
            trustedClick: audit.lastClickTrusted,
          });
          return typeof native === "function"
            ? native.call(this, options)
            : Promise.reject(
                new DOMException("Synthetic unsupported fullscreen", "NotSupportedError"),
              );
        },
      });
      if (document.fullscreenEnabled === false)
        Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    });
    const launched = page.context().waitForEvent("page");
    const launcher = page.getByRole("button", { name: "Present on another screen", exact: true });
    await expect(launcher).toBeInViewport({ ratio: 1 });
    await launcher.click();
    const stage = await launched;
    try {
      await stage.setViewportSize(viewport);
      const screen = stage.locator("[data-audience-stage]");
      const slide = stage.locator("[data-stage-slide]");
      await expect(slide).toContainText("A review with room for questions");
      await expect.poll(() => new URL(stage.url()).hash.length).toBe(0);
      expect(new URL(stage.url()).pathname).toBe(`/presentation-session/${room.id}/stage`);
      expect(await stage.evaluate(() => window.opener === null)).toBe(true);
      expect(
        await stage.evaluate(() =>
          Object.keys(sessionStorage).some((key) =>
            /^openround:presentation-(?:host|companion|participant):/.test(key),
          ),
        ),
      ).toBe(false);
      const audit = () =>
        stage.evaluate(
          () =>
            (window as typeof window & { __stageFullscreenAudit: FullscreenAudit })
              .__stageFullscreenAudit.requests,
        );
      expect(await audit()).toEqual([]);
      if (mobile) {
        const hostSetup = await openSetupPopup(page, "launcher", "en-CA");
        await page.screenshot({ path: info.outputPath("host-stage-setup-320.png"), scale: "css" });
        await hostSetup.summary.click();
        const displaySetup = await openSetupPopup(stage, "display", "en-CA");
        await stage.screenshot({
          path: info.outputPath("audience-display-options-320.png"),
          scale: "css",
        });
        await displaySetup.summary.click();
      }
      const stageWrites: string[] = [];
      stage.on("request", (request) => {
        if (
          new URL(request.url()).pathname.startsWith(`/v1/presentation-sessions/${room.id}`) &&
          !["GET", "HEAD", "OPTIONS"].includes(request.method())
        )
          stageWrites.push(request.method());
      });
      await stage.getByRole("button", { name: "Enter full screen", exact: true }).click();
      await expect
        .poll(async () =>
          stage.evaluate(
            () =>
              document.fullscreenElement?.matches("[data-audience-stage]") === true ||
              !!document.querySelector('[data-stage-focus-controls] [role="alert"]'),
          ),
        )
        .toBe(true);
      expect(await audit()).toHaveLength(1);
      expect((await audit())[0]).toMatchObject({ stageTarget: true, trustedClick: true });
      expect((await audit())[0]!.userActivation).not.toBe(false);
      expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
      await expectSlideOnly(stage);
      if (mobile) {
        await expect(screen).toHaveAttribute("data-stage-controls-visible", "false");
        await slide.tap({ position: { x: 8, y: 8 } });
        await expect(screen).toHaveAttribute("data-stage-controls-visible", "true");
        const exit = stage.getByRole("button", { name: "Exit slide-only view", exact: true });
        await expect(exit).toBeInViewport({ ratio: 1 });
        await exit.tap({ trial: true });
      }
      await stage.screenshot({
        path: info.outputPath("audience-stage-slide-only.png"),
        scale: "css",
      });
      await stage.getByRole("button", { name: "Exit slide-only view", exact: true }).click();
      await expect(screen).toHaveAttribute("data-stage-focus", "false");
      await expect(stage.locator("[data-stage-header]")).toBeVisible();
      await expect(hostNotes).toContainText(privateNotes);
      await stage.evaluate(() => {
        Object.defineProperty(Element.prototype, "requestFullscreen", {
          configurable: true,
          value: function (this: Element) {
            const audit = (window as typeof window & { __stageFullscreenAudit: FullscreenAudit })
              .__stageFullscreenAudit;
            audit.requests.push({
              stageTarget: this.matches("[data-audience-stage]"),
              userActivation: navigator.userActivation?.isActive ?? null,
              trustedClick: audit.lastClickTrusted,
            });
            return Promise.reject(
              new DOMException("Synthetic fullscreen denial", "NotAllowedError"),
            );
          },
        });
      });
      await stage.getByRole("button", { name: "Enter full screen", exact: true }).click();
      await expect(stage.locator('[data-stage-focus-controls] [role="alert"]')).toContainText(
        "Slide-only view is active",
      );
      await expectSlideOnly(stage);
      expect(await audit()).toHaveLength(2);
      expect((await audit())[1]).toMatchObject({ stageTarget: true });
      expect((await audit())[1]!.userActivation).not.toBe(false);
      await stage.keyboard.press("Escape");
      await expect(screen).toHaveAttribute("data-stage-focus", "false");
      await expect(
        stage.getByRole("button", { name: "Enter full screen", exact: true }),
      ).toBeFocused();
      await stage.getByRole("button", { name: "Slide-only view", exact: true }).click();
      await expectSlideOnly(stage);
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(slide).toContainText(questionPrompt);
      expect(await stage.locator("body").textContent()).not.toContain(
        "UNREVEALED_AUDIENCE_DISPLAY_RATIONALE",
      );
      await expect(stage.getByRole("button", { name: "Submit response", exact: true })).toHaveCount(
        0,
      );
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(slide).toContainText("Agree the next owner and review date");
      await expectSlideOnly(stage);
      if (!mobile) {
        await stage.setViewportSize({ width: 1280, height: 500 });
        await expectSlideOnly(stage);
        await stage.screenshot({
          path: info.outputPath("audience-stage-slide-only-1280x500.png"),
          scale: "css",
        });
      }
      await stage.keyboard.press("Escape");
      await expect(screen).toHaveAttribute("data-stage-focus", "false");
      await accessible(stage);
      expect(stageWrites).toEqual([]);
      const final = await readE01Record(page, room.record.id);
      expect(final.draft).toEqual(room.record.draft);
      expect(final.draftRevision).toBe(room.record.draftRevision);
      if (mobile) {
        try {
          await specialistLocale(page, "ko-KR");
          await page.reload();
          await stage.reload();
          await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
          await expect(stage.locator("html")).toHaveAttribute("lang", "ko-KR");
          await expect(stage.locator("[data-stage-slide]")).toContainText(
            "Agree the next owner and review date",
          );
          const hostSetup = await openSetupPopup(page, "launcher", "ko-KR");
          await page.screenshot({
            path: info.outputPath("host-stage-setup-ko-320.png"),
            scale: "css",
          });
          await hostSetup.summary.click();
          const displaySetup = await openSetupPopup(stage, "display", "ko-KR");
          await stage.screenshot({
            path: info.outputPath("audience-display-options-ko-320.png"),
            scale: "css",
          });
          await displaySetup.summary.click();
          expect(await stage.locator("body").textContent()).not.toContain(privateNotes);
        } finally {
          await specialistLocale(page, "en-CA");
        }
        const afterLocale = await readE01Record(page, room.record.id);
        expect(afterLocale.draft).toEqual(room.record.draft);
        expect(afterLocale.draftRevision).toBe(room.record.draftRevision);
      }
    } finally {
      await stage.close();
    }
  });
}
