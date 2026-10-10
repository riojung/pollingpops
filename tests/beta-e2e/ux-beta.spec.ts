import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { betaEmail, signInBeta } from "./sign-in";

const webUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_WEB_PORT ?? 3200)}`;
const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

test.afterEach(async ({ page }) => {
  // Redirects can complete while a second mocked account/authoring request is
  // still running. Drain route handlers before fixture teardown disposes responses.
  await page.unrouteAll({ behavior: "wait" });
});

async function signIn(page: Page, email: string) {
  await signInBeta(page, email);
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeVisible();
}

async function openRoundCreate(page: Page) {
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const round = page.getByRole("link", { name: /^Round\b/ });
  await expect(round).toBeVisible();
  await round.click();
  await expect(page).toHaveURL(/\/create$/);
}

async function joinParticipant(browser: Browser, code: string) {
  const context = await browser.newContext({ baseURL: webUrl, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`/join?code=${code}`);
  await expect(page.getByTestId("friendly-alias-notice")).toBeVisible();
  await expect(page.getByLabel("Nickname")).toHaveCount(0);
  const defaultAvatar = page.getByRole("radio", { name: "Comet", exact: true });
  await expect(defaultAvatar).toBeChecked();
  const target = await page.getByTestId("avatar-option-comet").boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(target?.height).toBeGreaterThanOrEqual(44);
  await defaultAvatar.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Fox", exact: true })).toBeChecked();
  await page
    .getByTestId("avatar-option-owl")
    .getByText("Owl", { exact: true })
    .click({ timeout: 10_000 });
  await expect(page.getByRole("radio", { name: "Owl", exact: true })).toBeChecked();
  const joinRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" && new URL(request.url()).pathname === "/v1/sessions/join",
  );
  await page.getByRole("button", { name: "Join round" }).click();
  expect((await joinRequest).postDataJSON()).toEqual({ code, avatarId: "owl" });
  await expect(page).toHaveURL(/\/play\//);
  await expect(page.getByRole("img", { name: "Owl avatar" })).toBeVisible();
  return { context, page };
}

async function submitChoice(page: Page, choice: string) {
  await page.getByRole("button", { name: choice, exact: true }).click();
  await expect(page.getByText("Answer received and saved.")).toHaveCount(0);
  await page.getByRole("button", { name: "Very sure" }).click();
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByText("Answer received and saved.")).toBeVisible();
}

async function advanceRehearsal(page: Page, from: string, buttonName: string, to: string) {
  const rehearsal = page.getByTestId("rehearsal-step");
  await expect(rehearsal).toHaveAttribute("data-stage", from);
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await expect(rehearsal).toHaveAttribute("data-stage", to);
}

function waitForCreationEvent(
  page: Page,
  name: "creation_started" | "creation_completed",
  creationPath: "source" | "import",
) {
  return page.waitForResponse((response) => {
    if (
      response.request().method() !== "POST" ||
      new URL(response.url()).pathname !== "/v1/product-events"
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as {
      events?: Array<{ name?: string; dimensions?: { creationPath?: string } }>;
    };
    const event = body.events?.[0];
    return event?.name === name && event.dimensions?.creationPath === creationPath;
  });
}

async function productEventMetricValue(page: Page, name: string) {
  const response = await page.request.get(`${apiUrl}/metrics`);
  expect(response.ok()).toBeTruthy();
  const exposition = await response.text();
  return exposition
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("openround_product_events_total{") && line.includes(`name="${name}"`),
    )
    .reduce((total, line) => total + Number(line.match(/\s([\d.e+-]+)$/)?.[1] ?? 0), 0);
}

test("brand navigation returns a signed-in creator to Home", async ({ page }) => {
  await signIn(page, betaEmail);

  await page.goto("/");
  const publicHeaderBrand = page
    .locator("header.site-header")
    .getByRole("link", { name: "Polling Pops", exact: true });
  await expect(publicHeaderBrand).toHaveAttribute("href", "/home");
  await publicHeaderBrand.click();
  await expect(page).toHaveURL(/\/home$/);

  const brand = page.locator("aside").getByRole("link", { name: "Polling Pops", exact: true });
  await expect(brand).toHaveAttribute("href", "/home");
  await brand.click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();

  await page.goto("/lti/link");
  await expect(
    page.getByText("This LTI launch link is missing or has already been completed."),
  ).toBeVisible();
  const ltiHeader = page.locator("header.topbar");
  await expect(ltiHeader.getByRole("link", { name: "Polling Pops" })).toHaveAttribute(
    "href",
    "/home",
  );
  await expect(ltiHeader.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
    "href",
    "/home",
  );
});

test("creator starts a blank Round with the selected first response type", async ({ page }) => {
  await signIn(page, betaEmail);

  await openRoundCreate(page);
  await expect(page.getByRole("heading", { name: "What would you like to create?" })).toBeVisible();
  await page.getByRole("link", { name: /^Custom Round/ }).click();
  await page.getByRole("link", { name: /Start blank/ }).click();
  await expect(page.getByRole("heading", { name: "Start a blank Round" })).toBeVisible();
  await page.getByLabel("Round title (optional for now)", { exact: true }).fill("Beta blank Round");
  await page.getByRole("radio", { name: /^Number/ }).check();

  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/v1/quizzes",
  );
  await page.getByRole("button", { name: "Create Round and write question" }).click();
  expect((await creation).status()).toBe(201);
  await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
  await expect(page.getByLabel("Title")).toHaveValue("Beta blank Round");
  await expect(page.getByLabel("Question prompt")).toBeFocused();
  await expect(
    page.getByRole("region", { name: "Question 1" }).locator(".status-pill"),
  ).toContainText("Numeric response");
});

test("creator reuses a main question with its linked recheck as independent copies", async ({
  page,
}) => {
  await signIn(page, betaEmail);

  const suffix = randomUUID().slice(0, 8);
  const sourceTitle = `Question bank source ${suffix}`;
  const targetTitle = `Question bank target ${suffix}`;
  const mainPrompt = `Which release check prevents regressions ${suffix}?`;
  const recheckPrompt = `Apply the release check to a new case ${suffix}.`;
  const sourceMainQuestionId = randomUUID();
  const sourceRecheckQuestionId = randomUUID();
  const sourceMainChoiceIds = [randomUUID(), randomUUID()];
  const sourceRecheckChoiceIds = [randomUUID(), randomUUID()];
  const commonQuestion = {
    type: "single_select" as const,
    purpose: "diagnostic" as const,
    confidence: "required" as const,
    conceptKeys: ["release-safety"],
    timeLimitSeconds: 30,
    explanation: "Use the evidence before choosing the release action.",
    mediaId: null,
    mediaAlt: null,
  };
  const sourceDraft = {
    title: sourceTitle,
    description: "Reusable question pair for browser coverage.",
    category: "business" as const,
    experiencePreset: { id: "focus" as const, version: 1 as const },
    questions: [
      {
        ...commonQuestion,
        id: sourceMainQuestionId,
        prompt: mainPrompt,
        delivery: "main" as const,
        linkedRecheckQuestionId: sourceRecheckQuestionId,
        basePoints: 1_000,
        choices: [
          {
            id: sourceMainChoiceIds[0]!,
            label: "Run the targeted regression suite",
            isCorrect: true,
          },
          {
            id: sourceMainChoiceIds[1]!,
            label: "Skip validation to save time",
            isCorrect: false,
            misconceptionKey: "release-safety.skip-validation",
          },
        ],
      },
      {
        ...commonQuestion,
        id: sourceRecheckQuestionId,
        prompt: recheckPrompt,
        delivery: "recheck" as const,
        linkedRecheckQuestionId: null,
        basePoints: 0,
        choices: [
          {
            id: sourceRecheckChoiceIds[0]!,
            label: "Validate the affected workflow",
            isCorrect: true,
          },
          {
            id: sourceRecheckChoiceIds[1]!,
            label: "Rely on the earlier result",
            isCorrect: false,
          },
        ],
      },
    ],
  };

  const sourceResponse = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: sourceTitle, description: sourceDraft.description },
  });
  expect(sourceResponse.status()).toBe(201);
  const sourceQuizId = (await sourceResponse.json()).quiz.id as string;
  const sourceUpdate = await page.request.patch(`${apiUrl}/v1/quizzes/${sourceQuizId}`, {
    data: sourceDraft,
  });
  expect(sourceUpdate.ok()).toBeTruthy();

  const targetResponse = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: targetTitle, description: "Receives independent copies." },
  });
  expect(targetResponse.status()).toBe(201);
  const targetQuizId = (await targetResponse.json()).quiz.id as string;

  await page.goto(`/quiz/${targetQuizId}`);
  const openQuestionBank = page.getByRole("button", { name: "Reuse from your workspace" });
  await expect(openQuestionBank).toBeVisible();
  await openQuestionBank.click();

  const picker = page.getByTestId("question-reuse-picker");
  await expect(picker).toBeVisible();
  await picker.getByLabel("Search workspace questions").fill(sourceTitle);
  await picker.getByRole("checkbox", { name: new RegExp(mainPrompt) }).check();
  await expect(
    picker.getByText(`Includes paired recheck: ${recheckPrompt}`, { exact: false }),
  ).toBeVisible();
  const visiblePickerText = await picker.innerText();
  expect(visiblePickerText).not.toContain(sourceQuizId);
  expect(visiblePickerText).not.toContain(sourceMainQuestionId);
  expect(visiblePickerText).not.toContain(sourceRecheckQuestionId);

  const autosave = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === `/v1/quizzes/${targetQuizId}/draft`,
  );
  await picker.getByRole("button", { name: "Add 2 questions" }).click();
  expect((await autosave).ok()).toBeTruthy();
  await expect(page.getByLabel("Question prompt")).toHaveValue(mainPrompt);

  const persistedResponse = await page.request.get(`${apiUrl}/v1/quizzes/${targetQuizId}`);
  expect(persistedResponse.ok()).toBeTruthy();
  const persisted = (await persistedResponse.json()) as {
    quiz: {
      draft: {
        questions: Array<{
          id: string;
          prompt: string;
          delivery?: string;
          linkedRecheckQuestionId?: string | null;
          choices?: Array<{ id: string }>;
        }>;
      };
    };
  };
  const copiedMain = persisted.quiz.draft.questions.find(
    (question) => question.prompt === mainPrompt,
  );
  const copiedRecheck = persisted.quiz.draft.questions.find(
    (question) => question.prompt === recheckPrompt,
  );

  expect(copiedMain).toBeDefined();
  expect(copiedRecheck).toBeDefined();
  expect(copiedMain?.id).not.toBe(sourceMainQuestionId);
  expect(copiedRecheck?.id).not.toBe(sourceRecheckQuestionId);
  expect(copiedMain?.linkedRecheckQuestionId).toBe(copiedRecheck?.id);
  expect(copiedRecheck).toMatchObject({ delivery: "recheck", linkedRecheckQuestionId: null });
  expect(copiedMain?.choices?.map((choice) => choice.id)).toHaveLength(2);
  expect(copiedRecheck?.choices?.map((choice) => choice.id)).toHaveLength(2);
  for (const copiedChoice of [...(copiedMain?.choices ?? []), ...(copiedRecheck?.choices ?? [])]) {
    expect([...sourceMainChoiceIds, ...sourceRecheckChoiceIds]).not.toContain(copiedChoice.id);
  }
});

test("direct beta pages fail closed when the account lookup is unavailable", async ({ page }) => {
  await signIn(page, betaEmail);

  await page.route("**/v1/auth/me", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { message: "Account lookup unavailable." } }),
      contentType: "application/json",
      status: 503,
    });
  });
  await page.goto("/sessions");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page).not.toHaveURL(/\/signin/);
});

test("direct beta pages fail closed when product features are missing", async ({ page }) => {
  await signIn(page, betaEmail);

  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...account, productFeatures: null } });
  });
  await page.goto("/results");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page).not.toHaveURL(/\/signin/);
});

test("viewer template access remains read-only", async ({ page }) => {
  await signIn(page, betaEmail);
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = (await response.json()) as {
      creator: Record<string, unknown>;
      [key: string]: unknown;
    };
    await route.fulfill({
      response,
      json: { ...account, creator: { ...account.creator, role: "viewer" } },
    });
  });

  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start blank" })).toHaveCount(0);
  await expect(page.getByText("Viewers can browse starters.").first()).toBeVisible();
});

test("starter rehearsal completes privately with bounded telemetry", async ({ page }) => {
  await signIn(page, betaEmail);

  const beforeSessions = await page.request.get(`${apiUrl}/v1/sessions`);
  const beforeReports = await page.request.get(`${apiUrl}/v1/reports`);
  expect(beforeSessions.ok()).toBeTruthy();
  expect(beforeReports.ok()).toBeTruthy();
  const sessionsBeforeRehearsal = (await beforeSessions.json()).items;
  const reportsBeforeRehearsal = (await beforeReports.json()).items;

  await page.goto("/create");
  await page.getByRole("link", { name: /^Live quiz/ }).click();
  await page.getByRole("link", { name: /Use a starter/ }).click();
  const starterCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Misconception check", exact: true }),
  });
  await expect(starterCard).toBeVisible();
  const starterCreation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/starters/misconception-check/use",
  );
  await starterCard.getByRole("button", { name: "Use this starter" }).click();
  expect((await starterCreation).status()).toBe(201);
  await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
  const quizId = new URL(page.url()).pathname.split("/").at(-1);
  expect(quizId).toBeTruthy();

  await page.goto(`/quiz/${quizId}/rehearse`);
  await expect(page.getByTestId("rehearsal-setup")).toBeVisible();
  const confidentMisconception = page.getByTestId("rehearsal-scenario-confident_misconception");
  await expect(confidentMisconception).toHaveAttribute("data-eligible", "true");
  await confidentMisconception.getByRole("radio").check();
  await page.getByTestId("rehearsal-start").click();
  await expect(page.getByTestId("rehearsal-step")).toHaveAttribute("data-stage", "briefing");
  await expect(page.getByText(/synthetic learners/i).first()).toBeVisible();

  await advanceRehearsal(page, "briefing", "Start round", "question_open");
  await advanceRehearsal(page, "question_open", "Collect synthetic responses", "responses");
  await advanceRehearsal(page, "responses", "Lock answers", "diagnosis");
  await advanceRehearsal(page, "diagnosis", "Reveal answer", "revealed");
  await advanceRehearsal(page, "revealed", "Explain or reinforce", "intervention");
  await advanceRehearsal(page, "intervention", "Finish intervention", "verify");
  await advanceRehearsal(page, "verify", "Open linked recheck", "recheck");

  const completion = page.waitForResponse((response) => {
    if (
      response.request().method() !== "POST" ||
      new URL(response.url()).pathname !== "/v1/product-events"
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as {
      events?: Array<{ name?: string }>;
    };
    return body.events?.[0]?.name === "rehearsal_completed";
  });
  await advanceRehearsal(page, "recheck", "Lock answers", "debrief");
  const completionResponse = await completion;
  expect(completionResponse.status()).toBe(202);
  expect(completionResponse.request().postDataJSON()).toEqual({
    events: [
      {
        name: "rehearsal_completed",
        occurredAt: expect.any(String),
        dimensions: {
          scenario: "confident_misconception",
          durationBucket: "under_1m",
        },
      },
    ],
  });
  await expect(page.getByTestId("rehearsal-debrief")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /3 of 4 initially wrong synthetic learners recovered/i,
    }),
  ).toBeVisible();

  const afterSessions = await page.request.get(`${apiUrl}/v1/sessions`);
  const afterReports = await page.request.get(`${apiUrl}/v1/reports`);
  expect(afterSessions.ok()).toBeTruthy();
  expect(afterReports.ok()).toBeTruthy();
  expect((await afterSessions.json()).items).toEqual(sessionsBeforeRehearsal);
  expect((await afterReports.json()).items).toEqual(reportsBeforeRehearsal);

  const metrics = await page.request.get(`${apiUrl}/metrics`);
  expect(metrics.ok()).toBeTruthy();
  expect(await metrics.text()).toContain(
    'name="rehearsal_completed",creation_path="none",recipe="none",scenario="confident_misconception",segment="education",beta_version="p0-2026",duration_bucket="under_1m",artifact_type="none"',
  );
});

test("creator assigns immutable practice and manages accountless progress", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, betaEmail);

  const suffix = randomUUID().slice(0, 8);
  const publishedTitle = `Published assignment source ${suffix}`;
  const draftTitle = `Draft changes after publish ${suffix}`;
  const mainPrompt = "Which action belongs in the published practice?";
  const draftOnlyPrompt = "This draft-only prompt must not enter practice.";
  const recheckPrompt = "This linked recheck must stay conditional.";
  const mainQuestionId = randomUUID();
  const recheckQuestionId = randomUUID();
  const correctChoiceId = randomUUID();
  const baseQuestion = {
    type: "single_select" as const,
    purpose: "diagnostic" as const,
    confidence: "required" as const,
    conceptKeys: ["practice-e2e"],
    timeLimitSeconds: 30,
    explanation: "Use the published source evidence.",
    mediaId: null,
    mediaAlt: null,
  };
  const publishedDraft = {
    title: publishedTitle,
    description: "Browser coverage for standalone practice.",
    category: "education" as const,
    experiencePreset: { id: "focus" as const, version: 1 as const },
    questions: [
      {
        ...baseQuestion,
        id: mainQuestionId,
        prompt: mainPrompt,
        delivery: "main" as const,
        linkedRecheckQuestionId: recheckQuestionId,
        basePoints: 1_000,
        choices: [
          { id: correctChoiceId, label: "Use the published answer", isCorrect: true },
          { id: randomUUID(), label: "Use the draft-only answer", isCorrect: false },
        ],
      },
      {
        ...baseQuestion,
        id: recheckQuestionId,
        prompt: recheckPrompt,
        delivery: "recheck" as const,
        linkedRecheckQuestionId: null,
        basePoints: 0,
        choices: [
          { id: randomUUID(), label: "Recheck correct", isCorrect: true },
          { id: randomUUID(), label: "Recheck incorrect", isCorrect: false },
        ],
      },
    ],
  };

  const quizResponse = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: publishedTitle, description: publishedDraft.description },
  });
  expect(quizResponse.status()).toBe(201);
  const quizId = (await quizResponse.json()).quiz.id as string;
  const updateResponse = await page.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
    data: publishedDraft,
  });
  expect(updateResponse.ok()).toBeTruthy();
  const publishResponse = await page.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, {
    data: {},
  });
  expect(publishResponse.ok()).toBeTruthy();

  const draftUpdateResponse = await page.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
    data: {
      ...publishedDraft,
      title: draftTitle,
      questions: [
        { ...publishedDraft.questions[0], prompt: draftOnlyPrompt },
        publishedDraft.questions[1],
      ],
    },
  });
  expect(draftUpdateResponse.ok()).toBeTruthy();

  await page.goto("/dashboard");
  const roundCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: draftTitle, exact: true }),
  });
  await expect(roundCard).toBeVisible();
  await roundCard.getByRole("link", { name: "Assign practice" }).click();
  await expect(page).toHaveURL(new RegExp(`/quiz/${quizId}/assign$`));
  await expect(page).toHaveTitle("Assign practice · Polling Pops");
  await expect(page.getByRole("heading", { name: publishedTitle, level: 2 })).toBeVisible();
  await expect(page.getByText("Published v1", { exact: true })).toBeVisible();
  await expect(page.getByText("main question(s)", { exact: true }).locator("..")).toContainText(
    "1",
  );
  await expect(page.getByText(/newer draft edits/i)).toBeVisible();
  await expect(page.getByText(/Conditional live rechecks are not repeated/i)).toBeVisible();

  await page.getByText("Create personal one-attempt links (optional)", { exact: true }).click();
  await page.getByLabel("One label per line").fill("Learner Alpha");
  const createdMetricBefore = await productEventMetricValue(page, "practice_assignment_created");
  const creationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/quizzes/${quizId}/practice-assignments`,
  );
  await page.getByRole("button", { name: "Create assignment" }).click();
  const creationResponse = await creationResponsePromise;
  expect(creationResponse.status()).toBe(201);
  const creation = (await creationResponse.json()) as {
    followup: { id: string; purpose: string; checkpointCount: number };
    genericUrl: string;
    personalAccess: Array<{ label: string; url: string }>;
  };
  expect(creation.followup).toMatchObject({ purpose: "assignment", checkpointCount: 1 });
  expect(creation.personalAccess).toEqual([
    expect.objectContaining({ label: "Learner Alpha", url: expect.stringContaining("#token=") }),
  ]);
  await expect(page.getByRole("heading", { name: "Save and share these links now" })).toBeFocused();
  await expect(page.getByLabel("Generic anonymous link")).toHaveValue(creation.genericUrl);
  await expect(page.getByLabel("Learner Alpha")).toHaveValue(creation.personalAccess[0]!.url);

  const sharedMetricBefore = await productEventMetricValue(page, "practice_assignment_shared");
  const shareTelemetryPromise = page.waitForResponse((response) => {
    if (
      response.request().method() !== "POST" ||
      new URL(response.url()).pathname !== "/v1/product-events"
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as {
      events?: Array<{ name?: string }>;
    };
    return body.events?.[0]?.name === "practice_assignment_shared";
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download links as CSV" }).click();
  const [shareTelemetry, download] = await Promise.all([shareTelemetryPromise, downloadPromise]);
  expect(shareTelemetry.status()).toBe(202);
  expect(shareTelemetry.request().postDataJSON()).toEqual({
    events: [
      {
        name: "practice_assignment_shared",
        occurredAt: expect.any(String),
        dimensions: {},
      },
    ],
  });
  expect(download.suggestedFilename()).toBe(
    `polling-pops-practice-${creation.followup.id}-links.csv`,
  );
  await download.delete();

  const participantContext = await browser.newContext({
    baseURL: webUrl,
    reducedMotion: "reduce",
  });
  try {
    const participant = await participantContext.newPage();
    await participant.goto(creation.genericUrl);
    await expect(participant.getByText("Question 1 of 1", { exact: true })).toBeVisible();
    await expect(participant.getByRole("heading", { name: mainPrompt, level: 1 })).toBeVisible();
    await expect(participant.getByText(recheckPrompt, { exact: true })).toHaveCount(0);
    await participant
      .getByRole("button", { name: "Use the published answer", exact: true })
      .click();
    await participant.getByRole("button", { name: "Very sure", exact: true }).click();
    await participant.getByRole("button", { name: "Submit response" }).click();
    await expect(participant.getByText("Correct", { exact: true })).toBeVisible();
    await participant.getByRole("button", { name: "Finish practice" }).click();
    await expect(participant.getByText("Practice complete", { exact: true })).toBeVisible();
    await expect(participant.getByText(recheckPrompt, { exact: true })).toHaveCount(0);
  } finally {
    await participantContext.close();
  }

  await page.getByRole("link", { name: "Manage practice" }).click();
  await expect(page).toHaveURL(new RegExp(`/practice/${creation.followup.id}$`));
  await expect(page).toHaveTitle("Manage practice · Polling Pops");
  await expect(page.getByRole("heading", { name: publishedTitle, level: 2 })).toBeVisible();
  await expect(page.getByText("Published v1", { exact: true })).toBeVisible();
  await expect(page.getByText(/already has unlimited response time/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create accommodation pass" })).toHaveCount(0);
  await expect(page.getByLabel("Generic anonymous link")).toHaveCount(0);
  const managementInputValues = await page
    .locator("input")
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(managementInputValues).not.toContain(creation.genericUrl);
  expect(managementInputValues).not.toContain(creation.personalAccess[0]!.url);
  await expect(page.getByText("attempts", { exact: true }).locator("..")).toContainText("1");
  await expect(page.getByText("completed", { exact: true }).locator("..")).toContainText("1");

  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const account = (await response.json()) as {
      entitlements: Record<string, unknown>;
      [key: string]: unknown;
    };
    await route.fulfill({
      response,
      json: {
        ...account,
        entitlements: { ...account.entitlements, followups: false },
      },
    });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Private access", level: 2 })).toBeVisible();
  await expect(
    page.getByText(/Creating new personal assignment links requires Pro/i),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Compare plans" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create personal link" })).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Learner Alpha" }).getByRole("button", {
      name: "Revoke",
    }),
  ).toBeVisible();
  await page.unroute("**/v1/auth/me");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Private access", level: 2 })).toBeVisible();

  const personalRow = page.getByRole("row").filter({ hasText: "Learner Alpha" });
  await expect(personalRow).toContainText("Active");
  page.once("dialog", (dialog) => void dialog.accept());
  await personalRow.getByRole("button", { name: "Revoke" }).click();
  await expect(personalRow).toContainText("Revoked");
  await expect(page.getByText("Learner Alpha link revoked.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private access", level: 2 })).toBeFocused();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Close practice for everyone" }).click();
  await expect(page.getByText("closed", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Practice closed for every participant.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: publishedTitle, level: 2 })).toBeFocused();
  await expect(page.getByRole("button", { name: "Close practice for everyone" })).toHaveCount(0);

  await expect
    .poll(() => productEventMetricValue(page, "practice_assignment_created"))
    .toBeGreaterThan(createdMetricBefore);
  await expect
    .poll(() => productEventMetricValue(page, "practice_assignment_shared"))
    .toBeGreaterThan(sharedMetricBefore);
});

