import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { templateLoadError } from "../../apps/web/lib/i18n/presentation-template-copy";
import { practiceManagementCopy } from "../../apps/web/lib/i18n/practice-management-copy";
import { specialistLocale, specialistQuality } from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

test.beforeEach(({ page }) => {
  page.setDefaultTimeout(15_000);
});

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
async function language(page: Page, locale: "en-CA" | "fr-FR" | "ko-KR") {
  const current = await page.locator("html").getAttribute("lang");
  if (current === locale) return;
  await page
    .locator(`summary[role="button"][aria-label^="${current!.slice(0, 2).toUpperCase()}:"]`)
    .first()
    .click();
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/account/locale" &&
      response.request().method() === "PUT",
  );
  await page.locator(`button[role="radio"][lang="${locale}"]`).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}
async function sourceAndPractice(page: Page) {
  const made = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
    data: {},
  });
  expect(made.status()).toBe(201);
  const { quiz } = await made.json();
  const published = await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
    data: { expectedDraftRevision: quiz.draftRevision },
  });
  expect(published.status()).toBe(200);
  const { version } = await published.json();
  const created = await page.request.post(`${api}/v1/quizzes/${quiz.id}/practice-assignments`, {
    data: {
      sourceQuizVersionId: version.id,
      title: "Original practice — 原文",
      timeMode: "timed",
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      personalLabels: [],
    },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).followup as { id: string; title: string };
}

