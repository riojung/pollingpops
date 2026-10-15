import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PresentationDraft, QuizDraft, WorkspaceProductFeatures } from "@openround/contracts";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const submissionMessage = "Synthetic funded launch submission received.";

type LaunchFeatures = Pick<
  WorkspaceProductFeatures,
  "presentationRealtime" | "liveFlexMode" | "roundExperiences"
>;

function launchFeatures(enabled: boolean): LaunchFeatures {
  return { presentationRealtime: enabled, liveFlexMode: enabled, roundExperiences: enabled };
}

async function fundingFixture(page: Page, workspaceLive: boolean, fundedLive: boolean) {
  await signInBeta(page);
  const response = await page.request.get(`${api}/v1/auth/me`);
  expect(response.ok()).toBeTruthy();
  const account = await response.json();
  const workspaceFeatures = {
    ...account.productFeatures,
    // Keep authoring available independently of live delivery policy.
    uxBeta: true,
    workspaceShell: true,
    builderV2: true,
    presentations: true,
    ...launchFeatures(workspaceLive),
  };
  await page.route(`${api}/v1/auth/me`, (route) =>
    route.fulfill({
      json: {
        ...account,
        entitlements: { ...account.entitlements, plan: "free", maxParticipants: 20 },
        productFeatures: workspaceFeatures,
      },
    }),
  );
  await page.route(`${api}/v1/workspaces/current/room-funding`, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        coveredBySubscription: false,
        availableCredits: 1,
        eventEntitlements: { ...account.entitlements, plan: "pro", maxParticipants: 100 },
        eventProductFeatures: { ...workspaceFeatures, ...launchFeatures(fundedLive) },
      },
    }),
  );
}

function roundDraft(): QuizDraft {
  return {
    title: "Funded launch regression",
    description: "Synthetic launch feature fixture",
    experiencePreset: { id: "focus", version: 1 },
    questions: [
      {
        id: randomUUID(),
        type: "single_select",
        prompt: "Which option matches the example?",
        choices: [
          { id: randomUUID(), label: "First option", isCorrect: true },
          { id: randomUUID(), label: "Second option", isCorrect: false },
        ],
        purpose: "diagnostic",
        confidence: "off",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 60,
        basePoints: 100,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
}

async function openRound(page: Page) {
  const id = randomUUID();
  const draft = roundDraft();
  await page.route(`${api}/v1/quizzes/${id}`, (route) =>
    route.fulfill({
      json: {
        quiz: { id, title: draft.title, draft, currentVersionId: randomUUID() },
        currentVersion: { content: draft },
      },
    }),
  );
  await page.goto(`/host/setup/${id}`);
  await page.getByText("Review settings", { exact: true }).click();
}

async function openPresentation(page: Page) {
  const id = randomUUID();
  const round = roundDraft();
  const draft: PresentationDraft = {
    title: "Funded Presentation launch regression",
    description: "Synthetic launch feature fixture",
    schemaVersion: 2,
    experiencePreset: { id: "focus", version: 1 },
    blocks: [{ id: randomUUID(), kind: "question", question: round.questions[0]! }],
  };
  await page.route(`${api}/v1/presentations/${id}`, (route) =>
    route.fulfill({
      json: {
        presentation: {
          id,
          title: draft.title,
          description: draft.description,
          draft,
          currentVersionId: randomUUID(),
          hasUnpublishedChanges: false,
        },
      },
    }),
  );
  await page.goto(`/presentation/${id}/host`);
  await expect(page.getByRole("heading", { name: draft.title, exact: true })).toBeVisible();
}

interface LaunchSubmission {
  useEventCredit: boolean;
  timeMode?: "timed" | "flex";
  settings?: { timeMode?: "timed" | "flex"; scoringMode: string };
  experiencePresetOverride?: string;
  presenterSoundEnabled?: boolean;
}

async function interceptLaunch(page: Page, path: "/v1/sessions" | "/v1/presentation-sessions") {
  const submissions: LaunchSubmission[] = [];
  // Observe the real launch payload without reserving or consuming an Event credit.
  await page.route(`${api}${path}`, async (route) => {
    expect(route.request().method()).toBe("POST");
    submissions.push(route.request().postDataJSON());
    await route.fulfill({
      status: 409,
      json: { error: { code: "CONFLICT", message: submissionMessage } },
    });
  });
  return {
    submissions,
    async submit(button: Locator) {
      const previous = submissions.length;
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) =>
            candidate.url() === `${api}${path}` && candidate.request().method() === "POST",
        ),
        button.click(),
      ]);
      expect(response.status()).toBe(409);
      expect(submissions).toHaveLength(previous + 1);
      await expect(page.getByRole("alert").filter({ hasText: submissionMessage })).toHaveText(
        submissionMessage,
      );
      await expect(button).toBeEnabled();
      return submissions.at(-1)!;
    },
  };
}