test("signed-in creator replaces one stale host credential and resumes", async ({ page }) => {
  await signIn(page, betaEmail);

  const starterResponse = await page.request.post(`${apiUrl}/v1/starters/misconception-check/use`, {
    data: {},
  });
  expect(starterResponse.status()).toBe(201);
  const quizId = (await starterResponse.json()).quiz.id as string;
  const publishResponse = await page.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, {
    data: {},
  });
  expect(publishResponse.ok()).toBeTruthy();
  const sessionResponse = await page.request.post(`${apiUrl}/v1/sessions`, {
    data: {
      quizId,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    },
  });
  expect(sessionResponse.status()).toBe(201);
  const session = (await sessionResponse.json()) as { sessionId: string; code: string };
  const storageKey = `openround:host:${session.sessionId}`;
  await page.evaluate(({ key }) => sessionStorage.setItem(key, "stale-host-credential"), {
    key: storageKey,
  });

  let controlPassRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/v1/sessions/${session.sessionId}/control-pass`
    ) {
      controlPassRequests += 1;
    }
  });
  const controlPassResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/sessions/${session.sessionId}/control-pass`,
  );
  await page.goto(`/host/${session.sessionId}`);
  expect((await controlPassResponse).status()).toBe(201);
  await expect(page.locator(".session-code")).toContainText(session.code);

  const audienceTrigger = page.getByRole("button", { name: "Audience", exact: true });
  await audienceTrigger.click();
  const audienceDialog = page.getByRole("dialog", { name: "Participants and conversation" });
  await expect(audienceDialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Close audience tools" })).toBeFocused();
  await expect(page.locator("header.live-topbar")).toHaveAttribute("inert", "");
  await expect(page.locator("main#main")).toHaveAttribute("inert", "");

  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest("[role=dialog]")?.id ?? null))
    .toBe("host-audience-drawer");
  await page.keyboard.press("Escape");
  await expect(audienceTrigger).toBeFocused();
  await expect(page.locator("header.live-topbar")).not.toHaveAttribute("inert", "");
  await expect(page.locator("main#main")).not.toHaveAttribute("inert", "");

  await expect
    .poll(() => page.evaluate(({ key }) => sessionStorage.getItem(key), { key: storageKey }))
    .not.toBe("stale-host-credential");
  expect(controlPassRequests).toBe(1);
});

