import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  FollowupSummarySchema,
  PresentationResultSummarySchema,
  ReportSummarySchema,
} from "../../packages/contracts/src/index.ts";
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
const reportSourcesPath = "/v1/reports/sources";
const practicePath = "/v1/followups";
const practiceAnalyticsPath = "/v1/followups/analytics";
const presentationResultsPath = "/v1/presentation-sessions/results";
const presentationAnalyticsPath = `${presentationResultsPath}/analytics`;
const presentationSourcesPath = `${presentationResultsPath}/sources`;
const surveyResultsPath = "/v1/survey-rooms/results";
const surveyAnalyticsPath = `${surveyResultsPath}/analytics`;
const surveySourcesPath = `${surveyResultsPath}/sources`;
const longTitle = "Synthetic workshop · 함께 검토 · " + "LongUnbrokenTitle".repeat(5);
const views = [
  { key: "results", path: reportsPath, search: "Search Round results" },
  { key: "practice", path: practicePath, search: "Search practice" },
  {
    key: "presentations",
    path: presentationResultsPath,
    search: "Search Presentation results",
  },
  { key: "surveys", path: surveyResultsPath, search: "Search Survey results" },
] as const;
const historyAnalytics = {
  results: {
    kind: "report",
    activityBasis: "Grouped by report creation date in UTC.",
    path: reportTotalsPath,
    collectionLabel: "Results",
    countLabel: "Matching reports",
    shortcutLabel: "Reports to open",
    emptyMessage: "No reports match these filters.",
    errorMessage: "Report totals and activity could not load.",
    loadingMessage: "Loading report totals and activity…",
    scopeMessage: "Report totals and activity include every page matching your filters.",
    retryLabel: "Retry report analytics",
    query: { includeActivity: "true" },
  },
  practice: {
    kind: "practice",
    activityBasis: "Grouped by practice creation date in UTC.",
    path: practiceAnalyticsPath,
    collectionLabel: "Practice assignments and follow-ups",
    countLabel: "Matching practice items",
    shortcutLabel: "Practice to review",
    emptyMessage: "No practice items match these filters.",
    errorMessage: "Practice totals and activity could not load.",
    loadingMessage: "Loading practice totals and activity…",
    scopeMessage: "Practice totals and activity include every page matching your filters.",
    retryLabel: "Retry practice analytics",
    query: {},
  },
  presentations: {
    kind: "session",
    activityBasis: "Grouped by session creation date in UTC.",
    path: presentationAnalyticsPath,
    collectionLabel: "Presentation Results",
    countLabel: "Matching sessions",
    shortcutLabel: "Reports to open",
    emptyMessage: "No Presentation sessions match these filters.",
    errorMessage: "Presentation totals and activity could not load.",
    loadingMessage: "Loading Presentation totals and activity…",
    scopeMessage: "Presentation totals and activity include every page matching your filters.",
    retryLabel: "Retry Presentation analytics",
    query: {},
  },
  surveys: {
    kind: "Survey run",
    activityBasis: "Grouped by scheduled collection deadline in UTC.",
    path: surveyAnalyticsPath,
    collectionLabel: "Survey results",
    countLabel: "Matching Survey runs",
    shortcutLabel: "Reports to open",
    emptyMessage: "No Survey runs match these filters.",
    errorMessage: "Survey totals and activity could not load.",
    loadingMessage: "Loading Survey totals and activity…",
    scopeMessage:
      "Totals and activity cover all closed Survey runs that match your filters and have retained results.",
    retryLabel: "Retry Survey analytics",
    query: {},
  },
} as const;
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

type AnalyticsView = (typeof historyAnalytics)[keyof typeof historyAnalytics];

async function expectNoLoadedEvidence(
  overview: Locator,
  analytics: AnalyticsView,
  fullHistory = false,
) {
  await expect(overview.getByText(/^(Results shown|Survey runs shown)$/)).toHaveCount(0);
  if (!fullHistory || (analytics.kind !== "report" && analytics.kind !== "session")) {
    await expect(overview.getByText("Participant joins", { exact: true })).toHaveCount(0);
  }
  await expect(overview.getByText(/loaded (?:reports|results)/)).toHaveCount(0);
  await expect(
    overview.getByRole("region", { name: analytics.shortcutLabel, exact: true }),
  ).toHaveCount(0);
}