function launchControls(page: Page) {
  return {
    credit: page.getByRole("checkbox", { name: /Use one credit for this room/ }),
    timing: page.getByRole("combobox", { name: /^Response timing/ }),
    theme: page.getByRole("combobox", { name: /^Experience preset/ }),
    sound: page.getByRole("checkbox", {
      name: "Enable optional presenter sound cues",
      exact: true,
    }),
  };
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Presentation launch uses funded live features only while a credit is selected ${suffix}`, async ({
    page,
  }) => {
    await fundingFixture(page, false, true);
    const launch = await interceptLaunch(page, "/v1/presentation-sessions");
    await openPresentation(page);
    const { credit, timing } = launchControls(page);
    const start = page.getByRole("button", { name: "Start live session", exact: true });

    await expect(start).toBeDisabled();
    await expect(timing).toHaveCount(0);
    await credit.check();
    await expect(start).toBeEnabled();
    await expect(timing).toBeVisible();
    await timing.selectOption("flex");
    expect(await launch.submit(start)).toMatchObject({ useEventCredit: true, timeMode: "flex" });

    await credit.uncheck();
    await expect(start).toBeDisabled();
    await expect(timing).toHaveCount(0);
    expect(launch.submissions).toHaveLength(1);
  });

  test(`Round launch removes unfunded flex and theme choices and accepts funded choices ${suffix}`, async ({
    page,
  }) => {
    await fundingFixture(page, false, true);
    const launch = await interceptLaunch(page, "/v1/sessions");
    await openRound(page);
    const { credit, timing, theme, sound } = launchControls(page);
    const create = page.getByRole("button", { name: "Create live session", exact: true });

    await expect(timing).toHaveCount(0);
    await expect(theme).toHaveCount(0);
    await credit.check();
    await expect(timing).toBeVisible();
    await expect(theme).toBeVisible();
    await timing.selectOption("flex");
    await theme.selectOption("spark");
    await sound.check();

    await credit.uncheck();
    await expect(timing).toHaveCount(0);
    await expect(theme).toHaveCount(0);
    await expect(sound).toHaveCount(0);
    const unfunded = await launch.submit(create);
    expect(unfunded).toMatchObject({
      useEventCredit: false,
      settings: { timeMode: "timed" },
      presenterSoundEnabled: false,
    });
    expect(unfunded).not.toHaveProperty("experiencePresetOverride");

    await credit.check();
    await expect(timing).toBeVisible();
    await expect(theme).toBeVisible();
    await timing.selectOption("flex");
    await theme.selectOption("spark");
    await sound.check();
    expect(await launch.submit(create)).toMatchObject({
      useEventCredit: true,
      settings: { timeMode: "flex", scoringMode: "accuracy" },
      experiencePresetOverride: "spark",
      presenterSoundEnabled: true,
    });
  });
}

test("Presentation launch respects a restrictive funded preview and restores workspace live features", async ({
  page,
}) => {
  await fundingFixture(page, true, false);
  const launch = await interceptLaunch(page, "/v1/presentation-sessions");
  await openPresentation(page);
  const { credit, timing } = launchControls(page);
  const start = page.getByRole("button", { name: "Start live session", exact: true });

  await expect(start).toBeEnabled();
  await timing.selectOption("flex");
  await credit.check();
  await expect(start).toBeDisabled();
  await expect(timing).toHaveCount(0);
  await credit.uncheck();
  await expect(start).toBeEnabled();
  await expect(timing).toBeVisible();
  await timing.selectOption("flex");
  expect(await launch.submit(start)).toMatchObject({ useEventCredit: false, timeMode: "flex" });
});

test("Round launch respects restrictive funded feature flags even when workspace flags allow them", async ({
  page,
}) => {
  await fundingFixture(page, true, false);
  const launch = await interceptLaunch(page, "/v1/sessions");
  await openRound(page);
  const { credit, timing, theme, sound } = launchControls(page);
  const create = page.getByRole("button", { name: "Create live session", exact: true });

  await timing.selectOption("flex");
  await theme.selectOption("spark");
  await sound.check();
  await credit.check();
  await expect(timing).toHaveCount(0);
  await expect(theme).toHaveCount(0);
  await expect(sound).toHaveCount(0);
  const restricted = await launch.submit(create);
  expect(restricted).toMatchObject({
    useEventCredit: true,
    settings: { timeMode: "timed" },
    presenterSoundEnabled: false,
  });
  expect(restricted).not.toHaveProperty("experiencePresetOverride");

  await credit.uncheck();
  await expect(timing).toBeVisible();
  await expect(theme).toBeVisible();
  await timing.selectOption("flex");
  await theme.selectOption("spark");
  await sound.check();
  expect(await launch.submit(create)).toMatchObject({
    useEventCredit: false,
    settings: { timeMode: "flex", scoringMode: "accuracy" },
    experiencePresetOverride: "spark",
    presenterSoundEnabled: true,
  });
});
