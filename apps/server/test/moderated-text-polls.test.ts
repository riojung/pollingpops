import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentRoundClientCapabilities,
  type HostCommand,
  type QuizDraft,
} from "@openround/contracts";
import { MemoryRepository, roundArtifactSchemaVersion, type CreatorContext } from "@openround/db";
import { io as createClient, type Socket } from "socket.io-client";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import { attachRealtime } from "../src/realtime.js";
import { ReportWorker } from "../src/report-worker.js";
import { reportCsv } from "../src/reporting.js";
import { SessionService } from "../src/session-service.js";

const apps: FastifyInstance[] = [];
const services: SessionService[] = [];
const sockets: Socket[] = [];
const realtimeServers: Awaited<ReturnType<typeof attachRealtime>>[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  for (const realtime of realtimeServers.splice(0)) await realtime.close();
  for (const service of services.splice(0)) service.close();
  for (const app of apps.splice(0)) await app.close();
  vi.restoreAllMocks();
});

const caps = () => currentRoundClientCapabilities();
const settings = {
  audienceLimit: 20,
  scoringMode: "accuracy" as const,
  resultVisibility: "private" as const,
  allowLateJoin: true,
  nicknamePolicy: "custom" as const,
};
async function fixture() {
  const workspaceId = randomUUID();
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "true",
    LOG_LEVEL: "silent",
    FEATURE_ROUND_CLIENT_PROTOCOL: "true",
    CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
  });
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const cache = new MemorySessionCache();
  const built = await buildApp(config, { repository, cache });
  apps.push(built.app);
  const magic = await built.app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: `${randomUUID()}@example.com`, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await built.app.inject({ url: `/v1/auth/verify?token=${token}` });
  const cookies = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
  const owner = (await built.app.inject({ url: "/v1/auth/me", headers: { cookie } })).json<{
    creator: CreatorContext;
  }>().creator;
  const draft: QuizDraft = {
    title: "Moderated reflection",
    description: "",
    questions: (["open_text", "word_cloud"] as const).map((type) => ({
      id: randomUUID(),
      type,
      prompt: type === "open_text" ? "Explain your priority" : "Share one priority",
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 300,
      basePoints: 0,
      explanation: "Responses are reviewed before they appear.",
      mediaId: null,
      mediaAlt: null,
    })),
  };
  const now = new Date();
  const quiz = await repository.createQuiz({
    id: randomUUID(),
    workspaceId,
    title: draft.title,
    description: "",
    status: "draft",
    draft,
    draftSchemaVersion: roundArtifactSchemaVersion(draft),
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  await repository.publishQuiz({
    id: randomUUID(),
    workspaceId,
    quizId: quiz.id,
    version: 1,
    content: draft,
    contentSchemaVersion: roundArtifactSchemaVersion(draft),
    contentHash: randomUUID(),
    publishedAt: now,
  });
  const room = await built.sessions.createSession(owner, quiz.id, settings, {
    clientCapabilities: caps(),
  });
  const guests = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      built.sessions.join({
        code: room.code,
        nickname: `Guest ${index + 1}`,
        clientCapabilities: caps(),
      }),
    ),
  );
  const snapshot = () =>
    built.sessions.snapshot({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      clientCapabilities: caps(),
    });
  const command = async (
    options: Pick<HostCommand, "action"> & Partial<HostCommand>,
    service = built.sessions,
  ) =>
    service.hostCommand({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      clientCapabilities: caps(),
      commandId: randomUUID(),
      expectedVersion: (
        await service.snapshot({
          sessionId: room.sessionId,
          hostToken: room.hostToken,
          clientCapabilities: caps(),
        })
      ).version,
      ...options,
    });
  const opened = await command({ action: "start" });
  const submit = (index: number, value: string, roundId = opened.roundId!) =>
    built.sessions.answer({
      sessionId: room.sessionId,
      roundId,
      participantToken: guests[index]!.participantToken,
      clientCapabilities: caps(),
      idempotencyKey: randomUUID(),
      response: { kind: "text", value },
    });
  const query = (
    route: string,
    options: Record<string, string | number>,
    credential = room.hostToken,
  ) =>
    built.app.inject({
      url: `/v1/sessions/${room.sessionId}/${route}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(options).map(([key, value]) => [key, String(value)])), ...(route === "response-results" && !options.role ? { role: "host" } : {}), clientCapabilities: JSON.stringify(caps()) })}`,
      headers: { authorization: `Bearer ${credential}` },
    });
  return {
    ...built,
    config,
    repository,
    cache,
    owner,
    cookie,
    draft,
    quiz,
    room,
    guests,
    opened,
    snapshot,
    command,
    submit,
    query,
  };
}

