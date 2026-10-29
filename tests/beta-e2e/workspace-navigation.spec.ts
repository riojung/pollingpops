import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInBeta } from "./sign-in";

test("compact navigation preserves workspace access and gives editors more room", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInBeta(page);
  await page.goto("/home");
  const sidebar = page.locator("aside[data-collapsed]");
  const navigation = sidebar.getByRole("navigation", { name: "Workspace", exact: true });
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  const expandedWidth = (await sidebar.boundingBox())!.width;
  const collapse = sidebar.getByRole("button", { name: "Collapse navigation", exact: true });
  await collapse.focus();
  await page.keyboard.press("Space");
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(100);
  expect(expandedWidth - (await sidebar.boundingBox())!.width).toBeGreaterThan(140);
  await expect(
    sidebar.getByRole("button", { name: "Expand navigation", exact: true }),
  ).toBeFocused();
  for (const name of ["Home", "Library", "Sessions", "Results", "Workspace"]) {
    await expect(navigation.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(navigation.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sidebar.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include("aside").analyze()).violations).toEqual([]);

  await navigation.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/\/library/);
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");

  for (const path of ["/create", "/create/presentation", "/surveys/new"]) {
    await page.goto(path);
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${path} fits with the compact navigation`,
    ).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toBeHidden();
  const mobileNavigation = page.getByRole("navigation", {
    name: "Workspace sections",
    exact: true,
  });
  await expect(mobileNavigation.getByRole("link", { name: "Library", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await sidebar.getByRole("button", { name: "Expand navigation", exact: true }).click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
});
