import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIResponse, type Page, type TestInfo } from "@playwright/test";
import { SURVEY_READER_HEADER, type SurveyDraft } from "../../packages/contracts/src/surveys";
import type { SurveyRecordView } from "../../apps/web/lib/survey-client";
import { surveyPagesCopy } from "../../apps/web/lib/i18n/survey-pages-copy";
import { surveyPageAuthoringCopy } from "../../apps/web/lib/i18n/survey-page-authoring-copy";
import { signInCreator } from "../support/creator-auth";
import { testEmail } from "../e2e/test-email";
import { api, fits, organization, web } from "./support";

type PagedDraft = Extract<SurveyDraft, { schemaVersion: 3 }>;

async function json<T>(pending: Promise<APIResponse>, status = 200): Promise<T> {
  const response = await pending;
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function owner(page: Page, info: TestInfo, licensed = false) {
  if (licensed) await organization(page, info);
  else await signInCreator(page, testEmail("survey-pages-author", info));
}

async function policy(page: Page, enabled: boolean) {
  await json(
    page.request.post(`${api}/__test/surveys/page-authoring-policy`, { data: { enabled } }),
  );
  const account = await json<{ productFeatures: { surveyPages: boolean } }>(
    page.request.get(`${api}/v1/auth/me`),
  );
  expect(account.productFeatures.surveyPages).toBe(enabled);
}

async function sourceSurvey(page: Page) {
  const { survey } = await json<{ survey: SurveyRecordView }>(
    page.request.post(`${api}/v1/surveys`, {
      data: { idempotencyKey: randomUUID(), templateId: "training-feedback", locale: "en-CA" },
    }),
    201,
  );
  expect(survey.draft.schemaVersion).toBe(2);
  expect(survey.draft.items).toHaveLength(2);
  return survey;
}

async function record(page: Page, id: string) {
  return (
    await json<{ survey: SurveyRecordView }>(
      page.request.get(`${api}/v1/surveys/${id}`, { headers: { [SURVEY_READER_HEADER]: "3" } }),
    )
  ).survey;
}

function partition(draft: PagedDraft) {
  expect(draft.pages.flatMap((item) => item.questionIds)).toEqual(
    draft.items.map((item) => item.question.id),
  );
  expect(new Set(draft.items.map((item) => item.question.id)).size).toBe(draft.items.length);
}

const authoring = (page: Page) => page.locator("[data-survey-page-authoring]");
const selectedPage = (page: Page) => page.locator("[data-survey-selected-page]");
const authorQuestion = (page: Page, id: string) =>
  page.locator(`[data-survey-author-question="${id}"]`);
const selectPage = (page: Page, id: string) =>
  page.locator(`[data-survey-author-page="${id}"] button`).click();

async function convert(page: Page, locale: "en-CA" | "ko-KR" = "en-CA") {
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: surveyPageAuthoringCopy(locale).convertAction, exact: true })
    .click();
  await expect(authoring(page)).toBeVisible();
  return (await selectedPage(page).getAttribute("data-survey-selected-page"))!;
}

async function savedPages(page: Page, id: string, matches: (draft: PagedDraft) => boolean) {
  await expect
    .poll(async () => {
      const current = await record(page, id);
      return current.draft.schemaVersion === 3 && matches(current.draft);
    })
    .toBe(true);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  const current = await record(page, id);
  expect(current.draft.schemaVersion).toBe(3);
  const draft = current.draft as PagedDraft;
  partition(draft);
  return draft;
}

async function chooseKorean(page: Page) {
  await page.goto("/surveys");
  await page.getByRole("button", { name: "EN: Language: English (Canada)", exact: true }).click();
  const changed = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/v1/account/locale" &&
      response.request().postDataJSON().locale === "ko-KR",
  );
  await page.getByRole("radio", { name: /한국어/ }).click();
  expect((await changed).status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
}

async function answerCurrentPage(page: Page) {
  for (const item of await page.locator("[data-survey-question]").all()) {
    const options = item.getByRole("radio");
    if (await options.count()) await options.first().check();
    else await item.getByRole("checkbox").first().check();
  }
}

