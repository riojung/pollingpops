import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function fixture(page: Page, timeMode: "timed" | "flex") {
  await signInBeta(page);
  const suffix = randomUUID().slice(0, 8);
  const question = {
    id: randomUUID(),
    type: "single_select",
    prompt: `Standalone source checkpoint ${suffix}`,
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["synthetic"],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 120,
    basePoints: 100,
    explanation: `Private source explanation ${suffix}`,
    mediaId: null,
    mediaAlt: null,
    choices: [
      {
        id: randomUUID(),
        label: "Synthetic correct option",
        isCorrect: true,
        feedback: `Private feedback ${suffix}`,
      },
      {
        id: randomUUID(),
        label: "Synthetic alternative",
        isCorrect: false,
        misconceptionKey: "private.misconception",
      },
    ],
  };
  const sourceTitle = `Published Round source ${suffix}`;
  const sourceCreated = await page.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: sourceTitle },
  });
  expect(sourceCreated.status()).toBe(201);
  let source = (await sourceCreated.json()).quiz;
  const sourceDraft = { title: sourceTitle, description: "", questions: [question] };
  const sourceSaved = await page.request.patch(`${apiUrl}/v1/quizzes/${source.id}`, {
    data: { expectedDraftRevision: source.draftRevision, draft: sourceDraft },
  });
  expect(sourceSaved.status()).toBe(200);
  source = (await sourceSaved.json()).quiz;
  const sourcePublished = await page.request.post(`${apiUrl}/v1/quizzes/${source.id}/publish`, {
    data: { expectedDraftRevision: source.draftRevision },
  });
  expect(sourcePublished.status()).toBe(200);
  const sourceVersion = (await sourcePublished.json()).version;
  const created = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: `Standalone destination ${suffix}`, description: "" },
  });
  expect(created.status()).toBe(201);
  let presentation = (await created.json()).presentation;
  const deckQuestion = {
    ...question,
    id: randomUUID(),
    prompt: `Prepared destination checkpoint ${suffix}`,
  };
  const saved = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
    data: {
      draft: {
        ...presentation.draft,
        blocks: [{ id: randomUUID(), kind: "question", question: deckQuestion }],
      },
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status()).toBe(200);
  presentation = (await saved.json()).presentation;
  const published = await page.request.post(
    `${apiUrl}/v1/presentations/${presentation.id}/publish`,
    { data: { expectedDraftRevision: presentation.draftRevision } },
  );
  expect(published.status()).toBe(200);
  const version = (await published.json()).version;
  const session = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
    data: { presentationId: presentation.id, timeMode },
  });
  expect(session.status()).toBe(201);
  const { snapshot, controlToken } = await session.json();
  await page.evaluate(
    ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
    { id: snapshot.sessionId, token: controlToken },
  );
  return {
    source,
    sourceDraft,
    sourceVersion,
    sourceTitle,
    presentation,
    version,
    question,
    deckQuestion,
    snapshot,
  };
}

