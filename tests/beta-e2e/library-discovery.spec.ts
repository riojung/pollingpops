import { randomUUID } from "node:crypto";
import type { LibraryShareListFacets, LibraryShareSummary } from "@openround/contracts";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { openLibraryFilters } from "./library-controls";
import { expectDocumentReflow } from "./option-b-accessibility-support";
import { specialistLocale } from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
type Category = "All content" | "Rounds" | "Presentations" | "Surveys";

async function createWorkspaceItems(page: Page, query: string) {
  for (const [path, body] of [
    ["quizzes", { title: `${query} workspace Alpha` }],
    ["quizzes", { title: `${query} workspace Bravo` }],
    ["presentations", { title: `${query} workspace Charlie` }],
    ["surveys", { title: `${query} workspace Delta`, idempotencyKey: randomUUID() }],
  ] as const) {
    expect((await page.request.post(`${api}/v1/${path}`, { data: body })).status()).toBe(201);
  }
}

async function createFilteredSurveys(page: Page, search: string, title: string) {
  const createdFolder = await page.request.post(`${api}/v1/folders`, {
    data: { name: `Management folder ${randomUUID().slice(0, 8)}`, artifactType: "survey" },
  });
  expect(createdFolder.ok()).toBe(true);
  const { folder } = (await createdFolder.json()) as { folder: { id: string } };

  // Each other survey differs from the matching survey on just one filter.
  for (const [surveyTitle, archived, filed, favorite] of [
    [title, true, true, true],
    ["Different workshop topic", true, true, true],
    [`${search} draft`, false, true, true],
    [`${search} unfiled`, true, false, true],
    [`${search} unstarred`, true, true, false],
  ] as const) {
    const created = await page.request.post(`${api}/v1/surveys`, {
      data: { title: surveyTitle, idempotencyKey: randomUUID() },
    });
    expect(created.status()).toBe(201);
    let { survey } = (await created.json()) as { survey: { id: string; revision: number } };
    const surveyUrl = `${api}/v1/surveys/${survey.id}`;
    if (filed) {
      const organized = await page.request.patch(`${surveyUrl}/organization`, {
        data: {
          folderId: folder.id,
          expectedRevision: survey.revision,
          idempotencyKey: randomUUID(),
        },
      });
      expect(organized.ok()).toBe(true);
      ({ survey } = (await organized.json()) as { survey: typeof survey });
    }
    if (favorite) {
      const starred = await page.request.put(`${api}/v1/library/favorites/survey/${survey.id}`, {
        data: { favorite: true },
      });
      expect(starred.ok()).toBe(true);
    }
    if (archived) {
      const archive = await page.request.post(`${surveyUrl}/archive`, {
        data: { expectedRevision: survey.revision, idempotencyKey: randomUUID() },
      });
      expect(archive.ok()).toBe(true);
    }
  }
  return folder.id;
}

async function installIncomingShares(page: Page, query: string) {
  const organizationId = randomUUID();
  const sourceWorkspaceId = randomUUID();
  const fixtures = [
    { artifactType: "round", title: `${query} incoming Alpha`, progress: "new" },
    { artifactType: "round", title: `${query} incoming Bravo`, progress: "done" },
    { artifactType: "presentation", title: `${query} incoming Charlie`, progress: "done" },
    { artifactType: "survey", title: `${query} incoming Delta`, progress: "new" },
    { artifactType: "round", title: "Unrelated incoming content", progress: "new" },
  ] as const;
  const shares: LibraryShareSummary[] = fixtures.map((item) => ({
    ...item,
    id: randomUUID(),
    organizationId,
    organizationName: "Workshop organization",
    sourceWorkspaceId,
    sourceWorkspaceName: "Facilitator workspace",
    artifactId: randomUUID(),
    versionId: randomUUID(),
    description: "Workshop content shared with you.",
    sharedAt: "2026-10-01T12:00:00.000Z",
    permission: "view",
    audience: "people",
    message: "",
    dueAt: null,
    capabilities: { view: true, copy: false, manage: false },
  }));

  // The personal beta account has no organization. Canvas e2e exercises actual share creation.
  await page.route(`${api}/v1/library/shares?*`, async (route) => {
    const { searchParams } = new URL(route.request().url());
    if (searchParams.get("scope") !== "shared") return route.continue();
    const progress = searchParams.get("progress");
    const kind = searchParams.get("kind");
    const search = searchParams.get("q")?.toLowerCase() ?? "";
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const matching = shares.filter(
      (share) =>
        share.title.toLowerCase().includes(search) &&
        (!from || share.sharedAt >= from) &&
        (!to || share.sharedAt <= to),
    );
    const progressMatches = matching.filter((share) => !progress || share.progress === progress);
    const items = progressMatches.filter((share) => !kind || share.artifactType === kind);
    if (searchParams.get("sort") === "title_desc") items.reverse();
    const facets: LibraryShareListFacets = {
      kinds: {
        round: progressMatches.filter((share) => share.artifactType === "round").length,
        presentation: progressMatches.filter((share) => share.artifactType === "presentation")
          .length,
        survey: progressMatches.filter((share) => share.artifactType === "survey").length,
      },
      progress: {
        new: matching.filter((share) => share.progress === "new").length,
        done: matching.filter((share) => share.progress === "done").length,
        in_progress: 0,
      },
      permissions: { view: matching.length, use: 0 },
      total: items.length,
    };
    await route.fulfill({ json: { shares: items, nextCursor: null, facets } });
  });
  return shares;
}

