import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type {
  ContentSlideDraft,
  PresentationDraft,
  PresentationHostSnapshot,
  PresentationParticipantSnapshot,
  PresentationStagePassResponse,
  PresentationStageSnapshot,
} from "../../packages/contracts/src/index.ts";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });

type DeliveryFixture = Awaited<ReturnType<typeof createDeliverySession>>;

function deliverySlide(title: string, notes: string): ContentSlideDraft {
  return {
    ...e01Slide(title),
    speakerNotes: notes,
    citations: [{ locator: "PRIVATE E03 source", excerpt: "PRIVATE E03 source excerpt" }],
  };
}

async function createDeliverySession(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await signInBeta(page);
  const suffix = randomUUID().slice(0, 8);
  const slides = [
    deliverySlide(`Delivery opening ${suffix}`, "PRIVATE E03 opening speaker cue"),
    deliverySlide(`Delivery next ${suffix}`, "PRIVATE E03 second speaker cue"),
    deliverySlide(`Delivery closing ${suffix}`, "PRIVATE E03 closing speaker cue"),
  ];
  const hidden: ContentSlideDraft = {
    ...deliverySlide(`HIDDEN E03 planning ${suffix}`, "PRIVATE E03 hidden speaker cue"),
    hidden: true,
  };
  const question: Extract<PresentationDraft["blocks"][number], { kind: "question" }> = {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type: "single_select",
      prompt: `Delivery knowledge check ${suffix}`,
      choices: [
        { id: randomUUID(), label: "First delivery option", isCorrect: true },
        { id: randomUUID(), label: "Second delivery option", isCorrect: false },
      ],
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: ["synthetic"],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 120,
      basePoints: 100,
      explanation: "UNREVEALED E03 answer explanation",
      sourceCitations: [
        {
          sourceName: "PRIVATE E03 question source",
          sourceDigest: "a".repeat(64),
          locator: "PRIVATE E03 answer locator",
          excerpt: "PRIVATE E03 answer excerpt",
        },
      ],
      mediaId: null,
      mediaAlt: null,
    },
  };
  let record = await createE01Deck(page, [slides[0]!, hidden, ...slides.slice(1), question], 6);
  const titled = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
    data: {
      draft: {
        ...record.draft,
        title: "Delivery rehearsal: a clear plan for the next release",
      },
      expectedRevision: record.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(titled.status()).toBe(200);
  record = (await titled.json()).presentation;
  const published = await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/publish`, {
    data: { expectedDraftRevision: record.draftRevision },
  });
  expect(published.status()).toBe(200);
  const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
    data: { presentationId: record.id },
  });
  expect(created.status()).toBe(201);
  const { snapshot, controlToken } = (await created.json()) as {
    snapshot: PresentationHostSnapshot;
    controlToken: string;
  };
  await page.evaluate(
    ({ sessionId, token }) =>
      sessionStorage.setItem(`openround:presentation-host:${sessionId}`, token),
    { sessionId: snapshot.sessionId, token: controlToken },
  );
  return {
    sessionId: snapshot.sessionId,
    code: snapshot.code,
    record,
    slides,
    hidden,
    question,
    controlToken,
  };
}

async function deliveryContext(browser: Browser, page: Page, testInfo: TestInfo) {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  return browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
}

async function joinDeliveryAudience(context: BrowserContext, fixture: DeliveryFixture) {
  const page = await context.newPage();
  await page.goto(`/join?code=${fixture.code}`);
  await page.getByLabel("Nickname", { exact: true }).fill("E03 delivery audience");
  await page.getByRole("button", { name: "Join presentation", exact: true }).click();
  await expect(page).toHaveURL(`/presentation-session/${fixture.sessionId}/play`);
  return page;
}

async function hostSnapshot(page: Page, sessionId: string) {
  const response = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${sessionId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot as PresentationHostSnapshot;
}

async function participantSnapshot(page: Page, fixture: DeliveryFixture) {
  const token = await page.evaluate(
    (sessionId) => sessionStorage.getItem(`openround:presentation-participant:${sessionId}`),
    fixture.sessionId,
  );
  expect(Boolean(token)).toBe(true);
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${fixture.sessionId}/participant`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.status()).toBe(200);
  const snapshot = (await response.json()).snapshot as PresentationParticipantSnapshot;
  expect(snapshot).not.toHaveProperty("presenter");
  expect(snapshot).not.toHaveProperty("nextBlock");
  expect(snapshot.currentBlock).not.toHaveProperty("speakerNotes");
  expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE E03|HIDDEN E03/);
  return snapshot;
}

