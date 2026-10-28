import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInCreator } from "../support/creator-auth";
import { testEmail } from "./test-email";

const apiUrl = "http://127.0.0.1:4100";
const aliases = ["Ada", "Bea", "Cy"];

interface QuestionFixture {
  id: string;
  type: "single_select" | "poll";
  prompt: string;
  choices: { id: string; label: string; isCorrect: boolean }[];
  purpose: "diagnostic" | "opinion";
  confidence: "off";
  timeLimitSeconds: number;
  basePoints: number;
  explanation: string;
  mediaId: null;
  mediaAlt: null;
  delivery?: "main" | "recheck";
  linkedRecheckQuestionId?: string;
}

interface SessionFixture {
  sessionId: string;
  code: string;
  hostToken: string;
}

interface GuestFixture {
  participantId: string;
  participantToken: string;
}

function question(prompt: string, opinion = false): QuestionFixture {
  return {
    id: randomUUID(),
    type: opinion ? "poll" : "single_select",
    prompt,
    choices: [
      { id: randomUUID(), label: "First choice", isCorrect: !opinion },
      { id: randomUUID(), label: "Second choice", isCorrect: false },
    ],
    purpose: opinion ? "opinion" : "diagnostic",
    confidence: "off",
    timeLimitSeconds: 300,
    basePoints: opinion ? 0 : 1_000,
    explanation: opinion
      ? "These are preferences, not scored answers."
      : "The first choice is correct.",
    mediaId: null,
    mediaAlt: null,
  };
}

async function createSession(
  host: Page,
  questions: QuestionFixture[],
  resultVisibility: "leaderboard" | "private" = "leaderboard",
  nicknames: readonly string[] = aliases,
) {
  const created = await host.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: "Competition dashboard browser check" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const quizId = (await created.json()).quiz.id as string;
  const draft = await host.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
    data: { title: "Competition dashboard browser check", description: "", questions },
  });
  expect(draft.ok(), await draft.text()).toBe(true);
  const published = await host.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, {
    data: {},
  });
  expect(published.ok(), await published.text()).toBe(true);
  const hosted = await host.request.post(`${apiUrl}/v1/sessions`, {
    data: {
      quizId,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility,
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    },
  });
  expect(hosted.status(), await hosted.text()).toBe(201);
  const session = (await hosted.json()) as SessionFixture;
  const guests: GuestFixture[] = [];
  // Sequential admission avoids an unrelated per-IP join burst in the default browser fixture.
  for (const nickname of nicknames) {
    const joined = await host.request.post(`${apiUrl}/v1/sessions/join`, {
      data: { code: session.code, nickname },
    });
    expect(joined.status(), await joined.text()).toBe(201);
    guests.push((await joined.json()) as GuestFixture);
  }
  await host.evaluate(({ sessionId, hostToken }) => {
    sessionStorage.setItem(`openround:host:${sessionId}`, hostToken);
  }, session);
  await host.goto(`/host/${session.sessionId}`);
  await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
  return { session, guests };
}

