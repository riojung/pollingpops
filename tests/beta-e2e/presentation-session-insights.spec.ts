import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PresentationSessionInsightsEnvelopeSchema,
  type PresentationHostSnapshot,
} from "../../packages/contracts/src/index.ts";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
const privateData =
  /PRIVATE E09|NEWER E09|nickname|tokenHash|revealedParticipantIds|"participantId"|speakerNotes|isCorrect|explanation/;
function question(prompt: string, delivery: "main" | "recheck" = "main") {
  return {
    id: randomUUID(),
    kind: "question" as const,
    question: {
      id: randomUUID(),
      type: "single_select" as const,
      prompt,
      choices: [
        { id: randomUUID(), label: "Evidence supported", isCorrect: true },
        { id: randomUUID(), label: "Needs another look", isCorrect: false },
      ],
      purpose: "diagnostic" as const,
      confidence: "off" as const,
      delivery,
      conceptKeys: ["reporting"],
      linkedRecheckQuestionId: null as string | null,
      timeLimitSeconds: 300,
      basePoints: 100,
      explanation: "PRIVATE E09 answer rationale",
      mediaId: null,
      mediaAlt: null,
    },
  };
}
function opinionQuestion(prompt: string, choices: [string, string]) {
  const base = question(prompt);
  return {
    ...base,
    question: {
      ...base.question,
      type: "poll" as const,
      purpose: "opinion" as const,
      maxSelections: 1,
      basePoints: 0,
      choices: choices.map((label) => ({ id: randomUUID(), label, isCorrect: false })),
    },
  };
}

