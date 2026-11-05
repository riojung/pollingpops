import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import type {
  InteractiveQuestionBlockDraft,
  PresentationHostSnapshot,
  PresentationParticipantSnapshot,
  PresentationReport,
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

function question(prompt: string): InteractiveQuestionBlockDraft {
  return {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type: "single_select",
      prompt,
      choices: [
        { id: randomUUID(), label: "Evidence supported", isCorrect: true },
        { id: randomUUID(), label: "Needs another look", isCorrect: false },
      ],
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: ["navigation"],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 300,
      basePoints: 100,
      explanation: "UNREVEALED E07 question rationale",
      mediaId: null,
      mediaAlt: null,
    },
  };
}

async function fixture(page: Page, linked: boolean, info: TestInfo) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await signInBeta(page);
  const suffix = randomUUID().slice(0, 8);
  const opening = e01Slide(`Navigation opening ${suffix}`);
  opening.speakerNotes = "PRIVATE E07 opening cue";
  const detour = e01Slide(`Navigation detour ${suffix}`);
  const closing = e01Slide(`Navigation closing ${suffix}`);
  const answered = question(`Navigation checkpoint ${suffix}`);
  const skipped = question(`Never presented checkpoint ${suffix}`);
  const recheck = question(`Navigation linked recheck ${suffix}`);
  recheck.question.delivery = "recheck";
  if (linked) answered.question.linkedRecheckQuestionId = recheck.question.id;
  const blocks = linked
    ? [opening, detour, answered, recheck, closing]
    : [opening, answered, skipped, detour, closing];
  const record = await createE01Deck(page, blocks);
  const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
  await enterE01Editor(page, record.id, narrow);
  if (narrow) await page.getByRole("button", { name: "Open map", exact: true }).click();
  await page.getByRole("button", { name: "Enable sections and navigation", exact: true }).click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Section 1 name", { exact: true }).fill("SECTION E07 facilitator path");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Selected block section", exact: true })
    .selectOption({ label: "SECTION E07 facilitator path" });
  await expect
    .poll(async () => {
      const draft = (await readE01Record(page, record.id)).draft;
      return {
        version: draft.schemaVersion,
        sections: draft.sections,
        ids: draft.blocks.map((block) => block.id),
      };
    })
    .toMatchObject({
      version: 12,
      sections: [{ title: "SECTION E07 facilitator path", blockIds: [opening.id] }],
      ids: blocks.map((block) => block.id),
    });
  await page.reload();
  await expect(page.getByLabel("Section 1 name", { exact: true })).toHaveValue(
    "SECTION E07 facilitator path",
  );
  const publishing = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  expect((await publishing).status()).toBe(200);
  const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
    data: { presentationId: record.id, timeMode: "flex" },
  });
  expect(created.status()).toBe(201);
  const { snapshot, controlToken } = await created.json();
  const sessionId = snapshot.sessionId as string;
  await page.evaluate(
    ({ sessionId, controlToken }) =>
      sessionStorage.setItem(`openround:presentation-host:${sessionId}`, controlToken),
    { sessionId, controlToken },
  );
  await page.goto(`/presentation-session/${sessionId}/host`);
  const companionPopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Launch companion", exact: true }).click();
  const companion = await companionPopup;
  await expect(
    companion.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeVisible();
  const stagePopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open audience stage", exact: true }).click();
  const stage = await stagePopup;
  return {
    sessionId,
    code: snapshot.code as string,
    opening,
    detour,
    closing,
    answered,
    skipped,
    recheck,
    companion,
    stage,
  };
}

async function audience(browser: Browser, host: Page, code: string, info: TestInfo) {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({
    baseURL: new URL(host.url()).origin,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const page = await context.newPage();
  const frames: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => frames.push(payload.toString())),
  );
  await page.goto(`/join?code=${code}`);
  await page.getByLabel("Nickname", { exact: true }).fill("E07 real browser response");
  await page.getByRole("button", { name: "Join a Presentation", exact: true }).click();
  await expect(page).toHaveURL(/\/presentation-session\/[^/]+\/play$/);
  return { page, context, frames };
}

async function hostSnapshot(page: Page, sessionId: string): Promise<PresentationHostSnapshot> {
  const response = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${sessionId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot;
}

async function audienceSnapshot(page: Page, sessionId: string, role: "participant" | "stage") {
  const token = await page.evaluate(
    ({ sessionId, role }) => sessionStorage.getItem(`openround:presentation-${role}:${sessionId}`),
    { sessionId, role },
  );
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/${role}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.status()).toBe(200);
  const snapshot = (await response.json()).snapshot;
  expect(snapshot).not.toHaveProperty("blocks");
  expect(snapshot).not.toHaveProperty("nextBlock");
  expect(JSON.stringify(snapshot)).not.toMatch(
    /"navigation"|"sections"|"sectionId"|"sectionTitle"|"presenter"|"speakerNotes"|"sourceCitations"|"isCorrect"|PRIVATE E07|SECTION E07/,
  );
  return snapshot as PresentationParticipantSnapshot;
}

