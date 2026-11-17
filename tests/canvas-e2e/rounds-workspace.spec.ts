import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { api, fits, organization } from "./support";

async function accessible(page: Page) {
  await fits(page);
  await expect
    .poll(
      async () =>
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
    )
    .toEqual([]);
}
async function saved(page: Page) {
  await expect(page.locator('header [data-state="saved"]')).toBeVisible();
}
async function openOutline(page: Page) {
  const control = page.locator("#round-toggle-navigation");
  if ((await control.getAttribute("aria-expanded")) !== "true") await control.click();
  await expect(page.locator("#round-question-navigator")).toBeVisible();
}

for (const suffix of ["", " @mobile"]) {
  test(`Rounds guide authors from question creation to isolated rehearsal${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    if (!suffix) await page.setViewportSize({ width: 1600, height: 1100 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await organization(page, info);
    const created = await page.request.post(`${api}/v1/quizzes`, {
      data: { title: "Product readiness Round", description: "" },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { quiz } = await created.json();
    await page.goto(`/quiz/${quiz.id}`);
    await expect(page.locator("#round-toggle-navigation")).toBeVisible();
    await openOutline(page);
    const outline = page.locator("#round-question-navigator");
    await outline.getByRole("button", { name: "Add question", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Choose a question type", exact: true });
    await expect(picker).toBeVisible();
    await expect(
      picker.getByRole("heading", { name: "Test knowledge", exact: true }),
    ).toBeVisible();
    await expect(
      picker.getByRole("heading", { name: "Collect opinions", exact: true }),
    ).toBeVisible();
    await accessible(page);
    await picker.getByRole("button", { name: /^Single select/ }).click();
    await expect(picker).not.toBeVisible();
    if (suffix) await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const readiness = page
      .locator('section[aria-label="Round readiness"]')
      .filter({ visible: true });
    await expect(readiness).toContainText("Enter the question prompt");
    await page.locator("#prompt").fill("Which action should the team take first?");
    for (const [index, value] of [
      "Agree on the goal",
      "Skip the review",
      "Wait for a problem",
      "Duplicate the work",
    ].entries())
      await page.getByRole("textbox", { name: `Answer ${index + 1}`, exact: true }).fill(value);
    await saved(page);
    await expect(readiness).toContainText("Ready to preview and publish");
    await openOutline(page);
    await page.locator("#open-private-question-bank").click();
    const reuse = page
      .getByRole("dialog")
      .filter({ has: page.getByTestId("question-reuse-picker") });
    await expect(reuse).toBeVisible();
    const reuseSearch = reuse.locator('input[type="search"]');
    await reuseSearch.focus();
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() => reuse.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(reuse).not.toBeVisible();
    await expect(page.locator("#open-private-question-bank")).toBeFocused();
    if (suffix) await page.keyboard.press("Escape");
    if (!suffix) {
      const divider = page.getByRole("separator", {
        name: "Resize question navigation",
        exact: true,
      });
      const before = (await outline.boundingBox())!.width;
      await divider.focus();
      await divider.press("ArrowRight");
      await expect.poll(async () => (await outline.boundingBox())!.width).toBeGreaterThan(before);
      await divider.press("Shift+ArrowRight");
      await divider.press("End");
      await page
        .getByRole("separator", { name: "Resize question tools", exact: true })
        .press("End");
      await page.setViewportSize({ width: 1100, height: 1100 });
      const constrained = (await outline.boundingBox())!.width;
      const handle = (await divider.boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 50);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + 2, handle.y + 50);
      await page.mouse.up();
      const resized = (await outline.boundingBox())!.width;
      expect(resized).toBeGreaterThanOrEqual(constrained - 1);
      expect(resized).toBeLessThanOrEqual(constrained + 4);
      await fits(page);
      await page.setViewportSize({ width: 1600, height: 1100 });
    }
    await page.getByRole("button", { name: "References", exact: true }).click();
    const references = page.getByRole("dialog", { name: "References", exact: true });
    await expect(
      references.getByRole("region", { name: "Canvas snapshots", exact: true }),
    ).toBeVisible();
    await accessible(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "References", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Review Round", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review Round", exact: true });
    await expect(review.getByText("Question Health · advisory", { exact: true })).toBeVisible();
    await accessible(page);
    await review.getByRole("button", { name: "Close", exact: true }).click();
    if (suffix) {
      await page.locator("#round-toggle-tools").click();
      const tools = page.getByRole("dialog", { name: "Question tools", exact: true });
      await expect(tools).toBeVisible();
      await accessible(page);
      await page.keyboard.press("Escape");
      await expect(page.locator("#round-toggle-tools")).toBeFocused();
    }
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: info.outputPath("round-editor-light.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
    await accessible(page);
    await page.screenshot({ path: info.outputPath("round-editor-dark.png"), fullPage: true });
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.locator("header").first()).toContainText("Published");
    await saved(page);
    await expect(page.getByRole("link", { name: "Host live", exact: true })).toHaveAttribute(
      "href",
      `/host/setup/${quiz.id}`,
    );
    const header = page.locator("header").first();
    const moreActions = header.getByLabel("More actions", { exact: true });
    await expect(header.getByRole("link", { name: "Host live", exact: true })).toBeVisible();
    await expect(moreActions).toBeVisible();
    const editorViewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: 844 });
    await fits(page);
    for (const action of await header.locator("a, button, summary").filter({ visible: true }).all())
      await expect(action).toBeInViewport({ ratio: 1 });
    await moreActions.click();
    const assignPractice = header.getByRole("link", { name: "Assign practice", exact: true });
    await expect(assignPractice).toBeVisible();
    await expect(assignPractice).toBeInViewport({ ratio: 1 });
    await expect(assignPractice).toHaveAttribute("href", `/quiz/${quiz.id}/assign`);
    await accessible(page);
    await moreActions.click();
    await page.setViewportSize(editorViewport);
    await page
      .locator("#prompt")
      .fill("Which action should the team take first before proceeding?");
    await saved(page);
    await expect(page.locator("header").first()).toContainText("Unpublished changes");
    await expect(page.getByRole("link", { name: "Host live", exact: true })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/quiz/${quiz.id}/preview$`));
    await expect(page.getByText(/Saved draft preview/).first()).toBeVisible();
    await expect(page.getByText("Test only · No real responses", { exact: true })).toBeVisible();
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
        request.url().startsWith(api) &&
        !new URL(request.url()).pathname.startsWith("/v1/auth/session/")
      )
        writes.push(request.url());
    });
    await page.getByRole("radio", { name: /Agree on the goal/ }).check();
    await page.getByRole("button", { name: "Test this answer", exact: true }).click();
    await expect(
      page.getByText("Test answer recorded on this device only.", { exact: true }),
    ).toBeVisible();
    await accessible(page);
    await page.screenshot({ path: info.outputPath("round-rehearsal-dark.png"), fullPage: true });
    await page.getByRole("button", { name: "Reset question", exact: true }).click();
    await expect(page.getByRole("radio", { name: /Agree on the goal/ })).not.toBeChecked();
    await page.getByRole("button", { name: "Reveal answer", exact: true }).click();
    await accessible(page);
    await page.getByRole("button", { name: "Audience view", exact: true }).click();
    await page.getByRole("button", { name: "Phone", exact: true }).click();
    await accessible(page);
    if (suffix) {
      await page.setViewportSize({ width: 320, height: 844 });
      await accessible(page);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await accessible(page);
    expect(writes).toEqual([]);
  });
}

