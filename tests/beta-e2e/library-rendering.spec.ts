import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { QuizDraft } from "@openround/contracts";
import { signInBeta } from "./sign-in";
import { openLibraryFilters } from "./library-controls";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function mockRoundCollection(page: Page) {
  const response = await page.request.get(`${api}/v1/auth/me`);
  expect(response.ok()).toBe(true);
  const { creator } = (await response.json()) as { creator: { workspaceId: string } };
  const quizzes = Array.from({ length: 23 }, (_, index) => {
    const title = `Synthetic library Round ${String(index + 1).padStart(2, "0")}`;
    const published = index < 12;
    const draft: QuizDraft = {
      title,
      description: "A saved workshop Round for planning and reflection.",
      category: "general",
      experiencePreset: { id: "focus", version: 1 },
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          prompt: "Which action should the team take first?",
          choices: [
            { id: randomUUID(), label: "Review the evidence", isCorrect: true },
            { id: randomUUID(), label: "Skip the review", isCorrect: false },
          ],
          timeLimitSeconds: 30,
          basePoints: 100,
          explanation: "Review the evidence before choosing the next action.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    };
    return {
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title,
      description: draft.description,
      status: published ? "published" : "draft",
      draft,
      draftRevision: 1,
      publishedDraftRevision: published ? 1 : null,
      currentVersionId: published ? randomUUID() : null,
      folderId: null,
      tags: [],
      createdAt: "2026-10-01T12:00:00.000Z",
      updatedAt: "2026-10-01T12:00:00.000Z",
      lastHostedAt: null,
    };
  });
  // Keep the fixture in this browser: no persisted Rounds or publication quota changes.
  await page.route(`${api}/v1/quizzes?archived=true`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: { quizzes } });
  });
}

async function expectLibraryLayout(page: Page, cards: Locator, singleColumn: boolean) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const bounds = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const { left, right, top, bottom, width } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, viewportWidth: window.innerWidth };
    }),
  );
  expect(bounds).toHaveLength(23);
  for (const card of bounds) {
    expect(card.width).toBeGreaterThan(0);
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.right).toBeLessThanOrEqual(card.viewportWidth + 1);
  }
  if (singleColumn) {
    for (const [index, card] of bounds.entries()) {
      expect(Math.abs(card.left - bounds[0]!.left)).toBeLessThan(1);
      if (index > 0) expect(card.top).toBeGreaterThanOrEqual(bounds[index - 1]!.bottom);
    }
  } else {
    expect(Math.abs(bounds[0]!.top - bounds[1]!.top)).toBeLessThan(1);
    expect(bounds[1]!.left).toBeGreaterThan(bounds[0]!.left);
  }
}

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}Library keeps 23 Round cards responsive through filters, layouts and Recovery Packs navigation`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInBeta(page);
    await mockRoundCollection(page);

    const panel = page.getByRole("tabpanel", { name: /^Rounds/ });
    const cards = panel.getByRole("article");
    const grid = page.getByRole("button", { name: "Grid view", exact: true });
    const list = page.getByRole("button", { name: "List view", exact: true });

    for (const mode of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: mode });
      await page.goto("/library");
      await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
      await expect(cards).toHaveCount(23);
      await expect(grid).toHaveAttribute("aria-pressed", "true");
      await expectLibraryLayout(page, cards, mobile);
      await page.screenshot({ path: testInfo.outputPath(`library-23-rounds-${mode}.png`) });

      // Navigate directly from the complete grid before filtering or changing its layout.
      await openLibraryFilters(page);
      await page.getByRole("link", { name: "Recovery Packs", exact: true }).click();
      await expect(page).toHaveURL(/\/recovery-packs$/);
      await expect(
        page.getByRole("heading", { name: "Recovery Packs", exact: true }),
      ).toBeVisible();

      if (mode === "dark") continue;
      await page.goBack();
      await expect(cards).toHaveCount(23);
      const status = page.getByRole("combobox", { name: "Filter by status", exact: true });
      await status.selectOption("published");
      await expect(cards).toHaveCount(12);
      await status.selectOption("draft");
      await expect(cards).toHaveCount(11);
      await status.selectOption("active");
      await expect(cards).toHaveCount(23);

      const search = page.getByRole("searchbox", { name: "Search rounds", exact: true });
      await search.fill("Synthetic library Round 23");
      await expect(cards).toHaveCount(1);
      await expect(cards.getByRole("heading")).toHaveText("Synthetic library Round 23");
      await search.fill("");
      await expect(cards).toHaveCount(23);

      await list.click();
      await expect(list).toHaveAttribute("aria-pressed", "true");
      await expectLibraryLayout(page, cards, true);
      await grid.click();
      await expect(grid).toHaveAttribute("aria-pressed", "true");
      await expectLibraryLayout(page, cards, mobile);
    }
  });
}
