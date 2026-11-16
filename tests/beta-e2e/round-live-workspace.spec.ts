import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { SessionSnapshot } from "../../packages/contracts/src/index";
import { currentRoundClientCapabilities } from "../../packages/contracts/src/round-protocol";
import {
  closeHostControls,
  expectControlLabelCentered,
  expectHostActionRow,
  openHostControls,
} from "./host-controls";
import { joinBetaRound } from "./round-join";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const nickname = "ExtraordinarilyLongLearnerName";
const prompt =
  "When a participant chooses an answer during a busy live round with a long question, which event confirms that the response is safely saved and will still appear after refreshing the page?";
const correctAnswer = "The server acknowledges that the response was saved";

test.use({ actionTimeout: 15_000 });

interface LiveFixture {
  sessionId: string;
  code: string;
  hostToken: string;
  snapshot: SessionSnapshot;
}

async function darkAppearance(page: Page) {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("openround:color-mode", "dark");
  });
}

async function setAppearance(page: Page, mode: "light" | "dark") {
  await page.evaluate((value) => {
    localStorage.setItem("openround:color-mode", value);
    window.dispatchEvent(new Event("openround:color-mode-change"));
  }, mode);
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
}

async function createRound(page: Page) {
  await signInBeta(page);
  const correctChoiceId = randomUUID();
  const created = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: "Round live workspace lifecycle" },
  });
  expect(created.status()).toBe(201);
  const quizId = (await created.json()).quiz.id as string;
  const updated = await page.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
    data: {
      title: "Round live workspace lifecycle",
      description: "Real host and participant states in a themed, narrow live workspace.",
      experiencePreset: { id: "spark", version: 1 },
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          purpose: "diagnostic",
          confidence: "required",
          prompt,
          choices: [
            { id: correctChoiceId, label: correctAnswer, isCorrect: true },
            {
              id: randomUUID(),
              label: "The answer is highlighted before the server receives it",
              isCorrect: false,
            },
            {
              id: randomUUID(),
              label: "The participant selects an optional confidence level",
              isCorrect: false,
            },
          ],
          timeLimitSeconds: 300,
          basePoints: 1000,
          explanation: "The server confirms the committed response before a saved receipt appears.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    },
  });
  expect(updated.ok()).toBe(true);
  expect(
    (await page.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, { data: {} })).ok(),
  ).toBe(true);
  const hosted = await page.request.post(`${apiUrl}/v1/sessions`, {
    data: {
      quizId,
      clientCapabilities: currentRoundClientCapabilities(),
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "leaderboard",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    },
  });
  expect(hosted.status()).toBe(201);
  const session = (await hosted.json()) as LiveFixture;
  expect(session.snapshot.experienceTheme.preset.id).toBe("spark");
  expect(session.snapshot.settings.confidenceEnabled).toBe(false);
  await page.evaluate(({ sessionId, hostToken }) => {
    sessionStorage.setItem(`openround:host:${sessionId}`, hostToken);
  }, session);
  await page.goto(`/host/${session.sessionId}`);
  await expect(page.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
  return { session, correctChoiceId };
}

async function participantSnapshot(participant: Page, session: LiveFixture, token: string) {
  const response = await participant.request.get(
    `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?role=participant`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { snapshot: SessionSnapshot }).snapshot;
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
}

async function expectSamePalette(card: Locator, dashboard: Locator) {
  const palette = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  await expect(dashboard).toHaveCSS("color", palette.color);
  await expect(dashboard).toHaveCSS("background-color", palette.background);
}

async function expectParticipantColumn(participant: Page) {
  const geometry = await participant.getByRole("main").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const cards = [...element.children]
      .filter((child) => child.matches('.live-card, [data-testid="competition-dashboard"]'))
      .map((child) => {
        const box = child.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      });
    return { left: rect.left, right: rect.right, width: rect.width, cards };
  });
  expect(geometry.width).toBeLessThanOrEqual(840);
  expect(geometry.cards.length).toBeGreaterThan(0);
  for (const card of geometry.cards) {
    expect(Math.abs(card.left - geometry.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(card.right - geometry.right)).toBeLessThanOrEqual(1);
    expect(card.width).toBeLessThanOrEqual(840);
  }
  await expectNoOverflow(participant);
}

