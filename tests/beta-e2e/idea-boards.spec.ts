import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

async function openWorkshopCreate(page: Page) {
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("button", { name: "Guided workshop", exact: true }).click();
  const identity = page.getByRole("combobox", { name: "Participant identity", exact: true });
  if (!(await identity.isVisible())) {
    await page.getByText("Workshop settings", { exact: true }).click();
  }
  await expect(identity).toBeVisible();
}

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
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: test.info().outputPath(`idea-board-${label}-${colorScheme}-${width}.png`),
        fullPage: true,
      });
    }
  }
}

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}rich ideas preserve drawings and link cards through moderation`, async ({
    page,
    browser,
  }) => {
    test.skip(process.env.BETA_E2E_IDEA_BOARDS !== "true", "Opt-in idea board writer journey");
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    await signInBeta(page);
    await page.goto("/boards");
    await openWorkshopCreate(page);
    const title = `Synthetic rich board ${randomUUID().slice(0, 8)}`;
    const idea = `Synthetic diagram ${randomUUID().slice(0, 8)}`;
    const caption = "A reference for this diagram";
    await page.getByLabel("Board title", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Create board", exact: true }).click();
    await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.getByRole("button", { name: "Open collection", exact: true }).click();

    const participantDevice = mobile
      ? devices[test.info().project.name.startsWith("webkit") ? "iPhone 15" : "Pixel 5"]
      : {};
    const guestContext = await browser.newContext({
      ...participantDevice,
      baseURL: new URL(page.url()).origin,
      viewport: { width: mobile ? 390 : 1280, height: 844 },
      reducedMotion: "reduce",
    });
    const otherContext = await browser.newContext({
      ...participantDevice,
      baseURL: new URL(page.url()).origin,
      viewport: { width: mobile ? 390 : 1280, height: 844 },
    });
    try {
      const guest = await guestContext.newPage();
      const other = await otherContext.newPage();
      guest.setDefaultTimeout(15_000);
      other.setDefaultTimeout(15_000);
      await guest.goto(`/board/${id}`);
      await guest.getByRole("button", { name: "Join board", exact: true }).click();
      await guest.getByLabel("Your idea", { exact: true }).fill(idea);
      // This in-memory fixture deliberately has no storage/scanner. The real upload path is
      // exercised by the storage/API suites; the composer must not offer unscanned images.
      await expect(guest.getByRole("button", { name: "Image", exact: true })).toBeDisabled();
      await expect(guest.getByText("Image uploads are unavailable for this board.")).toBeVisible();
      await guest.getByRole("button", { name: "Link", exact: true }).click();
      await guest
        .getByLabel("Website or social post URL", { exact: true })
        .fill("https://example.test/idea");
      await guest.getByLabel("Link caption (optional)", { exact: true }).fill(caption);
      await guest.getByRole("button", { name: "Add link", exact: true }).click();
      await guest.getByRole("button", { name: "Draw", exact: true }).click();
      const editor = guest.getByRole("dialog", { name: "Draw your idea", exact: true });
      await expect(editor).toBeVisible();
      await editor.getByRole("button", { name: "Rectangle", exact: true }).click();
      await editor.getByRole("button", { name: "Add Rectangle", exact: true }).click();
      await editor.getByLabel("Horizontal position", { exact: true }).fill("100");
      await editor.getByLabel("Vertical position", { exact: true }).fill("100");
      await editor.getByLabel("Colour", { exact: true }).selectOption("blue");
      await editor.getByRole("button", { name: "Text", exact: true }).click();
      await editor.getByRole("button", { name: "Add Text", exact: true }).click();
      await editor.getByLabel("Drawing text", { exact: true }).fill("Plan together");
      await editor.getByRole("button", { name: "Arrow", exact: true }).click();
      await editor.getByRole("button", { name: "Add Arrow", exact: true }).click();
      await editor.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Arrow 3", exact: true })).toHaveCount(0);
      await editor.getByRole("button", { name: "Redo", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Arrow 3", exact: true })).toBeVisible();

      // A pointer gesture creates one shape, without an extra shape on tool selection.
      await editor.getByRole("button", { name: "Ellipse", exact: true }).click();
      const canvas = editor.locator('svg[aria-label="Drawing canvas"]');
      await canvas.scrollIntoViewIfNeeded();
      const bounds = (await canvas.boundingBox())!;
      await guest.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.3);
      await guest.mouse.down();
      await guest.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.6, {
        steps: 5,
      });
      await guest.mouse.up();
      await expect(editor.getByRole("button", { name: "Ellipse 4", exact: true })).toBeVisible();
      if (mobile) {
        await editor.getByRole("button", { name: "Text", exact: true }).tap();
        await canvas.tap({ position: { x: bounds.width * 0.4, y: bounds.height * 0.5 } });
        await expect(editor.getByRole("button", { name: "Text 5", exact: true })).toBeVisible();
        await editor.getByLabel("Drawing text", { exact: true }).fill("Placed by touch");
        await editor.getByRole("button", { name: "Delete selected", exact: true }).tap();
        await expect(editor.getByRole("button", { name: "Text 5", exact: true })).toHaveCount(0);
      }
      await narrowAccessibility(guest);
      await guest.screenshot({
        path: test.info().outputPath("idea-board-sketch-editor-320.png"),
        fullPage: true,
      });
      await editor.getByRole("button", { name: "Save drawing", exact: true }).click();
      await expect(editor).toHaveCount(0);
      const [submission] = await Promise.all([
        guest.waitForRequest(
          (request) =>
            request.method() === "POST" &&
            new URL(request.url()).pathname === `/v1/idea-boards/${id}/ideas`,
        ),
        guest.getByRole("button", { name: "Submit idea", exact: true }).click(),
      ]);
      const content = submission.postDataJSON();
      expect(content.body).toBe(idea);
      expect(content.links).toEqual([{ url: "https://example.test/idea", label: caption }]);
      expect(content.sketch.elements.map((element: { type: string }) => element.type)).toEqual([
        "rect",
        "text",
        "arrow",
        "ellipse",
      ]);
      await expect(guest.getByText("Your idea was submitted.", { exact: true })).toBeVisible();
      await guest.reload();
      await expect(guest.getByRole("link", { name: new RegExp(caption) })).toBeVisible();
      await expect(guest.getByText("Plan together", { exact: true })).toBeVisible();
      await other.goto(`/board/${id}`);
      await other.getByRole("button", { name: "Join board", exact: true }).click();
      await expect(other.getByText(idea, { exact: true })).toHaveCount(0);
      await expect(other.getByRole("link", { name: new RegExp(caption) })).toHaveCount(0);

      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      const pending = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Awaiting review", exact: true }) });
      await expect(pending.getByRole("link", { name: new RegExp(caption) })).toBeVisible();
      await expect(pending.getByText("Plan together", { exact: true })).toBeVisible();
      await pending.getByRole("button", { name: "Approve", exact: true }).click();
      await hostCommand(page, () =>
        page.getByLabel("Show approved ideas during collection", { exact: true }).click(),
      );
      await other.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(other.getByRole("link", { name: new RegExp(caption) })).toBeVisible();
      await other.getByRole("button", { name: "Expand drawing", exact: true }).click();
      await expect(
        other
          .getByRole("dialog", { name: "Drawing", exact: true })
          .getByText("Plan together", { exact: true }),
      ).toBeVisible();
      await other.getByRole("button", { name: "Close drawing", exact: true }).click();
      await visualEvidence(other, "rich-guest");
      await narrowAccessibility(other);
      await visualEvidence(page, "rich-host");
      await narrowAccessibility(page);
      const approved = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Approved ideas", exact: true }) });
      await approved.getByRole("button", { name: "Remove", exact: true }).click();
      await guest.getByRole("button", { name: "Refresh", exact: true }).click();
      await other.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(guest.getByText(idea, { exact: true })).toHaveCount(0);
      await expect(guest.getByRole("link", { name: new RegExp(caption) })).toHaveCount(0);
      await expect(other.getByText("Plan together", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Delete board", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete board", exact: true })
        .click();
      await expect(page).toHaveURL(/\/boards$/);
    } finally {
      await otherContext.close();
      await guestContext.close();
    }
  });

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
    await openWorkshopCreate(page);
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
      await openWorkshopCreate(page);
      await page.getByLabel("Board title", { exact: true }).fill(`${title} alias`);
      await page
        .getByRole("combobox", { name: "Participant identity", exact: true })
        .selectOption("alias");
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
      await expect(page.getByRole("button", { name: "New board", exact: true })).toBeVisible();
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
