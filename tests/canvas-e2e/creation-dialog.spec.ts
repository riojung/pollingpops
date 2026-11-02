import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { api, fits, organization } from "./support";

async function prepareOrganization(page: Page, testInfo: TestInfo) {
  // Keep authentication's discarded landing-page prefetches outside the board document
  // whose runtime errors are asserted below. Both pages use the same real session.
  const authentication = await page.context().newPage();
  try {
    await organization(authentication, testInfo);
  } finally {
    await authentication.close();
  }
}

function observeCreation(page: Page) {
  let requests = 0;
  const errors: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      url.origin === api &&
      ["/v1/canvas-boards", "/v1/idea-boards"].includes(url.pathname)
    )
      requests++;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => {
    expect(requests, "Choosing a starter or editing settings must not create a board").toBe(0);
    expect(errors).toEqual([]);
  };
}

async function dialogFits(dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create board", exact: true })).toBeVisible();
  await expect
    .poll(
      () =>
        dialog.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const primary = element.querySelector<HTMLButtonElement>('button[type="submit"]');
          const action = primary?.getBoundingClientRect();
          return Boolean(
            action &&
            bounds.left >= -1 &&
            bounds.top >= -1 &&
            bounds.right <= innerWidth + 1 &&
            bounds.bottom <= innerHeight + 1 &&
            element.scrollWidth <= element.clientWidth + 1 &&
            action.left >= -1 &&
            action.top >= -1 &&
            action.right <= innerWidth + 1 &&
            action.bottom <= innerHeight + 1,
          );
        }),
      { message: "The dialog and primary action fit within the viewport" },
    )
    .toBe(true);
  await expect
    .poll(() =>
      dialog.locator("[data-starter-thumbnail]").evaluateAll((elements) =>
        elements.flatMap((element) => {
          const bounds = element.getBoundingClientRect();
          const thumbnail = element.querySelector("svg")?.getBoundingClientRect();
          return thumbnail &&
            thumbnail.left >= bounds.left - 1 &&
            thumbnail.top >= bounds.top - 1 &&
            thumbnail.right <= bounds.right + 1 &&
            thumbnail.bottom <= bounds.bottom + 1
            ? []
            : [element.getAttribute("data-starter-thumbnail")];
        }),
      ),
    )
    .toEqual([]);
}

async function outerScroll(page: Page) {
  return page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
}

async function accessibleDialog(
  page: Page,
  selector = '[data-testid="board-creation-dialog"][open]',
) {
  // WebKit can paint a system-theme change after the color-mode attribute updates.
  // Require the settled dialog to have no violations; persistent defects still fail.
  await expect
    .poll(
      async () =>
        (
          await new AxeBuilder({ page })
            .include(selector)
            .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
            .analyze()
        ).violations,
    )
    .toEqual([]);
}

async function templateLibraryFits(dialog: Locator) {
  await expect(dialog).toBeVisible();
  const use = dialog.getByRole("button", { name: "Use template", exact: true });
  await expect(use).toBeVisible();
  await expect
    .poll(
      () =>
        dialog.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.left >= -1 &&
            bounds.top >= -1 &&
            bounds.right <= innerWidth + 1 &&
            bounds.bottom <= innerHeight + 1 &&
            element.scrollWidth <= element.clientWidth + 1
          );
        }),
      { message: "The template library stays within the viewport without horizontal overflow" },
    )
    .toBe(true);
  await expect(use).toBeInViewport({ ratio: 1 });
}

