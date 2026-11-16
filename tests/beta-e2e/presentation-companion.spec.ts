import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function companionSession(page: Page) {
  await signInBeta(page);
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();
  const suffix = randomUUID().slice(0, 8);
  const created = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: `Companion fixture ${suffix}`, description: "" },
  });
  expect(created.status()).toBe(201);
  const presentation = (await created.json()).presentation;
  const choiceIds = [randomUUID(), randomUUID()];
  const question = {
    id: randomUUID(),
    type: "single_select",
    prompt: `Synthetic companion check ${suffix}`,
    choices: choiceIds.map((id, index) => ({
      id,
      label: `Option ${index + 1}`,
      isCorrect: index === 0,
    })),
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["synthetic"],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 120,
    basePoints: 100,
    explanation: `Private explanation ${suffix}`,
    sourceCitations: [
      {
        sourceName: `Private citation ${suffix}`,
        sourceDigest: "a".repeat(64),
        locator: "Fixture 1",
        excerpt: "Synthetic fixture excerpt.",
      },
    ],
    mediaId: null,
    mediaAlt: null,
  };
  const blockId = randomUUID();
  const saved = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
    data: {
      draft: { ...presentation.draft, blocks: [{ id: blockId, kind: "question", question }] },
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status()).toBe(200);
  const published = await page.request.post(
    `${apiUrl}/v1/presentations/${presentation.id}/publish`,
    {
      data: { expectedDraftRevision: (await saved.json()).presentation.draftRevision },
    },
  );
  expect(published.status()).toBe(200);
  const session = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
    data: { presentationId: presentation.id },
  });
  expect(session.status()).toBe(201);
  const { snapshot, controlToken } = await session.json();
  const sessionId = snapshot.sessionId;
  await page.evaluate(
    ({ sessionId, controlToken }) =>
      sessionStorage.setItem(`openround:presentation-host:${sessionId}`, controlToken),
    { sessionId, controlToken },
  );
  return { sessionId, question, choiceIds, code: snapshot.code, controlToken };
}

