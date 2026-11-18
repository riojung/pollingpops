import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { api, fits, organization, web } from "./support";

function contentWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      /^\/v1\/(?:starters\/[^/]+\/use|quizzes|presentations|surveys|authoring\/jobs)(?:\/|$)/.test(
        path,
      )
    )
      writes.push(`${request.method()} ${path}`);
  });
  return writes;
}

async function method(page: Page, key: string) {
  const details = page.locator(`[data-creation-method="${key}"]`);
  await expect(details).toBeVisible();
  return details;
}

test("WX05 all entry surfaces navigate to compatible setup without creating drafts", async ({
  page,
}, info) => {
  await organization(page, info);
  const writes = contentWrites(page);
  await page.goto("/home");
  await page.getByRole("link", { name: "Ask a quick poll", exact: true }).click();
  await expect(page).toHaveURL(`${web}/create?type=poll`);
  await method(page, "roundBlank");
  await page.goto("/create");
  await page.getByRole("link", { name: /^Ask a quick poll/ }).click();
  await expect(page).toHaveURL(`${web}/create?type=poll`);
  const blank = page.getByRole("tab", { name: "Blank", exact: true });
  await blank.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Templates", exact: true })).toBeFocused();
  await method(page, "roundTemplate");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Templates", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.goBack();
  await method(page, "roundBlank");
  await page.goForward();
  await method(page, "roundTemplate");

  for (const [type, destination, details] of [
    ["rounds", "/create?type=custom&start=blank", "roundBlank"],
    ["presentations", "/create/presentation?start=blank", "presentationBlank"],
    ["surveys", "/surveys/new?start=blank", "surveyBlank"],
  ]) {
    await page.goto(`/templates?type=${type}&collection=team-meetings`);
    await page.getByRole("link", { name: "Start blank", exact: true }).click();
    await expect(page).toHaveURL(`${web}${destination}`);
    await method(page, details!);
  }
  await page.goto("/create/presentation");
  await page.locator('a[href="/create/presentation?start=outline"]').click();
  await method(page, "presentationOutline");
  await page.goto("/surveys/new");
  await page.locator('a[href="/surveys/new?start=template"]').click();
  await method(page, "surveyTemplate");
  expect(writes).toEqual([]);
});

test("WX05 paused source assistance leaves ordinary creation and separate outline setup usable", async ({
  page,
}, info) => {
  await organization(page, info);
  const writes = contentWrites(page);
  const status = await page.request.get(`${api}/v1/authoring/status`);
  expect(status.ok()).toBe(true);
  expect((await status.json()).status.enabled).toBe(false);
  await page.goto("/create?type=quiz&start=source");
  await method(page, "roundSource");
  await expect(page.getByText(/The authoring assistant is disabled/)).toBeVisible();
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await method(page, "roundImport");
  await expect(
    page.getByRole("button", { name: "Validate and import draft", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Templates", exact: true }).click();
  await method(page, "roundTemplate");
  await page.getByRole("tab", { name: "Blank", exact: true }).click();
  await method(page, "roundBlank");
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Create Round and write question", exact: true }).click();
  await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+(?:\?insert=single_select)?$/);
  await expect(page.getByRole("textbox", { name: "Question prompt", exact: true })).toBeVisible();
  expect(writes.filter((path) => path === "POST /v1/quizzes")).toHaveLength(1);
  await page.goto("/create/presentation?start=outline");
  await method(page, "presentationOutline");
  await expect(page.getByRole("textbox", { name: /title/i })).toBeEnabled();
  await page.goto("/create/presentation?start=blank");
  await method(page, "presentationBlank");
  await page.getByRole("button", { name: "Start blank →", exact: true }).click();
  await expect(page).toHaveURL(/\/presentation\/[0-9a-f-]+$/);
  expect(writes.filter((path) => path === "POST /v1/presentations")).toHaveLength(1);
  await page.goto("/surveys/new?start=blank");
  await method(page, "surveyBlank");
  await page.getByRole("button", { name: "Create blank Survey", exact: true }).click();
  await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
  expect(writes.filter((path) => path === "POST /v1/surveys")).toHaveLength(1);
});

test("WX05 legacy hashes and invalid or incompatible method links recover explicitly", async ({
  page,
}, info) => {
  await organization(page, info);
  const writes = contentWrites(page);
  await page.goto("/create#source");
  await method(page, "roundSource");
  await page.evaluate(() => {
    window.location.hash = "import";
  });
  await method(page, "roundImport");
  await page.goBack();
  await method(page, "roundSource");
  await page.goto("/create?type=poll&start=source");
  await expect(page.locator("[data-creation-method]")).toHaveCount(0);
  await expect(page.locator('a[href="/create?type=custom&start=source"]')).toBeVisible();
  await page.getByRole("tab", { name: "Blank", exact: true }).click();
  await method(page, "roundBlank");
  for (const path of [
    "/create?type=quiz&start=blank&start=source#source",
    "/create/presentation?start=design&start=source",
    "/surveys/new?start=outline",
  ]) {
    await page.goto(path);
    await expect(page.locator("[data-creation-method]")).toHaveCount(0);
    await expect(
      page.getByText("That creation method is unavailable. Choose one below."),
    ).toBeVisible();
  }
  expect(writes).toEqual([]);
});

for (const locale of ["en-CA", "ko-KR"] as const) {
  test(`WX05 method explanations remain usable at 320px in ${locale} @mobile`, async ({
    page,
  }, info) => {
    await organization(page, info);
    await page.request.put(`${api}/v1/account/locale`, { data: { locale } });
    await page
      .context()
      .addCookies([{ name: "openround-locale", value: locale, url: web, sameSite: "Lax" }]);
    await page.setViewportSize({ width: 320, height: 844 });
    const writes = contentWrites(page);
    for (const [path, key] of [
      ["/create?type=quiz&start=import", "roundImport"],
      ["/create/presentation?start=blank", "presentationBlank"],
      ["/surveys/new?start=blank", "surveyBlank"],
    ]) {
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(path!);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const details = await method(page, key!);
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        width: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll("main, main *")]
          .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 12)
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            width: element.getBoundingClientRect().width,
            right: element.getBoundingClientRect().right,
          })),
      }));
      if (layout.width > layout.viewport)
        console.log("WX05 overflow", path, JSON.stringify(layout));
      await fits(page);
      expect(
        (
          await new AxeBuilder({ page })
            .include("main")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      if (locale === "ko-KR")
        await details.screenshot({ path: info.outputPath(`wx05-${key}-${locale}-light.png`) });
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
      const textColor = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--ui-text-subtle)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      await expect(details.locator("dd").first()).toHaveCSS("color", textColor);
      expect(
        (
          await new AxeBuilder({ page })
            .include(`[data-creation-method="${key}"]`)
            .withRules(["color-contrast"])
            .analyze()
        ).violations,
      ).toEqual([]);
      if (locale === "ko-KR")
        await details.screenshot({ path: info.outputPath(`wx05-${key}-${locale}-dark.png`) });
    }
    await page.screenshot({ path: info.outputPath(`wx05-survey-${locale}.png`), fullPage: true });
    expect(writes).toEqual([]);
  });
}