async function editWorkshopSettings(dialog: Locator) {
  const prompt = dialog.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).not.toHaveValue("");
  await prompt.fill("What should we understand before our next milestone?");
  await dialog
    .locator("summary")
    .filter({ hasText: /^Workshop settings$/ })
    .click();
  const identity = dialog.getByRole("combobox", { name: "Participant identity", exact: true });
  await identity.selectOption("alias");
  await expect(identity).toHaveValue("alias");
  const moderation = dialog.getByRole("checkbox", {
    name: "Review ideas before publishing",
    exact: true,
  });
  await moderation.uncheck();
  await expect(moderation).not.toBeChecked();
  const visible = dialog.getByRole("checkbox", {
    name: "Show approved ideas during collection",
    exact: true,
  });
  await visible.check();
  await expect(visible).toBeChecked();
  const votes = dialog.getByRole("spinbutton", {
    name: "Votes per participant (1–10)",
    exact: true,
  });
  await votes.fill("5");
  await expect(votes).toHaveValue("5");
  const lifetime = dialog.getByRole("spinbutton", {
    name: "Board lifetime in days (1–30)",
    exact: true,
  });
  await lifetime.fill("14");
  await expect(lifetime).toHaveValue("14");
  await expect(prompt).toHaveValue("What should we understand before our next milestone?");
}

test("New board keeps desktop starters, settings and creation actions usable", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareOrganization(page, testInfo);
  const unchanged = observeCreation(page);
  await page.goto("/boards");
  const opener = page.getByRole("button", { name: "New board", exact: true });
  await opener.focus();
  const initialScroll = await outerScroll(page);
  await opener.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New board", exact: true });
  const title = dialog.getByRole("textbox", { name: "Board title", exact: true });
  await expect(title).toBeFocused();
  await expect(dialog.getByRole("heading", { name: "New board", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Team canvas", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await fits(page);
  await dialogFits(dialog);

  await page.setViewportSize({ width: 1440, height: 640 });
  const gallery = dialog.getByTestId("board-starters-scroll");
  const body = dialog.getByTestId("board-creation-body");
  const bodyScroll = await body.evaluate((element) => element.scrollTop);
  expect(await gallery.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  await gallery.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => gallery.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await body.evaluate((element) => element.scrollTop)).toBe(bodyScroll);
  await dialogFits(dialog);
  expect(await outerScroll(page)).toEqual(initialScroll);

  await page.setViewportSize({ width: 1440, height: 900 });
  const project = dialog.getByRole("button", { name: /Project kickoff/ });
  await project.focus();
  await project.press("Enter");
  await expect(project).toHaveAttribute("aria-pressed", "true");
  await expect(project.locator("svg").first()).toBeVisible();
  await expect(title).toHaveValue("Project kickoff");
  await title.fill("Planning our next release");
  await expect(title).toHaveValue("Planning our next release");
  await expect(dialog.getByRole("button", { name: "Create board", exact: true })).toBeEnabled();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    await dialogFits(dialog);
    await accessibleDialog(page);
    await gallery.evaluate((element) => element.scrollTo(0, 0));
    await dialog.screenshot({ path: testInfo.outputPath(`creation-desktop-${colorScheme}.png`) });
  }

  const workshop = dialog.getByRole("button", { name: "Guided workshop", exact: true });
  await workshop.click();
  await expect(workshop).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Team canvas", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(title).toHaveValue("Planning our next release");
  await editWorkshopSettings(dialog);
  await dialogFits(dialog);
  await accessibleDialog(page);
  expect(await outerScroll(page)).toEqual(initialScroll);
  unchanged();

  await dialog.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  unchanged();
});

test("@mobile New board fits 320 and 390 screens in both themes without creating during setup", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width: 320, height: 844 });
  await prepareOrganization(page, testInfo);
  const unchanged = observeCreation(page);
  await page.goto("/boards");
  const opener = page.getByRole("button", { name: "New board", exact: true });
  await opener.focus();
  const initialScroll = await outerScroll(page);
  await opener.tap();
  const dialog = page.getByRole("dialog", { name: "New board", exact: true });
  await fits(page);
  await dialogFits(dialog);
  const project = dialog.getByRole("button", { name: /Project kickoff/ });
  await project.tap();
  await expect(project).toHaveAttribute("aria-pressed", "true");
  const title = dialog.getByRole("textbox", { name: "Board title", exact: true });
  await expect(title).toHaveValue("Project kickoff");
  await title.fill("Our mobile project plan");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
      await fits(page);
      await dialogFits(dialog);
      await accessibleDialog(page);
      await dialog.screenshot({
        path: testInfo.outputPath(`creation-mobile-${width}-${colorScheme}.png`),
      });
      expect(await outerScroll(page)).toEqual(initialScroll);
    }
  }

  await dialog.getByRole("button", { name: "Guided workshop", exact: true }).tap();
  await expect(title).toHaveValue("Our mobile project plan");
  await editWorkshopSettings(dialog);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(page);
    await dialogFits(dialog);
    expect(await outerScroll(page)).toEqual(initialScroll);
  }
  await accessibleDialog(page);
  unchanged();
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 320, height: 256 },
  ]) {
    await page.setViewportSize(viewport);
    // Rotation can reflow the inert workspace; dialog scrolling must preserve that position.
    const resizedScroll = await outerScroll(page);
    await title.scrollIntoViewIfNeeded();
    await expect(title).toBeInViewport();
    await expect(title).toHaveValue("Our mobile project plan");
    const create = dialog.getByRole("button", { name: "Create board", exact: true });
    await create.scrollIntoViewIfNeeded();
    await dialogFits(dialog);
    await expect(create).toBeEnabled();
    expect(await outerScroll(page)).toEqual(resizedScroll);
  }
  await dialog.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  unchanged();
});

