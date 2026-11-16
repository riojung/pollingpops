import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  InteractiveQuestionBlockDraft,
  PresentationHostSnapshot,
} from "../../packages/contracts/src/index.ts";
import {
  branchNavigationCopy,
  localizeBranchNavigationFeedback,
} from "../../apps/web/components/presentation/branch-navigation-copy";
import koreanLive from "../../apps/web/lib/i18n/domains/live-delivery/ko-KR";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  openE01Navigator,
  readE01Record,
} from "./presentation-e01-support";
import { specialistLocale, specialistQuality } from "./option-b-specialist-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 15_000 });
const copy = branchNavigationCopy("ko-KR");
const originalLabel = "Original branch {number} <evidence>";
const revisedLabel = "Original branch {number} <evidence> revised";
const minimumLabel = "Original minimum-response branch";
const conditionLabel = "Original alternate-answer branch";

function branchFixture() {
  const correctId = randomUUID(),
    alternateId = randomUUID();
  const opening = e01Slide("Original opening context"),
    skipped = e01Slide("Original unvisited context"),
    target = e01Slide("Original target {title} <context>"),
    closing = e01Slide("Original closing context");
  const checkpoint: InteractiveQuestionBlockDraft = {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type: "single_select",
      prompt: "Original branch checkpoint",
      choices: [
        { id: correctId, label: "Original answer {number} <source>", isCorrect: true },
        { id: alternateId, label: "Original alternate answer", isCorrect: false },
      ],
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: ["localized-branch-navigation"],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 300,
      basePoints: 100,
      explanation: "PRIVATE original answer rationale",
      mediaId: null,
      mediaAlt: null,
    },
    branches: [
      {
        id: randomUUID(),
        label: originalLabel,
        targetBlockId: target.id.toUpperCase(),
        condition: {
          kind: "choice_share",
          choiceId: correctId.toUpperCase(),
          minPercent: 60,
          minResponses: 1,
        },
      },
      {
        id: randomUUID(),
        label: minimumLabel,
        targetBlockId: target.id,
        condition: { kind: "correct_share", minPercent: 100, minResponses: 2 },
      },
      {
        id: randomUUID(),
        label: conditionLabel,
        targetBlockId: target.id,
        condition: {
          kind: "choice_share",
          choiceId: alternateId,
          minPercent: 100,
          minResponses: 1,
        },
      },
    ],
  };
  return {
    opening,
    checkpoint,
    skipped,
    target,
    closing,
    correctId,
    blocks: [opening, checkpoint, skipped, target, closing],
  };
}

async function selectCheckpoint(page: Page, prompt: string) {
  const navigator = await openE01Navigator(page);
  await navigator.getByRole("button").filter({ hasText: prompt }).click();
  for (const id of ["presentation-slide-navigator", "presentation-object-inspector"]) {
    const toggle = page.locator(`button[aria-controls="${id}"]`);
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
  }
  return page.getByRole("group", { name: copy("Answer branches"), exact: true });
}

async function snapshot(page: Page, id: string): Promise<PresentationHostSnapshot> {
  const response = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot;
}

