import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}template library creates independent Round, Survey and Presentation drafts`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    await page.goto("/templates");
    const types = page.getByRole("tablist", { name: "Template types", exact: true });
    await expect(types.getByRole("tab", { name: "Rounds", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("article")).toHaveCount(36);
    for (const mode of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: mode });
      for (const name of ["Rounds", "Presentations", "Surveys"]) {
        await types.getByRole("tab", { name, exact: true }).click();
        await expect(types.getByRole("tab", { name, exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        if (name === "Presentations") {
          await expect(page.getByRole("article")).toHaveCount(21);
          await expect(page.locator('[data-template-collection="native"]')).toHaveCount(12);
          await expect(page.locator('[data-template-collection="facilitated"]')).toHaveCount(9);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${name} templates fit in ${mode} mode`,
        ).toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations, `${name} in ${mode}`).toEqual(
          [],
        );
      }
      await types.getByRole("tab", { name: "Presentations", exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`presentation-templates-${mode}.png`) });
    }

    await types.getByRole("tab", { name: "Rounds", exact: true }).click();
    await page.getByLabel("Search templates").fill("Evidence worth trusting");
    const round = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Evidence worth trusting", exact: true }),
    });
    await expect(round).toBeVisible();
    await round.getByRole("button", { name: "Preview questions", exact: true }).click();
    const roundPreview = page.locator("#starter-preview-source-evaluation");
    const sourceResponse = await page.request.get(
      `${api}/v1/starters/source-evaluation?locale=en-CA`,
    );
    expect(sourceResponse.ok()).toBe(true);
    const source = await sourceResponse.json();
    await expect(roundPreview).toContainText(source.draft.questions[0].prompt);
    await expect(roundPreview).toContainText(source.draft.questions[0].explanation);
    await expect(roundPreview).toContainText(source.guide.preparation);
    await expect(roundPreview.locator("input")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    // Preview does not create a draft or submit answers.
    await expect(page).toHaveURL(/\/templates$/);
    await roundPreview.getByRole("button", { name: "Close preview", exact: true }).click();
    await expect(
      round.getByRole("button", { name: "Preview questions", exact: true }),
    ).toBeFocused();
    await round.getByRole("button", { name: "Use this starter", exact: true }).click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
    const roundId = new URL(page.url()).pathname.split("/").at(-1);
    const roundResponse = await page.request.get(`${api}/v1/quizzes/${roundId}`);
    expect(roundResponse.ok()).toBe(true);
    const { quiz } = await roundResponse.json();
    expect(quiz.draft.title).toBe("Evidence worth trusting");
    expect(quiz.draft.questions).toHaveLength(6);
    const questionsById = new Map<string, { delivery: string }>(
      quiz.draft.questions.map((question: { id: string; delivery: string }) => [
        question.id,
        question,
      ]),
    );
    for (const question of quiz.draft.questions.filter(
      (item: { linkedRecheckQuestionId: string | null }) => item.linkedRecheckQuestionId,
    )) {
      expect(questionsById.get(question.linkedRecheckQuestionId)?.delivery).toBe("recheck");
    }
    expect(
      quiz.draft.questions.every((question: { purpose: string }) => question.purpose !== "opinion"),
    ).toBe(true);

    await page.goto("/templates");
    await types.getByRole("tab", { name: "Surveys", exact: true }).click();
    await page.getByLabel("Search templates").fill("Event experience");
    const survey = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Event experience", exact: true }),
    });
    await survey.getByRole("button", { name: "Preview questionnaire", exact: true }).click();
    const surveyPreview = page.locator("#starter-preview-event-feedback");
    const questionnaireResponse = await page.request.get(
      `${api}/v1/surveys/templates/event-feedback?locale=en-CA`,
    );
    expect(questionnaireResponse.ok()).toBe(true);
    const questionnaire = (await questionnaireResponse.json()).draft;
    await expect(surveyPreview).toContainText(questionnaire.description);
    await expect(surveyPreview).toContainText("Optional");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await surveyPreview.getByRole("button", { name: "Close preview", exact: true }).click();
    await survey.getByRole("button", { name: "Use this starter", exact: true }).click();
    await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
    const surveyId = new URL(page.url()).pathname.split("/").at(-1);
    const surveyResponse = await page.request.get(`${api}/v1/surveys/${surveyId}`);
    expect(surveyResponse.ok()).toBe(true);
    const storedSurvey = (await surveyResponse.json()).survey;
    expect(storedSurvey.draft.title).toBe("Event experience");
    expect(storedSurvey.draft.items).toHaveLength(8);
    expect(storedSurvey.draft.description).toBe(questionnaire.description);
    expect(storedSurvey.draft.items.map((item: { required: boolean }) => item.required)).toEqual(
      questionnaire.items.map((item: { required: boolean }) => item.required),
    );
    expect(
      storedSurvey.draft.items.every((item: { question: { type: string } }) =>
        ["poll", "rating"].includes(item.question.type),
      ),
    ).toBe(true);

    await page.goto("/templates");
    await types.getByRole("tab", { name: "Presentations", exact: true }).click();
    const presentation = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Project kickoff", exact: true }),
    });
    await presentation
      .getByRole("button", { name: "Use presentation template", exact: true })
      .click();
    await expect(page).toHaveURL(/\/presentation\/[0-9a-f-]+$/);
    const presentationId = new URL(page.url()).pathname.split("/").at(-1);
    const presentationResponse = await page.request.get(
      `${api}/v1/presentations/${presentationId}`,
    );
    expect(presentationResponse.ok()).toBe(true);
    const storedPresentation = (await presentationResponse.json()).presentation;
    expect(storedPresentation.draft.title).toBe("Project kickoff");
    expect(storedPresentation.draft.schemaVersion).toBe(2);
    expect(storedPresentation.draft.blocks).toHaveLength(5);
    expect(
      new Set(storedPresentation.draft.blocks.map((block: { id: string }) => block.id)).size,
    ).toBe(5);
  });
}