test("Template library searches and filters before opening a prefilled board setup", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareOrganization(page, testInfo);
  const unchanged = observeCreation(page);
  await page.goto("/boards");
  const strip = page.getByTestId("canvas-template-strip");
  const quickStart = strip.getByRole("button", { name: "Possibility map", exact: true });
  await expect(quickStart).toBeVisible();
  await expect(strip.getByRole("button", { name: "Project kickoff", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("board-library-template-strip.png") });
  const opener = page.getByRole("button", { name: "Explore templates", exact: true });
  await opener.focus();
  const initialScroll = await outerScroll(page);
  await opener.press("Enter");
  const library = page.getByRole("dialog", { name: "Template library", exact: true });
  const creation = page.getByRole("dialog", { name: "New board", exact: true });
  const search = library.getByLabel("Search templates", { exact: true });
  const project = library.getByRole("button", { name: "Project kickoff", exact: true });
  const possibility = library.getByRole("button", { name: "Possibility map", exact: true });
  await expect(search).toHaveAttribute("placeholder", /\S/);
  await expect(project).toBeVisible();
  await expect(creation).toHaveCount(0);

  await search.fill("kickoff");
  await expect(project).toBeVisible();
  await expect(possibility).toHaveCount(0);
  // This term occurs in the description, rather than the title or category.
  await search.fill("unknowns");
  await expect(project).toBeVisible();
  await expect(library.getByRole("button", { name: "Decision paths", exact: true })).toHaveCount(0);
  // Category copy is searchable even when it is absent from the card's title/description.
  await search.fill("Brainstorming");
  await expect(possibility).toBeVisible();
  await expect(project).toHaveCount(0);
  await search.fill("");
  const planning = library.getByRole("button", { name: "Project planning", exact: true });
  await planning.click();
  await expect(planning).toHaveAttribute("aria-pressed", "true");
  await expect(project).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Experience retrospective", exact: true }),
  ).toHaveCount(0);
  // A matching card in another category must not bypass the selected use-case filter.
  await search.fill("challenge");
  await expect(library.getByText("No matching templates", { exact: true })).toBeVisible();
  await library.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(library.getByRole("button", { name: "All templates", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(project).toBeVisible();
  await expect(possibility).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Experience retrospective", exact: true }),
  ).toBeVisible();

  await project.focus();
  await project.press("Enter");
  await expect(project).toHaveAttribute("aria-pressed", "true");
  await expect(library).toBeVisible();
  await expect(creation).toHaveCount(0);
  unchanged();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    await fits(page);
    await templateLibraryFits(library);
    await accessibleDialog(page, '[data-testid="canvas-template-browser"][open]');
    await library
      .getByTestId("template-browser-body")
      .evaluate((element) => element.scrollTo(0, 0));
    await library.screenshot({
      path: testInfo.outputPath(`template-library-desktop-${colorScheme}.png`),
    });
    expect(await outerScroll(page)).toEqual(initialScroll);
  }

  await library.getByRole("button", { name: "Use template", exact: true }).press("Enter");
  await expect(library).toHaveCount(0);
  const title = creation.getByRole("textbox", { name: "Board title", exact: true });
  await expect(title).toHaveValue("Project kickoff");
  await creation.getByRole("button", { name: "Guided workshop", exact: true }).click();
  await expect(creation.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "What must we understand together to begin this project well?",
  );
  await dialogFits(creation);
  unchanged();
  await creation.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
  await expect(creation).toHaveCount(0);

  await opener.focus();
  await opener.press("Enter");
  await expect(library).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(library).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.press("Enter");
  await expect(library).toBeVisible();
  await library.getByRole("button", { name: "Close template library", exact: true }).press("Enter");
  await expect(library).toHaveCount(0);
  await expect(opener).toBeFocused();

  await quickStart.focus();
  await quickStart.press("Enter");
  await expect(title).toHaveValue("Possibility map");
  await creation.getByRole("button", { name: "Guided workshop", exact: true }).click();
  await expect(creation.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "What could we try to make this challenge easier for the people affected?",
  );
  unchanged();
  await creation.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
  await expect(creation).toHaveCount(0);
  await expect(quickStart).toBeFocused();
  unchanged();
});

