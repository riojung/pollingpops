import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FollowupSummarySchema, ReportSummarySchema } from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";
import {
  expectDocumentReflow,
  expectVisibleKeyboardFocus,
  tabTo,
} from "./option-b-accessibility-support";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const longTitle = "Synthetic workshop · 함께 검토 · " + "LongUnbrokenTitle".repeat(5);
const views = [
  { key: "results", path: "/v1/reports", search: "Search Round results" },
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
    "/v1/reports": { envelope: "items", rows: [report] },
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
  for (const path of Object.keys(histories)) {
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
    if (!history) return route.continue();
    reads.push({ path: url.pathname, query: url.search });
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
    const gate = gates.get(url.pathname)!;
    if (!gate.held) {
      gate.held = true;
      await gate.promise;
    }
    const search = url.searchParams.get("search")?.toLocaleLowerCase() ?? "";
    return route.fulfill({
      json: {
        [history.envelope]: history.rows.filter(
          (row) => !search || row.title.toLocaleLowerCase().includes(search),
        ),
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
    release: (path: string) => gates.get(path)!.release(),
    releaseAll: () => {
      for (const gate of gates.values()) gate.release();
    },
  };
}

for (const phone of [false, true]) {
  test(`Results keeps failed evidence unknown and restores keyboard continuity${phone ? " @mobile" : ""}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: phone ? 320 : 1440, height: phone ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/results" });
    await specialistLocale(page, "en-CA");
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
        await quality(page);
        if (view.key === "results")
          await panel.screenshot({
            path: info.outputPath("initial-error-light.png"),
            scale: "css",
          });
        await page.getByRole("button", { name: "List view", exact: true }).click();
        const lastFailure = fixture.reads.filter((read) => read.path === view.path).at(-1)!;
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
