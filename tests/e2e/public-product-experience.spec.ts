import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInCreator } from "../support/creator-auth";
import { testEmail } from "./test-email";

async function signedOutPublicVisit(page: Page) {
  await page.route("**/v1/auth/me", (route) => route.fulfill({ status: 401, json: {} }));
  await page.route("**/v1/auth/navigation", (route) =>
    route.fulfill({
      json: {
        user: null,
        organizationManagementEnabled: false,
        organizations: [],
        operatorConsoleOrigin: null,
      },
    }),
  );
}

test("existing creators continue from public CTAs without authenticating again", async ({
  page,
}, testInfo) => {
  await signInCreator(page, testEmail("public-continuation", testInfo), { returnTo: "/home" });
  await page.goto("/product/live-polls");
  const create = page.locator("main").getByRole("link", { name: /^Start creating/ });
  await expect(create).toHaveCount(2);
  await expect(create.first()).toHaveAttribute("href", "/create");
  await expect(create.last()).toHaveAttribute("href", "/create");
  await create.first().click();
  await expect(page).toHaveURL(/\/create$/);

  await page.goto("/examples?example=team-retrospective");
  const template = page.getByRole("link", { name: /Open in Templates/ });
  await expect(template).toHaveAttribute(
    "href",
    "/templates?type=rounds&sourceId=team-retrospective&collection=team-meetings",
  );
  await template.click();
  await expect(page).toHaveURL(
    /\/templates\?type=rounds&sourceId=team-retrospective&collection=team-meetings$/,
  );
  await expect(page.getByRole("complementary", { name: "Selected public example" })).toContainText(
    "Team retrospective",
  );
});

test("homepage samples explain interactions without submitting participant data", async ({
  page,
}) => {
  await signedOutPublicVisit(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/") && request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/");
  const main = page.locator("main");
  const poll = main.getByRole("region", { name: "Live poll example", exact: true });
  await poll.getByRole("button", { name: /^Clearer priorities/ }).click();
  await expect(poll.getByRole("status")).toContainText("Your choice stays on this device");
  await expect(poll.getByRole("button", { name: /Clearer priorities/ })).toContainText("50%");

  await main.getByRole("button", { name: "Word cloud", exact: true }).click();
  const cloud = main.getByRole("region", { name: "Word cloud example", exact: true });
  await cloud.getByRole("button", { name: "Add “Clear priorities”", exact: true }).click();
  await expect(cloud.getByText("Clear priorities 6", { exact: true })).toBeVisible();
  await expect(cloud.getByRole("status")).toContainText("sample count increases");

  await main.getByRole("button", { name: "Quiz", exact: true }).click();
  const quiz = main.getByRole("region", { name: "Quiz example", exact: true });
  await expect(quiz.getByRole("button", { name: "Reveal sample answer" })).toBeDisabled();
  await quiz.getByRole("button", { name: "B $60", exact: true }).click();
  await quiz.getByRole("button", { name: "Reveal sample answer" }).click();
  await expect(quiz.getByRole("status")).toContainText("One quarter of $80 is $20");
  expect(writes).toEqual([]);
});

test("feature, use-case and guide routes are readable without an account", async ({ page }) => {
  await signedOutPublicVisit(page);
  for (const path of [
    "/product",
    "/product/live-polls",
    "/product/quizzes",
    "/product/word-clouds",
    "/product/live-qa",
    "/product/presentations",
    "/product/surveys",
    "/product/idea-boards",
    "/product/assignments",
    "/product/reports",
    "/product/collaboration",
    "/solutions",
    "/solutions/meetings",
    "/solutions/education",
    "/solutions/training",
    "/solutions/events",
    "/examples",
    "/resources",
    "/resources/getting-started",
  ]) {
    await page.goto(path);
    await expect(page.locator("main h1"), path).toBeVisible();
    await expect(page.locator("header form"), path).toHaveAttribute(
      "aria-label",
      "Join a live Round",
    );
    expect(await page.locator("body").innerText(), path).not.toContain(
      "Checking your creator session",
    );
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
  }
});

test("public example filters preserve an honest template destination through sign-in", async ({
  page,
}) => {
  await signedOutPublicVisit(page);
  await page.goto("/examples?type=round&useCase=meetings");
  const chooser = page.getByRole("combobox", { name: "Choose an example", exact: true });
  if (await chooser.isVisible()) await chooser.selectOption("team-retrospective");
  else await page.getByRole("button", { name: /Team retrospective/ }).click();
  await expect(
    page.getByRole("heading", { name: "Team retrospective", exact: true }),
  ).toBeVisible();
  const continueLink = page.getByRole("link", { name: /Open in Templates/ });
  const href = await continueLink.getAttribute("href");
  const returnTo = new URL(href!, "https://public.example.test").searchParams.get("returnTo");
  expect(returnTo).toContain("/templates?");
  expect(returnTo).toContain("sourceId=team-retrospective");
  expect(returnTo).toContain("collection=team-meetings");
  await page.getByLabel("Search examples").fill("no matching example qzx");
  await expect(
    page.getByRole("heading", { name: "No examples match those filters." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: /Open in Templates/ })).toBeVisible();
});

for (const mode of ["light", "dark"] as const) {
  test(`public product pages fit and remain accessible in ${mode} mode`, async ({ page }) => {
    await signedOutPublicVisit(page);
    await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
    for (const path of [
      "/",
      "/product/word-clouds",
      "/solutions/meetings",
      "/examples",
      "/resources/getting-started",
    ]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
      await expect(page.locator("main h1")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        path,
      ).toBe(true);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
          })),
        })),
        `${path} in ${mode}`,
      ).toEqual([]);
    }
  });
}