test("Rounds edit and rehearse every supported response format without changing the publication", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1500, height: 1050 });
  await organization(page, info);
  const source = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
    data: {},
  });
  expect(source.status()).toBe(201);
  const { quiz } = await source.json();
  const kinds = [
    "single_select",
    "true_false",
    "multi_select",
    "numeric",
    "rating",
    "poll",
    "ranking",
    "open_text",
    "word_cloud",
  ] as const;
  const questions = kinds.map((type) => {
    const scored = ["single_select", "true_false", "multi_select", "numeric"].includes(type);
    const common = {
      id: randomUUID(),
      type,
      prompt: `Explore ${type} responses`,
      purpose: scored ? "diagnostic" : "opinion",
      confidence: type === "single_select" ? "required" : "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 30,
      basePoints: scored ? 1000 : 0,
      explanation: "Use this explanation to discuss the reasoning.",
      mediaId: null,
      mediaAlt: null,
    };
    if (type === "numeric")
      return { ...common, correctValue: "12.50", tolerance: "0.1", unit: "kg" };
    if (type === "rating") return { ...common, min: 1, max: 10, minLabel: "Low", maxLabel: "High" };
    if (type === "open_text" || type === "word_cloud") return common;
    const labels =
      type === "true_false" ? ["True", "False"] : ["First option", "Second option", "Third option"];
    return {
      ...common,
      choices: labels.map((label, index) => ({
        id: randomUUID(),
        label,
        isCorrect: scored && (index === 0 || (type === "multi_select" && index === 1)),
      })),
      ...(type === "poll" ? { maxSelections: 2 } : {}),
      ...(type === "ranking" ? { rankCount: 2 } : {}),
    };
  });
  const patch = await page.request.patch(`${api}/v1/quizzes/${quiz.id}`, {
    data: {
      draft: { ...quiz.draft, title: "Nine response formats", questions },
      expectedDraftRevision: quiz.draftRevision,
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);
  const updated = (await patch.json()).quiz;
  const published = await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
    data: { expectedDraftRevision: updated.draftRevision },
  });
  expect(published.status(), await published.text()).toBe(200);
  const publication = (await published.json()).version;
  const versionId = publication.id;
  await page.goto(`/quiz/${quiz.id}`);
  await expect(page.locator("#round-question-navigator")).toBeVisible();
  for (const type of kinds) {
    await page
      .locator("#round-question-navigator")
      .getByRole("button", { name: new RegExp(`Explore ${type} responses`) })
      .click();
    await expect(page.locator("#prompt")).toHaveValue(`Explore ${type} responses`);
    await accessible(page);
  }
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const checkpointNavigation = page.getByRole("navigation", { name: "Checkpoints", exact: true });
  for (const type of kinds) {
    await checkpointNavigation
      .getByRole("button", { name: new RegExp(`Explore ${type} responses`) })
      .click();
    await accessible(page);
    await page
      .getByRole("button", {
        name:
          type === "rating" || ["poll", "ranking", "open_text", "word_cloud"].includes(type)
            ? "Show explanation"
            : "Reveal answer",
        exact: true,
      })
      .click();
    await accessible(page);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await accessible(page);
  const after = await page.request.get(`${api}/v1/quizzes/${quiz.id}`);
  const record = await after.json();
  expect(record.quiz.currentVersionId).toBe(versionId);
  expect(record.currentVersion.content).toEqual(publication.content);
});

