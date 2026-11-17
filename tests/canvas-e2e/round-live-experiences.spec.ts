import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { api, fits, organization, web } from "./support";

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

async function palette(page: Page, tokens: { canvas: string; surface: string; text: string }) {
  const expected = (hex: string) =>
    `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
  await expect
    .poll(() =>
      page.locator(".live-shell").evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe(expected(tokens.canvas));
  const card = page.locator(".live-card").filter({ visible: true }).first();
  await expect(card).toHaveCSS("background-color", expected(tokens.surface));
  await expect(card).toHaveCSS("color", expected(tokens.text));
}

for (const suffix of ["", " @mobile"]) {
  test(`Round published look survives recipes and personal appearance from setup through reports${suffix}`, async ({
    page: host,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    if (!suffix) await host.setViewportSize({ width: 1720, height: 1050 });
    await host.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const { owner } = await organization(host, info);
    const made = await host.request.post(`${api}/v1/quizzes`, {
      data: { title: "Published experience check", description: "" },
    });
    expect(made.status()).toBe(201);
    const { quiz } = await made.json();
    const answer = randomUUID();
    const draft = {
      ...quiz.draft,
      title: "Published experience check",
      category: "safety_compliance",
      experiencePreset: { id: "signal", version: 1 },
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          prompt: "Which step protects the next action?",
          purpose: "diagnostic",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          choices: [
            { id: answer, label: "Check the conditions", isCorrect: true },
            { id: randomUUID(), label: "Skip the review", isCorrect: false },
          ],
          timeLimitSeconds: 300,
          basePoints: 1000,
          explanation: "Check the conditions before proceeding.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    };
    const changed = await host.request.patch(`${api}/v1/quizzes/${quiz.id}`, {
      data: { draft, expectedDraftRevision: quiz.draftRevision },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const saved = (await changed.json()).quiz;
    const publication = await host.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
      data: { expectedDraftRevision: saved.draftRevision },
    });
    expect(publication.status()).toBe(200);
    const version = (await publication.json()).version;
    const laterDraft = await host.request.patch(`${api}/v1/quizzes/${quiz.id}`, {
      data: {
        draft: { ...draft, category: "icebreaker", experiencePreset: { id: "spark", version: 1 } },
        expectedDraftRevision: saved.draftRevision,
      },
    });
    expect(laterDraft.status()).toBe(200);
    await host.evaluate(
      ({ workspaceId }) =>
        localStorage.setItem(
          `openround:setup:v1:${workspaceId}`,
          JSON.stringify({
            recipe: "competition",
            experiencePreset: "spark",
            presenterSoundEnabled: true,
            settings: {
              audienceLimit: 20,
              scoringMode: "accuracy",
              resultVisibility: "leaderboard",
              allowLateJoin: true,
              nicknamePolicy: "friendly_only",
              confidenceEnabled: false,
              timeMode: "timed",
            },
          }),
        ),
      { workspaceId: owner.creator.workspaceId },
    );
    await host.goto(`/host/setup/${quiz.id}`);
    await host.locator(".setup-review > summary").click();
    await expect(host.getByRole("radio", { name: "Signal", exact: true })).toBeChecked();
    await host.getByRole("radio", { name: "Blueprint", exact: true }).check();
    await expect(
      host.getByRole("button", { name: "Use published look", exact: true }),
    ).toBeVisible();
    await host.getByRole("button", { name: "Use published look", exact: true }).click();
    await expect(host.getByRole("radio", { name: "Signal", exact: true })).toBeChecked();
    await accessible(host);
    const created = host.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/sessions",
    );
    await host.getByRole("button", { name: "Create live session", exact: true }).click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    expect(response.request().postDataJSON().experiencePresetOverride).toBeUndefined();
    const room = await response.json();
    expect(room.snapshot.experienceTheme.preset.id).toBe("signal");
    await expect(host).toHaveURL(new RegExp(`/host/${room.sessionId}$`));
    await palette(host, room.snapshot.experienceTheme.tokens);
    const participantContext = await browser.newContext({
      baseURL: web,
      viewport: host.viewportSize()!,
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const participant = await participantContext.newPage();
    try {
      await participant.goto(`/join?code=${room.code}`);
      await participant.getByRole("button", { name: /^Join round$/i }).click();
      await expect(participant).toHaveURL(/\/play\//);
      await expect(participant.locator("html")).toHaveAttribute("data-color-mode", "dark");
      await palette(participant, room.snapshot.experienceTheme.tokens);
      await expect(participant.locator(".live-shell")).toHaveAttribute("data-pattern", "signals");
      await expect(participant.locator(".live-shell")).not.toHaveCSS("background-image", "none");
      await host.getByRole("button", { name: "Start round", exact: true }).click();
      await expect(
        participant.getByRole("heading", { name: draft.questions[0]!.prompt, exact: true }),
      ).toBeVisible();
      if (!suffix)
        expect(
          (await participant
            .locator(".live-card")
            .filter({
              has: participant.getByRole("heading", {
                name: draft.questions[0]!.prompt,
                exact: true,
              }),
            })
            .boundingBox())!.width,
        ).toBeGreaterThan(900);
      await accessible(participant);
      await participant.screenshot({
        path: info.outputPath("round-participant-light-preset-dark-interface.png"),
        fullPage: true,
      });
      await participant.getByRole("button", { name: "Check the conditions", exact: true }).click();
      const submit = participant.getByRole("button", { name: "Submit response", exact: true });
      if (await submit.isVisible()) await submit.click();
      await expect(
        participant.getByText("Answer received and saved.", { exact: true }),
      ).toBeVisible();
      await host.getByRole("button", { name: "Lock answers", exact: true }).click();
      await host.getByRole("button", { name: "Reveal answer", exact: true }).click();
      await accessible(participant);
      await host.getByRole("button", { name: "Finish round", exact: true }).click();
      await expect(participant.getByText("Thanks for taking part.", { exact: true })).toBeVisible();
      await accessible(participant);
      const processed = await host.request.post(`${api}/__test/round-reports/process`, {
        data: {},
      });
      expect(processed.status()).toBe(200);
      await host.getByRole("link", { name: "Open report", exact: true }).first().click();
      await expect(host.getByRole("tab", { name: "Overview", exact: true })).toBeVisible();
      await accessible(host);
      await host.screenshot({
        path: info.outputPath("round-report-overview-light.png"),
        fullPage: true,
      });
      for (const name of [
        "Questions",
        "Participants",
        "Evidence",
        "Conversation",
        "Decision replay",
        "Manage data",
      ]) {
        const tab = host.getByRole("tab", { name, exact: true });
        if (await tab.count()) {
          await tab.click();
          await accessible(host);
        }
      }
      await host.getByRole("tab", { name: "Overview", exact: true }).click();
      await host.emulateMedia({ colorScheme: "dark" });
      await expect(host.locator("html")).toHaveAttribute("data-color-mode", "dark");
      await accessible(host);
      if (suffix) {
        await host.setViewportSize({ width: 320, height: 844 });
        await participant.setViewportSize({ width: 320, height: 844 });
        await accessible(host);
        await accessible(participant);
      }
      await host.screenshot({
        path: info.outputPath("round-report-overview-dark.png"),
        fullPage: true,
      });
      const retained = await (await host.request.get(`${api}/v1/quizzes/${quiz.id}`)).json();
      expect(retained.currentVersion.content).toEqual(version.content);
    } finally {
      await participantContext.close();
    }
  });
}

test("New dark Round looks keep native contrast and accessible overrides with honest empty reports", async ({
  page: host,
  browser,
}, info) => {
  await host.setViewportSize({ width: 1600, height: 1000 });
  await organization(host, info);
  const made = await host.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
    data: {},
  });
  expect(made.status()).toBe(201);
  const { quiz } = await made.json();
  const patched = await host.request.patch(`${api}/v1/quizzes/${quiz.id}`, {
    data: {
      draft: {
        ...quiz.draft,
        title: "Science workshop",
        category: "science",
        experiencePreset: { id: "observatory", version: 1 },
        questions: [quiz.draft.questions[0]],
      },
      expectedDraftRevision: quiz.draftRevision,
    },
  });
  expect(patched.status()).toBe(200);
  const saved = (await patched.json()).quiz;
  const published = await host.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
    data: { expectedDraftRevision: saved.draftRevision },
  });
  expect(published.status()).toBe(200);
  await host.goto(`/host/setup/${quiz.id}`);
  await host.locator(".setup-review > summary").click();
  await expect(host.getByRole("radio", { name: "Observatory", exact: true })).toBeChecked();
  await accessible(host);
  const creating = host.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/v1/sessions",
  );
  await host.getByRole("button", { name: "Create live session", exact: true }).click();
  const room = await (await creating).json();
  expect(room.snapshot.experienceTheme.preset.id).toBe("observatory");
  const context = await browser.newContext({
    baseURL: web,
    viewport: { width: 1600, height: 1000 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const guest = await context.newPage();
  try {
    await guest.goto(`/join?code=${room.code}`);
    const nickname = guest.getByRole("textbox", { name: "Nickname", exact: true });
    if (await nickname.isVisible()) await nickname.fill("Workshop guest");
    await guest.getByRole("button", { name: /^Join round$/i }).click();
    await expect(guest).toHaveURL(/\/play\//);
    await palette(guest, room.snapshot.experienceTheme.tokens);
    await expect(guest.locator(".live-shell")).toHaveCSS("color-scheme", "dark");
    await accessible(guest);
    await guest.locator(".experience-preferences > summary").click();
    await guest.getByRole("checkbox", { name: "High contrast", exact: true }).check();
    await expect(guest.locator(".live-shell")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(guest.locator(".live-topbar")).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await accessible(guest);
    await guest.getByRole("checkbox", { name: "High contrast", exact: true }).uncheck();
    await guest.getByRole("checkbox", { name: "Reduce motion", exact: true }).check();
    await guest.locator(".experience-preferences > summary").click();
    await host.getByRole("button", { name: "Start round", exact: true }).click();
    await expect(guest.locator('[data-testid="participant-task"]')).toBeVisible();
    await palette(guest, room.snapshot.experienceTheme.tokens);
    await accessible(guest);
    await guest.screenshot({ path: info.outputPath("round-dark-observatory.png"), fullPage: true });
    await host.getByRole("button", { name: "Lock answers", exact: true }).click();
    await host.getByRole("button", { name: "Reveal answer", exact: true }).click();
    await host.getByRole("button", { name: "Finish round", exact: true }).click();
    expect(
      (await host.request.post(`${api}/__test/round-reports/process`, { data: {} })).status(),
    ).toBe(200);
    await host.getByRole("link", { name: "Open report", exact: true }).first().click();
    await expect(
      host.getByRole("heading", { name: "No responses were recorded", exact: true }),
    ).toBeVisible();
    await expect(
      host.getByText("Not measured", { exact: true }).filter({ visible: true }),
    ).toHaveCount(0);
    await accessible(host);
    await host.screenshot({
      path: info.outputPath("round-report-no-responses.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
