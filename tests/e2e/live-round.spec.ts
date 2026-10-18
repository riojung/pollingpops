import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { testEmail } from "./test-email";

async function closePresenter(page: Page) {
  const closeButton = page.getByRole("button", { name: "Close presenter" });
  await expect(closeButton).toBeVisible();
  await expect(closeButton).toBeEnabled();
  await closeButton.click({ trial: true });

  const closed = page.waitForEvent("close");
  await closeButton.evaluate((button) => {
    window.setTimeout(() => button.click(), 0);
  });
  await closed;
  expect(page.isClosed()).toBe(true);
}

test("creator and participant complete a live round", async ({ browser }, testInfo) => {
  const creatorContext = await browser.newContext();
  const creator = await creatorContext.newPage();
  await creator.goto("/signin");
  await creator.getByRole("button", { name: "Education" }).click();
  await creator.getByLabel("Email address").fill(testEmail("live-round", testInfo));
  await creator.getByLabel(/I accept the Terms/).check();
  await creator.getByRole("button", { name: "Send sign-in link" }).click();
  await creator.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(creator).toHaveURL(/\/dashboard/);

  await creator.getByLabel("Checkpoint set title").fill("A one-question check");
  await creator.getByRole("button", { name: "Create checkpoint set" }).click();
  await expect(creator).toHaveURL(/\/quiz\//);
  await expect(creator.getByLabel("Experience preset")).toHaveValue("pops");
  await creator.getByRole("button", { name: "True or false" }).click();
  await creator
    .getByRole("textbox", { name: "Checkpoint prompt", exact: true })
    .fill("Edmonton is the capital of Alberta.");
  await creator.getByLabel("Round category").selectOption("education");
  await creator.getByRole("button", { name: "Use recommended Campus" }).click();
  await expect(creator.getByLabel("Experience preset")).toHaveValue("campus");
  await expect(creator.getByLabel("Campus experience preview")).toBeVisible();
  await expect(creator.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await creator.getByRole("button", { name: "Preview" }).click();
  await expect(creator).toHaveURL(/\/quiz\/[^/]+\/preview/);
  await expect(creator.getByText("Edmonton is the capital of Alberta.")).toBeVisible();
  await creator.getByRole("button", { name: "Reveal answer" }).click();
  await expect(creator.locator('.answer-button[data-correct="true"]')).toContainText("True");
  await creator.getByRole("link", { name: "Back to editor" }).click();
  await expect(creator).toHaveURL(/\/quiz\/[^/]+$/);
  await expect(creator.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  const publishResponsePromise = creator.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/publish"),
  );
  await creator.getByRole("button", { name: "Publish" }).click();
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.status()).toBe(200);
  await expect(creator.getByText("published", { exact: true })).toBeVisible();
  await creator.getByLabel("Experience preset").selectOption("spark");
  await expect(creator.getByRole("status")).toContainText("Saving");
  await expect(creator.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await creator.getByRole("link", { name: "Dashboard" }).click();
  await expect(creator.getByText(/1 of 5 published checkpoint-set slots used/)).toBeVisible({
    timeout: 10_000,
  });
  await creator.getByRole("button", { name: "Host" }).click();
  await expect(creator).toHaveURL(/\/host\/setup\//);
  await expect(creator.getByLabel("Maximum participants")).toHaveValue("20");
  await expect(creator.getByLabel(/Allow participants to join/)).toBeChecked();
  await expect(creator.getByLabel("Scoring mode")).toHaveValue("accuracy");
  await expect(creator.getByLabel("Results during the round")).toHaveValue("private");
  await expect(creator.getByLabel("Participant names")).toHaveValue("friendly_only");
  await expect(creator.getByLabel("Experience preset")).toHaveValue("campus");
  await creator.getByLabel("Experience preset").selectOption("blueprint");
  await creator.getByRole("button", { name: "Create live session" }).click();
  await expect(creator).toHaveURL(/\/host\/(?!setup\/)[^/]+$/);
  await expect(creator.locator(".live-shell")).toHaveAttribute("data-pattern", "grid");
  expect((await new AxeBuilder({ page: creator }).analyze()).violations).toEqual([]);
  const code = (await creator.locator(".session-code").textContent())!.trim();
  const expectedJoinUrl = `${new URL(creator.url()).origin}/join?code=${code}`;
  await expect(creator.getByTestId("join-url")).toHaveAttribute("href", expectedJoinUrl);
  await expect(
    creator.getByLabel(new RegExp(`QR code for round ${code.split("").join(" ")}`)),
  ).toBeVisible();

  await creator.getByText("Round staff").click();
  await expect(
    creator.getByText("Shareable cohost links are available on Pro, Team, and Community plans."),
  ).toBeVisible();
  await expect(creator.getByLabel("Co-host label")).toHaveCount(0);
  await expect(creator.getByRole("button", { name: "Create cohost link" })).toHaveCount(0);

  const lanJoinUrl = `http://192.168.1.20:8080/join?code=${code}`;
  await creator.getByLabel("Network or public product address").fill("http://192.168.1.20:8080");
  await creator.getByRole("button", { name: "Update QR" }).click();
  await expect(creator.getByTestId("join-url")).toHaveAttribute("href", lanJoinUrl);

  const presenterPagePromise = creatorContext.waitForEvent("page");
  await creator.getByRole("button", { name: "Presenter view" }).click();
  const presenter = await presenterPagePromise;
  await expect(presenter).toHaveURL(/\/present\//);
  await expect(presenter.getByTestId("join-url")).toHaveAttribute("href", lanJoinUrl);
  await closePresenter(presenter);
  await creator.getByText("Change join address").click();
  await creator.getByRole("button", { name: "Reset address" }).click();
  await expect(creator.getByTestId("join-url")).toHaveAttribute("href", expectedJoinUrl);

  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto(`/join?code=${code}`);
  // Preflight replaces the initial nickname field with this Round's friendly-only form.
  // Wait for that rendered privacy policy before activating Join.
  await expect(participant.getByTestId("friendly-alias-notice")).toBeVisible();
  await expect(participant.getByLabel("Nickname", { exact: true })).toHaveCount(0);
  await participant.getByRole("button", { name: "Join round" }).click();
  await expect(participant).toHaveURL(/\/play\//);
  await expect(participant.locator(".live-shell")).toHaveAttribute("data-pattern", "grid");
  await expect(participant.getByRole("img", { name: "Comet avatar" })).toBeVisible();
  await expect(creator.getByText(/Bright|Calm|Curious|Kind|Quick|Sunny/)).toBeVisible();
  await expect(creator.getByRole("img", { name: "Comet avatar" })).toBeVisible();

  await participant.getByRole("button", { name: "Show an example" }).click();
  await expect(creator.locator(".participant-pulse-table tbody tr").first()).toContainText(
    "Show an example",
  );
  await expect(participant.getByText(/room sees totals only/i)).toBeVisible();

  await creator.getByLabel("Room chat").click();
  await expect(creator.getByLabel("Room chat")).toBeChecked();
  await participant.getByLabel("Chat message").fill("Could we see a practical example?");
  await participant.getByRole("button", { name: "Send" }).click();
  const hostChatMessage = creator.locator(".chat-message", {
    hasText: "Could we see a practical example?",
  });
  await expect(hostChatMessage).toBeVisible();
  await hostChatMessage.getByRole("button", { name: "Pin" }).click();
  const participantChatMessage = participant.locator(".chat-message", {
    hasText: "Could we see a practical example?",
  });
  await expect(participantChatMessage.getByText("Pinned")).toBeVisible();
  await participantChatMessage.getByRole("button", { name: "Like: 0" }).click();
  await expect(hostChatMessage.locator(".reaction-count")).toContainText("1");

  const pulsePresenterPagePromise = creatorContext.waitForEvent("page");
  await creator.getByRole("button", { name: "Presenter view" }).click();
  const pulsePresenter = await pulsePresenterPagePromise;
  await expect(pulsePresenter.locator(".live-shell")).toHaveAttribute("data-pattern", "grid");
  await expect(pulsePresenter.getByRole("img", { name: "Comet avatar" })).toBeVisible();
  await expect(pulsePresenter.getByText("Could we see a practical example?")).toBeVisible();
  await closePresenter(pulsePresenter);

  await participant.getByLabel("Ask the facilitator").fill("Why is Edmonton the capital?");
  await participant.getByRole("button", { name: "Ask question" }).click();
  await expect(participant.getByText("Question sent for facilitator review.")).toBeVisible();
  const hostQuestion = creator.locator(".qna-question", {
    hasText: "Why is Edmonton the capital?",
  });
  await expect(hostQuestion.getByText("Awaiting review")).toBeVisible();
  await hostQuestion.getByRole("button", { name: "Publish" }).click();
  await expect(participant.getByRole("button", { name: "I have this question" })).toBeVisible();
  await hostQuestion.getByLabel("Facilitator reply").fill("It is Alberta's seat of government.");
  await hostQuestion.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(participant.getByText("It is Alberta's seat of government.")).toBeVisible();

  await creator.getByRole("button", { name: "Start round" }).click();
  await expect(
    participant.getByRole("heading", {
      name: "Edmonton is the capital of Alberta.",
      level: 1,
    }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
  await participant.getByRole("button", { name: "True", exact: true }).click();
  await expect(participant.getByText("Answer received and saved.")).toBeVisible();
  await creator.getByRole("button", { name: "Lock answers" }).click();
  await creator.getByRole("button", { name: "Reveal answer" }).click();
  await expect(participant.getByText("Correct", { exact: true })).toBeVisible();
  await creator.getByRole("button", { name: "Finish round" }).click();
  await creator.getByRole("link", { name: "Open report" }).click();
  await expect(
    creator
      .locator(".metric")
      .filter({ hasText: "initial accuracy" })
      .getByText("100%", { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  const exportNotice = creator.getByRole("link", { name: "CSV was not included for this room" });
  await expect(exportNotice).toBeVisible();
  await expect(exportNotice).toHaveAttribute("href", "/pricing");
  await expect(creator.getByRole("link", { name: /^Download (CSV|JSON)$/ })).toHaveCount(0);
  const reportId = new URL(creator.url()).pathname.split("/").at(-1)!;
  for (const format of ["csv", "json"]) {
    const response = await creator.request.get(
      `http://127.0.0.1:4100/v1/reports/${reportId}.${format}`,
    );
    expect(response.status()).toBe(402);
    expect(await response.json()).toMatchObject({ error: { code: "ENTITLEMENT_LIMIT" } });
  }
  await expect(creator.getByText(/current free plan defaults to 30 days/)).toBeVisible();
  expect((await new AxeBuilder({ page: creator }).analyze()).violations).toEqual([]);

  await participantContext.close();
  await creatorContext.close();
});

test("quiz autosave serializes overlapping edits", async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  const creator = await context.newPage();
  await creator.goto("/signin");
  await creator.getByRole("button", { name: "Workplace" }).click();
  await creator.getByLabel("Email address").fill(testEmail("autosave", testInfo));
  await creator.getByLabel(/I accept the Terms/).check();
  await creator.getByRole("button", { name: "Send sign-in link" }).click();
  await creator.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(creator).toHaveURL(/\/dashboard/);
  await creator.getByLabel("Checkpoint set title").fill("Autosave ordering");
  await creator.getByRole("button", { name: "Create checkpoint set" }).click();
  await expect(creator).toHaveURL(/\/quiz\//);
  await expect(creator.getByRole("status")).toContainText("Saved", { timeout: 10_000 });

  let patchCount = 0;
  let markFirstStarted!: () => void;
  let releaseFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await creator.route("**/v1/quizzes/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    patchCount += 1;
    if (patchCount === 1) {
      markFirstStarted();
      await firstCanFinish;
    }
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await creator.getByRole("button", { name: "True or false" }).click();
  const question = creator.getByRole("textbox", { name: "Checkpoint prompt", exact: true });
  await question.fill("First edit");
  await firstStarted;
  await question.fill("Latest edit");
  await creator.waitForTimeout(900);
  expect(patchCount).toBe(1);

  releaseFirst();
  await expect.poll(() => patchCount).toBe(2);
  await expect(creator.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await creator.reload();
  await expect(question).toHaveValue("Latest edit");
  await context.close();
});

test("incomplete questions autosave with actionable guidance", async ({ page }, testInfo) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Workplace" }).click();
  await page.getByLabel("Email address").fill(testEmail("guidance", testInfo));
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();

  await page.getByLabel("Checkpoint set title").fill("Validation guidance");
  await page.getByRole("button", { name: "Create checkpoint set" }).click();
  await page.getByRole("button", { name: "Single select" }).click();
  await expect(page.getByRole("status")).toContainText("Saving");
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });

  const guidance = page.locator(".validation-guidance");
  await expect(guidance).toContainText("Source: Checkpoint 1");
  await expect(guidance).toContainText(
    "Enter the checkpoint prompt; fill answer choices 1, 2, 3, and 4 before previewing or publishing.",
  );
  await expect(guidance).toContainText("in-progress draft is still saved automatically");

  await page.reload();
  await expect(page.getByRole("button", { name: /1\. Untitled checkpoint/ })).toBeVisible();
  await page.goto(`${page.url()}/preview`);
  await expect(page.locator(".live-card .error[role='alert']")).toContainText(
    "Preview unavailable. Checkpoint 1: Enter the checkpoint prompt.",
  );
  await page.getByRole("link", { name: "Return to editor" }).click();
  await expect(page).toHaveURL(/\/quiz\/[^/]+$/);
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  const publishButton = page.getByRole("button", { name: "Publish" });
  await expect(publishButton).toBeEnabled();
  await publishButton.click();
  await expect(guidance).toHaveAttribute("role", "alert");
  await expect(guidance).toContainText("Cannot publish this checkpoint set yet");
  await expect(guidance).toContainText("Source: Checkpoint 1");

  await page
    .getByRole("textbox", { name: "Checkpoint prompt", exact: true })
    .fill("Which number comes after 41?");
  for (const [index, answer] of ["40", "41", "42", "43"].entries()) {
    await page.getByRole("textbox", { name: `Answer ${index + 1}`, exact: true }).fill(answer);
  }
  await expect(guidance).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await publishButton.click();
  await expect(page.getByText("published", { exact: true })).toBeVisible();
});