async function hostSnapshot(page: Page, sessionId: string): Promise<PresentationHostSnapshot> {
  const response = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${sessionId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot;
}
async function join(page: Page, code: string, nickname: string) {
  const response = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions/join`, {
    data: { code, nickname },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).participantToken as string;
}
async function submit(page: Page, sessionId: string, token: string, choiceId: string) {
  const snapshot = await hostSnapshot(page, sessionId);
  const response = await page.request.post(
    `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/responses`,
    {
      data: {
        participantToken: token,
        blockId: snapshot.currentBlock!.id,
        expectedRevision: snapshot.revision,
        idempotencyKey: randomUUID(),
        response: { choiceIds: [choiceId], confidence: null },
      },
    },
  );
  expect(response.status()).toBe(202);
}
async function answer(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("button", { name: "Submit response", exact: true }).click();
  await expect(
    page.getByText("Response saved. You can stay here while the facilitator continues.", {
      exact: true,
    }),
  ).toBeVisible();
}
async function qnaCommand(
  page: Page,
  sessionId: string,
  token: string,
  command: Record<string, unknown>,
) {
  const response = await page.request.post(
    `${e01ApiUrl}/v1/audience-scopes/${sessionId}/qna/commands`,
    {
      headers: { authorization: `Bearer ${token}` },
      data: { kind: "presentation", command: { idempotencyKey: randomUUID(), ...command } },
    },
  );
  expect(response.status()).toBe(200);
  return (await response.json()).receipt as { resourceId: string; audienceSeq: number };
}
async function moderate(
  page: Page,
  sessionId: string,
  token: string,
  questionId: string,
  status: "published" | "answered",
) {
  const state = await page.request.get(
    `${e01ApiUrl}/v1/audience-scopes/${sessionId}/qna/questions?kind=presentation`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  expect(state.status()).toBe(200);
  return qnaCommand(page, sessionId, token, {
    type: "question.moderate",
    expectedAudienceSeq: (await state.json()).audienceSeq,
    questionId,
    status,
    label: null,
    banAuthor: false,
  });
}

for (const suffix of ["", " @mobile"]) {
  test(`session insights preserve frozen delivery, reveal denominators and private aggregate downloads${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const opening = e01Slide("Reporting opening");
    opening.speakerNotes = "PRIVATE E09 presenter cue";
    const diagnostic = question("Initial evidence checkpoint");
    const recheck = question("Recheck evidence checkpoint", "recheck");
    diagnostic.question.linkedRecheckQuestionId = recheck.question.id;
    const opinion = opinionQuestion("Which next step?", ["Prefer first", "Prefer second"]);
    const smallOpinion = opinionQuestion("Single response opinion", [
      "PRIVATE E09 suppressed first option",
      "PRIVATE E09 suppressed second option",
    ]);
    const skipped = question("Never presented checkpoint");
    const closing = e01Slide("Reporting closing");
    const record = await createE01Deck(
      page,
      [opening, diagnostic, recheck, opinion, smallOpinion, skipped, closing],
      13,
    );
    const sectionTitle = "=SUM(1,2) <script>section</script>";
    const sections = [
      { id: randomUUID(), title: sectionTitle, blockIds: [opening.id, diagnostic.id, recheck.id] },
      {
        id: randomUUID(),
        title: "Discussion and close",
        blockIds: [opinion.id, smallOpinion.id, skipped.id, closing.id],
      },
    ];
    const sectionSave = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
      data: {
        draft: { ...record.draft, sections },
        expectedRevision: record.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(sectionSave.status()).toBe(200);
    await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    const publication = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await publication).status()).toBe(200);
    const published = await (
      await page.request.get(`${e01ApiUrl}/v1/presentations/${record.id}`)
    ).json();
    const versionId = published.presentation.currentVersionId as string;
    const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
      data: { presentationId: record.id, timeMode: "flex" },
    });
    expect(created.status()).toBe(201);
    const { snapshot, controlToken } = await created.json();
    const sessionId = snapshot.sessionId as string,
      code = snapshot.code as string;
    await page.evaluate(
      ({ sessionId, controlToken }) =>
        sessionStorage.setItem(`openround:presentation-host:${sessionId}`, controlToken),
      { sessionId, controlToken },
    );
    await page.goto(`/presentation-session/${sessionId}/host`);
    const guestContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      reducedMotion: "reduce",
    });
    const guest = await guestContext.newPage();
    try {
      await guest.goto(`/join?code=${code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("PRIVATE E09 browser alias");
      await guest.getByRole("button", { name: "Join presentation", exact: true }).click();
      await expect(guest).toHaveURL(/\/presentation-session\/[^/]+\/play$/);
      const guestToken = await guest.evaluate(
        (id) => sessionStorage.getItem(`openround:presentation-participant:${id}`),
        sessionId,
      );
      expect(guestToken).toBeTruthy();
      const tokens = [guestToken!];
      for (let index = 1; index <= 4; index++)
        tokens.push(await join(page, code, `PRIVATE E09 API alias ${index}`));
      await page.getByRole("button", { name: "Activate audience Q&A", exact: true }).click();
      await expect(page.getByRole("checkbox", { name: "Enable Q&A", exact: true })).toBeChecked();
      const qnaIds: string[] = [];
      for (const [index, token] of tokens.entries()) {
        qnaIds.push(
          (
            await qnaCommand(page, sessionId, token, {
              type: "question.create",
              body: `PRIVATE E09 audience question ${index}`,
            })
          ).resourceId,
        );
      }
      for (const questionId of qnaIds)
        await moderate(page, sessionId, controlToken, questionId, "published");
      for (const questionId of qnaIds.slice(0, 2))
        await moderate(page, sessionId, controlToken, questionId, "answered");
      await qnaCommand(page, sessionId, tokens[0]!, {
        type: "vote.set",
        questionId: qnaIds[1],
        voted: true,
      });
      await qnaCommand(page, sessionId, tokens[1]!, {
        type: "vote.set",
        questionId: qnaIds[0],
        voted: true,
      });

      // Later publication metadata must not replace this session's source/version.
      const latest = await readE01Record(page, record.id);
      const newer = structuredClone(latest.draft);
      const first = newer.blocks[0]!;
      if (first.kind !== "content" || !first.scene) throw new Error("Expected native opening");
      const titleNode = first.scene.nodes.find(
        (node) => node.type === "text" && node.role === "title",
      );
      if (titleNode?.type !== "text") throw new Error("Expected opening title");
      titleNode.text = "NEWER E09 publication content";
      const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
        data: {
          draft: newer,
          expectedRevision: latest.draftRevision,
          mutationId: randomUUID(),
          schemaVersion: 2,
        },
      });
      expect(saved.status()).toBe(200);
      const republished = await page.request.post(
        `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
        {
          data: { expectedDraftRevision: (await saved.json()).presentation.draftRevision },
        },
      );
      expect(republished.status()).toBe(200);

      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: diagnostic.question.prompt, exact: true }),
      ).toBeVisible();
      await answer(guest, "Needs another look");
      for (const token of tokens.slice(1))
        await submit(page, sessionId, token, diagnostic.question.choices[1]!.id);
      const silent = await join(page, code, "PRIVATE E09 joined before reveal");
      await qnaCommand(page, sessionId, silent, {
        type: "question.create",
        body: "PRIVATE E09 pending audience detail",
      });
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await join(page, code, "PRIVATE E09 joined after reveal");
      await page.getByRole("button", { name: "Present intervention", exact: true }).click();
      await page.getByRole("button", { name: "Continue to recheck", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: recheck.question.prompt, exact: true }),
      ).toBeVisible();
      await answer(guest, "Evidence supported");
      for (const [index, token] of tokens.slice(1).entries())
        await submit(page, sessionId, token, recheck.question.choices[index === 3 ? 1 : 0]!.id);
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: opinion.question.prompt, exact: true }),
      ).toBeVisible();
      await answer(guest, "Prefer first");
      for (const [index, token] of tokens.slice(1).entries())
        await submit(page, sessionId, token, opinion.question.choices[index < 2 ? 0 : 1]!.id);
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: smallOpinion.question.prompt, exact: true }),
      ).toBeVisible();
      await submit(page, sessionId, tokens[0]!, smallOpinion.question.choices[0]!.id);
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Presentation navigation", exact: true })
        .getByRole("button", { name: /Reporting closing/ })
        .click();
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();

      const reportUrl = `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/report?includeQuickChecks=true&includeOpinionResults=true&includeTextResults=true&includeNavigation=true&includeInteractions=true`;
      await expect
        .poll(async () => (await (await page.request.get(reportUrl)).json()).reportStatus)
        .toBe("ready");
      const insightsUrl = `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/insights`;
      const response = await page.request.get(insightsUrl);
      expect(response.status()).toBe(200);
      const raw = await response.json();
      const envelope = PresentationSessionInsightsEnvelopeSchema.parse(raw);
      expect(envelope.status).toBe("ready");
      const insights = envelope.insights;
      if (!insights) throw new Error("Expected ready insights");
      expect(JSON.stringify(raw).match(privateData)).toBeNull();
      expect(insights.presentationVersionId).toBe(versionId);
      expect(insights.publishedVersion).toBe(1);
      expect(insights.contentScope).toBe("frozen_session");
      expect(insights.delivery.totals).toEqual({
        totalBlocks: 7,
        presentedBlocks: 6,
        skippedBlocks: 1,
        unknownBlocks: 0,
        coveragePercent: 85.7,
      });
      expect(insights.delivery.sections.map((section) => section.coveragePercent)).toEqual([
        100, 75,
      ]);
      expect(insights.participation).toMatchObject({
        joinedParticipantCount: 7,
        acceptedResponseCount: 16,
      });
      expect(
        insights.participation.questions.find((row) => row.blockId === smallOpinion.id),
      ).toMatchObject({
        status: "suppressed",
        acceptedRespondents: null,
        joinedByRevealCount: null,
        responseRatePercent: null,
        distributionStatus: "suppressed",
        results: [],
      });
      expect(
        insights.participation.questions.find((row) => row.blockId === diagnostic.id),
      ).toMatchObject({
        acceptedRespondents: 5,
        joinedByRevealCount: 6,
        notRespondedByRevealCount: 1,
        responseRatePercent: 83.3,
        denominatorBasis: "joined_by_reveal",
      });
      expect(
        insights.participation.questions.find((row) => row.blockId === recheck.id),
      ).toMatchObject({ acceptedRespondents: 5, joinedByRevealCount: 7 });
      expect(
        insights.participation.questions.find((row) => row.blockId === opinion.id),
      ).toMatchObject({
        distributionStatus: "available",
        results: [
          { label: "Prefer first", value: 3 },
          { label: "Prefer second", value: 2 },
        ],
      });
      expect(
        insights.participation.questions.find((row) => row.blockId === skipped.id),
      ).toMatchObject({
        status: "skipped",
        acceptedRespondents: 0,
        joinedByRevealCount: null,
        responseRatePercent: null,
      });
      expect(insights.recovery).toMatchObject([
        {
          initiallyIncorrectWithAcceptedRecheck: 5,
          recovered: 4,
          recoveryPercent: 80,
          denominatorBasis: "initially_incorrect_with_accepted_recheck",
        },
      ]);
      expect(insights.qna).toMatchObject({
        status: "available",
        publicQuestionCount: 5,
        answeredQuestionCount: 2,
        unansweredQuestionCount: 3,
        upvoteCount: 2,
      });
      const denied = await guest.request.get(insightsUrl, {
        headers: { authorization: `Bearer ${guestToken}` },
      });
      expect(denied.status()).toBe(401);

      let insightsPending = true;
      let insightsReads = 0;
      await page.route(insightsUrl, (route) => {
        insightsReads++;
        return insightsPending
          ? route.fulfill({ status: 202, json: { status: "pending", insights: null } })
          : route.continue();
      });
      await page.goto(`/presentation-session/${sessionId}/report`);
      const panel = page.getByRole("region", { name: "Session insights", exact: true });
      const tabs = panel.getByRole("tablist", { name: "Session insights", exact: true });
      const exportCoverage = panel.getByRole("button", {
        name: "Export coverage CSV",
        exact: true,
      });
      const reportEvidence = page.getByRole("region", { name: "Block evidence", exact: true });
      await expect(
        panel.getByRole("status").filter({ hasText: "still being reconciled" }),
      ).toBeVisible();
      await expect(tabs).toHaveCount(0);
      await expect(exportCoverage).toHaveCount(0);
      await expect(
        reportEvidence.getByRole("heading", { name: diagnostic.question.prompt }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Export evidence CSV", exact: true }),
      ).toBeEnabled();
      if (process.env.BETA_E2E_SESSION_SUMMARIES === "true") {
        await expect(
          page.getByRole("button", { name: "Share summary", exact: true }),
        ).toBeEnabled();
      }
      const pendingReads = insightsReads;
      insightsPending = false;
      await panel.getByRole("button", { name: "Retry insights", exact: true }).click();
      await expect(exportCoverage).toBeEnabled();
      const readsBeforeTabs = insightsReads;
      expect(readsBeforeTabs).toBeGreaterThan(pendingReads);
      const snapshotTime = panel.getByText(/^Insights calculated ·/).locator("time");
      await expect(snapshotTime).toBeVisible();
      const calculatedAt = await snapshotTime.getAttribute("datetime");

      const tab = (name: string) => tabs.getByRole("tab", { name, exact: true });
      const activeView = async (name: string) => {
        await expect(tab(name)).toHaveAttribute("aria-selected", "true");
        await expect(tab(name)).toHaveAttribute("tabindex", "0");
        await expect(panel.getByRole("tabpanel")).toHaveCount(1);
        const view = panel.getByRole("tabpanel", { name, exact: true });
        await expect(view).toBeVisible();
        expect(await view.innerText()).not.toMatch(/PRIVATE E09|NEWER E09/);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        return view;
      };

      await expect(tabs.getByRole("tab")).toHaveCount(5);
      const overview = await activeView("Overview");
      await expect(tab("Delivery")).toHaveAttribute("tabindex", "-1");
      await expect(
        overview.getByText("Participant identities joined", { exact: true }),
      ).toBeVisible();
      await expect(overview.getByText("7", { exact: true })).toBeVisible();
      await expect(overview.getByText("Accepted response records", { exact: true })).toBeVisible();
      await expect(overview.getByText("16", { exact: true })).toBeVisible();
      await expect(overview.getByText("6 of 7", { exact: true })).toBeVisible();
      await expect(overview.getByText(/Published version/).first()).toContainText("Version 1");
      const version = overview.getByText("Published version · Version 1", { exact: true });
      await version.click();
      await expect(
        overview.getByText(
          "Frozen session content. See Delivery for items added during this session.",
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      await version.click();
      await expect(overview.getByText("Reading these insights", { exact: true })).toBeVisible();
      await expect(overview.getByRole("table")).toHaveCount(0);
      await panel.screenshot({
        path: info.outputPath("session-insights-overview-light.png"),
        animations: "disabled",
        scale: "css",
      });
      expect(
        (await new AxeBuilder({ page }).include("[aria-labelledby]").analyze()).violations,
      ).toEqual([]);

      await tab("Overview").focus();
      await page.keyboard.press("ArrowLeft");
      await expect(tab("Q&A")).toBeFocused();
      const qna = await activeView("Q&A");
      await expect(qna.getByRole("heading", { name: "Q&A outcomes", exact: true })).toBeVisible();
      await expect(qna.getByText("Public questions", { exact: true })).toBeVisible();
      await expect(qna.getByText(/^Q&A data as of ·/).locator("time")).toBeVisible();
      await page.keyboard.press("Home");
      await expect(tab("Overview")).toBeFocused();
      await activeView("Overview");
      await page.keyboard.press("ArrowRight");
      await expect(tab("Delivery")).toBeFocused();
      const delivery = await activeView("Delivery");
      await expect(delivery.getByText("85.7%", { exact: true })).toBeVisible();
      await expect(
        delivery
          .getByRole("table", { name: "Section delivery", exact: true })
          .getByRole("rowheader", { name: sectionTitle, exact: true }),
      ).toBeVisible();
      await expect(
        delivery
          .getByRole("table", { name: "Block delivery", exact: true })
          .getByRole("row", { name: /Never presented checkpoint.*Skipped/ }),
      ).toBeVisible();
      await page.keyboard.press("End");
      await expect(tab("Q&A")).toBeFocused();
      await activeView("Q&A");

      await tab("Response coverage").click();
      const coverage = await activeView("Response coverage");
      const assessed = coverage.getByRole("table", {
        name: "Response coverage · Assessed activities",
        exact: true,
      });
      await expect(
        assessed.getByRole("columnheader", { name: "Participants joined by reveal", exact: true }),
      ).toBeVisible();
      const initial = assessed.getByRole("row", { name: /Initial evidence checkpoint/ });
      await expect(initial.getByRole("cell", { name: "6", exact: true })).toBeVisible();
      await expect(initial.getByRole("cell", { name: "83.3%", exact: true })).toBeVisible();
      await expect(
        coverage
          .getByRole("table", { name: "Recovery evidence", exact: true })
          .getByRole("cell", { name: "80%", exact: true }),
      ).toBeVisible();
      await expect(
        coverage
          .getByRole("row", { name: /Single response opinion/ })
          .getByRole("cell", { name: "Hidden · fewer than 5 responses", exact: true }),
      ).toBeVisible();
      await panel.screenshot({
        path: info.outputPath("session-insights-coverage-light.png"),
        animations: "disabled",
        scale: "css",
      });

      await tab("Opinion results").click();
      const opinionResults = await activeView("Opinion results");
      const leadingOption = opinionResults.getByRole("row", {
        name: "Prefer first 3",
        exact: true,
      });
      await expect(leadingOption).toBeVisible();
      await expect(
        opinionResults.getByText(
          "Bars show the share of accepted respondents who selected each option.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(leadingOption.locator('span[aria-hidden="true"] > span')).toHaveAttribute(
        "style",
        /width:\s*60%/,
      );
      await expect(
        opinionResults.getByText("Hidden · fewer than five responses", { exact: true }),
      ).toBeVisible();
      await expect(exportCoverage).toBeEnabled();
      await expect(reportEvidence).toBeVisible();
      await expect(snapshotTime).toHaveAttribute("datetime", calculatedAt!);
      expect(insightsReads).toBe(readsBeforeTabs);

      await tab("Overview").click();
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
      await panel.screenshot({
        path: info.outputPath("session-insights-overview-dark.png"),
        animations: "disabled",
        scale: "css",
      });
      expect(
        (await new AxeBuilder({ page }).include("[aria-labelledby]").analyze()).violations,
      ).toEqual([]);
      await page.emulateMedia({ colorScheme: "light" });
      const files = new Map<string, string>();
      for (const [label, extension] of [
        ["Export coverage CSV", "csv"],
        ["Download readable summary", "html"],
      ] as const) {
        const download = page.waitForEvent("download");
        await panel.getByRole("button", { name: label, exact: true }).click();
        const file = await download;
        expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
        const target = info.outputPath(`insights.${extension}`);
        await file.saveAs(target);
        files.set(extension, await readFile(target, "utf8"));
      }
      const csv = files.get("csv")!,
        html = files.get("html")!;
      expect(csv.match(privateData)).toBeNull();
      expect(csv).toContain("'=SUM(1,2)");
      expect(csv).toContain("Participants joined by reveal");
      expect(csv).toContain('"5","6","1","83.3%","Recorded"');
      expect(csv).toContain("Opinion distribution");
      expect(csv).toContain('"Prefer first","3"');
      expect(csv).toContain('"Hidden · fewer than five responses"');
      expect(html.match(privateData)).toBeNull();
      expect(html.match(/<script\b/i)).toBeNull();
      const readable = await page.context().newPage();
      const external: string[] = [];
      await readable.route(/^https?:/, (route) => {
        external.push(route.request().url());
        return route.abort();
      });
      await readable.setContent(html);
      expect(await readable.locator("script,iframe,form,input").count()).toBe(0);
      const sectionTable = readable.getByRole("region", { name: "Section delivery", exact: true });
      await expect(sectionTable).toHaveAttribute("tabindex", "0");
      const sectionRecords = sectionTable.locator(".mobile-records");
      if (info.project.name.endsWith("-mobile")) {
        await expect(sectionRecords).toBeVisible();
        await expect(sectionRecords.getByText(sectionTitle, { exact: true })).toBeVisible();
        await expect(sectionTable.getByRole("table")).toHaveCount(0);
        expect(
          await sectionTable.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);
        await sectionTable.focus();
        await expect(sectionTable).toBeFocused();
        const coverageRecords = readable
          .getByRole("region", { name: "Response coverage · Assessed activities", exact: true })
          .locator(".mobile-records");
        await expect(
          coverageRecords.getByText("Participants joined by reveal", { exact: true }).first(),
        ).toBeVisible();
        await expect(coverageRecords.getByText("6", { exact: true })).toBeVisible();
        await expect(coverageRecords.getByText("83.3%", { exact: true })).toBeVisible();
      } else {
        await expect(sectionRecords).not.toBeVisible();
        await expect(
          sectionTable.getByRole("rowheader", { name: sectionTitle, exact: true }),
        ).toBeVisible();
      }
      expect(external).toEqual([]);
      expect((await new AxeBuilder({ page: readable }).analyze()).violations).toEqual([]);
      expect(
        await readable.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await readable.screenshot({ path: info.outputPath("readable-insights.png"), fullPage: true });
      expect(insightsReads).toBe(readsBeforeTabs);
      await readable.close();
    } finally {
      await guestContext.close();
    }
  });
}
