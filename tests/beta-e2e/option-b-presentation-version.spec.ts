import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";
import {
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  type E01Record,
} from "./presentation-e01-support";

type PublishedRecord = E01Record & {
  title: string;
  currentVersionId: string | null;
  hasUnpublishedChanges: boolean;
};

async function readRecord(page: Page, id: string): Promise<PublishedRecord> {
  const response = await page.request.get(`${e01ApiUrl}/v1/presentations/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).presentation;
}

async function changeTitle(page: Page, id: string, title: string) {
  await page.getByRole("textbox", { name: "Presentation title", exact: true }).fill(title);
  await expect.poll(async () => (await readRecord(page, id)).title).toBe(title);
  await expect(page.getByRole("banner").getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Unpublished changes", { exact: true })).toBeVisible();
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Presentation version choice preserves published work, traps focus and recovers publication ${suffix}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const narrow = suffix === "@mobile";
    await page.setViewportSize(narrow ? { width: 390, height: 844 } : { width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const record = await createE01Deck(page, [e01Slide("Original published opening")]);
    const publishUrl = `${e01ApiUrl}/v1/presentations/${record.id}/publish`;
    const firstPublish = await page.request.post(publishUrl, {
      data: { expectedDraftRevision: record.draftRevision },
    });
    expect(firstPublish.status(), await firstPublish.text()).toBe(200);
    const initialVersionId = (await firstPublish.json()).version.id as string;
    const editorPath = `/presentation/${record.id}`;
    const hostPath = `${editorPath}/host`;

    await page.goto(editorPath);
    if (narrow) await closeE01Overlays(page);
    const latestTitle = `Unpublished choice ${randomUUID().slice(0, 8)}`;
    await changeTitle(page, record.id, latestTitle);
    const present = page.getByRole("link", { name: "Present", exact: true });
    const dialog = page.getByRole("dialog", {
      name: "Which version do you want to present?",
      exact: true,
    });
    const publishLatest = dialog.getByRole("button", {
      name: "Publish latest and present",
      exact: true,
    });
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });

    await present.focus();
    await present.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(publishLatest).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(present).toBeFocused();

    let publicationRequests = 0;
    await page.route(publishUrl, async (route) => {
      publicationRequests++;
      await route.continue();
    });
    await present.click();
    await dialog.getByRole("link", { name: "Present published version", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${hostPath}$`));
    const existingChoice = await readRecord(page, record.id);
    expect(existingChoice.currentVersionId).toBe(initialVersionId);
    expect(existingChoice.hasUnpublishedChanges).toBe(true);
    expect(existingChoice.title).toBe(latestTitle);
    expect(publicationRequests).toBe(0);
    await page.unroute(publishUrl);

    await page.goto(editorPath);
    if (narrow) await closeE01Overlays(page);
    const finalTitle = `${latestTitle} revised`;
    await changeTitle(page, record.id, finalTitle);
    await page.route(publishUrl, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Synthetic publication unavailable",
            requestId: randomUUID(),
          },
        }),
      });
    });
    await present.click();
    await publishLatest.click();
    await expect(dialog.getByRole("alert")).toContainText("Synthetic publication unavailable");
    await expect(page).toHaveURL(new RegExp(`${editorPath}$`));
    expect((await readRecord(page, record.id)).currentVersionId).toBe(initialVersionId);
    await expect(publishLatest).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(present).toBeFocused();
    await page.unroute(publishUrl);

    let release!: () => void;
    const pendingPublication = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(publishUrl, async (route) => {
      await pendingPublication;
      await route.continue();
    });
    try {
      await present.click();
      await publishLatest.click();
      await expect(dialog).toHaveAttribute("aria-busy", "true");
      await expect(dialog).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      const acceptedPublication = page.waitForResponse(
        (response) =>
          response.url() === publishUrl &&
          response.request().method() === "POST" &&
          response.status() === 200,
      );
      release();
      await acceptedPublication;
      await expect(page).toHaveURL(new RegExp(`${hostPath}$`));
      const latestChoice = await readRecord(page, record.id);
      expect(latestChoice.currentVersionId).not.toBe(initialVersionId);
      expect(latestChoice.hasUnpublishedChanges).toBe(false);
      expect(latestChoice.title).toBe(finalTitle);
    } finally {
      release();
      await page.unroute(publishUrl);
    }
  });
}
