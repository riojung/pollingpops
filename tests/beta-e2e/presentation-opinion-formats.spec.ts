import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import type {
  InteractiveQuestionBlockDraft,
  PresentationHostSnapshot,
  PresentationOpinionResultSummary,
  PresentationParticipantSnapshot,
  PresentationResponseSubmit,
  PresentationStagePassResponse,
  QuestionDraft,
} from "../../packages/contracts/src/index.ts";
import {
  clickNavigatorAction,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
  selectE01Block,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
const pollLabels = ["=SUM(1,2)", 'Examples, "live"', "Discussion", "Practice"];
const rankLabels = ["Examples", "Practice", "Discussion", "Feedback", "Templates", "Coaching"];
const privateMarker = "PRIVATE E04";

function questionBlock(
  type: "poll" | "ranking" | "single_select",
  prompt: string,
  labels = rankLabels,
): InteractiveQuestionBlockDraft {
  return {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type,
      prompt,
      choices: labels.map((label, index) => ({
        id: randomUUID(),
        label,
        isCorrect: type === "single_select" && index === 0,
      })),
      purpose: type === "single_select" ? "diagnostic" : "opinion",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 300,
      basePoints: type === "single_select" ? 1000 : 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
      sourceCitations: [
        {
          sourceName: `${privateMarker} source`,
          sourceDigest: "a".repeat(64),
          locator: `${privateMarker} locator`,
          excerpt: `${privateMarker} excerpt`,
        },
      ],
    },
  };
}

