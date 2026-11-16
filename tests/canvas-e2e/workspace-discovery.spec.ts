import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInCreator } from "../support/creator-auth";
import { testEmail } from "../e2e/test-email";
import { api, fits, organization, web } from "./support";

async function accessibleTheme(page: Page, colorScheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme });
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
  await expect.poll(async () => (await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await fits(page);
}

test("universal creation opens board setup and Home includes every authoring format", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await organization(page, testInfo);
  await page.goto("/home");
  const header = page.getByRole("banner");
  const create = header.getByRole("button", { name: "Create", exact: true });
  await create.click();
  const menu = create.locator("..");
  for (const [name, href] of [
    [/^Round\b/, "/create?product=round"],
    [/^Presentation\b/, "/create/presentation"],
    [/^Survey\b/, "/surveys/new"],
    [/^Idea board\b/, "/boards?create=1"],
  ] as const)
    await expect(menu.getByRole("link", { name })).toHaveAttribute("href", href);
  await create.click();
  const homeCreation = page.getByRole("main").getByRole("link", { name: "Create", exact: true });
  await expect(homeCreation).toHaveCount(1);
  for (const link of await homeCreation.all())
    await expect(link).toHaveAttribute("href", "/create");
  await homeCreation.first().click();
  await expect(page).toHaveURL(/\/create$/);
  const primaryChoices = page.getByRole("navigation", {
    name: "What would you like to do?",
    exact: true,
  });
  await expect(primaryChoices.getByRole("button", { name: /^Ask a quick poll/ })).toBeVisible();
  for (const label of ["Check understanding", "Build a presentation"])
    await expect(primaryChoices.getByRole("heading", { name: label, exact: true })).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: /^More formats$/ })
    .click();
  const choices = page.getByRole("navigation", { name: "More formats", exact: true });
  for (const label of ["Custom Round", "Survey", "Idea board"])
    await expect(choices.getByRole("heading", { name: label, exact: true })).toBeVisible();
  await accessibleTheme(page, "light");
  await page.screenshot({
    path: testInfo.outputPath("workspace-create-desktop.png"),
    fullPage: true,
  });
  let boardWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/v1\/(canvas-boards|idea-boards)$/.test(new URL(request.url()).pathname)
    )
      boardWrites++;
  });
  await choices.getByRole("link", { name: /^Idea board\b/ }).click();
  const setup = page.getByRole("dialog", { name: "New board", exact: true });
  await expect(setup).toBeVisible();
  await expect(page).toHaveURL(/\/boards$/);
  expect(boardWrites).toBe(0);
  await expect(setup.getByRole("textbox", { name: "Board title", exact: true })).toBeFocused();
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  const toolbar = page.getByRole("toolbar", { name: "Idea boards", exact: true });
  await expect(toolbar.getByRole("button", { name: "New board", exact: true })).toBeFocused();
  await header.getByRole("button", { name: "Create", exact: true }).click();
  await header.getByRole("link", { name: /^Idea board\b/ }).click();
  await expect(setup).toBeVisible();
  expect(boardWrites).toBe(0);
  await setup.getByRole("textbox", { name: "Board title", exact: true }).fill("Discovery canvas");
  await setup.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]+$/);
  const canvasHref = new URL(page.url()).pathname;
  const survey = await page.request.post(`${api}/v1/surveys`, {
    data: { title: "Discovery survey", idempotencyKey: randomUUID() },
  });
  expect(survey.status()).toBe(201);
  const surveyId = (await survey.json()).survey.id as string;
  const round = await page.request.post(`${api}/v1/quizzes`, {
    data: { title: "Discovery Round" },
  });
  expect(round.status()).toBe(201);
  const presentation = await page.request.post(`${api}/v1/presentations`, {
    data: { title: "Discovery presentation" },
  });
  expect(presentation.status()).toBe(201);
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Discovery Round", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Discovery presentation", exact: true }),
  ).toBeVisible();
  const boards = page.getByRole("region", { name: /^Idea boards/ });
  const surveys = page.getByRole("region", { name: /^Surveys/ });
  await expect(boards.getByRole("link", { name: /Discovery canvas/ })).toHaveAttribute(
    "href",
    canvasHref,
  );
  await expect(surveys.getByRole("link", { name: /Discovery survey/ })).toHaveAttribute(
    "href",
    `/surveys/${surveyId}`,
  );
  await expect(boards.getByRole("link", { name: "All", exact: true })).toHaveAttribute(
    "href",
    "/boards",
  );
  await expect(surveys.getByRole("link", { name: "All", exact: true })).toHaveAttribute(
    "href",
    "/library?type=surveys",
  );
  for (const mode of ["light", "dark"] as const) {
    await accessibleTheme(page, mode);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-home-${mode}.png`),
      fullPage: true,
    });
  }
  await boards.getByRole("link", { name: /Discovery canvas/ }).click();
  await expect(page).toHaveURL(new RegExp(`${canvasHref}$`));
  await page.goto("/boards");
  const search = toolbar.getByRole("searchbox", { name: "Search boards", exact: true });
  await search.fill("missing board");
  await expect(page.getByRole("link", { name: "Discovery canvas", exact: true })).toHaveCount(0);
  await search.fill("Discovery");
  await expect(page.getByRole("link", { name: "Discovery canvas", exact: true })).toBeVisible();
  await toolbar.getByRole("button", { name: "Owned", exact: true }).click();
  await expect(toolbar.getByRole("button", { name: "Owned", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const headerSearch = header.getByRole("searchbox", { name: "Search boards", exact: true });
  await headerSearch.fill("Discovery");
  await headerSearch.press("Enter");
  await expect(page).toHaveURL(/\/boards\?q=Discovery$/);
  await expect(search).toHaveValue("Discovery");
  await accessibleTheme(page, "dark");
  await page.screenshot({
    path: testInfo.outputPath("workspace-board-toolbar-dark.png"),
    fullPage: true,
  });
});

test("@mobile icon utilities and board filters fit 320 and 390 pixels with accessible controls", async ({
  page,
}, testInfo) => {
  const { owner } = await organization(page, testInfo);
  await page.goto("/boards");
  const header = page.getByRole("banner");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const mode of ["light", "dark"] as const) {
      await accessibleTheme(page, mode);
      for (const control of [
        header.getByRole("button", { name: /^EN: Language:/ }),
        header.getByRole("button", { name: /^Appearance:/ }),
        header.getByRole("link", { name: "Activity", exact: true }),
        header.getByRole("link", { name: "Help", exact: true }),
        header.getByRole("button", { name: "Feedback", exact: true }),
      ]) {
        await expect(control).toBeVisible();
        expect((await control.innerText()).trim()).toBe("");
        const bounds = (await control.boundingBox())!;
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      await expect(header.getByRole("button", { name: "Create", exact: true })).toContainText(
        "Create",
      );
      await page.screenshot({
        path: testInfo.outputPath(`workspace-boards-${width}-${mode}.png`),
        fullPage: true,
      });
    }
  }
  const feedback = header.getByRole("button", { name: "Feedback", exact: true });
  await feedback.click();
  const dialog = page.getByRole("dialog", { name: "Share feedback", exact: true });
  await expect(dialog.getByRole("textbox")).toBeFocused();
  await dialog.getByRole("button", { name: "Close feedback", exact: true }).click();
  await expect(feedback).toBeFocused();
  const language = header.getByRole("button", { name: /^EN: Language:/ });
  await language.click();
  await expect(
    page.getByRole("radiogroup", { name: "Interface language", exact: true }),
  ).toBeVisible();
  await language.press("Escape");
  await expect(language).toBeFocused();
  await header.getByRole("button", { name: "Create", exact: true }).click();
  await expect(header.getByRole("link", { name: /^Idea board\b/ })).toBeVisible();
  await fits(page);
  const board = await page.request.post(`${api}/v1/canvas-boards`, {
    data: {
      schemaVersion: 1,
      workspaceId: owner.creator.workspaceId,
      title: "Team planning",
      boardType: "team",
      operationId: randomUUID(),
    },
  });
  expect(board.status()).toBe(201);
  await page.goto("/home");
  await expect(
    page.getByRole("region", { name: /^Idea boards/ }).getByRole("link", { name: /Team planning/ }),
  ).toBeVisible();
  for (const mode of ["light", "dark"] as const) {
    await accessibleTheme(page, mode);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-home-mobile-${mode}.png`),
      fullPage: true,
    });
  }
});

