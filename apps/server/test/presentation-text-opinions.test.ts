import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { FastifyInstance } from "fastify";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentationContentSchema,
  PresentationTextModerationQuerySchema,
  type PresentationTextResponseResults,
  type PresentationTextModerationAck,
  type PresentationResponseAck,
  type PresentationSessionResponse,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { PresentationReportWorker } from "../src/presentation-report-worker.js";
import {
  generatePresentationReport,
  presentationReportRestProjection,
} from "../src/presentation-reporting.js";
import { presentationParticipantTokenHash } from "../src/presentation-session-service.js";
import {
  presentationResponseRequestHash,
  presentationResponseValidationMessage,
} from "../src/presentation-session-response-policy.js";
import { attachRealtime } from "../src/realtime.js";
import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { projectPresentationSummary } from "../src/session-summary-projection.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(
  type: "open_text" | "word_cloud" = "open_text",
  options: { uppercase?: boolean; secondBlock?: boolean; mixed?: boolean } = {},
) {
  const workspaceId = randomUUID(),
    sessionId = randomUUID(),
    userId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId, initialPlan: "team" });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    FEATURE_UX_BETA: "true",
    UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
    FEATURE_PRESENTATIONS: "true",
    FEATURE_PRESENTATION_REALTIME: "true",
    FEATURE_PRESENTATION_COMPANION: "true",
    FEATURE_LIVE_FLEX_MODE: "true",
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
  });
  const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
  apps.push(built.app);
  const id = () => (options.uppercase ? randomUUID().toUpperCase() : randomUUID());
  const block = {
    id: id(),
    kind: "question",
    question: {
      id: id(),
      type,
      prompt: "Share a useful idea",
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 60,
      basePoints: 0,
      explanation: "Private facilitator explanation",
      mediaId: null,
      mediaAlt: null,
    },
  };
  const poll = {
    id: id(),
    kind: "question",
    question: {
      ...block.question,
      id: id(),
      type: "poll",
      prompt: "Choose priorities",
      maxSelections: 2,
      explanation: "",
      choices: ["One", "Two", "Three"].map((label) => ({ id: id(), label, isCorrect: false })),
    },
  };
  const quick = {
    ...poll,
    id: id(),
    question: {
      ...poll.question,
      id: id(),
      prompt: "Session-only Quick Check",
      maxSelections: 1,
      choices: poll.question.choices.map((choice) => ({ ...choice, id: id() })),
    },
  };
  const content = PresentationContentSchema.parse({
    title: "Moderated text",
    schemaVersion: 10,
    blocks: [
      block,
      ...(options.secondBlock
        ? [
            {
              ...block,
              id: id(),
              question: { ...block.question, id: id(), prompt: "A future question" },
            },
          ]
        : []),
      ...(options.mixed ? [poll, quick] : []),
    ],
    ...(options.mixed ? { liveQuickCheck: { blockId: quick.id, commandId: randomUUID() } } : {}),
  });
  const now = new Date();
  await built.presentationSessions.createSession({
    id: sessionId,
    workspaceId,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: content.title,
    content,
    code: "7134526",
    status: "active",
    phase: "question_open",
    currentBlockIndex: 0,
    revision: 1,
    settings: { timeMode: "flex" },
    trustMode: "learning",
    eventSeq: 3,
    questionOpenedAt: now,
    questionClosesAt: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 3600_000),
    retentionExpiresAt: new Date(now.getTime() + 86400_000),
  });
  const tokens = {
    host: `host-${randomUUID()}`,
    companion: `companion-${randomUUID()}`,
    stage: `stage-${randomUUID()}`,
  };
  for (const role of ["host", "companion", "stage"] as const)
    await built.presentationSessions.createCredential({
      id: randomUUID(),
      workspaceId,
      sessionId,
      role,
      tokenHash: presentationParticipantTokenHash(tokens[role]),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3600_000),
      revokedAt: null,
    });
  const participants = await Promise.all(
    Array.from({ length: 6 }, async (_, index) => {
      const token = `participant-${randomUUID()}`,
        participantId = randomUUID();
      await built.presentationSessions.addParticipant({
        id: participantId,
        workspaceId,
        sessionId,
        nickname: `Private name ${index}`,
        tokenHash: presentationParticipantTokenHash(token),
        joinedAt: now,
        lastSeenAt: now,
      });
      return { token, id: participantId };
    }),
  );
  const sessions = built.presentationSessions,
    service = built.presentationService;
  const current = async () => (await sessions.getSessionById(sessionId))!;
  const submit = (
    index: number,
    textValue: string,
    idempotencyKey: string = randomUUID(),
    response?: PresentationSessionResponse,
  ) =>
    service.submitResponse({
      sessionId,
      participantToken: participants[index]!.token,
      blockId: block.id,
      expectedRevision: 1,
      idempotencyKey,
      response: response ?? { textValue },
    });
  const advance = async () =>
    service.command({
      sessionId,
      controlToken: tokens.host,
      commandId: randomUUID(),
      expectedRevision: (await current()).revision,
      action: "advance",
    });
  const queue = (
    status: "pending" | "approved" | "removed" = "pending",
    limit = 50,
    cursor?: string,
  ) =>
    service.getTextModerationPage(
      sessionId,
      tokens.host,
      PresentationTextModerationQuerySchema.parse({ status, limit, ...(cursor ? { cursor } : {}) }),
    );
  const moderate = async (
    responseId: string,
    status: "approved" | "removed",
    expectedModerationVersion = 0,
    commandId: string = randomUUID(),
  ) => {
    const input = {
      commandId,
      expectedRevision: (await current()).revision,
      expectedModerationVersion,
      status,
    };
    const ack = await service.moderateTextResponse(sessionId, tokens.host, responseId, input);
    return { ack, input };
  };
  const results = (
    role: "host" | "participant" | "companion" | "stage" = "participant",
    limit = 50,
    cursor?: string,
  ) =>
    service.getTextResponseResults({
      sessionId,
      token: role === "participant" ? participants[0]!.token : tokens[role],
      query: { blockId: block.id, role, limit, ...(cursor ? { cursor } : {}) },
    });
  return {
    ...built,
    roundSessions: built.sessions,
    repository,
    config,
    sessions,
    service,
    sessionId,
    workspaceId,
    userId,
    tokens,
    participants,
    block,
    content,
    current,
    submit,
    advance,
    queue,
    moderate,
    results,
  };
}

