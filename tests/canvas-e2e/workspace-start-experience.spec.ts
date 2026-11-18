import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { QuizDraft } from "@openround/contracts";
import type { SurveyDraft } from "@openround/contracts/surveys";
import type { HomeSummary } from "../../apps/web/app/home/home-model";
import { signInCreator } from "../support/creator-auth";
import { testEmail } from "../e2e/test-email";
import { api, fits, web } from "./support";

const modes = [
  { name: "light", colorScheme: "light", forcedColors: "none" },
  { name: "dark", colorScheme: "dark", forcedColors: "none" },
  { name: "high-contrast", colorScheme: "light", forcedColors: "active" },
] as const;

// Catalog reads instantiate fresh structural IDs. Compare every authored field
// and linked-recheck topology rather than requiring two independent reads to share IDs.
function templateContent(draft: QuizDraft | SurveyDraft) {
  const questions =
    "questions" in draft ? draft.questions : draft.items.map((item) => item.question);
  const positions = new Map(questions.map((question, index) => [question.id, index]));
  return JSON.parse(
    JSON.stringify(draft, (key, value: unknown) => {
      if (key === "id") return undefined;
      if (key === "linkedRecheckQuestionId" && typeof value === "string")
        return positions.has(value) ? `question:${positions.get(value)}` : `unknown:${value}`;
      return value;
    }),
  );
}

