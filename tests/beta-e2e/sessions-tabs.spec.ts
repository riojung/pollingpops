import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function createSessions(page: Page) {
  const title = `Synthetic delivery ${randomUUID().slice(0, 8)}`;
  const createdRound = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
    data: {},
  });
  expect(createdRound.status()).toBe(201);
  const { quiz } = await createdRound.json();
  const savedRound = await page.request.patch(`${api}/v1/quizzes/${quiz.id}`, {
    data: {
      draft: { ...quiz.draft, title: `${title} Round` },
      expectedDraftRevision: quiz.draftRevision ?? 0,
    },
  });
  expect(savedRound.status()).toBe(200);
  const updatedQuiz = (await savedRound.json()).quiz;
  expect(
    (
      await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
        data: { expectedDraftRevision: updatedQuiz.draftRevision },
      })
    ).status(),
  ).toBe(200);
  const roundResponse = await page.request.post(`${api}/v1/sessions`, {
    data: {
      quizId: quiz.id,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    },
  });
  expect(roundResponse.status()).toBe(201);
  const round = await roundResponse.json();

  const createdPresentation = await page.request.post(`${api}/v1/presentations`, {
    data: { title: `${title} Presentation`, description: "Synthetic Sessions fixture" },
  });
  expect(createdPresentation.status()).toBe(201);
  const { presentation } = await createdPresentation.json();
  const savedPresentation = await page.request.put(
    `${api}/v1/presentations/${presentation.id}/draft`,
    {
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
                prompt: "Synthetic numeric checkpoint",
                purpose: "diagnostic",
                confidence: "off",
                delivery: "main",
                conceptKeys: [],
                linkedRecheckQuestionId: null,
                timeLimitSeconds: 30,
                basePoints: 100,
                explanation: "Synthetic explanation",
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
    },
  );
  expect(savedPresentation.status()).toBe(200);
  expect(
    (
      await page.request.post(`${api}/v1/presentations/${presentation.id}/publish`, {
        data: {
          expectedDraftRevision: (await savedPresentation.json()).presentation.draftRevision,
        },
      })
    ).status(),
  ).toBe(200);
  const presentationResponse = await page.request.post(`${api}/v1/presentation-sessions`, {
    data: { presentationId: presentation.id },
  });
  expect(presentationResponse.status()).toBe(201);
  const presentationRoom = await presentationResponse.json();

  const createdSurvey = await page.request.post(`${api}/v1/surveys`, {
    data: {
      title: `${title} Survey`,
      templateId: "training-feedback",
      idempotencyKey: randomUUID(),
    },
  });
  expect(createdSurvey.status()).toBe(201);
  const { survey } = await createdSurvey.json();
  const savedSurvey = await page.request.put(`${api}/v1/surveys/${survey.id}`, {
    data: {
      draft: { ...survey.draft, title: `${title} Survey` },
      expectedRevision: survey.revision,
      idempotencyKey: randomUUID(),
    },
  });
  expect(savedSurvey.status()).toBe(200);
  const publishedSurvey = await page.request.post(`${api}/v1/surveys/${survey.id}/publish`, {
    data: {
      expectedRevision: (await savedSurvey.json()).survey.revision,
      idempotencyKey: randomUUID(),
    },
  });
  expect(publishedSurvey.status()).toBe(200);
  const surveyRoomResponse = await page.request.post(`${api}/v1/surveys/${survey.id}/rooms`, {
    data: {
      expectedRevision: (await publishedSurvey.json()).survey.revision,
      idempotencyKey: randomUUID(),
      windowDays: 7,
    },
  });
  expect(surveyRoomResponse.status()).toBe(201);
  return {
    title,
    round,
    quizId: quiz.id,
    presentationId: presentation.id,
    presentationRoom,
    surveyId: survey.id,
    surveyRoom: (await surveyRoomResponse.json()).room,
  };
}

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}Sessions separates delivery types, searches history, saves layout and retains Survey results`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      // WebKit reports canceled cross-origin API reads as access-control errors
      // during full-page navigation. Keep application and hydration errors visible.
      const canceledApiRead =
        test.info().project.name.startsWith("webkit") &&
        error.message.startsWith(`/${new URL(api).host}/v1/`) &&
        error.message.endsWith(" due to access control checks.");
      if (!canceledApiRead) pageErrors.push(error.message);
    });
    await signInBeta(page);
    const fixture = await createSessions(page);
    const countsResponse = await page.request.get(`${api}/v1/sessions/counts`);
    expect(countsResponse.status()).toBe(200);
    const { counts } = await countsResponse.json();
    await page.goto(`/sessions?type=rounds&q=${encodeURIComponent(fixture.title)}`);
    await expect(page.getByRole("heading", { name: "Sessions", level: 1 })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Session type" });
    for (const [label, kind] of [
      ["Rounds", "rounds"],
      ["Presentations", "presentations"],
      ["Surveys", "surveys"],
    ]) {
      await expect(tabs.getByRole("tab", { name: new RegExp(`^${label}`) })).toHaveText(
        `${label} ${counts[kind!]}`,
      );
    }
    const roundCard = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: `${fixture.title} Round`, exact: true }) });
    await expect(roundCard).toBeVisible();
    await expect(
      roundCard.getByRole("button", { name: "Resume Session", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(1);
    await page
      .getByRole("searchbox", { name: "Search Round sessions", exact: true })
      .fill(fixture.round.code);
    await expect(roundCard).toBeVisible();
    await page.getByRole("combobox", { name: "Round", exact: true }).selectOption(fixture.quizId);
    await page.getByLabel("Started from", { exact: true }).fill("2020-01-01");
    await expect(roundCard).toBeVisible();
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await expect(page.locator("#rounds-panel [data-view=list]")).toBeVisible();
    await page.reload();
    await expect(roundCard).toBeVisible();
    await expect(page.locator("#rounds-panel [data-view=list]")).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Search Round sessions", exact: true })
      .fill(fixture.title);
    await tabs.getByRole("tab", { name: /^Presentations/ }).click();
    await expect(
      page.getByRole("searchbox", { name: "Search Presentation sessions", exact: true }),
    ).toHaveValue(fixture.title);
    await expect(page.getByRole("combobox", { name: "Presentation", exact: true })).toHaveValue(
      "all",
    );
    await expect(page.getByLabel("Started from", { exact: true })).toHaveValue("");
    const presentationCard = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: `${fixture.title} Presentation`, exact: true }),
    });
    await expect(presentationCard).toBeVisible();
    await expect(
      presentationCard.getByRole("link", { name: "Resume Presentation", exact: true }),
    ).toHaveAttribute(
      "href",
      `/presentation-session/${fixture.presentationRoom.snapshot.sessionId}/host`,
    );
    await expect(page.getByRole("article")).toHaveCount(1);
    await tabs.getByRole("tab", { name: /^Surveys/ }).click();
    const surveyCard = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: `${fixture.title} Survey`, exact: true }) });
    await expect(surveyCard).toBeVisible();
    await expect(
      surveyCard.getByRole("link", { name: "Manage sharing", exact: true }),
    ).toHaveAttribute("href", `/surveys/rooms/${fixture.surveyRoom.id}`);
    await expect(surveyCard.getByRole("link", { name: "View Results", exact: true })).toBeVisible();
    await expect(
      surveyCard.getByRole("button", { name: "Delete Survey run", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Closes from", { exact: true })).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Search your workspace sessions", exact: true })
      .fill(fixture.surveyRoom.code);
    await page
      .getByRole("searchbox", { name: "Search your workspace sessions", exact: true })
      .press("Enter");
    await expect(page).toHaveURL(/\/sessions\?type=surveys&q=/);
    await expect(surveyCard).toBeVisible();
    if (mobile) await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results-beta/sessions-${test.info().project.name}.png`,
      fullPage: true,
    });
    expect(
      (
        await page.request.post(`${api}/v1/survey-rooms/${fixture.surveyRoom.id}/close`, {
          data: { idempotencyKey: randomUUID() },
        })
      ).status(),
    ).toBe(204);
    await page.reload();
    await expect(surveyCard).toBeVisible();
    await expect(surveyCard.getByRole("link", { name: "Manage sharing", exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("finished");
    await expect(surveyCard).toBeVisible();
    await expect(surveyCard.getByRole("link", { name: "View Results", exact: true })).toBeVisible();
    let releaseDelete!: () => void;
    let deleteStarted!: () => void;
    const deletionGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const deletionStarted = new Promise<void>((resolve) => {
      deleteStarted = resolve;
    });
    await page.route(`${api}/v1/survey-rooms/${fixture.surveyRoom.id}`, async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      deleteStarted();
      await deletionGate;
      await route.continue();
    });
    page.once("dialog", (dialog) => dialog.accept());
    await surveyCard.getByRole("button", { name: "Delete Survey run", exact: true }).click();
    await deletionStarted;
    await tabs.getByRole("tab", { name: /^Rounds/ }).click();
    releaseDelete();
    await expect(tabs.getByRole("tab", { name: /^Surveys/ })).toHaveText(
      `Surveys ${counts.surveys - 1}`,
    );
    await tabs.getByRole("tab", { name: /^Surveys/ }).click();
    await expect(tabs.getByRole("tab", { name: /^Surveys/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("searchbox", { name: "Search Survey sessions", exact: true }),
    ).toHaveValue(fixture.surveyRoom.code);
    await expect(surveyCard).toHaveCount(0);
    await page.unroute(`${api}/v1/survey-rooms/${fixture.surveyRoom.id}`);
    expect((await page.request.get(`${api}/v1/surveys/${fixture.surveyId}`)).status()).toBe(200);
    await page.goto("/surveys/runs");
    await expect(page).toHaveURL(/\/sessions\?type=surveys$/);
    await expect(tabs.getByRole("tab", { name: /^Surveys/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(pageErrors).toEqual([]);
  });
}
