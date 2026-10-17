import { expect, test } from "@playwright/test";

import { testEmail } from "./test-email";

const apiUrl = "http://127.0.0.1:4100";

test("feature-off creator remains on the legacy dashboard", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/signin");
  await page.getByRole("button", { name: "Workplace" }).click();
  await page.getByLabel("Email address").fill(testEmail("ux-beta-off", testInfo));
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Your checkpoint sets" })).toBeVisible();
  await expect(page.getByLabel("Checkpoint set title")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create checkpoint set" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create Round" })).toHaveCount(0);

  await page.getByLabel("Checkpoint set title").fill("Legacy rollback check");
  await page.getByRole("button", { name: "Create checkpoint set" }).click();
  await expect(page).toHaveURL(/\/quiz\//);
  const legacyQuizId = new URL(page.url()).pathname.split("/").at(-1);
  expect(legacyQuizId).toBeTruthy();
  await expect(page.getByText("Checkpoint set editor", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checkpoints" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Questions" })).toHaveCount(0);

  await page.goto(`/quiz/${legacyQuizId}/rehearse`);
  await expect(page.getByTestId("rehearsal-unavailable")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recovery Rehearsal is not available" }),
  ).toBeVisible();
  await expect(page.getByText(/No session or learner record was created/)).toBeVisible();

  const starterResponse = await page.request.post(`${apiUrl}/v1/starters/misconception-check/use`, {
    data: {},
  });
  expect(starterResponse.status()).toBe(201);
  const starterQuizId = (await starterResponse.json()).quiz.id as string;
  const publishResponse = await page.request.post(`${apiUrl}/v1/quizzes/${starterQuizId}/publish`, {
    data: {},
  });
  expect(publishResponse.ok()).toBeTruthy();

  await page.goto(`/host/setup/${starterQuizId}`);
  await expect(page.getByRole("link", { name: "Preview checkpoint set" })).toBeVisible();
  await expect(page.getByTestId("session-setup")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Choose the facilitation style" })).toHaveCount(0);

  const sessionResponse = await page.request.post(`${apiUrl}/v1/sessions`, {
    data: {
      quizId: starterQuizId,
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
  const participant = await page.context().newPage();
  try {
    await page.addInitScript(({ sessionId, hostToken }) => {
      window.sessionStorage.setItem(`openround:host:${sessionId}`, hostToken);
    }, session);
    await page.goto(`/host/${session.sessionId}`);
    await expect(page.locator(".live-shell")).toHaveAttribute("data-ux-beta", "false");
    await expect(page.getByTestId("host-command-bar")).toHaveCount(0);

    await participant.goto(`/join?code=${session.code}`);
    await expect(participant.getByTestId("friendly-alias-notice")).toBeVisible();
    await participant.getByRole("button", { name: "Join round" }).click();
    await expect(participant).toHaveURL(/\/play\//);
    await expect(participant.locator(".live-shell")).toHaveAttribute("data-ux-beta", "false");
    await expect(participant.getByRole("list", { name: "Round progress" })).toHaveCount(0);

    await page.getByRole("button", { name: "Start round" }).click();
    await expect(participant.getByText("Checkpoint 1 of 1")).toBeVisible();
    await page.getByRole("button", { name: "Lock answers" }).click();
    await page.getByRole("button", { name: "Reopen as revote" }).click();
    await expect(page.getByTestId("host-session")).toHaveAttribute("data-phase", "question_open");
    await page.getByRole("button", { name: "Lock answers" }).click();
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await page.getByRole("button", { name: "Show standings" }).click();
    await expect(page.getByTestId("host-session")).toHaveAttribute("data-phase", "leaderboard");
    await page.getByRole("button", { name: "Continue after recheck" }).click();
    await expect(page.getByText("Results are ready.")).toBeVisible();
    await page.getByRole("link", { name: "Open report" }).click();

    await expect(page.getByRole("heading", { name: "Checkpoint analysis" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("navigation", { name: "Report details" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Manage data" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Distribution", exact: true })).toHaveCount(
      0,
    );
    const exportNotice = page.getByRole("link", { name: "CSV was not included for this room" });
    await expect(exportNotice).toBeVisible();
    await expect(exportNotice).toHaveAttribute("href", "/pricing");
    await expect(page.getByRole("link", { name: /^Download (CSV|JSON)$/ })).toHaveCount(0);
    const reportId = new URL(page.url()).pathname.split("/").at(-1)!;
    for (const format of ["csv", "json"]) {
      const response = await page.request.get(`${apiUrl}/v1/reports/${reportId}.${format}`);
      expect(response.status()).toBe(402);
      expect(await response.json()).toMatchObject({ error: { code: "ENTITLEMENT_LIMIT" } });
    }
  } finally {
    await participant.close();
  }

  await page.goto("/dashboard");
  const legacyCard = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Legacy rollback check" }) });
  await expect(legacyCard.getByRole("link", { name: "Edit" })).toBeVisible();
  await expect(legacyCard.getByRole("button", { name: "Duplicate" })).toBeVisible();
  await expect(legacyCard.getByRole("button", { name: "Organize" })).toBeVisible();
  await expect(legacyCard.getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(legacyCard.getByText("More", { exact: true })).toHaveCount(0);
  await expect(legacyCard.getByRole("link", { name: "Rehearse" })).toHaveCount(0);

  await page.goto("/create");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByLabel("Checkpoint set title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How do you want to start?" })).toHaveCount(0);
});
