import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { PresentationDraft } from "@openround/contracts";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const workspaceDestinations = [
  ["/home", "Home"],
  ["/library", "Library"],
  ["/sessions", "Sessions"],
  ["/assignments", "Assignments"],
  ["/results", "Results"],
  ["/discover", "Discover"],
  ["/groups", "Groups"],
  ["/activity", "Activity inbox"],
  ["/account", "Workspace settings"],
] as const;

async function signIn(page: Page) {
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", level: 1 })).toBeVisible();
}

async function expectNoAxeViolations(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

async function createPublishedPracticeSource(page: Page) {
  const starter = await page.request.post(`${apiUrl}/v1/starters/misconception-check/use`, {
    data: {},
  });
  expect(starter.status()).toBe(201);
  const created = (await starter.json()) as {
    quiz: { id: string; draftRevision?: number };
  };
  const quizId = created.quiz.id;
  const published = await page.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, {
    data: { expectedDraftRevision: created.quiz.draftRevision ?? 0 },
  });
  expect(published.ok()).toBeTruthy();
  return quizId;
}

async function createPracticeAssignment(page: Page, quizId: string) {
  const creationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/quizzes/${quizId}/practice-assignments`,
  );
  const create = page.getByRole("button", { name: "Create assignment" });
  await create.scrollIntoViewIfNeeded();
  await create.click();
  const creationResponse = await creationResponsePromise;
  expect(creationResponse.status()).toBe(201);
  const creation = (await creationResponse.json()) as {
    followup: { id: string };
    genericUrl: string;
  };
  return { followupId: creation.followup.id, genericUrl: creation.genericUrl };
}

async function createPresentation(page: Page) {
  const response = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: "Accessible presentation", description: "Builder accessibility check" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).presentation.id as string;
}

async function createPublishedPresentationSession(page: Page) {
  const title = `Appearance session ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title, description: "A populated Presentation card for the dark workspace scan." },
  });
  expect(created.status()).toBe(201);
  const { presentation } = (await created.json()) as {
    presentation: { id: string; draftRevision: number; draft: PresentationDraft };
  };
  const saved = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
    data: {
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
      draft: {
        ...presentation.draft,
        blocks: [
          {
            id: randomUUID(),
            kind: "question",
            question: {
              id: randomUUID(),
              type: "numeric",
              prompt: "What is two plus two?",
              purpose: "diagnostic",
              confidence: "off",
              delivery: "main",
              conceptKeys: ["addition"],
              linkedRecheckQuestionId: null,
              timeLimitSeconds: 30,
              basePoints: 1_000,
              explanation: "Two pairs contain four items.",
              mediaId: null,
              mediaAlt: null,
              correctValue: "4",
              tolerance: "0",
              unit: null,
            },
          },
        ],
      },
    },
  });
  expect(saved.status()).toBe(200);
  const updated = (await saved.json()).presentation as { draftRevision: number };
  const published = await page.request.post(
    `${apiUrl}/v1/presentations/${presentation.id}/publish`,
    {
      data: { expectedDraftRevision: updated.draftRevision },
    },
  );
  expect(published.status()).toBe(200);
  const session = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
    data: { presentationId: presentation.id },
  });
  expect(session.status()).toBe(201);
  return title;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test("beta workspace and creation surfaces pass automated accessibility checks", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "What would you like to create?" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("workspace Create flyout stays inside the mobile viewport @mobile", async ({ page }) => {
  await signIn(page);
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  await page.goto("/home");

  await page.getByRole("banner").getByRole("button", { name: "Create", exact: true }).click();
  const createFlyout = page.getByText("Create new", { exact: true }).locator("..");
  await expect(createFlyout).toBeVisible();
  const createFlyoutBox = await createFlyout.boundingBox();
  expect(createFlyoutBox).not.toBeNull();
  expect(createFlyoutBox!.x).toBeGreaterThanOrEqual(0);
  expect(createFlyoutBox!.x + createFlyoutBox!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await expect(createFlyout.getByRole("link", { name: /^Round\b/ })).toBeVisible();
  await expect(createFlyout.getByRole("link", { name: /^Presentation\b/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("professional workspace destinations pass automated accessibility checks", async ({
  page,
}, testInfo) => {
  await signIn(page);

  for (const [path, heading] of workspaceDestinations) {
    const assignmentsResponse =
      path === "/assignments"
        ? page.waitForResponse(
            (response) =>
              response.request().method() === "GET" &&
              new URL(response.url()).pathname === "/v1/followups",
          )
        : null;
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    if (assignmentsResponse) {
      const response = await assignmentsResponse;
      expect(response.status()).toBe(200);
      const { items } = (await response.json()) as {
        items: Array<{ id: string; title: string; purpose: string }>;
      };
      const assignments = items.filter((item) => item.purpose === "assignment");
      // The initial seeded Chromium profile exercises the exact empty state. Later
      // profiles share this backend and must render assignments created by earlier tests.
      if (testInfo.project.name === "chromium-beta") expect(assignments).toEqual([]);
      const emptyHeading = page.getByRole("heading", { name: "No assignments yet", level: 2 });
      if (!assignments.length) {
        await expect(emptyHeading).toBeVisible();
      } else {
        await expect(emptyHeading).toHaveCount(0);
        for (const assignment of assignments) {
          const card = page.getByRole("article").filter({
            has: page.locator(`a[href="/practice/${assignment.id}"]`),
          });
          await expect(
            card.getByRole("heading", { name: assignment.title, exact: true }),
          ).toBeVisible();
          await expect(
            card.getByRole("link", { name: "Manage assignment", exact: true }),
          ).toBeVisible();
        }
      }
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    }
    await expectNoAxeViolations(page);
  }
});

test("workspace appearance follows, overrides, and persists the system color mode", async ({
  page,
}) => {
  await signIn(page);
  // Populate the card in this test itself; the first browser must cover the same
  // Presentation surface as later profiles instead of depending on their fixtures.
  const presentationTitle = await createPublishedPresentationSession(page);
  await page.goto("/home");

  // Firefox does not preserve a media override across the authentication
  // navigation, so apply it after the final workspace document has loaded.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-color-mode-preference", "system");

  await page.getByLabel("Appearance: System").click();
  const systemOption = page.getByRole("radio", { name: "System" });
  const lightOption = page.getByRole("radio", { name: "Light" });
  const darkOption = page.getByRole("radio", { name: "Dark" });
  await expect(systemOption).toHaveAttribute("tabindex", "0");
  await expect(lightOption).toHaveAttribute("tabindex", "-1");
  await expect(darkOption).toHaveAttribute("tabindex", "-1");

  await systemOption.focus();
  await page.keyboard.press("ArrowRight");
  await expect(lightOption).toBeFocused();
  await expect(lightOption).toHaveAttribute("aria-checked", "true");
  await expect(lightOption).toHaveAttribute("tabindex", "0");
  await expect(systemOption).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowDown");
  await expect(darkOption).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(lightOption).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(systemOption).toBeFocused();
  await page.keyboard.press("End");
  await expect(darkOption).toBeFocused();
  await page.keyboard.press("Home");
  await expect(systemOption).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(lightOption).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Appearance: Light")).toBeFocused();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
  await expect(page.locator("html")).toHaveAttribute("data-color-mode-preference", "light");

  await page.getByLabel("Appearance: Light").click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  for (const [path, heading] of workspaceDestinations) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
    if (path === "/sessions") {
      await page.getByRole("tab", { name: /^Presentations/ }).click();
      const presentationCard = page.getByRole("article").filter({
        has: page.getByRole("heading", { name: presentationTitle, exact: true }),
      });
      await expect(presentationCard).toBeVisible();
      await expect(page.getByRole("tab", { name: /^Presentations/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    if (path === "/account") {
      await expect(page.locator(".settings-grid > .panel").first()).toHaveCSS(
        "background-color",
        "rgba(32, 36, 43, 0.96)",
      );
      await expect(page.locator("#active-workspace")).toHaveCSS(
        "background-color",
        "rgb(41, 46, 54)",
      );
    }
    await expectNoAxeViolations(page);
  }

  await page.getByLabel("Appearance: Dark").click();
  await page.getByRole("radio", { name: "System" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
});

test("Presentation Builder dialogs and drawers pass automated accessibility checks", async ({
  page,
}) => {
  await signIn(page);
  await createPublishedPracticeSource(page);
  const presentationId = await createPresentation(page);

  await page.goto(`/presentation/${presentationId}`);
  await expect(page.getByLabel("Presentation title")).toHaveValue("Accessible presentation");
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "+ Add question", exact: true }).click();
  const questionPrompt = page.getByLabel("Question prompt");
  await questionPrompt.focus();
  await expect(questionPrompt).toHaveCSS("background-color", "rgba(255, 255, 255, 0.94)");
  await expect(questionPrompt).toHaveCSS("color", "rgb(48, 54, 64)");
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.evaluate(() => window.localStorage.setItem("openround:color-mode", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  await expect(page.getByLabel("Presentation title")).toHaveValue("Accessible presentation");
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("dialog", { name: "Presentation preview" })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Close preview" }).click();

  await page.getByRole("button", { name: "From published Round" }).click();
  await expect(page.getByRole("dialog", { name: "Insert from a published Round" })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("Round Builder follows system appearance changes", async ({ page }) => {
  await signIn(page);
  const quizId = await createPublishedPracticeSource(page);
  await page.evaluate(() => window.localStorage.setItem("openround:color-mode", "system"));
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto(`/quiz/${quizId}`);
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  await expect(page.getByLabel("Title")).toHaveValue("Misconception check");
  // The theme attribute changes before button background transitions finish. Axe
  // must inspect the final dark surface, not a light/dark interpolation.
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveCSS(
    "background-color",
    "rgb(38, 43, 51)",
  );
  await expectNoAxeViolations(page);
});

test("Round live setup recipes and settings stay readable in light and dark appearances", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const quizId = await createPublishedPracticeSource(page);

  for (const mode of ["light", "dark"] as const) {
    await page.evaluate((preference) => {
      window.localStorage.setItem("openround:color-mode", preference);
    }, mode);
    await page.goto(`/host/setup/${quizId}`);
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
    await expect(page.getByTestId("session-setup")).toBeVisible();

    for (const name of ["Recovery", "Friendly competition", "Open discussion"]) {
      const recipe = page.getByRole("button", { name: new RegExp(`^${name}`) });
      await recipe.click();
      await expect(recipe).toHaveAttribute("aria-pressed", "true");
      await expectNoAxeViolations(page);
    }

    const desktopViewport = page.viewportSize()!;
    await page.screenshot({
      path: testInfo.outputPath(`round-setup-${mode}-desktop.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: testInfo.outputPath(`round-setup-${mode}-mobile.png`),
      fullPage: true,
    });
    await page.setViewportSize(desktopViewport);

    await page.getByText("Review settings", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Audience and joining" })).toBeVisible();
    await expectNoAxeViolations(page);
  }
});

test("practice assignment and management surfaces pass automated accessibility checks", async ({
  page,
}) => {
  await signIn(page);
  const quizId = await createPublishedPracticeSource(page);

  await page.goto(`/quiz/${quizId}/assign`);
  await expect(page.getByRole("heading", { name: "Practice settings", level: 2 })).toBeVisible();
  await expectNoAxeViolations(page);

  const { followupId } = await createPracticeAssignment(page, quizId);
  await expect(page.getByRole("heading", { name: "Save and share these links now" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto(`/practice/${followupId}`);
  await expect(page.getByRole("heading", { name: "Misconception check", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private access", level: 2 })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("mobile practice assignment and management surfaces remain accessible @mobile", async ({
  page,
}) => {
  await signIn(page);
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  const quizId = await createPublishedPracticeSource(page);

  await page.goto(`/quiz/${quizId}/assign`);
  await expect(page.getByRole("heading", { name: "Practice settings", level: 2 })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  const create = page.getByRole("button", { name: "Create assignment" });
  await create.scrollIntoViewIfNeeded();
  const createTarget = await create.boundingBox();
  expect(createTarget?.height).toBeGreaterThanOrEqual(44);

  const { followupId, genericUrl } = await createPracticeAssignment(page, quizId);
  await expect(page.getByRole("heading", { name: "Save and share these links now" })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  await page.goto(`/practice/${followupId}`);
  await expect(page.getByRole("heading", { name: "Misconception check", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private access", level: 2 })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  await page.goto(genericUrl);
  await expect(page.getByText("Question 1 of 1", { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  const response = page.getByLabel("Response choices").getByRole("button").first();
  await response.scrollIntoViewIfNeeded();
  const responseTarget = await response.boundingBox();
  expect(responseTarget?.width).toBeGreaterThanOrEqual(44);
  expect(responseTarget?.height).toBeGreaterThanOrEqual(44);
  await response.click();
  await page.getByRole("button", { name: "Very sure", exact: true }).click();
  const submit = page.getByRole("button", { name: "Submit response" });
  await submit.scrollIntoViewIfNeeded();
  const submitTarget = await submit.boundingBox();
  expect(submitTarget?.width).toBeGreaterThanOrEqual(44);
  expect(submitTarget?.height).toBeGreaterThanOrEqual(44);
});

test("mobile beta creation surface passes automated accessibility checks @mobile", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "What would you like to create?" })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByLabel("Appearance: System").click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
});
