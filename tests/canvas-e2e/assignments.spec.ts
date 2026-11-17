import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { api, fits, organization, web } from "./support";

async function accessible(page: Page) {
  await fits(page);
  // WebKit can update inherited palette colors after the mode attribute changes.
  await expect
    .poll(
      async () =>
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
    )
    .toEqual([]);
}

test("timed assignment access exposes a private accommodation and readable countdown", async ({
  page,
  browser,
}, info) => {
  await organization(page, info);
  const source = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
    data: {},
  });
  expect(source.status()).toBe(201);
  const { quiz } = await source.json();
  const publication = await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
    data: { expectedDraftRevision: quiz.draftRevision },
  });
  expect(publication.status()).toBe(200);
  const { version } = await publication.json();
  const created = await page.request.post(`${api}/v1/quizzes/${quiz.id}/practice-assignments`, {
    data: {
      sourceQuizVersionId: version.id,
      title: "Timed practice",
      timeMode: "timed",
      closesAt: new Date(Date.now() + 3_600_000).toISOString(),
      personalLabels: [],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { followup } = await created.json();
  await page.goto(`/practice/${followup.id}`);
  await page.getByRole("tab", { name: "Private access", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Timing accommodation" }).click();
  await page.getByRole("textbox", { name: "Pass label", exact: true }).fill("Extended time");
  await page.getByRole("combobox", { name: "Time allowance", exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Create accommodation pass", exact: true }).click();
  const link = page.getByRole("textbox", { name: "Extended time", exact: true });
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  await accessible(page);
  const context = await browser.newContext({
    baseURL: web,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  try {
    const learner = await context.newPage();
    await learner.goto(url);
    await expect(learner.getByText("2× time", { exact: true })).toBeVisible();
    await expect(learner.getByRole("timer")).toBeVisible();
    const seconds = Number((await learner.getByRole("timer").innerText()).replace("s", ""));
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(quiz.draft.questions[0].timeLimitSeconds * 2);
    await accessible(learner);
    await learner.screenshot({
      path: info.outputPath("assignment-learner-timed-dark.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

for (const suffix of ["", " @mobile"]) {
  test(`assignments create, share, manage and complete private practice${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(300_000);
    if (!suffix) await page.setViewportSize({ width: 1440, height: 1080 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await organization(page, info);
    const source = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
      data: {},
    });
    expect(source.status(), await source.text()).toBe(201);
    const { quiz } = await source.json();
    const publication = await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
      data: { expectedDraftRevision: quiz.draftRevision },
    });
    expect(publication.status(), await publication.text()).toBe(200);

    await page.goto("/assignments");
    await expect(
      page.getByRole("heading", { name: "No assignments yet", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create assignment", exact: true }).click();
    const chooser = page.getByRole("dialog", { name: "Choose a published Round", exact: true });
    await expect(chooser.getByRole("searchbox")).toBeFocused();
    await accessible(page);
    await page.keyboard.press("Escape");
    await expect(chooser).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create assignment", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Create assignment", exact: true }).click();
    await chooser.getByRole("link", { name: new RegExp(quiz.title) }).click();
    await expect(page).toHaveURL(new RegExp(`/quiz/${quiz.id}/assign$`));
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Team onboarding practice");
    await page.locator("summary").filter({ hasText: "Create personal one-attempt links" }).click();
    await page
      .getByRole("textbox", { name: "One label per line", exact: true })
      .fill("Avery\nBlake\navery");
    await expect(page.locator("#practice-personal-count")).toContainText(
      /^2 of \d+ personal links/,
    );
    await expect(page.locator("#practice-personal-count")).toContainText(
      "Duplicate labels combined: 1.",
    );
    await accessible(page);
    await page.screenshot({ path: info.outputPath("assignment-setup.png"), fullPage: true });
    if (suffix) {
      await page.setViewportSize({ width: 320, height: 844 });
      await accessible(page);
      await page.setViewportSize({ width: 390, height: 844 });
    }
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/v1/quizzes/${quiz.id}/practice-assignments`),
    );
    await page.getByRole("button", { name: "Create assignment", exact: true }).click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    const { followup } = await response.json();
    await expect(
      page.getByRole("heading", { name: "Save your private links", exact: true }),
    ).toBeVisible();
    const genericUrl = await page
      .getByRole("textbox", { name: "Generic anonymous practice link", exact: true })
      .inputValue();
    const personalUrl = await page
      .getByRole("textbox", { name: "Avery", exact: true })
      .inputValue();
    expect(new URL(genericUrl).hash).toMatch(/^#token=/);
    expect(new URL(personalUrl).hash).toMatch(/^#token=/);
    await accessible(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download links CSV", exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await page.getByRole("link", { name: "Manage practice", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/practice/${followup.id}$`));
    await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await accessible(page);
    await page.screenshot({ path: info.outputPath("assignment-overview.png"), fullPage: true });
    await page.getByRole("tab", { name: "Private access", exact: true }).click();
    await page.getByRole("textbox", { name: "Personal link label", exact: true }).fill("Casey");
    await page.getByRole("button", { name: "Create personal link", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Casey", exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "Private access", exact: true }).click();
    await expect(page.locator("#latest-practice-link")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search private links", exact: true }).fill("Casey");
    await expect(
      page.getByRole("button", { name: "Revoke private link: Casey", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Revoke private link: Avery", exact: true }),
    ).toHaveCount(0);
    const revoked = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().includes(`/v1/followups/${followup.id}/access/`),
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke private link: Casey", exact: true }).click();
    expect((await revoked).status()).toBe(204);
    await page.getByRole("searchbox", { name: "Search private links", exact: true }).fill("");
    await accessible(page);
    await page.screenshot({ path: info.outputPath("assignment-access.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
    await accessible(page);
    await page.screenshot({ path: info.outputPath("assignment-access-dark.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "light" });

    const learnerContext = await browser.newContext({
      baseURL: web,
      viewport: page.viewportSize()!,
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const learner = await learnerContext.newPage();
    try {
      await learner.goto(personalUrl);
      await expect(learner.locator("#followup-question-heading")).toBeVisible();
      expect(new URL(learner.url()).hash).toBe("");
      const questionBox = await learner.locator("main > section.live-card").last().boundingBox();
      expect(questionBox!.y).toBeLessThan(180);
      await expect(
        learner.getByRole("progressbar", { name: "Your progress", exact: true }),
      ).toHaveAttribute("aria-valuenow", "0");
      const mainCount = quiz.draft.questions.filter(
        (question: { delivery?: string }) => (question.delivery ?? "main") === "main",
      ).length;
      for (let index = 0; index < mainCount; index++) {
        const choice = learner.locator(".answer-button").first();
        await choice.click();
        await expect(choice).toHaveAttribute("aria-pressed", "true");
        if (index === 0) {
          await accessible(learner);
          await learner.screenshot({
            path: info.outputPath("assignment-learner-selected-dark.png"),
            fullPage: true,
          });
        }
        const confidence = learner.getByRole("button", { name: "Very sure", exact: true });
        if (await confidence.isVisible()) await confidence.click();
        await learner.getByRole("button", { name: "Submit response", exact: true }).click();
        const next = learner.getByRole("button", {
          name: index === mainCount - 1 ? "Finish practice" : "Next question",
          exact: true,
        });
        await expect(next).toBeVisible();
        if (index === 0) {
          await expect(choice).toBeDisabled();
          await expect(
            learner.getByRole("progressbar", { name: "Your progress", exact: true }),
          ).toHaveAttribute("aria-valuenow", "1");
          await accessible(learner);
          await learner.screenshot({
            path: info.outputPath("assignment-learner-feedback-dark.png"),
            fullPage: true,
          });
          await learner.evaluate(() => {
            localStorage.setItem(
              "openround:experience-preferences",
              JSON.stringify({ highContrast: true, reducedMotion: true }),
            );
            window.dispatchEvent(
              new StorageEvent("storage", { key: "openround:experience-preferences" }),
            );
          });
          await expect(learner.locator("[data-contrast=high]")).toBeVisible();
          await accessible(learner);
          await learner.evaluate(() => {
            localStorage.removeItem("openround:experience-preferences");
            window.dispatchEvent(
              new StorageEvent("storage", { key: "openround:experience-preferences" }),
            );
          });
          await learner.emulateMedia({ colorScheme: "light" });
          await expect(learner.locator("html")).toHaveAttribute("data-color-mode", "light");
          await accessible(learner);
          await learner.reload();
          await expect(
            learner.getByRole("button", { name: "Next question", exact: true }),
          ).toBeVisible();
          await expect(learner.locator(".answer-button").first()).toBeDisabled();
        }
        await next.click();
      }
      await expect(
        learner.getByRole("heading", {
          name: "Thanks for checking your understanding.",
          exact: true,
        }),
      ).toBeVisible();
      await accessible(learner);
    } finally {
      await learnerContext.close();
    }

    await page.getByRole("tab", { name: "Results", exact: true }).click();
    await page.reload();
    await page.getByRole("tab", { name: "Results", exact: true }).click();
    await expect(page.getByRole("tabpanel", { name: "Results", exact: true })).toContainText("1");
    await accessible(page);
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await page.getByText("Close practice", { exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Close practice for everyone", exact: true }).click();
    await expect(
      page.getByText("Practice closed for every participant.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to Assignments", exact: true }).click();
    await expect(
      page.locator("main article").filter({ hasText: "Team onboarding practice" }),
    ).toBeVisible();
    await page
      .getByRole("group", { name: "Assignment status", exact: true })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "No matching assignments", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Search assignments", exact: true })
      .fill("Team onboarding");
    await expect(page.locator("main article")).toHaveCount(1);
    await accessible(page);
    await page.screenshot({ path: info.outputPath("assignments-directory.png"), fullPage: true });
    if (suffix) {
      await page.setViewportSize({ width: 320, height: 844 });
      await accessible(page);
      await page.goto(`/practice/${followup.id}`);
      await accessible(page);
    }
  });
}