async function expectCardArrangement(cards: Locator, columns: boolean) {
  await expect(cards).toHaveCount(2);
  const [first, second] = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, right, bottom } = element.getBoundingClientRect();
      return { x, y, right, bottom };
    }),
  );
  if (columns) {
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(1);
    expect(second!.x).toBeGreaterThanOrEqual(first!.right);
  } else {
    expect(Math.abs(first!.x - second!.x)).toBeLessThan(1);
    expect(second!.y).toBeGreaterThanOrEqual(first!.bottom);
  }
}

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}Library keeps categories, scope, filters and layout in sync`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: mobile ? 390 : 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInBeta(page, undefined, { returnTo: "/library" });
    await specialistLocale(page, "en-CA");
    const query = `Library-${randomUUID().slice(0, 8)}`;
    await createWorkspaceItems(page, query);
    const shares = await installIncomingShares(page, query);
    await page.goto("/library");

    const root = page.locator("[data-library-discovery]");
    const collection = root.locator("[data-library-collection]");
    const cards = collection.getByRole("article");
    const titles = cards.getByRole("heading");
    const category = (label: Category) =>
      root.getByRole("link", { name: new RegExp(`^${label}\\b`) });
    const workspace = root.getByRole("link", { name: "My workspace", exact: true });
    const shared = root.getByRole("link", { name: "Shared with me", exact: true });
    const workspaceSearch = root.getByRole("searchbox", {
      name: "Search all content",
      exact: true,
    });
    const sharedSearch = root.getByRole("searchbox", {
      name: "Search shared content",
      exact: true,
    });
    const grid = root.getByRole("button", { name: "Grid view", exact: true });
    const list = root.getByRole("button", { name: "List view", exact: true });
    const sort = root.getByRole("combobox", { name: "Sort by", exact: true });
    const status = root.getByRole("combobox", { name: "Status", exact: true });
    const progress = root.getByRole("combobox", { name: "Review progress", exact: true });

    await expect(workspace).toHaveAttribute("aria-current", "page");
    await expect(category("All content")).toHaveAttribute("aria-current", "page");
    if (!mobile) {
      const tabBounds = await category("All content").boundingBox();
      const searchBounds = await workspaceSearch.boundingBox();
      expect(Math.abs(tabBounds!.y - searchBounds!.y)).toBeLessThan(6);
      const dateBounds = await root.getByLabel("Updated from", { exact: true }).boundingBox();
      const gridBounds = await grid.boundingBox();
      expect(Math.abs(dateBounds!.y - gridBounds!.y)).toBeLessThan(6);
    }
    const kindInks = await root
      .getByRole("navigation", { name: "Library content types" })
      .locator("a[data-kind] svg")
      .evaluateAll((icons) => icons.map((icon) => getComputedStyle(icon).color));
    expect(new Set(kindInks).size).toBe(3);
    await workspaceSearch.fill(query);
    await workspaceSearch.press("Enter");
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === query);
    await expect(cards).toHaveCount(4);
    await sort.selectOption("title_desc");
    await expect(page).toHaveURL((url) => url.searchParams.get("sort") === "title_desc");
    await expect(titles).toHaveText(
      ["Delta", "Charlie", "Bravo", "Alpha"].map((name) => `${query} workspace ${name}`),
    );
    await page.screenshot({
      path: info.outputPath("workspace-all-content-grid.png"),
      fullPage: mobile,
      scale: "css",
    });
    await status.selectOption("draft");
    await expect(page).toHaveURL((url) => url.searchParams.get("status") === "draft");

    await category("Rounds").press("Enter");
    await expect(category("Rounds")).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(
      (url) => url.searchParams.get("kind") === "round" && !url.searchParams.has("type"),
    );
    await expect(titles).toHaveText([`${query} workspace Bravo`, `${query} workspace Alpha`]);
    await expect(workspaceSearch).toHaveValue(query);
    await expect(status).toHaveValue("draft");
    await expect(grid).toHaveAttribute("aria-pressed", "true");
    await expect(collection).toHaveAttribute("data-view", "grid");
    await expectCardArrangement(cards, !mobile);
    await expectDocumentReflow(page);
    const manage = root.getByRole("link", { name: "Manage Rounds", exact: true });
    await expect(manage).toHaveAttribute("href", /\/library\?[^#]*type=rounds/);

    await list.click();
    await expect(list).toHaveAttribute("aria-pressed", "true");
    await expect(collection).toHaveAttribute("data-view", "list");
    await expectCardArrangement(cards, false);
    await shared.click();
    await expect(shared).toHaveAttribute("aria-current", "page");
    await expect(category("Rounds")).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("scope") === "shared" &&
        url.searchParams.get("kind") === "round" &&
        !url.searchParams.has("status"),
    );
    await expect(titles).toHaveText([`${query} incoming Bravo`, `${query} incoming Alpha`]);
    await expect(sharedSearch).toHaveValue(query);
    await expect(sort).toHaveValue("title_desc");
    await expect(collection).toHaveAttribute("data-view", "list");
    await expect(manage).toHaveCount(0);
    await expectCardArrangement(cards, false);
    await expect(cards.last().getByRole("link", { name: "Open", exact: true })).toHaveAttribute(
      "href",
      `/library/shared/${shares[0]!.id}`,
    );

    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect(list).toHaveAttribute("aria-pressed", "true");
    await expect(collection).toHaveAttribute("data-view", "list");
    await expect(titles).toHaveText([`${query} incoming Bravo`, `${query} incoming Alpha`]);
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
    const activeInk = await category("Rounds").evaluate((link) => getComputedStyle(link).color);
    await expect(cards.first().locator('svg[data-kind="round"]')).toHaveCSS("stroke", activeInk);
    await expectDocumentReflow(page);
    await page.screenshot({
      path: info.outputPath("shared-rounds-list-dark.png"),
      fullPage: mobile,
      scale: "css",
    });
    await grid.click();
    await expect(collection).toHaveAttribute("data-view", "grid");
    await expectCardArrangement(cards, !mobile);
    await expectDocumentReflow(page);

    await progress.selectOption("done");
    await expect(titles).toHaveText([`${query} incoming Bravo`]);
    await category("Presentations").click();
    await expect(category("Presentations")).toHaveAttribute("aria-current", "page");
    await expect(titles).toHaveText([`${query} incoming Charlie`]);
    await expect(progress).toHaveValue("done");
    await category("Surveys").click();
    await expect(category("Surveys")).toHaveAttribute("aria-current", "page");
    await expect(root.getByRole("heading", { name: "No matching content" })).toBeVisible();
    await page.goBack();
    await expect(category("Presentations")).toHaveAttribute("aria-current", "page");
    await expect(progress).toHaveValue("done");
    await expect(titles).toHaveText([`${query} incoming Charlie`]);
    await page.goForward();
    await expect(category("Surveys")).toHaveAttribute("aria-current", "page");
    await progress.selectOption("all");
    await expect(titles).toHaveText([`${query} incoming Delta`]);
    await category("All content").click();
    await expect(category("All content")).toHaveAttribute("aria-current", "page");
    await expect(cards).toHaveCount(4);

    await category("Surveys").click();
    await expect(category("Surveys")).toHaveAttribute("aria-current", "page");
    await workspace.click();
    await expect(workspace).toHaveAttribute("aria-current", "page");
    await expect(category("Surveys")).toHaveAttribute("aria-current", "page");
    await expect(titles).toHaveText([`${query} workspace Delta`]);

    const filterSearch = `Management-${randomUUID().slice(0, 8)}`;
    const filteredTitle = `${filterSearch} selected`;
    const folder = await createFilteredSurveys(page, filterSearch, filteredTitle);
    const filters = { q: filterSearch, status: "archived", favorites: "true", folder };
    const matchesFilters = (url: URL) =>
      Object.entries(filters).every(([key, value]) => url.searchParams.get(key) === value);
    await page.goto(`/library?${new URLSearchParams({ kind: "survey", ...filters })}`);
    await expect(titles).toHaveText([filteredTitle]);
    await root.getByRole("link", { name: "Manage Surveys", exact: true }).click();
    await expect(page).toHaveURL(
      (url) => url.searchParams.get("type") === "surveys" && matchesFilters(url),
    );
    const management = page.getByRole("tabpanel", { name: /^Surveys/ });
    await expect(management.getByRole("article").getByRole("heading")).toHaveText([filteredTitle]);
    await expect(page.getByRole("searchbox", { name: "Search surveys", exact: true })).toHaveValue(
      filterSearch,
    );
    await openLibraryFilters(page);
    await expect(page.getByLabel("Filter by status", { exact: true })).toHaveValue("archived");
    await expect(page.getByLabel("Filter by folder", { exact: true })).toHaveValue(folder);
    await expect(page.getByRole("button", { name: "Favorites", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("link", { name: "Back to Survey library", exact: true }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("kind") === "survey" &&
        !url.searchParams.has("type") &&
        matchesFilters(url),
    );
    await expect(workspace).toHaveAttribute("aria-current", "page");
    await expect(category("Surveys")).toHaveAttribute("aria-current", "page");
    await expect(titles).toHaveText([filteredTitle]);
  });
}

test("Library date ranges filter workspace and shared content throughout navigation", async ({
  page,
}) => {
  await signInBeta(page, undefined, { returnTo: "/library" });
  await specialistLocale(page, "en-CA");
  const query = `Library dates ${randomUUID().slice(0, 8)}`;
  await createWorkspaceItems(page, query);
  const shares = await installIncomingShares(page, query);
  const sharedRound = shares.find(
    (share) => share.artifactType === "round" && share.progress === "done",
  )!;
  await page.route(`${api}/v1/library/shares/${sharedRound.id}`, (route) =>
    route.fulfill({ json: { share: sharedRound, questions: [] } }),
  );
  await page.goto(`/library?${new URLSearchParams({ q: query })}`);

  const root = page.locator("[data-library-discovery]");
  const cards = root.locator("[data-library-collection]").getByRole("article");
  const updatedFrom = root.getByLabel("Updated from", { exact: true });
  const updatedTo = root.getByLabel("Updated to", { exact: true });
  const rangeError = root.getByRole("alert");
  await expect(cards).toHaveCount(4);

  let releaseNavigation!: () => void;
  const navigationGate = new Promise<void>((resolve) => {
    releaseNavigation = resolve;
  });
  const isFirstDateUrl = (url: URL) =>
    url.pathname === "/library" && url.searchParams.get("dateTo") === "2000-01-01";
  const isFirstDateNavigation = (request: Request) =>
    isFirstDateUrl(new URL(request.url())) && request.headers().rsc === "1";
  await page.route(isFirstDateUrl, async (route) => {
    if (isFirstDateNavigation(route.request())) await navigationGate;
    await route.continue();
  });

  try {
    const request = page.waitForRequest(isFirstDateNavigation);
    await updatedTo.fill("2000-01-01");
    await request;
    await updatedFrom.fill("2000-01-02");
    await expect(rangeError).toHaveText("The end date must be on or after the start date.");
    await expect(page).toHaveURL((url) => !url.searchParams.has("dateTo"));
  } finally {
    releaseNavigation();
  }
  await expect(page).toHaveURL((url) => url.searchParams.get("dateTo") === "2000-01-01");
  await expect(root.getByRole("heading", { name: "No matching content" })).toBeVisible();
  await expect(updatedFrom).toHaveValue("2000-01-02");
  await expect(rangeError).toHaveText("The end date must be on or after the start date.");
  await expect(page).toHaveURL((url) => !url.searchParams.has("dateFrom"));
  await updatedTo.fill("2099-10-02");
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("dateFrom") === "2000-01-02" &&
      url.searchParams.get("dateTo") === "2099-10-02",
  );
  await expect(rangeError).toHaveCount(0);
  await expect(cards).toHaveCount(4);

  await root.getByRole("link", { name: "Shared with me", exact: true }).click();
  const sharedFrom = root.getByLabel("Shared from", { exact: true });
  const sharedTo = root.getByLabel("Shared to", { exact: true });
  await expect(sharedFrom).toHaveValue("2000-01-02");
  await expect(sharedTo).toHaveValue("2099-10-02");
  await expect(cards).toHaveCount(4);
  await sharedFrom.fill("2026-10-03");
  await expect(root.getByRole("heading", { name: "No matching content" })).toBeVisible();
  await page.goBack();
  await expect(sharedFrom).toHaveValue("2000-01-02");
  await expect(cards).toHaveCount(4);
  await cards
    .filter({ hasText: sharedRound.title })
    .getByRole("link", { name: "Open", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: sharedRound.title, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  await expect(sharedFrom).toHaveValue("2000-01-02");
  await expect(sharedTo).toHaveValue("2099-10-02");
  await expect(cards).toHaveCount(3);
  await root.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(sharedFrom).toHaveValue("");
  await expect(sharedTo).toHaveValue("");
});
