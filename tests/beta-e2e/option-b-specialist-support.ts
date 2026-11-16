import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { e01ApiUrl } from "./presentation-e01-support";

export async function specialistLocale(page: Page, locale: "en-CA" | "ko-KR" | "de-DE") {
  expect(
    (await page.request.put(`${e01ApiUrl}/v1/account/locale`, { data: { locale } })).status(),
  ).toBe(200);
  await page
    .context()
    .addCookies([
      { name: "openround-locale", value: locale, url: new URL(page.url()).origin, sameSite: "Lax" },
    ]);
}

export async function specialistInspector(page: Page, tab: "content" | "media" = "content") {
  const map = page.locator('button[aria-controls="presentation-slide-navigator"]');
  if ((await map.getAttribute("aria-expanded")) === "true") await map.click();
  const toggle = page.locator('button[aria-controls="presentation-object-inspector"]');
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await page.locator(`#inspector-tab-${tab}`).click();
  return page.locator("#presentation-object-inspector");
}

export async function closeSpecialistInspector(page: Page) {
  const toggle = page.locator('button[aria-controls="presentation-object-inspector"]');
  if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
}

export async function specialistQuality(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
}

export async function specialistLanguage(control: Locator, locale: string) {
  await expect
    .poll(() => control.evaluate((element) => element.closest("[lang]")?.getAttribute("lang")))
    .toBe(locale);
}

export async function specialistTextSelection(textarea: Locator, start: number, end: number) {
  await textarea.focus();
  await textarea.evaluate(
    (element, range) => {
      (element as HTMLTextAreaElement).setSelectionRange(range.start, range.end);
    },
    { start, end },
  );
  // React tracks deliberate keyboard selection rather than a synthetic select event alone.
  await textarea.press("Shift");
}
