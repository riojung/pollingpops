import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { signInBeta } from "./sign-in";
const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

for (const surface of ["", "@mobile "]) {
  test(`${surface}creation choices and template filtering distinguish live polls from Surveys`, async ({
    page,
  }) => {
    await signInBeta(page);
    await page.goto("/create");
    await expect(page.getByRole("link", { name: /^Survey Share/ })).toBeVisible();
    await page.getByRole("link", { name: /^Live poll/ }).click();
    await page.getByRole("link", { name: /Start blank/ }).click();
    await expect(page.getByRole("radio", { name: /^Poll/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^Number/ })).toHaveCount(0);
    await page.goto("/templates");
    await page.getByLabel("Search templates").fill("api retries");
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("button", { name: "Preview questions" }).click();
    await expect(
      page.getByText("A client times out after submitting a payment.", { exact: false }),
    ).toBeVisible();
    await page.getByLabel("All categories").selectOption("education");
    await expect(page.getByText("No templates match these filters.")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test(`${surface}genuine Survey publishing, QR/link joining, saved resume, finalization and anonymous results`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(60000);
    await signInBeta(page);
    await page.goto("/create");
    await page.getByRole("link", { name: /^Survey Share/ }).click();
    await page.getByLabel("Search templates").fill("Training feedback");
    await page.getByRole("button", { name: "Use this starter", exact: true }).click();
    await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
    await page.getByLabel("Title", { exact: true }).fill("Synthetic Survey browser fixture");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Publish Survey", exact: true }).click();
    const shared = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/v1\/surveys\/.+\/rooms$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "Create sharing link", exact: true }).click();
    const room = (await (await shared).json()).room;
    await expect(page).toHaveURL(new RegExp(`/surveys/rooms/${room.id}$`));
    await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
    const qrDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download QR SVG", exact: true }).click();
    expect((await qrDownload).suggestedFilename()).toBe(`polling-pops-${room.code}-qr.svg`);
    const context = await browser.newContext({
      baseURL: page.url().split("/surveys")[0],
      reducedMotion: "reduce",
      viewport: { width: 390, height: 844 },
    });
    try {
      const participant = await context.newPage();
      await participant.goto(`/join?code=${room.code}`);
      await expect(
        participant.getByText("No nickname or learning identity is collected.", { exact: false }),
      ).toBeVisible();
      await expect(participant.getByLabel("Nickname")).toHaveCount(0);
      await participant.getByRole("button", { name: "Survey", exact: true }).click();
      await expect(participant).toHaveURL(new RegExp(`/survey/${room.id}$`));
      await participant.getByRole("button", { name: "Submit Survey", exact: true }).click();
      await expect(participant.getByRole("main").getByRole("alert")).toContainText("Question 1");
      await participant.getByRole("radio", { name: "More practice", exact: true }).check();
      await participant.getByRole("radio", { name: "4", exact: true }).check();
      await participant.getByRole("button", { name: "Save progress", exact: true }).click();
      await expect(participant.getByRole("status")).toContainText("Progress saved");
      await participant.reload();
      await expect(
        participant.getByRole("radio", { name: "More practice", exact: true }),
      ).toBeChecked();
      expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
      await participant.getByRole("button", { name: "Submit Survey", exact: true }).click();
      await expect(participant.getByRole("heading", { name: "Thank you" })).toBeVisible();
      await participant.reload();
      await expect(participant.getByRole("heading", { name: "Thank you" })).toBeVisible();
      await page.getByRole("button", { name: "Refresh results", exact: true }).click();
      await expect(
        page.getByText("Distributions stay hidden while this Survey is open.", { exact: false }),
      ).toBeVisible();
      for (let i = 0; i < 4; i++) {
        const headers = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
        const joined = await context.request.post(`${api}/v1/survey-rooms/join`, {
          headers,
          data: { code: room.code },
        });
        expect(joined.ok()).toBeTruthy();
        const attempt = (await joined.json()).attempt;
        const responses = Object.fromEntries(
          attempt.content.items.map(
            ({
              question,
            }: {
              question: { id: string; type: string; choices?: { id: string }[] };
            }) => [
              question.id,
              question.type === "poll"
                ? { kind: "poll", choiceIds: [question.choices![0]!.id] }
                : { kind: "rating", value: 3 },
            ],
          ),
        );
        expect(
          (
            await context.request.post(`${api}/v1/survey-rooms/${room.id}/submit`, {
              headers,
              data: { idempotencyKey: randomUUID(), expectedRevision: 0, responses },
            })
          ).ok(),
        ).toBeTruthy();
      }
      await page.getByRole("button", { name: "Refresh results", exact: true }).click();
      await expect(page.getByText("5 finalized submissions.", { exact: false })).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Close admissions and submissions", exact: true })
        .click();
      await expect(page.getByRole("table")).toHaveCount(2);
      // Editors retain close controls but never see the owner's destructive action.
      await page.route("**/v1/auth/me", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.creator.role = "editor";
        await route.fulfill({ response, json: body });
      });
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Close admissions and submissions", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Delete survey run", exact: true }),
      ).toHaveCount(0);
      await page.unroute("**/v1/auth/me");
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Delete survey run", exact: true }),
      ).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      await context.close();
    }
  });
  test(`${surface}archived Surveys can be duplicated without reopening the original draft`, async ({
    page,
  }) => {
    await signInBeta(page);
    await page.goto("/surveys/new");
    await page.getByRole("button", { name: "Create blank Survey", exact: true }).click();
    await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
    const originalUrl = page.url();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByRole("button", { name: "Archive", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add poll", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Duplicate", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    await expect(page).not.toHaveURL(originalUrl);
    await expect(page.getByRole("button", { name: "Add poll", exact: true })).toBeEnabled();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(/\(copy\)$/);
  });
}