async function expectHostWorkspace(host: Page, width: number) {
  const stage = host.getByTestId("host-stage");
  const dashboard = host.getByTestId("competition-dashboard");
  const rail = host.getByTestId("recovery-rail");
  await expect(stage.getByRole("heading", { name: prompt, exact: true })).toBeVisible();
  await expect(dashboard).toBeVisible();
  expect(
    await dashboard.evaluate(
      (element) =>
        element.parentElement ===
        document.querySelector('[data-testid="host-stage"]')?.parentElement,
    ),
  ).toBe(true);
  const question = await stage.boundingBox();
  const results = await dashboard.boundingBox();
  const guidance = await rail.boundingBox();
  expect(results!.y).toBeGreaterThanOrEqual(question!.y + question!.height);
  expect(Math.abs(question!.x - results!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(question!.width - results!.width)).toBeLessThanOrEqual(1);
  if (width >= 1024) {
    expect(guidance!.x).toBeGreaterThanOrEqual(question!.x + question!.width);
    expect(guidance!.width).toBeGreaterThanOrEqual(280);
    expect(guidance!.width).toBeLessThanOrEqual(340);
  } else {
    expect(guidance!.y).toBeGreaterThanOrEqual(results!.y + results!.height);
  }
  await expectSamePalette(stage, dashboard);
  await expect(host.locator(".connection")).toHaveCount(1);
  await expectNoOverflow(host);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled", scale: "css" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function expectToolsKeyboardAndAudienceFocus(host: Page, desktop: boolean) {
  const bar = host.getByTestId("host-command-bar");
  const toggle = bar.getByTestId("host-command-tools-toggle");
  const tools = bar.getByTestId("host-command-tools");
  await closeHostControls(bar);
  await host.bringToFront();
  await expect.poll(() => host.evaluate(() => document.hasFocus())).toBe(true);
  await toggle.focus();
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(tools).toBeVisible();
  const toolsId = await tools.getAttribute("id");
  expect(toolsId).toBeTruthy();
  await expect(toggle).toHaveAttribute("aria-controls", toolsId!);
  await expectHostActionRow(bar, "Finish round", desktop, true);
  const confidence = tools.getByRole("checkbox", {
    name: "Ask for confidence (optional)",
    exact: true,
  });
  await confidence.focus();
  await confidence.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(tools).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(tools).toBeVisible();
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(tools).toBeHidden();
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const audience = bar.getByRole("button", { name: "Audience", exact: true });
  await audience.click();
  const drawer = host.getByTestId("audience-drawer");
  const close = drawer.getByRole("button", { name: "Close audience tools", exact: true });
  await expect(drawer).toBeVisible();
  await expect(close).toBeFocused();
  await close.click();
  await expect(drawer).toBeHidden();
  await expect(audience).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await closeHostControls(bar);
  await expectHostActionRow(bar, "Finish round", desktop, true);
}

for (const suffix of ["desktop", "phone @mobile"]) {
  test(`Round live workspace keeps real host and participant lifecycle readable on ${suffix}`, async ({
    page: host,
    browser,
  }, testInfo) => {
    // The shared fixture can require one real join-rate window before the live journey.
    test.setTimeout(150_000);
    const width = suffix === "desktop" ? 1366 : 320;
    const viewport = { width, height: suffix === "desktop" ? 900 : 740 };
    await host.setViewportSize(viewport);
    await darkAppearance(host);
    const { session, correctChoiceId } = await createRound(host);
    await expect(host.locator("html")).toHaveAttribute("data-color-mode", "dark");
    const bar = host.getByTestId("host-command-bar");
    await expectControlLabelCentered(host.locator(".experience-preferences > summary"));
    await expectHostActionRow(bar, "Start round", suffix === "desktop", true);
    await expect(bar.getByRole("button", { name: "Audience", exact: true })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Start round", exact: true })).toBeDisabled();
    await expectNoOverflow(host);

    const context = await browser.newContext({
      baseURL: new URL(host.url()).origin,
      viewport,
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    try {
      const participant = await context.newPage();
      await darkAppearance(participant);
      await participant.goto(`/join?code=${session.code}`);
      await participant.getByRole("textbox", { name: /^Nickname/ }).fill(nickname);
      const joined = await joinBetaRound(participant);
      const { participantToken } = (await joined.json()) as { participantToken: string };
      await expect(participant).toHaveURL(new RegExp(`/play/${session.sessionId}$`));
      await expect(participant.getByRole("heading", { name: nickname, exact: true })).toBeVisible();
      await expect(participant.getByText("Waiting for the host", { exact: true })).toBeVisible();
      await expect(bar.getByRole("button", { name: "Start round", exact: true })).toBeEnabled();
      await expectParticipantColumn(participant);
      await expectControlLabelCentered(participant.locator(".experience-preferences > summary"));
      expect((await new AxeBuilder({ page: host }).analyze()).violations).toEqual([]);

      await bar.getByRole("button", { name: "Start round", exact: true }).click();
      await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "question_open");
      const task = participant.getByTestId("participant-task");
      const answer = task.getByRole("button", { name: correctAnswer, exact: true });
      await expect(task.getByRole("heading", { name: prompt, exact: true })).toBeVisible();
      await expect(participant.getByTestId("optional-confidence")).toHaveCount(0);
      await expect(
        participant.getByText("Answer received and saved.", { exact: true }),
      ).toHaveCount(0);
      await expectParticipantColumn(participant);
      expect((await new AxeBuilder({ page: host }).analyze()).violations).toEqual([]);
      expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
      await answer.click();
      await expect(
        participant.getByText("Answer received and saved.", { exact: true }),
      ).toBeVisible();
      await expect(answer).toHaveAttribute("aria-pressed", "true");
      await expect(
        participant.getByRole("button", { name: "Submit response", exact: true }),
      ).toHaveCount(0);
      const saved = await participantSnapshot(participant, session, participantToken);
      expect(saved).toMatchObject({
        phase: "question_open",
        myResponse: { kind: "choice", choiceIds: [correctChoiceId] },
        myConfidence: null,
        settings: { confidenceEnabled: false },
      });
      await participant.reload();
      await expect(answer).toHaveAttribute("aria-pressed", "true");
      await expect(answer).toBeDisabled();
      await expect(
        participant.getByText("Answer received and saved.", { exact: true }),
      ).toBeVisible();

      await bar.getByRole("button", { name: "Lock answers", exact: true }).click();
      await expect(host.getByTestId("host-session")).toHaveAttribute(
        "data-phase",
        "question_locked",
      );
      await expect(answer).toBeDisabled();
      await expect(participant.getByTestId("response-not-saved")).toHaveCount(0);
      await expect(
        participant.getByText("Answer received and saved.", { exact: true }),
      ).toBeVisible();
      await bar.getByRole("button", { name: "Reveal answer", exact: true }).click();
      await expect(host.getByTestId("host-session")).toHaveAttribute(
        "data-phase",
        "question_reveal",
      );
      await expect(task.getByText("Correct", { exact: true })).toBeVisible();
      const dashboard = participant.getByTestId("competition-dashboard");
      await expect(dashboard).toHaveAttribute("data-compact-participant", "true");
      await expect(dashboard.getByTestId("competition-podium")).toHaveCount(0);
      await expect(dashboard.getByTestId("competition-race")).toHaveCount(0);
      await expect(participant.getByTestId("scored-response-receipt")).toContainText(
        "Saved answers1 / 1",
      );
      await expectSamePalette(task, dashboard);
      await expectParticipantColumn(participant);
      await expectHostWorkspace(host, width);
      if (suffix === "desktop") {
        for (const breakpoint of [1024, 1000]) {
          await host.setViewportSize({ ...viewport, width: breakpoint });
          await expectHostWorkspace(host, breakpoint);
        }
        await host.setViewportSize(viewport);
      }
      expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
      await expectToolsKeyboardAndAudienceFocus(host, suffix === "desktop");
      await capture(host, testInfo, `round-host-reveal-${width}`);

      const stageBefore = await host
        .getByTestId("host-stage")
        .evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
      await openHostControls(host);
      const tools = bar.getByTestId("host-command-tools");
      await expect(tools).toBeVisible();
      await expectHostActionRow(bar, "Finish round", suffix === "desktop", true);
      for (const control of await tools.locator("button, .host-confidence-control label").all()) {
        await expectControlLabelCentered(control);
      }
      const expanded = await tools.evaluate((element) => ({
        bottom: element.getBoundingClientRect().bottom + window.scrollY,
        height: element.getBoundingClientRect().height,
        stageTop:
          document.querySelector('[data-testid="host-stage"]')!.getBoundingClientRect().top +
          window.scrollY,
        railTop:
          document.querySelector('[data-testid="recovery-rail"]')!.getBoundingClientRect().top +
          window.scrollY,
      }));
      expect(expanded.stageTop - stageBefore).toBeGreaterThanOrEqual(expanded.height - 1);
      expect(expanded.bottom).toBeLessThanOrEqual(expanded.stageTop);
      expect(expanded.bottom).toBeLessThanOrEqual(expanded.railTop);
      await expectHostWorkspace(host, width);
      expect((await new AxeBuilder({ page: host }).analyze()).violations).toEqual([]);
      await capture(host, testInfo, `round-host-expanded-tools-${width}`);
      if (suffix === "desktop") {
        try {
          await host.emulateMedia({
            colorScheme: "dark",
            reducedMotion: "reduce",
            contrast: "more",
          });
          expect(await host.evaluate(() => matchMedia("(prefers-contrast: more)").matches)).toBe(
            true,
          );
          await expect(host.locator("html")).toHaveAttribute("data-color-mode", "dark");
          await expect(host.getByTestId("host-stage")).toHaveCSS("color", "rgb(0, 0, 0)");
          await expect(host.getByTestId("host-stage")).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)",
          );
          await expectSamePalette(
            host.getByTestId("host-stage"),
            host.getByTestId("competition-dashboard"),
          );
          for (const name of ["Finish round", "Audience"]) {
            await bar.getByRole("button", { name, exact: true }).hover();
            expect((await new AxeBuilder({ page: host }).analyze()).violations).toEqual([]);
          }
        } finally {
          await host.emulateMedia({
            colorScheme: "dark",
            reducedMotion: "reduce",
            contrast: "no-preference",
          });
          await host.mouse.move(0, 0);
        }
        await setAppearance(host, "light");
        await expectHostWorkspace(host, width);
        await capture(host, testInfo, `round-host-expanded-tools-light-${width}`);
        await closeHostControls(bar);
        await capture(host, testInfo, `round-host-reveal-light-${width}`);
        await setAppearance(host, "dark");
      }
      await closeHostControls(bar);

      await bar.getByRole("button", { name: "Finish round", exact: true }).click();
      await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "finished");
      await expect(
        participant.getByText("Your final score is 1,000.", { exact: true }),
      ).toBeVisible();
      await expect(dashboard).toHaveAttribute("data-compact-participant", "true");
      await expect(dashboard.getByTestId("competition-podium")).toHaveCount(0);
      await expect(dashboard.getByTestId("competition-race")).toHaveCount(0);
      await expect(dashboard.getByTestId("competition-celebration")).toHaveCount(0);
      const receipt = participant.getByTestId("scored-response-receipt");
      await expect(receipt).toContainText("Revealed scored questions only.");
      await expect(receipt).toContainText("Saved answers1 / 1");
      await expect(receipt).toContainText("Correct1");
      const final = await participantSnapshot(participant, session, participantToken);
      expect(final.myScoredResponseSummary).toMatchObject({
        answeredScoredQuestions: 1,
        correctScoredQuestions: 1,
        revealedScoredQuestions: 1,
      });
      const ownEntry = final.competitionStandings?.entries.find(
        (entry) => entry.id === final.myParticipantId,
      );
      expect(ownEntry).toMatchObject({ nickname, score: 1000, rank: 1 });
      await participant.reload();
      await expect(
        participant.getByText("Your final score is 1,000.", { exact: true }),
      ).toBeVisible();
      await expect(receipt).toContainText("Saved answers1 / 1");
      await expectParticipantColumn(participant);
      await expectControlLabelCentered(participant.locator(".experience-preferences > summary"));
      await expect(participant.locator("html")).toHaveAttribute("data-color-mode", "dark");
      await expectSamePalette(participant.getByRole("main").locator(".live-card"), dashboard);
      expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
      await capture(participant, testInfo, `round-participant-final-${width}`);
      if (suffix === "desktop") {
        await setAppearance(participant, "light");
        await expectSamePalette(participant.getByRole("main").locator(".live-card"), dashboard);
        await expectParticipantColumn(participant);
        expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
        await capture(participant, testInfo, `round-participant-final-light-${width}`);
        const preferences = participant.locator("details.experience-preferences");
        await preferences.locator("summary").click();
        const contrast = preferences.getByRole("checkbox", { name: "High contrast", exact: true });
        try {
          await contrast.check();
          await expect(participant.locator("html")).toHaveAttribute(
            "data-openround-contrast",
            "high",
          );
          const completion = participant.getByRole("main").locator(".live-card");
          await expect(completion).toHaveCSS("color", "rgb(0, 0, 0)");
          await expect(completion).toHaveCSS("background-color", "rgb(255, 255, 255)");
          await expectSamePalette(completion, dashboard);
          expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
        } finally {
          await contrast.uncheck();
          await expect(participant.locator("html")).toHaveAttribute(
            "data-openround-contrast",
            "theme",
          );
          await preferences.locator("summary").click();
        }
        await setAppearance(participant, "dark");
      }
    } finally {
      await context.close();
    }
  });
}
