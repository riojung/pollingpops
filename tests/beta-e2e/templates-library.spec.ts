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
        if (name === "Presentations") await expect(page.getByRole("article")).toHaveCount(9);
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
    await expect(round.locator("#starter-preview-source-evaluation")).toContainText(
      "Two articles make opposite claims. What is the most useful first comparison?",
    );
    // The preview is read-only; creation happens only after the explicit action.
    await expect(page).toHaveURL(/\/templates$/);
    await round.getByRole("button", { name: "Use this starter", exact: true }).click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
    const roundId = new URL(page.url()).pathname.split("/").at(-1);
    const roundResponse = await page.request.get(`${api}/v1/quizzes/${roundId}`);
    expect(roundResponse.ok()).toBe(true);
    const { quiz } = await roundResponse.json();
    expect(quiz.draft.title).toBe("Evidence worth trusting");
    expect(quiz.draft.questions).toHaveLength(2);
    expect(quiz.draft.questions[0].linkedRecheckQuestionId).toBe(quiz.draft.questions[1].id);

    await page.goto("/templates");
    await types.getByRole("tab", { name: "Surveys", exact: true }).click();
    await page.getByLabel("Search templates").fill("Event experience");
    const survey = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Event experience", exact: true }),
    });
    await survey.getByRole("button", { name: "Use this starter", exact: true }).click();
    await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
    const surveyId = new URL(page.url()).pathname.split("/").at(-1);
    const surveyResponse = await page.request.get(`${api}/v1/surveys/${surveyId}`);
    expect(surveyResponse.ok()).toBe(true);
    const storedSurvey = (await surveyResponse.json()).survey;
    expect(storedSurvey.draft.title).toBe("Event experience");
    expect(storedSurvey.draft.items).toHaveLength(4);
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
    expect(storedPresentation.draft.blocks).toHaveLength(5);
    expect(
      new Set(storedPresentation.draft.blocks.map((block: { id: string }) => block.id)).size,
    ).toBe(5);
  });
}
