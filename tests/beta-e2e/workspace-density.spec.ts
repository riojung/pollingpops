import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";
import { expectVisibleKeyboardFocus, tabTo } from "./option-b-accessibility-support";
import {
  densityAxe,
  densityLongTitle,
  densityScreenshots,
  installDensityFixtures,
  measureDensity,
  saveDensityMetrics,
  type DensityMetric,
} from "./workspace-density-support";

const collection = (page: Page) => page.locator("main section[data-view]:visible");
const layoutButton = (page: Page, view: "grid" | "list") =>
  page.getByRole("button", { name: `${view === "grid" ? "Grid" : "List"} view`, exact: true });

async function expectInternalLinks(cards: Locator) {
  const links = await cards
    .getByRole("link")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));
  expect(links.length).toBeGreaterThan(0);
  for (const href of links) {
    expect(href).toMatch(
      /^\/(quiz|host|presentation|presentation-session|surveys|results|report|practice)(\/|\?)/,
    );
    expect(href).not.toMatch(/undefined|null|\[object/);
  }
}

async function keyboardLibraryControls(page: Page, cards: Locator) {
  const first = cards.first();
  const checkbox = first.getByRole("checkbox");
  await tabTo(page, checkbox);
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await page.keyboard.press("Space");
  await expect(checkbox).not.toBeChecked();

  const summary = first.locator("summary");
  await tabTo(page, summary);
  await expectVisibleKeyboardFocus(summary);
  await page.keyboard.press("Enter");
  const menu = first.locator("details[open]");
  await expect(menu).toBeVisible();
  const command = menu.getByRole("button").first();
  await expect(command).toBeVisible();
  await expect(command).toBeInViewport();
  expect(
    await command.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return rect.left >= 0 && rect.right <= innerWidth && Boolean(top && element.contains(top));
    }),
    "The open More command is inside the viewport and escapes adjacent cards without clipping",
  ).toBe(true);
  await page.keyboard.press("Enter");
  await expect(first.locator("details[open]")).toHaveCount(0);

  const list = layoutButton(page, "list");
  // Return to the toolbar in document order; Firefox does not wrap Tab at the end.
  await tabTo(page, list, true);
  await expectVisibleKeyboardFocus(list);
  await page.keyboard.press("Enter");
  await expect(list).toHaveAttribute("aria-pressed", "true");
}

async function expectTrailingLibraryActions(cards: Locator) {
  const bounds = await cards.first().evaluate((element) => {
    const card = element.getBoundingClientRect();
    const heading = Array.from(element.querySelectorAll("h2"))
      .find((candidate) => !candidate.closest('[aria-hidden="true"], [inert]'))!
      .getBoundingClientRect();
    const action = element.querySelector("a")!.getBoundingClientRect();
    return {
      cardWidth: card.width,
      cardBottom: card.bottom,
      headingLeft: heading.left,
      actionLeft: action.left,
      actionTop: action.top,
    };
  });
  expect(bounds.actionLeft).toBeGreaterThan(bounds.headingLeft + bounds.cardWidth / 2);
  expect(bounds.actionTop).toBeLessThan(bounds.cardBottom - 24);
}

