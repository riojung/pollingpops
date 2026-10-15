import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminEmail, apiOrigin, controlOrigin, localAdminHarness, signIn } from "./fixtures.mjs";

async function reviewAndApply(page: Page) {
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic feature management verification");
  await dialog.getByRole("button", { name: "Apply command", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Command completed" })).toBeVisible();
  await expect(page.getByText("Policy is up to date", { exact: true })).toBeVisible();
}

test("admin manages feature availability and plans without deployment changes", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const fixture = await localAdminHarness(context);
  await signIn(page, adminEmail);
  const sourceId = randomUUID();
  const summaryProbe = async () =>
    (
      await (
        await page.request.get(
          `${apiOrigin}/v1/session-summaries/features?kind=round&id=${sourceId}`,
        )
      ).json()
    ).enabled;
  expect(await summaryProbe()).toBe(false);
  await page.goto(controlOrigin);
  const navigation = page.getByRole("navigation", { name: "Operator areas" });
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("admin-overview-desktop.png"),
    fullPage: true,
  });
  await navigation.getByRole("button", { name: "Features", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Availability for Session summaries", exact: true })
    .selectOption("enabled");
  await page
    .getByRole("checkbox", { name: "Free plan includes Session summaries", exact: true })
    .check();
  await page
    .getByRole("combobox", { name: "Availability for Report exports", exact: true })
    .selectOption("enabled");
  await page
    .getByRole("checkbox", { name: "Free plan includes Report exports", exact: true })
    .check();
  for (const label of ["Audience scopes", "Feedback rooms", "Surveys"])
    await page
      .getByRole("combobox", { name: `Availability for ${label}`, exact: true })
      .selectOption("enabled");
  await expect(page.getByText("You have unsaved changes", { exact: true })).toBeVisible();
  await reviewAndApply(page);
  expect(await summaryProbe()).toBe(true);
  const account = await (await page.request.get(`${apiOrigin}/v1/auth/me`)).json();
  expect(account.entitlements).toMatchObject({ plan: "free", csvExport: true });
  expect(account.productFeatures.surveys).toBe(true);
  const created = await page.request.post(`${apiOrigin}/v1/surveys`, {
    data: { idempotencyKey: randomUUID() },
  });
  expect(created.status()).toBe(201);
  const surveyId = (await created.json()).survey.id;
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Availability for Session summaries", exact: true }),
  ).toHaveValue("enabled");
  await page.getByRole("button", { name: "Plans", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Free plan includes Session summaries", exact: true })
    .uncheck();
  await page.getByRole("checkbox", { name: "Free plan includes Surveys", exact: true }).uncheck();
  await reviewAndApply(page);
  expect(await summaryProbe()).toBe(false);
  expect(
    (
      await page.request.post(`${apiOrigin}/v1/surveys`, { data: { idempotencyKey: randomUUID() } })
    ).status(),
  ).toBe(404);
  expect((await page.request.get(`${apiOrigin}/v1/surveys/${surveyId}`)).ok()).toBe(true);
  await expect(
    page.getByRole("checkbox", { name: "Pro plan includes Session summaries", exact: true }),
  ).toBeChecked();
  expect((await fixture.state()).auditActions).toContain("features.update");
  await page
    .getByRole("searchbox", { name: "Search features", exact: true })
    .fill("session summar");
  await page.screenshot({
    path: testInfo.outputPath("admin-feature-plans-desktop.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-features-mobile.png"), fullPage: true });
});