test("an invited workspace viewer can discover work without creation actions", async ({
  page: owner,
  browser,
}, testInfo) => {
  await signInCreator(owner, testEmail("discovery-owner", testInfo));
  const created = await owner.request.post(`${api}/v1/surveys`, {
    data: { title: "Shared survey", idempotencyKey: randomUUID() },
  });
  expect(created.status()).toBe(201);
  const context = await browser.newContext({ baseURL: web, reducedMotion: "reduce" });
  const viewer = await context.newPage();
  try {
    const email = testEmail("discovery-viewer", testInfo);
    await signInCreator(viewer, email);
    const invitation = await owner.request.post(`${api}/v1/workspace/invitations`, {
      data: { email, role: "viewer" },
    });
    expect(invitation.status()).toBe(201);
    const token = new URL((await invitation.json()).debugUrl).searchParams.get("token");
    const accepted = await viewer.request.post(`${api}/v1/invitations/accept`, {
      data: { token, acceptPolicies: true },
    });
    expect(accepted.status()).toBe(200);
    await viewer.goto("/home");
    await expect(
      viewer.getByRole("banner").getByRole("button", { name: "Create", exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole("main").getByRole("link", { name: "Create", exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole("region", { name: /^Surveys/ }).getByRole("link", { name: /Shared survey/ }),
    ).toBeVisible();
    await viewer.goto("/create");
    await expect(
      viewer.getByRole("heading", { name: "This workspace role is read-only", exact: true }),
    ).toBeVisible();
    await expect(viewer.getByRole("link", { name: /^Idea board\b/ })).toHaveCount(0);
    await viewer.goto("/boards?create=1");
    await expect(viewer.getByRole("toolbar", { name: "Idea boards", exact: true })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "New board", exact: true })).toHaveCount(0);
    await expect(viewer.getByRole("dialog")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