test("creator and participants complete a beta Recovery loop through report", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, betaEmail);

  const starterResponse = await page.request.post(`${apiUrl}/v1/starters/misconception-check/use`, {
    data: {},
  });
  expect(starterResponse.status()).toBe(201);
  const quizId = (await starterResponse.json()).quiz.id as string;
  const publishResponse = await page.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, {
    data: {},
  });
  expect(publishResponse.ok()).toBeTruthy();
  const sessionResponse = await page.request.post(`${apiUrl}/v1/sessions`, {
    data: {
      quizId,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    },
  });
  expect(sessionResponse.status()).toBe(201);
  const session = (await sessionResponse.json()) as {
    sessionId: string;
    code: string;
    hostToken: string;
  };
  await page.evaluate(({ sessionId, hostToken }) => {
    sessionStorage.setItem(`openround:host:${sessionId}`, hostToken);
  }, session);

  const participants: Array<{ context: BrowserContext; page: Page }> = [];
  try {
    await page.goto(`/host/${session.sessionId}`);
    await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();
    for (let index = 0; index < 5; index += 1) {
      participants.push(await joinParticipant(browser, session.code));
    }
    await expect(
      page.locator(".room-readiness span").filter({ hasText: "joined" }).getByText("5"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Participant roster" })
        .getByRole("img", { name: "Owl avatar" }),
    ).toHaveCount(5);

    await page.getByRole("button", { name: "Start round" }).click();
    await Promise.all(
      participants.map(({ page: participant }) =>
        submitChoice(participant, "Replace with the common misconception"),
      ),
    );

    await participants[0]!.page.reload();
    await expect(participants[0]!.page.getByText("Answer received and saved.")).toBeVisible();
    await expect(
      participants[0]!.page.getByRole("button", {
        name: "Replace with the common misconception",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Lock answers" }).click();
    const distribution = page.getByRole("region", { name: "Post-lock response distribution" });
    await expect(distribution).toContainText("5 respondents");
    await expect(distribution).toContainText("Replace with the common misconception");
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await expect(page.getByText("Address the confident misconception")).toBeVisible();
    await page.getByRole("button", { name: "Address the misconception" }).click();
    await expect(page.getByText(/Active intervention: explain/)).toBeVisible();
    await page.getByRole("button", { name: "Finish intervention" }).click();
    await page.getByRole("button", { name: "Open linked recheck" }).click();

    await Promise.all(
      participants.map(({ page: participant }, index) =>
        submitChoice(
          participant,
          index === participants.length - 1
            ? "Replace with the misconception applied again"
            : "Replace with the transfer case",
        ),
      ),
    );
    await page.getByRole("button", { name: "Lock answers" }).click();
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await page.getByRole("button", { name: "Continue after recheck" }).click();
    await expect(page.getByText("Results are ready.")).toBeVisible();
    await page.getByTestId("host-stage").getByRole("link", { name: "Open report" }).click();

    await expect(page.getByRole("heading", { name: "Recovery evidence" }).last()).toBeVisible({
      timeout: 20_000,
    });
    const recoveryRow = page.getByRole("row", { name: /Linked recheck/ });
    await expect(recoveryRow).toContainText("4");
    await expect(recoveryRow).toContainText("5");
    await expect(
      page
        .getByRole("list", { name: "Intervention timeline" })
        .getByText("explain", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Self-paced follow-up" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create follow-up and links" })).toBeVisible();

    await page.getByRole("tab", { name: "Questions" }).click();
    const questionsPanel = page.getByRole("tabpanel", { name: "Questions" });
    await questionsPanel.getByText("5 respondents").first().click();
    await expect(
      questionsPanel.getByText(/Replace with the common misconception: 5 \(100%/),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Participants" }).click();
    const participantsPanel = page.getByRole("tabpanel", { name: "Participants" });
    await expect(participantsPanel.getByRole("img", { name: "Owl avatar" })).toHaveCount(5);

    await page.getByRole("tab", { name: "Manage data" }).click();
    const managePanel = page.getByRole("tabpanel", { name: "Manage data" });
    await expect(managePanel.getByRole("heading", { name: "Export report data" })).toBeVisible();
    await expect(managePanel.getByRole("link", { name: "Download CSV" })).toBeVisible();
    await expect(managePanel.getByRole("link", { name: "Download JSON" })).toBeVisible();
    await expect(managePanel.getByRole("heading", { name: "Delete session data" })).toBeVisible();
  } finally {
    await Promise.all(participants.map(({ context }) => context.close()));
  }
});

test("every remaining response type requires explicit Submit before it is saved", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, betaEmail);

  const commonQuestion = () => ({
    id: randomUUID(),
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 60,
    basePoints: 1_000,
    explanation: "Review the response together.",
    mediaId: null,
    mediaAlt: null,
  });
  const choice = (label: string, isCorrect: boolean) => ({
    id: randomUUID(),
    label,
    isCorrect,
  });
  const draft = {
    title: "Explicit submit response matrix",
    description: "Browser coverage for every remaining response type.",
    category: "education",
    experiencePreset: { id: "focus", version: 1 },
    questions: [
      {
        ...commonQuestion(),
        type: "true_false",
        prompt: "Explicit submit true or false",
        choices: [choice("True", true), choice("False", false)],
      },
      {
        ...commonQuestion(),
        type: "multi_select",
        prompt: "Explicit submit multiple choice",
        choices: [choice("Alpha", true), choice("Beta", true), choice("Gamma", false)],
      },
      {
        ...commonQuestion(),
        type: "numeric",
        prompt: "Explicit submit number",
        correctValue: "42",
        tolerance: "0",
        unit: null,
      },
      {
        ...commonQuestion(),
        type: "rating",
        prompt: "Explicit submit rating",
        purpose: "opinion",
        basePoints: 0,
        min: 1,
        max: 5,
        minLabel: "Low",
        maxLabel: "High",
      },
      {
        ...commonQuestion(),
        type: "poll",
        prompt: "Explicit submit poll",
        purpose: "opinion",
        basePoints: 0,
        choices: [choice("Option A", false), choice("Option B", false)],
      },
    ],
  };

  const quizResponse = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: draft.title, description: draft.description },
  });
  expect(quizResponse.status()).toBe(201);
  const quizId = (await quizResponse.json()).quiz.id as string;
  const updateResponse = await page.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
    data: draft,
  });
  expect(updateResponse.ok()).toBeTruthy();
  const publishResponse = await page.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, {
    data: {},
  });
  expect(publishResponse.ok()).toBeTruthy();
  const sessionResponse = await page.request.post(`${apiUrl}/v1/sessions`, {
    data: {
      quizId,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    },
  });
  expect(sessionResponse.status()).toBe(201);
  const session = (await sessionResponse.json()) as {
    sessionId: string;
    code: string;
    hostToken: string;
  };
  await page.evaluate(({ sessionId, hostToken }) => {
    sessionStorage.setItem(`openround:host:${sessionId}`, hostToken);
  }, session);

  const participant = await joinParticipant(browser, session.code);
  try {
    await page.goto(`/host/${session.sessionId}`);
    await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();
    await page.getByRole("button", { name: "Start round" }).click();

    const answeredCount = page
      .locator(".room-readiness span")
      .filter({ hasText: "answered" })
      .locator("strong");
    const responseCases: Array<{
      prompt: string;
      choose: (participantPage: Page) => Promise<void>;
    }> = [
      {
        prompt: "Explicit submit true or false",
        choose: async (participantPage) => {
          const answer = participantPage.getByRole("button", { name: "True", exact: true });
          await answer.click();
          await expect(answer).toHaveAttribute("aria-pressed", "true");
        },
      },
      {
        prompt: "Explicit submit multiple choice",
        choose: async (participantPage) => {
          const alpha = participantPage.getByRole("button", { name: "Alpha", exact: true });
          const beta = participantPage.getByRole("button", { name: "Beta", exact: true });
          await alpha.click();
          await beta.click();
          await expect(alpha).toHaveAttribute("aria-pressed", "true");
          await expect(beta).toHaveAttribute("aria-pressed", "true");
        },
      },
      {
        prompt: "Explicit submit number",
        choose: async (participantPage) => {
          const input = participantPage.getByLabel(/^Numeric response/);
          await input.fill("42");
          await expect(input).toHaveValue("42");
        },
      },
      {
        prompt: "Explicit submit rating",
        choose: async (participantPage) => {
          const rating = participantPage.getByRole("button", { name: "4", exact: true });
          await rating.click();
          await expect(rating).toHaveAttribute("aria-pressed", "true");
        },
      },
      {
        prompt: "Explicit submit poll",
        choose: async (participantPage) => {
          const option = participantPage.getByRole("button", { name: "Option A", exact: true });
          await option.click();
          await expect(option).toHaveAttribute("aria-pressed", "true");
        },
      },
    ];

    for (const [index, responseCase] of responseCases.entries()) {
      await expect(
        participant.page.getByRole("heading", { name: responseCase.prompt, level: 1 }),
      ).toBeVisible();
      await expect(answeredCount).toHaveText("0");
      await responseCase.choose(participant.page);
      await expect(participant.page.getByText("Answer received and saved.")).toHaveCount(0);
      await expect(answeredCount).toHaveText("0");

      const submit = participant.page.getByRole("button", { name: "Submit response" });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(participant.page.getByText("Answer received and saved.")).toBeVisible();
      await expect(answeredCount).toHaveText("1");

      await page.getByRole("button", { name: "Lock answers" }).click();
      await page.getByRole("button", { name: "Reveal answer" }).click();
      await page
        .getByRole("button", {
          name: index === responseCases.length - 1 ? "Finish round" : "Next question",
        })
        .click();
    }
    await expect(page.getByText("Results are ready.")).toBeVisible();
  } finally {
    await participant.context.close();
  }
});

