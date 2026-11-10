import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

// Follow the published Pack / frozen Presentation insertion fixtures used by recovery-packs.spec.
async function frozenPackSession(page: Page, linkedRecheck: boolean) {
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();
  const suffix = randomUUID().slice(0, 8);
  const recheckId = randomUUID();
  const cardId = randomUUID();
  const cardBody = `<script>alert("not executed")</script>\nAccepted frozen guidance ${suffix}.`;
  const hiddenBody = `Unselected private guidance ${suffix}.`;
  const citationName = `Accepted source ${suffix}`;
  const laterBody = `Later unaccepted guidance ${suffix}.`;
  const diagnostic = {
    id: randomUUID(),
    type: "numeric",
    prompt: `Pack diagnostic ${suffix}`,
    correctValue: "2",
    tolerance: "0",
    unit: null,
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["ratios"],
    linkedRecheckQuestionId: recheckId,
    timeLimitSeconds: 120,
    basePoints: 100,
    explanation: `Private answer explanation ${suffix}`,
    mediaId: null,
    mediaAlt: null,
  };
  const createdPack = await page.request.post(`${apiUrl}/v1/recovery-packs`, {
    data: {
      draft: {
        schemaVersion: 1,
        title: `Presentation live cards ${suffix}`,
        description: "Frozen intervention coverage",
        diagnostic,
        recheck: {
          ...diagnostic,
          id: recheckId,
          delivery: "recheck",
          linkedRecheckQuestionId: null,
          prompt: `Linked transfer ${suffix}`,
        },
        interventions: [
          { id: cardId, title: "Contrast two ratios", body: `Original frozen guidance ${suffix}.` },
          { id: randomUUID(), title: "Alternative explanation", body: hiddenBody },
        ],
        delayedProbe: null,
        conceptKeys: ["ratios"],
        misconceptionKeys: [],
        citations: [],
      },
    },
  });
  expect(createdPack.status()).toBe(201);
  let pack = (await createdPack.json()).pack;
  const originalPublished = await page.request.post(
    `${apiUrl}/v1/recovery-packs/${pack.id}/publish`,
    {
      data: { expectedDraftRevision: pack.draftRevision },
    },
  );
  expect(originalPublished.status()).toBe(200);
  const originalVersion = (await originalPublished.json()).version;
  const createdPresentation = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: `Live card destination ${suffix}`, description: "" },
  });
  expect(createdPresentation.status()).toBe(201);
  let presentation = (await createdPresentation.json()).presentation;
  const emptied = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
    data: {
      draft: { ...presentation.draft, blocks: [] },
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(emptied.status()).toBe(200);
  presentation = (await emptied.json()).presentation;
  const inserted = await page.request.post(
    `${apiUrl}/v1/presentations/${presentation.id}/recovery-packs/insert`,
    {
      data: {
        packVersionId: originalVersion.id,
        afterBlockId: null,
        expectedRevision: presentation.draftRevision,
        mutationId: randomUUID(),
      },
    },
  );
  expect(inserted.status()).toBe(200);
  presentation = (await inserted.json()).presentation;
  const insertion = presentation.draft.recoveryPackInsertions[0];
  const sourceSaved = await page.request.put(`${apiUrl}/v1/recovery-packs/${pack.id}/draft`, {
    data: {
      draft: {
        ...pack.draft,
        interventions: [
          {
            ...pack.draft.interventions[0],
            body: cardBody,
            citations: [
              {
                sourceName: citationName,
                sourceDigest: "c".repeat(64),
                locator: "Example 2",
                excerpt: "Compare with the same reference.",
              },
            ],
          },
          pack.draft.interventions[1],
        ],
      },
      expectedRevision: pack.draftRevision,
      mutationId: randomUUID(),
    },
  });
  expect(sourceSaved.status()).toBe(200);
  pack = (await sourceSaved.json()).pack;
  const acceptedPublished = await page.request.post(
    `${apiUrl}/v1/recovery-packs/${pack.id}/publish`,
    {
      data: { expectedDraftRevision: pack.draftRevision },
    },
  );
  expect(acceptedPublished.status()).toBe(200);
  const acceptedVersion = (await acceptedPublished.json()).version;
  const updated = await page.request.post(
    `${apiUrl}/v1/presentations/${presentation.id}/recovery-packs/update`,
    {
      data: {
        insertionId: insertion.id,
        packVersionId: acceptedVersion.id,
        expectedRevision: presentation.draftRevision,
        mutationId: randomUUID(),
        choices: [
          { role: "diagnostic", action: "use_latest" },
          { role: "recheck", action: "use_latest" },
        ],
      },
    },
  );
  expect(updated.status()).toBe(200);
  presentation = (await updated.json()).presentation;
  expect(presentation.draft.recoveryPackInsertions[0].updateBaseline.packVersionId).toBe(
    acceptedVersion.id,
  );
  if (!linkedRecheck) {
    const unlinked = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
      data: {
        draft: {
          ...presentation.draft,
          blocks: presentation.draft.blocks
            .filter(
              (block: { question: { id: string } }) =>
                block.question.id !== insertion.recheckQuestionId,
            )
            .map((block: { question: { id: string } }) => ({
              ...block,
              question: { ...block.question, linkedRecheckQuestionId: null },
            })),
        },
        expectedRevision: presentation.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(unlinked.status()).toBe(200);
    presentation = (await unlinked.json()).presentation;
  }
  const published = await page.request.post(
    `${apiUrl}/v1/presentations/${presentation.id}/publish`,
    {
      data: { expectedDraftRevision: presentation.draftRevision },
    },
  );
  expect(published.status()).toBe(200);
  // Publish a later source before removing it: the session must retain the accepted V2 card.
  const laterSaved = await page.request.put(`${apiUrl}/v1/recovery-packs/${pack.id}/draft`, {
    data: {
      draft: {
        ...pack.draft,
        interventions: [
          { ...pack.draft.interventions[0], body: laterBody },
          pack.draft.interventions[1],
        ],
      },
      expectedRevision: pack.draftRevision,
      mutationId: randomUUID(),
    },
  });
  expect(laterSaved.status()).toBe(200);
  const laterPublished = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: (await laterSaved.json()).pack.draftRevision },
  });
  expect(laterPublished.status()).toBe(200);
  expect((await page.request.delete(`${apiUrl}/v1/recovery-packs/${pack.id}`)).status()).toBe(204);
  const createdSession = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
    data: { presentationId: presentation.id },
  });
  expect(createdSession.status()).toBe(201);
  const { snapshot, controlToken } = await createdSession.json();
  const sessionId = snapshot.sessionId ?? snapshot.id;
  await page.evaluate(
    ({ sessionId, controlToken }) =>
      sessionStorage.setItem(`openround:presentation-host:${sessionId}`, controlToken),
    { sessionId, controlToken },
  );
  return {
    sessionId,
    controlToken,
    code: snapshot.code,
    cardId,
    insertionId: insertion.id,
    cardBody,
    hiddenBody,
    citationName,
    laterBody,
    diagnostic,
    recheckPrompt: `Linked transfer ${suffix}`,
  };
}

