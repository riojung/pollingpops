import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIResponse, type Page, type TestInfo } from "@playwright/test";
import type { LibraryShareSummary } from "@openround/contracts";
import { SURVEY_READER_HEADER, type SurveyDraft } from "../../packages/contracts/src/surveys";
import type { SurveyAttempt } from "../../apps/web/lib/survey-client";
import { surveyPagesCopy } from "../../apps/web/lib/i18n/survey-pages-copy";
import { librarySharingMessages } from "../../apps/web/lib/i18n/library-sharing-messages";
import { api, fits, organization, teammate } from "./support";

interface Fixture {
  surveyId: string;
  versionId: string;
  pages: Array<{ id: string; title: string; description: string; questionIds: string[] }>;
  room: { id: string; code: string; closesAt: string; expiresAt: string };
  participantUrl: string;
  questionIds: string[];
  pageIds: string[];
  choiceIds: { first: string[]; next: string[] };
}

async function json<T>(pending: Promise<APIResponse>, status = 200): Promise<T> {
  const response = await pending;
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function seed(page: Page, info: TestInfo, libraryReader = false) {
  const { organizationId } = await organization(page, info);
  const fixture = await json<Fixture>(
    page.request.post(`${api}/__test/surveys/pages`, {
      data: libraryReader ? { libraryReader } : {},
    }),
    201,
  );
  expect(fixture.pageIds).toHaveLength(3);
  expect(fixture.questionIds).toHaveLength(4);
  return { ...fixture, organizationId };
}

async function shareSurvey(page: Page, recipientId: string, surveyId: string, versionId: string) {
  return (
    await json<{ share: LibraryShareSummary }>(
      page.request.post(`${api}/v1/library/shares`, {
        data: {
          requestId: randomUUID(),
          artifactType: "survey",
          artifactId: surveyId,
          versionId,
          audience: "people",
          recipientIds: [recipientId],
          permission: "view",
          message: "Review the published Survey instructions.",
          dueAt: null,
        },
      }),
      201,
    )
  ).share;
}

const pagePrompts = [
  ["What should the group discuss first?", "How clear is this example?"],
  ["Which next step should we take?"],
  ["How useful was this review?"],
];

async function sharedPagesContent(page: Page, fixture: Fixture, locale: "en-CA" | "ko-KR") {
  const groups = page.locator("[data-shared-survey-page]");
  await expect(groups).toHaveCount(3);
  for (const [index, content] of fixture.pages.entries()) {
    const group = groups.nth(index);
    await expect(group).toHaveAttribute("data-shared-survey-page", content.id);
    await expect(group.locator("[data-shared-survey-page-progress]")).toHaveText(
      fill(surveyPagesCopy(locale).pageProgress, index + 1),
    );
    await expect(group.getByRole("heading", { level: 2 })).toHaveText(
      content.title || surveyPagesCopy(locale).untitledPage.replace("{page}", String(index + 1)),
    );
    await expect(group.getByText(content.description, { exact: true })).toBeVisible();
    await expect(group.getByRole("heading", { level: 3 })).toHaveText(pagePrompts[index]!);
  }
  await expect(
    page.getByRole("button", { name: librarySharingMessages(locale).copy, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("main input, main textarea, main select, main [contenteditable=true]"),
  ).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("UNPUBLISHED_SYNTHETIC");
}

const currentPage = (page: Page) => page.locator("[data-survey-page]");
const question = (page: Page, id: string) => page.locator(`[data-survey-question="${id}"]`);
const fill = (text: string, page: number, count = 3) =>
  text.replace("{page}", String(page)).replace("{count}", String(count));

async function atPage(
  page: Page,
  fixture: Fixture,
  index: number,
  locale: "en-CA" | "ko-KR" = "en-CA",
) {
  await expect(currentPage(page)).toHaveAttribute("data-survey-page", fixture.pageIds[index]!);
  await expect(page.locator("[data-survey-page-progress]")).toHaveText(
    fill(surveyPagesCopy(locale).pageProgress, index + 1),
  );
  return currentPage(page);
}

async function attempt(page: Page, fixture: Fixture) {
  const token = await page.evaluate(
    (id) => localStorage.getItem(`pollingpops:survey:${id}`),
    fixture.room.id,
  );
  expect(token).toBeTruthy();
  return (
    await json<{ attempt: SurveyAttempt }>(
      page.request.get(`${api}/v1/survey-rooms/${fixture.room.id}/attempt`, {
        headers: { [SURVEY_READER_HEADER]: "3", authorization: `Bearer ${token}` },
      }),
    )
  ).attempt;
}

function guestRequests(page: Page, fixture: Fixture) {
  const requests: Array<
    Promise<{ method: string; path: string; schema: string | undefined; hasCookie: boolean }>
  > = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith(`/v1/survey-rooms/${fixture.room.id}/`) || request.method() === "OPTIONS")
      return;
    requests.push(
      request.allHeaders().then((headers) => ({
        method: request.method(),
        path,
        schema: headers[SURVEY_READER_HEADER],
        hasCookie: Boolean(headers.cookie),
      })),
    );
  });
  return requests;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function answerFirstPage(page: Page, fixture: Fixture, optional = true) {
  await question(page, fixture.questionIds[0]!)
    .getByRole("radio", { name: "The complete process", exact: true })
    .check();
  if (optional)
    await question(page, fixture.questionIds[1]!)
      .getByRole("radio", { name: "4", exact: true })
      .check();
}

async function chooseKorean(page: Page) {
  await page.goto("/surveys");
  const trigger = page.getByRole("button", { name: "EN: Language: English (Canada)", exact: true });
  await expect(trigger).toBeVisible();
  const changed = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/v1/account/locale" &&
      response.request().postDataJSON().locale === "ko-KR",
  );
  await trigger.click();
  await page.getByRole("radio", { name: /한국어/ }).click();
  expect((await changed).status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
}

async function palette(page: Page) {
  const expected = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-text)";
    document.documentElement.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(currentPage(page)).toHaveCSS("color", expected);
  // WebKit can update the reader token before inherited form/fieldset text settles.
  await expect(page.locator("main form > p[lang='']").first()).toHaveCSS("color", expected);
  await expect(currentPage(page).locator("legend > span").first()).toHaveCSS("color", expected);
  await expect(currentPage(page).locator("label > span").first()).toHaveCSS("color", expected);
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test("WX06A1 creators inspect retained Survey pages without writes and old guest readers are rejected before content", async ({
  page,
}, info) => {
  const fixture = await seed(page, info);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith("/v1/surveys")
    )
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto(`/surveys/${fixture.surveyId}`);
  const reader = page.locator("[data-survey-pages-readonly]");
  await expect(
    reader.getByRole("heading", { name: surveyPagesCopy().readOnlyTitle, exact: true }),
  ).toBeVisible();
  await expect(reader.getByText(surveyPagesCopy().readOnlyNotice, { exact: true })).toBeVisible();
  await atPage(page, fixture, 0);
  await expect(reader.getByRole("radio").first()).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /Publish Survey|Add question|Create room|Save progress|Submit Survey/,
      exact: true,
    }),
  ).toHaveCount(0);
  await reader.getByRole("button", { name: surveyPagesCopy().next, exact: true }).click();
  await atPage(page, fixture, 1);
  await reader.getByRole("button", { name: surveyPagesCopy().next, exact: true }).click();
  await atPage(page, fixture, 2);
  await reader.getByRole("button", { name: surveyPagesCopy().back, exact: true }).click();
  await atPage(page, fixture, 1);
  expect(writes).toEqual([]);
  const record = await json<{ survey: { draft: SurveyDraft; revision: number } }>(
    page.request.get(`${api}/v1/surveys/${fixture.surveyId}`, {
      headers: { [SURVEY_READER_HEADER]: "3" },
    }),
  );
  expect(record.survey.draft.schemaVersion).toBe(3);
  const authorWrite = await page.request.put(`${api}/v1/surveys/${fixture.surveyId}`, {
    data: {
      idempotencyKey: randomUUID(),
      expectedRevision: record.survey.revision,
      draft: record.survey.draft,
    },
  });
  expect(authorWrite.status(), await authorWrite.text()).toBe(409);
  expect((await authorWrite.json()).error.code).toBe("SURVEY_PAGES_NOT_ENABLED");
  const roomWrite = await page.request.post(`${api}/v1/surveys/${fixture.surveyId}/rooms`, {
    data: { idempotencyKey: randomUUID(), expectedRevision: record.survey.revision, windowDays: 1 },
  });
  expect(roomWrite.status(), await roomWrite.text()).toBe(409);
  expect((await roomWrite.json()).error.code).toBe("SURVEY_PAGES_NOT_ENABLED");
  const publish = await page.request.post(`${api}/v1/surveys/${fixture.surveyId}/publish`, {
    data: { idempotencyKey: randomUUID(), expectedRevision: record.survey.revision },
  });
  expect(publish.status(), await publish.text()).toBe(409);
  expect((await publish.json()).error.code).toBe("SURVEY_PAGES_NOT_ENABLED");
  const copy = await page.request.post(`${api}/v1/surveys`, {
    data: { idempotencyKey: randomUUID(), sourceId: fixture.surveyId, locale: "en-CA" },
  });
  expect(copy.status(), await copy.text()).toBe(409);
  expect((await copy.json()).error.code).toBe("SURVEY_PAGES_NOT_ENABLED");
  const publicRoom = await json<{ room: Record<string, unknown> }>(
    page.request.get(`${api}/v1/survey-rooms/${fixture.room.id}/public`),
  );
  expect(publicRoom.room.title).toBe("Ordered Survey fixture");
  expect(publicRoom.room).not.toHaveProperty("content");
  expect(publicRoom.room).not.toHaveProperty("responses");
  expect(JSON.stringify(publicRoom)).not.toContain("What should the group discuss first?");
  for (const [path, method] of [
    ["join", "POST"],
    ["attempt", "GET"],
    ["draft", "POST"],
    ["submit", "POST"],
  ] as const) {
    const response = await page.request.fetch(`${api}/v1/survey-rooms/${fixture.room.id}/${path}`, {
      method,
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
      ...(path === "join"
        ? { data: {} }
        : path === "draft" || path === "submit"
          ? { data: { expectedRevision: 0, idempotencyKey: randomUUID(), responses: {} } }
          : {}),
    });
    expect(response.status(), await response.text()).toBe(409);
    expect((await response.json()).error.code).toBe("SURVEY_CLIENT_UPDATE_REQUIRED");
    expect(await response.text()).not.toContain("What should the group discuss first?");
    expect(await response.text()).not.toContain("Ordered Survey fixture");
  }
});

