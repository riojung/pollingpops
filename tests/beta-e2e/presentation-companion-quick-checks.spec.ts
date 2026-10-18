import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function quickCheckFixture(page: Page, timeMode: "timed" | "flex") {
  await signInBeta(page);
  const suffix = randomUUID().slice(0, 8);
  const created = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: `Quick Check destination ${suffix}`, description: "" },
  });
  expect(created.status()).toBe(201);
  let presentation = (await created.json()).presentation;
  const question = {
    id: randomUUID(),
    type: "single_select",
    prompt: `Prepared deck question ${suffix}`,
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["synthetic"],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 120,
    basePoints: 100,
    explanation: `Private deck rationale ${suffix}`,
    sourceCitations: [
      {
        sourceName: `Private source ${suffix}`,
        sourceDigest: "a".repeat(64),
        locator: "Fixture 1",
        excerpt: "Synthetic fixture excerpt.",
      },
    ],
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: randomUUID(), label: "Prepared option one", isCorrect: true },
      { id: randomUUID(), label: "Prepared option two", isCorrect: false },
    ],
  };
  const saved = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
    data: {
      draft: { ...presentation.draft, blocks: [{ id: randomUUID(), kind: "question", question }] },
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status()).toBe(200);
  presentation = (await saved.json()).presentation;
  const published = await page.request.post(
    `${apiUrl}/v1/presentations/${presentation.id}/publish`,
    {
      data: { expectedDraftRevision: presentation.draftRevision },
    },
  );
  expect(published.status()).toBe(200);
  const version = (await published.json()).version;
  const createdSession = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
    data: { presentationId: presentation.id, timeMode },
  });
  expect(createdSession.status()).toBe(201);
  const { snapshot, controlToken } = await createdSession.json();
  await page.evaluate(
    ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
    { id: snapshot.sessionId, token: controlToken },
  );
  return { presentation, version, question, snapshot, prompt: `Which direction next ${suffix}?` };
}