test("source and import starts reach real review drafts through mocked external gates", async ({
  page,
}) => {
  await signIn(page, betaEmail);

  const createReviewDraft = async (title: string) => {
    const response = await page.request.post(`${apiUrl}/v1/quizzes`, {
      data: { title, description: "Browser creation-start fixture." },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).quiz.id as string;
  };
  const sourceQuizId = await createReviewDraft("Source review draft");
  const importQuizId = await createReviewDraft("Imported review draft");

  await page.route("**/v1/authoring/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { status: { enabled: true, monthlyLimit: 3, used: 0, remaining: 3 } },
      status: 200,
    });
  });

  const jobId = randomUUID();
  const sourceQuestionId = randomUUID();
  const readyJob = {
    id: jobId,
    sourceName: "Fixture source",
    sourceType: "pasted_text",
    status: "ready",
    attempts: 1,
    error: null,
    appliedQuizId: null,
    output: {
      checkpointSet: {
        title: "Source review draft",
        questions: [
          {
            id: sourceQuestionId,
            delivery: "main",
            prompt: "Which statement is supported by the fixture source?",
          },
        ],
      },
      citations: [],
      provider: "Playwright fixture",
      model: "deterministic",
    },
  };
  let sourceSubmitted = false;
  let sourcePayload: Record<string, unknown> | null = null;
  await page.route("**/v1/authoring/jobs", async (route) => {
    if (route.request().method() === "POST") {
      sourcePayload = route.request().postDataJSON() as Record<string, unknown>;
      sourceSubmitted = true;
      await route.fulfill({
        contentType: "application/json",
        json: { job: readyJob },
        status: 202,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { jobs: sourceSubmitted ? [readyJob] : [] },
      status: 200,
    });
  });
  await page.route(`**/v1/authoring/jobs/${jobId}/apply`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { quiz: { id: sourceQuizId, title: "Source review draft" } },
      status: 201,
    });
  });

  await page.goto("/create#source");
  await expect(page.getByLabel("Trusted source text")).toBeVisible();
  await page.getByLabel("Source name").fill("Fixture source");
  await page
    .getByLabel("Trusted source text")
    .fill(
      "This deterministic source contains enough grounded material to propose one question and a review draft.",
    );
  const sourceStarted = waitForCreationEvent(page, "creation_started", "source");
  await page.getByRole("button", { name: "Create review proposal" }).click();
  expect((await sourceStarted).status()).toBe(202);
  expect(sourcePayload).toEqual({
    sourceType: "pasted_text",
    sourceName: "Fixture source",
    text: "This deterministic source contains enough grounded material to propose one question and a review draft.",
  });
  const proposal = page.getByRole("article").filter({ hasText: "Fixture source" });
  await expect(proposal.getByText("Ready to review", { exact: true })).toBeVisible();
  const sourceCompleted = waitForCreationEvent(page, "creation_completed", "source");
  await proposal.getByRole("button", { name: "Create unpublished review draft" }).click();
  expect((await sourceCompleted).status()).toBe(202);
  await expect(page).toHaveURL(new RegExp(`/quiz/${sourceQuizId}$`));
  await expect(page.getByLabel("Title")).toHaveValue("Source review draft");

  let importPayload: Record<string, unknown> | null = null;
  await page.route("**/v1/quizzes/import", async (route) => {
    importPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      json: {
        quiz: { id: importQuizId, title: "Imported review draft" },
        validation: {
          format: "bulk",
          importedCheckpoints: 1,
          errors: [],
          warnings: [],
        },
      },
      status: 201,
    });
  });
  await page.goto("/create#import");
  await page.getByLabel("Import format").selectOption("bulk");
  await page.getByLabel("New Round title (optional)").fill("Imported review draft");
  const bulkContent =
    "Which action is safest?\n* Follow the complete procedure\n- Take an undocumented shortcut";
  await page.getByLabel("Import content").fill(bulkContent);
  const importStarted = waitForCreationEvent(page, "creation_started", "import");
  const importCompleted = waitForCreationEvent(page, "creation_completed", "import");
  await page.getByRole("button", { name: "Validate and import draft" }).click();
  expect((await importStarted).status()).toBe(202);
  expect((await importCompleted).status()).toBe(202);
  expect(importPayload).toEqual({
    format: "bulk",
    data: bulkContent,
    encoding: "text",
    title: "Imported review draft",
  });
  await expect(page).toHaveURL(new RegExp(`/quiz/${importQuizId}$`));
  await expect(page.getByLabel("Title")).toHaveValue("Imported review draft");
});

test("@mobile beta creation remains usable at 390 by 844", async ({ page }) => {
  await signIn(page, betaEmail);
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "What would you like to create?" })).toBeVisible();
  await page.getByRole("link", { name: /^Custom Round/ }).click();
  await page.getByRole("link", { name: /Start blank/ }).click();
  await expect(page.getByRole("heading", { name: "Start a blank Round" })).toBeInViewport();
  const title = page.getByLabel("Round title (optional for now)", { exact: true });
  await title.scrollIntoViewIfNeeded();
  await expect(title).toBeInViewport();
  const create = page.getByRole("button", { name: "Create Round and write question" });
  await create.scrollIntoViewIfNeeded();
  await expect(create).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