function authorWrites(page: Page, id: string) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      (path === `/v1/surveys/${id}` || path.startsWith(`/v1/surveys/${id}/`))
    )
      writes.push(`${request.method()} ${path}`);
  });
  return writes;
}

async function refreshWorkspace(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("polling-pops:workspace-updated")));
}

async function failingAccountReads(page: Page) {
  let failed = true;
  let failures = 0;
  await page.route(`${api}/v1/auth/me`, async (route) => {
    if (failed && route.request().method() === "GET") {
      failures += 1;
      await route.fulfill({
        status: 503,
        headers: {
          "access-control-allow-origin": web,
          "access-control-allow-credentials": "true",
          "cache-control": "no-store",
        },
        json: {
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Workspace access is temporarily unavailable.",
          },
        },
      });
    } else await route.continue();
  });
  return {
    get failures() {
      return failures;
    },
    setFailed(value: boolean) {
      failed = value;
    },
  };
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test("WX06A2 an editor converts a legacy Survey, edits and orders pages and questions, then publishes a working paged run", async ({
  page,
}, info) => {
  await owner(page, info, true);
  try {
    await policy(page, true);
    const source = await sourceSurvey(page);
    const [pollId, ratingId] = source.draft.items.map((item) => item.question.id);
    const copy = surveyPageAuthoringCopy();
    await page.goto(`/surveys/${source.id}`);
    const firstId = await convert(page);
    await expect(authoring(page).locator("[data-survey-author-question]")).toHaveCount(2);
    await page.getByRole("textbox", { name: copy.pageTitle, exact: true }).fill("Starting point");
    await page
      .getByRole("textbox", { name: copy.pageInstructions, exact: true })
      .fill("Review the original focus before continuing.");
    await page.getByRole("button", { name: copy.addPage, exact: true }).click();
    const secondId = (await selectedPage(page).getAttribute("data-survey-selected-page"))!;
    expect(secondId).not.toBe(firstId);
    await page.getByRole("textbox", { name: copy.pageTitle, exact: true }).fill("Next step");
    await page
      .getByRole("textbox", { name: copy.pageInstructions, exact: true })
      .fill("Choose a next step.\nThen rate the training.");
    await page.getByRole("button", { name: copy.addPoll, exact: true }).click();
    const newQuestion = authoring(page).locator("[data-survey-author-question]");
    const addedId = (await newQuestion.getAttribute("data-survey-author-question"))!;
    await newQuestion
      .getByRole("textbox", { name: "Question", exact: true })
      .fill("Which next step should we try?");
    await selectPage(page, firstId);
    await authorQuestion(page, ratingId!)
      .getByRole("combobox", { name: /^Move to page:/ })
      .selectOption(secondId);
    await selectPage(page, secondId);
    // Move the rating ahead of the new poll, then put this page first.
    await authorQuestion(page, ratingId!)
      .getByRole("button", { name: copy.moveQuestionUp, exact: true })
      .click();
    await page.getByRole("button", { name: copy.movePageUp, exact: true }).click();
    await page.getByRole("button", { name: copy.addPage, exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: copy.removePage, exact: true }).click();
    const draft = await savedPages(
      page,
      source.id,
      (value) =>
        value.pages.length === 2 &&
        value.pages[0]!.id === secondId &&
        value.items.map((item) => item.question.id).join() === [ratingId, addedId, pollId].join(),
    );
    expect(draft.pages).toEqual([
      {
        id: secondId,
        title: "Next step",
        description: "Choose a next step.\nThen rate the training.",
        questionIds: [ratingId, addedId],
      },
      {
        id: firstId,
        title: "Starting point",
        description: "Review the original focus before continuing.",
        questionIds: [pollId],
      },
    ]);
    await page.reload();
    await expect(page.locator("[data-survey-author-page]").first()).toHaveAttribute(
      "data-survey-author-page",
      secondId,
    );
    await expect(page.getByRole("textbox", { name: copy.pageTitle, exact: true })).toHaveValue(
      "Next step",
    );
    const beforePreview = await record(page, source.id);
    await page.getByRole("button", { name: copy.preview, exact: true }).click();
    await expect(page.locator("[data-survey-page]")).toHaveAttribute("data-survey-page", secondId);
    await expect(page.locator("[data-survey-question] input:enabled")).toHaveCount(0);
    await page.getByRole("button", { name: surveyPagesCopy().next, exact: true }).click();
    await expect(page.locator("[data-survey-page]")).toHaveAttribute("data-survey-page", firstId);
    expect((await record(page, source.id)).revision).toBe(beforePreview.revision);
    await page.getByRole("button", { name: copy.editorToggle, exact: true }).click();
    const publishedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/surveys/${source.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish Survey", exact: true }).click();
    expect((await publishedResponse).status()).toBe(200);
    const roomResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/surveys/${source.id}/rooms`,
    );
    await page.getByRole("button", { name: "Create sharing link", exact: true }).click();
    const response = await roomResponse;
    expect(response.status()).toBe(201);
    const { room } = (await response.json()) as { room: { id: string } };
    await page.goto(`/survey/${room.id}`);
    await expect(page.locator("[data-survey-page]")).toHaveAttribute("data-survey-page", secondId);
    await expect(page.locator("[data-survey-page-heading]")).toHaveText("Next step");
    await page.getByRole("button", { name: surveyPagesCopy().next, exact: true }).click();
    await expect(page.getByText(surveyPagesCopy().requiredError, { exact: true })).toBeVisible();
    await answerCurrentPage(page);
    await page.getByRole("button", { name: surveyPagesCopy().next, exact: true }).click();
    await expect(page.locator("[data-survey-page]")).toHaveAttribute("data-survey-page", firstId);
    await expect(page.locator("[data-survey-page-heading]")).toHaveText("Starting point");
    await answerCurrentPage(page);
    await page.getByRole("button", { name: surveyPagesCopy().submit, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Thank you", exact: true })).toBeVisible();
  } finally {
    await policy(page, false);
  }
});

test("WX06A2 account access retries recover an initial outage and preserve masked unsaved page edits during a refresh outage", async ({
  page,
}, info) => {
  await owner(page, info, true);
  try {
    await policy(page, true);
    const identity = await json<{ creator: { userId: string; workspaceId: string } }>(
      page.request.get(`${api}/v1/auth/me`),
    );
    const source = await sourceSurvey(page);
    const copy = surveyPageAuthoringCopy();
    const account = await failingAccountReads(page);
    let sourceLoads = 0;
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === `/v1/surveys/${source.id}`
      )
        sourceLoads += 1;
    });
    await page.goto(`/surveys/${source.id}`);
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Workspace access is temporarily unavailable.",
    );
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
    expect(sourceLoads).toBe(0);
    await page.screenshot({
      path: info.outputPath("survey-workspace-access-error.png"),
      fullPage: true,
    });
    account.setFailed(false);
    const firstRecovery = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url() === `${api}/v1/auth/me` &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    expect((await firstRecovery).status()).toBe(200);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeEnabled();
    const firstId = await convert(page);
    await savedPages(page, source.id, (draft) => draft.pages.length === 1);
    const confirmed = await record(page, source.id);
    const loadsBeforeRefresh = sourceLoads;
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === `/v1/surveys/${source.id}`
      )
        writes.push(request.postData()!);
    });
    // Hold only browser timers, so slow CI cannot finish the real autosave debounce first.
    const pauseTime = new Date();
    await page.clock.setFixedTime(pauseTime);
    await page.clock.pauseAt(pauseTime);
    const localTitle = "Page edits retained while workspace access is checked";
    await page.getByRole("textbox", { name: copy.pageTitle, exact: true }).fill(localTitle);
    account.setFailed(true);
    const failuresBeforeRefresh = account.failures;
    await refreshWorkspace(page);
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Workspace access is temporarily unavailable.",
    );
    expect(account.failures).toBeGreaterThan(failuresBeforeRefresh);
    await expect(authoring(page)).not.toBeVisible();
    await expect(page.getByRole("textbox", { name: copy.pageTitle, exact: true })).toHaveCount(0);
    await page.clock.fastForward(2_000);
    expect(writes).toEqual([]);
    expect((await record(page, source.id)).revision).toBe(confirmed.revision);
    expect(sourceLoads).toBe(loadsBeforeRefresh);
    account.setFailed(false);
    const recovered = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url() === `${api}/v1/auth/me` &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    expect((await (await recovered).json()).creator).toMatchObject({
      userId: identity.creator.userId,
      workspaceId: identity.creator.workspaceId,
    });
    await expect(page.getByRole("textbox", { name: copy.pageTitle, exact: true })).toHaveValue(
      localTitle,
    );
    await page.clock.fastForward(1_000);
    await savedPages(page, source.id, (draft) => draft.pages[0]!.title === localTitle);
    expect(sourceLoads).toBe(loadsBeforeRefresh);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!).draft.pages[0]).toMatchObject({ id: firstId, title: localTitle });
    expect((await record(page, source.id)).revision).toBe(confirmed.revision + 1);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await policy(page, false);
  }
});

test("WX06A2 a real server page-authoring pause retains the exact save request and resumes without conflict or reload", async ({
  page,
}, info) => {
  await owner(page, info, true);
  try {
    await policy(page, true);
    const source = await sourceSurvey(page);
    const copy = surveyPageAuthoringCopy();
    await page.goto(`/surveys/${source.id}`);
    const firstId = await convert(page);
    await savedPages(page, source.id, (draft) => draft.pages.length === 1);
    const confirmed = await record(page, source.id);
    const writes: string[] = [];
    let reloads = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname !== `/v1/surveys/${source.id}`) return;
      if (request.method() === "PUT") writes.push(request.postData()!);
      if (request.method() === "GET") reloads += 1;
    });
    await policy(page, false);
    const title = page.getByRole("textbox", { name: copy.pageTitle, exact: true });
    // The tab still has its last confirmed grant; only the real server rejects this write.
    await expect(title).toBeEnabled();
    const rejected = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/v1/surveys/${source.id}`,
    );
    const localTitle = "Page edits retained through a server authoring pause";
    await title.fill(localTitle);
    const denial = await rejected;
    expect(denial.status()).toBe(409);
    expect((await denial.json()).error.code).toBe("SURVEY_PAGES_NOT_ENABLED");
    const originalBody = denial.request().postData()!;
    expect(writes).toEqual([originalBody]);
    await expect(page.locator("[data-survey-pages-readonly]")).toBeVisible();
    await expect(page.locator("[data-survey-page-heading]")).toHaveText(localTitle);
    await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Reload latest version", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(
      "This Survey changed in another tab or editor.",
    );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("survey-authoring-server-pause.png"),
      fullPage: true,
    });
    expect((await record(page, source.id)).revision).toBe(confirmed.revision);
    await policy(page, true);
    const accepted = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/v1/surveys/${source.id}`,
    );
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    const acknowledgement = await accepted;
    expect(acknowledgement.status()).toBe(200);
    expect(acknowledgement.request().postData()).toBe(originalBody);
    const body = JSON.parse(originalBody) as {
      idempotencyKey: string;
      expectedRevision: number;
      draft: PagedDraft;
    };
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.expectedRevision).toBe(confirmed.revision);
    expect(body.draft.pages[0]).toMatchObject({ id: firstId, title: localTitle });
    await savedPages(page, source.id, (draft) => draft.pages[0]!.title === localTitle);
    await expect(page.getByRole("textbox", { name: copy.pageTitle, exact: true })).toHaveValue(
      localTitle,
    );
    expect(writes).toEqual([originalBody, originalBody]);
    expect(reloads).toBe(0);
    expect((await record(page, source.id)).revision).toBe(confirmed.revision + 1);
  } finally {
    await policy(page, false);
  }
});

test("WX06A2 default-off, paused and real viewer workspaces retain page readers without autosaving", async ({
  page,
  browser,
}, info) => {
  await owner(page, info);
  const account = await json<{ productFeatures: { surveyPages: boolean } }>(
    page.request.get(`${api}/v1/auth/me`),
  );
  expect(account.productFeatures.surveyPages).toBe(false);
  const source = await sourceSurvey(page);
  const retained = await json<{ surveyId: string }>(
    page.request.post(`${api}/__test/surveys/pages`, { data: {} }),
    201,
  );
  let viewerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await page.goto(`/surveys/${source.id}`);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeEnabled();
    await expect(page.locator("[data-survey-conversion]")).toHaveCount(0);
    expect((await record(page, source.id)).draft.schemaVersion).toBe(2);
    await page.goto(`/surveys/${retained.surveyId}`);
    await expect(page.locator("[data-survey-pages-readonly]")).toBeVisible();
    const writes = authorWrites(page, retained.surveyId);
    const initial = await record(page, retained.surveyId);
    await page.clock.install();
    await page.clock.fastForward(2_000);
    expect(writes).toEqual([]);
    expect((await record(page, retained.surveyId)).revision).toBe(initial.revision);

    await policy(page, true);
    await page.reload();
    await expect(page.locator("[data-survey-pages-readonly]")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeEnabled();
    await policy(page, false);
    await page.reload();
    await expect(page.locator("[data-survey-pages-readonly]")).toBeVisible();
    await page.clock.fastForward(2_000);
    expect(writes).toEqual([]);
    expect((await record(page, retained.surveyId)).draft).toEqual(initial.draft);

    await policy(page, true);
    viewerContext = await browser.newContext({ baseURL: web, reducedMotion: "reduce" });
    const viewer = await viewerContext.newPage();
    const email = testEmail("survey-page-viewer", info);
    await signInCreator(viewer, email);
    const invitation = await json<{ debugUrl: string }>(
      page.request.post(`${api}/v1/workspace/invitations`, { data: { email, role: "viewer" } }),
      201,
    );
    const token = new URL(invitation.debugUrl).searchParams.get("token");
    await json(
      viewer.request.post(`${api}/v1/invitations/accept`, {
        data: { token, acceptPolicies: true },
      }),
    );
    expect(
      (await json<{ creator: { role: string } }>(viewer.request.get(`${api}/v1/auth/me`))).creator
        .role,
    ).toBe("viewer");
    const viewerWrites = authorWrites(viewer, retained.surveyId);
    await viewer.goto(`/surveys/${retained.surveyId}`);
    await expect(viewer.locator("[data-survey-pages-readonly]")).toBeVisible();
    await expect(viewer.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
    await viewer.clock.install();
    await viewer.clock.fastForward(2_000);
    expect(viewerWrites).toEqual([]);
    expect(
      (
        await viewer.request.put(`${api}/v1/surveys/${retained.surveyId}`, {
          data: {
            expectedRevision: initial.revision,
            idempotencyKey: randomUUID(),
            draft: initial.draft,
          },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await viewerContext?.close();
    await policy(page, false);
  }
});

test("WX06A2 page authoring fits 320px with keyboard and accessible English/Korean light/dark controls @mobile", async ({
  page,
}, info) => {
  await owner(page, info, true);
  try {
    await policy(page, true);
    for (const locale of ["en-CA", "ko-KR"] as const) {
      if (locale === "ko-KR") await chooseKorean(page);
      const copy = surveyPageAuthoringCopy(locale);
      const source = await sourceSurvey(page);
      const ratingId = source.draft.items[1]!.question.id;
      await page.setViewportSize({ width: 320, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
      await page.goto(`/surveys/${source.id}`);
      const firstId = await convert(page, locale);
      const longTitle = "W".repeat(160);
      const instructions = `Read the page instructions.\nReview before answering.\n${"Instruction".repeat(16)}`;
      await page.getByRole("textbox", { name: copy.pageTitle, exact: true }).fill(longTitle);
      await page
        .getByRole("textbox", { name: copy.pageInstructions, exact: true })
        .fill(instructions);
      const add = page.getByRole("button", { name: copy.addPage, exact: true });
      await add.focus();
      await page.keyboard.press("Enter");
      await expect(selectedPage(page)).not.toHaveAttribute("data-survey-selected-page", firstId);
      const secondId = (await selectedPage(page).getAttribute("data-survey-selected-page"))!;
      await page.getByRole("textbox", { name: copy.pageTitle, exact: true }).fill("Follow up");
      await selectPage(page, firstId);
      await authorQuestion(page, ratingId)
        .getByRole("combobox", {
          name: `${copy.moveQuestionToPage}: ${copy.questionLabel.replace("{question}", "2")}`,
          exact: true,
        })
        .selectOption(secondId);
      const moveDown = page.getByRole("button", { name: copy.movePageDown, exact: true });
      await moveDown.focus();
      await page.keyboard.press("Enter");
      await savedPages(
        page,
        source.id,
        (value) =>
          value.pages.length === 2 &&
          value.pages[0]!.id === secondId &&
          value.pages[1]!.title === longTitle &&
          value.pages[1]!.description === instructions &&
          value.pages[0]!.questionIds.join() === ratingId &&
          value.pages[1]!.questionIds.length === 1,
      );
      await page.reload();
      await selectPage(page, firstId);
      await expect(page.getByRole("textbox", { name: copy.pageTitle, exact: true })).toHaveValue(
        longTitle,
      );
      await expect(
        page.getByRole("textbox", { name: copy.pageInstructions, exact: true }),
      ).toHaveValue(instructions);
      const summaryHeading = selectedPage(page).getByRole("heading", { level: 3 });
      const navigation = page.locator(`[data-survey-author-page="${firstId}"] button`);
      await expect(summaryHeading).toHaveText(longTitle);
      await expect(navigation).toHaveAccessibleName(longTitle);
      for (const summary of [summaryHeading, navigation.locator("span")]) {
        const geometry = await summary.evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
        }));
        expect(geometry.lineHeight).toBeGreaterThan(0);
        expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight * 3 + 1);
      }
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const colors = await page.evaluate(() => {
          const resolve = (token: string) => {
            const probe = document.createElement("span");
            probe.style.color = `var(${token})`;
            document.documentElement.appendChild(probe);
            const value = getComputedStyle(probe).color;
            probe.remove();
            return value;
          };
          return { strong: resolve("--ui-text-strong"), text: resolve("--ui-text") };
        });
        await expect(selectedPage(page).getByRole("heading", { level: 3 })).toHaveCSS(
          "color",
          colors.strong,
        );
        await expect(page.getByRole("textbox", { name: copy.pageTitle, exact: true })).toHaveCSS(
          "color",
          colors.text,
        );
        // Native fieldset descendants can settle after the themed input in WebKit.
        for (const label of await authoring(page)
          .locator("[data-survey-author-question] legend, [data-survey-author-question] label")
          .all())
          await expect(label).toHaveCSS("color", colors.text);
        await fits(page);
        expect(
          (
            await new AxeBuilder({ page })
              .include("main")
              .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await page.screenshot({
          path: info.outputPath(`survey-page-authoring-${locale}-${colorScheme}.png`),
          fullPage: true,
          scale: "css",
        });
      }
      const preview = page.getByRole("button", { name: copy.preview, exact: true });
      await preview.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("[data-survey-page]")).toHaveAttribute("data-survey-page", firstId);
      const previewHeading = page.locator("[data-survey-page-heading]");
      await expect(previewHeading).toHaveText(longTitle);
      expect(
        await previewHeading.evaluate(
          (element) =>
            element.getBoundingClientRect().height >
            Number.parseFloat(getComputedStyle(element).lineHeight) * 3,
        ),
      ).toBe(true);
      await expect(page.locator("[data-survey-question] input:enabled")).toHaveCount(0);
    }
  } finally {
    await policy(page, false);
  }
});