async function presentationCardWorkflow(
  page: Page,
  browser: Browser,
  testInfo: TestInfo,
  linkedRecheck: boolean,
) {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const fixture = await frozenPackSession(page, linkedRecheck);
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const participantContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    reducedMotion: "reduce",
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });
  const participant = await participantContext.newPage();
  const cardRequests: string[] = [];
  const legacyAdvances: string[] = [];
  let droppedAckId: string | null = null;
  let droppedAck = false;
  if (linkedRecheck) {
    await page.route(`**/v1/presentation-sessions/${fixture.sessionId}/advance`, async (route) => {
      legacyAdvances.push(route.request().postData()!);
      await route.continue();
    });
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        const match = message.toString().match(/^42(\d+)(\[.*)$/);
        if (match) {
          const [event, command] = JSON.parse(match[2]!);
          if (event === "presentation.command" && command.action === "start_recovery_card") {
            cardRequests.push(JSON.stringify(command));
            if (droppedAckId === null) droppedAckId = match[1]!;
          }
        }
        server.send(message);
      });
      server.onMessage((message) => {
        if (
          !droppedAck &&
          droppedAckId !== null &&
          message.toString().startsWith(`43${droppedAckId}[`)
        ) {
          droppedAck = true;
          return;
        }
        socket.send(message);
      });
    });
  }
  let selectedStarted = false;
  let recheckOpened = false;
  let privateCardLeak = false;
  let futureQuestionLeak = false;
  const participantFrames: string[] = [];
  participant.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const frame = payload.toString();
      participantFrames.push(frame);
      if (
        frame.includes('"recoveryPackCards":') ||
        frame.includes(fixture.hiddenBody) ||
        frame.includes(fixture.laterBody) ||
        (!selectedStarted &&
          (frame.includes(fixture.cardBody.split("\n")[1]!) ||
            frame.includes(fixture.citationName)))
      )
        privateCardLeak = true;
      if (!recheckOpened && frame.includes(fixture.recheckPrompt)) futureQuestionLeak = true;
    }),
  );
  try {
    await page.goto(`/presentation-session/${fixture.sessionId}/host`);
    await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
    await participant.goto(`/join?code=${fixture.code}`);
    // Preflight resolves after hydration; filling the server-rendered input sooner can be reset.
    await expect(
      participant.getByRole("heading", { name: "Join a Presentation", exact: true }),
    ).toBeVisible();
    await participant.getByLabel("Nickname", { exact: true }).fill("Card participant");
    const join = participant.getByRole("button", { name: "Join presentation", exact: true });
    await expect(join).toBeEnabled();
    await join.click();
    await expect(participant).toHaveURL(`/presentation-session/${fixture.sessionId}/play`);
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    await expect(
      participant.getByRole("heading", { name: fixture.diagnostic.prompt, exact: true }),
    ).toBeVisible();
    for (const target of [page, participant]) {
      await expect(target.getByRole("region", { name: "Recovery Pack card actions" })).toHaveCount(
        0,
      );
      await expect(target.getByText(fixture.cardBody, { exact: true })).toHaveCount(0);
    }
    const beforeReveal = await page.request.get(
      `${apiUrl}/v1/presentation-sessions/${fixture.sessionId}`,
    );
    expect((await beforeReveal.json()).snapshot).not.toHaveProperty("recoveryPackCards");
    await participant.getByLabel("Numeric response", { exact: true }).fill("3");
    await participant.getByRole("button", { name: "Submit response", exact: true }).click();
    await expect(
      participant.getByText("Response saved. You can stay here while the facilitator continues."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    const picker = page.getByRole("region", { name: "Recovery Pack card actions", exact: true });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: "Explain with selected card" })).toBeDisabled();
    await picker
      .getByLabel("Recovery Pack card", { exact: true })
      .selectOption({ label: "1. Contrast two ratios · version 2" });
    await expect(
      picker.getByRole("region", { name: "Recovery Pack card preview (host only)" }),
    ).toContainText(fixture.cardBody);
    await expect(
      participant.getByRole("region", { name: "Active Recovery Pack card" }),
    ).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(privateCardLeak).toBe(false);
    selectedStarted = true;
    await picker
      .getByRole("button", {
        name: linkedRecheck ? "Work an example with selected card" : "Explain with selected card",
      })
      .click();
    for (const target of [page, participant]) {
      const active = target.getByRole("region", { name: "Active Recovery Pack card", exact: true });
      await expect(active).toContainText(fixture.cardBody);
      await expect(active).toContainText(`${fixture.citationName} · Example 2`);
      await expect(active.locator("script")).toHaveCount(0);
      await expect(target.getByText(fixture.hiddenBody, { exact: true })).toHaveCount(0);
      await expect(target.getByText(fixture.laterBody, { exact: true })).toHaveCount(0);
      expect((await new AxeBuilder({ page: target }).analyze()).violations).toEqual([]);
    }
    await participant.reload();
    await expect(
      participant.getByRole("region", { name: "Active Recovery Pack card" }),
    ).toContainText(fixture.cardBody);
    if (linkedRecheck) {
      const retry = page.getByRole("button", {
        name: "Retry card action acknowledgement",
        exact: true,
      });
      await expect(retry).toBeEnabled();
      expect(droppedAck).toBe(true);
      expect(cardRequests).toHaveLength(1);
      await expect(
        page.getByText("Action not yet confirmed. Retry to confirm the original action."),
      ).toBeVisible();
      const state = (
        await (
          await page.request.get(`${apiUrl}/v1/presentation-sessions/${fixture.sessionId}`)
        ).json()
      ).snapshot;
      const replacementPassResponse = await page.request.post(
        `${apiUrl}/v1/presentation-sessions/${fixture.sessionId}/control-pass`,
      );
      expect(replacementPassResponse.status()).toBe(201);
      const replacementPass = await replacementPassResponse.json();
      // An unauthorized retry cannot settle the original accepted-but-unconfirmed command.
      await retry.click();
      const restorePass = page.getByRole("button", {
        name: "Retry host control pass",
        exact: true,
      });
      await expect(restorePass).toBeEnabled();
      await expect(retry).toBeDisabled();
      expect(cardRequests).toHaveLength(2);
      expect(cardRequests[0]).toBe(cardRequests[1]);
      expect(legacyAdvances).toEqual([]);
      recheckOpened = true;
      // A second host advances while this browser still awaits the original card acknowledgement.
      const advanced = await page.request.post(
        `${apiUrl}/v1/presentation-sessions/${fixture.sessionId}/command`,
        {
          data: {
            sessionId: fixture.sessionId,
            controlToken: replacementPass.controlToken,
            commandId: randomUUID(),
            expectedRevision: state.revision,
            action: "advance",
          },
        },
      );
      expect(advanced.status()).toBe(200);
      await expect(
        participant.getByRole("heading", { name: fixture.recheckPrompt, exact: true }),
      ).toBeVisible();
      for (const target of [page, participant])
        await expect(target.getByRole("region", { name: "Active Recovery Pack card" })).toHaveCount(
          0,
        );
      await expect(picker).toHaveCount(0);
      await restorePass.click();
      await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
      const restoredToken = await page.evaluate(
        (sessionId) => sessionStorage.getItem(`openround:presentation-host:${sessionId}`),
        fixture.sessionId,
      );
      expect(restoredToken).toBeTruthy();
      expect(restoredToken).not.toBe(fixture.controlToken);
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(retry).toHaveCount(0);
      expect(cardRequests).toHaveLength(3);
      expect(JSON.parse(cardRequests[2]!).controlToken).toBe(restoredToken);
      expect({ ...JSON.parse(cardRequests[2]!), controlToken: null }).toEqual({
        ...JSON.parse(cardRequests[0]!),
        controlToken: null,
      });
      expect(JSON.parse(cardRequests[2]!).recoveryPackCard).toEqual({
        insertionId: fixture.insertionId,
        cardId: fixture.cardId,
      });
      expect(legacyAdvances).toEqual([]);
      await participant.getByLabel("Numeric response", { exact: true }).fill("2");
      await participant.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(
        participant.getByText("Response saved. You can stay here while the facilitator continues."),
      ).toBeVisible();
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    }
    await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
    for (const target of [page, participant])
      await expect(target.getByRole("region", { name: "Active Recovery Pack card" })).toHaveCount(
        0,
      );
    await page.getByRole("link", { name: "Open session report", exact: true }).click();
    await expect(page.getByRole("list", { name: "Facilitation timeline" })).toContainText(
      `Recovery Pack v2 · card ${fixture.cardId}`,
    );
    const reportResponse = await page.request.get(
      `${apiUrl}/v1/presentation-sessions/${fixture.sessionId}/report`,
    );
    const report = (await reportResponse.json()).report;
    expect(report.schemaVersion).toBe(2);
    const cardEvents = report.timeline.filter(
      (event: { recoveryPackIntervention?: unknown }) => event.recoveryPackIntervention,
    );
    expect(cardEvents).toHaveLength(1);
    expect(cardEvents[0].recoveryPackIntervention.type).toBe(linkedRecheck ? "example" : "explain");
    expect(cardEvents[0].recoveryPackIntervention.reference.cardId).toBe(fixture.cardId);
    expect(JSON.stringify(report)).not.toContain(fixture.cardBody.split("\n")[1]!);
    expect(JSON.stringify(report)).not.toContain(fixture.hiddenBody);
    if (linkedRecheck) expect(report.recovery[0].recovered).toBe(1);
    expect(privateCardLeak).toBe(false);
    expect(futureQuestionLeak).toBe(false);
    expect(participantFrames.some((frame) => frame.includes('"recoveryPackIntervention":'))).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await participantContext.close();
  }
}