async function workflow(page: Page, browser: Browser, testInfo: TestInfo) {
  test.setTimeout(120_000);
  const timeMode = testInfo.project.use.isMobile ? "flex" : "timed";
  const data = await fixture(page, timeMode);
  const sessionId = data.snapshot.sessionId;
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
  const headers: Array<Promise<Record<string, string>>> = [];
  companion.on("request", (request) => {
    if (new URL(request.url()).pathname.includes(`/presentation-sessions/${sessionId}/companion`))
      headers.push(request.allHeaders());
  });
  const frames: string[] = [];
  companion.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => frames.push(payload.toString())),
  );
  const commands: string[] = [];
  let acknowledgementId: string | null = null;
  let dropped = false;
  await companion.routeWebSocket(/\/socket\.io\//, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const match = message.toString().match(/^42(\d+)(\[.*)$/);
      if (match) {
        const [event, command] = JSON.parse(match[2]!);
        if (event === "presentation.command" && command.action === "insert_published_question") {
          commands.push(JSON.stringify(command));
          if (acknowledgementId === null) acknowledgementId = match[1]!;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (
        !dropped &&
        acknowledgementId !== null &&
        message.toString().startsWith(`43${acknowledgementId}[`)
      ) {
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
    await guest.goto(`/join?code=${data.snapshot.code}`);
    await guest.getByLabel("Nickname", { exact: true }).fill("Synthetic guest");
    await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
    await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);
    const open = companion.getByRole("button", { name: "Add published question", exact: true });
    await expect(open).toBeEnabled();
    await open.focus();
    await open.press("Enter");
    const dialog = companion.getByRole("dialog", {
      name: "Published Round questions",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Insert and start question", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("searchbox", { name: "Search published questions", exact: true })
      .fill(data.sourceTitle);
    await dialog.getByRole("button", { name: "Search questions", exact: true }).click();
    await expect(dialog.getByLabel("Published Round", { exact: true })).toBeEnabled();
    await dialog.getByLabel("Published Round", { exact: true }).selectOption(data.sourceVersion.id);
    await dialog.getByLabel("Published question", { exact: true }).selectOption(data.question.id);
    await expect(
      dialog.getByRole("button", { name: "Insert and start question", exact: true }),
    ).toBeEnabled();
    await expect(dialog).not.toContainText(data.question.explanation);
    await expect(dialog).not.toContainText(data.question.choices[0]!.feedback!);
    expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
    expect(await companion.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await companion.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(open).toBeFocused();
    await open.click();
    await dialog
      .getByRole("searchbox", { name: "Search published questions", exact: true })
      .fill(data.sourceTitle);
    await dialog.getByRole("button", { name: "Search questions", exact: true }).click();
    await dialog.getByLabel("Published Round", { exact: true }).selectOption(data.sourceVersion.id);
    await dialog.getByLabel("Published question", { exact: true }).selectOption(data.question.id);
    // A newer publish must not change the explicit version already selected in the catalog.
    const laterDraft = {
      ...data.sourceDraft,
      questions: [
        { ...data.question, prompt: "Later version must not replace the selected snapshot" },
      ],
    };
    const laterSaved = await page.request.patch(`${apiUrl}/v1/quizzes/${data.source.id}`, {
      data: { expectedDraftRevision: data.source.draftRevision, draft: laterDraft },
    });
    expect(laterSaved.status()).toBe(200);
    const laterSource = (await laterSaved.json()).quiz;
    expect(
      (
        await page.request.post(`${apiUrl}/v1/quizzes/${data.source.id}/publish`, {
          data: { expectedDraftRevision: laterSource.draftRevision },
        })
      ).status(),
    ).toBe(200);
    await dialog.getByRole("button", { name: "Insert and start question", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: data.question.prompt, exact: true }),
    ).toBeVisible();
    const retry = dialog.getByRole("button", {
      name: "Retry published question acknowledgement",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    expect(dropped).toBe(true);
    expect(commands).toHaveLength(1);
    await expect(dialog).toBeVisible();
    // Remove the source after acceptance; frozen content and exact receipt recovery remain valid.
    expect(
      (
        await page.request.post(`${apiUrl}/v1/quizzes/${data.source.id}/archive`, { data: {} })
      ).status(),
    ).toBe(200);
    expect((await page.request.delete(`${apiUrl}/v1/quizzes/${data.source.id}`)).status()).toBe(
      204,
    );
    await retry.click();
    await expect(dialog).not.toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(commands[1]);
    expect(JSON.parse(commands[0]!).publishedQuestion).toEqual({
      sourceQuizVersionId: data.sourceVersion.id,
      sourceQuestionId: data.question.id,
      contentHash: data.sourceVersion.contentHash,
    });
    await expect(open).toBeDisabled();
    const operationalResponse = await companion.request.get(
      `${apiUrl}/v1/presentation-sessions/${sessionId}/companion?includeQuickChecks=true&includePublishedQuestions=true`,
      { headers: { authorization: `Bearer ${pass}` } },
    );
    expect(operationalResponse.status()).toBe(200);
    const operational = (await operationalResponse.json()).snapshot;
    expect(operational).toMatchObject({
      canInsertPublishedQuestion: false,
      resultSummary: null,
      settings: { timeMode },
      blockCount: 2,
    });
    expect(operational.questionClosesAt === null).toBe(timeMode === "flex");
    if (timeMode === "flex")
      await expect(guest.getByRole("status").filter({ hasText: /No countdown/ })).toBeVisible();
    for (const privateText of [
      data.question.explanation,
      data.question.choices[0]!.feedback!,
      "private.misconception",
    ])
      expect(JSON.stringify(operational)).not.toContain(privateText);
    expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
    await guest.getByRole("button", { name: "Synthetic correct option", exact: true }).click();
    await guest.getByRole("button", { name: "Submit response", exact: true }).click();
    await expect(
      guest.getByText("Response saved. You can stay here while the facilitator continues."),
    ).toBeVisible();
    await companion.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    await companion.getByRole("button", { name: "Show results", exact: true }).click();
    const results = companion.getByRole("dialog", { name: "Response summary", exact: true });
    await expect(results).toContainText("Synthetic correct option");
    await expect(results).not.toContainText("Synthetic guest");
    expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
    await companion.keyboard.press("Escape");
    await expect(results).not.toBeVisible();
    await companion.reload();
    await expect(
      companion.getByRole("button", { name: "Continue Presentation", exact: true }),
    ).toBeEnabled();
    await companion.getByRole("button", { name: "Continue Presentation", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: data.deckQuestion.prompt, exact: true }),
    ).toBeVisible();
    await companion.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    await companion.getByRole("button", { name: "Continue Presentation", exact: true }).click();
    await expect(
      companion.getByRole("button", { name: "Presentation finished", exact: true }),
    ).toBeDisabled();
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`${apiUrl}/v1/presentation-sessions/${sessionId}/report`)
            ).json()
          ).reportStatus,
      )
      .toBe("ready");
    const report = (
      await (
        await page.request.get(`${apiUrl}/v1/presentation-sessions/${sessionId}/report`)
      ).json()
    ).report;
    expect(report.evidence).toHaveLength(2);
    expect(report.evidence[0]).toMatchObject({
      prompt: data.question.prompt,
      respondents: 1,
      correct: 1,
      accuracyPercent: 100,
    });
    if (timeMode === "flex") expect(report.evidence[0].totalScore).toBe(100);
    else {
      // The deliberately lost acknowledgement delays the answer; timed scoring remains unchanged.
      expect(report.evidence[0].totalScore).toBeGreaterThan(0);
      expect(report.evidence[0].totalScore).toBeLessThanOrEqual(100);
    }
    expect(report.recovery).toEqual([]);
    const retained = (
      await (await page.request.get(`${apiUrl}/v1/presentations/${data.presentation.id}`)).json()
    ).presentation;
    expect(retained.draft).toEqual(data.presentation.draft);
    expect(retained.currentVersionId).toBe(data.version.id);
    const fresh = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
      data: { presentationId: data.presentation.id, timeMode },
    });
    expect(fresh.status()).toBe(201);
    expect((await fresh.json()).snapshot.blockCount).toBe(1);
    for (const secret of [
      '"isCorrect":',
      '"correctChoiceIds":',
      '"participants":',
      data.question.explanation,
      data.question.choices[0]!.feedback!,
      "private.misconception",
    ])
      expect(frames.some((frame) => frame.includes(secret))).toBe(false);
    const sentHeaders = await Promise.all(headers);
    expect(sentHeaders.length).toBeGreaterThan(0);
    expect(sentHeaders.every((request) => !request.cookie)).toBe(true);
    await page.goto(`/presentation-session/${sessionId}/report`);
    await expect(page.getByText(data.question.prompt, { exact: true })).toBeVisible();
  } finally {
    await guestContext.close();
    await companion.close();
  }
}

test("Companion freezes a standalone published question and recovers its acknowledgement", async ({
  page,
  browser,
}, testInfo) => {
  await workflow(page, browser, testInfo);
});
test("Companion published question picker is accessible in flex rooms @mobile", async ({
  page,
  browser,
}, testInfo) => {
  await workflow(page, browser, testInfo);
});
