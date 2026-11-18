import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIResponse,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { QuizDraft, StarterGuide } from "@openround/contracts";
import type { SurveyDraft } from "@openround/contracts/surveys";
import { signInCreator } from "../support/creator-auth";
import { testEmail } from "../e2e/test-email";
import { api, fits, organization, web } from "./support";

const collection = "team-meetings";
const roundIds = ["meeting-priorities", "team-retrospective"];
const presentationIds = ["meeting", "retrospective"];
const campaign = "wx04 smoke";
const modes = [
  { name: "light", colorScheme: "light", forcedColors: "none" },
  { name: "dark", colorScheme: "dark", forcedColors: "none" },
  { name: "forced-colors", colorScheme: "light", forcedColors: "active" },
] as const;

async function result(response: Promise<APIResponse>, status = 200) {
  const value = await response;
  expect(value.status(), await value.text()).toBe(status);
  return value.json();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function inventory(page: Page, kind: "surveys" | "presentations") {
  const rows = (await result(page.request.get(`${api}/v1/${kind}`)))[kind] as { id: string }[];
  return rows.map((row) => row.id);
}

function contentWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      /^\/v1\/(?:starters\/[^/]+\/use|quizzes|presentations|surveys)(?:\/|$)/.test(path)
    )
      writes.push(`${request.method()} ${path}`);
  });
  return writes;
}

async function urlState(page: Page, type: string, selected: string | null) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/templates" &&
      url.searchParams.get("type") === type &&
      url.searchParams.get("collection") === selected &&
      url.searchParams.get("campaign") === campaign,
  );
  await expect(page.locator(`#template-tab-${type}`)).toHaveAttribute("aria-selected", "true");
}

async function cards(page: Page, type: string, ids: string[]) {
  const items = page.locator(`#template-panel-${type} [data-template-id]`);
  await expect(items).toHaveCount(ids.length);
  expect(
    await items.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-template-id")).sort(),
    ),
  ).toEqual([...ids].sort());
}

async function previewStarter(page: Page, id: string, mobile: boolean, survey = false) {
  let revealsSelection = false;
  if (mobile)
    await page.getByRole("combobox", { name: "Choose a template", exact: true }).selectOption(id);
  else {
    const trigger = page.locator(`[data-template-id="${id}"]`).getByRole("button", {
      name: survey ? "Preview questionnaire" : "Preview questions",
      exact: true,
    });
    revealsSelection = (await trigger.getAttribute("aria-pressed")) !== "true";
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-pressed", "true");
    if (!revealsSelection) await expect(trigger).toBeFocused();
  }
  const preview = page.locator(`#starter-preview-${id}`);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("aria-busy", "false");
  if (revealsSelection) await expect(preview.locator(`#starter-preview-title-${id}`)).toBeFocused();
  return preview;
}

async function authoritativeGuide(preview: Locator, guide: StarterGuide) {
  const details = preview.locator("details").filter({ has: preview.page().locator("dl") });
  await expect(details).toHaveCount(1);
  await expect(details).toHaveAttribute("open", "");
  await expect(details.locator("dd")).toHaveText([
    guide.audience,
    guide.preparation,
    guide.facilitation,
    guide.interpretation,
    guide.followUp,
  ]);
}

// Catalog reads generate fresh nested IDs. Preserve all authored fields while normalizing IDs.
function authoredContent(draft: QuizDraft | SurveyDraft) {
  const questions =
    "questions" in draft ? draft.questions : draft.items.map((item) => item.question);
  const positions = new Map(questions.map((question, index) => [question.id, index]));
  return JSON.parse(
    JSON.stringify(draft, (key, value: unknown) => {
      if (key === "id") return undefined;
      if (key === "linkedRecheckQuestionId" && typeof value === "string")
        return positions.has(value) ? `question:${positions.get(value)}` : `unknown:${value}`;
      return value;
    }),
  );
}