async function openAudience(
  browser: Browser,
  host: Page,
  session: SessionFixture,
  guest: GuestFixture,
) {
  const context = await browser.newContext({
    baseURL: new URL(host.url()).origin,
    viewport: host.viewportSize()!,
    reducedMotion: "reduce",
  });
  const participant = await context.newPage();
  await participant.addInitScript(
    ({ sessionId, participantToken }) => {
      sessionStorage.setItem(`openround:participant:${sessionId}`, participantToken);
    },
    { sessionId: session.sessionId, participantToken: guest.participantToken },
  );
  await participant.goto(`/play/${session.sessionId}`);
  await expect(participant.locator(".live-shell")).toBeVisible();
  const popup = host.waitForEvent("popup");
  await host.getByRole("button", { name: "Presenter view", exact: true }).click();
  const presenter = await popup;
  await expect(presenter).toHaveURL(/\/present\//);
  await expect(presenter.locator(".live-shell")).toBeVisible();
  return { context, participant, presenter };
}

async function hostAction(host: Page, name: string, phase: string) {
  await host.getByRole("button", { name, exact: true }).click();
  await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", phase);
}

async function answerAll(
  host: Page,
  session: SessionFixture,
  guests: GuestFixture[],
  currentQuestion: QuestionFixture,
  correct: boolean[],
) {
  const current = await host.request.get(
    `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?role=host`,
    { headers: { authorization: `Bearer ${session.hostToken}` } },
  );
  expect(current.ok(), await current.text()).toBe(true);
  const { snapshot } = await current.json();
  expect(snapshot.phase).toBe("question_open");
  for (const [index, guest] of guests.entries()) {
    const choiceId = currentQuestion.choices[correct[index] ? 0 : 1]!.id;
    const answer = await host.request.post(`${apiUrl}/v1/sessions/${session.sessionId}/answers`, {
      headers: { authorization: `Bearer ${guest.participantToken}` },
      data: {
        roundId: snapshot.roundId,
        ...(currentQuestion.type === "poll"
          ? { response: { kind: "poll", choiceIds: [choiceId] } }
          : { choiceId }),
        idempotencyKey: randomUUID(),
      },
    });
    expect(answer.ok(), await answer.text()).toBe(true);
    expect(await answer.json()).toMatchObject({ accepted: true });
  }
}

function dashboard(page: Page) {
  return page.getByTestId("competition-dashboard");
}

async function dashboardTheme(page: Page, colorScheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await page.evaluate((mode) => {
    localStorage.setItem("openround:color-mode", mode);
    window.dispatchEvent(new Event("openround:color-mode-change"));
  }, colorScheme);
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
  const appearance = await dashboard(page).evaluate((element) => ({
    surface: getComputedStyle(element).getPropertyValue("--ui-surface").trim(),
    background: getComputedStyle(element).backgroundColor,
  }));
  const channels =
    appearance.background
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number) ?? [];
  expect(channels).toHaveLength(3);
  if (colorScheme === "dark") {
    expect(
      Math.max(...channels),
      `Dark dashboard uses a dark actual surface (${appearance.surface})`,
    ).toBeLessThan(100);
  } else {
    expect(
      Math.min(...channels),
      `Light dashboard uses a light actual surface (${appearance.surface})`,
    ).toBeGreaterThan(180);
  }
}