test("Rounds keep viewer navigation and rehearsal separate from draft mutations", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1500, height: 1050 });
  await organization(page, info);
  const blankResponse = await page.request.post(`${api}/v1/quizzes`, {
    data: { title: "Empty viewer Round", description: "" },
  });
  expect(blankResponse.status()).toBe(201);
  const blank = (await blankResponse.json()).quiz;
  const source = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
    data: {},
  });
  expect(source.status()).toBe(201);
  const { quiz } = await source.json();
  const published = await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
    data: { expectedDraftRevision: quiz.draftRevision },
  });
  expect(published.status(), await published.text()).toBe(200);
  await page.evaluate(
    async ({ id, draft, revision }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("openround-builder-recovery", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("drafts", { keyPath: "key" });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("drafts", "readwrite");
          transaction.objectStore("drafts").put({
            key: `round:${id}`,
            revision,
            draft: { ...draft, title: "Local edited copy" },
            savedAt: new Date().toISOString(),
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      });
    },
    { id: quiz.id, draft: quiz.draft, revision: quiz.draftRevision },
  );
  // Exercise viewer affordances while keeping fixture setup independent of workspace invitations.
  await page.route(`${api}/v1/auth/me`, async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    await route.fulfill({
      response,
      json: { ...account, creator: { ...account.creator, role: "viewer" } },
    });
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith("/v1/quizzes")
    )
      writes.push(request.url());
  });
  await page.goto(`/quiz/${blank.id}?insert=numeric`);
  await expect(
    page.getByRole("heading", { name: "Add your first question", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#prompt")).toHaveCount(0);
  await page.goto(`/quiz/${quiz.id}`);
  await expect(page.locator("#prompt")).toBeDisabled();
  await expect(page.locator("#quiz-title")).toHaveValue(quiz.draft.title);
  await expect(page.locator("#quiz-title")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Restore local work", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "Host live", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Assign practice", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add question", exact: true })).toBeDisabled();
  await accessible(page);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/quiz/${quiz.id}/preview$`));
  await expect(page.getByText("Test only · No real responses", { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