const historyActivity = (overview: Locator) =>
  overview.getByRole("region", { name: "Activity over time", exact: true });

async function expectUnknownActivity(overview: Locator, analytics: AnalyticsView) {
  const activity = historyActivity(overview);
  await expect(activity.getByRole("listitem")).toHaveCount(0);
  await expect(activity.getByRole("combobox", { name: "Group by" })).toHaveCount(0);
  await expect(overview.getByText(analytics.emptyMessage, { exact: true })).toHaveCount(0);
}

async function expectOctoberActivity(overview: Locator, analytics: AnalyticsView) {
  const activity = historyActivity(overview);
  await expect(activity).toContainText(analytics.activityBasis);
  await expect(activity.getByRole("listitem")).toHaveText([/Oct.*2026\s*1$/]);
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
  const presentation = PresentationResultSummarySchema.parse({
    id: randomUUID(),
    presentationId: randomUUID(),
    title: longTitle,
    status: "finished",
    reportStatus: "ready",
    phase: "finished",
    blockCount: 4,
    participantCount: 12,
    responseCount: 24,
    createdAt,
    finishedAt: createdAt,
  });
  const survey = {
    id: randomUUID(),
    surveyId: randomUUID(),
    title: longTitle,
    code: "3456789",
    closesAt: createdAt,
    expiresAt,
  };
  const histories: Record<string, Array<{ title: string }>> = {
    [reportsPath]: [report],
    [practicePath]: [practice],
    [presentationResultsPath]: [presentation],
    [surveyResultsPath]: [survey],
  };
  const allowed = new Set<string>();
  const reads: Array<{ path: string; query: string }> = [];
  const mutations: string[] = [];
  const gates = new Map<string, { promise: Promise<void>; release: () => void; held: boolean }>();
  for (const path of [
    ...Object.keys(histories),
    reportTotalsPath,
    reportSourcesPath,
    practiceAnalyticsPath,
    presentationAnalyticsPath,
    presentationSourcesPath,
    surveyAnalyticsPath,
    surveySourcesPath,
  ]) {
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
    const isPracticeAnalytics = url.pathname === practiceAnalyticsPath;
    const isPresentationAnalytics = url.pathname === presentationAnalyticsPath;
    const isPresentationSources = url.pathname === presentationSourcesPath;
    if (!gates.has(url.pathname)) return route.continue();
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
    if (url.pathname === reportSourcesPath) {
      return route.fulfill({
        json: { sources: [{ id: quizId, title: "Synthetic source Round" }] },
      });
    }
    if (isReportTotals) {
      const ready = Number(matchesSearch(report));
      const periods = ready ? [{ start: "2026-10-01", count: ready }] : [];
      return route.fulfill({
        json: {
          ready,
          pending: 0,
          failed: 0,
          ...(url.searchParams.get("includeActivity") === "true"
            ? {
                participantJoins: ready ? report.participantCount : 0,
                activity: { month: periods, quarter: periods },
              }
            : {}),
        },
      });
    }
    if (isPracticeAnalytics) {
      const matches = matchesSearch(practice);
      const periods = matches ? [{ start: "2026-10-01", count: 1 }] : [];
      return route.fulfill({
        json: {
          open: Number(matches),
          scheduled: 0,
          closed: 0,
          expired: 0,
          attemptCount: matches ? practice.attemptCount : 0,
          completedAttemptCount: matches ? practice.completedAttemptCount : 0,
          activity: { month: periods, quarter: periods },
        },
      });
    }
    if (isPresentationAnalytics) {
      const matches = matchesSearch(presentation);
      const periods = matches ? [{ start: "2026-10-01", count: 1 }] : [];
      return route.fulfill({
        json: {
          active: 0,
          finished: Number(matches),
          participantJoins: matches ? presentation.participantCount : 0,
          activity: { month: periods, quarter: periods },
        },
      });
    }
    if (isPresentationSources) {
      return route.fulfill({
        json: {
          sources: [{ id: presentation.presentationId, title: "Synthetic source Presentation" }],
        },
      });
    }
    if (url.pathname === surveyAnalyticsPath) {
      const matches = Number(matchesSearch(survey));
      const periods = matches ? [{ start: "2026-10-01", count: 1 }] : [];
      return route.fulfill({
        json: {
          rooms: matches,
          surveys: matches,
          activity: { month: periods, quarter: periods },
          refreshAfterMs: null,
        },
      });
    }
    if (url.pathname === surveySourcesPath) {
      return route.fulfill({
        json: {
          sources: [{ id: survey.surveyId, title: "Synthetic source Survey" }],
          refreshAfterMs: null,
        },
      });
    }
    return route.fulfill({
      json: {
        items: history.filter(matchesSearch),
        nextCursor: null,
        ...(url.pathname === surveyResultsPath ? { sampledAt: new Date().toISOString() } : {}),
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

for (const [view, listPath] of [
  ["results", reportsPath],
  ["practice", practicePath],
  ["presentations", presentationResultsPath],
  ["surveys", surveyResultsPath],
] as const) {
  const analytics = historyAnalytics[view];
  test(`Results keeps full-history analytics while the first ${analytics.kind} page loads or fails`, async ({
    page,
  }) => {
    await signInBeta(page, undefined, { returnTo: "/library" });
    await specialistLocale(page, "en-CA");
    const expectedWorkspaceId = await signedInWorkspaceId(page);
    const fixture = await installHistory(page);
    try {
      fixture.allow(listPath);
      fixture.allow(analytics.path);
      if (view === "presentations") {
        fixture.allow(presentationSourcesPath);
        fixture.release(presentationSourcesPath);
      }
      if (view === "surveys") {
        fixture.allow(surveySourcesPath);
        fixture.release(surveySourcesPath);
      }
      await page.goto(
        `/results?${new URLSearchParams({
          ...(view === "results" ? {} : { view }),
          q: "workshop",
        })}`,
      );
      const panel = page.locator("#results-panel");
      const collection = panel.getByRole("region", {
        name: analytics.collectionLabel,
        exact: true,
      });
      const overview = panel.getByRole("region", { name: "Results analytics", exact: true });
      const analyticsStatus = overview.getByRole("status");
      const busyStatus = analyticsStatus.locator('xpath=ancestor-or-self::*[@aria-busy="true"]');
      await expect(collection).toHaveAttribute("aria-busy", "true");
      await expect(panel).not.toHaveAttribute("aria-busy");
      await expect(analyticsStatus).toHaveText(analytics.loadingMessage);
      await expect(busyStatus).toHaveCount(0);

      fixture.fail(analytics.path);
      await expect(analyticsStatus).toHaveText(analytics.errorMessage);
      await expect(busyStatus).toHaveCount(0);
      await expect(collection).toHaveAttribute("aria-busy", "true");
      await expectUnknownActivity(overview, analytics);
      await expect(overview.getByRole("meter")).toHaveCount(0);

      fixture.allow(analytics.path);
      await overview.getByRole("button", { name: analytics.retryLabel, exact: true }).click();
      await expect(analyticsStatus).toHaveText(analytics.scopeMessage);
      await expect(busyStatus).toHaveCount(0);
      await expect(collection).toHaveAttribute("aria-busy", "true");
      const matchingCount = overview
        .getByText(analytics.countLabel, { exact: true })
        .locator("..")
        .locator("dd");
      const expectFullHistory = async () => {
        await expect(matchingCount).toHaveText("1");
        await expectOctoberActivity(overview, analytics);
        if (view === "practice") {
          await expect(
            overview.getByRole("meter", { name: "Completed attempts", exact: true }),
          ).toHaveAttribute("aria-valuetext", "9 completed of 12 attempts");
        }
        if (view === "presentations") {
          await expect(
            overview.getByText("Participant joins", { exact: true }).locator("..").locator("dd"),
          ).toHaveText(/^12\s*Join records across matching sessions\.$/);
        }
        if (view === "results") {
          await expect(
            overview
              .getByText("Participant joins", { exact: true })
              .locator("..")
              .locator("dd")
              .first(),
          ).toHaveText(/^12\s*Across ready reports matching your filters\.$/);
        }
        if (view === "surveys") {
          await expect(overview.getByRole("meter")).toHaveCount(0);
          await expect(overview.getByText("Participant joins", { exact: true })).toHaveCount(0);
        }
      };
      await expectFullHistory();
      await expect(collection.getByRole("article")).toHaveCount(0);
      await expectNoLoadedEvidence(overview, analytics, true);
      if (view === "results") await expect(overview.getByRole("meter")).toHaveCount(0);

      const queriesFor = (path: string) =>
        fixture.reads
          .filter((read) => read.path === path)
          .map((read) => Object.fromEntries(new URLSearchParams(read.query)));
      const scopedFilters = { expectedWorkspaceId, search: "workshop" };
      const listQuery = { limit: "25", ...scopedFilters };
      const analyticsQuery = { ...scopedFilters, ...analytics.query };
      await expect.poll(() => queriesFor(listPath)).toEqual([listQuery]);
      expect(queriesFor(analytics.path)).toEqual([analyticsQuery, analyticsQuery]);
      fixture.fail(listPath);
      await expect(collection).toHaveAttribute("aria-busy", "false");
      const retry = panel.getByRole("button", { name: "Try again", exact: true });
      await expect(retry).toBeVisible();
      await expectFullHistory();
      await expect(panel.getByText(/^0 (?:results|practice items) shown$/)).toHaveCount(0);
      await expectNoLoadedEvidence(overview, analytics, true);
      if (view === "results") await expect(overview.getByRole("meter")).toHaveCount(0);

      const readsBeforeRetry = fixture.reads.length;
      fixture.allow(listPath);
      await retry.click();
      await expect(collection.getByRole("article")).toHaveCount(1);
      await expectFullHistory();
      await expect(
        overview.getByRole("region", { name: analytics.shortcutLabel, exact: true }),
      ).toBeVisible();
      expect(fixture.reads.slice(readsBeforeRetry).map(({ path }) => path)).toEqual([listPath]);
      expect(queriesFor(listPath)).toEqual([listQuery, listQuery]);
    } finally {
      fixture.releaseAll();
    }
  });
}

test("Survey activity refresh preserves expanded Results and an in-flight Load More focus", async ({
  page,
}) => {
  await signInBeta(page, undefined, { returnTo: "/library" });
  await specialistLocale(page, "en-CA");
  const surveyId = randomUUID();
  const surveyRuns = ["First", "Second", "Third"].map((ordinal, index) => ({
    id: randomUUID(),
    surveyId,
    title: `${ordinal} synthetic Survey run`,
    code: String(3456789 + index),
    closesAt: `2026-10-0${3 - index}T12:00:00.000Z`,
    expiresAt: "2099-10-01T12:00:00.000Z",
  }));
  const lifecycleDelay = 60_000;
  let boundaryPassed = false;
  let thirdPageStarted = false;
  const thirdPage = Promise.withResolvers<void>();
  await page.route(`${api}${surveyResultsPath}?*`, async (route) => {
    const index = Number(new URL(route.request().url()).searchParams.get("cursor") ?? 0);
    if (index === 2 && !thirdPageStarted) {
      thirdPageStarted = true;
      await thirdPage.promise;
    }
    return route.fulfill({
      json: {
        items: [surveyRuns[index]],
        nextCursor: index + 1 < surveyRuns.length ? String(index + 1) : null,
        sampledAt: new Date().toISOString(),
      },
    });
  });
  await page.route(`${api}${surveyAnalyticsPath}?*`, (route) => {
    const rooms = boundaryPassed ? 3 : 4;
    const periods = [{ start: "2026-10-01", count: rooms }];
    return route.fulfill({
      json: {
        rooms,
        surveys: 1,
        activity: { month: periods, quarter: periods },
        refreshAfterMs: boundaryPassed ? null : lifecycleDelay,
      },
    });
  });
  await page.route(`${api}${surveySourcesPath}?*`, (route) =>
    route.fulfill({
      json: { sources: [{ id: surveyId, title: "Synthetic source Survey" }], refreshAfterMs: null },
    }),
  );

  try {
    await page.clock.install();
    await page.goto("/results?view=surveys");
    const overview = page.getByRole("region", { name: "Results analytics", exact: true });
    const matchingRuns = overview
      .getByText("Matching Survey runs", { exact: true })
      .locator("..")
      .locator("dd");
    const collection = page.getByRole("region", { name: "Survey results", exact: true });
    const articles = collection.getByRole("article");
    const loadMore = page.getByRole("button", { name: "Load More", exact: true });
    await expect(matchingRuns).toHaveText("4");
    await expect(articles).toHaveCount(1);
    await loadMore.press("Enter");
    await expect(articles).toHaveCount(2);
    await expect(articles.nth(1)).toBeFocused();
    await loadMore.press("Enter");
    await expect.poll(() => thirdPageStarted).toBe(true);
    const loadingMore = page.getByRole("button", { name: "Loading", exact: true });
    await expect(loadingMore).toBeFocused();

    boundaryPassed = true;
    await page.clock.fastForward(lifecycleDelay);
    await expect(matchingRuns).toHaveText("3");
    await expect(articles).toHaveCount(2);
    await expect(loadingMore).toBeFocused();

    thirdPage.resolve();
    await expect(articles).toHaveCount(3);
    await expect(articles.nth(2)).toBeFocused();
    await expect(matchingRuns).toHaveText("3");
  } finally {
    thirdPage.resolve();
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
        const analytics = historyAnalytics[view.key];
        const overview = panel.getByRole("region", { name: "Results analytics", exact: true });
        const analyticsStatus = overview.getByRole("status");
        const busyRegion = panel.getByRole("region", {
          name: analytics.collectionLabel,
          exact: true,
        });
        const retry = panel.getByRole("button", { name: "Try again", exact: true });
        await expect(retry).toBeVisible();
        await expect(page.getByText(/^0 (?:results|practice items) shown$/)).toHaveCount(0);
        await expect(panel.getByRole("article")).toHaveCount(0);
        await expect(analyticsStatus).toHaveText(analytics.errorMessage);
        await expect(overview.getByText(analytics.countLabel, { exact: true })).toHaveCount(0);
        await expectNoLoadedEvidence(overview, analytics);
        await expect(overview.getByRole("meter")).toHaveCount(0);
        await expectUnknownActivity(overview, analytics);
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
        await expect(busyRegion).toHaveAttribute("aria-busy", "true");
        await expect(page.getByText(/^0 (?:results|practice items) shown$/)).toHaveCount(0);
        await expect(analyticsStatus).toHaveText(analytics.errorMessage);
        await expect(
          analyticsStatus.locator('xpath=ancestor-or-self::*[@aria-busy="true"]'),
        ).toHaveCount(0);
        await quality(page);
        if (view.key === "results")
          await panel.screenshot({
            path: info.outputPath("retry-loading-light.png"),
            scale: "css",
          });
        fixture.release(view.path);
        await expect(busyRegion).toHaveAttribute("aria-busy", "false");
        await expect(panel.getByRole("article")).toHaveCount(1);
        expect(fixture.reads.filter((read) => read.path === view.path).at(-1)!.query).toBe(
          lastFailure.query,
        );
        await expect(panel.locator("section[data-view]")).toHaveAttribute("data-view", "list");

        expect(fixture.reads.slice(readsBeforeListRetry)).toEqual([lastFailure]);
        const heading = overview.getByRole("heading", { name: "Results analytics", exact: true });
        const analyticsRetry = overview.getByRole("button", {
          name: analytics.retryLabel,
          exact: true,
        });
        await expect(analyticsStatus).toContainText(analytics.errorMessage);
        await expect(analyticsStatus).toContainText(
          "Summary of 1 loaded results with your current filters.",
        );
        await expect(
          overview.getByText(view.key === "surveys" ? "Survey runs shown" : "Results shown", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(overview.getByText(analytics.countLabel, { exact: true })).toHaveCount(0);
        await expect(panel.getByRole("article")).toHaveCount(1);
        await expectUnknownActivity(overview, analytics);
        if (view.key === "practice") {
          const fallbackStatus = overview.getByRole("group", {
            name: "Status of results shown",
            exact: true,
          });
          await expect(fallbackStatus.getByRole("listitem")).toHaveText([
            /^Open\s*1$/,
            /^Scheduled\s*0$/,
            /^Closed\s*0$/,
            /^Expired\s*0$/,
          ]);
          await expect(
            overview.getByRole("meter", { name: "Completed attempts", exact: true }),
          ).toHaveAttribute("aria-valuetext", "9 completed of 12 attempts");
        }
        const readsBeforeRetry = fixture.reads.length;
        await tabTo(page, analyticsRetry);
        await expectVisibleKeyboardFocus(analyticsRetry);
        fixture.allow(analytics.path);
        await page.keyboard.press("Enter");
        await expect(heading).toBeFocused();
        await expect(analyticsStatus).toContainText(analytics.loadingMessage);
        await expect(panel.getByRole("article")).toHaveCount(1);
        await expect(busyRegion).toHaveAttribute("aria-busy", "false");
        await expectUnknownActivity(overview, analytics);
        fixture.release(analytics.path);
        const matchingItems = overview.getByText(analytics.countLabel, { exact: true });
        await expect(matchingItems.locator("..").locator("dd")).toHaveText("1");
        await expectOctoberActivity(overview, analytics);
        await expect(analyticsRetry).toHaveCount(0);
        const [totalsRead, ...extraReads] = fixture.reads.slice(readsBeforeRetry);
        expect(extraReads).toEqual([]);
        expect(totalsRead?.path).toBe(analytics.path);
        expect(Object.fromEntries(new URLSearchParams(totalsRead?.query))).toEqual({
          expectedWorkspaceId,
          search: "workshop",
          ...analytics.query,
        });
        await expect(heading).toBeFocused();
        await page.keyboard.press(tabKey(page));
        await expect(
          historyActivity(overview).getByRole("combobox", { name: "Group by", exact: true }),
        ).toBeFocused();

        if (view.key !== "practice") {
          const { sourceName, sourcesPath } = {
            results: { sourceName: "Round", sourcesPath: reportSourcesPath },
            presentations: { sourceName: "Presentation", sourcesPath: presentationSourcesPath },
            surveys: { sourceName: "Survey", sourcesPath: surveySourcesPath },
          }[view.key];
          const sourcesRetry = panel.getByRole("button", {
            name: `Retry ${sourceName} options`,
            exact: true,
          });
          const source = panel.getByRole("combobox", { name: sourceName, exact: true });
          await expect(
            panel.getByText(`${sourceName} filter options could not load.`, { exact: true }),
          ).toBeVisible();
          await expect(source.getByRole("option")).toHaveCount(1);
          const readsBeforeRetry = fixture.reads.length;
          await tabTo(page, sourcesRetry, true);
          await expectVisibleKeyboardFocus(sourcesRetry);
          fixture.allow(sourcesPath);
          fixture.release(sourcesPath);
          await page.keyboard.press("Enter");
          await expect(panel).toBeFocused();
          await expect(sourcesRetry).toHaveCount(0);
          await expect(source.getByRole("option")).toHaveText([
            `All ${sourceName}s`,
            `Synthetic source ${sourceName}`,
          ]);
          await expect(busyRegion).toHaveAttribute("aria-busy", "false");
          expect(fixture.reads.slice(readsBeforeRetry)).toEqual([
            {
              path: sourcesPath,
              query: `?expectedWorkspaceId=${expectedWorkspaceId}`,
            },
          ]);
        }

        const search = page.getByRole("searchbox", { name: view.search, exact: true });
        await search.fill("no-matching-synthetic-evidence");
        await expect
          .poll(() => new URL(page.url()).searchParams.get("q"))
          .toBe("no-matching-synthetic-evidence");
        const emptyHeading = panel.getByRole("heading", {
          name:
            view.key === "practice"
              ? "No practice matches these filters."
              : "No results match these filters.",
          exact: true,
        });
        await expect(emptyHeading).toBeVisible();
        const activity = historyActivity(overview);
        await expect(activity.getByText(analytics.emptyMessage, { exact: true })).toBeVisible();
        await expect(activity.getByRole("listitem")).toHaveCount(0);
        await quality(page);
        const emptyClear = emptyHeading
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

        const readsBeforeSearch = fixture.reads.length;
        await search.fill("workshop");
        await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("workshop");
        if (view.key !== "results") {
          await expect
            .poll(() =>
              fixture.reads
                .slice(readsBeforeSearch)
                .some(
                  ({ path, query }) =>
                    path === view.path && new URLSearchParams(query).get("search") === "workshop",
                ),
            )
            .toBe(true);
        }
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
