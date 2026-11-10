import { type Locator, type Page } from "@playwright/test";

export async function openHostControls(page: Page) {
  const more = page
    .getByTestId("host-command-bar")
    .locator("details")
    .filter({ has: page.getByText("More controls", { exact: true }) });
  if ((await more.count()) && (await more.getAttribute("open")) === null) {
    await more.locator("summary").click();
  }
}

export async function clickHostCommand(page: Page, name: string) {
  const command = page.getByTestId("host-command-bar").getByRole("button", { name, exact: true });
  if (!(await command.isVisible())) await openHostControls(page);
  await command.click();
}

export async function closeHostControls(bar: Locator) {
  const more = bar.locator("details");
  if ((await more.count()) && (await more.getAttribute("open")) !== null)
    await more.locator("summary").click();
}
