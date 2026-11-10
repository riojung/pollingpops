import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
async function signIn(page: Page) {
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();
}

test("Question Health previews a draft diff, applies one revision, and undoes it", async ({
  page,
}) => {
  await signIn(page);

  const title = `Health review ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title, description: "Draft-only revision browser coverage." },
  });
  expect(created.status()).toBe(201);
  const { quiz } = (await created.json()) as { quiz: { id: string; draftRevision: number } };
  const questionId = randomUUID();
  const draft = {
    title,
    description: "Draft-only revision browser coverage.",
    questions: [
      {
        id: questionId,
        type: "single_select",
        prompt: "Which step checks that a change did not break the existing workflow?",
        purpose: "diagnostic",
        confidence: "off",
        delivery: "main",
        conceptKeys: ["regression-testing"],
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
        choices: [
          {
            id: randomUUID(),
            label: "Run the regression suite",
            isCorrect: true,
          },
          {
            id: randomUUID(),
            label: "Skip all existing checks",
            isCorrect: false,
            feedback: "Skipping checks leaves regressions undiscovered.",
          },
        ],
      },
    ],
  };
  const prepared = await page.request.patch(`${apiUrl}/v1/quizzes/${quiz.id}`, {
    data: { draft, expectedDraftRevision: quiz.draftRevision },
  });
  expect(prepared.ok()).toBeTruthy();

  await page.goto(`/quiz/${quiz.id}`);
  await page.getByText("Question review", { exact: true }).click();
  const panel = page.getByText("Question Health · advisory", { exact: true }).locator("..");
  await expect(panel).toBeVisible();
  await panel.locator("summary").first().click();
  const review = panel.getByRole("button", { name: "Review saved draft" });
  await expect(review).toBeEnabled();

  // A local edit cannot be reviewed while its autosave is still pending.
  let releaseSave: (() => void) | undefined;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(`**/v1/quizzes/${quiz.id}/draft`, async (route) => {
    await saveGate;
    await route.continue();
  });
  await page.getByLabel("Title").fill(`${title} reviewed`);
  await expect(review).toBeDisabled();
  releaseSave?.();
  await expect(review).toBeEnabled();
  await page.unroute(`**/v1/quizzes/${quiz.id}/draft`);

  await review.click();
  const explanationFinding = panel
    .getByRole("list", { name: "Active Question Health findings" })
    .getByRole("listitem")
    .filter({ hasText: "Explanation missing" });
  await expect(explanationFinding).toBeVisible();
  await explanationFinding.getByRole("button", { name: "Prepare draft revision" }).click();
  const authoredExplanation = "A regression suite checks that existing behaviour still works.";
  await explanationFinding.getByLabel("Answer explanation").fill(authoredExplanation);
  await explanationFinding.getByRole("button", { name: "Preview before/after" }).click();
  const diff = explanationFinding.getByText("Before / after · draft only").locator("..");
  await expect(diff.getByText("Before", { exact: true })).toBeVisible();
  await expect(diff.getByText("After", { exact: true })).toBeVisible();
  await expect(diff).toContainText(authoredExplanation);
  await expect(page.locator("#explanation")).toHaveValue("");

  await explanationFinding.getByRole("button", { name: "Apply to saved draft" }).click();
  await expect(panel.getByRole("button", { name: "Undo this revision" })).toBeEnabled();
  await expect(page.locator("#explanation")).toHaveValue(authoredExplanation);
  await expect(panel.getByText("Explanation missing", { exact: true })).toHaveCount(0);

  await panel.getByRole("button", { name: "Undo this revision" }).click();
  await expect(page.locator("#explanation")).toHaveValue("");
  await expect(panel.getByText("Explanation missing", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Undo this revision" })).toHaveCount(0);
});

test("Question Health reviews the immutable published version after draft edits and republishing", async ({
  page,
}) => {
  await signIn(page);

  const title = `Published health ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title, description: "Published-version browser coverage." },
  });
  expect(created.status()).toBe(201);
  const { quiz } = (await created.json()) as { quiz: { id: string; draftRevision: number } };
  const draft = {
    title,
    description: "Published-version browser coverage.",
    questions: [
      {
        id: randomUUID(),
        type: "single_select",
        prompt: "Which check protects the existing workflow?",
        purpose: "diagnostic",
        confidence: "off",
        delivery: "main",
        conceptKeys: ["regression-testing"],
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
        choices: [
          { id: randomUUID(), label: "Run regression tests", isCorrect: true },
          { id: randomUUID(), label: "Skip existing checks", isCorrect: false },
        ],
      },
    ],
  };
  const prepared = await page.request.patch(`${apiUrl}/v1/quizzes/${quiz.id}`, {
    data: { draft, expectedDraftRevision: quiz.draftRevision },
  });
  expect(prepared.status()).toBe(200);
  const firstPublish = await page.request.post(`${apiUrl}/v1/quizzes/${quiz.id}/publish`, {
    data: { expectedDraftRevision: 1 },
  });
  expect(firstPublish.status()).toBe(200);

  const publishedPanel = () =>
    page
      .getByText("Question Health · published version (read-only)", { exact: true })
      .locator("..");
  async function reviewPublishedVersion() {
    const reviewTools = page.getByText("Question review", { exact: true }).locator("..");
    if (!(await reviewTools.evaluate((node) => (node as HTMLDetailsElement).open)))
      await reviewTools.locator(":scope > summary").click();
    await publishedPanel().locator("summary").first().click();
    await publishedPanel().getByRole("button", { name: "Review published version" }).click();
  }

  await page.goto(`/quiz/${quiz.id}`);
  await reviewPublishedVersion();
  await expect(publishedPanel()).toContainText("published v1");
  await expect(publishedPanel()).toContainText("Explanation missing");
  await expect(
    publishedPanel().getByRole("button", { name: /Prepare draft revision/i }),
  ).toHaveCount(0);

  const revisedDraft = {
    ...draft,
    questions: [
      {
        ...draft.questions[0]!,
        explanation: "Regression tests check that existing behavior still works.",
      },
    ],
  };
  const revised = await page.request.patch(`${apiUrl}/v1/quizzes/${quiz.id}`, {
    data: { draft: revisedDraft, expectedDraftRevision: 1 },
  });
  expect(revised.status()).toBe(200);
  await page.reload();
  await reviewPublishedVersion();
  await expect(publishedPanel()).toContainText("published v1");
  await expect(publishedPanel()).toContainText("Explanation missing");

  const secondPublish = await page.request.post(`${apiUrl}/v1/quizzes/${quiz.id}/publish`, {
    data: { expectedDraftRevision: 2 },
  });
  expect(secondPublish.status()).toBe(200);
  await page.reload();
  await reviewPublishedVersion();
  await expect(publishedPanel()).toContainText("published v2");
  await expect(publishedPanel()).not.toContainText("Explanation missing");
});
