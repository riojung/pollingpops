import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  InteractiveQuestionBlockDraft,
  PresentationHostSnapshot,
  PresentationParticipantSnapshot,
  PresentationResponseSubmit,
  PresentationTextModerationAck,
  PresentationTextModerationPage,
  PresentationTextResponseResults,
} from "../../packages/contracts/src/index.ts";
import {
  openE01Inspector,
  clickNavigatorAction,
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  enterE01Editor,
  readE01Record,
  selectE01Block,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
type Host = { sessionId: string; code: string; controlToken: string };
const pendingCopy = "Response saved and waiting for facilitator review.";
const approvedCopy = "Response saved and approved.";
const removedCopy = "Response saved. The facilitator removed it from public results.";

function containsResponse(serialized: string, bodies: string[]) {
  return bodies.some((body) => serialized.includes(JSON.stringify(body).slice(1, -1)));
}

function textBlock(
  type: "open_text" | "word_cloud",
  prompt: string,
): InteractiveQuestionBlockDraft {
  return {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type,
      prompt,
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      linkedRecheckQuestionId: null,
      conceptKeys: [],
      timeLimitSeconds: 300,
      basePoints: 0,
      explanation: "Reviewed responses inform our next activity.",
      mediaId: null,
      mediaAlt: null,
      sourceCitations: [
        {
          sourceName: "PRIVATE TEXT AUTHOR",
          sourceDigest: "a".repeat(64),
          locator: "PRIVATE TEXT LOCATOR",
          excerpt: "PRIVATE TEXT CITATION",
        },
      ],
    },
  };
}

async function profileContext(browser: Browser, page: Page, info: TestInfo) {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
  return browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
}

async function credential(
  page: Page,
  id: string,
  role: "participant" | "stage" | "companion" | "host",
) {
  const token = await page.evaluate(
    ({ id, role }) => sessionStorage.getItem(`openround:presentation-${role}:${id}`),
    { id, role },
  );
  expect(Boolean(token), `Missing ${role} credential`).toBe(true);
  return token!;
}

async function hostSnapshot(page: Page, host: Host): Promise<PresentationHostSnapshot> {
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot;
}

async function participantSnapshot(
  page: Page,
  host: Host,
): Promise<PresentationParticipantSnapshot> {
  const token = await credential(page, host.sessionId, "participant");
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/participant`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot;
}

async function startHost(page: Page, recordId: string): Promise<Host> {
  const record = await readE01Record(page, recordId);
  const published = await page.request.post(`${e01ApiUrl}/v1/presentations/${recordId}/publish`, {
    data: { expectedDraftRevision: record.draftRevision },
  });
  expect(published.status()).toBe(200);
  const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
    data: { presentationId: recordId, timeMode: "flex" },
  });
  expect(created.status()).toBe(201);
  const { snapshot, controlToken } = await created.json();
  await page.evaluate(
    ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
    { id: snapshot.sessionId, token: controlToken },
  );
  await page.goto(`/presentation-session/${snapshot.sessionId}/host`);
  return { sessionId: snapshot.sessionId, code: snapshot.code, controlToken };
}

async function surfaces(browser: Browser, page: Page, info: TestInfo, host: Host) {
  const contexts: BrowserContext[] = [];
  const guests: Page[] = [];
  try {
    for (let index = 0; index < 6; index++) {
      const context = await profileContext(browser, page, info);
      contexts.push(context);
      const guest = await context.newPage();
      await guest.goto(`/join?code=${host.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill(`Text attendee ${index + 1}`);
      await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${host.sessionId}/play`);
      guests.push(guest);
    }
    const stageContext = await profileContext(browser, page, info);
    contexts.push(stageContext);
    expect((await stageContext.cookies()).length, "Stage must start without creator cookies").toBe(
      0,
    );
    const stage = await stageContext.newPage();
    const response = await page.request.post(
      `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/stage-pass`,
    );
    expect(response.status()).toBe(201);
    const pass = await response.json();
    await stage.goto(
      `/presentation-session/${host.sessionId}/stage#pass=${encodeURIComponent(pass.stageToken)}`,
    );
    await expect(
      stage.getByRole("region", { name: "Join this Presentation", exact: true }),
    ).toBeVisible();
    const companionContext = await profileContext(browser, page, info);
    contexts.push(companionContext);
    expect(
      (await companionContext.cookies()).length,
      "Companion must start without creator cookies",
    ).toBe(0);
    const companion = await companionContext.newPage();
    const companionResponse = await page.request.post(
      `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/companion-pass`,
    );
    expect(companionResponse.status()).toBe(201);
    const companionPass = await companionResponse.json();
    await companion.goto(
      `/presentation-session/${host.sessionId}/companion#pass=${encodeURIComponent(companionPass.companionToken)}`,
    );
    await expect(
      companion.getByRole("heading", { name: "Presentation Companion", exact: true }),
    ).toBeVisible();
    return {
      guests,
      stage,
      companion,
      close: async () => {
        await Promise.all(contexts.map((context) => context.close()));
      },
    };
  } catch (error) {
    await Promise.all(contexts.map((context) => context.close()));
    throw error;
  }
}

