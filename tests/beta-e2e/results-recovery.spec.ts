import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FollowupSummarySchema, ReportSummarySchema } from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";
import {
  expectDocumentReflow,
  expectVisibleKeyboardFocus,
  tabKey,
  tabTo,
} from "./option-b-accessibility-support";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const reportsPath = "/v1/reports";
const reportTotalsPath = "/v1/reports/totals";
const longTitle = "Synthetic workshop · 함께 검토 · " + "LongUnbrokenTitle".repeat(5);
const views = [
  { key: "results", path: reportsPath, search: "Search Round results" },
  { key: "practice", path: "/v1/followups", search: "Search practice" },
  {
    key: "presentations",
    path: "/v1/presentation-sessions",
    search: "Search Presentation results",
  },
  { key: "surveys", path: "/v1/survey-rooms", search: "Search Survey results" },
] as const;
const modes = [
  { name: "light", colorScheme: "light", forcedColors: "none" },
  { name: "dark", colorScheme: "dark", forcedColors: "none" },
  { name: "high-contrast", colorScheme: "light", forcedColors: "active" },
] as const;

async function quality(page: Page) {
  await expectDocumentReflow(page);
  const clippedControls = await page
    .locator("#results-panel input, #results-panel select")
    .evaluateAll((controls) =>
      controls.flatMap((control) => {
        const rect = control.getBoundingClientRect();
        const field = control.closest("label")?.getBoundingClientRect();
        const left = Math.max(0, field?.left ?? 0);
        const right = Math.min(innerWidth, field?.right ?? innerWidth);
        return rect.width && (rect.left < left - 1 || rect.right > right + 1)
          ? [
              {
                tag: control.tagName,
                type: control.getAttribute("type"),
                left: rect.left,
                right: rect.right,
                fieldRight: field?.right,
                viewport: innerWidth,
              },
            ]
          : [];
      }),
    );
  expect(clippedControls).toEqual([]);
  expect(
    (
      await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

async function signedInWorkspaceId(page: Page) {
  const account = await page.request.get(`${api}/v1/auth/me`);
  await expect(account).toBeOK();
  const { creator } = (await account.json()) as { creator: { workspaceId: string } };
  return creator.workspaceId;
}

async function expectNoLoadedReportMetrics(overview: Locator) {
  await expect(overview.getByText("Results shown", { exact: true })).toHaveCount(0);
  await expect(overview.getByText("Participant joins", { exact: true })).toHaveCount(0);
  await expect(overview.getByText(/loaded (?:reports|results)/)).toHaveCount(0);
  await expect(overview.getByRole("region", { name: "Activity over time" })).toHaveCount(0);
  await expect(overview.getByRole("meter")).toHaveCount(0);
}

async function installHistory(page: Page) {
  const quizId = randomUUID();
  const createdAt = "2026-10-01T12:00:00.000Z";
  const expiresAt = "2099-10-01T12:00:00.000Z";
  const report = ReportSummarySchema.parse({
    id: randomUUID(),
    sessionId: randomUUID(),
    quizId,
    title: longTitle,
    status: "ready",
    trustMode: "learning",
    participantCount: 12,
    initialAccuracyPercent: 60,
    recovery: { recovered: 3, eligible: 4, percent: 75 },
    unresolvedConceptCount: 1,
    interventionCount: 2,
    followupId: null,
    followupStatus: null,
    generatedAt: createdAt,
    createdAt,
    expiresAt,
  });
  const practice = FollowupSummarySchema.parse({
    id: randomUUID(),
    purpose: "assignment",
    sourceSessionId: null,
    sourceReportId: null,
    sourceQuizVersionId: randomUUID(),
    quizId,
    recoveryPackSource: null,
    trustMode: "learning",
    title: longTitle,
    status: "open",
    conceptKeys: [],
    checkpointCount: 2,
    attemptCount: 12,
    completedAttemptCount: 9,
    opensAt: createdAt,
    closesAt: "2099-09-01T12:00:00.000Z",
    expiresAt,
    createdAt,
  });
  const histories: Record<string, { envelope: string; rows: Array<{ title: string }> }> = {
    [reportsPath]: { envelope: "items", rows: [report] },
    "/v1/followups": { envelope: "items", rows: [practice] },
    "/v1/presentation-sessions": {
      envelope: "sessions",
      rows: [
        {
          id: randomUUID(),
          presentationId: randomUUID(),
          title: longTitle,
          status: "finished",
          phase: "finished",
          blockCount: 4,
          participantCount: 12,
          responseCount: 24,
          createdAt,
          finishedAt: createdAt,
        } as { title: string },
      ],
    },
    "/v1/survey-rooms": {
      envelope: "rooms",
      rows: [
        {
          id: randomUUID(),
          surveyId: randomUUID(),
          title: longTitle,
          code: "3456789",
          closed: true,
          closesAt: createdAt,
          expiresAt,
        } as { title: string },
      ],
    },
  };
  const allowed = new Set<string>();
  const reads: Array<{ path: string; query: string }> = [];
  const mutations: string[] = [];
  const gates = new Map<string, { promise: Promise<void>; release: () => void; held: boolean }>();
  for (const path of [...Object.keys(histories), reportTotalsPath]) {
    let release!: () => void;
    const promise = new Promise<void>((done) => {
      release = done;
    });
    gates.set(path, { promise, release, held: false });
  }
  await page.route(`${api}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      if (
        /^\/v1\/(?:reports|followups|presentation-sessions|survey-rooms)(?:\/|$)/.test(url.pathname)
      )
        mutations.push(`${request.method()} ${url.pathname}`);
      return route.continue();
    }
    if (url.pathname === "/v1/quizzes")
      return route.fulfill({
        json: { quizzes: [{ id: quizId, title: "Synthetic source Round" }] },
      });
    const history = histories[url.pathname];
    const isReportTotals = url.pathname === reportTotalsPath;
    if (!history && !isReportTotals) return route.continue();
    reads.push({ path: url.pathname, query: url.search });
    const gate = gates.get(url.pathname)!;
    if (allowed.has(url.pathname) && !gate.held) {
      gate.held = true;
      await gate.promise;
    }
    if (!allowed.has(url.pathname))
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "UNAVAILABLE",
            message: "Synthetic results read unavailable",
            requestId: "synthetic-read",
          },
        },
      });
    const search = url.searchParams.get("search")?.toLocaleLowerCase() ?? "";
    const matchesSearch = (row: { title: string }) =>
      row.title.toLocaleLowerCase().includes(search);
    if (isReportTotals)
      return route.fulfill({
        json: { ready: Number(matchesSearch(report)), pending: 0, failed: 0 },
      });
    return route.fulfill({
      json: {
        [history.envelope]: history.rows.filter(matchesSearch),
        ...(history.envelope === "sessions" ? {} : { nextCursor: null }),
      },
    });
  });
  return {
    reads,
    mutations,
    allow: (path: string) => {
      allowed.add(path);
    },
    fail: (path: string) => {
      allowed.delete(path);
      gates.get(path)!.release();
    },
    release: (path: string) => gates.get(path)!.release(),
    releaseAll: () => {
      for (const gate of gates.values()) gate.release();
    },
  };
}

test("Results keeps exact totals while the first report page loads or fails", async ({ page }) => {
  await signInBeta(page, undefined, { returnTo: "/results" });
  await specialistLocale(page, "en-CA");
  const expectedWorkspaceId = await signedInWorkspaceId(page);
  const fixture = await installHistory(page);
  try {
    fixture.allow(reportsPath);
    fixture.allow(reportTotalsPath);
    fixture.release(reportTotalsPath);
    await page.goto("/results?q=workshop");
    const panel = page.locator("#results-panel");
    const overview = panel.getByRole("region", { name: "Results analytics", exact: true });
    const matchingReports = overview.getByText("Matching reports", { exact: true });
    const matchingCount = matchingReports.locator("..").locator("dd");
    await expect(matchingCount).toHaveText("1");
    await expect(panel).toHaveAttribute("aria-busy", "true");
    await expect(panel.getByRole("article")).toHaveCount(0);
    await expectNoLoadedReportMetrics(overview);

    const queriesFor = (path: string) =>
      fixture.reads
        .filter((read) => read.path === path)
        .map((read) => Object.fromEntries(new URLSearchParams(read.query)));
    const scopedFilters = { expectedWorkspaceId, search: "workshop" };
    await expect.poll(() => queriesFor(reportsPath)).toEqual([{ limit: "25", ...scopedFilters }]);
    expect(queriesFor(reportTotalsPath)).toEqual([scopedFilters]);
    fixture.fail(reportsPath);
    await expect(panel).toHaveAttribute("aria-busy", "false");
    const retry = panel.getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeVisible();
    await expect(matchingCount).toHaveText("1");
    await expect(panel.getByText(/^0 results shown$/)).toHaveCount(0);
    await expectNoLoadedReportMetrics(overview);

    const readsBeforeRetry = fixture.reads.length;
    fixture.allow(reportsPath);
    await retry.click();
    await expect(panel.getByRole("article")).toHaveCount(1);
    await expect(matchingCount).toHaveText("1");
    await expect(overview.getByText("Participant joins", { exact: true })).toBeVisible();
    expect(fixture.reads.slice(readsBeforeRetry).map(({ path }) => path)).toEqual([reportsPath]);
    expect(queriesFor(reportsPath)).toEqual([
      { limit: "25", ...scopedFilters },
      { limit: "25", ...scopedFilters },
    ]);
  } finally {
    fixture.releaseAll();
  }
});

for (const phone of [false, true]) {
  test(`Results keeps failed evidence unknown and restores keyboard continuity${phone ? " @mobile" : ""}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: phone ? 320 : 1440, height: phone ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/results" });
    await specialistLocale(page, "en-CA");
    const expectedWorkspaceId = await signedInWorkspaceId(page);
    const fixture = await installHistory(page);
    try {
      for (const view of views) {
        await page.goto(
          `/results?${new URLSearchParams({ ...(view.key === "results" ? {} : { view: view.key }), q: "workshop" })}`,
        );
        const panel = page.locator("#results-panel");
        const retry = panel.getByRole("button", { name: "Try again", exact: true });
        await expect(retry).toBeVisible();
        await expect(page.getByText(/^0 (?:results|practice items) shown$/)).toHaveCount(0);
        await expect(panel.getByRole("article")).toHaveCount(0);
        if (view.key === "results") {
          const overview = panel.getByRole("region", { name: "Results analytics", exact: true });
          await expect(overview.getByRole("status")).toHaveText(
            "Full report totals could not load.",
          );
          await expect(overview.getByText("Matching reports", { exact: true })).toHaveCount(0);
          await expectNoLoadedReportMetrics(overview);
        }
        await quality(page);
        if (view.key === "results")
          await panel.screenshot({
            path: info.outputPath("initial-error-light.png"),
            scale: "css",
          });
        await page.getByRole("button", { name: "List view", exact: true }).click();
        const lastFailure = fixture.reads.filter((read) => read.path === view.path).at(-1)!;
        const readsBeforeListRetry = fixture.reads.length;
        await tabTo(page, retry);
        await expectVisibleKeyboardFocus(retry);
        fixture.allow(view.path);
        await page.keyboard.press("Enter");
        await expect(panel).toBeFocused();
        await expect(panel).toHaveAttribute("aria-busy", "true");
        await expect(page.getByText(/^0 (?:results|practice items) shown$/)).toHaveCount(0);
        if (view.key === "results") {
          await quality(page);
          await panel.screenshot({
            path: info.outputPath("retry-loading-light.png"),
            scale: "css",
          });
        }
        fixture.release(view.path);
        await expect(panel).toHaveAttribute("aria-busy", "false");
        await expect(panel.getByRole("article")).toHaveCount(1);
        expect(fixture.reads.filter((read) => read.path === view.path).at(-1)!.query).toBe(
          lastFailure.query,
        );
        await expect(panel.locator("section[data-view]")).toHaveAttribute("data-view", "list");

        if (view.key === "results") {
          expect(fixture.reads.slice(readsBeforeListRetry)).toEqual([lastFailure]);
          const overview = panel.getByRole("region", { name: "Results analytics", exact: true });
          const heading = overview.getByRole("heading", { name: "Results analytics", exact: true });
          const totalsStatus = overview.getByRole("status");
          const totalsRetry = overview.getByRole("button", {
            name: "Retry report totals",
            exact: true,
          });
          await expect(totalsStatus).toContainText("Full report totals could not load.");
          await expect(overview.getByText(/loaded (?:reports|results)/)).toBeVisible();
          await expect(overview.getByText("Results shown", { exact: true })).toBeVisible();
          await expect(overview.getByText("Matching reports", { exact: true })).toHaveCount(0);
          await expect(panel.getByRole("article")).toHaveCount(1);
          const readsBeforeRetry = fixture.reads.length;
          await tabTo(page, totalsRetry);
          await expectVisibleKeyboardFocus(totalsRetry);
          fixture.allow(reportTotalsPath);
          await page.keyboard.press("Enter");
          await expect(heading).toBeFocused();
          await expect(totalsStatus).toContainText("Loading totals for all matching reports…");
          await expect(panel.getByRole("article")).toHaveCount(1);
          fixture.release(reportTotalsPath);
          const matchingReports = overview.getByText("Matching reports", { exact: true });
          await expect(matchingReports.locator("..").locator("dd")).toHaveText("1");
          await expect(totalsRetry).toHaveCount(0);
          const [totalsRead, ...extraReads] = fixture.reads.slice(readsBeforeRetry);
          expect(extraReads).toEqual([]);
          expect(totalsRead?.path).toBe(reportTotalsPath);
          expect(Object.fromEntries(new URLSearchParams(totalsRead?.query))).toEqual({
            expectedWorkspaceId,
            search: "workshop",
          });
          await expect(heading).toBeFocused();
          await page.keyboard.press(tabKey(page));
          await expect(
            overview.getByRole("combobox", { name: "Group by", exact: true }),
          ).toBeFocused();
        }

        const search = page.getByRole("searchbox", { name: view.search, exact: true });
        await search.fill("no-matching-synthetic-evidence");
        await expect
          .poll(() => new URL(page.url()).searchParams.get("q"))
          .toBe("no-matching-synthetic-evidence");
        const heading = panel.getByRole("heading", {
          name:
            view.key === "practice"
              ? "No practice matches these filters."
              : "No results match these filters.",
          exact: true,
        });
        await expect(heading).toBeVisible();
        await quality(page);
        const emptyClear = heading
          .locator("..")
          .getByRole("button", { name: "Clear filters", exact: true });
        await tabTo(page, emptyClear);
        await expectVisibleKeyboardFocus(emptyClear);
        await page.keyboard.press("Enter");
        await expect(search).toBeFocused();
        await expect(search).toHaveValue("");
        await expect(panel.getByRole("article")).toHaveCount(1);
        await expect(panel.locator("section[data-view]")).toHaveAttribute("data-view", "list");
        expect(new URL(page.url()).searchParams.get("view") ?? "results").toBe(view.key);

        await search.fill("workshop");
        await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("workshop");
        await expect(panel.getByRole("article")).toHaveCount(1);
        const toolbarClear = panel.getByRole("button", { name: "Clear filters", exact: true });
        await tabTo(page, toolbarClear);
        await page.keyboard.press("Enter");
        await expect(search).toBeFocused();
        await expect(search).toHaveValue("");
        await expect(panel.getByRole("article")).toHaveCount(1);
        await quality(page);
        await panel.screenshot({
          path: info.outputPath(`${view.key}-list-light.png`),
          scale: "css",
        });
      }
      await page.goto("/results");
      const panel = page.locator("#results-panel");
      await expect(panel.getByRole("article")).toHaveCount(1);
      for (const mode of modes) {
        await page.emulateMedia({ colorScheme: mode.colorScheme, forcedColors: mode.forcedColors });
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode.colorScheme);
        for (const layout of ["grid", "list"] as const) {
          await page
            .getByRole("button", {
              name: `${layout === "grid" ? "Grid" : "List"} view`,
              exact: true,
            })
            .click();
          await quality(page);
          await panel.screenshot({
            path: info.outputPath(`rounds-${layout}-${mode.name}.png`),
            scale: "css",
          });
        }
      }
      expect(fixture.mutations).toEqual([]);
    } finally {
      fixture.releaseAll();
    }
  });
}
