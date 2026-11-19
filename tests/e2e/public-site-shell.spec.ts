import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function publicSession(page: Page, workspaceShell?: boolean) {
  await page.route("**/v1/auth/me", (route) =>
    route.fulfill(
      workspaceShell === undefined
        ? { status: 401, json: { error: { code: "UNAUTHENTICATED" } } }
        : {
            json: {
              creator: { email: "shell-review@example.test" },
              productFeatures: { workspaceShell },
            },
          },
    ),
  );
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

async function revealNavigation(page: Page) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
}

async function revealJoin(page: Page) {
  const trigger = page
    .locator("header")
    .getByRole("button", { name: "Join", exact: true })
    .and(page.locator("[aria-controls]"));
  if (await trigger.isVisible()) await trigger.click();
}

test("product navigation works with keyboard and public destinations", async ({ page }) => {
  await publicSession(page);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/");
    await revealNavigation(page);
    const product = page.getByRole("button", { name: "Product", exact: true });
    await product.focus();
    await page.keyboard.press("Enter");
    await expect(product).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    const accessibility = await new AxeBuilder({ page })
      .include("header")
      .include("footer")
      .analyze();
    expect(accessibility.violations, `public navigation in ${colorScheme}`).toEqual([]);
    const polls = page.locator("header").getByRole("link", { name: /^Live polls/ });
    await expect(polls).toHaveAttribute("href", "/product/live-polls");
    await polls.focus();
    await page.keyboard.press("Escape");
    await expect(product).toBeFocused();
    await expect(product).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('header a[href="/templates"], header a[href="/help"]')).toHaveCount(
      0,
    );
    await expect(page.locator('header a[href="/examples"]')).toBeVisible();
  }
});

test("header preserves formatted leading-zero codes and waits for an explicit submit", async ({
  page,
}) => {
  await publicSession(page);
  await page.goto("/");
  await revealJoin(page);
  const code = page.locator("header").getByLabel("Seven-digit Round code", { exact: true });
  await code.fill("00 123-45");
  await expect(code).toHaveValue("0012345");
  await expect(page).toHaveURL(/\/$/);
  await code.press("Enter");
  await expect(page).toHaveURL(/\/join\?code=0012345$/);
});

for (const workspaceShell of [true, false]) {
  test(`signed-in workspace entry respects workspaceShell=${workspaceShell}`, async ({ page }) => {
    await publicSession(page, workspaceShell);
    await page.goto("/");
    await expect(
      page.locator("main").getByRole("link", { name: "Open workspace", exact: true }),
    ).toHaveAttribute("href", workspaceShell ? "/home" : "/dashboard");
    await revealNavigation(page);
    await expect(
      page.locator("header").getByRole("link", { name: "Open workspace", exact: true }),
    ).toHaveAttribute("href", workspaceShell ? "/home" : "/dashboard");
  });
}

test("public appearance supports light, dark and system", async ({ page }) => {
  await publicSession(page);
  await page.goto("/");
  await revealNavigation(page);
  const appearance = page.getByRole("button", { name: /^Appearance:/ });
  for (const mode of ["Dark", "Light", "System"]) {
    await appearance.click();
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-color-mode-preference",
      mode.toLowerCase(),
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
