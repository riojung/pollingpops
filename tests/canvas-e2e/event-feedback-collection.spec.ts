import { expect, test, type Locator, type Page } from "@playwright/test";
import type { QuizDraft, StarterGuide } from "@openround/contracts";
import type { SurveyDraft } from "@openround/contracts/surveys";
import { api, fits, organization } from "./support";

const collection = "event-feedback";
const collectionName = "Event feedback";
const members = {
  rounds: ["event-feedback", "training-feedback"],
  presentations: ["demo", "native-event-talk"],
  surveys: ["event-feedback"],
};
const required = [true, true, true, false, true, true, true, false];

async function expectCollection(page: Page, type: keyof typeof members) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/templates" &&
      url.searchParams.get("type") === type &&
      url.searchParams.get("collection") === collection,
  );
  await expect(page.getByRole("button", { name: collectionName, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(`#template-tab-${type}`)).toHaveAttribute("aria-selected", "true");
  const panel = page.locator(`#template-panel-${type}`);
  const cards = panel.locator("[data-template-id]");
  await expect(cards).toHaveCount(members[type].length);
  expect(
    await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-template-id")).sort(),
    ),
  ).toEqual(members[type]);
  const count =
    type === "presentations"
      ? "2 original templates"
      : `Matching templates: ${members[type].length}`;
  await expect(panel.getByText(count, { exact: true })).toBeVisible();
}

async function eventPreview(page: Page, type: "rounds" | "surveys") {
  const panel = page.locator(`#template-panel-${type}`);
  await panel
    .locator(`[data-template-id="${collection}"]`)
    .getByRole("button", {
      name: type === "rounds" ? "Preview questions" : "Preview questionnaire",
      exact: true,
    })
    .click();
  const preview = panel.locator(`#starter-preview-${collection}`);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("aria-busy", "false");
  return preview;
}

async function expectGuide(preview: Locator, guide: StarterGuide) {
  const details = preview.locator("details").filter({ hasText: "Template guide" });
  await expect(details).toHaveAttribute("open", "");
  await expect(details.locator("dd")).toHaveText([
    guide.audience,
    guide.preparation,
    guide.facilitation,
    guide.interpretation,
    guide.followUp,
  ]);
}

async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${api}${path}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

function waitForWrite(page: Page, method: string, path: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && new URL(response.url()).pathname === path,
  );
}

