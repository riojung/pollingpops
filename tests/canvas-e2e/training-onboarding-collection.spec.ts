import { expect, test, type APIResponse, type Locator, type Page } from "@playwright/test";
import { api, fits, organization } from "./support";

const collection = "training-onboarding";
const title = "Training and onboarding";
const members = {
  rounds: ["new-hire-knowledge-check", "feedback-skills"],
  presentations: ["training", "onboarding"],
  surveys: ["onboarding-experience"],
} as const;

type TemplateType = keyof typeof members;

function catalog(type: TemplateType) {
  return `/templates?type=${type}&collection=${collection}`;
}

function collectionButton(page: Page) {
  return page.getByRole("button", { name: title, exact: true });
}

function card(page: Page, id: string) {
  return page.locator(`[data-template-id="${id}"]`);
}

async function expectCollection(page: Page, type: TemplateType) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/templates" &&
      url.searchParams.get("type") === type &&
      url.searchParams.get("collection") === collection &&
      url.searchParams.get("campaign") === "training",
  );
  await expect(collectionButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`#template-tab-${type}`)).toHaveAttribute("aria-selected", "true");
  const cards = page.locator(`#template-panel-${type} [data-template-id]`);
  await expect(cards).toHaveCount(members[type].length);
  expect(
    await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-template-id"))),
  ).toEqual(expect.arrayContaining([...members[type]]));
}

async function starterPreview(page: Page, id: string) {
  const preview = page.locator(`#starter-preview-${id}`);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("aria-busy", "false");
  return preview;
}

async function expectGuide(preview: Locator) {
  const guide = preview.locator("details").filter({ hasText: "Template guide" });
  await expect(guide.locator("summary")).toHaveText("Template guide");
  await expect(guide).toHaveAttribute("open", "");
  await expect(guide.locator("dd")).toHaveText(Array<RegExp>(5).fill(/\S/));
}

async function json(response: Promise<APIResponse>) {
  const value = await response;
  expect(value.ok(), await value.text()).toBe(true);
  return value.json();
}

test("Training and onboarding filters each format and keeps URL history", async ({
  page,
}, info) => {
  await organization(page, info);
  await page.goto("/templates?type=rounds&campaign=training");
  const training = collectionButton(page);
  await expect(card(page, "new-hire-knowledge-check")).toBeAttached();
  await training.press("Space");
  await expectCollection(page, "rounds");

  await page.locator("#template-tab-rounds").press("ArrowRight");
  await expectCollection(page, "presentations");
  await expect(page.locator("#template-tab-presentations")).toBeFocused();
  await page.locator("#template-tab-presentations").press("ArrowRight");
  await expectCollection(page, "surveys");

  await page.reload();
  await expectCollection(page, "surveys");
  await page.getByRole("button", { name: "Team meetings", exact: true }).click();
  await expect(training).toHaveAttribute("aria-pressed", "false");
  await expect(card(page, "team-collaboration")).toBeVisible();
  await expect(card(page, "onboarding-experience")).toHaveCount(0);
  await page.goBack();
  await expectCollection(page, "surveys");

  await page.locator("#template-tab-designs").click();
  await expect(page).toHaveURL(/\/templates\?type=designs&campaign=training$/);
  await expect(training).toHaveAttribute("aria-pressed", "false");
  await training.click();
  await expectCollection(page, "rounds");
});