async function quickCheckWorkflow(page: Page, browser: Browser, testInfo: TestInfo) {
  test.setTimeout(120_000);
  const timeMode = testInfo.project.use.isMobile ? "flex" : "timed";
  const fixture = await quickCheckFixture(page, timeMode);
  const sessionId = fixture.snapshot.sessionId;
  await page.goto(`/presentation-session/${sessionId}/host`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Launch companion", exact: true }).click();
  const companion = await popup;
  await expect(companion.getByRole("heading", { name: "Presentation Companion" })).toBeVisible();
  const readPass = () =>
    companion.evaluate(
      (id) => sessionStorage.getItem(`openround:presentation-companion:${id}`),
      sessionId,
    );
  // The server-rendered heading can appear before hydration captures the launch pass.
  await expect
    .poll(async () => Boolean(await readPass()), {
      message: "The companion launch credential is persisted before recovery actions",
    })
    .toBe(true);
  const pass = await readPass();
  expect(pass).toBeTruthy();
  const scopedRequests: Array<Promise<Record<string, string>>> = [];
  companion.on("request", (request) => {
    if (new URL(request.url()).pathname.includes(`/presentation-sessions/${sessionId}/companion`))
      scopedRequests.push(request.allHeaders());
  });
  const frames: string[] = [];
  companion.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => frames.push(payload.toString())),
  );
  const commands: string[] = [];
  let ackId: string | null = null;
  let dropped = false;
  await companion.routeWebSocket(/\/socket\.io\//, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const match = message.toString().match(/^42(\d+)(\[.*)$/);
      if (match) {
        const [event, command] = JSON.parse(match[2]!);
        if (event === "presentation.command" && command.action === "insert_quick_check") {
          commands.push(JSON.stringify(command));
          if (ackId === null) ackId = match[1]!;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (!dropped && ackId !== null && message.toString().startsWith(`43${ackId}[`)) {
        dropped = true;
        return;
      }
      socket.send(message);
    });
  });
  await companion.reload();
  await expect(companion.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
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
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`/join?code=${fixture.snapshot.code}`);
    await guest.getByLabel("Nickname", { exact: true }).fill("Synthetic guest");
    await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
    await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);
    const open = companion.getByRole("button", { name: "Add Quick Check", exact: true });
    await expect(open).toBeEnabled();
    await open.focus();
    await open.press("Enter");
    const dialog = companion.getByRole("dialog", { name: "Session-only Quick Check", exact: true });
    await expect(dialog).toBeVisible();
    expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
    await companion.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(open).toBeFocused();
    await open.click();
    await dialog
      .getByRole("textbox", { name: "Quick Check prompt", exact: true })
      .fill(fixture.prompt);
    await dialog.getByLabel("Choice 1", { exact: true }).fill("Explore evidence");
    await dialog.getByLabel("Choice 2", { exact: true }).fill("EXPLORE   EVIDENCE");
    await dialog.getByRole("button", { name: "Insert and start Quick Check", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Use different choices");
    expect(commands).toHaveLength(0);
    await dialog.getByLabel("Choice 2", { exact: true }).fill("Work an example");
    for (let index = 3; index <= 6; index++) {
      await dialog.getByRole("button", { name: "Add choice", exact: true }).click();
      await dialog.getByLabel(`Choice ${index}`, { exact: true }).fill(`Synthetic choice ${index}`);
    }
    await expect(dialog.getByRole("button", { name: "Add choice", exact: true })).toBeDisabled();
    for (let index = 6; index >= 3; index--)
      await dialog.getByRole("button", { name: `Remove choice ${index}`, exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Remove choice 1", exact: true }),
    ).toBeDisabled();
    if (timeMode === "timed")
      await dialog.getByLabel("Response time (seconds)", { exact: true }).fill("120");
    else {
      await expect(dialog.getByLabel("Response time (seconds)", { exact: true })).toHaveCount(0);
      await expect(dialog).toContainText("There is no response deadline");
    }
    // Closing and reopening does not discard an unsubmitted draft.
    await companion.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await open.click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Quick Check prompt", exact: true }),
    ).toHaveValue(fixture.prompt);
    await dialog.getByRole("button", { name: "Insert and start Quick Check", exact: true }).click();
    await expect(guest.getByRole("heading", { name: fixture.prompt, exact: true })).toBeVisible();
    const retry = dialog.getByRole("button", {
      name: "Retry Quick Check acknowledgement",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    expect(dropped).toBe(true);
    expect(commands).toHaveLength(1);
    // A broadcast changes capability to false but cannot stand in for acknowledgement.
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Quick Check prompt", exact: true }),
    ).toBeDisabled();
    await retry.click();
    await expect(dialog).not.toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(commands[1]);
    const command = JSON.parse(commands[0]!);
    expect(command.quickCheck).toEqual({
      prompt: fixture.prompt,
      choices: ["Explore evidence", "Work an example"],
      timeLimitSeconds: timeMode === "timed" ? 120 : 30,
    });
    await expect(open).toBeDisabled();
    const beforeReveal = await companion.request.get(
      `${apiUrl}/v1/presentation-sessions/${sessionId}/companion?includeQuickChecks=true`,
      {
        headers: { authorization: `Bearer ${pass}` },
      },
    );
    expect(beforeReveal.status()).toBe(200);
    const operational = (await beforeReveal.json()).snapshot;
    expect(operational).toMatchObject({
      canInsertQuickCheck: false,
      resultSummary: null,
      settings: { timeMode },
    });
    expect(operational.questionClosesAt === null).toBe(timeMode === "flex");
    if (timeMode === "flex")
      await expect(guest.getByRole("status").filter({ hasText: /No countdown/ })).toBeVisible();
    expect(await guest.locator("body").innerText()).not.toContain(fixture.question.explanation);
    expect(JSON.stringify(operational)).not.toContain(fixture.question.prompt);
    expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
    await guest.getByRole("button", { name: "Work an example", exact: true }).click();
    await guest.getByRole("button", { name: "Submit response", exact: true }).click();
    await expect(
      guest.getByText("Response saved. You can stay here while the facilitator continues."),
    ).toBeVisible();
    await companion.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    await companion.getByRole("button", { name: "Show results", exact: true }).click();
    const results = companion.getByRole("dialog", { name: "Response summary", exact: true });
    await expect(results).toContainText("Work an example");
    await expect(results).not.toContainText("Synthetic guest");
    expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
    expect(await companion.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await companion.keyboard.press("Escape");
    await companion.reload();
    await expect(open).toBeDisabled();
    await companion.getByRole("button", { name: "Continue Presentation", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: fixture.question.prompt, exact: true }),
    ).toBeVisible();
    await companion.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    await companion.getByRole("button", { name: "Continue Presentation", exact: true }).click();
    await expect(
      companion.getByRole("button", { name: "Presentation finished", exact: true }),
    ).toBeDisabled();
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${apiUrl}/v1/presentation-sessions/${sessionId}/report?includeQuickChecks=true`,
        );
        return (await response.json()).report?.evidence?.[0]?.sessionOnly;
      })
      .toBe("quick_check");
    const report = (
      await (
        await page.request.get(
          `${apiUrl}/v1/presentation-sessions/${sessionId}/report?includeQuickChecks=true`,
        )
      ).json()
    ).report;
    expect(report.schemaVersion).toBe(3);
    expect(report.evidence).toHaveLength(2);
    expect(report.evidence[0]).toMatchObject({
      sessionOnly: "quick_check",
      respondents: 1,
      correct: null,
      accuracyPercent: null,
      totalScore: 0,
    });
    expect(report.recovery).toEqual([]);
    const retained = (
      await (await page.request.get(`${apiUrl}/v1/presentations/${fixture.presentation.id}`)).json()
    ).presentation;
    expect(retained.draft).toEqual(fixture.presentation.draft);
    expect(retained.draftRevision).toBe(fixture.presentation.draftRevision);
    expect(retained.currentVersionId).toBe(fixture.version.id);
    const freshSession = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
      data: { presentationId: fixture.presentation.id, timeMode },
    });
    expect(freshSession.status()).toBe(201);
    expect((await freshSession.json()).snapshot).toMatchObject({
      presentationVersionId: fixture.version.id,
      blockCount: 1,
    });
    for (const forbidden of [
      '"isCorrect":',
      '"correctChoiceIds":',
      '"participants":',
      fixture.question.explanation,
      fixture.question.sourceCitations[0]!.sourceName,
    ])
      expect(frames.some((frame) => frame.includes(forbidden))).toBe(false);
    const headers = await Promise.all(scopedRequests);
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((request) => !request.cookie)).toBe(true);
    await page.goto(`/presentation-session/${sessionId}/report`);
    await expect(
      page.getByText("Session-only Quick Check · unscored", { exact: true }),
    ).toBeVisible();
  } finally {
    await guestContext.close();
    await companion.close();
  }
}

test("Companion timed Quick Check recovers exact acknowledgement and stays unscored", async ({
  page,
  browser,
}, testInfo) => {
  await quickCheckWorkflow(page, browser, testInfo);
});
test("Companion flex Quick Check is accessible and preserves the draft @mobile", async ({
  page,
  browser,
}, testInfo) => {
  await quickCheckWorkflow(page, browser, testInfo);
});
