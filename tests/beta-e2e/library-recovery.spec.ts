import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { specialistLocale } from "./option-b-specialist-support";
import {
  expectDocumentReflow,
  expectVisibleKeyboardFocus,
  tabTo,
} from "./option-b-accessibility-support";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}

async function collection(page: Page) {
  const query = `Recovery-${randomUUID().slice(0, 8)}`;
  for (const [path, body] of [
    ["quizzes", { title: `${query} Alpha Round with a deliberately long synthetic title` }],
    ["presentations", { title: `${query} Bravo Presentation` }],
    ["surveys", { idempotencyKey: randomUUID(), title: `${query} Charlie Survey` }],
  ] as const) {
    expect((await page.request.post(`${api}/v1/${path}`, { data: body })).status()).toBe(201);
  }
  return `/library?sort=title_asc&q=${query}`;
}

async function reads(page: Page) {
  const requests: URL[] = [];
  const mutations: string[] = [];
  const pending: Array<{
    cursor: boolean;
    fail: boolean;
    gate: ReturnType<typeof gate>;
    handled: ReturnType<typeof gate>;
    terminated: ReturnType<typeof gate>;
  }> = [];
  const gates: Array<ReturnType<typeof gate>> = [];
  const requestEnds = new Map<Request, ReturnType<typeof gate>>();
  const finishRequest = (request: Request) => {
    requestEnds.get(request)?.release();
    requestEnds.delete(request);
  };
  page.on("requestfinished", finishRequest);
  page.on("requestfailed", finishRequest);
  await page.route(`${api}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() !== "GET" &&
      /^\/v1\/(?:library|quizzes|presentations|surveys)(?:\/|$)/.test(url.pathname)
    ) {
      mutations.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (url.pathname !== "/v1/library/items") return route.continue();
    url.searchParams.set("limit", "1");
    requests.push(url);
    const index = pending.findIndex((entry) => entry.cursor === url.searchParams.has("cursor"));
    const held = index === -1 ? undefined : pending.splice(index, 1)[0];
    if (held) requestEnds.set(request, held.terminated);
    try {
      if (held) {
        await held.gate.promise;
        if (held.fail)
          return await route.fulfill({
            status: 503,
            json: { error: { code: "UNAVAILABLE", message: "Synthetic Library read unavailable" } },
          });
      }
      return await route.continue({ url: url.toString() });
    } finally {
      held?.handled.release();
    }
  });
  return {
    requests,
    mutations,
    hold(cursor: boolean, fail = false) {
      const held = gate();
      const handled = gate();
      const terminated = gate();
      gates.push(held);
      pending.push({ cursor, fail, gate: held, handled, terminated });
      return {
        release: held.release,
        settled: Promise.all([handled.promise, terminated.promise]),
      };
    },
    releaseAll() {
      gates.forEach((held) => held.release());
    },
  };
}

async function quality(page: Page) {
  await expectDocumentReflow(page);
  expect(
    (
      await new AxeBuilder({ page })
        .include("[data-library-discovery]")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

async function errorAppearances(page: Page, info: TestInfo) {
  for (const mode of ["light", "dark", "high-contrast"] as const) {
    const colorScheme = mode === "dark" ? "dark" : "light";
    await page.emulateMedia({
      colorScheme,
      forcedColors: mode === "high-contrast" ? "active" : "none",
    });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    await quality(page);
    await page.locator("[data-library-pagination]").screenshot({
      path: info.outputPath(`pagination-error-${mode}.png`),
      scale: "css",
    });
  }
  await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
}

for (const mobile of [false, true]) {
  const suffix = mobile ? " @mobile" : "";
  test(`Library pagination retains recovery focus and the exact failed cursor${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: mobile ? 320 : 1440, height: mobile ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/home" });
    await specialistLocale(page, "en-CA");
    const href = await collection(page);
    const fixture = await reads(page);
    const fail = fixture.hold(true, true);
    try {
      await page.goto(href);
      const root = page.locator("[data-library-discovery]");
      const rows = root.locator("[data-library-item]");
      const footer = root.locator("[data-library-pagination]");
      const summary = root.locator("#library-discovery-summary");
      const more = footer.getByRole("button", { name: "Load more", exact: true });
      await expect(rows).toHaveCount(1);
      await expect(summary).toContainText("Results: 3");
      await expect(summary).toContainText("Loaded: 1");
      await tabTo(page, more);
      await expectVisibleKeyboardFocus(more);
      await page.keyboard.press("Enter");
      await expect(footer).toBeFocused();
      await expect(footer).toHaveAttribute("aria-busy", "true");
      await expect(rows).toHaveCount(1);
      fail.release();
      await expect(footer.getByRole("alert")).toContainText("Your current results are kept");
      await expect(footer).toBeFocused();
      await expect(footer).toHaveAttribute("aria-busy", "false");
      await expectVisibleKeyboardFocus(footer);
      const belowRows = await footer.evaluate((node) => {
        const last = document.querySelector("[data-library-item]:last-child");
        return Boolean(
          last && last.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      });
      expect(belowRows).toBe(true);
      await errorAppearances(page, info);

      const retry = footer.getByRole("button", { name: "Retry", exact: true });
      const recover = fixture.hold(true);
      const failedCursor = fixture.requests.at(-1)!.searchParams.get("cursor");
      await tabTo(page, retry);
      await page.keyboard.press("Enter");
      await expect(footer).toBeFocused();
      await expect(footer).toHaveAttribute("aria-busy", "true");
      await expect(rows).toHaveCount(1);
      recover.release();
      await expect(rows).toHaveCount(2);
      expect(fixture.requests.at(-1)!.searchParams.get("cursor")).toBe(failedCursor);
      await expect(summary).toContainText("Results: 3");
      await expect(summary).toContainText("Loaded: 2");
      await expect(footer).toBeFocused();
      await expectVisibleKeyboardFocus(footer);

      const finish = fixture.hold(true);
      await tabTo(page, more);
      await page.keyboard.press("Enter");
      await expect(footer).toBeFocused();
      await expect(footer).toHaveAttribute("aria-busy", "true");
      finish.release();
      await expect(rows).toHaveCount(3);
      await expect(more).toHaveCount(0);
      await expect(footer).toBeFocused();
      await expect(footer).toContainText("Loaded: 3");
      await expectVisibleKeyboardFocus(footer);
      await quality(page);
      await footer.screenshot({ path: info.outputPath("pagination-complete.png"), scale: "css" });

      const clear = root.getByRole("button", { name: "Clear filters", exact: true });
      await tabTo(page, clear);
      await page.keyboard.press("Enter");
      const search = root.getByRole("searchbox", { name: "Search all content", exact: true });
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await expect(page).toHaveURL(/\/library\?sort=title_asc$/);
      await expectVisibleKeyboardFocus(search);
      expect(fixture.mutations).toEqual([]);
    } finally {
      fixture.releaseAll();
    }
  });

  test(`Library initial recovery and reset respect deliberate focus and query changes${suffix}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: mobile ? 320 : 1440, height: mobile ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/home" });
    await specialistLocale(page, "en-CA");
    const href = await collection(page);
    const fixture = await reads(page);
    const fail = fixture.hold(false, true);
    try {
      await page.goto(`${href}-missing`);
      const root = page.locator("[data-library-discovery]");
      const results = root.locator("[data-library-results]");
      const footer = root.locator("[data-library-pagination]");
      const rows = root.locator("[data-library-item]");
      const search = root.getByRole("searchbox", { name: "Search all content", exact: true });
      await expect(results).toHaveAttribute("aria-busy", "true");
      fail.release();
      await expect(root.getByRole("alert")).toContainText("Content could not be loaded");
      await expect(root.locator("#library-discovery-summary")).not.toContainText("Results: 0");
      const recover = fixture.hold(false);
      await tabTo(page, root.getByRole("button", { name: "Retry", exact: true }));
      await page.keyboard.press("Enter");
      await expect(results).toBeFocused();
      await expect(results).toHaveAttribute("aria-busy", "true");
      recover.release();
      const noMatches = root.getByRole("heading", { name: "No matching content", exact: true });
      await expect(noMatches).toBeVisible();
      await expect(results).toBeFocused();
      const emptyClear = noMatches.locator("..").getByRole("button", {
        name: "Clear filters",
        exact: true,
      });
      await tabTo(page, emptyClear);
      await page.keyboard.press("Enter");
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await expect(page).toHaveURL(/\/library\?sort=title_asc$/);

      await expectVisibleKeyboardFocus(search);
      await page.goto(href);
      await expect(rows).toHaveCount(1);
      const hold = fixture.hold(true);
      const more = footer.getByRole("button", { name: "Load more", exact: true });
      await tabTo(page, more);
      await page.keyboard.press("Enter");
      await expect(footer).toHaveAttribute("aria-busy", "true");
      await search.focus();
      hold.release();
      await expect(rows).toHaveCount(2);
      await expect(search).toBeFocused();

      const stale = fixture.hold(true);
      await tabTo(page, more);
      await page.keyboard.press("Enter");
      await expect(footer).toHaveAttribute("aria-busy", "true");
      const kind = root.getByRole("combobox", { name: "Library content type", exact: true });
      await kind.focus();
      await kind.selectOption("round");
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText("Alpha Round");
      stale.release();
      await stale.settled;
      await quality(page);
      await expect(kind).toBeFocused();
      await expect(footer).not.toBeFocused();
      await expect(rows).toHaveCount(1);
      await expect(root.locator("#library-discovery-summary")).toContainText("Results: 1");
      expect(fixture.mutations).toEqual([]);
    } finally {
      fixture.releaseAll();
    }
  });
}