async function openNavigation(page: Page) {
  await page.getByRole("button", { name: "탐색 열기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: copy("Presentation navigation"), exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("lang", "ko-KR");
  await expect(
    dialog.getByRole("button", { name: copy("Close navigation"), exact: true }),
  ).toBeFocused();
  return dialog;
}

function entry(dialog: Locator, title: string) {
  return dialog.getByRole("list").getByRole("button").filter({ hasText: title });
}

/** Drop only an accepted jump acknowledgement, retaining the exact command for replay. */
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
        socket.close({ code: 1012, reason: "Localized navigation acknowledgement lost" });
        return;
      }
      socket.send(message);
    });
  });
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: /^연결됨$/ })).toBeVisible();
  return { commands, dropped: () => dropped };
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean branch editing preserves raw labels, uppercase references, history and viewer grants ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const f = branchFixture();
    const record = await createE01Deck(page, f.blocks, 13);
    const saved = async () => (await readE01Record(page, record.id)).draft;
    const branches = async () => {
      const block = (await saved()).blocks[1];
      if (block?.kind !== "question") throw new Error("Expected the authored checkpoint");
      return block.branches;
    };
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === `/v1/presentations/${record.id}/draft`
      )
        writes.push(request.postData() ?? "");
    });
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      const editor = await selectCheckpoint(page, f.checkpoint.question.prompt);
      expect(copy("Answer branches")).toBe("답변 분기");
      await expect(editor).toHaveAttribute("lang", "ko-KR");
      const label = editor.getByRole("textbox", {
        name: copy("Branch {number} label", { number: 1 }),
        exact: true,
      });
      const percent = editor.getByRole("spinbutton", {
        name: copy("Branch {number} minimum percent", { number: 1 }),
        exact: true,
      });
      await expect(label).toHaveValue(originalLabel);
      await expect(label).toHaveAttribute("lang", "");
      await expect(
        editor.getByRole("combobox", {
          name: copy("Branch {number} answer choice", { number: 1 }),
          exact: true,
        }),
      ).toHaveValue(f.correctId);
      await expect(
        editor
          .getByRole("option", {
            name: "Original answer {number} <source>",
            exact: true,
          })
          .first(),
      ).toHaveAttribute("lang", "");
      await expect(
        editor.getByRole("combobox", {
          name: copy("Branch {number} target", { number: 1 }),
          exact: true,
        }),
      ).toHaveValue(f.target.id);
      expect(await saved()).toEqual(record.draft);
      expect(writes).toHaveLength(0);
      await label.fill(revisedLabel);
      await label.press("Tab");
      await expect.poll(async () => (await branches())?.[0]?.label).toBe(revisedLabel);
      await percent.fill("75");
      await percent.press("Tab");
      await expect.poll(async () => (await branches())?.[0]?.condition.minPercent).toBe(75);
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect
        .poll(async () => (await branches())?.[0])
        .toMatchObject({
          label: revisedLabel,
          condition: { minPercent: 60 },
        });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(branches).toEqual(f.checkpoint.branches);
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect
        .poll(async () => (await branches())?.[0])
        .toMatchObject({
          label: revisedLabel,
          targetBlockId: f.target.id.toUpperCase(),
          condition: { choiceId: f.correctId.toUpperCase(), minPercent: 75 },
        });
      await specialistQuality(page);
      await editor.screenshot({ path: info.outputPath("korean-answer-branches.png") });
      const finalDraft = await saved(),
        beforeLanguageChange = writes.length;
      await specialistLocale(page, "en-CA");
      await page.reload();
      await selectCheckpoint(page, f.checkpoint.question.prompt);
      await expect(page.getByRole("group", { name: "Answer branches", exact: true })).toBeVisible();
      expect(await saved()).toEqual(finalDraft);
      expect(writes.length).toBe(beforeLanguageChange);
      await specialistLocale(page, "ko-KR");
      await page.route(`${e01ApiUrl}/v1/auth/me`, async (route) => {
        const response = await route.fetch(),
          account = await response.json();
        account.creator.role = "viewer";
        await route.fulfill({ response, json: account });
      });
      await page.reload();
      await selectCheckpoint(page, f.checkpoint.question.prompt);
      const beforeViewer = writes.length;
      await expect(label).toHaveValue(revisedLabel);
      for (const control of await editor.locator("input, select, button").all())
        await expect(control).toBeDisabled();
      await specialistQuality(page);
      expect(await saved()).toEqual(finalDraft);
      expect(writes.length).toBe(beforeViewer);
    } finally {
      await page.unroute(`${e01ApiUrl}/v1/auth/me`);
      await specialistLocale(page, "en-CA");
    }
  });

  test(`Option B Korean host and Companion navigation preserve blocked branches and exact retry identity ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const f = branchFixture();
    const record = await createE01Deck(page, f.blocks, 13);
    let companion: Page | undefined;
    try {
      await specialistLocale(page, "ko-KR");
      const published = await page.request.post(
        `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
        { data: { expectedDraftRevision: record.draftRevision } },
      );
      expect(published.status(), await published.text()).toBe(200);
      const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
        data: { presentationId: record.id, timeMode: "flex" },
      });
      expect(created.status()).toBe(201);
      const { snapshot: initial, controlToken } = await created.json();
      const sessionId = initial.sessionId as string;
      await page.evaluate(
        ({ sessionId, controlToken }) =>
          sessionStorage.setItem(`openround:presentation-host:${sessionId}`, controlToken),
        { sessionId, controlToken },
      );
      await page.goto(`/presentation-session/${sessionId}/host`);
      const popup = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Companion 실행", exact: true }).click();
      companion = await popup;
      await companion.emulateMedia({ reducedMotion: "reduce" });
      if (suffix === "@mobile") await companion.setViewportSize({ width: 320, height: 844 });
      await expect(companion.getByRole("button", { name: "탐색 열기", exact: true })).toBeVisible();
      await page
        .getByRole("button", {
          name: koreanLive["live.presentationSession.advance.start"],
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await snapshot(page, sessionId)).currentBlock?.id)
        .toBe(f.opening.id);

      const trigger = page.getByRole("button", { name: "탐색 열기", exact: true });
      await trigger.focus();
      await trigger.press("Enter");
      let dialog = page.getByRole("dialog", { name: copy("Presentation navigation"), exact: true });
      await expect(
        dialog.getByRole("button", { name: copy("Close navigation"), exact: true }),
      ).toBeFocused();
      await expect(entry(dialog, "Original opening context")).toHaveAttribute(
        "aria-current",
        "step",
      );
      const beforeKeys = (await snapshot(page, sessionId)).revision;
      for (const key of ["ArrowRight", "PageDown", " "]) await dialog.press(key);
      expect((await snapshot(page, sessionId)).revision).toBe(beforeKeys);
      await specialistQuality(page);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();

      const transport = await loseJumpAcknowledgement(companion);
      dialog = await openNavigation(companion);
      expect(copy("Presentation navigation")).toBe("프레젠테이션 탐색");
      await expect(
        entry(dialog, "Original target {title} <context>").getByText(
          "Original target {title} <context>",
          { exact: true },
        ),
      ).toHaveAttribute("lang", "");
      await entry(dialog, "Original target {title} <context>").click();
      await expect.poll(transport.dropped).toBe(true);
      await expect
        .poll(async () => (await snapshot(page, sessionId)).currentBlock?.id)
        .toBe(f.target.id);
      await page
        .getByRole("button", {
          name: koreanLive["live.presentationSession.advance.next"],
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await snapshot(page, sessionId)).currentBlock?.id)
        .toBe(f.closing.id);
      await companion.reload();
      dialog = await openNavigation(companion);
      const retry = dialog.getByRole("button", {
        name: copy("Retry jump acknowledgement"),
        exact: true,
      });
      await expect(retry).toBeEnabled();
      await expect(dialog).toContainText(
        copy("Action not yet confirmed. Retry to confirm the original action."),
      );
      const beforeRetry = (await snapshot(page, sessionId)).revision;
      await retry.click();
      await expect(retry).toHaveCount(0);
      expect(transport.commands).toHaveLength(2);
      expect(transport.commands[1]).toBe(transport.commands[0]);
      expect(await snapshot(page, sessionId)).toMatchObject({
        revision: beforeRetry,
        currentBlockIndex: 4,
      });
      dialog = await openNavigation(companion);
      await expect(dialog).toContainText(`${copy("Return target:")} Original opening context`);
      await dialog
        .getByRole("button", {
          name: `${copy("Return to path:")} Original opening context`,
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await snapshot(page, sessionId)).currentBlock?.id)
        .toBe(f.opening.id);
      await page
        .getByRole("button", {
          name: koreanLive["live.presentationSession.advance.next"],
          exact: true,
        })
        .click();
      await expect.poll(async () => (await snapshot(page, sessionId)).phase).toBe("question_open");

      const blocked = localizeBranchNavigationFeedback(
        "ko-KR",
        "Close and reveal the current activity before navigating.",
      );
      for (const surface of [page, companion]) {
        dialog = await openNavigation(surface);
        await expect(entry(dialog, "Original closing context")).toBeDisabled();
        await expect(dialog.getByRole("status")).toHaveText(blocked.text);
        await expect(dialog.getByRole("status")).toHaveAttribute("lang", "ko-KR");
        const beforeDialogKeys = (await snapshot(page, sessionId)).revision;
        for (const key of ["ArrowRight", "PageDown", " "]) await dialog.press(key);
        expect((await snapshot(page, sessionId)).revision).toBe(beforeDialogKeys);
        await surface.keyboard.press("Escape");
        await expect(surface.getByRole("button", { name: "탐색 열기", exact: true })).toBeFocused();
        const branches = surface.getByRole("region", {
          name: copy("Answer branches"),
          exact: true,
        });
        await expect(branches.getByRole("button")).toHaveCount(3);
        for (const button of await branches.getByRole("button").all())
          await expect(button).toBeDisabled();
      }
      const joined = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions/join`, {
        data: { code: initial.code, nickname: `Localized branch ${randomUUID().slice(0, 8)}` },
      });
      expect(joined.status()).toBe(201);
      const { participantToken } = await joined.json();
      const accepted = await page.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/responses`,
        {
          data: {
            participantToken,
            blockId: f.checkpoint.id,
            expectedRevision: (await snapshot(page, sessionId)).revision,
            idempotencyKey: randomUUID(),
            response: { choiceIds: [f.correctId] },
          },
        },
      );
      expect(accepted.status()).toBe(202);
      expect(await accepted.json()).toMatchObject({ accepted: true, duplicate: false });
      await page
        .getByRole("button", {
          name: koreanLive["live.presentationSession.advance.reveal"],
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await snapshot(page, sessionId)).phase)
        .toBe("question_reveal");
      const closed = await snapshot(page, sessionId);
      expect(closed.responseCount).toBe(1);
      for (const surface of [page, companion]) {
        const branches = surface.getByRole("region", {
          name: copy("Answer branches"),
          exact: true,
        });
        await expect(branches).toHaveAttribute("lang", "ko-KR");
        await expect(branches).toContainText(
          copy("Choose an eligible branch after reveal. Next block keeps the numbered path."),
        );
        await expect(branches.getByRole("button").filter({ hasText: originalLabel })).toBeEnabled();
        await expect(branches.getByText(originalLabel, { exact: true })).toHaveAttribute(
          "lang",
          "",
        );
        await expect(branches.getByRole("button").filter({ hasText: minimumLabel })).toBeDisabled();
        await expect(branches).toContainText(
          copy("This branch needs at least {count} accepted responses.", { count: 2 }),
        );
        await expect(
          branches.getByRole("button").filter({ hasText: conditionLabel }),
        ).toBeDisabled();
        await expect(branches).toContainText(
          copy("The accepted responses do not meet this branch condition."),
        );
        await specialistQuality(surface);
      }
      await companion.screenshot({
        path: info.outputPath("korean-companion-branches.png"),
        fullPage: true,
      });
      await companion
        .getByRole("region", { name: copy("Answer branches"), exact: true })
        .getByRole("button")
        .filter({ hasText: originalLabel })
        .click();
      await expect
        .poll(async () => (await snapshot(page, sessionId)).currentBlock?.id)
        .toBe(f.target.id);
      dialog = await openNavigation(page);
      await expect(entry(dialog, f.checkpoint.question.prompt)).toContainText(
        `${copy("Activity")} · ${copy("Visited")} · ${copy("Review")}`,
      );
      await expect(entry(dialog, "Original unvisited context")).toContainText(copy("Not visited"));
      await specialistQuality(page);
      await dialog.screenshot({ path: info.outputPath("korean-navigation-review.png") });
      await dialog
        .getByRole("button", {
          name: `${copy("Return to path:")} ${f.checkpoint.question.prompt}`,
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await snapshot(page, sessionId)).phase)
        .toBe("question_reveal");
      const reviewed = await snapshot(page, sessionId);
      expect(reviewed.acceptingResponses).toBe(false);
      expect(reviewed.responseCount).toBe(closed.responseCount);
      expect(reviewed.participants.map(({ id, score }) => ({ id, score }))).toEqual(
        closed.participants.map(({ id, score }) => ({ id, score })),
      );
      expect((await readE01Record(page, record.id)).draft).toEqual(record.draft);
    } finally {
      await companion?.close();
      await specialistLocale(page, "en-CA");
    }
  });
}
