import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { e01ApiUrl } from "./presentation-e01-support";

async function setLocale(page: Page, locale: "en-CA" | "ko-KR") {
  const response = await page.request.put(`${e01ApiUrl}/v1/account/locale`, { data: { locale } });
  expect(response.ok()).toBe(true);
  await page
    .context()
    .addCookies([
      { name: "openround-locale", value: locale, url: new URL(page.url()).origin, sameSite: "Lax" },
    ]);
}

for (const suffix of ["", " @mobile"]) {
  test(`Option B goals lead to one creation surface with keyboard starting methods${suffix}`, async ({
    page,
  }, info) => {
    await signInBeta(page, undefined, { returnTo: "/create" });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/quizzes")
        writes.push(request.url());
    });
    await expect(page.getByRole("button", { name: /^Ask a quick poll/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Build a presentation/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Custom Round/ })).toBeHidden();
    await page.screenshot({ path: info.outputPath("option-b-goals.png"), fullPage: true });
    await page.locator("summary", { hasText: "More formats" }).click();
    await expect(page.getByRole("link", { name: /^Custom Round/ })).toBeVisible();
    await page.getByRole("link", { name: /^Check understanding/ }).click();
    await expect(page.getByRole("heading", { name: "Start a blank Round" })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Starting points" });
    const blank = tabs.getByRole("tab", { name: "Blank", exact: true });
    await expect(blank).toHaveAttribute("aria-selected", "true");
    await blank.focus();
    await page.keyboard.press("ArrowRight");
    const templates = tabs.getByRole("tab", { name: "Templates", exact: true });
    await expect(templates).toHaveAttribute("aria-selected", "true");
    await expect(templates).toBeFocused();
    await expect(page).toHaveURL(/type=quiz&start=starters$/);
    await expect(page.getByRole("tabpanel")).toContainText("Use a Recovery starter");
    await page.keyboard.press("End");
    await expect(tabs.getByRole("tab", { name: "Import", exact: true })).toBeFocused();
    await expect(page).toHaveURL(/type=quiz&start=import$/);
    await page.keyboard.press("Home");
    await expect(blank).toBeFocused();
    await expect(page.getByRole("heading", { name: "Start a blank Round" })).toBeVisible();
    expect(writes).toHaveLength(0);
    if (suffix) await page.setViewportSize({ width: 320, height: 844 });
    if (suffix) {
      const navigation = page.getByRole("navigation", { name: "Workspace sections" });
      await expect(navigation.locator("summary")).toHaveText("More");
      await navigation.locator("summary").click();
      await expect(navigation.getByRole("link", { name: "Results", exact: true })).toBeVisible();
      await navigation.locator("summary").click();
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath("option-b-goal-methods.png"), fullPage: true });
  });

  test(`Option B goals and starting methods follow the saved Korean interface language${suffix}`, async ({
    page,
  }, info) => {
    await signInBeta(page, undefined, { returnTo: "/create" });
    try {
      await setLocale(page, "ko-KR");
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
      await expect(
        page.getByRole("heading", { name: "무엇을 하고 싶으세요?", level: 1 }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /^빠른 투표 진행/ })).toBeVisible();
      await page.getByRole("link", { name: /^이해도 확인/ }).click();
      const tabs = page.getByRole("tablist", { name: "시작 방법" });
      await expect(tabs.getByRole("tab", { name: "빈 문서", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await tabs.getByRole("tab", { name: "템플릿", exact: true }).click();
      await expect(page).toHaveURL(/type=quiz&start=starters$/);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
      await expect(tabs.getByRole("tab", { name: "템플릿", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(tabs).not.toContainText("Source assistance");
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      await page.screenshot({ path: info.outputPath("option-b-goals-korean.png"), fullPage: true });
    } finally {
      await setLocale(page, "en-CA");
    }
  });
}