async function submit(page: Page, value: string, type: "open_text" | "word_cloud" = "open_text") {
  await page
    .getByLabel(type === "open_text" ? "Your response" : "A word or short phrase", { exact: true })
    .fill(value);
  await page.getByRole("button", { name: "Submit response", exact: true }).press("Enter");
  await expect(page.getByText(pendingCopy, { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
}

async function queue(
  page: Page,
  host: Host,
  status: "pending" | "approved" | "removed",
  blockId?: string,
): Promise<PresentationTextModerationPage> {
  const query = new URLSearchParams({ status, limit: "50", ...(blockId ? { blockId } : {}) });
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/response-moderation?${query}`,
    {
      headers: { authorization: `Bearer ${host.controlToken}` },
    },
  );
  expect(response.status()).toBe(200);
  return response.json();
}

async function moderate(
  page: Page,
  host: Host,
  responseId: string,
  status: "approved" | "removed",
) {
  const before = await hostSnapshot(page, host);
  const entries = [
    ...(await queue(page, host, "pending")).items,
    ...(await queue(page, host, "approved")).items,
  ];
  const item = entries.find((entry) => entry.responseId === responseId);
  if (!item) throw new Error("Expected an eligible response to moderate");
  const response = await page.request.post(
    `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/response-moderation/${responseId}`,
    {
      headers: { authorization: `Bearer ${host.controlToken}` },
      data: {
        commandId: randomUUID(),
        expectedRevision: before.revision,
        expectedModerationVersion: item.moderationVersion,
        status,
      },
    },
  );
  expect(response.status()).toBe(200);
  const ack = (await response.json()) as PresentationTextModerationAck;
  expect(ack.accepted).toBe(true);
  expect(ack.revision).toBe(before.revision);
  expect(ack.seq).toBe(before.seq + 1);
  expect(ack.response.moderationVersion).toBe(item.moderationVersion + 1);
  const after = await hostSnapshot(page, host);
  expect(after.revision).toBe(before.revision);
  expect(after.responseCount).toBe(before.responseCount);
  return ack;
}

async function publicResults(
  page: Page,
  host: Host,
  blockId: string,
  role: "participant" | "stage" | "companion",
): Promise<PresentationTextResponseResults> {
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/response-results?${new URLSearchParams({ blockId, role })}`,
    {
      headers: { authorization: `Bearer ${await credential(page, host.sessionId, role)}` },
    },
  );
  expect(response.status()).toBe(200);
  return response.json();
}

function watchIncoming(pages: Page[], bodies: string[]) {
  let leaked = false;
  for (const page of pages)
    page.on("websocket", (socket) =>
      socket.on("framereceived", ({ payload }) => {
        if (bodies.some((body) => String(payload).includes(body))) leaked = true;
      }),
    );
  return () => leaked;
}

async function assertBodyFree(page: Page, host: Host, bodies: string[]) {
  const snap = await participantSnapshot(page, host);
  expect(containsResponse(JSON.stringify(snap), bodies), "Snapshot exposed response text").toBe(
    false,
  );
  expect(snap.standing).toBeNull();
  expect(snap.responseResult).toBeNull();
  expect(
    await page.evaluate(
      (values) =>
        values.some((value) =>
          JSON.stringify({ ...sessionStorage, ...localStorage }).includes(value),
        ),
      bodies,
    ),
    "Browser storage exposed response text",
  ).toBe(false);
  return snap;
}

async function accountExcludes(page: Page, bodies: string[]) {
  const response = await page.request.get(`${e01ApiUrl}/v1/account/export`);
  expect(response.status()).toBe(200);
  const serialized = JSON.stringify(await response.json());
  expect(containsResponse(serialized, bodies), "Account export exposed private response text").toBe(
    false,
  );
}

async function publicProjectionPrivacy(
  pages: Array<[Page, "participant" | "stage" | "companion"]>,
  host: Host,
  bodies: string[],
) {
  for (const [page, role] of pages) {
    const response = await page.request.get(
      `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/${role}`,
      {
        headers: { authorization: `Bearer ${await credential(page, host.sessionId, role)}` },
      },
    );
    expect(response.status()).toBe(200);
    const snap = (await response.json()).snapshot;
    const serialized = JSON.stringify(snap);
    expect(
      containsResponse(serialized, bodies) ||
        /PRIVATE TEXT|speakerNotes|sourceCitations|"isCorrect"|authorAlias|moderationVersion/.test(
          serialized.replace(/"ownTextResponse":\{[^}]*\}/g, ""),
        ),
      "Public projection leaked private response/authoring data",
    ).toBe(false);
    expect("participants" in snap).toBe(false);
    if (role !== "participant") expect("ownTextResponse" in snap).toBe(false);
  }
}

async function fit(page: Page) {
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    path: location.pathname,
  }));
  expect(geometry.scroll <= geometry.width + 1, JSON.stringify(geometry)).toBe(true);
}

async function joinInViewport(stage: Page) {
  const join = stage.getByRole("region", { name: "Join this Presentation", exact: true });
  await expect(join).toBeInViewport({ ratio: 1 });
  await expect(join.locator("svg")).toBeInViewport({ ratio: 1 });
}

