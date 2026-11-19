import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { SURVEY_READER_HEADER, type SurveyResponses } from "../../packages/contracts/src/surveys";
import { validateSurveyBranchingResponses } from "../../packages/contracts/src/survey-branching";
import {
  branchingId as id,
  surveyBranchingFixture,
} from "../../packages/contracts/test/support/survey-branching-fixture";
import type { SurveyAttempt } from "../../apps/web/lib/survey-client";
import { surveyPagesCopy } from "../../apps/web/lib/i18n/survey-pages-copy";

const api = "http://127.0.0.1:4400";
const roomId = id(9100);
const storageKey = `pollingpops:survey:${roomId}`;
const copy = surveyPagesCopy();
const choice = (question: number, selected = 1) => ({
  kind: "poll" as const,
  choiceIds: [id(question * 100 + selected)],
});
const rating = (value: number) => ({ kind: "rating" as const, value });
const currentPage = (page: Page) => page.locator("[data-survey-page]");
const question = (page: Page, index: number) =>
  page.locator(`[data-survey-question="${id(index)}"]`);
const action = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

interface GuestRequest {
  method: string;
  path: string;
  body: string | null;
  token: string | undefined;
  schema: string | undefined;
  cookie: string | undefined;
}

/** Frozen snapshots and accepted receipts live only inside this browser test, never a writer. */
async function mockGuest(
  page: Page,
  responses: SurveyResponses = {},
  state: Partial<Pick<SurveyAttempt, "closed" | "finalized" | "receipt">> = {},
) {
  const content = surveyBranchingFixture();
  let saved: SurveyAttempt = {
    roomId,
    content,
    closesAt: "2099-12-31T00:00:00.000Z",
    closed: false,
    revision: 0,
    responses,
    finalized: false,
    receipt: null,
    ...state,
  };
  const traffic: GuestRequest[] = [];
  const writes: GuestRequest[] = [];
  const receipts = new Map<string, { body: string; attempt: SurveyAttempt }>();
  let nextReply: "accepted" | "unavailable" | "stale-answers" = "accepted";
  const headers = {
    "access-control-allow-origin": "http://127.0.0.1:3400",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": `authorization, content-type, ${SURVEY_READER_HEADER}`,
  };
  await page.route(`${api}/v1/survey-rooms/${roomId}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const requestHeaders = await request.allHeaders();
    const operation: GuestRequest = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postData(),
      token: requestHeaders.authorization,
      schema: requestHeaders[SURVEY_READER_HEADER],
      cookie: requestHeaders.cookie,
    };
    traffic.push(operation);
    const endpoint = operation.path.split("/").at(-1);
    if (endpoint === "public") {
      await route.fulfill({ headers, json: { room: { passwordRequired: false } } });
      return;
    }
    if (endpoint === "attempt" || endpoint === "join") {
      await route.fulfill({ headers, json: { attempt: saved } });
      return;
    }
    expect(["draft", "submit"]).toContain(endpoint);
    expect(operation.method).toBe("POST");
    writes.push(operation);
    const body = JSON.parse(operation.body!) as {
      expectedRevision: number;
      idempotencyKey: string;
      responses: SurveyResponses;
    };
    const receipt = receipts.get(body.idempotencyKey);
    if (receipt) {
      expect(operation.body).toBe(receipt.body);
      await route.fulfill({ headers, json: { attempt: receipt.attempt } });
      return;
    }
    expect(saved.closed).toBe(false);
    expect(saved.finalized).toBe(false);
    expect(body.expectedRevision).toBe(saved.revision);
    expect(
      validateSurveyBranchingResponses(content, body.responses, endpoint === "submit"),
    ).toEqual([]);
    const previous = structuredClone(saved);
    saved = {
      ...saved,
      responses: structuredClone(body.responses),
      revision: saved.revision + 1,
      finalized: endpoint === "submit",
      receipt: endpoint === "submit" ? "synthetic-completion-receipt" : null,
    };
    receipts.set(body.idempotencyKey, {
      body: operation.body!,
      attempt: structuredClone(saved),
    });
    const reply = nextReply;
    nextReply = "accepted";
    if (reply === "unavailable") {
      // The mutation committed, but its acknowledgement cannot be confirmed by this client.
      await route.fulfill({
        status: 503,
        headers,
        json: { error: { code: "INTERNAL_ERROR", message: "Synthetic lost acknowledgement" } },
      });
    } else {
      await route.fulfill({
        headers,
        json: {
          attempt: reply === "stale-answers" ? { ...saved, responses: previous.responses } : saved,
        },
      });
    }
  });
  return {
    traffic,
    writes,
    saved: () => structuredClone(saved),
    reply: (value: typeof nextReply) => {
      nextReply = value;
    },
    reviewDraft: () => {
      saved = { ...saved, finalized: false, receipt: null };
    },
  };
}

async function atPage(
  page: Page,
  authoredIndex: number,
  visibleIndex: number,
  count: number,
  focused = true,
) {
  await expect(currentPage(page)).toHaveAttribute("data-survey-page", id(authoredIndex + 10));
  await expect(page.locator("[data-survey-page-progress]")).toHaveText(
    copy.pageProgress.replace("{page}", String(visibleIndex)).replace("{count}", String(count)),
  );
  if (focused) await expect(page.locator("[data-survey-page-heading]")).toBeFocused();
}

async function accessibleAndFits(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, scale: "css" });
}

async function credentialOnly(page: Page, credential: string) {
  expect(
    await page.evaluate(() =>
      Object.entries(localStorage).filter(([key]) => key.startsWith("pollingpops:survey:")),
    ),
  ).toEqual([[storageKey, credential]]);
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

for (const device of ["desktop", "@mobile"]) {
  test(`B2 conditional pages clear cascades, retry exact saves, and resume saved answers ${device}`, async ({
    page,
  }, info) => {
    const fixture = await mockGuest(page);
    await page.goto(`/survey/${roomId}`);
    await atPage(page, 1, 1, 2);
    await accessibleAndFits(page, info, "branching-initial");
    await action(page, copy.next).click();
    await expect(currentPage(page).getByRole("alert")).toHaveText(copy.requiredError);
    await expect(question(page, 1).getByRole("radio").first()).toBeFocused();
    expect(fixture.writes).toEqual([]);
    await question(page, 1).getByRole("radio", { name: "Yes", exact: true }).check();
    await expect(page.locator("[data-survey-page-progress]")).toHaveText("Page 1 of 3");
    const credential = await page.evaluate((key) => localStorage.getItem(key)!, storageKey);
    fixture.reply("unavailable");
    await question(page, 1).getByRole("radio", { name: "Yes", exact: true }).press("Enter");
    await expect(page.locator("main").getByRole("alert")).toContainText(copy.saveError);
    await expect(action(page, copy.retrySave)).toBeEnabled();
    await expect(action(page, copy.back)).toBeDisabled();
    await expect(action(page, copy.next)).toBeDisabled();
    await expect(question(page, 1).getByRole("radio").first()).toBeDisabled();
    const first = fixture.writes[0]!;
    await page.evaluate((key) => localStorage.setItem(key, "changed-during-pending"), storageKey);
    await action(page, copy.retrySave).click();
    await atPage(page, 2, 2, 3);
    expect(fixture.writes[1]).toEqual(first);
    await page.evaluate(({ key, token }) => localStorage.setItem(key, token), {
      key: storageKey,
      token: credential,
    });
    await action(page, copy.next).click();
    await expect(currentPage(page).getByRole("alert")).toHaveText(copy.requiredError);
    await expect(question(page, 2).getByRole("radio").first()).toBeFocused();
    await question(page, 2).getByRole("radio", { name: "Yes", exact: true }).check();
    await action(page, copy.next).click();
    await atPage(page, 3, 3, 4);
    await question(page, 3).getByRole("radio", { name: "4", exact: true }).check();
    await action(page, copy.saveProgress).click();
    await expect(page.getByRole("status").filter({ hasText: copy.saved })).toBeVisible();
    await atPage(page, 3, 3, 4, false);
    await action(page, copy.next).click();
    await atPage(page, 4, 4, 4);
    await action(page, copy.back).click();
    await atPage(page, 3, 3, 4);
    await expect(question(page, 3).getByRole("radio", { name: "4", exact: true })).toBeChecked();
    await action(page, copy.back).click();
    await atPage(page, 2, 2, 4);
    await expect(question(page, 2).getByRole("radio", { name: "Yes", exact: true })).toBeChecked();
    await action(page, copy.back).click();
    await atPage(page, 1, 1, 4);
    await question(page, 1).getByRole("radio", { name: "No", exact: true }).check();
    await expect(page.locator("[data-survey-page-progress]")).toHaveText("Page 1 of 2");
    const revision = fixture.saved().revision;
    fixture.reply("stale-answers");
    await action(page, copy.next).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(copy.saveError);
    const cleanup = fixture.writes.at(-1)!;
    expect(JSON.parse(cleanup.body!)).toMatchObject({
      expectedRevision: revision,
      responses: { [id(1)]: choice(1, 2) },
    });
    await expect(currentPage(page)).toHaveAttribute("data-survey-page", id(11));
    await expect(action(page, copy.next)).toBeDisabled();
    await expect(question(page, 1).getByRole("radio", { name: "No", exact: true })).toBeChecked();
    await action(page, copy.retrySave).click();
    await atPage(page, 4, 2, 2);
    expect(fixture.writes.at(-1)).toEqual(cleanup);
    expect(fixture.saved().responses).toEqual({ [id(1)]: choice(1, 2) });
    await action(page, copy.back).click();
    await question(page, 1).getByRole("radio", { name: "Yes", exact: true }).check();
    await action(page, copy.next).click();
    await atPage(page, 2, 2, 3);
    await expect(
      question(page, 2).getByRole("radio", { name: "Yes", exact: true }),
    ).not.toBeChecked();
    await expect(
      question(page, 2).getByRole("radio", { name: "No", exact: true }),
    ).not.toBeChecked();
    expect(fixture.saved().responses).toEqual({ [id(1)]: choice(1) });
    await action(page, copy.back).click();
    await atPage(page, 1, 1, 3);
    await page.reload();
    await atPage(page, 2, 2, 3);
    await expect(question(page, 2).getByRole("radio").first()).not.toBeChecked();
    await credentialOnly(page, credential);
    await accessibleAndFits(page, info, "branching-reopened-unanswered");
    await question(page, 2).getByRole("radio", { name: "No", exact: true }).check();
    await action(page, copy.next).click();
    await atPage(page, 4, 3, 3);
    await expect(question(page, 3)).toHaveCount(0);
    await action(page, copy.submit).click();
    await expect(page.getByRole("heading", { name: "Thank you", exact: true })).toBeVisible();
    expect(fixture.saved()).toMatchObject({
      responses: { [id(1)]: choice(1), [id(2)]: choice(2, 2) },
      finalized: true,
    });
    expect(fixture.traffic.every((request) => request.schema === "4" && !request.cookie)).toBe(
      true,
    );
    expect(fixture.writes.every((request) => request.token === `Bearer ${credential}`)).toBe(true);
    await credentialOnly(page, credential);
  });

  test(`B2 retained closed conditional attempts review saved visible pages read-only ${device}`, async ({
    page,
  }, info) => {
    const saved = { [id(1)]: choice(1), [id(2)]: choice(2, 2), [id(4)]: rating(3) };
    const fixture = await mockGuest(page, saved, {
      closed: true,
      finalized: true,
      receipt: "synthetic-retained-receipt",
    });
    const credential = "synthetic-room-only-credential";
    await page.addInitScript(({ key, token }) => localStorage.setItem(key, token), {
      key: storageKey,
      token: credential,
    });
    await page.goto(`/survey/${roomId}`);
    await atPage(page, 4, 3, 3);
    await expect(page.getByRole("heading", { name: "Thank you", exact: true })).toBeVisible();
    await expect(page.getByText(copy.closed, { exact: true })).toBeVisible();
    await expect(question(page, 4).getByRole("radio", { name: "3", exact: true })).toBeChecked();
    await expect(question(page, 4).getByRole("radio").first()).toBeDisabled();
    await expect(action(page, copy.submit)).toHaveCount(0);
    await expect(action(page, copy.saveProgress)).toBeDisabled();
    await action(page, copy.back).click();
    await atPage(page, 2, 2, 3);
    await expect(question(page, 2).getByRole("radio", { name: "No", exact: true })).toBeChecked();
    await expect(question(page, 2).getByRole("radio").first()).toBeDisabled();
    await action(page, copy.back).click();
    await atPage(page, 1, 1, 3);
    await expect(question(page, 1).getByRole("radio", { name: "Yes", exact: true })).toBeChecked();
    await expect(action(page, copy.back)).toBeDisabled();
    await action(page, copy.next).click();
    await atPage(page, 2, 2, 3);
    await action(page, copy.next).click();
    await atPage(page, 4, 3, 3);
    await expect(question(page, 3)).toHaveCount(0);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
      await accessibleAndFits(page, info, `branching-retained-${colorScheme}`);
    }
    await action(page, copy.back).click();
    await page.reload();
    await atPage(page, 4, 3, 3);
    fixture.reviewDraft();
    await page.reload();
    await atPage(page, 4, 3, 3);
    await expect(page.getByRole("heading", { name: "Thank you", exact: true })).toHaveCount(0);
    await expect(page.getByText(copy.closed, { exact: true })).toBeVisible();
    await expect(question(page, 4).getByRole("radio").first()).toBeDisabled();
    expect(fixture.saved().responses).toEqual(saved);
    expect(fixture.writes).toEqual([]);
    expect(fixture.traffic.every((request) => request.schema === "4" && !request.cookie)).toBe(
      true,
    );
    await credentialOnly(page, credential);
  });
}
