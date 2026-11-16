import { expect, type Page } from "@playwright/test";

export async function openLibraryFilters(page: Page) {
  const filters = page
    .getByRole("region", { name: "Library filters and layout", exact: true })
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: /^Filters(?: · \d+)?$/ }) });
  await expect(filters).toHaveCount(1);
  if ((await filters.getAttribute("open")) === null) await filters.locator("summary").click();
  await expect(filters).toHaveAttribute("open", "");
}
