import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { HomeSummary } from "../../apps/web/app/home/home-model";
import { homeOverviewCopy } from "../../apps/web/lib/i18n/home-overview-copy";
import { signInBeta } from "./sign-in";
import { e01ApiUrl } from "./presentation-e01-support";
import { specialistLocale } from "./option-b-specialist-support";
import { tabTo, expectVisibleKeyboardFocus } from "./option-b-accessibility-support";

function populatedSummary(): HomeSummary {
  const updatedAt = "2026-11-12T12:00:00Z";
  return {
    generatedAt: updatedAt,
    recentArtifacts: [
      ...[
        "A focused product update",
        "From an idea to a small experiment",
        "Hands-on workshop",
      ].map((title, index) => ({
        id: `presentation-${index}`,
        artifactType: "presentation" as const,
        title,
        description: "Synthetic editorial description",
        status: "draft" as const,
        itemCount: 8 - index,
        updatedAt: `2026-11-12T${String(11 - index).padStart(2, "0")}:00:00Z`,
        editHref: `/presentation/sample-${index}`,
        actionHref: `/presentation/sample-${index}`,
        actionLabel: "Continue editing",
      })),
      {
        id: "round",
        artifactType: "round",
        title: "Check understanding together",
        description: "",
        status: "published",
        itemCount: 4,
        updatedAt: "2026-11-12T08:00:00Z",
        editHref: "/quiz/sample",
        actionHref: "/host/setup/sample",
        actionLabel: "Host Round",
      },
    ],
    recentBoards: [
      {
        id: "canvas",
        artifactType: "canvas",
        boardType: "team",
        title: "Project kickoff",
        description: "",
        status: "active",
        itemCount: null,
        updatedAt,
        editHref: "/canvas/sample",
        actionHref: "/canvas/sample",
        actionLabel: "Open Board",
        canEdit: true,
        role: "owner",
      },
    ],
    recentSurveys: [
      {
        id: "survey",
        artifactType: "survey",
        title: "Team check-in",
        description: "",
        status: "published",
        itemCount: 3,
        updatedAt: "2026-11-12T07:00:00Z",
        editHref: "/surveys/sample",
        actionHref: "/surveys/sample",
        actionLabel: "Open Survey",
      },
    ],
    sessions: [
      {
        id: "session",
        artifactType: "round",
        artifactId: "round",
        title: "Weekly workshop",
        status: "finished",
        phase: "finished",
        code: "1234567",
        participantCount: 12,
        progressLabel: "Complete",
        createdAt: updatedAt,
        href: "/sessions",
      },
    ],
    assignments: [
      {
        id: "practice",
        quizId: "round",
        title: "Follow up after the workshop",
        status: "open",
        checkpointCount: 4,
        attemptCount: 10,
        completedAttemptCount: 6,
        opensAt: "2026-11-11T12:00:00Z",
        closesAt: "2026-11-13T12:00:00Z",
        href: "/practice/sample",
      },
    ],
    resultHighlights: ["ready", "pending", "failed"].map((status, index) => ({
      id: `result-${index}`,
      artifactType: "round",
      title: `Workshop reflection ${index + 1}`,
      status: status as "ready" | "pending" | "failed",
      participantCount: status === "ready" ? 12 : 0,
      accuracyPercent: null,
      recoveryPercent: null,
      createdAt: updatedAt,
      href: `/report/sample-${index}`,
    })),
    groupSchedule: [],
    totals: {
      artifacts: 18,
      surveys: 1,
      boards: 2,
      activeSessions: 2,
      activeAssignments: 1,
      upcomingGroupItems: 0,
    },
  };
}