async function holdSubmissionAndLoseAck(page: Page, sessionId: string) {
  const submissions: PresentationResponseSubmit[] = [];
  let captured!: () => void;
  const firstSubmission = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let unlock!: () => void;
  const gate = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  let released = false;
  let sendLatestHeldSocket: (() => void) | undefined;
  let ackId: string | undefined;
  let dropped = false;
  await page.route(
    (url) => url.pathname === `/v1/presentation-sessions/${sessionId}/responses`,
    async (route) => {
      submissions.push({ sessionId, ...route.request().postDataJSON() });
      captured();
      if (!released) await gate;
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      if (!dropped) {
        dropped = true;
        await route.abort("failed");
      } else await route.fulfill({ response });
    },
  );
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const match = String(message).match(/^42(\d+)(\[.*)$/);
      if (match) {
        const [event, input] = JSON.parse(match[2]!) as [string, PresentationResponseSubmit];
        if (event === "presentation.response.submit") {
          submissions.push(input);
          captured();
          if (!released) {
            // Reconciliation can retry while moderation changes sequence. Hold every attempt,
            // then forward the latest callback instead of replaying a stale socket callback.
            sendLatestHeldSocket = () => {
              ackId = match[1];
              server.send(message);
            };
            return;
          }
          ackId = match[1];
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const wire = String(message);
      if (!dropped) {
        if (ackId && wire.startsWith(`43${ackId}[`)) {
          dropped = true;
          socket.close({ code: 1012, reason: "Synthetic lost acknowledgement" });
          return;
        }
        if (wire.includes('"responseReceipt"') && wire.includes('"responseSubmitted":true')) return;
      }
      socket.send(message);
    });
  });
  return {
    submissions,
    captured: firstSubmission,
    release: () => {
      if (released) return;
      released = true;
      sendLatestHeldSocket?.();
      unlock();
    },
    dropped: () => dropped,
  };
}

async function holdRead(page: Page, pathname: string) {
  let ready!: () => void;
  let release!: () => void;
  let finished!: () => void;
  const captured = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let held = false;
  const matcher = (url: URL) => url.pathname === pathname;
  await page.route(matcher, async (route) => {
    if (held) {
      await route.continue();
      return;
    }
    held = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    ready();
    await gate;
    // Scope changes abort reads. Delivery to an already aborted request is expected here.
    try {
      await route.fulfill({ response });
    } catch {
      /* already aborted */
    }
    finished();
  });
  return {
    captured,
    release: async () => {
      release();
      await done;
      await page.unroute(matcher);
    },
  };
}

