import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

async function hostCommand(page: Page, action: () => Promise<unknown>) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        /\/v1\/idea-boards\/[^/]+\/commands$/.test(new URL(candidate.url()).pathname),
    ),
    action(),
  ]);
  expect(response.status(), await response.text()).toBe(200);
}

async function narrowAccessibility(page: Page) {
  await page.setViewportSize({ width: 320, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

async function visualEvidence(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`idea-board-${label}-${colorScheme}-${width}.png`),
        fullPage: true,
      });
    }
  }
}

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}idea boards collect, moderate, group and freeze a private guest ballot`, async ({
    page,
    browser,
  }) => {
    test.skip(process.env.BETA_E2E_IDEA_BOARDS !== "true", "Opt-in idea board writer journey");
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    await page.emulateMedia({ colorScheme: "dark" });
    await signInBeta(page);
    await page.goto("/boards");
    const title = `Synthetic board ${randomUUID().slice(0, 8)}`;
    const firstIdea = `Synthetic first priority ${"LongUnbrokenIdea".repeat(15)}`;
    await page.getByLabel("Board title", { exact: true }).fill(title);
    await page
      .getByLabel("Prompt", { exact: true })
      .fill("Synthetic priorities for our next meeting.");
    await expect(page.getByLabel("Review ideas before publishing", { exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Create board", exact: true }).click();
    await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.getByRole("button", { name: "Open collection", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start voting", exact: true })).toBeVisible();
    await narrowAccessibility(page);

    const publicContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
    await publicContext.addCookies([
      { name: "openround_creator", value: "synthetic-unrelated-cookie", url: api },
    ]);
    const guest = await publicContext.newPage();
    guest.setDefaultTimeout(15_000);
    const requests: Array<
      Promise<{
        url: string;
        cookie: string | undefined;
        authorization: string | undefined;
        referrer: string | undefined;
      }>
    > = [];
    guest.on("request", (request) => {
      if (
        new URL(request.url()).origin !== api ||
        !new RegExp(`/v1/idea-boards/${id}/(?:join|guest|ideas|votes)$`).test(
          new URL(request.url()).pathname,
        )
      )
        return;
      requests.push(
        request.allHeaders().then((headers) => ({
          url: request.url(),
          cookie: headers.cookie,
          authorization: headers.authorization,
          referrer: headers.referer,
        })),
      );
    });
    let primaryFailure: unknown = null;
    try {
      await guest.goto(`/board/${id}`);
      await expect(guest.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(guest.getByLabel("Your board nickname", { exact: true })).toHaveCount(0);
      await guest.getByRole("button", { name: "Join board", exact: true }).click();
      await guest.getByLabel("Your idea", { exact: true }).fill(firstIdea);
      await guest.getByRole("button", { name: "Submit idea", exact: true }).click();
      const own = guest
        .locator("section")
        .filter({ has: guest.getByRole("heading", { name: "Your submissions", exact: true }) });
      await expect(own).toContainText("Synthetic first priority");
      await expect(own).toContainText("Awaiting review");
      await guest.getByLabel("Your idea", { exact: true }).fill("Synthetic idea to remove");
      await guest.getByRole("button", { name: "Submit idea", exact: true }).click();
      await expect(own).toContainText("Synthetic idea to remove");

      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      const pending = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Awaiting review", exact: true }) });
      await expect(pending).toContainText("Synthetic idea to remove");
      await pending
        .getByRole("listitem")
        .filter({ hasText: "Synthetic first priority" })
        .getByRole("button", { name: "Approve", exact: true })
        .click();
      await pending
        .getByRole("listitem")
        .filter({ hasText: "Synthetic idea to remove" })
        .getByRole("button", { name: "Remove", exact: true })
        .click();
      await expect(pending).not.toContainText("Synthetic idea to remove");
      await page.getByLabel("Group name", { exact: true }).fill("Synthetic priority group");
      await hostCommand(page, () =>
        page.getByRole("button", { name: "Add group", exact: true }).click(),
      );
      await hostCommand(page, () =>
        page
          .getByLabel("Group for idea 1", { exact: true })
          .selectOption({ label: "Synthetic priority group" }),
      );
      await expect(page.getByLabel("Group for idea 1", { exact: true })).not.toHaveValue("");
      await hostCommand(page, () =>
        page.getByLabel("Show approved ideas during collection", { exact: true }).click(),
      );
      await expect(
        page.getByLabel("Show approved ideas during collection", { exact: true }),
      ).toBeChecked();
      await visualEvidence(page, "host");
      await narrowAccessibility(page);
      const approved = guest
        .locator("section")
        .filter({ has: guest.getByRole("heading", { name: "Approved ideas", exact: true }) });
      await expect(approved).toContainText("Synthetic first priority");
      await expect(approved).not.toContainText("Synthetic idea to remove");
      await expect(own).not.toContainText("Synthetic idea to remove");
      await expect(own).toContainText("Removed");
      await page.getByRole("button", { name: "Start voting", exact: true }).click();
      await expect(guest.getByRole("checkbox", { name: firstIdea, exact: true })).toBeVisible();
      await guest.getByRole("checkbox", { name: firstIdea, exact: true }).check();
      await visualEvidence(guest, "guest");
      await guest.getByRole("button", { name: "Submit votes", exact: true }).click();
      await expect(
        guest.getByText("Your votes are saved. Your ballot cannot be changed.", { exact: true }),
      ).toBeVisible();
      await expect(guest.getByText("1 votes", { exact: true })).toHaveCount(0);
      await guest.reload();
      await expect(
        guest.getByText("Your votes are saved. Your ballot cannot be changed.", { exact: true }),
      ).toBeVisible();
      await expect(guest.getByRole("checkbox")).toHaveCount(0);
      await narrowAccessibility(guest);
      await page.getByRole("button", { name: "Close board", exact: true }).click();
      await expect(guest.getByText("1 votes", { exact: true })).toBeVisible();
      await expect(
        guest.getByRole("heading", { name: "Synthetic priority group", exact: true }),
      ).toBeVisible();

      for (const request of await Promise.all(requests)) {
        expect(request.cookie).toBeUndefined();
        expect(request.referrer).toBeUndefined();
        expect(request.authorization).toMatch(/^Bearer [a-f0-9]{64}$/);
        expect(request.url).not.toContain(request.authorization!.slice(7));
      }
      expect(requests.length).toBeGreaterThan(5);
      await page.getByRole("button", { name: "Delete board", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete board", exact: true })
        .click();
      await expect(page).toHaveURL(/\/boards$/);
      await guest.reload();
      await expect(
        guest.getByRole("alert").filter({ hasText: "This board is unavailable" }),
      ).toContainText("This board is unavailable or has expired.");

      // A separate alias board requests an explicit board-only nickname at admission.
      await page.getByLabel("Board title", { exact: true }).fill(`${title} alias`);
      await page.getByLabel("Participant identity", { exact: true }).selectOption("alias");
      await page.getByRole("button", { name: "Create board", exact: true }).click();
      await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
      const aliasId = new URL(page.url()).pathname.split("/").at(-1)!;
      await page.getByRole("button", { name: "Open collection", exact: true }).click();
      await guest.goto(`/board/${aliasId}`);
      await guest
        .getByLabel("Your board nickname", { exact: true })
        .fill("Synthetic board nickname");
      await guest.getByRole("button", { name: "Join board", exact: true }).click();
      await expect(guest.getByLabel("Your idea", { exact: true })).toBeVisible();

      await page.route(`${api}/v1/auth/me`, async (route) => {
        const response = await route.fetch();
        const account = await response.json();
        await route.fulfill({
          response,
          json: {
            ...account,
            productFeatures: {
              ...account.productFeatures,
              uxBeta: false,
              workspaceShell: false,
              ideaBoards: true,
            },
          },
        });
      });
      await page.goto("/dashboard");
      await page.getByRole("link", { name: "Idea boards", exact: true }).click();
      await expect(page).toHaveURL(/\/boards$/);
      await expect(page.getByRole("heading", { name: "Create board", exact: true })).toBeVisible();
    } catch (caught) {
      primaryFailure = caught;
    }
    try {
      await publicContext.close();
    } catch (caught) {
      if (primaryFailure === null) primaryFailure = caught;
    }
    if (primaryFailure !== null) throw primaryFailure;
  });
}