describe("moderated open text and word clouds", () => {
  it("gates text writers and bounds new text sessions", async () => {
    const f = await fixture();
    expect(
      (await f.app.inject({ url: "/v1/auth/me", headers: { cookie: f.cookie } })).json(),
    ).toMatchObject({ productFeatures: { openTextPolls: true, wordCloudPolls: true } });
    const excessive = {
      ...f.draft,
      questions: Array.from({ length: 11 }, () => ({ ...f.draft.questions[0]!, id: randomUUID() })),
    };
    expect(
      (
        await f.app.inject({
          method: "PATCH",
          url: `/v1/quizzes/${f.quiz.id}`,
          headers: { cookie: f.cookie },
          payload: excessive,
        })
      ).statusCode,
    ).toBe(400);
    await expect(
      f.sessions.createSession(
        f.owner,
        f.quiz.id,
        { ...settings, audienceLimit: 251 },
        { clientCapabilities: caps() },
      ),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT" });
    f.config.FEATURE_ROUND_CLIENT_PROTOCOL = false;
    expect(
      (
        await f.app.inject({
          method: "PATCH",
          url: `/v1/quizzes/${f.quiz.id}`,
          headers: { cookie: f.cookie },
          payload: f.draft,
        })
      ).statusCode,
    ).toBe(404);
    await expect(
      f.sessions.createSession(f.owner, f.quiz.id, settings, { clientCapabilities: caps() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await f.query("response-moderation", {})).statusCode).toBe(200);
  });

  it("keeps queues private, requires five approved responses, and removes bodies from snapshots, realtime and reports", async () => {
    const f = await fixture();
    expect(f.room.snapshot.stateSchemaVersion).toBe(9);
    const replies = await Promise.all(
      f.guests.map((_, index) => f.submit(index, `PRIVATE REFLECTION ${index + 1}`)),
    );
    expect(replies.every((reply) => reply.accepted && reply.score === 0)).toBe(true);
    const presenter = await f.sessions.createSessionStaffCredential(f.owner, f.room.sessionId, {
      role: "presenter",
      label: "Screen",
      expiresInMinutes: 60,
    });
    const cohost = await f.sessions.createSessionStaffCredential(f.owner, f.room.sessionId, {
      role: "cohost",
      label: "Moderator",
      expiresInMinutes: 60,
    });
    expect((await f.query("response-moderation", {}, presenter.token)).statusCode).toBe(401);
    const first = await f.query("response-moderation", { limit: 2 }, cohost.token);
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(2);
    expect(first.json().items[0]).toMatchObject({
      status: "pending",
      body: expect.stringContaining("PRIVATE REFLECTION"),
      authorAlias: expect.stringContaining("Guest"),
      questionPrompt: "Explain your priority",
    });
    const second = await f.query("response-moderation", {
      limit: 2,
      cursor: first.json().nextCursor,
    });
    expect(second.json().items).toHaveLength(2);
    expect(second.json().items[0].answerId).not.toBe(first.json().items[0].answerId);
    const own = await f.sessions.sync({
      sessionId: f.room.sessionId,
      role: "participant",
      participantToken: f.guests[0]!.participantToken,
      clientCapabilities: caps(),
      lastSeq: 0,
    });
    expect(own.snapshot).toMatchObject({
      myResponse: null,
      myResponseAccepted: true,
      myResponseModerationStatus: "pending",
    });
    expect(JSON.stringify(own)).not.toContain("PRIVATE REFLECTION");
    for (const role of ["host", "presenter"] as const)
      expect(
        JSON.stringify(
          await f.sessions.snapshot({
            sessionId: f.room.sessionId,
            role,
            hostToken: role === "presenter" ? presenter.token : f.room.hostToken,
            clientCapabilities: caps(),
          }),
        ),
      ).not.toContain("PRIVATE REFLECTION");
    const publicBefore = await f.query(
      "response-results",
      { roundId: f.opened.roundId!, role: "participant" },
      f.guests[0]!.participantToken,
    );
    expect(publicBefore.json()).toMatchObject({
      visible: false,
      approvedRespondents: 0,
      items: [],
    });
    for (const reply of replies.slice(0, 4))
      await f.command({
        action: "response.moderate",
        answerId: reply.answerId,
        responseStatus: "approved",
      });
    await f.command({ action: "lock" });
    await f.command({ action: "reveal" });
    expect(
      (
        await f.query(
          "response-results",
          { roundId: f.opened.roundId!, role: "presenter" },
          presenter.token,
        )
      ).json(),
    ).toMatchObject({ visible: false, approvedRespondents: 4, items: [] });
    const appliedInput: HostCommand = {
      sessionId: f.room.sessionId,
      hostToken: cohost.token,
      clientCapabilities: caps(),
      commandId: randomUUID(),
      expectedVersion: (await f.snapshot()).version,
      action: "response.moderate",
      answerId: replies[4]!.answerId,
      responseStatus: "approved",
    };
    await f.sessions.hostCommand(appliedInput);
    await f.sessions.hostCommand(appliedInput);
    const auditReceipt = (await f.repository.getSessionById(f.room.sessionId))!.state
      .responseModerationReceipts?.[appliedInput.commandId];
    expect(auditReceipt).toMatchObject({
      actor: { kind: "cohost", credentialId: cohost.credential.id },
      answerId: replies[4]!.answerId,
      status: "approved",
    });
    expect(JSON.stringify(auditReceipt)).not.toContain("PRIVATE REFLECTION");
    await expect(
      f.sessions.hostCommand({ ...appliedInput, responseStatus: "removed" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const visible = await f.query(
      "response-results",
      { roundId: f.opened.roundId!, role: "presenter" },
      presenter.token,
    );
    expect(visible.json()).toMatchObject({ visible: true, approvedRespondents: 5 });
    expect(visible.json().items).toHaveLength(5);
    const stale = await f.query("response-moderation", {
      limit: 2,
      cursor: first.json().nextCursor,
    });
    expect(stale.statusCode).toBe(409);
    const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const realtime = await attachRealtime(
      f.app.server,
      f.sessions,
      { ...f.config, WEB_ORIGIN: origin, PUBLIC_API_URL: origin },
      new MetricsService(),
    );
    realtimeServers.push(realtime);
    const socket = createClient(origin, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { origin },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    const synced = await socket.timeout(2_000).emitWithAck("sync.request", {
      sessionId: f.room.sessionId,
      role: "host",
      hostToken: f.room.hostToken,
      clientCapabilities: caps(),
      lastSeq: 0,
    });
    expect(JSON.stringify(synced)).not.toContain("PRIVATE REFLECTION");
    const event = new Promise<unknown>((resolve) => socket.once("response.moderated", resolve));
    await f.command({
      action: "response.moderate",
      answerId: replies[0]!.answerId,
      responseStatus: "removed",
    });
    expect(JSON.stringify(await event)).not.toContain("PRIVATE REFLECTION");
    expect(
      (await f.query("response-results", { roundId: f.opened.roundId! })).json(),
    ).toMatchObject({ visible: false, approvedRespondents: 4, items: [] });
    const removed = await f.query("response-moderation", { status: "removed" });
    expect(removed.json().items).toEqual([
      expect.objectContaining({ answerId: replies[0]!.answerId, body: null }),
    ]);
    await expect(
      f.command({
        action: "response.moderate",
        answerId: replies[0]!.answerId,
        responseStatus: "approved",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.command({
      action: "response.moderate",
      answerId: replies[5]!.answerId,
      responseStatus: "approved",
    });
    const loadAnswers = f.repository.getSessionAnswersByIds.bind(f.repository);
    vi.spyOn(f.repository, "getSessionAnswersByIds").mockImplementationOnce(
      async (workspaceId, sessionId, ids) => {
        const answers = await loadAnswers(workspaceId, sessionId, ids);
        await f.repository.revokeSessionStaff(
          f.owner.workspaceId,
          f.room.sessionId,
          cohost.credential.id,
        );
        return answers;
      },
    );
    expect(
      (await f.query("response-moderation", { status: "approved" }, cohost.token)).statusCode,
    ).toBe(401);
    expect((await f.query("response-moderation", {}, cohost.token)).statusCode).toBe(401);
    await expect(
      f.sessions.hostCommand({
        ...appliedInput,
        commandId: randomUUID(),
        expectedVersion: (await f.snapshot()).version,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await f.command({ action: "end" });
    expect(await new ReportWorker(f.repository, 60_000).runOnce()).toBe("completed");
    const report = (await f.repository.getReportBySession(f.owner.workspaceId, f.room.sessionId))!;
    expect(report).toMatchObject({
      schemaVersion: 7,
      metrics: { accuracyPercent: null },
      questions: [
        {
          responses: 6,
          correct: null,
          accuracyPercent: null,
          responseDistribution: { kind: "open_text", respondents: 5 },
        },
        { responses: 0, correct: null, accuracyPercent: null },
      ],
    });
    expect(JSON.stringify(report)).not.toContain("PRIVATE REFLECTION 1");
    expect(reportCsv(report)).not.toContain("PRIVATE REFLECTION 1");
  });

  it("retains old-round moderation, groups Unicode cloud terms, and allows accepted retries after finish through rollback", async () => {
    const f = await fixture();
    const replies = await Promise.all(
      f.guests.map((_, index) => f.submit(index, `OLD RESPONSE ${index + 1}`)),
    );
    for (const reply of replies.slice(0, 5))
      await f.command({
        action: "response.moderate",
        answerId: reply.answerId,
        responseStatus: "approved",
      });
    await f.command({ action: "lock" });
    await f.command({ action: "reveal" });
    const cloud = await f.command({ action: "next" });
    expect(
      (await f.query("response-moderation", { roundId: f.opened.roundId! })).json().items,
    ).toEqual([
      expect.objectContaining({ answerId: replies[5]!.answerId, body: "OLD RESPONSE 6" }),
    ]);
    await f.command({
      action: "response.moderate",
      answerId: replies[5]!.answerId,
      responseStatus: "approved",
    });
    const cloudReplies = await Promise.all(
      f.guests
        .slice(0, 5)
        .map((_, index) => f.submit(index, index % 2 ? "  Café  " : "CAFE\u0301", cloud.roundId!)),
    );
    for (const reply of cloudReplies)
      await f.command({
        action: "response.moderate",
        answerId: reply.answerId,
        responseStatus: "approved",
      });
    await f.command({ action: "lock" });
    await f.command({ action: "reveal" });
    const grouped = await f.query("response-results", { roundId: cloud.roundId! });
    expect(grouped.json()).toMatchObject({
      type: "word_cloud",
      visible: true,
      approvedRespondents: 5,
      terms: [{ value: "café", label: "café", count: 5 }],
    });
    expect(
      (await f.query("response-results", { roundId: f.opened.roundId! })).json().items,
    ).toHaveLength(6);
    const receipt: HostCommand = {
      sessionId: f.room.sessionId,
      hostToken: f.room.hostToken,
      clientCapabilities: caps(),
      commandId: randomUUID(),
      expectedVersion: (await f.snapshot()).version,
      action: "response.moderate",
      answerId: replies[0]!.answerId,
      responseStatus: "removed",
    };
    await f.sessions.hostCommand(receipt);
    f.sessions.close();
    const restored = new SessionService(
      f.repository,
      new MemorySessionCache(),
      { ...f.config, FEATURE_ROUND_CLIENT_PROTOCOL: false, CORE_PARITY_WORKSPACE_ALLOWLIST: [] },
      new MetricsService(),
    );
    services.push(restored);
    await restored.hostCommand(receipt);
    await f.command({ action: "end" }, restored);
    await restored.hostCommand(receipt);
    await expect(
      restored.hostCommand({
        ...receipt,
        commandId: randomUUID(),
        expectedVersion: (
          await restored.snapshot({
            sessionId: f.room.sessionId,
            hostToken: f.room.hostToken,
            clientCapabilities: caps(),
          })
        ).version,
        answerId: replies[1]!.answerId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await new ReportWorker(f.repository, 60_000).runOnce()).toBe("completed");
    const report = (await f.repository.getReportBySession(f.owner.workspaceId, f.room.sessionId))!;
    expect(report).toMatchObject({
      schemaVersion: 7,
      questions: [
        { responseDistribution: { kind: "open_text", respondents: 5 } },
        {
          responseDistribution: {
            kind: "word_cloud",
            respondents: 5,
            buckets: [{ value: "café", count: 5 }],
          },
        },
      ],
    });
    expect(JSON.stringify(report)).not.toContain("OLD RESPONSE 1");
  });

  it("commits exact moderator retries once and orders moderation against final report scheduling", async () => {
    const f = await fixture();
    const replies = await Promise.all(
      f.guests.map((_, index) => f.submit(index, `RACE BODY ${index + 1}`)),
    );
    const secondWriter = new SessionService(f.repository, f.cache, f.config, new MetricsService());
    services.push(secondWriter);
    const input: HostCommand = {
      sessionId: f.room.sessionId,
      hostToken: f.room.hostToken,
      clientCapabilities: caps(),
      commandId: randomUUID(),
      expectedVersion: (await f.snapshot()).version,
      action: "response.moderate",
      answerId: replies[0]!.answerId,
      responseStatus: "approved",
    };
    const duplicates = await Promise.all([
      f.sessions.hostCommand(input),
      secondWriter.hostCommand(input),
    ]);
    expect(duplicates.map((snapshot) => snapshot.version)).toEqual([
      input.expectedVersion + 1,
      input.expectedVersion + 1,
    ]);
    const durable = (await f.repository.getSessionById(f.room.sessionId))!.state;
    expect(Object.keys(durable.responseModerationReceipts ?? {})).toHaveLength(1);
    for (const reply of replies.slice(1, 5))
      await f.command({
        action: "response.moderate",
        answerId: reply.answerId,
        responseStatus: "approved",
      });
    await f.command({ action: "lock" });
    await f.command({ action: "reveal" });
    const version = (await f.snapshot()).version;
    const approval: HostCommand = {
      ...input,
      commandId: randomUUID(),
      expectedVersion: version,
      answerId: replies[5]!.answerId,
    };
    const end: HostCommand = {
      sessionId: f.room.sessionId,
      hostToken: f.room.hostToken,
      clientCapabilities: caps(),
      commandId: randomUUID(),
      expectedVersion: version,
      action: "end",
    };
    const raced = await Promise.allSettled([
      f.sessions.hostCommand(end),
      secondWriter.hostCommand(approval),
    ]);
    expect(raced.some((result) => result.status === "fulfilled")).toBe(true);
    if ((await f.snapshot()).phase !== "finished") await f.command({ action: "end" });
    expect(await new ReportWorker(f.repository, 60_000).runOnce()).toBe("completed");
    const report = (await f.repository.getReportBySession(f.owner.workspaceId, f.room.sessionId))!;
    expect(JSON.stringify(report).includes("RACE BODY 6")).toBe(raced[1]!.status === "fulfilled");
    const frozen = JSON.stringify(report);
    await expect(
      f.command({
        action: "response.moderate",
        answerId: replies[0]!.answerId,
        responseStatus: "removed",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      JSON.stringify(await f.repository.getReportBySession(f.owner.workspaceId, f.room.sessionId)),
    ).toBe(frozen);
  });
});