async function reviewSurface(
  page: Page,
  info: TestInfo,
  selector: string,
  name: string,
  mobile: boolean,
) {
  for (const width of mobile ? [320, 390] : [1440]) {
    await page.setViewportSize({ width, height: mobile ? 844 : 1000 });
    for (const mode of modes) {
      await page.emulateMedia({ colorScheme: mode.colorScheme, forcedColors: mode.forcedColors });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode.colorScheme);
      // WebKit may publish the root mode before offscreen descendants inherit it.
      // Wait for the real chooser palette; the full contrast audit remains enabled.
      const chooser = page.getByRole("combobox", { name: "Choose a template", exact: true });
      if (await chooser.isVisible())
        await expect(chooser.locator("..").locator(":scope > span")).toHaveCSS(
          "color",
          mode.colorScheme === "dark"
            ? "rgb(232, 235, 240)"
            : mode.forcedColors === "active"
              ? /rgb\((?:0, 0, 0|48, 54, 64)\)/
              : "rgb(48, 54, 64)",
        );
      await fits(page);
      // The audit stays on the changed, bounded Home or selected-template surface.
      expect(
        (
          await new AxeBuilder({ page })
            .include(selector)
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
        `${name} at ${width}px in ${mode.name}`,
      ).toEqual([]);
      await page.locator(selector).evaluate((node) => {
        window.scrollTo(0, Math.max(0, node.getBoundingClientRect().top + window.scrollY - 90));
      });
      await page.screenshot({ path: info.outputPath(`${name}-${width}-${mode.name}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
}

function contentWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      /^\/v1\/(?:starters\/[^/]+\/use|quizzes|presentations|surveys)(?:\/|$)/.test(path)
    )
      writes.push(`${request.method()} ${path}`);
  });
  return writes;
}

// Synthetic read evidence avoids creating or joining a live room just to check hierarchy.
function homeSummary(): HomeSummary {
  return {
    generatedAt: "2026-11-17T12:00:00Z",
    recentArtifacts: [
      {
        id: "synthetic-draft",
        artifactType: "round",
        title: "Synthetic unfinished workshop",
        description: "Browser hierarchy fixture",
        status: "draft",
        itemCount: 2,
        updatedAt: "2026-11-17T11:00:00Z",
        editHref: "/quiz/synthetic-draft",
        actionHref: "/quiz/synthetic-draft",
        actionLabel: "Continue editing",
      },
    ],
    recentBoards: [],
    recentSurveys: [],
    sessions: [
      {
        id: "synthetic-room",
        artifactType: "round",
        artifactId: "synthetic-draft",
        title: "Synthetic waiting room",
        status: "active",
        phase: "lobby",
        code: "1234567",
        participantCount: 4,
        progressLabel: "Lobby",
        createdAt: "2026-11-17T12:00:00Z",
        href: "/sessions",
      },
    ],
    assignments: [],
    resultHighlights: [],
    groupSchedule: [],
    totals: {
      artifacts: 1,
      boards: 0,
      surveys: 0,
      activeSessions: 1,
      activeAssignments: 0,
      upcomingGroupItems: 0,
    },
  };
}

async function selectTemplate(page: Page, id: string, mobile: boolean, survey = false) {
  if (mobile) {
    await page.getByRole("combobox", { name: "Choose a template", exact: true }).selectOption(id);
  } else {
    const choice = page.locator(`[data-template-id="${id}"]`).getByRole("button", {
      name: survey ? "Preview questionnaire" : "Preview questions",
      exact: true,
    });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(choice).toBeFocused();
  }
  const preview = page.locator(`#starter-preview-${id}`);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("aria-busy", "false");
  return preview;
}

for (const mobile of [false, true]) {
  const suffix = mobile ? " @mobile" : "";

  test(`Home prioritizes work and keeps template formats in URL history${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: mobile ? 320 : 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInCreator(page, testEmail("start-home", info), { returnTo: "/home" });
    const writes = contentWrites(page);
    await page.route(`${api}/v1/home/summary`, (route) => route.fulfill({ json: homeSummary() }));
    await page.goto("/home");
    const start = page.getByRole("region", { name: "Start creating", exact: true });
    await expect(start).toBeVisible();
    await expect(page.getByRole("region", { name: "Live Now", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Continue working", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#home-overview-title")).toBeVisible();
    const verticalOrder = await page.evaluate(() =>
      [
        document.querySelector('[aria-label="Live Now"]'),
        document.querySelector("#home-start-title"),
        [...document.querySelectorAll("h2")].find(
          (heading) => heading.textContent === "Continue working",
        ),
        document.querySelector("#home-overview-title"),
      ].map((node) => (node ? node.getBoundingClientRect().top + window.scrollY : -1)),
    );
    expect(verticalOrder.every((position) => position >= 0)).toBe(true);
    for (let index = 1; index < verticalOrder.length; index++)
      expect(verticalOrder[index]).toBeGreaterThan(verticalOrder[index - 1]!);
    await expect(
      page.getByRole("link", { name: "Open Sessions", exact: true }).first(),
    ).toHaveAttribute("href", "/sessions");
    for (const type of ["rounds", "presentations", "surveys", "designs"])
      await expect(start.locator(`a[href="/templates?type=${type}"]`)).toBeVisible();
    const checklist = page.locator('[aria-labelledby="home-guidance-title"] details');
    await expect(checklist).not.toHaveAttribute("open", "");
    await checklist.locator("summary").focus();
    await checklist.locator("summary").press("Enter");
    await expect(checklist).toHaveAttribute("open", "");
    await checklist.locator("summary").press("Enter");
    await expect(checklist).not.toHaveAttribute("open", "");
    await reviewSurface(page, info, "#main", "home-start", mobile);

    await start.locator('a[href="/templates?type=rounds"]').click();
    const types = page.getByRole("tablist", { name: "Template types", exact: true });
    const roundTab = types.getByRole("tab", { name: "Rounds", exact: true });
    const presentationTab = types.getByRole("tab", { name: "Presentations", exact: true });
    await expect(page).toHaveURL(/\/templates\?type=rounds$/);
    await expect(roundTab).toHaveAttribute("aria-selected", "true");
    await roundTab.focus();
    await roundTab.press("ArrowRight");
    await expect(page).toHaveURL(/\/templates\?type=presentations$/);
    await expect(presentationTab).toHaveAttribute("aria-selected", "true");
    await expect(presentationTab).toBeFocused();
    await types.getByRole("tab", { name: "Surveys", exact: true }).click();
    await expect(page).toHaveURL(/\/templates\?type=surveys$/);
    await page.goBack();
    await expect(presentationTab).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(roundTab).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(presentationTab).toHaveAttribute("aria-selected", "true");
    for (const [type, label] of [
      ["rounds", "Rounds"],
      ["presentations", "Presentations"],
      ["surveys", "Surveys"],
      ["designs", "Designs"],
    ]) {
      await page.goto(`/templates?type=${type}`);
      await expect(types.getByRole("tab", { name: label, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    await page.goto("/templates#designs");
    await expect(types.getByRole("tab", { name: "Designs", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.goto("/templates?type=surveys#designs");
    await expect(types.getByRole("tab", { name: "Surveys", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // A resolved account capability change removes new entry without changing server policy.
    await page.route(`${api}/v1/auth/me`, async (route) => {
      const response = await route.fetch();
      const account = await response.json();
      account.productFeatures = {
        ...account.productFeatures,
        builderV2: false,
        presentations: false,
        surveys: false,
      };
      await route.fulfill({ response, json: account });
    });
    await page.goto("/home");
    await expect(start.locator('a[href="/templates?type=rounds"]')).toBeVisible();
    await expect(start.locator('a[href="/dashboard"]')).toBeVisible();
    for (const type of ["presentations", "surveys", "designs"])
      await expect(start.locator(`a[href="/templates?type=${type}"]`)).toHaveCount(0);
    expect(writes).toEqual([]);

    // Qualify one real viewer without multiplying sign-ins across phone projects.
    if (!mobile) {
      const context = await browser.newContext({ baseURL: web, reducedMotion: "reduce" });
      const viewer = await context.newPage();
      try {
        const email = testEmail("start-viewer", info);
        await signInCreator(viewer, email);
        const invited = await page.request.post(`${api}/v1/workspace/invitations`, {
          data: { email, role: "viewer" },
        });
        expect(invited.status()).toBe(201);
        const token = new URL((await invited.json()).debugUrl).searchParams.get("token");
        const accepted = await viewer.request.post(`${api}/v1/invitations/accept`, {
          data: { token, acceptPolicies: true },
        });
        expect(accepted.status()).toBe(200);
        expect((await (await viewer.request.get(`${api}/v1/auth/me`)).json()).creator.role).toBe(
          "viewer",
        );
        const viewerWrites = contentWrites(viewer);
        await viewer.goto("/home");
        await expect(viewer.locator("#home-start-title")).toHaveCount(0);
        await expect(
          viewer.getByRole("banner").getByRole("button", { name: "Create", exact: true }),
        ).toHaveCount(0);
        await viewer.goto("/templates?type=rounds");
        await viewer
          .getByRole("searchbox", { name: "Search templates", exact: true })
          .fill("Evidence worth trusting");
        const preview = await selectTemplate(viewer, "source-evaluation", false);
        await expect(preview).toContainText("Viewers can browse starters.");
        await expect(
          preview.getByRole("button", { name: "Use this starter", exact: true }),
        ).toHaveCount(0);
        expect(viewerWrites).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });

  test(`Template previews create one independent editable Round and Survey${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: mobile ? 320 : 1440, height: mobile ? 844 : 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInCreator(page, testEmail("start-copy", info), {
      returnTo: "/templates?type=rounds",
    });
    const roundSourceUrl = `${api}/v1/starters/source-evaluation?locale=en-CA`;
    const surveySourceUrl = `${api}/v1/surveys/templates/event-feedback?locale=en-CA`;
    const roundSource = (await (await page.request.get(roundSourceUrl)).json()).draft as QuizDraft;
    const surveySource = (await (await page.request.get(surveySourceUrl)).json())
      .draft as SurveyDraft;
    const beforeRounds = (await (await page.request.get(`${api}/v1/quizzes`)).json()).quizzes.map(
      (row: { id: string }) => row.id,
    ) as string[];
    const beforeSurveys = (await (await page.request.get(`${api}/v1/surveys`)).json()).surveys.map(
      (row: { id: string }) => row.id,
    ) as string[];
    const writes = contentWrites(page);
    await page.goto("/templates?type=rounds");
    await page
      .getByRole("searchbox", { name: "Search templates", exact: true })
      .fill("Evidence worth trusting");
    const roundPreview = await selectTemplate(page, "source-evaluation", mobile);
    await expect(roundPreview).toContainText(roundSource.questions[0]!.prompt);
    await expect(
      roundPreview.getByRole("button", { name: "Use this starter", exact: true }),
    ).toBeEnabled();
    expect(writes).toEqual([]);
    await reviewSurface(page, info, "#template-panel-rounds", "round-template-preview", mobile);
    expect(writes).toEqual([]);
    let releaseCopy!: () => void;
    const acknowledgement = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    // A submitted copy still completes when filtering removes its preview while awaiting the server.
    await page.route("**/v1/starters/source-evaluation/use", async (route) => {
      const response = await route.fetch();
      await acknowledgement;
      await route.fulfill({ response });
    });
    const roundCreated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/starters/source-evaluation/use",
    );
    await roundPreview.getByRole("button", { name: "Use this starter", exact: true }).click();
    try {
      await page
        .getByRole("searchbox", { name: "Search templates", exact: true })
        .fill("No matching template during copy");
      await expect(roundPreview).toHaveCount(0);
    } finally {
      releaseCopy();
    }
    expect((await roundCreated).status()).toBe(201);
    await page.unroute("**/v1/starters/source-evaluation/use");
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]+$/);
    const roundId = new URL(page.url()).pathname.split("/").at(-1)!;
    const round = (await (await page.request.get(`${api}/v1/quizzes/${roundId}`)).json()).quiz;
    expect(round.status).toBe("draft");
    expect(round.draft.title).toBe(roundSource.title);
    expect(round.draft.questions).toHaveLength(roundSource.questions.length);
    const sourceQuestionIds = new Set(roundSource.questions.map((question) => question.id));
    expect(
      round.draft.questions.every(
        (question: { id: string }) => !sourceQuestionIds.has(question.id),
      ),
    ).toBe(true);
    const prompt = page.locator("#prompt");
    await expect(prompt).toBeEditable();
    const newPrompt = `${roundSource.questions[0]!.prompt} — adapted copy`;
    const roundSaved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/v1/quizzes/${roundId}/draft`,
    );
    await prompt.fill(newPrompt);
    expect((await roundSaved).ok()).toBe(true);
    await expect(page.locator('header [data-state="saved"]')).toBeVisible();
    expect(
      (await (await page.request.get(`${api}/v1/quizzes/${roundId}`)).json()).quiz.draft
        .questions[0].prompt,
    ).toBe(newPrompt);
    expect(templateContent((await (await page.request.get(roundSourceUrl)).json()).draft)).toEqual(
      templateContent(roundSource),
    );

    await page.goto("/templates?type=surveys");
    await page
      .getByRole("searchbox", { name: "Search templates", exact: true })
      .fill("Event experience");
    const surveyPreview = await selectTemplate(page, "event-feedback", mobile, true);
    await expect(surveyPreview).toContainText(surveySource.items[0]!.question.prompt);
    await expect(surveyPreview).toContainText("Optional");
    expect(writes.filter((write) => write.startsWith("POST "))).toEqual([
      "POST /v1/starters/source-evaluation/use",
    ]);
    await fits(page);
    expect(
      (
        await new AxeBuilder({ page })
          .include("#template-panel-surveys")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath("survey-template-preview.png") });
    const surveyCreated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/surveys",
    );
    await surveyPreview.getByRole("button", { name: "Use this starter", exact: true }).click();
    expect((await surveyCreated).status()).toBe(201);
    await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]+$/);
    const surveyId = new URL(page.url()).pathname.split("/").at(-1)!;
    const survey = (await (await page.request.get(`${api}/v1/surveys/${surveyId}`)).json()).survey;
    expect(survey.status).toBe("draft");
    expect(survey.draft.items).toHaveLength(surveySource.items.length);
    expect(survey.draft.items.map((item: { required: boolean }) => item.required)).toEqual(
      surveySource.items.map((item) => item.required),
    );
    const sourceSurveyIds = new Set(surveySource.items.map((item) => item.question.id));
    expect(
      survey.draft.items.every(
        (item: { question: { id: string } }) => !sourceSurveyIds.has(item.question.id),
      ),
    ).toBe(true);
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await expect(title).toBeEditable();
    const surveySaved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/v1/surveys/${surveyId}`,
    );
    await title.fill(`${surveySource.title} — adapted copy`);
    expect((await surveySaved).ok()).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: /^Saved\.$/ })).toBeVisible();
    expect(
      (await (await page.request.get(`${api}/v1/surveys/${surveyId}`)).json()).survey.draft.title,
    ).toBe(`${surveySource.title} — adapted copy`);
    expect(templateContent((await (await page.request.get(surveySourceUrl)).json()).draft)).toEqual(
      templateContent(surveySource),
    );
    const afterRounds = (await (await page.request.get(`${api}/v1/quizzes`)).json())
      .quizzes as Array<{ id: string }>;
    const afterSurveys = (await (await page.request.get(`${api}/v1/surveys`)).json())
      .surveys as Array<{ id: string }>;
    expect(
      afterRounds.filter((row) => !beforeRounds.includes(row.id)).map((row) => row.id),
    ).toEqual([roundId]);
    expect(
      afterSurveys.filter((row) => !beforeSurveys.includes(row.id)).map((row) => row.id),
    ).toEqual([surveyId]);
    expect(writes.filter((write) => write.startsWith("POST "))).toEqual([
      "POST /v1/starters/source-evaluation/use",
      "POST /v1/surveys",
    ]);

    // The compact creation entry retains its native modal keyboard/focus contract.
    await page.goto("/create?type=quiz&start=starters");
    await page
      .getByRole("searchbox", { name: "Search templates", exact: true })
      .fill("Evidence worth trusting");
    const trigger = page
      .locator('[data-template-id="source-evaluation"]')
      .getByRole("button", { name: "Preview questions", exact: true });
    await trigger.focus();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Evidence worth trusting", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close preview", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(writes.filter((write) => write.startsWith("POST "))).toHaveLength(2);
  });
}