for (const suffix of ["desktop", "phone @mobile"]) {
  test(`Option B shared practice management retains private actions and authored labels across languages ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: suffix === "desktop" ? 1366 : 320, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const target = window as typeof window & { privateCopies?: number };
      target.privateCopies = 0;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            target.privateCopies!++;
          },
        },
      });
    });
    await signInBeta(page);
    const record = await sourceAndPractice(page);
    await specialistLocale(page, "ko-KR");
    await page.goto(`/practice/${record.id}`);
    let copy = practiceManagementCopy("ko-KR");
    await expect(page.getByRole("heading", { name: record.title, exact: true })).toBeVisible();
    await page.locator("#personal-pass-label").fill("Original private label 日本語");
    await page.locator("#accommodation-label").fill("Original timing label");
    await page.locator("#accommodation-time").selectOption("2");
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        ["POST", "DELETE"].includes(request.method()) &&
        new URL(request.url()).pathname.startsWith(`/v1/followups/${record.id}`)
      )
        writes.push(request.method());
    });
    await language(page, "fr-FR");
    copy = practiceManagementCopy("fr-FR");
    await expect(page.locator("#personal-pass-label")).toHaveValue("Original private label 日本語");
    await expect(page.locator("#accommodation-label")).toHaveValue("Original timing label");
    await expect(page.locator("#accommodation-time")).toHaveValue("2");
    expect(writes).toEqual([]);
    await page.getByRole("button", { name: copy("Create personal link"), exact: true }).click();
    await expect(page.locator("#latest-practice-link")).toBeVisible();
    const url = await page.locator("#latest-practice-link").inputValue();
    expect(url).toMatch(/#token=/);
    await language(page, "ko-KR");
    copy = practiceManagementCopy("ko-KR");
    await expect(page.locator("#latest-practice-link")).toHaveValue(url);
    expect(writes).toEqual(["POST"]);
    expect(
      await page.evaluate(
        () => (window as typeof window & { privateCopies?: number }).privateCopies,
      ),
    ).toBe(0);
    await page.getByRole("button", { name: copy("Copy"), exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as typeof window & { privateCopies?: number }).privateCopies),
      )
      .toBe(1);
    await specialistQuality(page);
    await mkdir("artifacts/option-b-remaining", { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/option-b-remaining/${info.project.name}-management.png`,
      fullPage: true,
      mask: [page.locator("#latest-practice-link")],
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("row")
      .filter({ hasText: "Original private label 日本語" })
      .getByRole("button", { name: copy("Revoke"), exact: true })
      .click();
    await expect(page.locator("#latest-practice-link")).toHaveCount(0);
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: copy("Close practice for everyone"), exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: copy("Close practice for everyone"), exact: true }),
    ).toHaveCount(0);
    const detail = await page.request.get(`${api}/v1/followups/${record.id}`);
    expect((await detail.json()).followup.closedAt).toBeTruthy();
  });

  test(`Option B creates localized Presentation content and preserves failed-request language ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: suffix === "desktop" ? 1366 : 320, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    await specialistLocale(page, "en-CA");
    await page.goto("/templates");
    await page.locator("#template-tab-presentations").click();
    const card = page.locator('[data-template-id="native-startup-pitch"]');
    await expect(card).toBeVisible();
    const localized = JSON.parse(
      await readFile(resolve("apps/web/lib/presentation-template-locales/fr-FR.json"), "utf8"),
    );
    let rejectedCatalog = false;
    let catalogUnavailable = true;
    await page.route("**/_next/static/chunks/**", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (catalogUnavailable && body.includes(localized.native[0].slides[0].title)) {
        rejectedCatalog = true;
        return route.fulfill({ status: 503, contentType: "application/javascript", body: "" });
      }
      return route.fulfill({ response });
    });
    await language(page, "fr-FR");
    const loadError = page.getByRole("alert").filter({ hasText: templateLoadError("fr-FR") });
    await expect(loadError).toBeVisible();
    expect(rejectedCatalog).toBe(true);
    await expect(card).toHaveCount(0);
    catalogUnavailable = false;
    await loadError.locator("..").getByRole("button").click();
    await expect(card.getByRole("heading")).toHaveText(localized.native[0].title);
    await page.unroute("**/_next/static/chunks/**");
    await specialistQuality(page);
    const bodies: string[] = [];
    let loseAcknowledgement = true;
    await page.route("**/v1/presentations/*/draft", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      bodies.push(route.request().postData()!);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        const accepted = await route.fetch();
        expect(accepted.status()).toBe(200);
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: "Synthetic lost acknowledgement",
              requestId: randomUUID(),
            },
          }),
        });
      }
      await route.continue();
    });
    await card.getByRole("button").first().click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await language(page, "ko-KR");
    expect(bodies).toHaveLength(1);
    await card.getByRole("button").first().click();
    await expect(page).toHaveURL(/\/presentation\/[^/]+$/);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    const payload = JSON.parse(bodies[0]!);
    expect(payload.draft.title).toBe(localized.native[0].title);
    expect(payload.draft.blocks[0].scene.nodes[0].text).toBe(localized.native[0].slides[0].title);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const stored = (await (await page.request.get(`${api}/v1/presentations/${id}`)).json())
      .presentation;
    expect(stored.draft).toEqual(payload.draft);
    // The full-screen editor exposes a Library return; workspace preferences live there.
    const editorUrl = page.url();
    await page.locator('a[href="/library?type=presentations"]').click();
    await expect(page).toHaveURL(/\/library\?type=presentations$/);
    await language(page, "en-CA");
    await page.goto(editorUrl);
    const after = (await (await page.request.get(`${api}/v1/presentations/${id}`)).json())
      .presentation;
    expect(after.draft).toEqual(payload.draft);
    expect(after.draftRevision).toBe(stored.draftRevision);
    await specialistQuality(page);
    await mkdir("artifacts/option-b-remaining", { recursive: true });
    await page.screenshot({
      path: `artifacts/option-b-remaining/${info.project.name}-creation.png`,
    });
  });

  test(`Option B localized Round and Survey starter creation keeps reviewed and retried language ${suffix}`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: suffix === "desktop" ? 1366 : 320, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    await specialistLocale(page, "ko-KR");
    const starterId = "new-hire-knowledge-check";
    const french = await (
      await page.request.get(`${api}/v1/starters/${starterId}?locale=fr-FR`)
    ).json();
    const korean = await (
      await page.request.get(`${api}/v1/starters/${starterId}?locale=ko-KR`)
    ).json();
    await page.goto("/templates");
    let card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: korean.draft.title, exact: true }) });
    await card.getByRole("button").first().click();
    await expect(card.locator("ol > li").first()).toContainText(korean.draft.questions[0].prompt);
    await language(page, "fr-FR");
    card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: french.draft.title, exact: true }) });
    await expect(card.locator("ol").first()).toHaveAttribute("lang", "ko-KR");
    await card.getByRole("button").last().click();
    await expect(page).toHaveURL(/\/quiz\/[^/]+$/);
    const roundId = new URL(page.url()).pathname.split("/").at(-1)!;
    const round = (await (await page.request.get(`${api}/v1/quizzes/${roundId}`)).json()).quiz;
    expect(round.draft.title).toBe(french.draft.title);
    expect(round.draft.questions[0].prompt).toBe(french.draft.questions[0].prompt);
    await specialistQuality(page);

    const summaries = (await (await page.request.get(`${api}/v1/starters?locale=fr-FR`)).json())
      .starters as { id: string; title: string; responseTypes: string[] }[];
    const feedback = summaries.find((entry) =>
      entry.responseTypes.every((type) => type === "poll" || type === "rating"),
    )!;
    const koSummaries = (await (await page.request.get(`${api}/v1/starters?locale=ko-KR`)).json())
      .starters as typeof summaries;
    await page.goto("/templates");
    await page.locator("#template-tab-surveys").click();
    card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: feedback.title, exact: true }) });
    const requests: string[] = [];
    let loseAcknowledgement = true;
    await page.route("**/v1/surveys", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      requests.push(route.request().postData()!);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: "Synthetic lost Survey acknowledgement",
              requestId: randomUUID(),
            },
          }),
        });
      }
      return route.continue();
    });
    await card.getByRole("button").last().click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await language(page, "ko-KR");
    card = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: koSummaries.find((entry) => entry.id === feedback.id)!.title,
        exact: true,
      }),
    });
    await card.getByRole("button").last().click();
    await expect(page).toHaveURL(/\/surveys\/[^/]+$/);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    expect(JSON.parse(requests[0]!).locale).toBe("fr-FR");
    const surveyId = new URL(page.url()).pathname.split("/").at(-1)!;
    const survey = (await (await page.request.get(`${api}/v1/surveys/${surveyId}`)).json()).survey;
    expect(survey.draft.title).toBe(feedback.title);
    await specialistQuality(page);
  });
}