async function creatorCookie(f: Awaited<ReturnType<typeof fixture>>) {
  const email = "text-moderation-owner@example.com";
  const magic = await f.app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(f.app, `/v1/auth/verify?token=${token}`, email);
  const cookies = verified.headers["set-cookie"]!;
  return (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
}

function expectBodyFree(value: unknown, bodies: string[]) {
  const serialized = JSON.stringify(value);
  for (const body of bodies) expect(serialized).not.toContain(body);
  expect(serialized).not.toContain('"textValue"');
}

describe("Presentation moderated text opinions", () => {
  it("retains host moderation availability on refresh at a later nontext question without exposing it to other roles", async () => {
    const f = await fixture("open_text", { mixed: true });
    expect(await f.service.getHostSnapshot(f.workspaceId, f.sessionId)).toHaveProperty(
      "textModerationAvailable",
      true,
    );
    for (const snapshot of [
      (await f.service.getParticipantSnapshot(f.sessionId, f.participants[0]!.token)).snapshot,
      await f.service.getCompanionSnapshot(f.sessionId, f.tokens.companion),
      await f.service.getStageSnapshot(f.sessionId, f.tokens.stage),
    ])
      expect(snapshot).not.toHaveProperty("textModerationAvailable");
    await f.advance();
    await f.advance();
    const host = await f.service.getHostSnapshot(f.workspaceId, f.sessionId);
    expect(host).toMatchObject({
      phase: "question_open",
      currentBlock: { kind: "question", question: { type: "poll" } },
      textModerationAvailable: true,
    });
    const cookie = await creatorCookie(f);
    const refreshed = await f.app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${f.sessionId}`,
      headers: { cookie },
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json()).toMatchObject({
      snapshot: { currentBlock: { question: { type: "poll" } }, textModerationAvailable: true },
    });
    const reconnect = await f.service.sync({
      sessionId: f.sessionId,
      projection: "host",
      controlToken: f.tokens.host,
      afterSeq: 0,
    });
    expect(reconnect.snapshot).toHaveProperty("textModerationAvailable", true);
  });
  it.each(["open_text", "word_cloud"] as const)(
    "projects PostgreSQL-style lowercase %s moderation rows to authored uppercase IDs without mutating receipts",
    async (type) => {
      const f = await fixture(type, { uppercase: true });
      const saved = await f.submit(0, "Private PostgreSQL-style body");
      const originalModerate = f.sessions.moderateTextResponse.bind(f.sessions);
      const returnedReceipts: object[] = [];
      vi.spyOn(f.sessions, "moderateTextResponse").mockImplementation(async (input) => {
        const result = await originalModerate(input);
        if (result.status !== "accepted" && result.status !== "duplicate") return result;
        const receipt = Object.freeze({
          ...result.receipt,
          blockId: result.receipt.blockId.toLowerCase(),
        });
        returnedReceipts.push(receipt);
        return {
          ...result,
          receipt,
          response: Object.freeze({
            ...result.response,
            blockId: result.response.blockId.toLowerCase(),
            questionId: result.response.questionId.toLowerCase(),
          }),
        };
      });
      const approved = await f.moderate(saved.responseId, "approved");
      expect(approved.ack).toMatchObject({
        receipt: { blockId: f.block.id },
        response: { blockId: f.block.id, status: "approved" },
      });
      const stored = JSON.stringify(
        await f.sessions.findTextModerationReceipt(
          f.workspaceId,
          f.sessionId,
          approved.input.commandId,
        ),
      );
      const duplicate = await f.service.moderateTextResponse(
        f.sessionId,
        f.tokens.host,
        saved.responseId,
        approved.input,
      );
      expect(duplicate).toMatchObject({
        duplicate: true,
        receipt: approved.ack.receipt,
        response: approved.ack.response,
      });
      expect(
        JSON.stringify(
          await f.sessions.findTextModerationReceipt(
            f.workspaceId,
            f.sessionId,
            approved.input.commandId,
          ),
        ),
      ).toBe(stored);
      for (const receipt of returnedReceipts)
        expect(receipt).toMatchObject({ blockId: f.block.id.toLowerCase() });
      expectBodyFree(duplicate, ["Private PostgreSQL-style body"]);
    },
  );
  it.each(["open_text", "word_cloud"] as const)(
    "accepts canonical %s with status-only receipts and unchanged legacy fingerprints",
    async (type) => {
      const f = await fixture(type, { uppercase: true });
      const key = randomUUID(),
        original = "  Cafe\u0301 idea  ",
        canonical = "Café idea";
      const ack = await f.submit(0, original, key);
      expect(await f.service.getHostSnapshot(f.workspaceId, f.sessionId)).toHaveProperty(
        "textModerationAvailable",
        true,
      );
      expect(ack).toMatchObject({
        accepted: true,
        duplicate: false,
        blockId: f.block.id,
        snapshot: {
          responseSubmitted: true,
          responseResult: null,
          standing: null,
          ownTextResponse: {
            responseId: ack.responseId,
            blockId: f.block.id,
            status: "pending",
            moderationVersion: 0,
          },
        },
      });
      expectBodyFree(ack, [original, canonical]);
      expect(await f.sessions.listResponses(f.sessionId)).toMatchObject([
        {
          response: {},
          responseSchemaVersion: 3,
          correct: null,
          score: 0,
          moderationStatus: "pending",
          moderationVersion: 0,
        },
      ]);
      expect((await f.queue())!.items).toMatchObject([
        { textValue: canonical, status: "pending", moderationVersion: 0 },
      ]);
      const retry = await f.submit(0, canonical, key);
      expect(retry).toMatchObject({
        duplicate: true,
        responseId: ack.responseId,
        acceptedAt: ack.acceptedAt,
      });
      await expect(f.submit(0, "Changed intent", key)).rejects.toMatchObject({
        code: "IDEMPOTENCY_CONFLICT",
      });
      expectBodyFree(
        (await f.service.getParticipantSnapshot(f.sessionId, f.participants[0]!.token)).snapshot,
        [canonical],
      );
      const question = f.content.blocks[0]!;
      if (question.kind !== "question") throw new Error("Question expected");
      for (const response of [
        { textValue: "" },
        { textValue: "x".repeat(type === "word_cloud" ? 81 : 1001) },
        { textValue: "bad\u0000body" },
        { textValue: "Safe", confidence: 3 as const },
        { textValue: "Safe", numericValue: "2" },
        { textValue: "Safe", ratingValue: 2 },
        { textValue: "Safe", choiceIds: [randomUUID()] },
        { textValue: "Safe", orderedChoiceIds: [randomUUID()] },
      ]) {
        expect(presentationResponseValidationMessage(question.question, response)).toBeTruthy();
      }
      if (type === "word_cloud")
        expect(
          presentationResponseValidationMessage(question.question, { textValue: "bad\nterm" }),
        ).toBeTruthy();
      const oldInput = {
        blockId: randomUUID(),
        expectedRevision: 2,
        response: { numericValue: "7", confidence: 3 as const },
      };
      const golden = createHash("sha256")
        .update(
          JSON.stringify({
            blockId: oldInput.blockId,
            expectedRevision: 2,
            response: { choiceIds: [], numericValue: "7", ratingValue: null, confidence: 3 },
          }),
        )
        .digest("hex");
      expect(presentationResponseRequestHash(oldInput)).toBe(golden);
    },
  );

  it.each(["open_text", "word_cloud"] as const)(
    "keeps %s private until actual reveal and five approved distinct respondents",
    async (type) => {
      const f = await fixture(type);
      const bodies =
        type === "word_cloud"
          ? ["Café", "CAFE\u0301", "  Better   tools ", "Better tools", "Safety", "SECRET pending"]
          : Array.from({ length: 6 }, (_, index) => `PRIVATE idea ${index}`);
      const saved = await Promise.all(bodies.map((body, index) => f.submit(index, body)));
      for (let index = 0; index < 5; index++)
        await f.moderate(saved[index]!.responseId, "approved");
      const before = await f.current();
      expect(before.revision).toBe(1);
      for (const role of ["participant", "host", "companion", "stage"] as const)
        expect(await f.results(role)).toMatchObject({ visible: false, items: [], terms: [] });
      await f.advance();
      for (const role of ["participant", "host", "companion", "stage"] as const) {
        const results = (await f.results(role))!;
        expect(results).toMatchObject({ visible: true, approvedRespondents: 5, nextCursor: null });
        expect(JSON.stringify(results)).not.toContain("SECRET");
        expect(JSON.stringify(results)).not.toContain("Private name");
        for (const property of ["responseId", "participantId", "authorAlias"])
          expect(JSON.stringify(results)).not.toContain(`"${property}"`);
        if (type === "open_text")
          expect(results.items.map(({ textValue }) => textValue).sort()).toEqual(
            bodies.slice(0, 5).sort(),
          );
        else
          expect(results.terms).toEqual(
            expect.arrayContaining([
              { value: "café", label: "café", count: 2, percent: 40 },
              { value: "better tools", label: "better tools", count: 2, percent: 40 },
              { value: "safety", label: "safety", count: 1, percent: 20 },
            ]),
          );
      }
      const own = (await f.service.getParticipantSnapshot(f.sessionId, f.participants[0]!.token))
        .snapshot;
      expect(own).toMatchObject({
        responseResult: null,
        standing: null,
        ownTextResponse: { status: "approved", moderationVersion: 1 },
      });
      expectBodyFree(own, bodies);
      await f.moderate(saved[0]!.responseId, "removed", 1);
      expect((await f.queue("removed"))!.items).toMatchObject([
        { textValue: null, status: "removed" },
      ]);
      expect(await f.results()).toMatchObject({
        visible: false,
        items: [],
        terms: [],
        nextCursor: null,
      });
      const retry = await f.submit(0, bodies[0]!, saved[0]!.idempotencyKey);
      expect(retry.snapshot).toMatchObject({
        ownTextResponse: { status: "removed", moderationVersion: 2 },
      });
      expectBodyFree(retry, bodies);
    },
  );

  it("recovers immutable moderation receipts after removal and finish without reapproving", async () => {
    const f = await fixture();
    const saved = await f.submit(0, "ERASE this private body");
    const first = await f.moderate(saved.responseId, "approved");
    const stale = {
      commandId: randomUUID(),
      expectedRevision: 1,
      expectedModerationVersion: 0,
      status: "removed" as const,
    };
    const before = await f.current();
    await expect(
      f.service.moderateTextResponse(f.sessionId, f.tokens.host, saved.responseId, stale),
    ).rejects.toMatchObject({ code: "STALE_SESSION" });
    expect(await f.current()).toEqual(before);
    await f.moderate(saved.responseId, "removed", 1);
    const removed = await f.current();
    const retry = await f.service.moderateTextResponse(
      f.sessionId,
      f.tokens.host,
      saved.responseId,
      first.input,
    );
    expect(retry).toMatchObject({
      accepted: true,
      duplicate: true,
      receipt: first.ack.receipt,
      response: { status: "removed", moderationVersion: 2 },
      revision: 1,
      seq: removed.eventSeq,
    });
    expect(await f.current()).toEqual(removed);
    await f.advance();
    await f.advance();
    const finished = await f.current();
    expect(
      (
        await f.service.moderateTextResponse(
          f.sessionId,
          f.tokens.host,
          saved.responseId,
          first.input,
        )
      ).receipt,
    ).toEqual(first.ack.receipt);
    await expect(f.moderate(saved.responseId, "approved", 2)).rejects.toMatchObject({
      code: "PHASE_CLOSED",
    });
    expect(await f.current()).toEqual(finished);
    expectBodyFree(
      await f.sessions.findTextModerationReceipt(f.workspaceId, f.sessionId, first.input.commandId),
      ["ERASE"],
    );
    expectBodyFree(await f.sessions.listResponses(f.sessionId), ["ERASE this private body"]);
  });

  it("fences paged reads on moderation and current-block changes and rechecks revoked credentials", async () => {
    const f = await fixture("open_text", { secondBlock: true });
    const saved = await Promise.all(
      Array.from({ length: 6 }, (_, index) => f.submit(index, `Paged private ${index}`)),
    );
    const pending = (await f.queue("pending", 2))!;
    expect(pending.items).toHaveLength(2);
    expect(pending.nextCursor).toBeTruthy();
    await f.moderate(saved[0]!.responseId, "approved");
    await expect(f.queue("pending", 2, pending.nextCursor!)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    for (let index = 1; index < 6; index++) await f.moderate(saved[index]!.responseId, "approved");
    await f.advance();
    const first = (await f.results("participant", 2))!;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (await f.results("participant", 2, first.nextCursor!))!;
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map(({ textValue }) => textValue)).size).toBe(
      4,
    );
    await f.moderate(saved[5]!.responseId, "removed", 1);
    await expect(f.results("participant", 2, first.nextCursor!)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await f.advance();
    await expect(f.results()).rejects.toMatchObject({ code: "NOT_FOUND" });
    const host = await f.sessions.findValidCredential(
      f.sessionId,
      presentationParticipantTokenHash(f.tokens.host),
      "host",
    );
    await f.sessions.revokeCredential(f.workspaceId, f.sessionId, host!.id, new Date(), "host");
    await expect(f.queue()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("serves private moderation only to explicit host Bearer and public results only to the selected role", async () => {
    const f = await fixture();
    const cookie = await creatorCookie(f);
    const saved = await f.submit(0, "Private queue body");
    const queueUrl = `/v1/presentation-sessions/${f.sessionId}/response-moderation`;
    for (const token of [
      undefined,
      "bad",
      f.tokens.companion,
      f.tokens.stage,
      f.participants[0]!.token,
    ]) {
      const headers = token ? { cookie, authorization: `Bearer ${token}` } : { cookie };
      const denied = await f.app.inject({ method: "GET", url: queueUrl, headers });
      expect(denied.statusCode).toBe(401);
      expect(denied.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
      expect(denied.body).not.toContain("Private queue body");
    }
    const allowed = await f.app.inject({
      method: "GET",
      url: queueUrl,
      headers: { authorization: `Bearer ${f.tokens.host}` },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.headers["cache-control"]).toBe("private, no-store");
    expect(allowed.json()).toMatchObject({ items: [{ textValue: "Private queue body" }] });
    const postUrl = `${queueUrl}/${saved.responseId}`;
    const payload = {
      commandId: randomUUID(),
      expectedRevision: 1,
      expectedModerationVersion: 0,
      status: "approved",
    };
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: postUrl,
          headers: { authorization: `Bearer ${f.tokens.companion}` },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    const accepted = await f.app.inject({
      method: "POST",
      url: postUrl,
      headers: { authorization: `Bearer ${f.tokens.host}` },
      payload,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json<PresentationTextModerationAck>()).toMatchObject({
      accepted: true,
      revision: 1,
      receipt: { status: "approved" },
      response: { status: "approved" },
    });
    expectBodyFree(accepted.json(), ["Private queue body"]);
    const base = `/v1/presentation-sessions/${f.sessionId}/response-results?blockId=${f.block.id}`;
    for (const [role, token] of [
      ["host", f.tokens.companion],
      ["participant", f.tokens.host],
      ["stage", f.tokens.host],
    ] as const) {
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: `${base}&role=${role}`,
            headers: { authorization: `Bearer ${token}` },
          })
        ).statusCode,
      ).toBe(401);
    }
    const result = await f.app.inject({
      method: "GET",
      url: `${base}&role=participant`,
      headers: { authorization: `Bearer ${f.participants[0]!.token}` },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json<PresentationTextResponseResults>()).toMatchObject({
      visible: false,
      items: [],
      terms: [],
    });
    const creator = await f.app.inject({
      method: "GET",
      url: `${base}&role=creator`,
      headers: { cookie },
    });
    expect(creator.statusCode, creator.body).toBe(200);
    expect(
      (
        await f.app.inject({
          method: "GET",
          url: `${base}&role=host&limit=51`,
          headers: { authorization: `Bearer ${f.tokens.host}` },
        })
      ).statusCode,
    ).toBe(422);
  });

  it("keeps text, opinion, Quick Check, and context report opt-ins independent without mutating V5", async () => {
    const f = await fixture("open_text", { mixed: true });
    const cookie = await creatorCookie(f);
    const saved = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        f.submit(index, index === 5 ? "PENDING report secret" : `Anonymous approved ${index}`),
      ),
    );
    for (let index = 0; index < 5; index++) await f.moderate(saved[index]!.responseId, "approved");
    while ((await f.current()).status !== "finished") await f.advance();
    const url = `/v1/presentation-sessions/${f.sessionId}/report`;
    for (const status of ["pending", "ready"] as const) {
      if (status === "ready")
        expect(await new PresentationReportWorker(f.sessions, 30000).runOnce()).toBe("completed");
      const stored = JSON.stringify(await f.sessions.getReport(f.workspaceId, f.sessionId));
      const canonical = (
        await f.service.getReport(f.workspaceId, f.sessionId, true, true, true, true)
      ).report!;
      for (const text of [false, true])
        for (const opinion of [false, true])
          for (const quick of [false, true])
            for (const context of [false, true]) {
              const query = new URLSearchParams();
              if (text) query.set("includeTextResults", "true");
              if (opinion) query.set("includeOpinionResults", "true");
              if (quick) query.set("includeQuickChecks", "true");
              if (context) query.set("includeSessionContext", "true");
              const response = await f.app.inject({
                method: "GET",
                url: `${url}?${query}`,
                headers: { cookie },
              });
              if (!text || !opinion) {
                expect(response.statusCode, response.body).toBe(422);
                expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
                continue;
              }
              expect(response.statusCode, response.body).toBe(200);
              const body = response.json<{
                report: typeof canonical;
                sessionContext?: { timeMode: string };
              }>();
              expect(body.report.schemaVersion).toBe(5);
              const first = body.report.evidence[0]!;
              expect(first).toEqual(canonical.evidence[0]);
              expect(body.report.evidence[1]).toEqual(canonical.evidence[1]);
              if (quick)
                expect(body.report.evidence[2]).toHaveProperty("sessionOnly", "quick_check");
              else expect(body.report.evidence[2]).not.toHaveProperty("sessionOnly");
              expect(Boolean(body.sessionContext)).toBe(context);
              expect(JSON.stringify(body)).not.toContain("PENDING report secret");
              expect(JSON.stringify(await f.sessions.getReport(f.workspaceId, f.sessionId))).toBe(
                stored,
              );
            }
    }
  });

  it.each(["open_text", "word_cloud"] as const)(
    "rejects malformed %s HTTP inputs before acceptance and permits the same-key valid response",
    async (type) => {
      const f = await fixture(type),
        key = randomUUID(),
        before = await f.current(),
        accept = vi.spyOn(f.sessions, "acceptResponse");
      const request = async (response: unknown) =>
        f.app.inject({
          method: "POST",
          url: `/v1/presentation-sessions/${f.sessionId}/responses`,
          payload: {
            participantToken: f.participants[0]!.token,
            blockId: f.block.id,
            expectedRevision: 1,
            idempotencyKey: key,
            response,
          },
        });
      for (const response of [
        { textValue: "" },
        { textValue: "FORBIDDEN body", numericValue: "7" },
        { textValue: "FORBIDDEN body", ratingValue: 2 },
        { textValue: "FORBIDDEN body", choiceIds: [randomUUID()] },
        { textValue: "FORBIDDEN body", confidence: 3 },
        { textValue: "x".repeat(type === "word_cloud" ? 81 : 1001) },
        { textValue: "control\u0000body" },
      ]) {
        const rejected = await request(response);
        expect(rejected.statusCode, rejected.body).toBe(422);
        expect(rejected.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
        expectBodyFree(rejected.json(), ["FORBIDDEN body", "control"]);
        expect(accept).not.toHaveBeenCalled();
        expect(await f.current()).toEqual(before);
        expect(await f.sessions.listResponses(f.sessionId)).toEqual([]);
        expect(
          await f.sessions.findResponseByIdempotencyKey(f.sessionId, f.participants[0]!.id, key),
        ).toBeNull();
      }
      const accepted = await request({ textValue: "  Cafe\u0301 HTTP answer  " });
      expect(accepted.statusCode, accepted.body).toBe(202);
      expect(accepted.json()).toMatchObject({
        accepted: true,
        snapshot: {
          ownTextResponse: { status: "pending", moderationVersion: 0 },
          responseSubmitted: true,
        },
      });
      expectBodyFree(accepted.json(), ["Café HTTP answer"]);
      expect(accept).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["open_text", "word_cloud"] as const)(
    "rejects non-object %s HTTP responses without logging bodies or consuming the response key",
    async (type) => {
      const f = await fixture(type);
      const key = randomUUID();
      const marker = "PRIVATE malformed response body";
      const before = await f.current();
      const timeline = await f.sessions.listTimeline(f.sessionId);
      const acceptance = vi.spyOn(f.sessions, "acceptResponse");
      const routeErrors: unknown[][] = [];
      f.app.addHook("onRequest", async (request) => {
        // Capture the actual logger used by the global unexpected-route-error boundary.
        request.log.error = ((...args: unknown[]) => {
          routeErrors.push(args);
        }) as typeof request.log.error;
      });
      const submit = (response: unknown, legacy = false) =>
        f.app.inject({
          method: "POST",
          url: `/v1/presentation-sessions/${f.sessionId}/responses`,
          payload: {
            participantToken: f.participants[0]!.token,
            ...(!legacy ? { blockId: f.block.id, expectedRevision: 1, idempotencyKey: key } : {}),
            response,
          },
        });
      for (const legacy of [false, true]) {
        for (const response of [marker, 42, true, "", 0, false, [marker], [], null, {}]) {
          const rejected = await submit(response, legacy);
          // Legacy malformed wire values continue through the existing Zod validation boundary.
          expect(rejected.statusCode, rejected.body).toBe(400);
          expect(rejected.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
          expect(rejected.body).not.toContain(marker);
          expect(rejected.body).not.toContain("TypeError");
          expect(rejected.body).not.toContain("INTERNAL_ERROR");
          expect(routeErrors.length).toBe(0);
          expect(acceptance).not.toHaveBeenCalled();
          expect(await f.current()).toEqual(before);
          expect(await f.sessions.listResponses(f.sessionId)).toEqual([]);
          expect(await f.sessions.listTimeline(f.sessionId)).toEqual(timeline);
          expect(
            await f.sessions.findResponseByIdempotencyKey(f.sessionId, f.participants[0]!.id, key),
          ).toBeNull();
        }
      }
      const accepted = await submit({ textValue: "Valid after malformed request" });
      expect(accepted.statusCode, accepted.body).toBe(202);
      expect(accepted.json()).toMatchObject({
        accepted: true,
        duplicate: false,
        idempotencyKey: key,
        snapshot: { responseSubmitted: true, ownTextResponse: { status: "pending" } },
      });
      expectBodyFree(accepted.json(), ["Valid after malformed request"]);
      expect(acceptance).toHaveBeenCalledTimes(1);
      expect(await f.sessions.listResponses(f.sessionId)).toHaveLength(1);
      expect((await f.current()).eventSeq).toBe(before.eventSeq + 1);
      expect(routeErrors.length).toBe(0);
    },
  );

  it("writes only revealed approved text into immutable V5 evidence and suppresses shared participant text", async () => {
    const f = await fixture("open_text", { secondBlock: true, uppercase: true });
    const saved = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        f.submit(index, index === 5 ? "PENDING must stay private" : `Approved report ${index}`),
      ),
    );
    for (let index = 0; index < 5; index++) await f.moderate(saved[index]!.responseId, "approved");
    await f.advance();
    await f.advance(); // Reveal first, then open an unrevealed second question.
    await f.sessions.transitionSession({
      workspaceId: f.workspaceId,
      sessionId: f.sessionId,
      expectedRevision: (await f.current()).revision,
      phase: "finished",
      currentBlockIndex: 1,
      status: "finished",
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });
    const worker = new PresentationReportWorker(f.sessions, 30000);
    expect(await worker.runOnce()).toBe("completed");
    const stored = await f.sessions.getReport(f.workspaceId, f.sessionId),
      before = JSON.stringify(stored);
    const opted = await f.service.getReport(f.workspaceId, f.sessionId, false, false, false, true);
    expect(opted.report).toMatchObject({
      schemaVersion: 5,
      leaderboard: [],
      evidence: [
        { textResults: { kind: "open_text", respondents: 5 } },
        { questionType: "open_text" },
      ],
    });
    expect(JSON.stringify(opted)).not.toContain("PENDING");
    expect(opted.report!.evidence[1]).not.toHaveProperty("textResults");
    await expect(f.service.getReport(f.workspaceId, f.sessionId)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const report = opted.report!;
    expect(() => presentationReportRestProjection(report, false, false, true)).not.toThrow();
    expect(JSON.stringify(await f.sessions.getReport(f.workspaceId, f.sessionId))).toBe(before);
    const summary = projectPresentationSummary(report);
    expect(JSON.stringify(summary)).not.toContain("Approved report");
    expect(summary.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ suppression: "participant_text", results: [] }),
      ]),
    );
    const noReveal = generatePresentationReport({
      session: await f.current(),
      participants: await f.sessions.listParticipants(f.sessionId),
      responses: await f.sessions.listResponses(f.sessionId),
      timeline: [],
      textEvidence: await f.sessions.getTextReportEvidence({
        workspaceId: f.workspaceId,
        sessionId: f.sessionId,
      }),
    });
    expect(JSON.stringify(noReveal)).not.toContain("Approved report");
  });

  it("validates socket text and returns body-free saved receipts and status updates", async () => {
    const f = await fixture(),
      httpServer = createServer();
    let realtime: Awaited<ReturnType<typeof attachRealtime>> | undefined,
      socket: Socket | undefined;
    try {
      await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
      const address = httpServer.address();
      if (!address || typeof address === "string") throw new Error("Socket test bind failed");
      realtime = await attachRealtime(httpServer, f.roundSessions, f.config, f.metrics, undefined, {
        service: f.service,
      });
      socket = createClient(`http://127.0.0.1:${address.port}`, {
        transports: ["websocket"],
        reconnection: false,
        extraHeaders: { origin: f.config.WEB_ORIGIN },
      });
      await new Promise<void>((resolve, reject) => {
        socket!.once("connect", resolve);
        socket!.once("connect_error", reject);
      });
      const submit = (response: PresentationSessionResponse) =>
        new Promise<{ data?: PresentationResponseAck; error?: { code: string } }>((resolve) =>
          socket!.emit(
            "presentation.response.submit",
            {
              sessionId: f.sessionId,
              participantToken: f.participants[0]!.token,
              blockId: f.block.id,
              expectedRevision: 1,
              idempotencyKey: randomUUID(),
              response,
            },
            resolve,
          ),
        );
      const accept = vi.spyOn(f.sessions, "acceptResponse"),
        before = await f.current();
      const bad = await submit({ textValue: "NEVER echo this text", numericValue: "7" });
      expect(bad.error?.code).toBe("VALIDATION_ERROR");
      expect(accept).not.toHaveBeenCalled();
      expect(await f.current()).toEqual(before);
      expectBodyFree(bad, ["NEVER echo"]);
      const good = await submit({ textValue: "Socket private answer" });
      expect(good.error).toBeUndefined();
      expect(good.data?.snapshot).toMatchObject({
        ownTextResponse: { status: "pending" },
        responseSubmitted: true,
      });
      expectBodyFree(good, ["Socket private answer"]);
    } finally {
      socket?.disconnect();
      await realtime?.close();
      if (httpServer.listening)
        await new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
    }
  });
});
