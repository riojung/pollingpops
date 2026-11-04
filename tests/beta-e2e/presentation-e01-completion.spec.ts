import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  PresentationContentSchema,
  type ContentSlideDraft,
  type InteractiveQuestionBlockDraft,
} from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
  selectE01Block,
} from "./presentation-e01-support";

test.use({ actionTimeout: 30_000 });

for (const suffix of ["", " @mobile"]) {
  test(`E01 hidden slides retain authoring state and stay out of preview and live delivery${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const first = e01Slide("HIDDEN opening");
    const visible = e01Slide("Audience plan", true);
    const last = e01Slide("HIDDEN closing");
    const record = await createE01Deck(page, [first, visible, last]);
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, record.id, narrow);
    await page.getByRole("button", { name: "Hide slide", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show slide", exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const draft = (await readE01Record(page, record.id)).draft;
        return {
          version: draft.schemaVersion,
          hidden: (draft.blocks[0] as ContentSlideDraft).hidden,
        };
      })
      .toEqual({ version: 6, hidden: true });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hide slide", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show slide", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft.blocks.length)
      .toBe(4);
    const copy = (await readE01Record(page, record.id)).draft.blocks[1] as ContentSlideDraft;
    expect(copy.hidden).toBe(true);
    expect(copy.id).not.toBe(first.id);
    expect(
      copy.scene?.nodes.every(
        (node) => !first.scene!.nodes.some((source) => source.id === node.id),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, record.id)).draft.blocks.length)
      .toBe(3);
    await selectE01Block(page, "HIDDEN closing", narrow);
    await page.getByRole("button", { name: "Hide slide", exact: true }).click();
    await selectE01Block(page, "HIDDEN opening", narrow);
    await page.getByRole("button", { name: "Move later", exact: true }).click();
    await expect
      .poll(async () =>
        (await readE01Record(page, record.id)).draft.blocks.map((block) => block.id),
      )
      .toEqual([visible.id, first.id, last.id]);
    const hiddenDraft = (await readE01Record(page, record.id)).draft;
    expect((hiddenDraft.blocks[1] as ContentSlideDraft).scene).toEqual(first.scene);
    expect((hiddenDraft.blocks[2] as ContentSlideDraft).scene).toEqual(last.scene);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expect(
      preview.getByRole("heading", { name: "Audience plan", exact: true }),
    ).toBeVisible();
    await expect(preview.getByText(/HIDDEN (opening|closing)/)).toHaveCount(0);
    await page.getByRole("button", { name: "Close preview", exact: true }).click();
    await enterE01Editor(page, record.id, narrow);
    await expect(page.getByLabel("Native slide title", { exact: true })).toHaveValue(
      "Audience plan",
    );
    await page.getByRole("button", { name: "Hide slide", exact: true }).click();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(preview.getByText(/Show a slide|add an activity/i)).toBeVisible();
    await page.getByRole("button", { name: "Close preview", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hide slide", exact: true })).toBeVisible();
    const publishing = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const published = await publishing;
    expect(published.status()).toBe(200);
    const version = (await published.json()).version;
    expect(version.content.schemaVersion).toBe(6);
    expect(version.content.blocks.map((block: { id: string }) => block.id)).toEqual([visible.id]);
    expect(JSON.stringify(version.content)).not.toContain("HIDDEN");
    const hosted = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
      data: { presentationId: record.id },
    });
    expect(hosted.status()).toBe(201);
    const { snapshot: lobby, controlToken } = await hosted.json();
    const sessionId = lobby.sessionId as string;
    await page.evaluate(
      ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
      { id: sessionId, token: controlToken },
    );
    await page.goto(`/presentation-session/${sessionId}/host`);
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
    const guestContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce",
    });
    const guest = await guestContext.newPage();
    try {
      await guest.goto(`/join?code=${lobby.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("E01 audience");
      await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await expect(
        guest.getByRole("heading", { name: "Audience plan", exact: true }),
      ).toBeVisible();
      await expect(guest.locator("[data-native-scene] li strong")).toHaveText("Choose one action");
      expect(await guest.locator("body").innerText()).not.toMatch(/HIDDEN|PRIVATE/);
      // Restoring an authoring slide does not alter this already-published session.
      const latest = await readE01Record(page, record.id);
      const restored = {
        ...latest.draft,
        blocks: latest.draft.blocks.map((block) => {
          if (block.id !== first.id || block.kind !== "content") return block;
          const { hidden: _hidden, ...shown } = block;
          void _hidden;
          return shown;
        }),
      };
      const changed = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
        data: {
          draft: restored,
          expectedRevision: latest.draftRevision,
          mutationId: randomUUID(),
          schemaVersion: 2,
        },
      });
      expect(changed.status()).toBe(200);
      await guest.reload();
      await expect(
        guest.getByRole("heading", { name: "Audience plan", exact: true }),
      ).toBeVisible();
      expect(await guest.locator("body").innerText()).not.toContain("HIDDEN");
      await guest.screenshot({
        path: testInfo.outputPath("e01-visible-audience.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      await expect(guest.getByRole("heading", { name: "Thanks for participating" })).toBeVisible();
      await page.getByRole("link", { name: "Open session report", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Audience plan", exact: true })).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain("HIDDEN");
    } finally {
      await guestContext.close();
    }
  });
}

test("E01 filmstrip edits preserve linked-question topology", async ({ page }) => {
  await signInBeta(page);
  const recheckId = randomUUID();
  const question = (prompt: string, recheck = false): InteractiveQuestionBlockDraft => ({
    id: randomUUID(),
    kind: "question",
    question: {
      id: recheck ? recheckId : randomUUID(),
      type: "numeric",
      prompt,
      purpose: "diagnostic",
      confidence: "off",
      delivery: recheck ? "recheck" : "main",
      conceptKeys: ["e01.flow"],
      linkedRecheckQuestionId: recheck ? null : recheckId,
      correctValue: "7",
      tolerance: "0",
      unit: null,
      timeLimitSeconds: 30,
      basePoints: 100,
      explanation: "Private scoring rationale",
      mediaId: null,
      mediaAlt: null,
    },
  });
  const source = question("E01 source checkpoint");
  const target = question("E01 linked recheck", true);
  const visual = e01Slide("Intervening context");
  const record = await createE01Deck(page, [source, visual, target], 4);
  await enterE01Editor(page, record.id, false);
  await selectE01Block(page, "E01 linked recheck", false);
  await page.getByRole("button", { name: "Move earlier", exact: true }).click();
  await expect
    .poll(async () => (await readE01Record(page, record.id)).draft.blocks.map((block) => block.id))
    .toEqual([source.id, target.id, visual.id]);
  await expect(page.getByRole("button", { name: "Move earlier", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect.poll(async () => (await readE01Record(page, record.id)).draft.blocks.length).toBe(4);
  let draft = (await readE01Record(page, record.id)).draft;
  const copied = draft.blocks[2] as InteractiveQuestionBlockDraft;
  expect(copied.question.delivery).toBe("main");
  expect(copied.question.id).not.toBe(recheckId);
  expect(copied.question.linkedRecheckQuestionId).toBeNull();
  expect(PresentationContentSchema.safeParse(draft).success).toBe(true);
  await selectE01Block(page, "E01 source checkpoint", false);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(async () => (await readE01Record(page, record.id)).draft.blocks.length).toBe(3);
  draft = (await readE01Record(page, record.id)).draft;
  const retained = draft.blocks.find(
    (block) => block.id === target.id,
  ) as InteractiveQuestionBlockDraft;
  expect(retained.question.delivery).toBe("main");
  expect(retained.question.id).toBe(recheckId);
  expect(PresentationContentSchema.safeParse(draft).success).toBe(true);
});