test("Training and onboarding creates independent editable drafts for each format", async ({
  page,
}, info) => {
  await organization(page, info);
  const posts: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      /^\/v1\/(starters\/[^/]+\/use|quizzes|presentations|surveys)$/.test(path)
    )
      posts.push(path);
  });

  await page.goto(catalog("rounds"));
  const roundCard = card(page, "new-hire-knowledge-check");
  await roundCard.getByRole("button", { name: "Preview questions", exact: true }).click();
  const roundPreview = await starterPreview(page, "new-hire-knowledge-check");
  await expectGuide(roundPreview);
  const roundTitle = await roundPreview.getByRole("heading", { level: 2 }).innerText();
  expect(posts).toEqual([]);
  await roundPreview.getByRole("button", { name: "Use this starter", exact: true }).click();
  await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
  const roundId = new URL(page.url()).pathname.split("/").at(-1);
  const { quiz } = await json(page.request.get(`${api}/v1/quizzes/${roundId}`));
  expect(quiz).toMatchObject({ id: roundId, status: "draft", draft: { title: roundTitle } });
  await expect(page.locator("#prompt")).toBeEditable();
  expect(posts).toEqual(["/v1/starters/new-hire-knowledge-check/use"]);

  await page.goto(catalog("presentations"));
  const deckCard = card(page, "training");
  const deckTrigger = deckCard.getByRole("button", { name: "Preview structure", exact: true });
  await deckTrigger.press("Enter");
  const deckPreview = page.getByRole("dialog", { name: "Presentation template preview" });
  await expectGuide(deckPreview);
  const deckTitle = await deckPreview.getByRole("heading", { level: 2 }).innerText();
  await page.keyboard.press("Escape");
  await expect(deckPreview).toHaveCount(0);
  await expect(deckTrigger).toBeFocused();
  expect(posts).toEqual(["/v1/starters/new-hire-knowledge-check/use"]);
  await deckCard.getByRole("button", { name: "Use presentation template", exact: true }).click();
  await expect(page).toHaveURL(/\/presentation\/[0-9a-f-]+$/);
  const deckId = new URL(page.url()).pathname.split("/").at(-1);
  const { presentation } = await json(page.request.get(`${api}/v1/presentations/${deckId}`));
  expect(presentation).toMatchObject({ id: deckId, status: "draft", draft: { title: deckTitle } });
  await expect(
    page.getByRole("textbox", { name: "Presentation title", exact: true }),
  ).toBeEditable();
  expect(posts).toEqual(["/v1/starters/new-hire-knowledge-check/use", "/v1/presentations"]);

  await page.goto(catalog("surveys"));
  const surveySourceUrl = `${api}/v1/surveys/templates/onboarding-experience?locale=en-CA`;
  const sourceTitle = (await json(page.request.get(surveySourceUrl))).draft.title;
  const surveyPreview = await starterPreview(page, "onboarding-experience");
  await expectGuide(surveyPreview);
  await expect(surveyPreview.getByRole("heading", { level: 2 })).toHaveText(sourceTitle);
  expect(posts).toEqual(["/v1/starters/new-hire-knowledge-check/use", "/v1/presentations"]);
  await surveyPreview.getByRole("button", { name: "Use this starter", exact: true }).click();
  await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
  const surveyId = new URL(page.url()).pathname.split("/").at(-1);
  const surveyUrl = `${api}/v1/surveys/${surveyId}`;
  const { survey } = await json(page.request.get(surveyUrl));
  expect(survey).toMatchObject({ id: surveyId, status: "draft", draft: { title: sourceTitle } });
  const editedTitle = `${sourceTitle} — my team copy`;
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(editedTitle);
  await expect(page.getByRole("status").filter({ hasText: /^Saved\.$/ })).toBeVisible();
  expect((await json(page.request.get(surveyUrl))).survey.draft.title).toBe(editedTitle);
  expect((await json(page.request.get(surveySourceUrl))).draft.title).toBe(sourceTitle);
  expect(posts).toEqual([
    "/v1/starters/new-hire-knowledge-check/use",
    "/v1/presentations",
    "/v1/surveys",
  ]);
});

test("Training and onboarding guides fit a narrow template gallery @mobile", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await organization(page, info);
  await page.goto("/templates?type=rounds&campaign=training");
  const training = collectionButton(page);
  await expect(card(page, "new-hire-knowledge-check")).toBeAttached();
  await training.tap();
  await expectCollection(page, "rounds");
  expect((await training.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  const choose = page.getByRole("combobox", { name: "Choose a template", exact: true });
  await expect(choose).toBeVisible();
  await choose.selectOption("feedback-skills");
  await expectGuide(await starterPreview(page, "feedback-skills"));
  await fits(page);

  await page.locator("#template-tab-presentations").tap();
  await expectCollection(page, "presentations");
  await card(page, "onboarding")
    .getByRole("button", { name: "Preview structure", exact: true })
    .tap();
  const preview = page.getByRole("dialog", { name: "Presentation template preview" });
  await expectGuide(preview);
  await fits(page);
  await preview.getByRole("button", { name: "Close preview", exact: true }).tap();

  await page.locator("#template-tab-surveys").tap();
  await expectCollection(page, "surveys");
  await expect(choose).toHaveValue("onboarding-experience");
  await expectGuide(await starterPreview(page, "onboarding-experience"));
  await fits(page);
});
