import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const webUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_WEB_PORT ?? 3200)}`;

async function createPackRound(page: Page) {
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();

  const diagnosticId = randomUUID();
  const recheckId = randomUUID();
  const cardId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const cardBody = `<script>alert("not executed")</script>\nCompare the two parts with their reference ${suffix}.`;
  const hiddenBody = `Do not deliver this unselected card ${suffix}.`;
  const common = {
    type: "numeric",
    purpose: "diagnostic",
    confidence: "off",
    conceptKeys: ["ratios"],
    timeLimitSeconds: 120,
    basePoints: 100,
    explanation: "Use the reference quantity to form the ratio.",
    mediaId: null,
    mediaAlt: null,
    correctValue: "2",
    tolerance: "0",
    unit: null,
  };
  const created = await page.request.post(`${apiUrl}/v1/recovery-packs`, {
    data: {
      draft: {
        schemaVersion: 1,
        title: `Live cards ${suffix}`,
        description: "Live intervention and recheck coverage",
        diagnostic: {
          ...common,
          id: diagnosticId,
          delivery: "main",
          linkedRecheckQuestionId: recheckId,
          prompt: "Diagnostic: compare 4 parts with 2 reference parts.",
        },
        recheck: {
          ...common,
          id: recheckId,
          delivery: "recheck",
          linkedRecheckQuestionId: null,
          prompt: "Transfer: compare 10 parts with 5 reference parts.",
        },
        interventions: [
          {
            id: cardId,
            title: "Contrast two ratios",
            body: cardBody,
            citations: [
              {
                sourceName: "Facilitator reference",
                sourceDigest: "c".repeat(64),
                locator: "Example 1",
                excerpt: "A ratio compares each quantity with the same reference.",
              },
            ],
          },
          { id: randomUUID(), title: "Alternative explanation", body: hiddenBody },
        ],
        conceptKeys: ["ratios"],
        misconceptionKeys: [],
        citations: [],
        delayedProbe: null,
      },
    },
  });
  expect(created.status()).toBe(201);
  const pack = (await created.json()).pack;
  const published = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: pack.draftRevision },
  });
  expect(published.ok()).toBeTruthy();
  const packVersion = (await published.json()).version;
  const roundCreated = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: `Live Pack destination ${suffix}` },
  });
  expect(roundCreated.status()).toBe(201);
  const round = (await roundCreated.json()).quiz;
  const inserted = await page.request.post(`${apiUrl}/v1/recovery-packs/insert`, {
    data: {
      quizId: round.id,
      packVersionId: packVersion.id,
      expectedRevision: round.draftRevision,
      mutationId: randomUUID(),
    },
  });
  expect(inserted.ok()).toBeTruthy();
  const insertedRound = (await inserted.json()).quiz;
  const roundPublished = await page.request.post(`${apiUrl}/v1/quizzes/${round.id}/publish`, {
    data: { expectedDraftRevision: insertedRound.draftRevision },
  });
  expect(roundPublished.ok()).toBeTruthy();
  const sessionCreated = await page.request.post(`${apiUrl}/v1/sessions`, {
    data: {
      quizId: round.id,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    },
  });
  expect(sessionCreated.status()).toBe(201);
  const session = (await sessionCreated.json()) as {
    sessionId: string;
    code: string;
    hostToken: string;
  };
  await page.evaluate(
    ({ sessionId, hostToken }) => sessionStorage.setItem(`openround:host:${sessionId}`, hostToken),
    session,
  );
  return { session, cardBody, hiddenBody, cardId };
}

async function liveCardWorkflow(page: Page, browser: Browser, testInfo: TestInfo) {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const { session, cardBody, hiddenBody, cardId } = await createPackRound(page);
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const participantContext = await browser.newContext({
    baseURL: webUrl,
    reducedMotion: "reduce",
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });
  const participant = await participantContext.newPage();
  participant.setDefaultTimeout(10_000);
  let presenter: Page | undefined;
  let selectedCardStarted = false;
  let preSelectionCardLeak = false;
  let unselectedCardLeak = false;
  const observeParticipantSafeFrames = (target: Page) =>
    target.on("websocket", (socket) =>
      socket.on("framereceived", ({ payload }) => {
        const text = payload.toString();
        if (!selectedCardStarted && text.includes(cardBody.split("\n")[1]!))
          preSelectionCardLeak = true;
        if (text.includes(hiddenBody)) unselectedCardLeak = true;
      }),
    );
  observeParticipantSafeFrames(participant);
  try {
    await page.goto(`/host/${session.sessionId}`);
    await participant.goto(`/join?code=${session.code}`);
    await expect(participant.getByTestId("friendly-alias-notice")).toBeVisible();
    await participant.getByRole("button", { name: "Join round" }).click();
    await expect(participant).toHaveURL(/\/play\//);
    const presenterCreated = page.context().waitForEvent("page");
    await page.getByRole("button", { name: "Presenter view" }).click();
    presenter = await presenterCreated;
    observeParticipantSafeFrames(presenter);
    await expect(presenter).toHaveURL(/\/present\//);
    await expect(presenter.getByText(session.code, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Start round", exact: true }).click();
    await expect(
      participant.getByRole("heading", {
        name: "Diagnostic: compare 4 parts with 2 reference parts.",
      }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Recovery Pack card actions" })).toHaveCount(0);
    await participant.getByLabel("Numeric response").fill("3");
    await participant.getByRole("button", { name: "Submit response" }).click();
    await expect(participant.getByText("Answer received and saved.")).toBeVisible();
    await page.getByRole("button", { name: "Lock answers", exact: true }).click();
    await expect(page.getByRole("region", { name: "Recovery Pack card actions" })).toHaveCount(0);
    await page.getByRole("button", { name: "Reveal answer", exact: true }).click();

    const picker = page.getByRole("region", { name: "Recovery Pack card actions", exact: true });
    await expect(picker).toBeVisible();
    await expect(
      picker.getByRole("button", { name: "Work an example with selected card" }),
    ).toBeDisabled();
    await picker
      .getByLabel("Recovery Pack card", { exact: true })
      .selectOption({ label: "1. Contrast two ratios · version 1" });
    await expect(
      picker.getByRole("region", { name: "Recovery Pack card preview (host only)" }),
    ).toContainText(cardBody);
    for (const target of [participant, presenter]) {
      await expect(target.getByRole("region", { name: "Active Recovery Pack card" })).toHaveCount(
        0,
      );
      await expect(target.getByText(hiddenBody, { exact: true })).toHaveCount(0);
    }
    selectedCardStarted = true;
    await picker.getByRole("button", { name: "Work an example with selected card" }).click();
    for (const target of [page, participant, presenter]) {
      const active = target.getByRole("region", { name: "Active Recovery Pack card", exact: true });
      await expect(active.getByRole("heading", { name: "Contrast two ratios" })).toBeVisible();
      await expect(active).toContainText(cardBody);
      await expect(active).toContainText("Facilitator reference · Example 1");
      await expect(active.locator("script")).toHaveCount(0);
      await expect(target.getByText(hiddenBody, { exact: true })).toHaveCount(0);
      expect((await new AxeBuilder({ page: target }).analyze()).violations).toEqual([]);
    }
    await participant.reload();
    await presenter.reload();
    for (const target of [participant, presenter]) {
      await expect(target.getByRole("region", { name: "Active Recovery Pack card" })).toContainText(
        cardBody,
      );
    }
    expect(preSelectionCardLeak).toBe(false);
    expect(unselectedCardLeak).toBe(false);

    await page.getByRole("button", { name: "Finish intervention", exact: true }).click();
    for (const target of [page, participant, presenter]) {
      await expect(target.getByRole("region", { name: "Active Recovery Pack card" })).toHaveCount(
        0,
      );
    }
    await page.getByRole("button", { name: "Open linked recheck", exact: true }).click();
    await expect(
      participant.getByRole("heading", {
        name: "Transfer: compare 10 parts with 5 reference parts.",
      }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Recovery Pack card actions" })).toHaveCount(0);
    await participant.getByLabel("Numeric response").fill("2");
    await participant.getByRole("button", { name: "Submit response" }).click();
    await expect(participant.getByText("Answer received and saved.")).toBeVisible();
    await page.getByRole("button", { name: "Lock answers", exact: true }).click();
    await page.getByRole("button", { name: "Reveal answer", exact: true }).click();
    await page.getByRole("button", { name: "Continue after recheck", exact: true }).click();
    await expect(page.getByText("Results are ready.")).toBeVisible();
    await page
      .getByTestId("host-command-bar")
      .getByRole("link", { name: "Open report", exact: true })
      .click();
    await page.getByRole("tab", { name: "Evidence", exact: true }).click();
    await page.getByText("Recovery story and interpretation", { exact: true }).click();
    await expect(page.getByRole("list", { name: "Intervention timeline" })).toContainText(
      `Recovery Pack v1 · card ${cardId}`,
    );
    const reportResponse = await page.request.get(
      `${apiUrl}/v1/sessions/${session.sessionId}/report`,
    );
    expect(reportResponse.ok()).toBeTruthy();
    const report = (await reportResponse.json()).report;
    expect(report.interventions[0].recoveryPackCard.cardId).toBe(cardId);
    expect(report.recovery[0].recovered).toBe(1);
    expect(unselectedCardLeak).toBe(false);
  } finally {
    if (presenter && !presenter.isClosed()) await presenter.close();
    await participantContext.close();
  }
}

test("Recovery Pack card action is acknowledged, participant-safe, reconnectable and linked to recheck evidence", async ({
  page,
  browser,
}, testInfo) => {
  await liveCardWorkflow(page, browser, testInfo);
});

test("Recovery Pack live card and linked recheck workflow @mobile", async ({
  page,
  browser,
}, testInfo) => {
  await liveCardWorkflow(page, browser, testInfo);
});