test("WX06A1 shared Library Surveys retain published page instructions and associations without granting editing or copy access", async ({
  page,
  browser,
}, info) => {
  const fixture = await seed(page, info, true);
  const member = await teammate(page, browser, fixture.organizationId, info);
  try {
    const share = await shareSurvey(
      page,
      member.identity.creator.userId,
      fixture.surveyId,
      fixture.versionId,
    );
    const source = await json<{ survey: { draft: SurveyDraft } }>(
      page.request.get(`${api}/v1/surveys/${fixture.surveyId}`, {
        headers: { [SURVEY_READER_HEADER]: "3" },
      }),
    );
    expect(source.survey.draft.title).toBe("UNPUBLISHED_SYNTHETIC_SOURCE");
    expect((await member.page.request.get(`${api}/v1/surveys/${fixture.surveyId}`)).status()).toBe(
      404,
    );
    const detail = await json<{
      share: LibraryShareSummary;
      questions: Array<Record<string, unknown> & { id: string }>;
      surveyPages: Fixture["pages"];
    }>(member.page.request.get(`${api}/v1/library/shares/${share.id}`));
    expect(detail.share).toMatchObject({
      title: "Ordered Survey fixture",
      permission: "view",
      capabilities: { view: true, copy: false, manage: false },
    });
    expect(detail.surveyPages).toEqual(fixture.pages);
    expect(detail.questions.map((item) => item.id)).toEqual(fixture.questionIds);
    expect(Object.keys(detail).sort()).toEqual(["questions", "share", "surveyPages"]);
    expect(JSON.stringify(detail)).not.toMatch(
      /UNPUBLISHED_SYNTHETIC|"(?:isCorrect|correctAnswer|explanation|responses|answers|draft|snapshot|contentHash)":/,
    );
    for (const content of detail.surveyPages)
      expect(Object.keys(content).sort()).toEqual(["description", "id", "questionIds", "title"]);
    const writes: string[] = [];
    member.page.on("request", (request) => {
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
        (/^\/v1\/surveys(?:\/|$)/.test(new URL(request.url()).pathname) ||
          new URL(request.url()).pathname.endsWith("/copy"))
      )
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await member.page.goto(`/library/shared/${share.id}`);
    await sharedPagesContent(member.page, fixture, "en-CA");
    expect(writes).toEqual([]);
    expect(
      (
        await member.page.request.post(`${api}/v1/library/shares/${share.id}/copy`, {
          data: { requestId: randomUUID() },
        })
      ).status(),
    ).toBe(403);

    // A normal v2 publication continues through the existing flat-question reader.
    const legacy = await json<{ survey: { id: string; revision: number; draft: SurveyDraft } }>(
      page.request.post(`${api}/v1/surveys`, {
        data: { idempotencyKey: randomUUID(), templateId: "training-feedback" },
      }),
      201,
    );
    expect(legacy.survey.draft.schemaVersion).toBe(2);
    const published = await json<{ survey: { versionId: string } }>(
      page.request.post(`${api}/v1/surveys/${legacy.survey.id}/publish`, {
        data: { idempotencyKey: randomUUID(), expectedRevision: legacy.survey.revision },
      }),
    );
    const legacyShare = await shareSurvey(
      page,
      member.identity.creator.userId,
      legacy.survey.id,
      published.survey.versionId,
    );
    const legacyDetail = await json<{ questions: Array<{ id: string; prompt: string }> }>(
      member.page.request.get(`${api}/v1/library/shares/${legacyShare.id}`),
    );
    expect(legacyDetail).not.toHaveProperty("surveyPages");
    expect(legacyDetail.questions.map((item) => item.id)).toEqual(
      legacy.survey.draft.items.map((item) => item.question.id),
    );
    await member.page.goto(`/library/shared/${legacyShare.id}`);
    await expect(member.page.locator("[data-shared-survey-page]")).toHaveCount(0);
    for (const item of legacyDetail.questions)
      await expect(
        member.page.getByRole("heading", { level: 2, name: item.prompt, exact: true }),
      ).toBeVisible();
    expect(writes).toEqual([]);
  } finally {
    await member.context.close();
  }
});

test("WX06A1 required pages save before advancing, Back retains answers, server resume ignores the last viewed page, and final submits once", async ({
  page,
}, info) => {
  const fixture = await seed(page, info);
  const traffic = guestRequests(page, fixture);
  const drafts: string[] = [];
  const finalBodies: string[] = [];
  const release = deferred();
  let held: SurveyAttempt | null = null;
  await page.route(`${api}/v1/survey-rooms/${fixture.room.id}/draft`, async (route) => {
    drafts.push(route.request().postData()!);
    const response = await route.fetch();
    if (drafts.length === 1) {
      held = (await response.json()).attempt;
      await release.promise;
    }
    await route.fulfill({ response });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith(`/${fixture.room.id}/submit`))
      finalBodies.push(request.postData()!);
  });
  try {
    await page.goto(fixture.participantUrl);
    await atPage(page, fixture, 0);
    await page.getByRole("button", { name: surveyPagesCopy().next, exact: true }).click();
    await expect(currentPage(page).getByRole("alert")).toContainText(
      surveyPagesCopy().requiredError,
    );
    await expect(question(page, fixture.questionIds[0]!).getByRole("radio").first()).toBeFocused();
    expect(drafts).toEqual([]);
    await answerFirstPage(page, fixture);
    await question(page, fixture.questionIds[1]!)
      .getByRole("radio", { name: "4", exact: true })
      .press("Enter");
    await expect.poll(() => held !== null).toBe(true);
    await atPage(page, fixture, 0);
    expect(finalBodies).toEqual([]);
    const saved = await attempt(page, fixture);
    expect(saved.responses).toMatchObject({
      [fixture.questionIds[0]!]: { kind: "poll", choiceIds: [fixture.choiceIds.first[0]] },
      [fixture.questionIds[1]!]: { kind: "rating", value: 4 },
    });
    expect(Object.keys(JSON.parse(drafts[0]!).responses)).toHaveLength(2);
    release.resolve();
    await atPage(page, fixture, 1);
    await expect(page.locator("[data-survey-page-heading]")).toBeFocused();
    await question(page, fixture.questionIds[2]!)
      .getByRole("radio", { name: "Confirm the next action", exact: true })
      .check();
    await page.getByRole("button", { name: surveyPagesCopy().next, exact: true }).click();
    await atPage(page, fixture, 2);
    expect(Object.keys(JSON.parse(drafts[1]!).responses)).toHaveLength(3);
    await page.getByRole("button", { name: surveyPagesCopy().back, exact: true }).click();
    await atPage(page, fixture, 1);
    await expect(
      question(page, fixture.questionIds[2]!).getByRole("radio", {
        name: "Confirm the next action",
        exact: true,
      }),
    ).toBeChecked();
    await page.reload();
    await atPage(page, fixture, 2);
    await expect(page.getByText(surveyPagesCopy().resumeHint, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: surveyPagesCopy().submit, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Thank you", exact: true })).toBeVisible();
    expect(finalBodies).toHaveLength(1);
    const finalized = await attempt(page, fixture);
    expect(finalized.finalized).toBe(true);
    expect(finalized.receipt).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Thank you", exact: true })).toBeVisible();
    expect((await attempt(page, fixture)).receipt).toBe(finalized.receipt);
    expect(finalBodies).toHaveLength(1);
    for (const request of await Promise.all(traffic)) {
      expect(request.schema, request.path).toBe("3");
      expect(request.hasCookie, request.path).toBe(false);
    }
  } finally {
    release.resolve();
  }
});

test("WX06A1 a lost save acknowledgement retries the exact body and optional unanswered questions determine resume", async ({
  page,
}, info) => {
  const fixture = await seed(page, info);
  const bodies: string[] = [];
  const replies: SurveyAttempt[] = [];
  await page.route(`${api}/v1/survey-rooms/${fixture.room.id}/draft`, async (route) => {
    bodies.push(route.request().postData()!);
    const response = await route.fetch();
    replies.push((await response.json()).attempt);
    if (bodies.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.goto(fixture.participantUrl);
  await atPage(page, fixture, 0);
  await answerFirstPage(page, fixture, false);
  await page.getByRole("button", { name: surveyPagesCopy().next, exact: true }).click();
  const retry = page.getByRole("button", { name: surveyPagesCopy().retrySave, exact: true });
  await expect(retry).toBeEnabled();
  await atPage(page, fixture, 0);
  await expect(question(page, fixture.questionIds[0]!).getByRole("radio").first()).toBeDisabled();
  expect((await attempt(page, fixture)).revision).toBe(1);
  await retry.click();
  await atPage(page, fixture, 1);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(replies[1]!.revision).toBe(replies[0]!.revision);
  expect((await attempt(page, fixture)).revision).toBe(1);
  await page.reload();
  await atPage(page, fixture, 0);
  await expect(
    question(page, fixture.questionIds[0]!).getByRole("radio", {
      name: "The complete process",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    question(page, fixture.questionIds[1]!).getByRole("radio", { name: "4", exact: true }),
  ).not.toBeChecked();
  await expect(page.getByText(surveyPagesCopy().resumeHint, { exact: true })).toBeVisible();
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("pollingpops:survey:")),
  );
  expect(keys).toEqual([`pollingpops:survey:${fixture.room.id}`]);
});

test("WX06A1 closed Survey pages retain saved answers for review and expose no submission path", async ({
  page,
}, info) => {
  const fixture = await seed(page, info);
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/(?:draft|submit)$/.test(new URL(request.url()).pathname))
      mutations.push(new URL(request.url()).pathname);
  });
  await page.goto(fixture.participantUrl);
  await atPage(page, fixture, 0);
  await answerFirstPage(page, fixture, false);
  await page.getByRole("button", { name: surveyPagesCopy().saveProgress, exact: true }).click();
  await expect(page.getByText(surveyPagesCopy().saved, { exact: true })).toBeVisible();
  const closed = await page.request.post(`${api}/v1/survey-rooms/${fixture.room.id}/close`, {
    data: { idempotencyKey: randomUUID() },
  });
  expect(closed.status(), await closed.text()).toBe(204);
  await page.reload();
  await atPage(page, fixture, 0);
  await expect(page.getByText(surveyPagesCopy().closed, { exact: true })).toBeVisible();
  await expect(
    question(page, fixture.questionIds[0]!).getByRole("radio", {
      name: "The complete process",
      exact: true,
    }),
  ).toBeChecked();
  await expect(question(page, fixture.questionIds[0]!).getByRole("radio").first()).toBeDisabled();
  await page.getByRole("button", { name: surveyPagesCopy().next, exact: true }).click();
  await atPage(page, fixture, 1);
  await page.getByRole("button", { name: surveyPagesCopy().next, exact: true }).click();
  await atPage(page, fixture, 2);
  await expect(
    page.getByRole("button", { name: surveyPagesCopy().submit, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: surveyPagesCopy().saveProgress, exact: true }),
  ).toBeDisabled();
  expect(mutations).toEqual([`/v1/survey-rooms/${fixture.room.id}/draft`]);
});

test("WX06A1 shared Library page headings and multiline instructions fit 320px in English and Korean light/dark views @mobile", async ({
  page,
  browser,
}, info) => {
  const fixture = await seed(page, info, true);
  const member = await teammate(page, browser, fixture.organizationId, info);
  try {
    const share = await shareSurvey(
      page,
      member.identity.creator.userId,
      fixture.surveyId,
      fixture.versionId,
    );
    await member.page.setViewportSize({ width: 320, height: 844 });
    await member.page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    for (const locale of ["en-CA", "ko-KR"] as const) {
      if (locale === "ko-KR") await chooseKorean(member.page);
      await member.page.goto(`/library/shared/${share.id}`);
      await sharedPagesContent(member.page, fixture, locale);
      const firstPage = member.page.locator("[data-shared-survey-page]").first();
      const instructions = firstPage.getByText(fixture.pages[0]!.description, { exact: true });
      await expect(instructions).toHaveCSS("white-space", "pre-wrap");
      for (const colorScheme of ["light", "dark"] as const) {
        await member.page.emulateMedia({ colorScheme });
        await expect(member.page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
        await expect(member.page.locator("html")).toHaveAttribute("lang", locale);
        const colors = await member.page.evaluate(() => {
          const resolve = (token: string) => {
            const probe = document.createElement("span");
            probe.style.color = `var(${token})`;
            document.documentElement.appendChild(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
          };
          return {
            strong: resolve("--ui-text-strong"),
            muted: resolve("--ui-text-muted"),
            text: resolve("--ui-text"),
          };
        });
        await expect(firstPage.getByRole("heading", { level: 2 })).toHaveCSS(
          "color",
          colors.strong,
        );
        await expect(firstPage.getByRole("heading", { level: 3 }).first()).toHaveCSS(
          "color",
          colors.strong,
        );
        await expect(instructions).toHaveCSS("color", colors.muted);
        await expect(firstPage.locator("li").first()).toHaveCSS("color", colors.text);
        await expect(firstPage.locator("article p > span").first()).toHaveCSS("color", colors.text);
        await fits(member.page);
        expect(
          (
            await new AxeBuilder({ page: member.page })
              .include("main")
              .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        await member.page.screenshot({
          path: info.outputPath(`survey-pages-library-${locale}-${colorScheme}.png`),
          fullPage: true,
          scale: "css",
        });
      }
    }
    const back = member.page.getByRole("link", {
      name: librarySharingMessages("ko-KR").back,
      exact: true,
    });
    await back.focus();
    await member.page.keyboard.press("Enter");
    await expect(member.page).toHaveURL(/\/library\?scope=shared&type=surveys$/);
  } finally {
    await member.context.close();
  }
});

for (const locale of ["en-CA", "ko-KR"] as const) {
  test(`WX06A1 ordered Survey pages fit 320px with keyboard and accessible light/dark controls in ${locale} @mobile`, async ({
    page,
  }, info) => {
    const fixture = await seed(page, info);
    if (locale === "ko-KR") await chooseKorean(page);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(fixture.participantUrl);
    await atPage(page, fixture, 0, locale);
    const answer = question(page, fixture.questionIds[0]!).getByRole("radio", {
      name: "The complete process",
      exact: true,
    });
    await answer.focus();
    await page.keyboard.press("Space");
    await expect(answer).toBeChecked();
    const next = page.getByRole("button", { name: surveyPagesCopy(locale).next, exact: true });
    await next.focus();
    await page.keyboard.press("Enter");
    await atPage(page, fixture, 1, locale);
    await expect(page.locator("[data-survey-page-heading]")).toBeFocused();
    const heading = page.locator("[data-survey-page-heading]");
    // Exercise the valid 160-character title limit without enabling a public v3 writer.
    const originalHeading = await heading.evaluate((element) => {
      const text = element.textContent ?? "";
      element.textContent = "W".repeat(160);
      return text;
    });
    try {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({
        path: info.outputPath(`survey-pages-long-title-${locale}.png`),
        fullPage: true,
        scale: "css",
      });
      await fits(page);
    } finally {
      await heading.evaluate((element, text) => {
        element.textContent = text;
      }, originalHeading);
    }
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await palette(page);
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
        path: info.outputPath(`survey-pages-${locale}-${colorScheme}.png`),
        fullPage: true,
        scale: "css",
      });
    }
    await page.getByRole("button", { name: surveyPagesCopy(locale).back, exact: true }).click();
    await atPage(page, fixture, 0, locale);
    await expect(answer).toBeChecked();
  });
}
