import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentRoundClientCapabilities, type QuizDraft } from "@openround/contracts";
import { MemoryRepository, type CreatorContext } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import { openRoundJson } from "../src/portability.js";
import { ReportWorker } from "../src/report-worker.js";
import { reportCsv } from "../src/reporting.js";
import { SessionService } from "../src/session-service.js";

const apps: FastifyInstance[] = [];
const services: SessionService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) service.close();
  for (const app of apps.splice(0)) await app.close();
  vi.restoreAllMocks();
});

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
    FEATURE_DECISION_REPLAY: "true",
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
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
  const verified = await built.app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const cookies = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
  const me = await built.app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  const owner = me.json<{ creator: CreatorContext }>().creator;
  const draft: QuizDraft = {
    title: "Rank our priorities",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "ranking",
        prompt: "Rank your two priorities",
        rankCount: 2,
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        linkedRecheckQuestionId: null,
        choices: ["=Priority A", "Priority B", "Priority C"].map((label) => ({
          id: randomUUID(),
          label,
          isCorrect: false,
        })),
        timeLimitSeconds: 300,
        basePoints: 0,
        explanation: "These are your priorities.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  const created = await built.app.inject({
    method: "POST",
    url: "/v1/quizzes",
    headers: { cookie },
    payload: { title: draft.title, description: "" },
  });
  const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
  const save = () =>
    built.app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: draft,
    });
  const publish = () =>
    built.app.inject({ method: "POST", url: `/v1/quizzes/${quizId}/publish`, headers: { cookie } });
  return { ...built, repository, cache, config, owner, cookie, draft, quizId, save, publish };
}