async function quality(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

for (const suffix of ["desktop", "phone @mobile"]) {
  test(`Home overview shows bounded insights and compact recent work ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const phone = suffix.includes("mobile");
    await page.setViewportSize({ width: phone ? 320 : 1440, height: 1000 });
    const summary = populatedSummary();
    const mutations: string[] = [];
    const detailReads: string[] = [];
    await page.route(`${e01ApiUrl}/v1/home/summary`, (route) => route.fulfill({ json: summary }));
    await signInBeta(page, undefined, { returnTo: "/home" });
    await specialistLocale(page, "en-CA");
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
        /^\/v1\/(?:quizzes|presentations|canvases|practice|sessions)(?:\/|$)/.test(path)
      )
        mutations.push(path);
      if (request.method() === "GET" && /^\/v1\/(?:quizzes|presentations)\/[^/]+$/.test(path))
        detailReads.push(path);
    });
    await page.goto("/home");
    await expect(page.locator('[data-widget="work"]')).toContainText("18");
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Create", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-widget="sessions"]')).toContainText("2");
    await expect(page.locator('[data-widget="assignments"]')).toContainText("60%");
    await expect(page.locator('[data-widget="assignments"]')).toContainText(
      "6 of 10 attempts complete",
    );
    await expect(page.locator('[data-widget="reports"]')).toContainText("1 of 3 recent results");
    await expect(page.locator('[data-insight="liveSession"]')).toHaveAttribute("href", "/sessions");
    await expect(page.locator('[data-insight="draft"]')).toHaveAttribute(
      "href",
      "/presentation/sample-0",
    );
    const rows = page.locator("[data-work-row]");
    await expect(rows).toHaveCount(6);
    for (const row of await rows.all()) {
      expect((await row.boundingBox())!.height).toBeLessThan(phone ? 180 : 125);
    }
    await mkdir("artifacts/home-insights", { recursive: true });
    await writeFile(
      `artifacts/home-insights/${info.project.name}-geometry.json`,
      JSON.stringify(
        {
          viewport: page.viewportSize(),
          recentWorkRowHeights: await rows.evaluateAll((nodes) =>
            nodes.map((node) => node.getBoundingClientRect().height),
          ),
          widgetsHeight: await page
            .locator('[data-widget="work"]')
            .evaluate((node) => node.parentElement!.getBoundingClientRect().height),
          source: "Synthetic fixture; supporting browser geometry only",
        },
        null,
        2,
      ) + "\n",
    );
    const work = page.locator('[data-widget="work"] a[href="/library"]');
    await tabTo(page, work);
    await expectVisibleKeyboardFocus(work);
    const boards = page.locator('[data-widget="work"] a[href="/boards"]');
    await tabTo(page, boards);
    await expectVisibleKeyboardFocus(boards);
    for (const widget of ["sessions", "assignments", "reports"]) {
      await page.keyboard.press(
        page.context().browser()?.browserType().name() === "webkit" ? "Alt+Tab" : "Tab",
      );
      await expectVisibleKeyboardFocus(page.locator(`[data-widget="${widget}"]`));
    }
    for (const mode of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await page.evaluate(() => {
        localStorage.setItem("openround:color-mode", "system");
        window.dispatchEvent(new Event("openround:color-mode-change"));
      });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
      // WebKit can update the root attribute a frame before inherited descendant colors.
      // Wait for the actual visible and offscreen palettes, then keep the full Axe check.
      for (const text of [
        page.locator("[data-work-row] h3 a").first(),
        page.locator('[aria-labelledby="home-surveys-title"] strong').first(),
      ]) {
        await expect(text).toHaveCSS(
          "color",
          mode === "dark" ? "rgb(232, 235, 240)" : "rgb(48, 54, 64)",
        );
      }
      await quality(page);
      await page.evaluate(() => scrollTo(0, 0));
      await mkdir("artifacts/home-insights", { recursive: true });
      await page.screenshot({
        path: `artifacts/home-insights/${info.project.name}-${mode}.png`,
        fullPage: !phone,
      });
    }
    await page.emulateMedia({ forcedColors: "active" });
    await quality(page);
    await page.emulateMedia({ forcedColors: "none", colorScheme: "light" });
    await specialistLocale(page, "de-DE");
    summary.recentArtifacts[0]!.title =
      "Eine ausführliche Präsentation mit klaren nächsten Schritten und langfristiger Zusammenarbeit im gesamten Team";
    await page.reload();
    await expect(
      page.getByRole("heading", { name: homeOverviewCopy("de-DE").overview }),
    ).toBeVisible();
    await quality(page);
    await specialistLocale(page, "ko-KR");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: homeOverviewCopy("ko-KR").overview }),
    ).toBeVisible();
    await quality(page);
    expect(mutations).toEqual([]);
    expect(detailReads).toEqual([]);
    await specialistLocale(page, "en-CA");
  });

  test(`Home overview keeps loading, retry and empty evidence honest ${suffix}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: suffix.includes("mobile") ? 320 : 1440, height: 1000 });
    let mode: "populated" | "loading" | "failed" | "empty" | "boards" = "populated";
    let release: (() => void) | undefined;
    const summary = populatedSummary();
    await page.route(`${e01ApiUrl}/v1/home/summary`, async (route) => {
      if (mode === "loading")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (mode === "failed")
        return route.fulfill({ status: 503, json: { error: "Summary temporarily unavailable" } });
      if (mode === "empty")
        return route.fulfill({
          json: {
            ...summary,
            recentArtifacts: [],
            recentBoards: [],
            recentSurveys: [],
            sessions: [],
            assignments: [],
            resultHighlights: [],
            totals: {
              artifacts: 0,
              activeSessions: 0,
              activeAssignments: 0,
              upcomingGroupItems: 0,
            },
          },
        });
      if (mode === "boards")
        return route.fulfill({
          json: {
            ...summary,
            recentArtifacts: [],
            recentSurveys: [],
            sessions: [],
            assignments: [],
            resultHighlights: [],
            totals: {
              artifacts: 3,
              boards: 3,
              surveys: 0,
              activeSessions: 0,
              activeAssignments: 0,
              upcomingGroupItems: 0,
            },
          },
        });
      return route.fulfill({ json: summary });
    });
    await signInBeta(page, undefined, { returnTo: "/home" });
    await specialistLocale(page, "en-CA");
    await page.goto("/home");
    await expect(page.locator("[data-widget]")).toHaveCount(4);
    mode = "loading";
    await page.goto("/home");
    await expect.poll(() => Boolean(release)).toBe(true);
    await expect(page.locator("[data-widget]")).toHaveCount(0);
    mode = "failed";
    release!();
    await expect(
      page.getByRole("alert").filter({ hasText: "Home could not be refreshed" }),
    ).toBeVisible();
    await expect(page.locator("[data-widget]")).toHaveCount(0);
    mode = "empty";
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.locator("[data-widget]")).toHaveCount(4);
    await expect(page.locator('[data-widget="assignments"]')).toContainText("No attempts yet");
    await expect(page.locator('[data-widget="assignments"] progress')).toHaveCount(0);
    await expect(page.locator('[data-widget="reports"]')).toContainText(
      "No recent results to show",
    );
    await expect(
      page.getByRole("alert").filter({ hasText: "Home could not be refreshed" }),
    ).toHaveCount(0);
    await quality(page);
    mode = "boards";
    await page.reload();
    const work = page.locator('[data-widget="work"]');
    await expect(work).toContainText("3");
    const boards = work.getByRole("link", { name: "View Boards", exact: true });
    await expect(boards).toHaveAttribute("href", "/boards");
    await boards.click();
    await expect(page).toHaveURL(/\/boards$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}