async function createStagePass(
  page: Page,
  sessionId: string,
): Promise<PresentationStagePassResponse> {
  const response = await page.request.post(
    `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/stage-pass`,
  );
  expect(response.status()).toBe(201);
  return response.json();
}

async function expectAudienceSafe(page: Page) {
  expect(await page.locator("body").innerText()).not.toMatch(/PRIVATE E03|HIDDEN E03/);
  await expect(
    page.getByRole("button", { name: /Start Presentation|Next block|Finish Presentation/ }),
  ).toHaveCount(0);
}

async function expectCompactPage(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}

async function expectWorkspaceHeading(page: Page, name: string) {
  const heading = page.getByRole("heading", { name, exact: true, level: 1 });
  await expect(heading).toBeVisible();
  expect(
    await heading.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeLessThanOrEqual(40);
}

function annotateDeliveryEmulation(testInfo: TestInfo, description: string) {
  testInfo.annotations.push({
    type: "emulation",
    description: `${description} Browser profiles are emulated; this does not verify actual screen sharing or a managed browser policy.`,
  });
}

for (const suffix of ["", " @mobile"]) {
  test(`delivery keeps private cues and frozen previews outside the scoped audience stage${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    annotateDeliveryEmulation(testInfo, "A separate browser tab exercises the scoped stage.");
    const moderationReads: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/response-moderation"))
        moderationReads.push(request.method());
    });
    const fixture = await createDeliverySession(page);
    await page.goto(`/presentation/${fixture.record.id}/host`);
    await expectWorkspaceHeading(page, fixture.record.draft.title);
    await expectCompactPage(page);
    await page.screenshot({ scale: "css", path: testInfo.outputPath("presentation-setup.png") });
    const audienceContext = await deliveryContext(browser, page, testInfo);
    try {
      const audience = await joinDeliveryAudience(audienceContext, fixture);
      await page.goto(`/presentation-session/${fixture.sessionId}/host`);
      await expect(
        page.getByRole("button", { name: "Start Presentation", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      const joinToggle = page.locator("summary").filter({ hasText: fixture.code });
      await joinToggle.click();
      const hostJoin = page.getByRole("region", { name: "Join this Presentation", exact: true });
      await expect(hostJoin).toBeVisible();
      expect(
        await hostJoin.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      const codeBounds = await hostJoin.getByText(fixture.code, { exact: true }).boundingBox();
      const copyBounds = await hostJoin
        .getByRole("button", { name: "Copy join link", exact: true })
        .boundingBox();
      expect(codeBounds).not.toBeNull();
      expect(copyBounds).not.toBeNull();
      expect(
        codeBounds!.x + codeBounds!.width <= copyBounds!.x + 1 ||
          codeBounds!.y + codeBounds!.height <= copyBounds!.y + 1 ||
          copyBounds!.y + copyBounds!.height <= codeBounds!.y + 1,
      ).toBe(true);
      await joinToggle.click();
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      const current = page.getByRole("region", { name: "Current slide", exact: true });
      const notes = page.getByRole("region", { name: "Private speaker notes", exact: true });
      const next = page.getByRole("region", { name: "Next slide preview", exact: true });
      const firstTitle = fixture.slides[0]!.scene!.nodes[0]!;
      const secondTitle = fixture.slides[1]!.scene!.nodes[0]!;
      if (firstTitle.type !== "text" || secondTitle.type !== "text") {
        throw new Error("Expected native delivery fixture titles");
      }
      await expect(current).toContainText(firstTitle.text);
      await expect(notes).toContainText(fixture.slides[0]!.speakerNotes);
      await expect(next).toContainText(secondTitle.text);
      expect(await next.innerText()).not.toMatch(/PRIVATE E03|HIDDEN E03/);
      await expect(audience.getByText(firstTitle.text, { exact: true })).toBeVisible();
      await expectAudienceSafe(audience);
      await participantSnapshot(audience, fixture);
      await expectCompactPage(page);
      await expectCompactPage(audience);
      await expect(page.getByRole("button", { name: "Next block", exact: true })).toBeInViewport({
        ratio: 1,
      });
      await audience.screenshot({
        scale: "css",
        path: testInfo.outputPath("presentation-participant.png"),
        fullPage: true,
      });

      const stageCreated = page.context().waitForEvent("page");
      await page.getByRole("button", { name: "Open audience stage", exact: true }).click();
      const stage = await stageCreated;
      try {
        await stage.setViewportSize(testInfo.project.use.viewport ?? { width: 1280, height: 720 });
        await expect(stage.getByText(firstTitle.text, { exact: true })).toBeVisible();
        await expect.poll(() => new URL(stage.url()).hash.length).toBe(0);
        expect(new URL(stage.url()).pathname).toBe(
          `/presentation-session/${fixture.sessionId}/stage`,
        );
        await expect(stage.getByText(secondTitle.text, { exact: true })).toHaveCount(0);
        await expectAudienceSafe(stage);
        await expectCompactPage(stage);
        expect(
          await stage.evaluate(() =>
            Object.keys(sessionStorage).some((key) =>
              /^openround:presentation-(?:host|companion|participant):/.test(key),
            ),
          ),
        ).toBe(false);
        const joinAccess = stage.getByRole("region", {
          name: "Join this Presentation",
          exact: true,
        });
        await expect(joinAccess).toContainText(fixture.code);
        await expect(joinAccess).toBeInViewport({ ratio: 1 });
        await expect(joinAccess.locator("svg")).toBeInViewport({ ratio: 1 });
        const joinLink = joinAccess.getByRole("link");
        await expect(joinLink).toHaveAttribute("href", /\/join\?code=/);
        const joinAddress = new URL((await joinLink.getAttribute("href"))!, stage.url());
        expect(joinAddress.searchParams.get("code")).toBe(fixture.code);
        await stage.reload();
        await expect(stage.getByText(firstTitle.text, { exact: true })).toBeVisible();
        await expect.poll(() => new URL(stage.url()).hash.length).toBe(0);
        await expectAudienceSafe(stage);

        // Editing and publishing a newer deck cannot rewrite a session's frozen version.
        const latest = await readE01Record(page, fixture.record.id);
        const saved = await page.request.put(
          `${e01ApiUrl}/v1/presentations/${fixture.record.id}/draft`,
          {
            data: {
              draft: {
                ...latest.draft,
                blocks: latest.draft.blocks.map((block) =>
                  block.kind === "content" && block.scene
                    ? {
                        ...block,
                        speakerNotes: "AUTHOR-ONLY revised speaker cue",
                        scene: {
                          ...block.scene,
                          nodes: block.scene.nodes.map((node) =>
                            node.type === "text" && node.role === "title"
                              ? { ...node, text: "AUTHOR-ONLY revised title" }
                              : node,
                          ),
                        },
                      }
                    : block,
                ),
              },
              expectedRevision: latest.draftRevision,
              mutationId: randomUUID(),
              schemaVersion: 2,
            },
          },
        );
        expect(saved.status()).toBe(200);
        const republished = await page.request.post(
          `${e01ApiUrl}/v1/presentations/${fixture.record.id}/publish`,
          { data: { expectedDraftRevision: (await saved.json()).presentation.draftRevision } },
        );
        expect(republished.status()).toBe(200);
        await page.reload();
        await expect(notes).toContainText(fixture.slides[0]!.speakerNotes);
        await expect(next).toContainText(secondTitle.text);
        await expect(stage.getByText(firstTitle.text, { exact: true })).toBeVisible();
        expect(await page.locator("body").innerText()).not.toContain("AUTHOR-ONLY");

        await page.getByRole("button", { name: "Next block", exact: true }).click();
        await expect(current).toContainText(secondTitle.text);
        await expect(notes).toContainText(fixture.slides[1]!.speakerNotes);
        await expect(stage.getByText(secondTitle.text, { exact: true })).toBeVisible();
        await expect(audience.getByText(secondTitle.text, { exact: true })).toBeVisible();
        await expectAudienceSafe(stage);
        await expectAudienceSafe(audience);
        expect((await participantSnapshot(audience, fixture)).currentBlockIndex).toBe(1);
        expect((await hostSnapshot(page, fixture.sessionId)).currentBlockIndex).toBe(1);
        expect((await new AxeBuilder({ page: stage }).analyze()).violations).toEqual([]);
        await stage.screenshot({
          path: testInfo.outputPath("delivery-scoped-stage-emulated.png"),
          fullPage: true,
        });
        await page.screenshot({
          path: testInfo.outputPath("delivery-private-host-emulated.png"),
          fullPage: true,
        });

        await page.getByRole("button", { name: "Next block", exact: true }).click();
        await expect(next).toContainText(fixture.question.question.prompt);
        expect(await next.innerText()).not.toMatch(/PRIVATE E03|UNREVEALED E03/);
        await page.getByRole("button", { name: "Next block", exact: true }).click();
        await expect(
          stage.getByText(fixture.question.question.prompt, { exact: true }),
        ).toBeVisible();
        await expect(
          audience.getByText(fixture.question.question.prompt, { exact: true }),
        ).toBeVisible();
        expect(await stage.locator("body").innerText()).not.toMatch(
          /PRIVATE E03|UNREVEALED E03|Correct answer/,
        );
        expect(JSON.stringify(await participantSnapshot(audience, fixture))).not.toContain(
          "UNREVEALED E03",
        );
        await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
        await expect(stage.getByText("Correct answer", { exact: true })).toBeVisible();
        await expect(
          stage.getByText(fixture.question.question.explanation, { exact: true }),
        ).toBeVisible();
        await expectAudienceSafe(stage);
        await expect(
          page.getByRole("region", { name: "Text response moderation", exact: true }),
        ).toHaveCount(0);
        expect(moderationReads).toEqual([]);
        await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
        await page.goto(`/presentation-session/${fixture.sessionId}/report`);
        await expectWorkspaceHeading(page, fixture.record.draft.title);
        await expect(
          page.getByRole("button", { name: "Share summary", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("region", { name: "Session insights", exact: true }).getByRole("button", {
            name: "Export coverage CSV",
            exact: true,
          }),
        ).toBeEnabled();
        await expectCompactPage(page);
        await page.screenshot({
          scale: "css",
          path: testInfo.outputPath("presentation-report.png"),
          fullPage: true,
        });
        await page.getByRole("button", { name: "Share summary", exact: true }).click();
        const summary = page.getByRole("dialog", { name: "Share summary", exact: true });
        await expect(summary).toBeVisible();
        await expect(summary.getByRole("button", { name: "Close", exact: true })).toBeInViewport({
          ratio: 1,
        });
        await expectCompactPage(page);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.screenshot({
          scale: "css",
          path: testInfo.outputPath("presentation-summary.png"),
        });
        await summary.getByRole("button", { name: "Close", exact: true }).click();
      } finally {
        await stage.close();
      }
    } finally {
      await audienceContext.close();
    }
  });

  test(`stage passes remain read-only, recover after refresh and stop after rotation or revocation${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const fixture = await createDeliverySession(page);
    const context = await deliveryContext(browser, page, testInfo);
    try {
      const initial = await hostSnapshot(page, fixture.sessionId);
      const started = await page.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${fixture.sessionId}/advance`,
        { data: { expectedRevision: initial.revision } },
      );
      expect(started.status()).toBe(200);
      const pass = await createStagePass(page, fixture.sessionId);
      const headers = { authorization: `Bearer ${pass.stageToken}` };
      const stageUrl = `${e01ApiUrl}/v1/presentation-sessions/${fixture.sessionId}/stage`;
      const response = await context.request.get(stageUrl, { headers });
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      const snapshot = (await response.json()).snapshot as PresentationStageSnapshot;
      expect(snapshot.projection).toBe("stage");
      expect(snapshot.currentBlock?.id).toBe(fixture.slides[0]!.id);
      expect(snapshot).not.toHaveProperty("presenter");
      expect(snapshot).not.toHaveProperty("nextBlock");
      expect(snapshot).not.toHaveProperty("participants");
      expect(snapshot).not.toHaveProperty("participantId");
      expect(snapshot.currentBlock).not.toHaveProperty("speakerNotes");
      expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE E03|HIDDEN E03/);

      // A display pass cannot become a participant, host controller, author or pass issuer.
      expect((await context.request.get(stageUrl)).status()).toBe(401);
      expect(
        (
          await context.request.get(stageUrl, {
            headers: { authorization: `Bearer ${fixture.controlToken}` },
          })
        ).status(),
      ).toBe(401);
      expect(
        (
          await context.request.get(
            `${e01ApiUrl}/v1/presentation-sessions/${fixture.sessionId}/participant`,
            { headers },
          )
        ).status(),
      ).toBe(401);
      expect(
        (
          await context.request.post(
            `${e01ApiUrl}/v1/presentation-sessions/${fixture.sessionId}/command`,
            {
              headers,
              data: {
                sessionId: fixture.sessionId,
                controlToken: pass.stageToken,
                commandId: randomUUID(),
                expectedRevision: snapshot.revision,
                action: "advance",
              },
            },
          )
        ).status(),
      ).toBe(401);
      expect(
        (
          await context.request.post(
            `${e01ApiUrl}/v1/presentation-sessions/${fixture.sessionId}/stage-pass`,
            { headers },
          )
        ).status(),
      ).toBe(401);
      expect(
        (
          await context.request.put(`${e01ApiUrl}/v1/presentations/${fixture.record.id}/draft`, {
            headers,
            data: {},
          })
        ).status(),
      ).toBe(401);
      expect(
        (
          await context.request.get(
            `${e01ApiUrl}/v1/presentation-sessions/${fixture.sessionId}/stage-media/${randomUUID()}`,
            { headers },
          )
        ).status(),
      ).toBe(404);
      expect((await hostSnapshot(page, fixture.sessionId)).revision).toBe(snapshot.revision);

      const stage = await context.newPage();
      const firstTitle = fixture.slides[0]!.scene!.nodes[0]!;
      if (firstTitle.type !== "text") throw new Error("Expected a native fixture title");
      await stage.goto(
        `/presentation-session/${fixture.sessionId}/stage#pass=${encodeURIComponent(pass.stageToken)}`,
      );
      await expect(stage.getByText(firstTitle.text, { exact: true })).toBeVisible();
      await expect.poll(() => new URL(stage.url()).hash.length).toBe(0);
      await stage.reload();
      await expect(stage.getByText(firstTitle.text, { exact: true })).toBeVisible();
      await expectAudienceSafe(stage);

      const replacement = await createStagePass(page, fixture.sessionId);
      expect((await context.request.get(stageUrl, { headers })).status()).toBe(401);
      await expect(stage.getByRole("main").getByRole("alert")).toContainText(
        /stage|pass|credential/i,
      );
      await expect(stage.getByText(firstTitle.text, { exact: true })).toHaveCount(0);
      expect(
        await stage.evaluate(
          (sessionId) =>
            sessionStorage.getItem(`openround:presentation-stage:${sessionId}`) === null,
          fixture.sessionId,
        ),
      ).toBe(true);

      await stage.goto("about:blank");
      await stage.goto(
        `/presentation-session/${fixture.sessionId}/stage#pass=${encodeURIComponent(replacement.stageToken)}`,
      );
      await expect(stage.getByText(firstTitle.text, { exact: true })).toBeVisible();
      const revoked = await page.request.delete(
        `${e01ApiUrl}/v1/presentation-sessions/${fixture.sessionId}/stage-passes/${replacement.credentialId}`,
      );
      expect(revoked.status()).toBe(204);
      await expect(stage.getByRole("main").getByRole("alert")).toContainText(
        /stage|pass|credential/i,
      );
      await expect(stage.getByText(firstTitle.text, { exact: true })).toHaveCount(0);
      await stage.reload();
      await expect(stage.getByText(firstTitle.text, { exact: true })).toHaveCount(0);
      expect(
        (
          await context.request.get(stageUrl, {
            headers: { authorization: `Bearer ${replacement.stageToken}` },
          })
        ).status(),
      ).toBe(401);
    } finally {
      await context.close();
    }
  });

  test(`presenter shortcuts respect editable, dialog and in-flight command fences while the timer stays local${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    annotateDeliveryEmulation(
      testInfo,
      "Controlled editable/dialog elements and a held websocket command exercise host keyboard guards.",
    );
    const fixture = await createDeliverySession(page);
    const initial = await hostSnapshot(page, fixture.sessionId);
    expect(
      (
        await page.request.post(
          `${e01ApiUrl}/v1/presentation-sessions/${fixture.sessionId}/advance`,
          { data: { expectedRevision: initial.revision } },
        )
      ).status(),
    ).toBe(200);
    let commands = 0;
    let releaseCommand: (() => void) | undefined;
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        const match = message.toString().match(/^42\d*(\[.*)$/);
        if (match) {
          const [event, command] = JSON.parse(match[1]!);
          if (event === "presentation.command" && command.action === "advance") {
            commands += 1;
            if (commands === 1) {
              releaseCommand = () => server.send(message);
              return;
            }
          }
        }
        server.send(message);
      });
      server.onMessage((message) => socket.send(message));
    });
    await page.goto(`/presentation-session/${fixture.sessionId}/host`);
    await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
    const advance = page.getByRole("button", { name: "Next block", exact: true });
    await expect(advance).toBeEnabled();

    const beforeTimer = await hostSnapshot(page, fixture.sessionId);
    const timer = page.getByRole("region", { name: "Presentation timer", exact: true });
    const elapsed = timer.getByRole("timer", { name: "Elapsed presentation time", exact: true });
    await expect(elapsed).toHaveText("00:00");
    await timer.getByRole("button", { name: "Start", exact: true }).click();
    await expect(elapsed).not.toHaveText("00:00");
    await timer.getByRole("button", { name: "Pause", exact: true }).click();
    const paused = await elapsed.innerText();
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
    await expect(elapsed).toHaveText(paused);
    await timer.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(elapsed).toHaveText("00:00");
    expect((await hostSnapshot(page, fixture.sessionId)).revision).toBe(beforeTimer.revision);
    expect(commands).toBe(0);

    await page.evaluate(() => {
      const input = document.createElement("textarea");
      input.setAttribute("aria-label", "Synthetic keyboard text field");
      input.dataset.deliveryFixture = "editable";
      document.querySelector("main")!.append(input);
      const dialog = document.createElement("section");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-label", "Synthetic keyboard modal");
      dialog.setAttribute("aria-modal", "true");
      dialog.dataset.deliveryFixture = "modal";
      dialog.hidden = true;
      document.querySelector("main")!.append(dialog);
    });
    const input = page.getByRole("textbox", { name: "Synthetic keyboard text field", exact: true });
    await input.fill("Keep the insertion point here");
    await input.press("ArrowRight");
    await input.press("PageDown");
    await input.press("Space");
    expect(commands).toBe(0);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      (document.querySelector('[data-delivery-fixture="modal"]') as HTMLElement).hidden = false;
    });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("PageDown");
    expect(commands).toBe(0);
    await page.evaluate(() => {
      document.querySelectorAll("[data-delivery-fixture]").forEach((element) => element.remove());
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => commands).toBe(1);
    await expect(page.getByRole("button", { name: "Updating…", exact: true })).toBeDisabled();
    await page.keyboard.press("PageDown");
    await page.keyboard.press("Space");
    expect(commands).toBe(1);
    releaseCommand!();
    await expect
      .poll(async () => (await hostSnapshot(page, fixture.sessionId)).currentBlockIndex)
      .toBe(1);
    await expect(advance).toBeEnabled();
    expect(commands).toBe(1);
  });

  test(`stage provides a direct popup fallback and survives disconnect and fullscreen denial before expiry${suffix}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    annotateDeliveryEmulation(
      testInfo,
      "window.open is controlled to simulate a popup restriction; fullscreen denial, a disconnected stage request and an expired-credential response are controlled browser fixtures.",
    );
    const fixture = await createDeliverySession(page);
    await page.goto(`/presentation-session/${fixture.sessionId}/host`);
    await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
    const firstTitle = fixture.slides[0]!.scene!.nodes[0]!;
    if (firstTitle.type !== "text") throw new Error("Expected a native fixture title");
    await page.evaluate(() => {
      window.open = () => null;
    });
    await page.getByRole("button", { name: "Open audience stage", exact: true }).click();
    const controls = page.getByRole("region", { name: "Audience stage controls", exact: true });
    await expect(controls.getByRole("status")).toContainText("blocked");
    const fallback = controls.getByRole("link", {
      name: "Open audience stage in a new tab",
      exact: true,
    });
    await expect(fallback).toHaveAttribute("rel", /noopener/);
    await page.context().addInitScript(() => {
      Object.defineProperty(Element.prototype, "requestFullscreen", {
        configurable: true,
        value: () =>
          Promise.reject(new DOMException("Synthetic fullscreen denial", "NotAllowedError")),
      });
    });
    const stageRequestSafety: Array<Promise<boolean>> = [];
    page.context().on("request", (request) => {
      const address = new URL(request.url());
      if (address.pathname === `/v1/presentation-sessions/${fixture.sessionId}/stage`) {
        stageRequestSafety.push(
          request.allHeaders().then((headers) => !headers.cookie && address.search.length === 0),
        );
      }
    });
    const stageCreated = page.context().waitForEvent("page");
    await fallback.click();
    const stage = await stageCreated;
    try {
      await stage.setViewportSize(testInfo.project.use.viewport ?? { width: 1280, height: 720 });
      await expect(stage.getByText(firstTitle.text, { exact: true })).toBeVisible();
      await expect.poll(() => new URL(stage.url()).hash.length).toBe(0);
      expect(await stage.evaluate(() => window.opener === null)).toBe(true);
      await stage.getByRole("button", { name: "Enter full screen", exact: true }).click();
      await expect(stage.getByRole("main").getByRole("alert")).toContainText(
        "continue presenting in this tab",
      );
      await expect(stage.getByText(firstTitle.text, { exact: true })).toBeVisible();
      const joinAccess = stage.getByRole("region", { name: "Join this Presentation", exact: true });
      await expect(joinAccess).toContainText(fixture.code);
      await expect(joinAccess).toBeInViewport({ ratio: 1 });
      await expect(joinAccess.locator("svg")).toBeInViewport({ ratio: 1 });
      let mode: "online" | "offline" | "expired" = "offline";
      await stage.route(`**/v1/presentation-sessions/${fixture.sessionId}/stage`, async (route) => {
        if (mode === "offline") await route.abort("connectionfailed");
        else if (mode === "expired") {
          await route.fulfill({
            status: 401,
            json: { error: { code: "UNAUTHORIZED", message: "Stage credential has expired" } },
          });
        } else await route.continue();
      });
      await expect(stage.getByRole("status").filter({ hasText: /Reconnecting/ })).toBeVisible();
      await expect(stage.getByText(firstTitle.text, { exact: true })).toBeVisible();
      mode = "online";
      await expect(stage.getByRole("status").filter({ hasText: /Reconnecting/ })).toHaveCount(0);
      await expect(stage.getByText(firstTitle.text, { exact: true })).toBeVisible();
      expect(stageRequestSafety.length).toBeGreaterThan(0);
      expect((await Promise.all(stageRequestSafety)).every(Boolean)).toBe(true);
      mode = "expired";
      await expect(
        stage.getByRole("heading", { name: "Audience stage unavailable", exact: true }),
      ).toBeVisible();
      await expect(stage.getByText(firstTitle.text, { exact: true })).toHaveCount(0);
      await expectAudienceSafe(stage);
      expect(
        await stage.evaluate(
          (sessionId) =>
            sessionStorage.getItem(`openround:presentation-stage:${sessionId}`) === null,
          fixture.sessionId,
        ),
      ).toBe(true);
    } finally {
      await stage.close();
    }
  });

  test(`stale host tabs cannot claim to revoke a newer audience stage${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    annotateDeliveryEmulation(
      testInfo,
      "Two host tabs share creator cookies and retain independent session storage; window.open is controlled to keep both stage launches on their direct-link fallback.",
    );
    const fixture = await createDeliverySession(page);
    const otherHost = await page.context().newPage();
    const scopedContext = await deliveryContext(browser, page, testInfo);
    const stageEndpoint = `${e01ApiUrl}/v1/presentation-sessions/${fixture.sessionId}/stage`;
    const credentialKey = `openround:presentation-stage-credential:${fixture.sessionId}`;
    let hostPassRequests = 0;
    page.context().on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          `/v1/presentation-sessions/${fixture.sessionId}/control-pass`
      ) {
        hostPassRequests += 1;
      }
    });
    try {
      await page.goto(`/presentation-session/${fixture.sessionId}/host`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await page.evaluate(() => {
        window.open = () => null;
      });
      const firstCreated = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/v1/presentation-sessions/${fixture.sessionId}/stage-pass`,
      );
      await page.getByRole("button", { name: "Open audience stage", exact: true }).click();
      const firstResponse = await firstCreated;
      expect(firstResponse.status()).toBe(201);
      const firstPass = (await firstResponse.json()) as PresentationStagePassResponse;
      const firstControls = page.getByRole("region", {
        name: "Audience stage controls",
        exact: true,
      });
      const firstRevoke = firstControls.getByRole("button", {
        name: "Revoke audience stage access",
        exact: true,
      });
      await expect(firstRevoke).toBeEnabled();

      // Reuse the control pass so this test isolates stage rotation from host handoff.
      await otherHost.addInitScript(
        ({ sessionId, token }) => {
          sessionStorage.setItem(`openround:presentation-host:${sessionId}`, token);
          window.open = () => null;
        },
        { sessionId: fixture.sessionId, token: fixture.controlToken },
      );
      await otherHost.goto(`/presentation-session/${fixture.sessionId}/host`);
      expect((await otherHost.request.get(`${e01ApiUrl}/v1/auth/me`)).status()).toBe(200);
      expect(
        await otherHost.evaluate((key) => sessionStorage.getItem(key) === null, credentialKey),
      ).toBe(true);
      const secondCreated = otherHost.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/v1/presentation-sessions/${fixture.sessionId}/stage-pass`,
      );
      await otherHost.getByRole("button", { name: "Open audience stage", exact: true }).click();
      const secondResponse = await secondCreated;
      expect(secondResponse.status()).toBe(201);
      const secondPass = (await secondResponse.json()) as PresentationStagePassResponse;
      const secondControls = otherHost.getByRole("region", {
        name: "Audience stage controls",
        exact: true,
      });
      const secondRevoke = secondControls.getByRole("button", {
        name: "Revoke audience stage access",
        exact: true,
      });
      await expect(secondRevoke).toBeEnabled();
      expect(hostPassRequests).toBe(0);
      expect(
        (
          await scopedContext.request.get(stageEndpoint, {
            headers: { authorization: `Bearer ${firstPass.stageToken}` },
          })
        ).status(),
      ).toBe(401);

      const staleRevoked = page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          new URL(response.url()).pathname ===
            `/v1/presentation-sessions/${fixture.sessionId}/stage-passes/${firstPass.credentialId}`,
      );
      await firstRevoke.click();
      const staleResponse = await staleRevoked;
      expect(staleResponse.status()).toBe(409);
      const staleError = (await staleResponse.json()).error as {
        code: string;
        details: { reason: string };
      };
      expect(staleError.code).toBe("CONFLICT");
      expect(staleError.details.reason).toBe("STALE_STAGE_PASS");
      await expect(firstControls.getByRole("alert")).toContainText(
        "No current stage access was revoked; a newer stage may still be open.",
      );
      await expect(firstControls).toContainText(
        "Use the host tab that opened the current stage, or open a replacement stage here and then revoke it.",
      );
      await expect(firstRevoke).toBeEnabled();
      await expect(
        firstControls.getByRole("link", { name: "Open audience stage in a new tab", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(({ key, id }) => sessionStorage.getItem(key) === id, {
          key: credentialKey,
          id: firstPass.credentialId,
        }),
      ).toBe(true);
      const stillOpen = await scopedContext.request.get(stageEndpoint, {
        headers: { authorization: `Bearer ${secondPass.stageToken}` },
      });
      expect(stillOpen.status()).toBe(200);
      expect(
        ((await stillOpen.json()).snapshot as PresentationStageSnapshot).currentBlock?.id,
      ).toBe(fixture.slides[0]!.id);

      const currentRevoked = otherHost.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          new URL(response.url()).pathname ===
            `/v1/presentation-sessions/${fixture.sessionId}/stage-passes/${secondPass.credentialId}`,
      );
      await secondRevoke.click();
      expect((await currentRevoked).status()).toBe(204);
      await expect(secondRevoke).toHaveCount(0);
      await expect(secondControls.getByRole("alert")).toHaveCount(0);
      expect(
        await otherHost.evaluate((key) => sessionStorage.getItem(key) === null, credentialKey),
      ).toBe(true);
      expect(
        (
          await scopedContext.request.get(stageEndpoint, {
            headers: { authorization: `Bearer ${secondPass.stageToken}` },
          })
        ).status(),
      ).toBe(401);
      await expect(firstRevoke).toBeEnabled();
      expect(
        await page.evaluate(({ key, id }) => sessionStorage.getItem(key) === id, {
          key: credentialKey,
          id: firstPass.credentialId,
        }),
      ).toBe(true);
    } finally {
      await otherHost.close();
      await scopedContext.close();
    }
  });
}
