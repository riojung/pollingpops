import { signInCreator } from "../support/creator-auth";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { testEmail } from "./test-email";

test("Polling Pops identity, lollipop assets, and entry actions are usable", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Polling Pops");
  await expect(page.getByRole("link", { name: "Polling Pops", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Make every voice pop.", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Join a live Round" })).toBeVisible();
  await expect(page.locator(".brand-pop svg")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
    "href",
    "/brand/polling-pops-icon.svg",
  );
  expect(await page.locator("body").innerText()).not.toContain("OpenRound");

  for (const asset of ["logo.svg", "icon.svg", "apple.png", "social.png"]) {
    const response = await page.request.get(`/brand/polling-pops-${asset}`);
    expect(response.status()).toBe(200);
  }

  await page.getByLabel("Seven-digit Round code").fill("1234567");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/join\?code=1234567/);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`classic-editor checkpoint tabs remain readable in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await signInCreator(page, testEmail("pops-classic-tabs", testInfo));
    await page.getByLabel("Checkpoint set title").fill("Readable checkpoints");
    await page.getByRole("button", { name: "Create checkpoint set" }).click();

    const prompts = ["Every voice matters.", "Clear labels help everyone."];
    for (const prompt of prompts) {
      await page.getByRole("button", { name: "True or false", exact: true }).click();
      await page.getByRole("textbox", { name: "Checkpoint prompt", exact: true }).fill(prompt);
      await expect(page.getByRole("status")).toContainText("Saved");
    }

    // Firefox resets the media override during sign-in navigation. Apply it to
    // the final editor document, as in the workspace appearance regression.
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
    const tabs = page.locator(".question-list .question-tab");
    await expect(tabs).toHaveCount(2);
    // Check both prompts in each state so an unselected tab cannot hide behind the
    // selected-tab treatment or the beta builder's scoped styles.
    for (let index = 0; index < prompts.length; index += 1) {
      await tabs.nth(index).click();
      await expect(tabs.nth(index)).toHaveAttribute("aria-current", "true");
      await expect(tabs.nth(1 - index)).toHaveAttribute("aria-current", "false");
      await expect(
        page.getByRole("textbox", { name: "Checkpoint prompt", exact: true }),
      ).toHaveValue(prompts[index]!);
      const result = await new AxeBuilder({ page }).include(".question-list").analyze();
      expect(
        result.violations,
        `${colorScheme} mode with checkpoint ${index + 1} selected`,
      ).toEqual([]);
    }
  });

  test(`public surfaces retain readable Polling Pops colors in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const path of ["/", "/signin", "/join", "/pricing"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", colorScheme);
      await expect(page.getByRole("link", { name: "Polling Pops", exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${path} fits the viewport`,
      ).toBe(true);
      if (path === "/signin") {
        const joinLink = page.getByRole("link", { name: "Join a Round", exact: true });
        await expect(joinLink).toHaveClass(/button-quiet/);
        await expect(joinLink).toHaveCSS("min-height", "46px");
      }
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations, `${path} in ${colorScheme}`).toEqual([]);
    }
  });
}

test("Candy Pop remains accessible for a host and guest using dark appearance", async ({
  page,
  browser,
}, testInfo) => {
  await signInCreator(page, testEmail("pops-live", testInfo));
  await page.getByLabel("Checkpoint set title").fill("Every voice pops");
  await page.getByRole("button", { name: "Create checkpoint set" }).click();
  await expect(page.getByLabel("Experience preset")).toHaveValue("pops");
  await page.getByRole("button", { name: "True or false", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Checkpoint prompt", exact: true })
    .fill("A poll can help everyone be heard.");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("published", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Host", exact: true }).click();
  await expect(page.getByLabel("Experience preset")).toHaveValue("pops");
  await page.getByRole("button", { name: "Create live session" }).click();
  await expect(page.locator(".session-code")).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const code = (await page.locator(".session-code").innerText()).trim();
  const guestContext = await browser.newContext({ colorScheme: "dark", reducedMotion: "reduce" });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`/join?code=${code}`);
    await guest.getByLabel("Nickname").fill("Mint");
    await guest.getByRole("button", { name: "Join round" }).click();
    await expect(guest).toHaveURL(/\/play\//);
    await expect(guest.locator(".live-shell")).toHaveAttribute("data-pattern", "dots");
    expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Start round", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: "A poll can help everyone be heard." }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
  } finally {
    await guestContext.close();
  }
});
