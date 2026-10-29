import { expect, test, type Page } from "@playwright/test";
import { betaEmail, signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
async function signIn(page: Page) {
  await signInBeta(page);
  await expect(page.locator("main#main")).toBeVisible();
}

async function setAccountLocale(page: Page, locale: "en-CA" | "de-DE" | "ko-KR") {
  const response = await page.request.put(`${apiUrl}/v1/account/locale`, { data: { locale } });
  if (response.ok()) {
    await page.context().addCookies([
      {
        name: "openround-locale",
        value: locale,
        url: new URL(page.url()).origin,
        sameSite: "Lax",
      },
    ]);
  }
  return response;
}

test("workspace language selection updates immediately and persists across reloads", async ({
  page,
}) => {
  await signIn(page);

  // The beta suite shares one allowlisted workspace account. Establish a known
  // starting locale and always restore it so this regression cannot contaminate
  // later tests or a subsequent local run.
  const reset = await setAccountLocale(page, "en-CA");
  expect(reset.ok()).toBeTruthy();

  try {
    await page.goto("/home");
    await expect(page.getByLabel("Language: English (Canada)")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-CA");

    await page.getByLabel("Language: English (Canada)").click();
    const languageGroup = page.getByRole("radiogroup", { name: "Interface language" });
    const englishOption = languageGroup.getByRole("radio", { name: /English \(Canada\)/ });
    const germanOption = languageGroup.getByRole("radio", { name: /Deutsch/ });
    await expect(englishOption).toHaveAttribute("aria-checked", "true");
    await expect(englishOption).toHaveAttribute("tabindex", "0");
    await expect(germanOption).toHaveAttribute("tabindex", "-1");

    const localeSave = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === "/v1/account/locale",
    );
    await germanOption.click();
    expect((await localeSave).status()).toBe(200);

    await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
    await expect(page.locator("body")).not.toHaveAttribute("lang", "en-CA");
    await expect(page.getByLabel("Sprache: Deutsch")).toBeVisible();
    const localizedHeading = page.getByRole("heading", { name: "Start", level: 1 });
    await expect(localizedHeading).toBeVisible();
    await expect(page.getByPlaceholder("Bibliothek durchsuchen")).toBeVisible();
    await expect(page.getByLabel("Darstellung: System")).toBeVisible();
    const workspaceNavigation = page.getByRole("navigation", {
      name: "Arbeitsbereich",
      exact: true,
    });
    await expect(
      workspaceNavigation.getByRole("link", { name: "Bibliothek", exact: true }),
    ).toBeVisible();
    await expect(workspaceNavigation).toHaveAttribute("lang", "de-DE");
    await expect(page.locator("main#main")).toHaveAttribute("lang", "de-DE");
    await expect(localizedHeading.locator("xpath=ancestor::header[1]")).toHaveAttribute(
      "lang",
      "de-DE",
    );

    const localeCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === "openround-locale",
    );
    expect(localeCookie?.value).toBe("de-DE");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
    await expect(page.getByLabel("Sprache: Deutsch")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start", level: 1 })).toBeVisible();

    const accountResponse = await page.request.get(`${apiUrl}/v1/auth/me`);
    expect(accountResponse.ok()).toBeTruthy();
    const account = (await accountResponse.json()) as { creator: { locale: string } };
    expect(account.creator.locale).toBe("de-DE");
  } finally {
    const restore = await setAccountLocale(page, "en-CA");
    expect(restore.ok()).toBeTruthy();
  }
});

test("Korean localizes workspace settings without translating account data", async ({ page }) => {
  await signIn(page);
  const reset = await setAccountLocale(page, "en-CA");
  expect(reset.ok()).toBeTruthy();

  try {
    const korean = await setAccountLocale(page, "ko-KR");
    expect(korean.ok()).toBeTruthy();
    await page.goto("/account");

    await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
    await expect(page.locator("main#main")).toHaveAttribute("lang", "ko-KR");
    await expect(page.getByRole("heading", { name: "워크스페이스 설정", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "활성 워크스페이스" })).toBeVisible();
    await page.getByRole("tab", { name: "보안 및 연동", exact: true }).click();
    await expect(page.getByRole("heading", { name: "안전한 임베드 출처" })).toBeVisible();
    await page.getByRole("tab", { name: "구성원", exact: true }).click();
    await expect(page.getByRole("heading", { name: "워크스페이스 구성원" })).toBeVisible();
    await expect(page.getByRole("cell", { name: betaEmail, exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/home");
    await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    const restore = await setAccountLocale(page, "en-CA");
    expect(restore.ok()).toBeTruthy();
  }
});