test("Event feedback keeps the shared Round and Survey starter distinct through preview and copy", async ({
  page,
}, info) => {
  await organization(page, info);
  const roundSourcePath = "/v1/starters/event-feedback?locale=en-CA";
  const surveySourcePath = "/v1/surveys/templates/event-feedback?locale=en-CA";
  const [round, survey] = await Promise.all([
    read<{ draft: QuizDraft; guide: StarterGuide }>(page, roundSourcePath),
    read<{ draft: SurveyDraft; guide: StarterGuide }>(page, surveySourcePath),
  ]);
  expect(round.draft.questions).toHaveLength(8);
  expect(round.guide.facilitation).not.toBe(survey.guide.facilitation);
  expect(round.guide.facilitation).toMatch(/each question.*clos(?:e|ing).*reveal/i);
  expect(survey.guide.interpretation).toMatch(
    /question.*only after.*clos(?:e|ing).*at least (?:5|five) finalized answers/i,
  );
  expect(survey.draft.items.map((item) => item.required)).toEqual(required);

  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      /^\/v1\/(starters\/[^/]+\/use|quizzes|presentations|surveys)(?:\/|$)/.test(path)
    )
      writes.push(`${request.method()} ${path}`);
  });

  await page.goto("/templates?type=rounds");
  await page.getByRole("button", { name: collectionName, exact: true }).click();
  await expectCollection(page, "rounds");
  const roundPreview = await eventPreview(page, "rounds");
  await expectGuide(roundPreview, round.guide);
  await expect(roundPreview.getByRole("heading", { level: 3 })).toHaveText(
    round.draft.questions.map((question) => question.prompt),
  );
  await expect(
    roundPreview.getByText(
      /skip (?:any )?optional questions|^(?:Optional|Required|Correct answer:)$/i,
    ),
  ).toHaveCount(0);

  await page.getByRole("tab", { name: "Presentations", exact: true }).click();
  await expectCollection(page, "presentations");
  await page
    .locator('[data-template-id="native-event-talk"]')
    .getByRole("button", {
      name: "Preview structure",
      exact: true,
    })
    .click();
  const presentationPreview = page.getByRole("dialog", { name: "Presentation template preview" });
  await expect(
    presentationPreview.getByText(
      "Read-only template preview. Example information is illustrative.",
    ),
  ).toBeVisible();
  await expect(
    presentationPreview.getByText(/full talk using the eight slides alone/i),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(presentationPreview).toHaveCount(0);

  await page.getByRole("tab", { name: "Surveys", exact: true }).click();
  await expectCollection(page, "surveys");
  const surveyPreview = await eventPreview(page, "surveys");
  await expectGuide(surveyPreview, survey.guide);
  await expect(surveyPreview.getByRole("heading", { level: 3 })).toHaveText(
    survey.draft.items.map((item) => item.question.prompt),
  );
  await expect(surveyPreview.getByText(/^(Required|Optional)$/)).toHaveText(
    required.map((item) => (item ? "Required" : "Optional")),
  );
  expect(writes).toEqual([]);

  await page.getByRole("tab", { name: "Rounds", exact: true }).click();
  await expectCollection(page, "rounds");
  const roundCopyPreview = await eventPreview(page, "rounds");
  const roundCopyPath = "/v1/starters/event-feedback/use";
  const roundCreated = waitForWrite(page, "POST", roundCopyPath);
  await roundCopyPreview.getByRole("button", { name: "Use this starter", exact: true }).click();
  expect((await roundCreated).status()).toBe(201);
  await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
  const roundId = new URL(page.url()).pathname.split("/").at(-1)!;
  const roundPath = `/v1/quizzes/${roundId}`;
  const { quiz } = await read<{ quiz: { id: string; status: string; draft: QuizDraft } }>(
    page,
    roundPath,
  );
  expect(quiz).toMatchObject({ id: roundId, status: "draft", draft: { title: round.draft.title } });
  expect(quiz.draft.questions).toMatchObject(
    round.draft.questions.map((question) => ({
      prompt: question.prompt,
      type: question.type,
      purpose: "opinion",
      basePoints: 0,
      delivery: "main",
    })),
  );
  await expect(page.locator("#prompt")).toBeEditable();

  await page.goBack();
  await page.getByRole("tab", { name: "Surveys", exact: true }).click();
  await expectCollection(page, "surveys");
  const surveyCopyPreview = await eventPreview(page, "surveys");
  const surveyCreated = waitForWrite(page, "POST", "/v1/surveys");
  await surveyCopyPreview.getByRole("button", { name: "Use this starter", exact: true }).click();
  const surveyResponse = await surveyCreated;
  expect(surveyResponse.status()).toBe(201);
  expect(surveyResponse.request().postDataJSON()).toMatchObject({ templateId: collection });
  await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
  const surveyId = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(surveyId).not.toBe(roundId);
  const surveyPath = `/v1/surveys/${surveyId}`;
  const { survey: copiedSurvey } = await read<{
    survey: { id: string; status: string; draft: SurveyDraft };
  }>(page, surveyPath);
  expect(copiedSurvey).toMatchObject({
    id: surveyId,
    status: "draft",
    draft: { title: survey.draft.title },
  });
  expect(copiedSurvey.draft.items).toMatchObject(
    survey.draft.items.map(({ required, question }) => ({
      required,
      question: { prompt: question.prompt, type: question.type },
    })),
  );
  expect(writes).toEqual([`POST ${roundCopyPath}`, "POST /v1/surveys"]);

  const surveyTitle = page.getByRole("textbox", { name: "Title", exact: true });
  const editedTitle = "Our event follow-up survey";
  const saved = waitForWrite(page, "PUT", surveyPath);
  await surveyTitle.fill(editedTitle);
  expect((await saved).ok()).toBe(true);
  expect(
    (await read<{ survey: { draft: SurveyDraft } }>(page, surveyPath)).survey.draft.title,
  ).toBe(editedTitle);
  expect((await read<{ quiz: { draft: QuizDraft } }>(page, roundPath)).quiz.draft).toEqual(
    quiz.draft,
  );
  expect((await read<{ draft: SurveyDraft }>(page, surveySourcePath)).draft).toEqual(survey.draft);
});

test("Event feedback fits among all five collection choices at 320px @mobile", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await organization(page, info);
  await page.goto("/templates?type=rounds");

  const selector = page.getByRole("group", { name: "Collection", exact: true });
  const choices = selector.getByRole("button");
  await expect(choices).toHaveCount(5);
  await expect(choices).toHaveText([
    "All templates",
    "Team meetings",
    "Training and onboarding",
    "Workshops",
    collectionName,
  ]);
  for (const choice of await choices.all()) {
    await expect(choice).toBeVisible();
    const box = (await choice.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }

  await selector.getByRole("button", { name: collectionName, exact: true }).tap();
  await expectCollection(page, "rounds");
  const choose = page.getByRole("combobox", { name: "Choose a template", exact: true });
  await choose.selectOption(collection);
  await expect(page.locator(`#starter-preview-${collection} details summary`)).toHaveText(
    "Template guide",
  );
  await fits(page);

  const all = selector.getByRole("button", { name: "All templates", exact: true });
  await all.tap();
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/templates\?type=rounds$/);
  await fits(page);
});