describe("live ranking opinion polls", () => {
  it("gates ranking writers and freezes ranking capabilities before creating a room", async () => {
    const f = await fixture();
    const availability = () =>
      f.app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: f.cookie } });
    expect((await availability()).json()).toMatchObject({
      productFeatures: { rankingPolls: false, multiSelectPolls: false },
    });
    expect((await f.save()).statusCode).toBe(404);
    f.config.CORE_PARITY_WORKSPACE_ALLOWLIST.push(f.owner.workspaceId);
    expect((await availability()).json()).toMatchObject({
      productFeatures: { rankingPolls: true, multiSelectPolls: true },
    });
    const mutation = {
      draft: f.draft,
      expectedRevision: 0,
      mutationId: randomUUID(),
      schemaVersion: 3,
    };
    const saved = await f.app.inject({
      method: "PUT",
      url: `/v1/quizzes/${f.quizId}/draft`,
      headers: { cookie: f.cookie },
      payload: mutation,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ quiz: { draftSchemaVersion: 3 } });
    expect((await f.publish()).json()).toMatchObject({ version: { contentSchemaVersion: 3 } });
    const reserve = vi.spyOn(f.cache, "reserveSessionCode");
    const pollOnly = { protocolVersion: 3 as const, capabilities: ["poll.multiselect" as const] };
    await expect(
      f.sessions.createSession(f.owner, f.quizId, settings, { clientCapabilities: pollOnly }),
    ).rejects.toMatchObject({ code: "CLIENT_UPDATE_REQUIRED" });
    expect(reserve).not.toHaveBeenCalled();
    const room = await f.sessions.createSession(f.owner, f.quizId, settings, {
      clientCapabilities: currentRoundClientCapabilities(),
    });
    expect(room.snapshot).toMatchObject({
      stateSchemaVersion: 8,
      roundProtocol: { minimumClientVersion: 3, requiredCapabilities: ["response.ranking"] },
    });
    f.config.FEATURE_ROUND_CLIENT_PROTOCOL = false;
    expect((await f.save()).statusCode).toBe(404);
    expect((await f.publish()).statusCode).toBe(404);
    for (const [url, payload] of [
      [`/v1/quizzes/${f.quizId}/duplicate`, undefined],
      ["/v1/quizzes/import", { format: "openround_json", data: openRoundJson(f.draft) }],
      [
        `/v1/quizzes/${f.quizId}/history/1/restore`,
        { expectedRevision: 1, mutationId: randomUUID() },
      ],
    ] as const) {
      const response = await f.app.inject({
        method: "POST",
        url,
        headers: { cookie: f.cookie },
        payload,
      });
      expect(response.statusCode).toBe(404);
    }
    const read = await f.app.inject({
      url: `/v1/quizzes/${f.quizId}`,
      headers: { cookie: f.cookie },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      quiz: { draft: { questions: [{ type: "ranking", rankCount: 2 }] } },
    });
  });

  it("preserves ranking order through retries, restart, reveal and captured report reconciliation", async () => {
    const f = await fixture();
    f.config.CORE_PARITY_WORKSPACE_ALLOWLIST.push(f.owner.workspaceId);
    expect((await f.save()).statusCode).toBe(200);
    expect((await f.publish()).statusCode).toBe(200);
    const capable = currentRoundClientCapabilities();
    const room = await f.sessions.createSession(f.owner, f.quizId, settings, {
      clientCapabilities: capable,
    });
    await expect(
      f.sessions.join({
        code: room.code,
        clientCapabilities: { protocolVersion: 3, capabilities: ["poll.multiselect"] },
      }),
    ).rejects.toMatchObject({ code: "CLIENT_UPDATE_REQUIRED" });
    const guests = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        f.sessions.join({
          code: room.code,
          nickname: `Guest ${index + 1}`,
          clientCapabilities: capable,
        }),
      ),
    );
    const lobby = await f.sessions.snapshot({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      clientCapabilities: capable,
    });
    const opened = await f.sessions.hostCommand({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      clientCapabilities: capable,
      action: "start",
      commandId: randomUUID(),
      expectedVersion: lobby.version,
    });
    const question = f.draft.questions[0]!;
    if (question.type !== "ranking") throw new Error("Expected ranking question");
    const [a, b, c] = question.choices.map((choice) => choice.id);
    for (const choiceIds of [[a!], [a!, a!], [a!, b!, c!], [a!, randomUUID()]]) {
      const invalid = await f.sessions.answer({
        sessionId: room.sessionId,
        participantToken: guests[0]!.participantToken,
        roundId: opened.roundId!,
        idempotencyKey: randomUUID(),
        clientCapabilities: capable,
        response: { kind: "ranking", choiceIds },
      });
      expect(invalid).toMatchObject({ accepted: false, code: "ANSWER_INVALID" });
    }
    const requests = guests.map((guest, index) => ({
      sessionId: room.sessionId,
      participantToken: guest.participantToken,
      roundId: opened.roundId!,
      idempotencyKey: randomUUID(),
      clientCapabilities: capable,
      response: { kind: "ranking" as const, choiceIds: index < 3 ? [a!, b!] : [b!, a!] },
    }));
    const accepted = await Promise.all(requests.map((request) => f.sessions.answer(request)));
    expect(accepted.every((ack) => ack.accepted && ack.score === 0)).toBe(true);
    const same = await f.sessions.answer(requests[0]!);
    expect(same).toMatchObject({
      accepted: true,
      duplicate: true,
      answerId: accepted[0]!.answerId,
    });
    const reordered = await f.sessions.answer({
      ...requests[0]!,
      response: { kind: "ranking", choiceIds: [b!, a!] },
    });
    expect(reordered).toMatchObject({ accepted: false, duplicate: false, code: "ANSWER_INVALID" });
    f.sessions.close();
    const restored = new SessionService(
      f.repository,
      new MemorySessionCache(),
      { ...f.config, FEATURE_ROUND_CLIENT_PROTOCOL: false, CORE_PARITY_WORKSPACE_ALLOWLIST: [] },
      new MetricsService(),
    );
    services.push(restored);
    expect(await restored.answer(requests[0]!)).toMatchObject({
      accepted: true,
      duplicate: true,
      answerId: accepted[0]!.answerId,
    });
    const own = await restored.sync({
      sessionId: room.sessionId,
      role: "participant",
      participantToken: guests[0]!.participantToken,
      lastSeq: 0,
      clientCapabilities: capable,
    });
    expect(own.snapshot.myResponse).toEqual(requests[0]!.response);
    const host = await restored.snapshot({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      clientCapabilities: capable,
    });
    const locked = await restored.hostCommand({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      clientCapabilities: capable,
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: host.version,
    });
    const revealed = await restored.hostCommand({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      clientCapabilities: capable,
      action: "reveal",
      commandId: randomUUID(),
      expectedVersion: locked.version,
    });
    expect(revealed.responseDistribution).toMatchObject({
      kind: "ranking",
      respondents: 5,
      rankCount: 2,
      totalRankings: 10,
      buckets: [
        { value: a, weightedScore: 13, rankedRespondents: 5, averageRank: 1.4 },
        { value: b, weightedScore: 12, rankedRespondents: 5, averageRank: 1.6 },
        { value: c, weightedScore: 0, rankedRespondents: 0, averageRank: null },
      ],
    });
    await restored.hostCommand({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      clientCapabilities: capable,
      action: "end",
      commandId: randomUUID(),
      expectedVersion: revealed.version,
    });
    expect(
      await f.repository.getReportBySession(f.owner.workspaceId, room.sessionId),
    ).toMatchObject({ schemaVersion: 6, status: "pending" });
    expect(await new ReportWorker(f.repository, 60_000).runOnce()).toBe("completed");
    const report = (await f.repository.getReportBySession(f.owner.workspaceId, room.sessionId))!;
    expect(report).toMatchObject({
      schemaVersion: 6,
      status: "ready",
      decisionReplayAvailable: true,
      decisionReplayComplete: true,
      metrics: { accuracyPercent: null },
      initialAccuracy: { responses: 0, percent: null },
      questions: [
        {
          correct: null,
          accuracyPercent: null,
          responseDistribution: revealed.responseDistribution,
        },
      ],
    });
    expect(reportCsv(report)).toContain(",'=Priority A,13,5,1.4,2,5,10");
  });
});