async function audit(page: Page, selectors: string[]) {
  await fits(page);
  let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  for (const selector of selectors) axe = axe.include(selector);
  expect((await axe.analyze()).violations).toEqual([]);
}

async function waitForSubtlePalette(page: Page, text: Locator) {
  // Resolve the current token through the browser so forced colors and each real
  // palette remain authoritative. Appending a fresh node also fences WebKit's
  // delayed propagation of inherited colors after an appearance change.
  const expected = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-text-subtle)";
    document.documentElement.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(text).toHaveCSS("color", expected);
}

async function frameScreenshot(page: Page, subject: Locator) {
  const banner = await page.getByRole("banner").boundingBox();
  await subject.evaluate(
    (node, offset) => {
      window.scrollTo({
        top: node.getBoundingClientRect().top + window.scrollY - offset,
        behavior: "instant",
      });
    },
    (banner?.height ?? 0) + 12,
  );
}

async function collectionAppearance(page: Page, info: TestInfo, mobile: boolean) {
  // Audit every requested combination; retain three representative images per browser.
  for (const width of mobile ? [390, 320] : [1440]) {
    await page.setViewportSize({ width, height: mobile ? 844 : 1000 });
    for (const mode of modes) {
      await page.emulateMedia({ colorScheme: mode.colorScheme, forcedColors: mode.forcedColors });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode.colorScheme);
      await waitForSubtlePalette(page, page.locator("#template-panel-rounds label > span").first());
      for (const button of await page.locator("[data-collection]").all())
        expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await audit(page, ["[data-template-collection='team-meetings']", "#template-panel-rounds"]);
      if (!mobile || (width === 390 ? mode.name === "light" : mode.name !== "light")) {
        await frameScreenshot(page, page.locator("section[data-template-collection]"));
        await page.screenshot({
          path: info.outputPath(`collection-${width}-${mode.name}.png`),
          scale: "css",
        });
      }
    }
  }
  await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
}

