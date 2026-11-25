import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const labPath = "/dev/presentation-scene/learning-sequence";

test("rehearses the ordered handoff by keyboard at 320 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(labPath);
  const main = page.getByRole("main");
  await expect(main.getByRole("listitem")).toHaveCount(2);
  await expect(main.getByRole("listitem").nth(0)).toContainText("Read the handoff brief");
  await expect(main.getByRole("listitem").nth(1)).toContainText("Choose the next step");
  await expect(main.getByText("Suggested next step: Read the handoff brief.")).toBeVisible();
  await expect(main.getByText("brief-v3")).toBeVisible();
  await expect(main.getByText("practice-v2")).toBeVisible();

  const openReading = main.getByRole("button", { name: "Open reading", exact: true });
  await openReading.focus();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { name: "Read the handoff brief" })).toBeFocused();
  await main.getByRole("button", { name: "Back to checklist" }).press("Enter");
  await expect(openReading).toBeFocused();
  await openReading.press("Enter");
  await main.getByRole("button", { name: "Start mock attempt" }).press("Enter");
  await expect(main.getByRole("heading", { name: "A brief someone can act on" })).toBeVisible();
  await main.getByRole("button", { name: "Back to checklist" }).press("Enter");
  const reopen = main.getByRole("button", { name: "Open again reading" });
  await expect(reopen).toBeFocused();
  await reopen.press("Enter");
  await expect(main.getByRole("button", { name: "Resume mock attempt" })).toBeVisible();
  await main.getByRole("button", { name: "Back to checklist" }).press("Enter");
  await main.getByRole("button", { name: "Mark done for reading" }).press("Enter");
  await expect(main.getByText("Suggested next step: Choose the next step.")).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("keeps a required unavailable step incomplete and announces retry", async ({ page }) => {
  await page.goto(labPath);
  const main = page.getByRole("main");
  const required = main.getByRole("button", { name: "Mark done for reading" });
  await required.click();
  await expect(main.getByText("Required step marked done.")).toBeVisible();

  await main.getByRole("checkbox", { name: "Simulate reading unavailable" }).check();
  await expect(
    main.getByText("The required reading is unavailable. Retry it below."),
  ).toBeVisible();
  await expect(main.getByText("Required step marked done.")).toHaveCount(0);
  await expect(required).toBeDisabled();
  const retry = main.getByRole("button", { name: "Retry reading" });
  await retry.press("Enter");
  await expect(main.getByRole("status")).toHaveText("Reading is available again.");
  await expect(main.getByRole("button", { name: "Open reading", exact: true })).toBeFocused();
  await expect(main.getByText("Required step marked done.")).toBeVisible();
});

test("keeps checklist marks and mock attempts local and separate from independent activities", async ({
  page,
}) => {
  await page.goto(labPath);
  const externalActions: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      /^\/(v1|api)\//.test(url.pathname) ||
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    ) {
      externalActions.push(`${request.method()} ${url.pathname}`);
    }
  });

  const browserState = () =>
    page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
      search: location.search,
      hash: location.hash,
    }));
  const before = await browserState();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Open practice", exact: true }).click();
  await main.getByRole("button", { name: "Start mock attempt" }).click();
  await main.getByRole("radio", { name: /Name the open question/ }).check();
  await main.getByRole("button", { name: "Check answer" }).click();
  await expect(main.getByRole("status")).toHaveText(
    "That handoff gives the next person a clear action.",
  );
  await main.getByRole("button", { name: "Back to checklist" }).click();
  await main.getByRole("button", { name: "Skip optional step" }).click();
  await expect(main.getByText("Skipped by you")).toBeVisible();
  await expect(main.getByRole("heading", { name: "Choose the next step" })).toBeVisible();

  const checklist = main.getByRole("radio", { name: "Ordered checklist" });
  const independent = main.getByRole("radio", { name: "Independent activities" });
  await independent.check();
  await expect(main.getByText("practice-v2")).toBeVisible();
  await expect(main.getByText("Skipped by you")).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Skip optional step" })).toHaveCount(0);
  await main.getByRole("button", { name: "Open practice", exact: true }).click();
  await expect(main.getByRole("button", { name: "Start mock attempt" })).toBeVisible();
  await main.getByRole("button", { name: "Back to independent activities" }).click();

  await checklist.check();
  await expect(main.getByText("Skipped by you")).toBeVisible();
  await main.getByRole("button", { name: "Clear this checklist" }).click();
  await expect(main.getByText("Skipped by you")).toHaveCount(0);
  await main.getByRole("button", { name: "Open again practice" }).click();
  await main.getByRole("button", { name: "Resume mock attempt" }).click();
  await expect(main.getByRole("radio", { name: /Name the open question/ })).toBeChecked();
  await expect(main.getByRole("status")).toContainText("clear action");

  expect(await browserState()).toEqual(before);
  expect(externalActions).toEqual([]);
  await page.reload();
  await expect(main.getByText(/Reloading resets the checklist and mock attempts/)).toBeVisible();
  await expect(main.getByRole("button", { name: "Open practice", exact: true })).toBeVisible();
});