test("@mobile Template library remains usable at narrow widths before explicit creation", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width: 320, height: 844 });
  await prepareOrganization(page, testInfo);
  const unchanged = observeCreation(page);
  await page.goto("/boards");
  const opener = page.getByRole("button", { name: "Explore templates", exact: true });
  await opener.focus();
  const initialScroll = await outerScroll(page);
  await opener.tap();
  const library = page.getByRole("dialog", { name: "Template library", exact: true });
  const creation = page.getByRole("dialog", { name: "New board", exact: true });
  const search = library.getByLabel("Search templates", { exact: true });
  const project = library.getByRole("button", { name: "Project kickoff", exact: true });
  const body = library.getByTestId("template-browser-body");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
      await fits(page);
      await templateLibraryFits(library);
      await accessibleDialog(page, '[data-testid="canvas-template-browser"][open]');
      await body.evaluate((element) => element.scrollTo(0, 0));
      await library.screenshot({
        path: testInfo.outputPath(`template-library-mobile-${width}-${colorScheme}.png`),
      });
      expect(await outerScroll(page)).toEqual(initialScroll);
    }
  }

  const category = library.getByRole("combobox", { name: "Use cases", exact: true });
  await category.selectOption("project");
  await expect(category).toHaveValue("project");
  await search.fill("unknowns");
  await expect(project).toBeVisible();
  await project.tap();
  await expect(project).toHaveAttribute("aria-pressed", "true");
  await expect(creation).toHaveCount(0);
  await page.setViewportSize({ width: 844, height: 390 });
  const resizedScroll = await outerScroll(page);
  await search.scrollIntoViewIfNeeded();
  await expect(search).toBeInViewport();
  await templateLibraryFits(library);
  expect(await outerScroll(page)).toEqual(resizedScroll);
  unchanged();

  await library.getByRole("button", { name: "Use template", exact: true }).tap();
  await expect(library).toHaveCount(0);
  const title = creation.getByRole("textbox", { name: "Board title", exact: true });
  await expect(title).toHaveValue("Project kickoff");
  await title.fill("A mobile planning session");
  await expect(title).toHaveValue("A mobile planning session");
  await dialogFits(creation);
  unchanged();
  await creation.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(creation).toHaveCount(0);
  await opener.focus();
  await opener.tap();
  await expect(library).toBeVisible();
  await library.getByRole("button", { name: "Close template library", exact: true }).tap();
  await expect(library).toHaveCount(0);
  await expect(opener).toBeFocused();
  unchanged();
});