async function contextFor(browser: Browser, host: Page, info: TestInfo) {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
  return browser.newContext({
    baseURL: new URL(host.url()).origin,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
}

async function participant(page: Page, code: string, nickname: string) {
  await page.goto(`/join?code=${code}`);
  await page.getByLabel("Nickname", { exact: true }).fill(nickname);
  await page.getByRole("button", { name: "Join presentation", exact: true }).click();
  await expect(page).toHaveURL(/\/presentation-session\/[^/]+\/play$/);
}

async function observeResponses(page: Page, dropAcknowledgement = false) {
  const submissions: PresentationResponseSubmit[] = [];
  let dropped = false;
  let acknowledgementId: string | undefined;
  let release: (() => void) | undefined;
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const match = message.toString().match(/^42(\d+)(\[.*)$/);
      if (match) {
        const [event, input] = JSON.parse(match[2]!);
        if (event === "presentation.response.submit") {
          submissions.push(input);
          if (dropAcknowledgement && !dropped) acknowledgementId = match[1]!;
          if (dropAcknowledgement && submissions.length === 1) {
            release = () => server.send(message);
            return;
          }
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const wire = message.toString();
      if (dropAcknowledgement && !dropped && acknowledgementId) {
        if (wire.startsWith(`43${acknowledgementId}[`)) {
          dropped = true;
          socket.close({ code: 1012, reason: "Synthetic lost acknowledgement" });
          return;
        }
        if (wire.includes('"responseReceipt"') && wire.includes('"responseSubmitted":true')) return;
      }
      socket.send(message);
    });
  });
  return { submissions, dropped: () => dropped, release: () => release?.() };
}

async function snapshot(
  page: Page,
  sessionId: string,
  role: "host" | "participant" | "stage" | "companion",
) {
  const token =
    role === "host"
      ? null
      : await page.evaluate(
          ({ id, role }) => sessionStorage.getItem(`openround:presentation-${role}:${id}`),
          { id: sessionId, role },
        );
  if (role !== "host") expect(Boolean(token)).toBe(true);
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${sessionId}${role === "host" ? "" : `/${role}`}`,
    { ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) },
  );
  expect(response.status()).toBe(200);
  const value = (await response.json()).snapshot;
  if (role !== "host") {
    expect(JSON.stringify(value)).not.toMatch(
      /PRIVATE E04|HIDDEN E04|AUTHOR-ONLY|"isCorrect"|"sourceCitations"|"speakerNotes"/,
    );
    expect(value).not.toHaveProperty("participants");
  }
  return value;
}

async function expectSaved(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await expect(
    page.getByText("Response saved. You can stay here while the facilitator continues.", {
      exact: true,
    }),
  ).toBeVisible();
}

async function expectNoOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    path: location.pathname,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    offenders: Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          classes: element.getAttribute("class") ?? "",
          right: Math.round(bounds.right * 100) / 100,
          overflowX: style.overflowX,
        };
      })
      .filter((element) => element.right > innerWidth + 1)
      .slice(0, 12),
  }));
  expect(geometry.scrollWidth <= geometry.innerWidth + 1, JSON.stringify(geometry)).toBe(true);
}

async function hostSession(page: Page, recordId: string) {
  const latest = await readE01Record(page, recordId);
  expect(
    (
      await page.request.post(`${e01ApiUrl}/v1/presentations/${recordId}/publish`, {
        data: { expectedDraftRevision: latest.draftRevision },
      })
    ).status(),
  ).toBe(200);
  const response = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
    data: { presentationId: recordId, timeMode: "flex" },
  });
  expect(response.status()).toBe(201);
  const { snapshot, controlToken } = await response.json();
  await page.evaluate(
    ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
    { id: snapshot.sessionId, token: controlToken },
  );
  return snapshot as PresentationHostSnapshot;
}

async function expectClosedResults(
  page: Page,
  kind: "poll" | "ranking",
  label: string,
  values: string[],
) {
  const region = page.getByRole("region", { name: "Opinion results", exact: true });
  await expect(
    region.getByRole("heading", {
      name: kind === "poll" ? "Poll results" : "Ranking results",
      exact: true,
    }),
  ).toBeVisible();
  await expect(region).toContainText("2 respondents");
  const table = region.getByRole("table", {
    name: kind === "poll" ? "Poll selections by choice" : "Ranking results by choice",
    exact: true,
  });
  const row = table
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
  await expect(row.getByRole("cell")).toHaveText(values);
  expect(await region.innerText()).not.toMatch(/PRIVATE E04|Opinion guest/);
}

for (const suffix of ["", " @mobile"]) {
  test(`Presentation opinion formats opt in, freeze, reveal anonymous results and export evidence${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    info.annotations.push({
      type: "emulation",
      description:
        "Browser desktop/phone profiles and separate stage tabs are emulated; this does not verify physical screen sharing.",
    });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const id = randomUUID().slice(0, 8);
    const blocks = [
      questionBlock("poll", `Choose two directions ${id}`, pollLabels),
      questionBlock("single_select", `Rank all six directions ${id}`),
      questionBlock("single_select", `Rank three of six directions ${id}`),
    ];
    const rankingExplanation = "Use these preferences to choose the next practice activity.";
    blocks[1]!.question.explanation = rankingExplanation;
    const hidden = {
      ...e01Slide(`HIDDEN E04 planning ${id}`),
      hidden: true as const,
      speakerNotes: `${privateMarker} speaker cue`,
    };
    const record = await createE01Deck(page, [...blocks, hidden], 6);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    await page.getByRole("combobox", { name: "Maximum selections", exact: true }).selectOption("2");
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft.schemaVersion)
      .toBe(9);
    for (const [index, count] of [
      [1, "6"],
      [2, "3"],
    ] as const) {
      await selectE01Block(page, blocks[index]!.question.prompt, narrow);
      if (narrow) await page.getByRole("button", { name: "Open inspector", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Question type", exact: true })
        .selectOption("ranking");
      if (narrow) await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Choices to rank", exact: true })
        .selectOption(count);
      await expect(page.getByRole("checkbox", { name: /Mark choice/ })).toHaveCount(0);
      await expect(page.getByRole("radio", { name: /Mark choice/ })).toHaveCount(0);
    }
    await expect
      .poll(async () => {
        const saved = (await readE01Record(page, record.id)).draft;
        return saved.blocks
          .filter((block) => block.kind === "question")
          .map((block) => ({
            type: block.question.type,
            max: block.question.maxSelections,
            rank: block.question.rankCount,
          }));
      })
      .toEqual([
        { type: "poll", max: 2, rank: undefined },
        { type: "ranking", max: undefined, rank: 6 },
        { type: "ranking", max: undefined, rank: 3 },
      ]);
    const frozen = (await readE01Record(page, record.id)).draft;
    for (const block of frozen.blocks)
      if (block.kind === "question") {
        expect(block.question).toMatchObject({
          purpose: "opinion",
          confidence: "off",
          basePoints: 0,
          delivery: "main",
          linkedRecheckQuestionId: null,
        });
        if ("choices" in block.question)
          expect(block.question.choices.every((choice) => !choice.isCorrect)).toBe(true);
      }
    const lobby = await hostSession(page, record.id);
    const sessionId = lobby.sessionId;
    const latest = await readE01Record(page, record.id);
    const revised = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
      data: {
        draft: {
          ...latest.draft,
          blocks: latest.draft.blocks.map((block) =>
            block.kind === "question"
              ? { ...block, question: { ...block.question, prompt: "AUTHOR-ONLY revised opinion" } }
              : block,
          ),
        },
        expectedRevision: latest.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(revised.status()).toBe(200);
    expect(
      (
        await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/publish`, {
          data: { expectedDraftRevision: (await revised.json()).presentation.draftRevision },
        })
      ).status(),
    ).toBe(200);
    const firstContext = await contextFor(browser, page, info);
    const secondContext = await contextFor(browser, page, info);
    const stageContext = await contextFor(browser, page, info);
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    const firstWire = await observeResponses(first);
    const secondWire = await observeResponses(second);
    let companion: Page | undefined;
    try {
      await participant(first, lobby.code, "Opinion guest one");
      await participant(second, lobby.code, "Opinion guest two");
      await page.goto(`/presentation-session/${sessionId}/host`);
      const companionCreated = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Launch companion", exact: true }).click();
      companion = await companionCreated;
      await expect(
        companion.getByRole("heading", { name: "Presentation Companion", exact: true }),
      ).toBeVisible();
      const passResponse = await page.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/stage-pass`,
      );
      expect(passResponse.status()).toBe(201);
      const pass = (await passResponse.json()) as PresentationStagePassResponse;
      const stage = await stageContext.newPage();
      await stage.goto(
        `/presentation-session/${sessionId}/stage#pass=${encodeURIComponent(pass.stageToken)}`,
      );
      await expect(
        stage.getByRole("region", { name: "Join this Presentation", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      for (let blockIndex = 0; blockIndex < 3; blockIndex++) {
        const authored = frozen.blocks[blockIndex]!;
        if (authored.kind !== "question" || !("choices" in authored.question))
          throw new Error("Expected an opinion fixture");
        const question = authored.question;
        for (const audience of [first, second, stage]) {
          await expect(
            audience.getByRole("heading", { name: question.prompt, exact: true }),
          ).toBeVisible();
          await expect(
            audience.getByRole("region", { name: "Opinion results", exact: true }),
          ).toHaveCount(0);
          if (blockIndex === 1)
            await expect(audience.getByText(rankingExplanation, { exact: true })).toHaveCount(0);
        }
        for (const [target, role] of [
          [page, "host"],
          [first, "participant"],
          [stage, "stage"],
          [companion, "companion"],
        ] as const) {
          expect(await snapshot(target, sessionId, role)).not.toHaveProperty("opinionSummary");
        }
        if (blockIndex === 0) {
          for (const [guest, chosen] of [
            [first, [0, 1]],
            [second, [0, 2]],
          ] as const) {
            for (const index of chosen)
              await guest.getByRole("button", { name: pollLabels[index]!, exact: true }).click();
            await expect(
              guest.getByRole("button", { name: pollLabels[3]!, exact: true }),
            ).toBeDisabled();
            for (const index of chosen)
              await expect(
                guest.getByRole("button", { name: pollLabels[index]!, exact: true }),
              ).toHaveAttribute("aria-pressed", "true");
          }
        } else if (blockIndex === 1) {
          await first
            .getByRole("button", { name: "Move down: Examples", exact: true })
            .press("Enter");
          await expect(first.locator(".ranking-list li > strong")).toHaveText([
            "Practice",
            "Examples",
            ...rankLabels.slice(2),
          ]);
        } else {
          for (const [guest, choices] of [
            [first, ["Examples", "Practice", "Discussion"]],
            [second, ["Examples", "Practice", "Feedback"]],
          ] as const) {
            await expect(
              guest.getByRole("button", { name: "Submit response", exact: true }),
            ).toBeDisabled();
            for (const choice of choices)
              await guest
                .getByRole("button", { name: `Add ${choice} to ranking`, exact: true })
                .click();
            await expect(
              guest.getByRole("button", { name: "Add Coaching to ranking", exact: true }),
            ).toBeDisabled();
          }
          await first
            .getByRole("button", { name: "Move up: Discussion", exact: true })
            .press("Enter");
          await first
            .getByRole("button", { name: "Move up: Discussion", exact: true })
            .press("Enter");
        }
        for (const guest of [first, second]) {
          await expect(guest.getByText("Confidence", { exact: true })).toHaveCount(0);
          await guest.getByRole("button", { name: "Submit response", exact: true }).click();
          await expectSaved(guest);
          const accepted = (await snapshot(
            guest,
            sessionId,
            "participant",
          )) as PresentationParticipantSnapshot;
          expect(accepted.standing).toBeNull();
          expect(accepted.responseResult).toBeNull();
          expect(accepted).not.toHaveProperty("opinionSummary");
        }
        const firstInput = firstWire.submissions.at(-1)!;
        expect(firstInput.response).not.toHaveProperty("confidence");
        if (blockIndex === 0)
          expect(firstInput.response).toEqual({
            choiceIds: question.choices.slice(0, 2).map((choice) => choice.id),
          });
        else expect(firstInput.response).not.toHaveProperty("choiceIds");
        expect(secondWire.submissions.length).toBe(blockIndex + 1);
        await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
        const kind = blockIndex === 0 ? "poll" : "ranking";
        const values =
          blockIndex === 0
            ? ["2", "100%"]
            : blockIndex === 1
              ? ["11", "2", "1.5", "1", "1", "0", "0", "0", "0"]
              : ["11", "2", "1.5", "1", "1", "0"];
        for (const target of [page, first, stage])
          await expectClosedResults(
            target,
            kind,
            blockIndex === 0 ? pollLabels[0]! : rankLabels[0]!,
            values,
          );
        if (blockIndex > 0) {
          const canvas = stage.getByRole("region", { name: "Audience slide", exact: true });
          const rankingTable = canvas.getByRole("table", {
            name: "Ranking results by choice",
            exact: true,
          });
          expect(await canvas.evaluate((element) => element.scrollTop)).toBe(0);
          await expect(
            rankingTable.getByRole("columnheader", { name: "Weighted points", exact: true }),
          ).toBeInViewport({ ratio: 1 });
          await expect(rankingTable.getByRole("rowheader").first()).toBeInViewport({ ratio: 1 });
          const join = stage.getByRole("region", { name: "Join this Presentation", exact: true });
          await expect(join).toBeInViewport({ ratio: 1 });
          await expect(join.locator("svg")).toBeInViewport({ ratio: 1 });
          if (blockIndex === 1)
            await expect(canvas.getByText(rankingExplanation, { exact: true })).toBeVisible();
        }
        await companion.getByRole("button", { name: "Show results", exact: true }).click();
        await expectClosedResults(
          companion,
          kind,
          blockIndex === 0 ? pollLabels[0]! : rankLabels[0]!,
          values,
        );
        await companion.getByRole("button", { name: "Return to deck", exact: true }).click();
        const summary = (await snapshot(first, sessionId, "participant"))
          .opinionSummary as PresentationOpinionResultSummary;
        expect(summary.blockId).toBe(authored.id);
        if (summary.kind === "ranking" && blockIndex === 2) {
          expect(summary).toMatchObject({ rankCount: 3, totalRankings: 6 });
          expect(summary.choices[4]).toMatchObject({
            weightedScore: 0,
            rankedRespondents: 0,
            averageRank: null,
          });
        }
        await first.emulateMedia({ colorScheme: blockIndex === 0 ? "dark" : "light" });
        expect((await new AxeBuilder({ page: first }).analyze()).violations).toEqual([]);
        for (const target of [first, stage, companion]) await expectNoOverflow(target);
        if (blockIndex === 1) {
          for (const [role, target] of [
            ["host", page],
            ["stage", stage],
            ["participant", first],
          ] as const)
            await target.screenshot({
              path: info.outputPath(`opinion-ranking-${role}-${narrow ? "mobile" : "desktop"}.png`),
              fullPage: true,
            });
        }
        if (blockIndex < 2)
          await page.getByRole("button", { name: "Next block", exact: true }).click();
      }
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      expect(
        (
          await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${sessionId}/report`)
        ).status(),
      ).toBe(422);
      const reported = await page.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/report?includeSessionContext=true&includeQuickChecks=true&includeOpinionResults=true`,
      );
      expect(reported.status()).toBe(200);
      const report = (await reported.json()).report;
      expect(report).toMatchObject({ schemaVersion: 4, leaderboard: [], recovery: [] });
      for (const evidence of report.evidence)
        expect(evidence).toMatchObject({
          correct: null,
          accuracyPercent: null,
          totalScore: 0,
          respondents: 2,
        });
      await page.goto(`/presentation-session/${sessionId}/report`);
      await expect(page.getByRole("region", { name: "Opinion results", exact: true })).toHaveCount(
        3,
      );
      await expect(page.getByRole("heading", { name: "Leaderboard", exact: true })).toHaveCount(0);
      const rankingTables = page.getByRole("table", {
        name: "Ranking results by choice",
        exact: true,
      });
      await expect(rankingTables).toHaveCount(2);
      for (const table of await rankingTables.all()) {
        expect(
          await table
            .getByRole("columnheader", { name: "Weighted points", exact: true })
            .evaluate((header) => header.clientWidth),
        ).toBeGreaterThanOrEqual(60);
        expect(
          await table
            .getByRole("rowheader")
            .first()
            .evaluate((header) => header.clientWidth),
        ).toBeGreaterThanOrEqual(120);
      }
      if (narrow) {
        const tableGroups = page.getByRole("group", { name: "Opinion result table", exact: true });
        await expect(tableGroups).toHaveCount(3);
        await tableGroups.first().focus();
        for (let index = 1; index < 3; index++) {
          const group = tableGroups.nth(index);
          await page.keyboard.press("Tab");
          await expect(group).toBeFocused();
          expect(await group.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
            true,
          );
          await group.press("ArrowRight");
          await expect
            .poll(() => group.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
          await group.press("ArrowLeft");
          await expect.poll(() => group.evaluate((element) => element.scrollLeft)).toBe(0);
        }
      }
      await expectNoOverflow(page);
      const downloadCreated = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export evidence CSV", exact: true }).click();
      const download = await downloadCreated;
      expect(download.suggestedFilename()).toBe(`presentation-${sessionId}-evidence.csv`);
      const csv = await readFile((await download.path())!, "utf8");
      expect(csv).toContain('"percent_of_respondents"');
      expect(csv).toContain('"weighted_rank_points"');
      expect(csv).toContain('"\'=SUM(1,2)"');
      expect(csv).toContain('"Examples, ""live"""');
      expect(csv).toContain('"3","6","0","0",""');
      expect(csv).not.toMatch(/PRIVATE E04|HIDDEN E04|Opinion guest/);
      await page.screenshot({
        path: info.outputPath("opinion-v4-evidence-report.png"),
        fullPage: true,
      });
    } finally {
      await companion?.close();
      await Promise.all([firstContext.close(), secondContext.close(), stageContext.close()]);
    }
  });

  test(`Presentation opinion copies preserve scope and recover an ordered response after a lost acknowledgement${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(180_000);
    info.annotations.push({
      type: "emulation",
      description:
        "A controlled websocket acknowledgement loss and reconnect exercise production response recovery; browser phone profiles are emulated.",
    });
    await signInBeta(page);
    const suffixId = randomUUID().slice(0, 8);
    const ranking = questionBlock("ranking", `Copied top-three priorities ${suffixId}`).question;
    if (ranking.type !== "ranking") throw new Error("Expected ranking");
    ranking.rankCount = 3;
    const poll = questionBlock("poll", `Copied two-option poll ${suffixId}`, pollLabels).question;
    if (poll.type !== "poll") throw new Error("Expected poll");
    poll.maxSelections = 2;
    const text: QuestionDraft = {
      id: randomUUID(),
      type: "open_text",
      prompt: `Available moderated text ${suffixId}`,
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 300,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    const sourceTitle = `E04 published source ${suffixId}`;
    const created = await page.request.post(`${e01ApiUrl}/v1/quizzes`, {
      data: { title: sourceTitle },
    });
    expect(created.status()).toBe(201);
    let source = (await created.json()).quiz;
    const sourceDraft = { title: sourceTitle, description: "", questions: [ranking, poll, text] };
    const sourceSaved = await page.request.patch(`${e01ApiUrl}/v1/quizzes/${source.id}`, {
      data: { expectedDraftRevision: source.draftRevision, draft: sourceDraft },
    });
    expect(sourceSaved.status()).toBe(200);
    source = (await sourceSaved.json()).quiz;
    expect(
      (
        await page.request.post(`${e01ApiUrl}/v1/quizzes/${source.id}/publish`, {
          data: { expectedDraftRevision: source.draftRevision },
        })
      ).status(),
    ).toBe(200);
    const destination = await createE01Deck(page, [], 2);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, destination.id, narrow);
    await clickNavigatorAction(page, /From published Round/);
    const picker = page.getByRole("dialog", { name: "Insert from a published Round", exact: true });
    await picker
      .getByRole("combobox", { name: "Source Round", exact: true })
      .selectOption(source.id);
    const rankingCopy = picker.getByRole("checkbox", { name: new RegExp(ranking.prompt) });
    const pollCopy = picker.getByRole("checkbox", { name: new RegExp(poll.prompt) });
    await expect(rankingCopy).toBeEnabled();
    await expect(pollCopy).toBeEnabled();
    const textCopy = picker.getByRole("checkbox", { name: new RegExp(text.prompt) });
    await expect(textCopy).toBeEnabled();
    await expect(textCopy).not.toBeChecked();
    await rankingCopy.check();
    await pollCopy.check();
    const copiedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${destination.id}/blocks/import`,
    );
    await picker.getByRole("button", { name: "Insert 2", exact: true }).click();
    expect((await copiedResponse).status()).toBe(200);
    await expect(picker).toHaveCount(0);
    const copied = (await readE01Record(page, destination.id)).draft;
    expect(copied.schemaVersion).toBe(9);
    expect(copied.blocks).toHaveLength(2);
    for (const [index, block] of copied.blocks.entries()) {
      if (block.kind !== "question" || !("choices" in block.question))
        throw new Error("Expected copied opinions");
      const original = index === 0 ? ranking : poll;
      expect(block.question.id).not.toBe(original.id);
      expect(block.question.choices.map((choice) => choice.label)).toEqual(
        original.choices.map((choice) => choice.label),
      );
      expect(
        block.question.choices.some((choice) =>
          original.choices.some((item) => item.id === choice.id),
        ),
      ).toBe(false);
      expect(block.question).toMatchObject({
        purpose: "opinion",
        confidence: "off",
        basePoints: 0,
        delivery: "main",
        linkedRecheckQuestionId: null,
      });
    }
    // A newer source publication cannot update an independent copied question.
    const changed = await page.request.patch(`${e01ApiUrl}/v1/quizzes/${source.id}`, {
      data: {
        expectedDraftRevision: source.draftRevision,
        draft: {
          ...sourceDraft,
          questions: sourceDraft.questions.map((question) => ({
            ...question,
            prompt: "AUTHOR-ONLY source revision",
          })),
        },
      },
    });
    expect(changed.status()).toBe(200);
    expect(
      (
        await page.request.post(`${e01ApiUrl}/v1/quizzes/${source.id}/publish`, {
          data: { expectedDraftRevision: (await changed.json()).quiz.draftRevision },
        })
      ).status(),
    ).toBe(200);
    expect((await readE01Record(page, destination.id)).draft).toEqual(copied);
    const lobby = await hostSession(page, destination.id);
    const guestContext = await contextFor(browser, page, info);
    const guest = await guestContext.newPage();
    const wire = await observeResponses(guest, true);
    try {
      await participant(guest, lobby.code, "Ordered response guest");
      await page.goto(`/presentation-session/${lobby.sessionId}/host`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await expect(guest.getByRole("heading", { name: ranking.prompt, exact: true })).toBeVisible();
      for (const label of ["Examples", "Practice", "Discussion"])
        await guest.getByRole("button", { name: `Add ${label} to ranking`, exact: true }).click();
      await guest
        .getByRole("button", { name: "Remove Practice from ranking", exact: true })
        .click();
      await expect(
        guest.getByRole("button", { name: "Submit response", exact: true }),
      ).toBeDisabled();
      await guest.getByRole("button", { name: "Add Feedback to ranking", exact: true }).click();
      await guest.getByRole("button", { name: "Move up: Discussion", exact: true }).press("Enter");
      await expect(guest.locator(".ranking-list li > strong")).toHaveText([
        "Discussion",
        "Examples",
        "Feedback",
      ]);
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect.poll(() => wire.submissions.length).toBe(1);
      await expect(guest.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveCount(0);
      await expect(guest.getByRole("status").filter({ hasText: /^Saving…$/ })).toBeVisible();
      wire.release();
      await expect.poll(wire.dropped).toBe(true);
      await expectSaved(guest);
      const input = wire.submissions[0]!;
      for (const replay of wire.submissions) {
        expect(replay.idempotencyKey).toBe(input.idempotencyKey);
        expect(replay.response).toEqual(input.response);
      }
      const firstBlock = copied.blocks[0]!;
      if (firstBlock.kind !== "question" || firstBlock.question.type !== "ranking")
        throw new Error("Expected copied ranking");
      const copiedChoices = firstBlock.question.choices;
      expect(input.response).toEqual({
        orderedChoiceIds: [2, 0, 3].map((index) => copiedChoices[index]!.id),
      });
      const accepted = await snapshot(guest, lobby.sessionId, "participant");
      expect(accepted).toMatchObject({
        responseSubmitted: true,
        standing: null,
        responseResult: null,
      });
      const { sessionId: _sessionId, ...restInput } = input;
      void _sessionId;
      const conflicting = await guest.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${lobby.sessionId}/responses`,
        {
          data: {
            ...restInput,
            response: { orderedChoiceIds: [...input.response.orderedChoiceIds!].reverse() },
          },
        },
      );
      expect(conflicting.status()).toBe(409);
      expect((await snapshot(page, lobby.sessionId, "host")).responseCount).toBe(1);
      expect(
        (await snapshot(guest, lobby.sessionId, "participant")).responseReceipt.responseId,
      ).toBe(accepted.responseReceipt.responseId);
      await guest.reload();
      await expectSaved(guest);
      await expect(guest.getByText("Your ranking is saved.", { exact: true })).toBeVisible();
      expect(await guest.locator("body").innerText()).not.toMatch(
        /AUTHOR-ONLY|PRIVATE E04|Correct answer|\bpoints\b/,
      );
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      const results = guest.getByRole("region", { name: "Opinion results", exact: true });
      await expect(results).toContainText("1 respondent");
      const result = (await snapshot(guest, lobby.sessionId, "participant"))
        .opinionSummary as PresentationOpinionResultSummary;
      expect(result.kind).toBe("ranking");
      if (result.kind === "ranking") {
        expect(
          Object.fromEntries(
            result.choices.map((choice) => [
              choice.choiceId,
              { label: choice.label, weightedScore: choice.weightedScore },
            ]),
          ),
        ).toEqual(
          Object.fromEntries(
            copiedChoices.map((choice, index) => [
              choice.id,
              { label: choice.label, weightedScore: [5, 0, 6, 4, 0, 0][index] },
            ]),
          ),
        );
        expect(result.choices.map((choice) => choice.weightedScore)).toEqual([6, 5, 4, 0, 0, 0]);
      }
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(guest.getByRole("heading", { name: poll.prompt, exact: true })).toBeVisible();
      await expect(results).toHaveCount(0);
      expect(await snapshot(guest, lobby.sessionId, "participant")).not.toHaveProperty(
        "opinionSummary",
      );
      for (const label of pollLabels.slice(0, 2))
        await guest.getByRole("button", { name: label, exact: true }).click();
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expectSaved(guest);
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await expect(
        results.getByRole("heading", { name: "Poll results", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      const final = await guest.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${lobby.sessionId}/participant`,
        { headers: { authorization: `Bearer ${input.participantToken}` } },
      );
      expect(final.status()).toBe(200);
      expect((await final.json()).snapshot).toMatchObject({ standing: null, responseResult: null });
      await expectNoOverflow(guest);
    } finally {
      await guestContext.close();
    }
  });
}