async function publicScores(host: Page, session: SessionFixture, guest: GuestFixture) {
  const response = await host.request.get(
    `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?role=participant`,
    { headers: { authorization: `Bearer ${guest.participantToken}` } },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const { snapshot } = await response.json();
  return snapshot.competitionStandings.entries.map(
    (entry: {
      nickname: string;
      score: number;
      rank: number;
      pointsToLeader: number;
      lastScoreDelta?: number;
      correctStreak?: number;
    }) => ({
      nickname: entry.nickname,
      score: entry.score,
      rank: entry.rank,
      pointsToLeader: entry.pointsToLeader,
      lastScoreDelta: entry.lastScoreDelta,
      correctStreak: entry.correctStreak,
    }),
  );
}

async function expectPodium(page: Page, scores: string[], names: readonly string[] = aliases) {
  const podium = dashboard(page).getByTestId("competition-podium");
  await expect(podium).toBeVisible();
  for (const [index, nickname] of names.entries()) {
    const place = podium.locator(`[data-rank="${index + 1}"]`);
    await expect(place).toContainText(nickname);
    await expect(place).toContainText(scores[index]!);
  }
}

test("competition standings release after reveal and remain on the final projector and participant screens", async ({
  page: host,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  await signInCreator(host, testEmail("competition-dashboard", testInfo), {
    returnTo: "/dashboard",
  });
  const questions = [
    question("First scored checkpoint"),
    { ...question("Second scored checkpoint"), basePoints: 2_000 },
    question("Third scored checkpoint"),
  ];
  const { session, guests } = await createSession(host, questions);
  const { context, participant, presenter } = await openAudience(
    browser,
    host,
    session,
    guests[0]!,
  );
  try {
    await hostAction(host, "Start round", "question_open");
    await answerAll(host, session, guests, questions[0]!, [true, false, false]);
    for (const audience of [presenter, participant]) {
      // A saved answer must not publish its correctness through a public score while open.
      await expect(dashboard(audience).getByTestId("competition-podium")).toHaveCount(0);
      await expect(dashboard(audience).getByRole("table")).toHaveCount(0);
    }
    await hostAction(host, "Lock answers", "question_locked");
    await hostAction(host, "Reveal answer", "question_reveal");
    for (const audience of [host, presenter, participant]) {
      await expect(dashboard(audience)).toBeVisible();
      const podium = dashboard(audience).getByTestId("competition-podium");
      await expect(podium.locator('[data-rank="1"]')).toContainText("Ada");
      await expect(podium.locator('[data-rank="1"]')).toContainText("1,000");
      await expect(podium).toContainText("Bea");
      await expect(podium).toContainText("Cy");
    }
    const releasedScores = await publicScores(host, session, guests[1]!);
    await hostAction(host, "Show standings", "leaderboard");
    await expect(
      presenter.getByRole("heading", { name: questions[0]!.prompt, exact: true }),
    ).toHaveCount(0);
    await expect(dashboard(presenter)).toBeVisible();
    await hostAction(host, "Next checkpoint", "question_open");
    await answerAll(host, session, guests, questions[1]!, [false, true, false]);
    expect(await publicScores(host, session, guests[1]!)).toEqual(releasedScores);
    for (const audience of [presenter, participant]) {
      // Previous released standings may remain visible, but the second answer is still private.
      await expect(dashboard(audience)).not.toContainText("2,000");
    }
    await hostAction(host, "Lock answers", "question_locked");
    await hostAction(host, "Reveal answer", "question_reveal");
    for (const audience of [host, presenter, participant]) {
      await expectPodium(audience, ["2,000", "1,000", "0"], ["Bea", "Ada", "Cy"]);
      const race = dashboard(audience).getByTestId("competition-race");
      await expect(race).toContainText("Bea");
      await expect(race.getByTestId("competition-race-fill")).toHaveCount(3);
      await expect(race.locator('[data-score="2000"]')).toHaveCount(1);
      await expect(dashboard(audience).getByTestId("competition-spotlight")).toContainText("Bea");
    }
    if (testInfo.project.name === "chromium") {
      for (const colorScheme of ["light", "dark"] as const) {
        await dashboardTheme(presenter, colorScheme);
        const liveAccessibility = await new AxeBuilder({ page: presenter })
          .include('[data-testid="competition-dashboard"]')
          .analyze();
        expect(
          liveAccessibility.violations,
          `Live race remains accessible in ${colorScheme}`,
        ).toEqual([]);
        await dashboard(presenter).screenshot({
          path: `artifacts/leaderboard-kahoot-live-climb-${colorScheme}.png`,
        });
      }
    }
    const secondRelease = await publicScores(host, session, guests[0]!);
    expect(
      secondRelease.find((entry: { nickname: string }) => entry.nickname === "Bea"),
    ).toMatchObject({
      rank: 1,
      score: 2_000,
      lastScoreDelta: 2_000,
      correctStreak: 1,
    });
    await hostAction(host, "Show standings", "leaderboard");
    await hostAction(host, "Next checkpoint", "question_open");
    await answerAll(host, session, guests, questions[2]!, [false, true, false]);
    expect(await publicScores(host, session, guests[0]!)).toEqual(secondRelease);
    for (const audience of [presenter, participant]) {
      await expect(dashboard(audience)).not.toContainText("3,000");
    }
    await hostAction(host, "Lock answers", "question_locked");
    await hostAction(host, "Reveal answer", "question_reveal");
    for (const audience of [host, presenter, participant]) {
      await expectPodium(audience, ["3,000", "1,000", "0"], ["Bea", "Ada", "Cy"]);
    }
    const finalRelease = await publicScores(host, session, guests[0]!);
    expect(
      finalRelease.find((entry: { nickname: string }) => entry.nickname === "Bea"),
    ).toMatchObject({
      rank: 1,
      score: 3_000,
      lastScoreDelta: 1_000,
      correctStreak: 2,
    });
    const personal = dashboard(participant).getByTestId("competition-personal");
    await expect(personal).toContainText("Your position");
    await expect(personal).toContainText("2");
    await expect(personal).toContainText("Points behind leader");
    await expect(personal).toContainText("Points to next place");
    await expect(personal).toContainText("2,000");
    await hostAction(host, "Finish round", "finished");
    for (const audience of [host, presenter, participant]) {
      await expect(
        dashboard(audience).getByRole("heading", { name: "Final standings", exact: true }),
      ).toBeVisible();
      await expectPodium(audience, ["3,000", "1,000", "0"], ["Bea", "Ada", "Cy"]);
    }
    const winner = await context.newPage();
    await winner.addInitScript(
      ({ sessionId, participantToken }) => {
        sessionStorage.setItem(`openround:participant:${sessionId}`, participantToken);
      },
      { sessionId: session.sessionId, participantToken: guests[1]!.participantToken },
    );
    await winner.goto(`/play/${session.sessionId}`);
    await expect(
      dashboard(winner)
        .getByTestId("competition-personal")
        .getByTestId("competition-question-gain"),
    ).toContainText("1,000");
    await expect(
      dashboard(winner).getByTestId("competition-personal").getByTestId("competition-streak"),
    ).toContainText("2");
    await winner.close();
    await presenter.emulateMedia({ reducedMotion: "no-preference" });
    const presenterDashboard = dashboard(presenter);
    const motion = presenterDashboard.getByTestId("competition-motion-toggle");
    const replay = presenterDashboard.getByTestId("competition-replay");
    await expect(motion).toBeEnabled();
    await expect(motion).toHaveAttribute("aria-pressed", "true");
    await expect(replay).toBeEnabled();
    const celebration = presenterDashboard.getByTestId("competition-celebration");
    await expect(celebration).toHaveAttribute("aria-hidden", "true");
    const replayBefore = Number(await celebration.getAttribute("data-replay"));
    await replay.click();
    await expect(celebration).toHaveAttribute("data-replay", String(replayBefore + 1));
    await expectPodium(presenter, ["3,000", "1,000", "0"], ["Bea", "Ada", "Cy"]);
    await presenterDashboard.getByRole("button", { name: "Table view", exact: true }).click();
    await expect(presenterDashboard.getByRole("table")).toBeVisible();
    await expect(
      presenterDashboard.getByRole("button", { name: "Table view", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await presenterDashboard.getByRole("button", { name: "Race view", exact: true }).click();
    await expect(presenterDashboard.getByTestId("competition-race")).toBeVisible();
    await motion.click();
    await expect(motion).toHaveAttribute("aria-pressed", "false");
    await expect(replay).toBeDisabled();
    await presenter.reload();
    await expect(dashboard(presenter).getByTestId("competition-motion-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await dashboard(presenter).getByTestId("competition-motion-toggle").click();
    await expect(dashboard(presenter).getByTestId("competition-motion-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await presenter.emulateMedia({ reducedMotion: "reduce" });
    await expect(dashboard(presenter).getByTestId("competition-motion-toggle")).toBeDisabled();
    await expect(dashboard(presenter).getByTestId("competition-motion-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(dashboard(presenter).getByTestId("competition-replay")).toBeDisabled();
    await expect(dashboard(presenter)).toContainText("Reduced motion is on");
    await presenter.emulateMedia({ reducedMotion: "no-preference" });
    await expect(dashboard(presenter).getByTestId("competition-motion-toggle")).toBeEnabled();
    let preferences = presenter.locator("details.experience-preferences");
    await preferences.locator("summary").click();
    expect(
      await presenter.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      "Open accessibility preferences fit the viewport",
    ).toBe(true);
    await preferences
      .getByRole("checkbox", { name: "Reduce motion", exact: true })
      .check({ timeout: 10_000 });
    await expect(dashboard(presenter).getByTestId("competition-motion-toggle")).toBeDisabled();
    await expect(dashboard(presenter).getByTestId("competition-replay")).toBeDisabled();
    await presenter.reload();
    await expect(dashboard(presenter).getByTestId("competition-motion-toggle")).toBeDisabled();
    preferences = presenter.locator("details.experience-preferences");
    await preferences.locator("summary").click();
    await preferences
      .getByRole("checkbox", { name: "Reduce motion", exact: true })
      .uncheck({ timeout: 10_000 });
    await preferences.locator("summary").click();
    await expect(dashboard(presenter).getByTestId("competition-motion-toggle")).toBeEnabled();
    await participant.reload();
    for (const audience of [presenter, participant]) {
      await expectPodium(audience, ["3,000", "1,000", "0"], ["Bea", "Ada", "Cy"]);
      expect(
        await audience.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        "Final standings fit the audience viewport",
      ).toBe(true);
    }
    if (testInfo.project.name === "chromium") {
      await expect(dashboard(presenter)).toHaveAttribute("data-variant", "presenter");
      const projectorBox = await dashboard(presenter).boundingBox();
      const podiumBox = await dashboard(presenter).getByTestId("competition-podium").boundingBox();
      const raceBox = await dashboard(presenter).getByTestId("competition-race").boundingBox();
      expect(projectorBox).not.toBeNull();
      expect(podiumBox).not.toBeNull();
      expect(raceBox).not.toBeNull();
      expect(projectorBox!.width, "Projector dashboard uses the desktop width").toBeGreaterThan(
        1_000,
      );
      expect(
        podiumBox!.x + podiumBox!.width,
        "Podium and race occupy separate desktop columns",
      ).toBeLessThanOrEqual(raceBox!.x + 1);
      expect(
        Math.min(podiumBox!.y + podiumBox!.height, raceBox!.y + raceBox!.height) -
          Math.max(podiumBox!.y, raceBox!.y),
        "Podium and race overlap vertically rather than stacking",
      ).toBeGreaterThan(0);
      await testInfo.attach("projector-layout", {
        body: JSON.stringify({
          viewport: presenter.viewportSize(),
          dashboard: projectorBox,
          podium: podiumBox,
          race: raceBox,
        }),
        contentType: "application/json",
      });
      for (const colorScheme of ["light", "dark"] as const) {
        await dashboardTheme(presenter, colorScheme);
        const accessibility = await new AxeBuilder({ page: presenter })
          .include('[data-testid="competition-dashboard"]')
          .analyze();
        expect(
          accessibility.violations,
          `Final standings remain accessible in ${colorScheme}`,
        ).toEqual([]);
        await dashboard(presenter).screenshot({
          path: `artifacts/leaderboard-kahoot-projector-${colorScheme}.png`,
        });
      }
      await participant.setViewportSize({ width: 320, height: 800 });
      expect(
        await participant.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        "Final participant standings fit a 320px viewport",
      ).toBe(true);
      await dashboard(participant).screenshot({
        path: "artifacts/leaderboard-kahoot-participant-320.png",
      });
    }
  } finally {
    await presenter.close();
    await context.close();
  }
});

for (const mode of ["revote", "linked"] as const) {
  test(`projector retains the ${mode} question after showing recovery standings`, async ({
    page: host,
    browser,
  }, testInfo) => {
    await signInCreator(host, testEmail(`competition-${mode}`, testInfo), {
      returnTo: "/dashboard",
    });
    const mainQuestion = question("Scored checkpoint before recovery");
    const linkedQuestion: QuestionFixture = {
      ...question("Linked recovery checkpoint"),
      delivery: "recheck",
    };
    const questions =
      mode === "linked"
        ? [{ ...mainQuestion, linkedRecheckQuestionId: linkedQuestion.id }, linkedQuestion]
        : [mainQuestion];
    const recoveryQuestion = mode === "linked" ? linkedQuestion : mainQuestion;
    const { session, guests } = await createSession(host, questions, "leaderboard", ["Ada"]);
    const { context, participant, presenter } = await openAudience(
      browser,
      host,
      session,
      guests[0]!,
    );
    try {
      await hostAction(host, "Start round", "question_open");
      await answerAll(host, session, guests, mainQuestion, [true]);
      await hostAction(host, "Lock answers", "question_locked");
      await hostAction(host, "Reveal answer", "question_reveal");
      await expect(dashboard(presenter)).toBeVisible();
      const releasedScores = await publicScores(host, session, guests[0]!);
      await hostAction(
        host,
        mode === "linked" ? "Open linked recheck" : "Recheck by revote",
        "question_open",
      );
      await answerAll(host, session, guests, recoveryQuestion, [false]);
      await hostAction(host, "Lock answers", "question_locked");
      await hostAction(host, "Reveal answer", "question_reveal");
      await hostAction(host, "Show standings", "leaderboard");
      for (const audience of [presenter, participant]) {
        await expect(dashboard(audience)).toHaveCount(0);
        await expect(
          audience.getByRole("heading", { name: recoveryQuestion.prompt, exact: true }),
        ).toBeVisible();
      }
      expect(await publicScores(host, session, guests[0]!)).toEqual(releasedScores);
      await presenter.reload();
      await expect(
        presenter.getByRole("heading", { name: recoveryQuestion.prompt, exact: true }),
      ).toBeVisible();
      await expect(dashboard(presenter)).toHaveCount(0);
      await hostAction(host, "Continue after recheck", "finished");
      for (const audience of [presenter, participant]) {
        await expect(dashboard(audience)).toBeVisible();
        await expectPodium(audience, ["1,000"], ["Ada"]);
      }
    } finally {
      await presenter.close();
      await context.close();
    }
  });
}

test("private-result sessions do not expose a competition dashboard", async ({
  page: host,
  browser,
}, testInfo) => {
  await signInCreator(host, testEmail("competition-private", testInfo), { returnTo: "/dashboard" });
  const currentQuestion = question("Private checkpoint");
  const { session, guests } = await createSession(host, [currentQuestion], "private");
  const { context, participant, presenter } = await openAudience(
    browser,
    host,
    session,
    guests[1]!,
  );
  try {
    await hostAction(host, "Start round", "question_open");
    await answerAll(host, session, guests, currentQuestion, [true, false, false]);
    await hostAction(host, "Lock answers", "question_locked");
    await hostAction(host, "Reveal answer", "question_reveal");
    for (const audience of [host, presenter, participant]) {
      await expect(dashboard(audience)).toHaveCount(0);
    }
    await hostAction(host, "Finish round", "finished");
    for (const audience of [host, presenter, participant]) {
      await expect(dashboard(audience)).toHaveCount(0);
    }
  } finally {
    await presenter.close();
    await context.close();
  }
});

test("an opinion-only competition session finishes without fabricating winners", async ({
  page: host,
  browser,
}, testInfo) => {
  await signInCreator(host, testEmail("competition-opinion", testInfo), { returnTo: "/dashboard" });
  const currentQuestion = question("Which approach would you prefer?", true);
  const { session, guests } = await createSession(host, [currentQuestion]);
  const { context, participant, presenter } = await openAudience(
    browser,
    host,
    session,
    guests[1]!,
  );
  try {
    await hostAction(host, "Start round", "question_open");
    await answerAll(host, session, guests, currentQuestion, [true, false, false]);
    await hostAction(host, "Lock answers", "question_locked");
    await hostAction(host, "Reveal answer", "question_reveal");
    await hostAction(host, "Finish round", "finished");
    for (const audience of [host, presenter, participant]) {
      await expect(dashboard(audience)).toBeVisible();
      await expect(dashboard(audience).getByTestId("competition-podium")).toHaveCount(0);
      await expect(dashboard(audience).getByRole("table")).toHaveCount(0);
      await expect(dashboard(audience).getByTestId("competition-personal")).toHaveCount(0);
      await expect(dashboard(audience).getByTestId("competition-race")).toHaveCount(0);
      await expect(dashboard(audience).getByTestId("competition-celebration")).toHaveCount(0);
      await expect(dashboard(audience).getByTestId("competition-replay")).toHaveCount(0);
    }
  } finally {
    await presenter.close();
    await context.close();
  }
});

test("ending before reveal shows no scored results and keeps the participant score private", async ({
  page: host,
  browser,
}, testInfo) => {
  await signInCreator(host, testEmail("competition-early-end", testInfo), {
    returnTo: "/dashboard",
  });
  const currentQuestion = question("A correct answer that remains unrevealed");
  const { session, guests } = await createSession(host, [currentQuestion], "leaderboard", ["Ada"]);
  const { context, participant, presenter } = await openAudience(
    browser,
    host,
    session,
    guests[0]!,
  );
  try {
    await hostAction(host, "Start round", "question_open");
    await answerAll(host, session, guests, currentQuestion, [true]);
    const confirmation = host.waitForEvent("dialog");
    const endSession = host.getByRole("button", { name: "End session", exact: true }).click();
    const dialog = await confirmation;
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toBe("End this session now?");
    await dialog.accept();
    await endSession;
    await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "finished");
    for (const audience of [host, presenter, participant]) {
      await expect(
        dashboard(audience).getByRole("heading", { name: "Final standings", exact: true }),
      ).toBeVisible();
      await expect(dashboard(audience)).toContainText("No scored results were revealed.");
      await expect(dashboard(audience).getByTestId("competition-podium")).toHaveCount(0);
      await expect(dashboard(audience).getByRole("table")).toHaveCount(0);
      await expect(dashboard(audience).getByTestId("competition-personal")).toHaveCount(0);
      await expect(dashboard(audience).getByTestId("competition-race")).toHaveCount(0);
      await expect(dashboard(audience).getByTestId("competition-celebration")).toHaveCount(0);
      await expect(dashboard(audience).getByTestId("competition-replay")).toHaveCount(0);
    }
    await expect(participant.getByText("Your final score is 0.", { exact: true })).toBeVisible();
    await participant.reload();
    await expect(participant.getByText("Your final score is 0.", { exact: true })).toBeVisible();
  } finally {
    await presenter.close();
    await context.close();
  }
});
