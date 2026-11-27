import { expect, type Page } from "@playwright/test";

export async function openLibraryFilters(page: Page) {
  const toggle = page
    .getByRole("region", { name: "Library filters and layout", exact: true })
    .getByRole("button", { name: /^Filters(?: · \d+)?$/ });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