async function openNavigation(page: Page) {
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Presentation navigation", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function jump(page: Page, title: string) {
  const dialog = await openNavigation(page);
  await dialog
    .getByRole("list")
    .getByRole("button", { name: new RegExp(title) })
    .click();
  await expect(dialog).not.toBeVisible();
}

async function answer(page: Page, correct: boolean) {
  await page
    .getByRole("button", {
      name: correct ? "Evidence supported" : "Needs another look",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Submit response", exact: true }).click();
  await expect(
    page.getByText("Response saved. You can stay here while the facilitator continues.", {
      exact: true,
    }),
  ).toBeVisible();
}

async function loseJumpAcknowledgement(page: Page) {
  const commands: string[] = [];
  let ack: string | null = null;
  let dropped = false;
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const match = message.toString().match(/^42(\d+)(\[.*)$/);
      if (match) {
        const [event, command] = JSON.parse(match[2]!);
        if (event === "presentation.command" && command.action === "jump_to_block") {
          commands.push(JSON.stringify(command));
          if (ack === null) ack = match[1]!;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (!dropped && ack !== null && message.toString().startsWith(`43${ack}[`)) {
        dropped = true;
        socket.close({ code: 1012, reason: "E07 accepted acknowledgement lost" });
        return;
      }
      socket.send(message);
    });
  });
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
  return { commands, dropped: () => dropped };
}

async function report(page: Page, sessionId: string): Promise<PresentationReport> {
  const uri = `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/report?includeQuickChecks=true&includeOpinionResults=true&includeTextResults=true&includeNavigation=true`;
  await expect
    .poll(async () => (await (await page.request.get(uri)).json()).reportStatus)
    .toBe("ready");
  return (await (await page.request.get(uri)).json()).report;
}

test("host navigation survives lost acknowledgement, returns and reviews saved evidence", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(page, false, info);
  const guest = await audience(browser, page, f.code, info);
  try {
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    const transport = await loseJumpAcknowledgement(page);
    const open = page.getByRole("button", { name: "Open navigation", exact: true });
    await open.focus();
    await open.press("Enter");
    let dialog = page.getByRole("dialog", { name: "Presentation navigation" });
    const beforeKeys = (await hostSnapshot(page, f.sessionId)).revision;
    for (const key of ["ArrowRight", "PageDown", " "]) await dialog.press(key);
    expect((await hostSnapshot(page, f.sessionId)).revision).toBe(beforeKeys);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await dialog.screenshot({ path: info.outputPath("e07-host-navigation.png") });
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
    dialog = await openNavigation(page);
    await dialog.getByRole("button", { name: /Navigation detour/ }).click();
    await expect.poll(transport.dropped).toBe(true);
    await expect(f.companion.getByRole("heading", { name: /Navigation detour/ })).toBeVisible();
    await f.companion.getByRole("button", { name: "Next block", exact: true }).click();
    await page.reload();
    const retry = page.getByRole("button", { name: "Retry jump acknowledgement", exact: true });
    await expect(retry).toBeEnabled();
    await expect(page.getByRole("region", { name: "Current slide" })).toContainText(
      "Navigation closing",
    );
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(transport.commands).toHaveLength(2);
    expect(transport.commands[0]).toBe(transport.commands[1]);
    await expect(page.getByRole("region", { name: "Current slide" })).toContainText(
      "Navigation closing",
    );
    dialog = await openNavigation(page);
    await expect(dialog).toContainText("Return target: Navigation opening");
    await expect(dialog.getByRole("button", { name: /Never presented checkpoint/ })).toContainText(
      "Not visited",
    );
    await dialog.getByRole("button", { name: /^Return to path: Navigation opening/ }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Next block", exact: true }).click();
    await expect(
      guest.page.getByRole("heading", { name: f.answered.question.prompt }),
    ).toBeVisible();
    dialog = await openNavigation(page);
    await expect(dialog.getByRole("button", { name: /Navigation closing/ })).toBeDisabled();
    await dialog.getByRole("button", { name: "Close navigation", exact: true }).click();
    for (const [surface, role] of [
      [guest.page, "participant"],
      [f.stage, "stage"],
    ] as const) {
      const projected = await audienceSnapshot(surface, f.sessionId, role);
      expect(projected.currentBlock?.id).toBe(f.answered.id);
      expect(JSON.stringify(projected)).not.toContain("UNREVEALED E07");
    }
    expect(await guest.page.content()).not.toContain("UNREVEALED E07");
    await answer(guest.page, true);
    await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    const closed = await hostSnapshot(page, f.sessionId);
    const receipt = (await audienceSnapshot(guest.page, f.sessionId, "participant"))
      .responseReceipt;
    await jump(page, "Navigation closing");
    await jump(page, f.answered.question.prompt);
    const review = await hostSnapshot(page, f.sessionId);
    expect(review.phase).toBe("question_reveal");
    expect(review.acceptingResponses).toBe(false);
    expect(review.responseCount).toBe(closed.responseCount);
    expect(review.participants.map(({ id, score }) => ({ id, score }))).toEqual(
      closed.participants.map(({ id, score }) => ({ id, score })),
    );
    expect(
      (await audienceSnapshot(guest.page, f.sessionId, "participant")).responseReceipt,
    ).toEqual(receipt);
    await expect(
      guest.page.getByRole("button", { name: "Submit response", exact: true }),
    ).toHaveCount(0);
    await jump(page, "Navigation closing");
    await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
    expect(guest.frames.join("\n")).not.toMatch(
      /"navigation"|"sections"|"sectionId"|"sectionTitle"|"presenter"|"speakerNotes"|"sourceCitations"|"isCorrect"|PRIVATE E07|SECTION E07/,
    );
    const evidence = await report(page, f.sessionId);
    expect(evidence.schemaVersion).toBe(6);
    if (evidence.schemaVersion !== 6) throw new Error("V6 navigation report required");
    expect(
      evidence.navigation.blocks.find((entry) => entry.blockId === f.skipped.id),
    ).toMatchObject({ status: "skipped", phase: null });
    expect(evidence.evidence.find((entry) => entry.blockId === f.answered.id)).toMatchObject({
      respondents: 1,
      totalScore: 100,
    });
    await page.goto(`/presentation-session/${f.sessionId}/report`);
    await expect(page.getByText("Skipped · not presented", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath("e07-navigation-report.png"), fullPage: true });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export evidence CSV", exact: true }).click();
    expect((await download).suggestedFilename()).toContain("evidence.csv");
  } finally {
    await guest.context.close();
    await f.companion.close();
    await f.stage.close();
  }
});

test("Companion navigation reload keeps the exact target and respects the linked recheck path @mobile", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(page, true, info);
  const guest = await audience(browser, page, f.code, info);
  try {
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    const transport = await loseJumpAcknowledgement(f.companion);
    const dialog = await openNavigation(f.companion);
    await expect(
      dialog.getByRole("button", { name: new RegExp(f.recheck.question.prompt) }),
    ).toBeDisabled();
    expect((await new AxeBuilder({ page: f.companion }).analyze()).violations).toEqual([]);
    await dialog.screenshot({ path: info.outputPath("e07-companion-navigation-mobile.png") });
    expect(
      await f.companion.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await dialog.getByRole("button", { name: /Navigation detour/ }).click();
    await expect.poll(transport.dropped).toBe(true);
    await expect(page.getByRole("region", { name: "Current slide" })).toContainText(
      "Navigation detour",
    );
    await page.getByRole("button", { name: "Next block", exact: true }).click();
    await f.companion.reload();
    const retry = f.companion.getByRole("button", {
      name: "Retry jump acknowledgement",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(transport.commands).toHaveLength(2);
    expect(transport.commands[0]).toBe(transport.commands[1]);
    await expect(
      f.companion.getByRole("heading", { name: f.answered.question.prompt, exact: true }),
    ).toBeVisible();
    await answer(guest.page, false);
    await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    const blocked = await openNavigation(f.companion);
    await expect(blocked.getByRole("button", { name: /Navigation closing/ })).toBeDisabled();
    await expect(blocked.getByRole("button", { name: /^Return to path:/ })).toBeDisabled();
    await f.companion.keyboard.press("Escape");
    await page.getByRole("button", { name: "Present intervention", exact: true }).click();
    await page.getByRole("button", { name: "Continue to recheck", exact: true }).click();
    await expect(
      guest.page.getByRole("heading", { name: f.recheck.question.prompt }),
    ).toBeVisible();
    await answer(guest.page, true);
    await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    await audienceSnapshot(guest.page, f.sessionId, "participant");
    await audienceSnapshot(f.stage, f.sessionId, "stage");
    await page.getByRole("button", { name: "Next block", exact: true }).click();
    await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
    expect(guest.frames.join("\n")).not.toMatch(
      /"navigation"|"sections"|"sectionId"|"sectionTitle"|"presenter"|"speakerNotes"|"sourceCitations"|"isCorrect"|PRIVATE E07|SECTION E07/,
    );
    const evidence = await report(page, f.sessionId);
    expect(evidence.schemaVersion).toBe(6);
    expect(evidence.responseCount).toBe(2);
    expect(evidence.recovery[0]).toMatchObject({ eligible: 1, recovered: 1 });
  } finally {
    await guest.context.close();
    await f.companion.close();
    await f.stage.close();
  }
});