async function companionWorkflow(page: Page, browser: Browser, testInfo: TestInfo) {
  test.setTimeout(120_000);
  const fixture = await companionSession(page);
  await page.goto(`/presentation-session/${fixture.sessionId}/host`);
  const launch = page.getByRole("button", { name: "Launch companion", exact: true });
  await expect(launch).toBeEnabled();
  const popupPromise = page.waitForEvent("popup");
  await launch.click();
  const companion = await popupPromise;
  const scopedRequests: Array<Promise<{ url: string; cookie?: string }>> = [];
  companion.on("request", (request) => {
    if (
      /^\/v1\/presentation-sessions\/[^/]+\/companion(?:-command)?$/.test(
        new URL(request.url()).pathname,
      )
    ) {
      scopedRequests.push(
        request.allHeaders().then((headers) => ({ url: request.url(), cookie: headers.cookie })),
      );
    }
  });
  const companionFrames: string[] = [];
  companion.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => companionFrames.push(payload.toString())),
  );
  await expect(companion.getByRole("heading", { name: "Presentation Companion" })).toBeVisible();
  await expect(companion).toHaveURL(`/presentation-session/${fixture.sessionId}/companion`);
  const pass = await companion.evaluate(
    (sessionId) => sessionStorage.getItem(`openround:presentation-companion:${sessionId}`),
    fixture.sessionId,
  );
  expect(pass).toBeTruthy();
  expect(pass).not.toBe(fixture.controlToken);
  expect(
    await companion.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith("openround:presentation-host:")),
    ),
  ).toEqual([]);
  await companion.reload();
  await expect(companion.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
  expect(companion.url()).not.toContain("#");
  expect(await companion.evaluate(() => location.search)).toBe("");
  const joinDetails = companion.getByRole("button", { name: "Show join details", exact: true });
  await joinDetails.focus();
  await joinDetails.press("Enter");
  const joinDialog = companion.getByRole("dialog", { name: "Join this Presentation" });
  await expect(joinDialog).toContainText(fixture.code);
  expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
  await companion.keyboard.press("Escape");
  await expect(joinDialog).not.toBeVisible();
  await expect(joinDetails).toBeFocused();

  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const guestContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    reducedMotion: "reduce",
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });
  const guest = await guestContext.newPage();
  try {
    await guest.goto(`/join?code=${fixture.code}`);
    await expect(
      guest.getByRole("heading", { name: "Join a Presentation", exact: true }),
    ).toBeVisible();
    await guest.getByLabel("Nickname", { exact: true }).fill("Synthetic guest");
    await guest.getByRole("button", { name: "Join presentation", exact: true }).click();
    await expect(guest).toHaveURL(`/presentation-session/${fixture.sessionId}/play`);

    // Lose an authoritative acknowledgement, not its accepted state or broadcast. The retry
    // must settle the original intent even though the current phase has already changed.
    const commands: string[] = [];
    let dropAckId: string | null = null;
    let droppedAck = false;
    await companion.routeWebSocket(/\/socket\.io\//, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        const match = message.toString().match(/^42(\d+)(\[.*)$/);
        if (match) {
          const [event, command] = JSON.parse(match[2]!);
          if (event === "presentation.command") {
            commands.push(JSON.stringify(command));
            if (dropAckId === null) dropAckId = match[1]!;
          }
        }
        server.send(message);
      });
      server.onMessage((message) => {
        if (!droppedAck && dropAckId !== null && message.toString().startsWith(`43${dropAckId}[`)) {
          droppedAck = true;
          return;
        }
        socket.send(message);
      });
    });
    await companion.reload();
    await expect(companion.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
    await expect(companion.getByRole("button", { name: "Show results", exact: true })).toHaveCount(
      0,
    );
    await companion.getByRole("button", { name: "Start Presentation", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: fixture.question.prompt, exact: true }),
    ).toBeVisible();
    const retry = companion.getByRole("button", {
      name: "Retry advance acknowledgement",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    expect(droppedAck).toBe(true);
    expect(commands).toHaveLength(1);
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(commands[1]);
    await expect(
      companion.getByRole("button", { name: "Reveal and close question", exact: true }),
    ).toBeEnabled();
    await guest.getByRole("button", { name: "Option 2", exact: true }).click();
    await guest.getByRole("button", { name: "Submit response", exact: true }).click();
    await expect(
      guest.getByText("Response saved. You can stay here while the facilitator continues."),
    ).toBeVisible();
    const beforeReveal = await companion.request.get(
      `${apiUrl}/v1/presentation-sessions/${fixture.sessionId}/companion`,
      {
        headers: { authorization: `Bearer ${pass}` },
      },
    );
    expect(beforeReveal.status()).toBe(200);
    const operational = (await beforeReveal.json()).snapshot;
    expect(operational.roomStatus).toMatchObject({ joinedCount: 1, responseCount: 1 });
    expect(operational.resultSummary).toBeNull();
    await expect(companion.getByRole("button", { name: "Show results", exact: true })).toHaveCount(
      0,
    );
    await companion.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    const results = companion.getByRole("button", { name: "Show results", exact: true });
    await expect(results).toBeEnabled();
    await results.focus();
    await results.press("Enter");
    const resultDialog = companion.getByRole("dialog", { name: "Response summary" });
    await expect(resultDialog).toContainText("Option 2");
    await expect(resultDialog).not.toContainText("Synthetic guest");
    await expect(resultDialog).not.toContainText(fixture.question.explanation);
    await expect(resultDialog).not.toContainText(fixture.question.sourceCitations[0]!.sourceName);
    expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
    expect(await companion.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await companion.getByRole("button", { name: "Return to deck", exact: true }).click();
    await expect(resultDialog).not.toBeVisible();
    await expect(results).toBeFocused();
    for (const forbidden of [
      '"controlToken":',
      '"participants":',
      '"nickname":',
      '"isCorrect":',
      '"correctChoiceIds":',
      fixture.question.explanation,
      fixture.question.sourceCitations[0]!.sourceName,
    ]) {
      expect(companionFrames.some((frame) => frame.includes(forbidden))).toBe(false);
    }
    const capturedRequests = await Promise.all(scopedRequests);
    expect(capturedRequests.length).toBeGreaterThan(0);
    expect(
      capturedRequests.every((request) => !request.cookie && !request.url.includes(pass!)),
    ).toBe(true);
    await page.getByRole("button", { name: "Revoke companion pass", exact: true }).click();
    await expect(
      companion.getByText(
        "This companion pass has expired or was revoked. Launch a new companion from the host.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      companion.getByRole("button", {
        name: /Finish Presentation|Next block|Continue Presentation|Retry advance acknowledgement/,
      }),
    ).toHaveCount(0);
    expect(
      await companion.evaluate(
        (sessionId) => sessionStorage.getItem(`openround:presentation-companion:${sessionId}`),
        fixture.sessionId,
      ),
    ).toBeNull();
    const revoked = await companion.request.get(
      `${apiUrl}/v1/presentation-sessions/${fixture.sessionId}/companion`,
      {
        headers: { authorization: `Bearer ${pass}` },
      },
    );
    expect(revoked.status()).toBe(401);
    // The companion pass never rotated/revoked host authority.
    await expect(
      page.getByRole("button", { name: "Finish Presentation", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
  } finally {
    await guestContext.close();
    await companion.close();
  }
}

test("Companion launch, scoped controls, lost acknowledgement, safe overlays and revocation", async ({
  page,
  browser,
}, testInfo) => {
  await companionWorkflow(page, browser, testInfo);
});
test("Companion keyboard overlays, reload and control recovery @mobile", async ({
  page,
  browser,
}, testInfo) => {
  await companionWorkflow(page, browser, testInfo);
});
