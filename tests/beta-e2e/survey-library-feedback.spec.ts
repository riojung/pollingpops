import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { signInBeta } from "./sign-in";
const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

for (const surface of ["", "@mobile "]) {
  test(`${surface}Survey Library shares search, filters, favorites and layout; Feedback survives lost receipts`, async ({
    page,
  }) => {
    await signInBeta(page);
    const title = `Synthetic Library Survey ${randomUUID().slice(0, 8)}`;
    const created = await page.request.post(`${api}/v1/surveys`, {
      data: { idempotencyKey: randomUUID(), title },
    });
    expect(created.ok()).toBe(true);
    const survey = (await created.json()).survey;
    const folderResponse = await page.request.post(`${api}/v1/folders`, {
      data: { name: `Feedback ${randomUUID().slice(0, 8)}` },
    });
    expect(folderResponse.ok()).toBe(true);
    const folder = (await folderResponse.json()).folder;
    expect(
      (
        await page.request.patch(`${api}/v1/surveys/${survey.id}/organization`, {
          data: {
            expectedRevision: 0,
            idempotencyKey: randomUUID(),
            folderId: folder.id,
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto("/surveys");
    await expect(page).toHaveURL(/\/library\?type=surveys$/);
    await expect(page.getByRole("tab", { name: /^Surveys/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("searchbox", { name: "Search surveys", exact: true }).fill(title);
    const card = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(card).toHaveCount(1);
    await page
      .getByRole("searchbox", { name: "Search your workspace library", exact: true })
      .fill(title);
    await page
      .getByRole("searchbox", { name: "Search your workspace library", exact: true })
      .press("Enter");
    await expect(page).toHaveURL(/\/library\?type=surveys&q=/);
    await expect(page.getByRole("searchbox", { name: "Search surveys", exact: true })).toHaveValue(
      title,
    );
    await page.getByLabel("Filter by folder", { exact: true }).selectOption(folder.id);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: `Add ${title} to favorites`, exact: true }).click();
    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await expect(page.locator("#surveys-panel section[data-view=list]")).toBeVisible();
    await page.getByLabel("Filter by status", { exact: true }).selectOption("published");
    await expect(card).toHaveCount(0);
    await page.getByLabel("Filter by status", { exact: true }).selectOption("draft");
    await expect(card).toBeVisible();
    await page.getByRole("tab", { name: /^Rounds/ }).click();
    await expect(page.getByRole("searchbox", { name: "Search rounds", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: /^Surveys/ }).click();
    await expect(page.getByRole("searchbox", { name: "Search surveys", exact: true })).toHaveValue(
      title,
    );
    await expect(card).toBeVisible();
    if (test.info().project.name.includes("mobile")) {
      await page.setViewportSize({ width: 320, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
      const smallTrigger = page.getByRole("button", { name: "Feedback", exact: true });
      await expect(smallTrigger).toBeVisible();
      const smallBounds = await smallTrigger.boundingBox();
      expect(smallBounds!.x).toBeGreaterThanOrEqual(0);
      expect(smallBounds!.x + smallBounds!.width).toBeLessThanOrEqual(320);
      await page.setViewportSize({ width: 390, height: 844 });
    }
    const bounds = await card.getByRole("heading", { name: title, exact: true }).boundingBox();
    const cardBounds = await card.boundingBox();
    const artworkBounds = await card.locator(":scope > div[aria-hidden=true]").boundingBox();
    expect(bounds!.x).toBeGreaterThan(cardBounds!.x);
    expect(bounds!.x).toBeGreaterThanOrEqual(artworkBounds!.x + artworkBounds!.width);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(cardBounds!.x + cardBounds!.width);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results-beta/survey-library-${test.info().project.name}.png`,
      fullPage: true,
    });

    const trigger = page.getByRole("button", { name: "Feedback", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Share feedback", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox")).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(trigger).toBeFocused();
    await page.getByRole("button", { name: /^Appearance:/ }).click();
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
    await trigger.focus();
    await trigger.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox")).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results-beta/feedback-form-dark-${test.info().project.name}.png`,
      fullPage: true,
    });
    await dialog.press("Escape");
    await expect(trigger).toBeFocused();
    await page.getByRole("button", { name: /^Appearance:/ }).click();
    await page.getByRole("radio", { name: "Light", exact: true }).click();
    await trigger.click();
    await dialog
      .getByLabel("What would you like to share?", { exact: true })
      .fill("Synthetic beta feedback: Library search is easy to find; test a lost response.");
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    const keys: string[] = [];
    let originalId = "";
    await page.route(`${api}/v1/feedback`, async (route) => {
      keys.push(route.request().postDataJSON().idempotencyKey);
      if (keys.length === 1) {
        const saved = await route.fetch();
        expect(saved.status()).toBe(201);
        originalId = (await saved.json()).feedbackId;
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Your message is still here");
    await expect(dialog.getByRole("textbox")).not.toBeEmpty();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await dialog.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("saved for the product team");
    await expect(dialog.getByRole("status")).toContainText(originalId);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await page.screenshot({
      path: `test-results-beta/feedback-${test.info().project.name}.png`,
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.unroute(`${api}/v1/feedback`);
    await page.getByRole("link", { name: "Survey runs and results", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Survey runs", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to Survey library", exact: true }).click();
    await expect(page.getByRole("tab", { name: /^Surveys/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
}
