import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SessionSummarySchema } from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";
import {
  expectDocumentReflow,
  expectVisibleKeyboardFocus,
  tabTo,
} from "./option-b-accessibility-support";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const longTitle =
  "Synthetic cross-team planning · 다음 단계 함께 검토 · " + "LongUnbrokenTitle".repeat(5);
const modes = [
  { name: "light", colorScheme: "light", forcedColors: "none" },
  { name: "dark", colorScheme: "dark", forcedColors: "none" },
  { name: "high-contrast", colorScheme: "light", forcedColors: "active" },
] as const;

async function auditRecoveryPanel(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .include("#rounds-panel")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await expectDocumentReflow(page);
}

async function installHistory(page: Page) {
  const quizId = randomUUID();
  const round = (active: boolean) =>
    SessionSummarySchema.parse({
      id: randomUUID(),
      quizId,
      title: active ? longTitle : "Synthetic finished workshop",
      status: active ? "active" : "finished",
      phase: active ? "lobby" : "finished",
      code: active ? "1234567" : "1234568",
      participantCount: 12,
      answerCount: 24,
      questionCount: 4,
      questionPosition: active ? null : 4,
      createdAt: "2026-10-01T12:00:00.000Z",
      updatedAt: "2026-10-01T12:00:00.000Z",
      expiresAt: "2099-10-01T12:00:00.000Z",
      reportId: randomUUID(),
    });
  const rounds = [round(true), round(false)];
  const presentationId = randomUUID();
  const presentation = {
    id: randomUUID(),
    presentationId,
    title: longTitle,
    code: "2345678",
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    blockCount: 4,
    participantCount: 12,
    responseCount: 0,
    createdAt: "2026-10-01T12:00:00.000Z",
    liveExpiresAt: "2099-10-01T12:00:00.000Z",
  };
  const reads: string[] = [];
  const mutations: string[] = [];
  let failHistory = true;
  let holdRetry = true;
  let releaseRetry!: () => void;
  const retryGate = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  await page.route(`${api}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      if (/^\/v1\/(?:sessions|presentation-sessions|survey-rooms)(?:\/|$)/.test(url.pathname))
        mutations.push(`${request.method()} ${url.pathname}`);
      return route.continue();
    }
    if (url.pathname === "/v1/sessions/counts")
      return route.fulfill({ json: { counts: { rounds: 2, presentations: 1, surveys: 0 } } });
    if (url.pathname === "/v1/quizzes")
      return route.fulfill({ json: { quizzes: [{ id: quizId, title: "Synthetic source" }] } });
    if (url.pathname === "/v1/sessions") {
      reads.push(url.search);
      if (failHistory) {
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "UNAVAILABLE",
              message: "Synthetic history read unavailable",
              requestId: "synthetic-read",
            },
          },
        });
      }
      if (holdRetry) {
        holdRetry = false;
        await retryGate;
      }
      const items = url.searchParams.get("search")
        ? []
        : rounds.filter(
            (row) =>
              !url.searchParams.has("status") || row.status === url.searchParams.get("status"),
          );
      return route.fulfill({ json: { items, nextCursor: null } });
    }
    if (url.pathname === "/v1/presentation-sessions")
      return route.fulfill({ json: { sessions: [presentation] } });
    if (url.pathname === "/v1/survey-rooms")
      return route.fulfill({ json: { rooms: [], nextCursor: null } });
    return route.continue();
  });
  return {
    rounds,
    presentation,
    reads,
    mutations,
    releaseRetry,
    allowRetry: () => {
      failHistory = false;
    },
  };
}

for (const phone of [false, true]) {
  test(`Sessions recovery preserves context and readable action hierarchy${phone ? " @mobile" : ""}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: phone ? 320 : 1440, height: phone ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/sessions" });
    await specialistLocale(page, "en-CA");
    const fixture = await installHistory(page);
    try {
      await page.goto("/sessions?type=rounds&status=active");
      const panel = page.locator("#rounds-panel");
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      await expect(retry).toBeVisible();
      await expect(page.getByRole("heading", { name: /No sessions match/ })).toHaveCount(0);
      for (const mode of modes) {
        await page.emulateMedia({ colorScheme: mode.colorScheme, forcedColors: mode.forcedColors });
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode.colorScheme);
        await auditRecoveryPanel(page);
        await panel.screenshot({
          path: info.outputPath(`history-error-${mode.name}.png`),
          scale: "css",
        });
      }
      await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
      await page.getByRole("button", { name: "List view", exact: true }).click();
      await tabTo(page, retry);
      await expectVisibleKeyboardFocus(retry);
      const initialReads = fixture.reads.length;
      const failedQuery = fixture.reads.at(-1);
      fixture.allowRetry();
      await page.keyboard.press("Enter");
      await expect(panel).toHaveAttribute("aria-busy", "true");
      await auditRecoveryPanel(page);
      await panel.screenshot({ path: info.outputPath("history-loading.png"), scale: "css" });
      fixture.releaseRetry();
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(panel.getByRole("article")).toHaveCount(1);
      await expect(panel.locator("section[data-view]")).toHaveAttribute("data-view", "list");
      expect(fixture.reads).toHaveLength(initialReads + 1);
      expect(fixture.reads.at(-1)).toBe(failedQuery);

      const search = page.getByRole("searchbox", { name: "Search Round sessions", exact: true });
      await search.fill("no-matching-synthetic-session");
      const clear = page.getByRole("button", { name: "Clear filters", exact: true });
      await expect(page.getByRole("heading", { name: /No sessions match/ })).toBeVisible();
      await auditRecoveryPanel(page);
      await panel.screenshot({ path: info.outputPath("history-no-matches.png"), scale: "css" });
      await tabTo(page, clear);
      await expectVisibleKeyboardFocus(clear);
      await page.keyboard.press("Enter");
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("all");
      await expect(panel.getByRole("article")).toHaveCount(2);
      await expect(panel.locator("section[data-view]")).toHaveAttribute("data-view", "list");
      expect(new URL(page.url()).searchParams.get("type")).toBe("rounds");

      for (const mode of modes) {
        await page.emulateMedia({ colorScheme: mode.colorScheme, forcedColors: mode.forcedColors });
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode.colorScheme);
        for (const view of ["grid", "list"] as const) {
          await page
            .getByRole("button", { name: `${view === "grid" ? "Grid" : "List"} view`, exact: true })
            .click();
          const active = panel.getByRole("article").first();
          const finished = panel.getByRole("article").last();
          await expect(active.locator('[data-primary="true"]')).toHaveText("Resume Session");
          await expect(active.locator('[data-primary="true"]')).toHaveCount(1);
          await expect(
            active.getByRole("link", { name: "View Result", exact: true }),
          ).toHaveAttribute("href", `/report/${fixture.rounds[0]!.reportId}`);
          await expect(finished.locator('[data-primary="true"]')).toHaveText("View Result");
          await expect(active.getByRole("heading", { name: longTitle, exact: true })).toHaveText(
            longTitle,
          );
          await expectDocumentReflow(page);
          expect(
            (
              await new AxeBuilder({ page })
                .include("main")
                .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
                .analyze()
            ).violations,
          ).toEqual([]);
          await panel.screenshot({
            path: info.outputPath(`sessions-${view}-${mode.name}.png`),
            scale: "css",
          });
        }
      }
      await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
      await page.locator("#rounds-tab").focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.locator("#presentations-tab")).toBeFocused();
      const presentation = page.locator("#presentations-panel").getByRole("article");
      await expect(presentation.locator('[data-primary="true"]')).toHaveText("Resume Presentation");
      await expect(
        presentation.getByRole("link", { name: "View Report", exact: true }),
      ).toHaveAttribute("href", `/presentation-session/${fixture.presentation.id}/report`);
      await expectDocumentReflow(page);
      expect(fixture.mutations).toEqual([]);
    } finally {
      fixture.releaseRetry();
    }
  });
}