test("Presentation Pack cards stay selected-only and replay a lost acknowledgement after recheck", async ({
  page,
  browser,
}, testInfo) => {
  await presentationCardWorkflow(page, browser, testInfo, true);
});
test("Presentation Pack explanation with removed recheck clears on generic finish", async ({
  page,
  browser,
}, testInfo) => {
  await presentationCardWorkflow(page, browser, testInfo, false);
});
test("Presentation Pack live card acknowledgement and recheck @mobile", async ({
  page,
  browser,
}, testInfo) => {
  await presentationCardWorkflow(page, browser, testInfo, true);
});
test("Presentation Pack explanation and generic finish @mobile", async ({
  page,
  browser,
}, testInfo) => {
  await presentationCardWorkflow(page, browser, testInfo, false);
});

test("Presentation host advances without a control pass and reacquires card controls", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await frozenPackSession(page, false);
  await page.evaluate(
    (sessionId) => sessionStorage.removeItem(`openround:presentation-host:${sessionId}`),
    fixture.sessionId,
  );
  let failControlPass = true;
  await page.route(
    `**/v1/presentation-sessions/${fixture.sessionId}/control-pass`,
    async (route) => {
      if (failControlPass) {
        failControlPass = false;
        await route.fulfill({
          status: 503,
          json: { error: { code: "UNAVAILABLE", message: "Host pass temporarily unavailable" } },
        });
      } else await route.continue();
    },
  );
  const legacyBodies: string[] = [];
  let loseLegacyAcknowledgement = true;
  await page.route(`**/v1/presentation-sessions/${fixture.sessionId}/advance`, async (route) => {
    legacyBodies.push(route.request().postData()!);
    if (loseLegacyAcknowledgement) {
      loseLegacyAcknowledgement = false;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  const durableRestBodies: string[] = [];
  await page.route(`**/v1/presentation-sessions/${fixture.sessionId}/command`, async (route) => {
    durableRestBodies.push(route.request().postData()!);
    await route.continue();
  });
  await page.goto(`/presentation-session/${fixture.sessionId}/host`);
  await expect(
    page.getByRole("button", { name: "Retry host control pass", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: fixture.diagnostic.prompt, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reveal and close question", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Retry advance acknowledgement", exact: true }),
  ).toHaveCount(0);
  expect(legacyBodies).toHaveLength(1);
  expect(Object.keys(JSON.parse(legacyBodies[0]!))).toEqual(["expectedRevision"]);
  expect(durableRestBodies).toEqual([]);
  await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
  const picker = page.getByRole("region", { name: "Recovery Pack card actions", exact: true });
  await expect(picker).toBeVisible();
  await expect(picker.getByLabel("Recovery Pack card", { exact: true })).toBeDisabled();
  await expect(
    picker.getByRole("button", { name: "Explain with selected card", exact: true }),
  ).toBeDisabled();
  expect(legacyBodies).toHaveLength(2);
  expect(durableRestBodies).toEqual([]);
  await page.getByRole("button", { name: "Retry host control pass", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry host control pass", exact: true }),
  ).toHaveCount(0);
  await picker
    .getByLabel("Recovery Pack card", { exact: true })
    .selectOption({ label: "1. Contrast two ratios · version 2" });
  await picker.getByRole("button", { name: "Explain with selected card", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Active Recovery Pack card", exact: true }),
  ).toContainText(fixture.cardBody);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Active Recovery Pack card", exact: true }),
  ).toHaveCount(0);
});

async function rotatedHostPassWorkflow(page: Page, browser: Browser, testInfo: TestInfo) {
  test.setTimeout(120_000);
  const fixture = await frozenPackSession(page, false);
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const otherHostContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(),
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });
  const otherHost = await otherHostContext.newPage();
  const legacyAdvances: string[] = [];
  let originalPassRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`/v1/presentation-sessions/${fixture.sessionId}/control-pass`)
    )
      originalPassRequests += 1;
  });
  await page.route(`**/v1/presentation-sessions/${fixture.sessionId}/advance`, async (route) => {
    legacyAdvances.push(route.request().postData()!);
    await route.continue();
  });
  try {
    await page.goto(`/presentation-session/${fixture.sessionId}/host`);
    await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
    // A new browser has no session-scoped pass and explicitly rotates the previous credential.
    await otherHost.goto(`/presentation-session/${fixture.sessionId}/host`);
    await expect(otherHost.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    const restorePass = page.getByRole("button", {
      name: "Retry host control pass",
      exact: true,
    });
    await expect(restorePass).toBeEnabled();
    expect(
      await page.evaluate(
        (sessionId) => sessionStorage.getItem(`openround:presentation-host:${sessionId}`),
        fixture.sessionId,
      ),
    ).toBeNull();
    expect(originalPassRequests).toBe(0);
    expect(legacyAdvances).toEqual([]);
    // Reopening with the same stale stored pass must also detect sync-time rejection.
    await page.evaluate(
      ({ sessionId, controlToken }) =>
        sessionStorage.setItem(`openround:presentation-host:${sessionId}`, controlToken),
      { sessionId: fixture.sessionId, controlToken: fixture.controlToken },
    );
    await page.reload();
    await expect(restorePass).toBeEnabled();
    expect(
      await page.evaluate(
        (sessionId) => sessionStorage.getItem(`openround:presentation-host:${sessionId}`),
        fixture.sessionId,
      ),
    ).toBeNull();
    expect(originalPassRequests).toBe(0);
    const beforeAdvance = await page.request.get(
      `${apiUrl}/v1/presentation-sessions/${fixture.sessionId}`,
    );
    expect((await beforeAdvance.json()).snapshot.phase).toBe("lobby");

    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    for (const host of [page, otherHost]) {
      await expect(
        host.getByRole("heading", { name: fixture.diagnostic.prompt, exact: true }),
      ).toBeVisible();
    }
    expect(legacyAdvances).toHaveLength(1);
    expect(Object.keys(JSON.parse(legacyAdvances[0]!))).toEqual(["expectedRevision"]);
    await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    const picker = page.getByRole("region", { name: "Recovery Pack card actions", exact: true });
    await expect(picker.getByLabel("Recovery Pack card", { exact: true })).toBeDisabled();
    expect(originalPassRequests).toBe(0);
    expect(legacyAdvances).toHaveLength(2);

    await restorePass.click();
    await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
    await expect(restorePass).toHaveCount(0);
    expect(originalPassRequests).toBe(1);
    await picker
      .getByLabel("Recovery Pack card", { exact: true })
      .selectOption({ label: "1. Contrast two ratios · version 2" });
    await picker.getByRole("button", { name: "Explain with selected card", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Active Recovery Pack card", exact: true }),
    ).toContainText(fixture.cardBody);
    expect(legacyAdvances).toHaveLength(2);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
  } finally {
    await otherHostContext.close();
  }
}

test("Presentation host recovers a pass revoked by another browser", async ({
  page,
  browser,
}, testInfo) => {
  await rotatedHostPassWorkflow(page, browser, testInfo);
});

test("Presentation host recovers a revoked pass @mobile", async ({ page, browser }, testInfo) => {
  await rotatedHostPassWorkflow(page, browser, testInfo);
});