for (const suffix of ["desktop", "phone @mobile"]) {
  test(`Workspace Library layouts and Discover retain useful density ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const phone = suffix.includes("mobile");
    await page.setViewportSize({ width: phone ? 320 : 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/library" });
    await specialistLocale(page, "en-CA");
    const fixture = await installDensityFixtures(page);
    const metrics: DensityMetric[] = [];
    try {
      for (const mode of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: mode });
        await page.goto("/library");
        await expect(
          page.getByRole("heading", { name: "Library", level: 1, exact: true }),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
        for (const type of mode === "light" ? ["rounds", "presentations", "surveys"] : ["rounds"]) {
          await page.locator(`#${type}-tab`).click();
          await expect(page.locator(`#${type}-tab`)).toHaveAttribute("aria-selected", "true");
          const items = collection(page);
          const cards = items.getByRole("article");
          await expect(cards).toHaveCount(8);
          await layoutButton(page, "grid").click();
          await expect(items).toHaveAttribute("data-view", "grid");
          metrics.push(
            await measureDensity(page, items, {
              key: `library-${type}-grid-${mode}`,
              phone,
              maxHeight: 310,
            }),
          );
          await expectInternalLinks(cards);
          if (type === "rounds") {
            await expect(
              cards.first().getByRole("link", { name: "Edit", exact: true }),
            ).toHaveAttribute("href", `/quiz/${fixture.rounds[0]!.id}`);
            await densityAxe(page);
          }
          await densityScreenshots(page, items, info, `library-${type}-grid-${mode}`);
          if (mode === "light" && type === "rounds") await keyboardLibraryControls(page, cards);
          else await layoutButton(page, "list").click();
          await expect(items).toHaveAttribute("data-view", "list");
          metrics.push(
            await measureDensity(page, items, {
              key: `library-${type}-list-${mode}`,
              phone,
              list: true,
              maxHeight: 130,
            }),
          );
          if (!phone) await expectTrailingLibraryActions(cards);
          await densityScreenshots(page, items, info, `library-${type}-list-${mode}`);
        }

        await page.goto("/discover");
        await expect(
          page.getByRole("heading", { name: "Discover", level: 1, exact: true }),
        ).toBeVisible();
        const starters = page.locator('main [data-compact="true"]');
        metrics.push(
          await measureDensity(page, starters, {
            key: `discover-grid-${mode}`,
            phone,
            // Keep full catalog prompts readable at four-column desktop widths.
            maxHeight: 360,
          }),
        );
        await densityAxe(page);
        await densityScreenshots(page, starters, info, `discover-${mode}`);
      }

      for (const locale of ["de-DE", "ko-KR"] as const) {
        await specialistLocale(page, locale);
        await page.goto("/library?type=surveys");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const items = collection(page);
        await expect(items.getByRole("article")).toHaveCount(8);
        // The layout group's order is stable across translations; labels remain authored by the app.
        await page.locator('main [role="group"]').getByRole("button").nth(1).click();
        await expect(items).toHaveAttribute("data-view", "list");
        await expect(
          items.getByRole("heading", { name: densityLongTitle, exact: true }),
        ).toHaveText(densityLongTitle);
        metrics.push(
          await measureDensity(page, items, {
            key: `library-surveys-list-${locale}`,
            phone,
            list: true,
          }),
        );
        await densityAxe(page);
        await densityScreenshots(page, items, info, `library-${locale}`, { longItem: true });
      }
      expect(fixture.mutations).toEqual([]);
    } finally {
      await specialistLocale(page, "en-CA");
      await saveDensityMetrics(info, "library-discover", metrics);
    }
  });

  test(`Workspace Sessions, Results and Assignments retain useful density ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const phone = suffix.includes("mobile");
    await page.setViewportSize({ width: phone ? 320 : 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/sessions" });
    await specialistLocale(page, "en-CA");
    const fixture = await installDensityFixtures(page);
    const metrics: DensityMetric[] = [];
    try {
      for (const mode of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: mode });
        await page.goto("/sessions");
        await expect(
          page.getByRole("heading", { name: "Sessions", level: 1, exact: true }),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
        for (const type of mode === "light" ? ["rounds", "presentations", "surveys"] : ["rounds"]) {
          await page.locator(`#${type}-tab`).click();
          await expect(page.locator(`#${type}-tab`)).toHaveAttribute("aria-selected", "true");
          const items = collection(page);
          await expect(items.getByRole("article")).toHaveCount(8);
          for (const view of ["grid", "list"] as const) {
            await layoutButton(page, view).click();
            await expect(items).toHaveAttribute("data-view", view);
            metrics.push(
              await measureDensity(page, items, {
                key: `sessions-${type}-${view}-${mode}`,
                phone,
                list: view === "list",
                // Presentation sessions retain their separate freshness/access dates.
                maxHeight: 280,
              }),
            );
          }
          await expectInternalLinks(items.getByRole("article"));
          if (type === "rounds") {
            await expect(
              items
                .getByRole("article")
                .first()
                .getByRole("link", { name: "View Result", exact: true }),
            ).toHaveAttribute("href", `/report/${fixture.reports[0]!.id}`);
            await layoutButton(page, "grid").click();
            await densityAxe(page);
            await densityScreenshots(page, items, info, `sessions-${mode}`);
          }
        }

        await page.goto("/results");
        await expect(
          page.getByRole("heading", { name: "Results", level: 1, exact: true }),
        ).toBeVisible();
        const views = page.getByRole("navigation", { name: "Evidence views", exact: true });
        for (const view of mode === "light"
          ? ["results", "presentations", "surveys", "practice"]
          : ["results"]) {
          const href = view === "results" ? "/results" : `/results?view=${view}`;
          const tab = views.locator(`a[href="${href}"]`);
          await tab.click();
          await expect(tab).toHaveAttribute("aria-current", "page");
          const items = collection(page);
          await expect(items.getByRole("article")).toHaveCount(8);
          for (const layout of ["grid", "list"] as const) {
            await layoutButton(page, layout).click();
            await expect(items).toHaveAttribute("data-view", layout);
            metrics.push(
              await measureDensity(page, items, {
                key: `results-${view}-${layout}-${mode}`,
                phone,
                list: layout === "list",
                // Practice adds opening/closing dates and completion evidence.
                maxHeight: view === "practice" ? 380 : 340,
              }),
            );
          }
          await expectInternalLinks(items.getByRole("article"));
          if (view === "results") {
            await expect(
              items
                .getByRole("article")
                .first()
                .getByRole("link", { name: "Open Recovery Story", exact: true }),
            ).toHaveAttribute("href", `/report/${fixture.reports[0]!.id}`);
            await layoutButton(page, "grid").click();
            await densityAxe(page);
            await densityScreenshots(page, items, info, `results-${mode}`);
          }
        }

        await page.goto("/assignments");
        await expect(
          page.getByRole("heading", { name: "Assignments", level: 1, exact: true }),
        ).toBeVisible();
        const assignments = page.locator("main section:has(> article)");
        metrics.push(
          await measureDensity(page, assignments, {
            key: `assignments-${mode}`,
            phone,
            list: true,
            maxHeight: 260,
          }),
        );
        await expect(assignments.getByRole("article").first().getByRole("link")).toHaveAttribute(
          "href",
          `/practice/${fixture.followups[0]!.id}`,
        );
        await expectInternalLinks(assignments.getByRole("article"));
        await densityAxe(page);
        await densityScreenshots(page, assignments, info, `assignments-${mode}`);
      }

      for (const locale of ["de-DE", "ko-KR"] as const) {
        await specialistLocale(page, locale);
        await page.goto("/results?view=practice");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const items = collection(page);
        await expect(items.getByRole("article")).toHaveCount(8);
        await page.locator('main [role="group"]').getByRole("button").nth(1).click();
        await expect(items).toHaveAttribute("data-view", "list");
        metrics.push(
          await measureDensity(page, items, {
            key: `results-practice-list-${locale}`,
            phone,
            list: true,
          }),
        );
        await densityAxe(page);
        await densityScreenshots(page, items, info, `results-practice-${locale}`, {
          longItem: true,
        });
      }

      await specialistLocale(page, "en-CA");
      await page.goto("/groups");
      await page.getByRole("button", { name: "Create group", exact: true }).click();
      const form = page
        .locator("form")
        .filter({ has: page.getByRole("textbox", { name: "Group name", exact: true }) });
      await expect(form).toBeVisible();
      for (const width of [900, 1024, 768, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
          .toBeLessThanOrEqual(1);
        const fields = await form.locator("input, textarea, button").evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right, width: box.width };
          }),
        );
        for (const field of fields) {
          expect(field.width).toBeGreaterThan(0);
          expect(field.left).toBeGreaterThanOrEqual(0);
          expect(field.right).toBeLessThanOrEqual(width + 1);
        }
      }
      await densityScreenshots(page, form, info, "groups-create-320-dark");
      expect(fixture.mutations).toEqual([]);
    } finally {
      await specialistLocale(page, "en-CA");
      await saveDensityMetrics(info, "history-assignments", metrics);
    }
  });
}