for (const suffix of ["", " @mobile"]) {
  test(`Presentation text keeps an open-question submission valid across moderation and durable receipt recovery${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    info.annotations.push({
      type: "emulation",
      description:
        "Six isolated guest browser contexts; a controlled acknowledgement loss exercises production receipt recovery. Physical devices and screen sharing are not verified.",
    });
    await signInBeta(page);
    const first = textBlock("open_text", `Explain a priority ${randomUUID().slice(0, 8)}`);
    const second = textBlock("open_text", "A response that remains private");
    const record = await createE01Deck(page, [first, second], 10);
    const host = await startHost(page, record.id);
    const views = await surfaces(browser, page, info, host);
    const responseMarker = randomUUID();
    const bodies = [
      '=SUM(1,2)\n"literal", café',
      "REMOVED_PRIVATE_TEXT",
      "<script>Only plain text</script>",
      "Clear examples",
      "More practice",
      "A sixth priority",
    ].map((body) => `${body} [${responseMarker}]`);
    const pendingBody = `PENDING_PRIVATE_TEXT_${randomUUID()}`;
    const leaked = watchIncoming(
      [page, ...views.guests, views.stage, views.companion],
      [...bodies, pendingBody],
    );
    const last = views.guests[5]!;
    const wire = await holdSubmissionAndLoseAck(last, host.sessionId);
    await last.reload();
    try {
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      const input = views.guests[0]!.getByLabel("Your response", { exact: true });
      await input.fill(" ");
      await expect(
        views.guests[0]!.getByRole("button", { name: "Submit response", exact: true }),
      ).toBeDisabled();
      await input.fill("a".repeat(1001));
      await expect(
        views.guests[0]!.getByRole("button", { name: "Submit response", exact: true }),
      ).toBeDisabled();
      await input.evaluate((element) => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          element,
          "valid\u0001control",
        );
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await expect(
        views.guests[0]!.getByRole("button", { name: "Submit response", exact: true }),
      ).toBeDisabled();
      for (let index = 0; index < 5; index++) await submit(views.guests[index]!, bodies[index]!);
      await accountExcludes(page, bodies);
      await page
        .getByRole("region", { name: "Text response moderation", exact: true })
        .screenshot({ path: info.outputPath("text-host-moderation.png") });
      const ids = [];
      for (const guest of views.guests.slice(0, 5))
        ids.push((await assertBodyFree(guest, host, bodies)).responseReceipt!.responseId);
      await last.getByLabel("Your response", { exact: true }).fill(bodies[5]!);
      await last.getByRole("button", { name: "Submit response", exact: true }).click();
      await wire.captured;
      await expect(last.getByRole("status").filter({ hasText: /^Saving…$/ })).toBeVisible();
      const held = wire.submissions[0]!;
      const before = await hostSnapshot(page, host);
      expect(held.expectedRevision).toBe(before.revision);
      expect(before.participantCount).toBe(6);
      expect(before.responseCount).toBe(5);
      await moderate(page, host, ids[0]!, "approved");
      await moderate(page, host, ids[1]!, "removed");
      const afterModeration = await hostSnapshot(page, host);
      expect(afterModeration.phase).toBe("question_open");
      expect(afterModeration.revision).toBe(held.expectedRevision);
      expect(afterModeration.seq).toBe(before.seq + 2);
      expect(afterModeration.participantCount).toBe(6);
      expect(afterModeration.responseCount).toBe(5);
      wire.release();
      await expect.poll(wire.dropped).toBe(true);
      await expect(last.getByText(pendingCopy, { exact: true })).toBeVisible();
      await expect(last.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
      const lastSnap = await assertBodyFree(last, host, bodies);
      expect(lastSnap.ownTextResponse).toMatchObject({
        blockId: first.id,
        responseId: lastSnap.responseReceipt!.responseId,
        status: "pending",
        moderationVersion: 0,
      });
      expect(
        containsResponse(JSON.stringify(await hostSnapshot(page, host)), bodies),
        "Host snapshot exposed raw response text",
      ).toBe(false);
      await publicProjectionPrivacy(
        [
          [last, "participant"],
          [views.stage, "stage"],
          [views.companion, "companion"],
        ],
        host,
        bodies,
      );
      ids.push(lastSnap.responseReceipt!.responseId);
      for (const attempted of wire.submissions) {
        expect(attempted.idempotencyKey).toBe(held.idempotencyKey);
        expect(attempted.expectedRevision).toBe(held.expectedRevision);
        expect(attempted.response).toEqual({ textValue: bodies[5] });
      }
      const { sessionId: _sessionId, ...rest } = held;
      void _sessionId;
      const replay = await last.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/responses`,
        { data: rest },
      );
      expect(replay.status()).toBe(202);
      const replayAck = await replay.json();
      expect(replayAck.accepted).toBe(true);
      expect(replayAck.duplicate).toBe(true);
      expect(replayAck.responseId).toBe(lastSnap.responseReceipt!.responseId);
      const conflict = await last.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/responses`,
        { data: { ...rest, response: { textValue: "Changed response" } } },
      );
      expect(conflict.status()).toBe(409);
      expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
      expect((await hostSnapshot(page, host)).responseCount).toBe(6);
      const removed = await queue(page, host, "removed", first.id);
      expect(removed.items[0]!.textValue).toBeNull();
      await expect(views.guests[1]!.getByText(removedCopy, { exact: true })).toBeVisible();
      await views.guests[1]!.reload();
      await expect(views.guests[1]!.getByText(removedCopy, { exact: true })).toBeVisible();
      await expect(views.guests[1]!.getByLabel("Your response", { exact: true })).toHaveCount(0);
      for (const index of [2, 3, 4, 5]) await moderate(page, host, ids[index]!, "approved");
      await expect(last.getByText(approvedCopy, { exact: true })).toBeVisible();
      expect(await publicResults(last, host, first.id, "participant")).toMatchObject({
        visible: false,
        items: [],
        terms: [],
        nextCursor: null,
      });
      await expect(
        views.stage.getByText("Reviewed responses inform our next activity.", { exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await expect(
        views.stage.getByText("Reviewed responses inform our next activity.", { exact: true }),
      ).toBeVisible();
      const results = last.getByRole("region", { name: "Approved responses", exact: true });
      await expect(results).toContainText("5 approved respondents");
      await expect(results.getByText(bodies[5]!, { exact: true })).toBeVisible();
      await expect(results.locator("script")).toHaveCount(0);
      await expect(results.getByText(bodies[1]!, { exact: true })).toHaveCount(0);
      await expect(
        views.stage.getByRole("region", { name: "Approved responses", exact: true }),
      ).toContainText("5 approved respondents");
      await expect(
        views.stage
          .getByRole("region", { name: "Approved responses", exact: true })
          .getByRole("listitem")
          .first(),
      ).toBeInViewport({ ratio: 1 });
      await joinInViewport(views.stage);
      await views.companion.getByRole("button", { name: "Show results", exact: true }).click();
      await expect(
        views.companion.getByRole("region", { name: "Approved responses", exact: true }),
      ).toContainText("5 approved respondents");
      await views.companion.getByRole("button", { name: "Return to deck", exact: true }).click();
      await last.emulateMedia({ colorScheme: "dark" });
      expect((await new AxeBuilder({ page: last }).analyze()).violations).toEqual([]);
      for (const target of [last, views.stage, views.companion]) await fit(target);
      await views.stage.screenshot({
        path: info.outputPath("text-approved-stage.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(
        last.getByRole("heading", { name: second.question.prompt, exact: true }),
      ).toBeVisible();
      await submit(last, pendingBody);
      const old = await last.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/response-results?${new URLSearchParams({ blockId: first.id, role: "participant" })}`,
        {
          headers: {
            authorization: `Bearer ${await credential(last, host.sessionId, "participant")}`,
          },
        },
      );
      expect(old.status()).toBe(404);
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      const legacyReport = await page.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/report?includeOpinionResults=true`,
      );
      expect(legacyReport.status()).toBe(422);
      const reported = await page.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/report?includeSessionContext=true&includeQuickChecks=true&includeOpinionResults=true&includeTextResults=true`,
      );
      expect(reported.status()).toBe(200);
      const report = (await reported.json()).report;
      expect(report.schemaVersion).toBe(5);
      expect(report.leaderboard).toEqual([]);
      expect(report.recovery).toEqual([]);
      const publicText = JSON.stringify(report);
      expect(
        publicText.includes(pendingBody) || publicText.includes(bodies[1]!),
        "Report exposed unapproved response",
      ).toBe(false);
      expect(publicText.includes(bodies[5]!)).toBe(true);
      expect(
        /Text attendee|PRIVATE TEXT|authorAlias|participantId|moderationVersion/.test(publicText),
        "Report exposed identities or private metadata",
      ).toBe(false);
      for (const evidence of report.evidence)
        expect(evidence).toMatchObject({ correct: null, accuracyPercent: null, totalScore: 0 });
      await page.goto(`/presentation-session/${host.sessionId}/report`);
      await expect(page.getByText("5 approved respondents", { exact: true })).toBeVisible();
      await expect(page.getByText("Accuracy", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Leaderboard", exact: true })).toHaveCount(0);
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export evidence CSV", exact: true }).click();
      const download = await downloaded;
      const csv = await readFile((await download.path())!, "utf8");
      expect(csv).toContain('"approved_text"');
      expect(csv).toContain("'=SUM(1,2)");
      expect(csv).toContain('""literal""');
      expect(
        csv.includes(pendingBody) || csv.includes(bodies[1]!) || csv.includes("Text attendee"),
        "CSV exposed private response or identity",
      ).toBe(false);
      await accountExcludes(page, [pendingBody, bodies[1]!]);
      await assertBodyFree(last, host, [...bodies, pendingBody]);
      expect(leaked(), "A realtime snapshot exposed raw response text").toBe(false);
      await page.screenshot({ path: info.outputPath("text-v5-report.png"), fullPage: true });
    } finally {
      await views.close();
    }
  });

  test(`Presentation word clouds fence approved results, retained moderation retries and host authority${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    info.annotations.push({
      type: "emulation",
      description:
        "Controlled late HTTP delivery and moderation acknowledgement loss exercise real production reads/writes; desktop and phone profiles are emulated.",
    });
    await signInBeta(page);
    const block = textBlock("word_cloud", `Share a word ${randomUUID().slice(0, 8)}`);
    const record = await createE01Deck(page, [block], 10);
    const host = await startHost(page, record.id);
    const views = await surfaces(browser, page, info, host);
    const caseSalt = randomUUID().slice(0, 8);
    const cafeTerm = `café ${caseSalt}`;
    const practiceTerm = `practice ${caseSalt}`;
    const removedOriginal = `CAFÉ ${caseSalt}`;
    const words = [
      `CAFE\u0301 ${caseSalt}`,
      cafeTerm,
      ` ${cafeTerm} `,
      `Café ${caseSalt}`,
      `Practice ${caseSalt}`,
      ` ${practiceTerm} `,
    ];
    const ids: string[] = [];
    let replacementHost: Page | undefined;
    try {
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      const phrase = views.guests[0]!.getByLabel("A word or short phrase", { exact: true });
      await phrase.fill("a".repeat(81));
      await expect(
        views.guests[0]!.getByRole("button", { name: "Submit response", exact: true }),
      ).toBeDisabled();
      for (const [index, guest] of views.guests.entries()) {
        await submit(guest, words[index]!, "word_cloud");
        ids.push(
          (await assertBodyFree(guest, host, [words[index]!.normalize("NFC").trim()]))
            .responseReceipt!.responseId,
        );
      }
      const original = await hostSnapshot(page, host);
      const firstItem = (await queue(page, host, "pending", block.id)).items.find(
        (item) => item.responseId === ids[0],
      )!;
      const route = `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/response-moderation`;
      for (const token of [
        null,
        await credential(views.guests[0]!, host.sessionId, "participant"),
        await credential(views.stage, host.sessionId, "stage"),
        await credential(views.companion, host.sessionId, "companion"),
      ]) {
        const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
        const deniedRead = await page.request.get(route, { headers });
        expect(deniedRead.status()).toBe(401);
        expect((await deniedRead.json()).error.code).toBe("UNAUTHORIZED");
        const deniedWrite = await page.request.post(`${route}/${firstItem.responseId}`, {
          headers,
          data: {
            commandId: randomUUID(),
            expectedRevision: original.revision,
            expectedModerationVersion: 0,
            status: "approved",
          },
        });
        expect(deniedWrite.status()).toBe(401);
        expect((await deniedWrite.json()).error.code).toBe("UNAUTHORIZED");
      }
      const badBearer = await page.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/response-results?${new URLSearchParams({ blockId: block.id, role: "host" })}`,
        { headers: { authorization: "Bearer invalid-room-credential" } },
      );
      expect(badBearer.status()).toBe(401);
      expect((await hostSnapshot(page, host)).seq).toBe(original.seq);
      const moderation = page.getByRole("region", {
        name: "Text response moderation",
        exact: true,
      });
      await expect(moderation.getByText(removedOriginal, { exact: true })).toBeVisible();
      const requests: unknown[] = [];
      let lostAck: PresentationTextModerationAck | undefined;
      const moderationMatcher = (url: URL) =>
        url.pathname ===
        `/v1/presentation-sessions/${host.sessionId}/response-moderation/${ids[0]}`;
      await page.route(moderationMatcher, async (intercepted) => {
        requests.push(intercepted.request().postDataJSON());
        if (requests.length === 1) {
          const response = await intercepted.fetch();
          expect(response.status()).toBe(200);
          lostAck = await response.json();
          await intercepted.abort("failed");
        } else await intercepted.continue();
      });
      await moderation
        .getByRole("listitem")
        .filter({ has: page.getByText(removedOriginal, { exact: true }) })
        .getByRole("button", { name: "Approve response", exact: true })
        .click();
      await expect(
        moderation.getByRole("button", { name: "Retry review acknowledgement", exact: true }),
      ).toBeEnabled();
      expect((await hostSnapshot(page, host)).revision).toBe(original.revision);
      const retryResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/v1/presentation-sessions/${host.sessionId}/response-moderation/${ids[0]}`,
      );
      await moderation
        .getByRole("button", { name: "Retry review acknowledgement", exact: true })
        .click();
      const retried = await retryResponse;
      expect(retried.status()).toBe(200);
      const acknowledgement = (await retried.json()) as PresentationTextModerationAck;
      expect(acknowledgement.duplicate).toBe(true);
      expect(acknowledgement.receipt).toEqual(lostAck!.receipt);
      expect(requests[1]).toEqual(requests[0]);
      expect((await hostSnapshot(page, host)).seq).toBe(original.seq + 1);
      await expect(
        moderation.getByRole("button", { name: "Retry review acknowledgement", exact: true }),
      ).toHaveCount(0);
      await page.unroute(moderationMatcher);
      for (let index = 1; index < 5; index++) await moderate(page, host, ids[index]!, "approved");
      expect(await publicResults(views.guests[0]!, host, block.id, "participant")).toMatchObject({
        visible: false,
        items: [],
        terms: [],
      });
      await expect(
        views.stage.getByText("Reviewed responses inform our next activity.", { exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await expect(
        views.stage.getByText("Reviewed responses inform our next activity.", { exact: true }),
      ).toBeVisible();
      await views.companion.getByRole("button", { name: "Show results", exact: true }).click();
      const targets = [views.guests[0]!, views.stage, views.companion];
      for (const target of targets) {
        const table = target.getByRole("table", { name: "Word-cloud counts", exact: true });
        await expect(
          table
            .getByRole("row")
            .filter({ has: target.getByRole("rowheader", { name: cafeTerm, exact: true }) })
            .getByRole("cell"),
        ).toHaveText("4");
        await expect(
          table
            .getByRole("row")
            .filter({ has: target.getByRole("rowheader", { name: practiceTerm, exact: true }) })
            .getByRole("cell"),
        ).toHaveText("1");
      }
      const cloud = await publicResults(views.guests[0]!, host, block.id, "participant");
      await publicProjectionPrivacy(
        [
          [views.guests[0]!, "participant"],
          [views.stage, "stage"],
          [views.companion, "companion"],
        ],
        host,
        words.map((word) => word.normalize("NFC").trim()),
      );
      expect(cloud.terms.map(({ value, count, percent }) => ({ value, count, percent }))).toEqual([
        { value: cafeTerm, count: 4, percent: 80 },
        { value: practiceTerm, count: 1, percent: 20 },
      ]);
      expect(/responseId|participantId|authorAlias|submittedAt/.test(JSON.stringify(cloud))).toBe(
        false,
      );
      const stale = await holdRead(
        views.guests[0]!,
        `/v1/presentation-sessions/${host.sessionId}/response-results`,
      );
      await views.guests[0]!.getByRole("region", { name: "Approved responses", exact: true })
        .getByRole("button", { name: "Refresh responses", exact: true })
        .click();
      await stale.captured;
      await moderate(page, host, ids[0]!, "removed");
      for (const target of targets) {
        await expect(
          target.getByRole("table", { name: "Word-cloud counts", exact: true }),
        ).toHaveCount(0);
        await expect(
          target.getByRole("region", { name: "Approved responses", exact: true }),
        ).toContainText("at least five approved respondents");
      }
      await stale.release();
      await views.guests[0]!.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(
        views.guests[0]!.getByRole("table", { name: "Word-cloud counts", exact: true }),
      ).toHaveCount(0);
      expect(await publicResults(views.guests[0]!, host, block.id, "participant")).toMatchObject({
        visible: false,
        approvedRespondents: 4,
        items: [],
        terms: [],
        nextCursor: null,
      });
      await moderate(page, host, ids[5]!, "approved");
      for (const target of targets) {
        const table = target.getByRole("table", { name: "Word-cloud counts", exact: true });
        await expect(
          table
            .getByRole("row")
            .filter({ has: target.getByRole("rowheader", { name: cafeTerm, exact: true }) })
            .getByRole("cell"),
        ).toHaveText("3");
        await expect(
          table
            .getByRole("row")
            .filter({ has: target.getByRole("rowheader", { name: practiceTerm, exact: true }) })
            .getByRole("cell"),
        ).toHaveText("2");
        await fit(target);
      }
      const stageCanvas = views.stage.getByRole("region", { name: "Audience slide", exact: true });
      expect(await stageCanvas.evaluate((element) => element.scrollTop)).toBe(0);
      await expect(
        stageCanvas.getByRole("columnheader", { name: "Word or phrase", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect(stageCanvas.getByRole("rowheader").first()).toBeInViewport({ ratio: 1 });
      await joinInViewport(views.stage);
      await views.stage.screenshot({
        path: info.outputPath("word-cloud-stage.png"),
        fullPage: true,
      });
      await views.guests[0]!.screenshot({
        path: info.outputPath("word-cloud-participant.png"),
        fullPage: true,
      });
      const counts = views.guests[0]!.getByRole("region", {
        name: "Word-cloud counts",
        exact: true,
      });
      await counts.focus();
      await expect(counts).toBeFocused();
      if (await counts.evaluate((element) => element.scrollWidth > element.clientWidth)) {
        await counts.press("ArrowRight");
        await expect
          .poll(() => counts.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
        await counts.press("ArrowLeft");
        await expect.poll(() => counts.evaluate((element) => element.scrollLeft)).toBe(0);
      }
      await views.guests[0]!.reload();
      await expect(views.guests[0]!.getByText(removedCopy, { exact: true })).toBeVisible();
      await assertBodyFree(views.guests[0]!, host, [removedOriginal]);
      await expect(
        views.guests[0]!.getByLabel("A word or short phrase", { exact: true }),
      ).toHaveCount(0);
      expect((await queue(page, host, "removed", block.id)).items[0]!.textValue).toBeNull();
      await moderation.getByRole("button", { name: "Approved", exact: true }).click();
      await expect(moderation.getByText("Text attendee 6", { exact: true })).toBeVisible();
      const privateRead = await holdRead(
        page,
        `/v1/presentation-sessions/${host.sessionId}/response-moderation`,
      );
      await moderation.getByRole("button", { name: "Refresh responses", exact: true }).click();
      await privateRead.captured;
      const rotated = await page.request.post(
        `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/control-pass`,
      );
      expect(rotated.status()).toBe(201);
      const nextToken = (await rotated.json()).controlToken as string;
      const deniedOld = await page.request.get(route, {
        headers: { authorization: `Bearer ${host.controlToken}` },
      });
      expect(deniedOld.status()).toBe(401);
      const newHost = { ...host, controlToken: nextToken };
      expect((await queue(page, newHost, "approved", block.id)).items).toHaveLength(5);
      const refreshAfterRotation = moderation.getByRole("button", {
        name: "Refresh responses",
        exact: true,
      });
      if (await refreshAfterRotation.isVisible()) await refreshAfterRotation.click();
      await expect(moderation.getByText("Text attendee 6", { exact: true })).toHaveCount(0);
      await privateRead.release();
      await expect(moderation.getByText("Text attendee 6", { exact: true })).toHaveCount(0);
      replacementHost = await page.context().newPage();
      await replacementHost.addInitScript(
        ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
        { id: host.sessionId, token: nextToken },
      );
      await replacementHost.goto(`/presentation-session/${host.sessionId}/host`);
      await replacementHost
        .getByRole("button", { name: "Finish Presentation", exact: true })
        .click();
      const finishedWrite = await replacementHost.request.post(`${route}/${ids[5]}`, {
        headers: { authorization: `Bearer ${nextToken}` },
        data: {
          commandId: randomUUID(),
          expectedRevision: (await hostSnapshot(replacementHost, newHost)).revision,
          expectedModerationVersion: 1,
          status: "removed",
        },
      });
      expect(finishedWrite.status()).toBe(409);
      expect((await finishedWrite.json()).error.code).toBe("PHASE_CLOSED");
      const reported = await replacementHost.request.get(
        `${e01ApiUrl}/v1/presentation-sessions/${host.sessionId}/report?includeOpinionResults=true&includeTextResults=true`,
      );
      expect(reported.status()).toBe(200);
      const report = (await reported.json()).report;
      expect(report.schemaVersion).toBe(5);
      expect(
        report.evidence[0].textResults.buckets.map(
          ({ value, count, percent }: { value: string; count: number; percent: number }) => ({
            value,
            count,
            percent,
          }),
        ),
      ).toEqual([
        { value: cafeTerm, count: 3, percent: 60 },
        { value: practiceTerm, count: 2, percent: 40 },
      ]);
      await replacementHost.goto(`/presentation-session/${host.sessionId}/report`);
      const exported = replacementHost.waitForEvent("download");
      await replacementHost
        .getByRole("button", { name: "Export evidence CSV", exact: true })
        .click();
      const csv = await readFile((await (await exported).path())!, "utf8");
      expect(csv).toContain(`"${cafeTerm}","3","5","60"`);
      expect(csv).toContain(`"${practiceTerm}","2","5","40"`);
      expect(
        csv.includes(removedOriginal) || csv.includes("Text attendee"),
        "Cloud export exposed removed text or identity",
      ).toBe(false);
      await accountExcludes(replacementHost, [removedOriginal]);

      expect((await new AxeBuilder({ page: views.guests[0]! }).analyze()).violations).toEqual([]);
    } finally {
      await replacementHost?.close();
      await views.close();
    }
  });

  test(`Presentation text authoring and published Round copies retain version 10 through history and design${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    const sourceTitle = `Text source ${randomUUID().slice(0, 8)}`;
    const sources = [
      textBlock("open_text", "Copied reflection"),
      textBlock("word_cloud", "Copied cloud"),
    ];
    const created = await page.request.post(`${e01ApiUrl}/v1/quizzes`, {
      data: { title: sourceTitle },
    });
    expect(created.status()).toBe(201);
    let source = (await created.json()).quiz;
    const saved = await page.request.patch(`${e01ApiUrl}/v1/quizzes/${source.id}`, {
      data: {
        expectedDraftRevision: source.draftRevision,
        draft: {
          title: sourceTitle,
          description: "",
          questions: sources.map((block) => block.question),
        },
      },
    });
    expect(saved.status()).toBe(200);
    source = (await saved.json()).quiz;
    expect(
      (
        await page.request.post(`${e01ApiUrl}/v1/quizzes/${source.id}/publish`, {
          data: { expectedDraftRevision: source.draftRevision },
        })
      ).status(),
    ).toBe(200);
    const starter: InteractiveQuestionBlockDraft = {
      id: randomUUID(),
      kind: "question",
      question: {
        id: randomUUID(),
        type: "single_select",
        prompt: "An activity to convert",
        purpose: "diagnostic",
        confidence: "required",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 300,
        basePoints: 1000,
        explanation: "An explanation",
        mediaId: null,
        mediaAlt: null,
        choices: ["One", "Two"].map((label, index) => ({
          id: randomUUID(),
          label,
          isCorrect: index === 0,
        })),
      },
    };
    const destination = await createE01Deck(page, [starter], 2);
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    await enterE01Editor(page, destination.id, narrow);
    if (narrow) await page.getByRole("button", { name: "Open inspector", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Question type", exact: true })
      .selectOption("open_text");
    await expect
      .poll(async () => (await readE01Record(page, destination.id)).draft.schemaVersion)
      .toBe(10);
    await expect(page.getByRole("combobox", { name: "Points", exact: true })).toBeDisabled();
    await expect(
      page.getByText(/Participants submit plain text up to 1000 characters/),
    ).toBeVisible();
    if (narrow) await page.getByRole("button", { name: "Hide inspector", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, destination.id)).draft.schemaVersion)
      .toBe(10);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await readE01Record(page, destination.id)).draft.blocks[0]!.kind === "question" &&
          (
            (await readE01Record(page, destination.id)).draft
              .blocks[0] as InteractiveQuestionBlockDraft
          ).question.type,
      )
      .toBe("open_text");
    await clickNavigatorAction(page, /From published Round/);
    const picker = page.getByRole("dialog", { name: "Insert from a published Round", exact: true });
    await picker
      .getByRole("combobox", { name: "Source Round", exact: true })
      .selectOption(source.id);
    for (const block of sources) {
      const choice = picker.getByRole("checkbox", { name: new RegExp(block.question.prompt) });
      await expect(choice).toBeEnabled();
      await choice.check();
    }
    const imported = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${destination.id}/blocks/import`,
    );
    await picker.getByRole("button", { name: "Insert 2", exact: true }).click();
    expect((await imported).status()).toBe(200);
    await expect(picker).toHaveCount(0);
    const copied = (await readE01Record(page, destination.id)).draft;
    expect(copied.schemaVersion).toBe(10);
    expect(copied.blocks).toHaveLength(3);
    for (const original of sources) {
      const block = copied.blocks.find(
        (candidate) =>
          candidate.kind === "question" && candidate.question.prompt === original.question.prompt,
      );
      if (block?.kind !== "question") throw new Error("Expected independent text copy");
      expect(block.id).not.toBe(original.id);
      expect(block.question.id).not.toBe(original.question.id);
      expect(block.question).toMatchObject({
        type: original.question.type,
        purpose: "opinion",
        confidence: "off",
        basePoints: 0,
        delivery: "main",
        linkedRecheckQuestionId: null,
      });
      expect(block.question).not.toHaveProperty("choices");
      expect(block.question).not.toHaveProperty("correctValue");
    }
    const revised = await page.request.patch(`${e01ApiUrl}/v1/quizzes/${source.id}`, {
      data: {
        expectedDraftRevision: source.draftRevision,
        draft: {
          ...source.draft,
          questions: sources.map((block) => ({
            ...block.question,
            prompt: "AUTHOR-ONLY changed source",
          })),
        },
      },
    });
    expect(revised.status()).toBe(200);
    source = (await revised.json()).quiz;
    expect(
      (
        await page.request.post(`${e01ApiUrl}/v1/quizzes/${source.id}/publish`, {
          data: { expectedDraftRevision: source.draftRevision },
        })
      ).status(),
    ).toBe(200);
    expect((await readE01Record(page, destination.id)).draft).toEqual(copied);
    if (
      narrow &&
      (await page.getByRole("button", { name: "Collapse map", exact: true }).isVisible())
    )
      await page.getByRole("button", { name: "Collapse map", exact: true }).click();
    await selectE01Block(page, starter.question.prompt, narrow);
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, destination.id)).draft.blocks.length)
      .toBe(4);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, destination.id)).draft.blocks.length)
      .toBe(3);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, destination.id)).draft.blocks.length)
      .toBe(4);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => (await readE01Record(page, destination.id)).draft.blocks.length)
      .toBe(3);
    await clickNavigatorAction(page, "New slide");
    await openE01Inspector(page, "Layout");
    await page.getByRole("combobox", { name: "Slide theme", exact: true }).selectOption("midnight");
    await page
      .getByRole("button", { name: "Apply design to all native slides", exact: true })
      .click();
    await expect
      .poll(async () => {
        const saved = (await readE01Record(page, destination.id)).draft;
        return {
          version: saved.schemaVersion,
          blockCount: saved.blocks.length,
          nativeThemes: saved.blocks.flatMap((block) =>
            block.kind === "content" && block.scene ? [block.scene.design?.theme] : [],
          ),
        };
      })
      .toEqual({ version: 10, blockCount: 4, nativeThemes: ["midnight"] });
    await page.reload();
    expect((await readE01Record(page, destination.id)).draft.schemaVersion).toBe(10);
    if (narrow) {
      await closeE01Overlays(page);
    }
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
    await expect(
      preview.getByRole("heading", { name: starter.question.prompt, exact: true }),
    ).toBeVisible();
    await expect(preview.getByLabel("Your response", { exact: true })).toBeDisabled();
    await expect(preview.getByText("0 of 1000 characters", { exact: true })).toBeVisible();
    await expect(preview.getByText(/live\.text\./)).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"][aria-label="Presentation preview"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await fit(page);
    await page.screenshot({ path: info.outputPath("text-authoring-v10.png"), fullPage: true });
  });
}