for (const mobile of [false, true]) {
  const suffix = mobile ? " @mobile" : "";

  test(`Team meeting Survey pending copy survives a collection switch${suffix}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: mobile ? 320 : 1440, height: mobile ? 844 : 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await organization(page, info);
    const before = await inventory(page, "surveys");
    const accepted = deferred();
    const release = deferred();
    const bodies: string[] = [];
    let createdId = "";
    await page.route(`${api}/v1/surveys`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      bodies.push(route.request().postData()!);
      const response = await route.fetch();
      expect(response.status(), await response.text()).toBe(201);
      if (bodies.length === 1) {
        createdId = (await response.json()).survey.id;
        accepted.resolve();
        await release.promise;
      }
      return route.fulfill({ response });
    });
    try {
      await page.goto(`/templates?collection=${collection}&type=surveys&campaign=wx04%20smoke`);
      let preview = await previewStarter(page, "team-collaboration", mobile, true);
      await preview.getByRole("button", { name: "Use this starter", exact: true }).click();
      await accepted.promise;
      expect((await inventory(page, "surveys")).filter((id) => !before.includes(id))).toEqual([
        createdId,
      ]);

      await page.locator("[data-collection='all']").click();
      await urlState(page, "surveys", null);
      preview = await previewStarter(page, "team-collaboration", mobile, true);
      const creating = preview.getByRole("button", { name: "Creating…", exact: true });
      await expect(creating).toBeDisabled();
      expect(bodies).toHaveLength(1);
      expect((await inventory(page, "surveys")).filter((id) => !before.includes(id))).toEqual([
        createdId,
      ]);

      release.resolve();
      await expect(page).toHaveURL(`${web}/surveys/${createdId}`);
      await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeEditable();
      expect(bodies).toHaveLength(1);
      expect((await inventory(page, "surveys")).filter((id) => !before.includes(id))).toEqual([
        createdId,
      ]);
    } finally {
      release.resolve();
    }
  });

  test(`Team meeting Survey lost acknowledgement retries exactly after a collection switch${suffix}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: mobile ? 320 : 1440, height: mobile ? 844 : 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await organization(page, info);
    const before = await inventory(page, "surveys");
    const bodies: string[] = [];
    let createdId = "";
    await page.route(`${api}/v1/surveys`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      bodies.push(route.request().postData()!);
      const response = await route.fetch();
      expect(response.status(), await response.text()).toBe(201);
      if (bodies.length === 1) {
        createdId = (await response.json()).survey.id;
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "INTERNAL_ERROR",
              message: "Synthetic lost Survey acknowledgement",
              requestId: "collection-survey-retry",
            },
          },
        });
      }
      return route.fulfill({ response });
    });
    await page.goto("/templates?type=surveys&campaign=wx04%20smoke");
    let preview = await previewStarter(page, "team-collaboration", mobile, true);
    await preview.getByRole("button", { name: "Use this starter", exact: true }).click();
    await expect(preview.getByRole("alert")).toBeVisible();
    expect((await inventory(page, "surveys")).filter((id) => !before.includes(id))).toEqual([
      createdId,
    ]);
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      idempotencyKey: expect.any(String),
      templateId: "team-collaboration",
      locale: "en-CA",
    });

    await page.locator("[data-collection='team-meetings']").click();
    await urlState(page, "surveys", collection);
    preview = await previewStarter(page, "team-collaboration", mobile, true);
    const retry = preview.getByRole("button", { name: "Use this starter", exact: true });
    await expect(retry).toBeEnabled();
    expect(bodies).toHaveLength(1);
    await retry.click();
    await expect(page).toHaveURL(`${web}/surveys/${createdId}`);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect((await inventory(page, "surveys")).filter((id) => !before.includes(id))).toEqual([
      createdId,
    ]);
  });

  test(`Team meeting Presentation accepted save retries exactly after a collection switch${suffix}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: mobile ? 320 : 1440, height: mobile ? 844 : 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await organization(page, info);
    const before = await inventory(page, "presentations");
    const accepted = deferred();
    const release = deferred();
    const writes = contentWrites(page);
    const saves: { path: string; body: string }[] = [];
    let createdId = "";
    await page.route(`${api}/v1/presentations/*/draft`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      saves.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postData()!,
      });
      const response = await route.fetch();
      expect(response.status(), await response.text()).toBe(200);
      if (saves.length === 1) {
        createdId = saves[0]!.path.split("/").at(-2)!;
        accepted.resolve();
        await release.promise;
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "INTERNAL_ERROR",
              message: "Synthetic lost Presentation save acknowledgement",
              requestId: "collection-presentation-retry",
            },
          },
        });
      }
      return route.fulfill({ response });
    });
    try {
      await page.goto(
        `/templates?collection=${collection}&type=presentations&campaign=wx04%20smoke`,
      );
      const card = page.locator('[data-template-id="meeting"]');
      await card.getByRole("button", { name: "Use presentation template", exact: true }).click();
      await accepted.promise;
      const saved = (await result(page.request.get(`${api}/v1/presentations/${createdId}`)))
        .presentation;
      expect(saved.draft).toEqual(JSON.parse(saves[0]!.body).draft);
      expect((await inventory(page, "presentations")).filter((id) => !before.includes(id))).toEqual(
        [createdId],
      );

      await page.locator("[data-collection='all']").click();
      await urlState(page, "presentations", null);
      await expect(
        card.getByRole("button", { name: "Creating presentation…", exact: true }),
      ).toBeDisabled();
      expect(writes.filter((write) => write === "POST /v1/presentations")).toHaveLength(1);
      expect(saves).toHaveLength(1);
      release.resolve();
      await expect(page.locator("#template-panel-presentations").getByRole("alert")).toBeVisible();
      await card.getByRole("button", { name: "Use presentation template", exact: true }).click();
      await expect(page).toHaveURL(`${web}/presentation/${createdId}`);
      expect(saves).toHaveLength(2);
      expect(saves[1]).toEqual(saves[0]);
      expect(writes.filter((write) => write === "POST /v1/presentations")).toHaveLength(1);
      expect((await inventory(page, "presentations")).filter((id) => !before.includes(id))).toEqual(
        [createdId],
      );
    } finally {
      release.resolve();
    }
  });

  test(`Team meetings collection keeps exact format membership and URL history${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: mobile ? 390 : 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await organization(page, info);
    const writes = contentWrites(page);
    await page.goto(`/templates?collection=${collection}&type=rounds&campaign=wx04%20smoke`);
    const header = page.locator("section[data-template-collection]");
    await expect(header).toHaveAttribute("data-template-collection", collection);
    await expect(header.locator("[data-collection='team-meetings']")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(header.locator("[data-collection='all']")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await cards(page, "rounds", roundIds);
    if (mobile)
      await expect(
        page
          .getByRole("combobox", { name: "Choose a template", exact: true })
          .locator("option:not([disabled])"),
      ).toHaveCount(2);
    for (const id of roundIds)
      await expect(page.locator(`[data-template-id="${id}"]`)).toContainText("4 questions");
    await collectionAppearance(page, info, mobile);

    const rounds = page.locator("#template-tab-rounds");
    await rounds.focus();
    await rounds.press("ArrowRight");
    await urlState(page, "presentations", collection);
    await expect(page.locator("#template-tab-presentations")).toBeFocused();
    await cards(page, "presentations", presentationIds);
    await expect(page.locator('[data-template-id="meeting"]')).toContainText(
      "Audience activities: 2",
    );
    await expect(page.locator('[data-template-id="retrospective"]')).toContainText(
      "Audience activities: 3",
    );
    await page.locator("#template-tab-surveys").click();
    await urlState(page, "surveys", collection);
    await cards(page, "surveys", ["team-collaboration"]);
    await page.reload();
    await urlState(page, "surveys", collection);
    await cards(page, "surveys", ["team-collaboration"]);
    await page.goBack();
    await urlState(page, "presentations", collection);
    await page.goBack();
    await urlState(page, "rounds", collection);
    await cards(page, "rounds", roundIds);
    await page.goForward();
    await urlState(page, "presentations", collection);

    await header.locator("[data-collection='all']").click();
    await urlState(page, "presentations", null);
    await expect(header).toHaveAttribute("data-template-collection", "all");
    await expect(
      page.locator("#template-panel-presentations [data-template-id]").first(),
    ).toBeAttached();
    await expect(page.locator("#template-panel-presentations [data-template-id]")).not.toHaveCount(
      2,
    );
    await header.locator("[data-collection='team-meetings']").click();
    await urlState(page, "presentations", collection);
    await cards(page, "presentations", presentationIds);
    await page.locator("#template-tab-designs").click();
    await urlState(page, "designs", null);
    await expect(header).toHaveAttribute("data-template-collection", "all");
    await header.locator("[data-collection='team-meetings']").click();
    await urlState(page, "rounds", collection);
    await cards(page, "rounds", roundIds);
    await header.locator("[data-collection='all']").click();
    await urlState(page, "rounds", null);
    await expect
      .poll(() => page.locator("#template-panel-rounds [data-template-id]").count())
      .toBeGreaterThan(2);
    const allRoundIds = await page
      .locator("#template-panel-rounds [data-template-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-template-id")).sort());
    expect(allRoundIds.length).toBeGreaterThan(2);
    await page.goto("/templates?collection=unknown&type=rounds&campaign=wx04%20smoke");
    await expect(header).toHaveAttribute("data-template-collection", "all");
    await expect(header.locator("[data-collection='all']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#template-panel-rounds [data-template-id]")).toHaveCount(
      allRoundIds.length,
    );
    expect(
      await page
        .locator("#template-panel-rounds [data-template-id]")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-template-id")).sort()),
    ).toEqual(allRoundIds);

    // A CJK UI still uses the same collection identity and the authoritative localized preview.
    await result(page.request.put(`${api}/v1/account/locale`, { data: { locale: "ko-KR" } }));
    await page
      .context()
      .addCookies([{ name: "openround-locale", value: "ko-KR", url: web, sameSite: "Lax" }]);
    await page.goto(`/templates?collection=${collection}&type=rounds`);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
    await expect(header.locator("[data-collection='team-meetings']")).toContainText(/[가-힣]/);
    await cards(page, "rounds", roundIds);
    if (mobile) await page.setViewportSize({ width: 320, height: 844 });
    const localized = await result(
      page.request.get(`${api}/v1/starters/meeting-priorities?locale=ko-KR`),
    );
    if (mobile)
      await page
        .locator("#template-panel-rounds select")
        .filter({
          has: page.locator('option[value="meeting-priorities"]'),
        })
        .selectOption("meeting-priorities");
    else await page.locator('[data-template-id="meeting-priorities"] button').click();
    const localizedPreview = page.locator("#starter-preview-meeting-priorities");
    await expect(localizedPreview).toHaveAttribute("aria-busy", "false");
    await expect(localizedPreview).toContainText(localized.draft.questions[0].prompt);
    await authoritativeGuide(localizedPreview, localized.guide);
    await audit(page, ["section[data-template-collection]", "#template-panel-rounds"]);
    await frameScreenshot(page, localizedPreview);
    await page.screenshot({ path: info.outputPath("collection-ko-KR.png"), scale: "css" });
    expect(writes).toEqual([]);
  });

  test(`Team meeting Round and Survey previews use real guides and create independent editable copies${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: mobile ? 320 : 1440, height: mobile ? 844 : 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await organization(page, info);
    const roundSources = await Promise.all(
      roundIds.map((id) => result(page.request.get(`${api}/v1/starters/${id}?locale=en-CA`))),
    );
    for (const source of roundSources) {
      expect(source.draft.questions).toHaveLength(4);
      expect(
        source.draft.questions.every(
          (question: { purpose: string }) => question.purpose === "opinion",
        ),
      ).toBe(true);
    }
    const roundSource = roundSources[0] as { draft: QuizDraft; guide: StarterGuide };
    const surveySourceUrl = `${api}/v1/surveys/templates/team-collaboration?locale=en-CA`;
    const surveySource = (await result(page.request.get(surveySourceUrl))) as {
      draft: SurveyDraft;
      guide: StarterGuide;
    };
    expect(surveySource.draft.items).toHaveLength(4);
    expect(surveySource.draft.items[2]!.required).toBe(false);
    const beforeRounds = (await result(page.request.get(`${api}/v1/quizzes`))).quizzes.map(
      (row: { id: string }) => row.id,
    ) as string[];
    const beforeSurveys = (await result(page.request.get(`${api}/v1/surveys`))).surveys.map(
      (row: { id: string }) => row.id,
    ) as string[];
    const writes = contentWrites(page);
    await page.goto(`/templates?collection=${collection}&type=rounds`);
    for (const [index, id] of roundIds.entries()) {
      const preview = await previewStarter(page, id, mobile);
      await authoritativeGuide(preview, roundSources[index].guide);
      await expect(preview.locator("ol > li")).toHaveCount(4);
      for (const question of roundSources[index].draft.questions)
        await expect(
          preview.getByRole("heading", { name: question.prompt, exact: true }),
        ).toBeVisible();
      await expect(preview.locator("ol").getByText(/^Correct answer:/)).toHaveCount(0);
      await expect(preview.locator("input, textarea")).toHaveCount(0);
    }
    expect(writes).toEqual([]);
    expect(
      (await result(page.request.get(`${api}/v1/quizzes`))).quizzes.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual(beforeRounds);
    const roundPreview = await previewStarter(page, roundIds[0]!, mobile);
    await audit(page, ["#template-panel-rounds"]);
    await roundPreview.getByRole("button", { name: "Use this starter", exact: true }).click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
    const roundId = new URL(page.url()).pathname.split("/").at(-1)!;
    const round = (await result(page.request.get(`${api}/v1/quizzes/${roundId}`))).quiz;
    expect(round.status).toBe("draft");
    expect(authoredContent(round.draft)).toEqual(authoredContent(roundSource.draft));
    const sourceQuestionIds = new Set(roundSource.draft.questions.map((question) => question.id));
    expect(
      round.draft.questions.every(
        (question: { id: string }) => !sourceQuestionIds.has(question.id),
      ),
    ).toBe(true);
    const newPrompt = `${roundSource.draft.questions[0]!.prompt} — adapted team copy`;
    const roundSaved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/v1/quizzes/${roundId}/draft`,
    );
    await expect(page.locator("#prompt")).toBeEditable();
    await page.locator("#prompt").fill(newPrompt);
    expect((await roundSaved).ok()).toBe(true);
    await expect(page.locator('header [data-state="saved"]')).toBeVisible();
    expect(
      (await result(page.request.get(`${api}/v1/quizzes/${roundId}`))).quiz.draft.questions[0]
        .prompt,
    ).toBe(newPrompt);
    expect(
      authoredContent(
        (await result(page.request.get(`${api}/v1/starters/meeting-priorities?locale=en-CA`)))
          .draft,
      ),
    ).toEqual(authoredContent(roundSource.draft));

    await page.goto(`/templates?collection=${collection}&type=surveys`);
    const surveyPreview = await previewStarter(page, "team-collaboration", mobile, true);
    await authoritativeGuide(surveyPreview, surveySource.guide);
    const items = surveyPreview.locator("ol > li");
    await expect(items).toHaveCount(4);
    await expect(items.nth(2)).toContainText("Optional");
    for (const item of surveySource.draft.items)
      await expect(
        surveyPreview.getByRole("heading", { name: item.question.prompt, exact: true }),
      ).toBeVisible();
    expect(
      (await result(page.request.get(`${api}/v1/surveys`))).surveys.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual(beforeSurveys);
    expect(writes.filter((write) => write.startsWith("POST "))).toEqual([
      "POST /v1/starters/meeting-priorities/use",
    ]);
    await audit(page, ["#template-panel-surveys"]);
    await surveyPreview.getByRole("button", { name: "Use this starter", exact: true }).click();
    await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
    const surveyId = new URL(page.url()).pathname.split("/").at(-1)!;
    const survey = (await result(page.request.get(`${api}/v1/surveys/${surveyId}`))).survey;
    expect(survey.status).toBe("draft");
    expect(authoredContent(survey.draft)).toEqual(authoredContent(surveySource.draft));
    const sourceSurveyIds = new Set(surveySource.draft.items.map((item) => item.question.id));
    expect(
      survey.draft.items.every(
        (item: { question: { id: string } }) => !sourceSurveyIds.has(item.question.id),
      ),
    ).toBe(true);
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await expect(title).toBeEditable();
    const surveySaved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/v1/surveys/${surveyId}`,
    );
    await title.fill(`${surveySource.draft.title} — adapted team copy`);
    expect((await surveySaved).ok()).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: /^Saved\.$/ })).toBeVisible();
    expect(
      (await result(page.request.get(`${api}/v1/surveys/${surveyId}`))).survey.draft.title,
    ).toBe(`${surveySource.draft.title} — adapted team copy`);
    expect(authoredContent((await result(page.request.get(surveySourceUrl))).draft)).toEqual(
      authoredContent(surveySource.draft),
    );
    expect(
      (await result(page.request.get(`${api}/v1/quizzes`))).quizzes
        .filter((row: { id: string }) => !beforeRounds.includes(row.id))
        .map((row: { id: string }) => row.id),
    ).toEqual([roundId]);
    expect(
      (await result(page.request.get(`${api}/v1/surveys`))).surveys
        .filter((row: { id: string }) => !beforeSurveys.includes(row.id))
        .map((row: { id: string }) => row.id),
    ).toEqual([surveyId]);
    expect(writes.filter((write) => write.startsWith("POST "))).toEqual([
      "POST /v1/starters/meeting-priorities/use",
      "POST /v1/surveys",
    ]);
  });

  test(`Team meeting Presentation guides match actual slides and create an editable deck${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: mobile ? 320 : 1440, height: mobile ? 844 : 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await organization(page, info);
    const before = (await result(page.request.get(`${api}/v1/presentations`))).presentations.map(
      (row: { id: string }) => row.id,
    ) as string[];
    const writes = contentWrites(page);
    await page.goto(`/templates?collection=${collection}&type=presentations`);
    await cards(page, "presentations", presentationIds);
    for (const [id, total, activities, minutes] of [
      ["meeting", 5, 2, 20],
      ["retrospective", 6, 3, 25],
    ] as const) {
      const card = page.locator(`[data-template-id="${id}"]`);
      await expect(card).toContainText(`Content slides: ${total - activities}`);
      await expect(card).toContainText(`Audience activities: ${activities}`);
      await expect(card).toContainText(`About ${minutes} min`);
      const trigger = card.getByRole("button", { name: "Preview structure", exact: true });
      await trigger.click();
      const preview = page.getByRole("dialog", {
        name: "Presentation template preview",
        exact: true,
      });
      await expect(preview).toBeVisible();
      const guide = preview.locator("details").filter({ has: page.locator("dl") });
      await expect(guide).toHaveAttribute("open", "");
      await expect(guide.locator("dd")).toHaveCount(5);
      await expect(guide.locator("dd").first()).toContainText(/3[–-]12/);
      await expect(preview.getByRole("status")).toHaveText(`Slide 1 of ${total}`);
      let activityCount = 0;
      for (let number = 1; number <= total; number++) {
        const slide = preview.locator(`[data-template-preview-slide="${number}"]`);
        await expect(slide).toBeVisible();
        activityCount += await slide.getByText("Audience activity", { exact: true }).count();
        if (number < total)
          await preview.getByRole("button", { name: "Next slide", exact: true }).click();
      }
      expect(activityCount).toBe(activities);
      await expect(preview.getByRole("button", { name: "Next slide", exact: true })).toBeDisabled();
      await preview.getByRole("button", { name: "Previous slide", exact: true }).click();
      await expect(preview.getByRole("status")).toHaveText(`Slide ${total - 1} of ${total}`);
      if (id === "meeting") {
        for (const mode of modes) {
          await page.emulateMedia({
            colorScheme: mode.colorScheme,
            forcedColors: mode.forcedColors,
          });
          await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode.colorScheme);
          await waitForSubtlePalette(page, guide.locator("dd").first());
          await audit(page, ["dialog[open]"]);
          if (mode.name === "light") {
            await preview.evaluate((node) => {
              node.scrollTop = 0;
            });
            await preview.screenshot({
              path: info.outputPath("meeting-presentation-guide.png"),
              scale: "css",
            });
          }
        }
        await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
      }
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    expect(writes).toEqual([]);
    expect(
      (await result(page.request.get(`${api}/v1/presentations`))).presentations.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual(before);
    await page
      .locator('[data-template-id="meeting"]')
      .getByRole("button", { name: "Use presentation template", exact: true })
      .click();
    await expect(page).toHaveURL(/\/presentation\/[0-9a-f-]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const created = (await result(page.request.get(`${api}/v1/presentations/${id}`))).presentation;
    expect(created.status).toBe("draft");
    expect(created.draft.title).toBe("Team meeting");
    expect(created.draft.blocks).toHaveLength(5);
    expect(
      created.draft.blocks.filter((block: { kind: string }) => block.kind === "content"),
    ).toHaveLength(3);
    expect(
      created.draft.blocks.filter((block: { kind: string }) => block.kind !== "content"),
    ).toHaveLength(2);
    expect(new Set(created.draft.blocks.map((block: { id: string }) => block.id)).size).toBe(5);
    await expect(
      page.getByRole("textbox", { name: "Presentation title", exact: true }),
    ).toBeEditable();
    expect(writes.filter((write) => write.startsWith("POST "))).toEqual(["POST /v1/presentations"]);
    expect(
      (await result(page.request.get(`${api}/v1/presentations`))).presentations
        .filter((row: { id: string }) => !before.includes(row.id))
        .map((row: { id: string }) => row.id),
    ).toEqual([id]);
  });
}

test("Team meetings collection preserves real viewer access and disabled format capabilities", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  // Organization membership is managed through licensed People, whereas this
  // baseline exercises the real legacy workspace viewer invitation contract.
  await signInCreator(page, testEmail("meeting-viewer-owner", info));
  const context = await browser.newContext({ baseURL: web, reducedMotion: "reduce" });
  const viewer = await context.newPage();
  try {
    const email = testEmail("meeting-viewer", info);
    await signInCreator(viewer, email);
    const invitation = await result(
      page.request.post(`${api}/v1/workspace/invitations`, { data: { email, role: "viewer" } }),
      201,
    );
    const token = new URL(invitation.debugUrl).searchParams.get("token");
    await result(
      viewer.request.post(`${api}/v1/invitations/accept`, {
        data: { token, acceptPolicies: true },
      }),
    );
    expect((await result(viewer.request.get(`${api}/v1/auth/me`))).creator.role).toBe("viewer");
    const writes = contentWrites(viewer);
    for (const [type, id, survey] of [
      ["rounds", "meeting-priorities", false],
      ["surveys", "team-collaboration", true],
    ] as const) {
      await viewer.goto(`/templates?collection=${collection}&type=${type}`);
      const preview = await previewStarter(viewer, id, false, survey);
      await expect(preview).toContainText("Viewers can browse starters.");
      await expect(
        preview.getByRole("button", { name: "Use this starter", exact: true }),
      ).toHaveCount(0);
    }
    await viewer.goto(`/templates?collection=${collection}&type=presentations`);
    await cards(viewer, "presentations", presentationIds);
    await expect(
      viewer.getByRole("button", { name: "Use presentation template", exact: true }),
    ).toHaveCount(0);
    await viewer
      .locator('[data-template-id="meeting"]')
      .getByRole("button", { name: "Preview structure", exact: true })
      .click();
    await expect(viewer.getByRole("dialog")).toBeVisible();
    expect(writes).toEqual([]);
  } finally {
    await context.close();
  }

  // Exercise resolved UI capability state while retaining the real catalog and server factories.
  await page.route(`${api}/v1/auth/me`, async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    account.productFeatures = { ...account.productFeatures, presentations: false, surveys: false };
    await route.fulfill({ response, json: account });
  });
  const writes = contentWrites(page);
  await page.goto(`/templates?collection=${collection}&type=presentations`);
  await cards(page, "presentations", presentationIds);
  await expect(
    page.getByRole("button", { name: "Use presentation template", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Start blank", exact: true })).toHaveCount(0);
  await page
    .locator('[data-template-id="meeting"]')
    .getByRole("button", { name: "Preview structure", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#template-tab-surveys").click();
  const surveyPreview = await previewStarter(page, "team-collaboration", false, true);
  await expect(
    surveyPreview.getByRole("button", { name: "Use this starter", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("section[data-template-collection]")).toHaveAttribute(
    "data-template-collection",
    collection,
  );
  expect(writes).toEqual([]);
});
