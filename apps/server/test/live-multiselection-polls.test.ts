import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentRoundClientCapabilities,
  deriveRoundProtocol,
  type QuizDraft,
} from "@openround/contracts";
import { MemoryRepository, type CreatorContext, type SessionEvidence } from "@openround/db";
import { addParticipant, createGameState } from "@openround/game-engine";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import { openRoundJson } from "../src/portability.js";
import { ReportWorker } from "../src/report-worker.js";
import { generateReport, reportCsv } from "../src/reporting.js";
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

function pollDraft(): QuizDraft {
  return {
    title: "Priorities",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "poll",
        prompt: "Which priorities matter?",
        maxSelections: 2,
        purpose: "opinion",
        confidence: "off",
        choices: ["Ease of use", "Reliability", "New features"].map((label) => ({
          id: randomUUID(),
          label,
          isCorrect: false,
        })),
        timeLimitSeconds: 300,
        basePoints: 0,
        explanation: "Every response is an opinion.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
}

async function fixture(allowlisted = true) {
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "true",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    LOG_LEVEL: "silent",
    FEATURE_ROUND_CLIENT_PROTOCOL: "true",
  });
  const repository = new MemoryRepository();
  const cache = new MemorySessionCache();
  const built = await buildApp(config, { repository, cache });
  apps.push(built.app);
  const verifiedEmail = `${randomUUID()}@example.com`;
  const magic = await built.app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: verifiedEmail, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    built.app,
    `/v1/auth/verify?token=${token}`,
    verifiedEmail,
  );
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const me = await built.app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  const owner = me.json<{ creator: CreatorContext }>().creator;
  if (allowlisted) config.CORE_PARITY_WORKSPACE_ALLOWLIST.push(owner.workspaceId);
  const created = await built.app.inject({
    method: "POST",
    url: "/v1/quizzes",
    headers: { cookie },
    payload: { title: "Priorities", description: "" },
  });
  const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
  const draft = pollDraft();
  const save = (nextDraft = draft) =>
    built.app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: nextDraft,
    });
  const publish = () =>
    built.app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/publish`,
      headers: { cookie },
    });
  return { ...built, config, repository, cache, owner, cookie, quizId, draft, save, publish };
}

describe("live multiple-selection opinion polls", () => {
  it("gates content writers and keeps retained content readable after rollout rollback", async () => {
    const f = await fixture(false);
    const availability = () =>
      f.app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: f.cookie } });
    expect((await availability()).json()).toMatchObject({
      productFeatures: { multiSelectPolls: false },
    });
    expect((await f.save()).statusCode).toBe(404);
    f.config.CORE_PARITY_WORKSPACE_ALLOWLIST.push(f.owner.workspaceId);
    f.config.FEATURE_ROUND_CLIENT_PROTOCOL = false;
    expect((await f.save()).statusCode).toBe(404);
    f.config.FEATURE_ROUND_CLIENT_PROTOCOL = true;
    expect((await availability()).json()).toMatchObject({
      productFeatures: { multiSelectPolls: true },
    });
    expect((await f.save()).json()).toMatchObject({ quiz: { draftSchemaVersion: 2 } });
    const revisionedSave = await f.app.inject({
      method: "PUT",
      url: `/v1/quizzes/${f.quizId}/draft`,
      headers: { cookie: f.cookie },
      payload: {
        draft: f.draft,
        expectedRevision: 1,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(revisionedSave.statusCode).toBe(200);
    expect(revisionedSave.json()).toMatchObject({ quiz: { draftSchemaVersion: 2 } });
    expect((await f.publish()).json()).toMatchObject({ version: { contentSchemaVersion: 2 } });
    const saved = (await f.repository.getQuiz(f.owner.workspaceId, f.quizId))!;
    f.config.FEATURE_ROUND_CLIENT_PROTOCOL = false;
    const read = await f.app.inject({
      method: "GET",
      url: `/v1/quizzes/${f.quizId}`,
      headers: { cookie: f.cookie },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ quiz: { draft: { questions: [{ maxSelections: 2 }] } } });
    expect((await f.save()).statusCode).toBe(404);
    expect((await f.publish()).statusCode).toBe(404);
    for (const [url, payload] of [
      [`/v1/quizzes/${f.quizId}/duplicate`, undefined],
      ["/v1/quizzes/import", { format: "openround_json", data: openRoundJson(f.draft) }],
      [
        `/v1/quizzes/${f.quizId}/history/${saved.draftRevision}/restore`,
        { expectedRevision: saved.draftRevision, mutationId: randomUUID() },
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
    const mutation = await f.app.inject({
      method: "PUT",
      url: `/v1/quizzes/${f.quizId}/draft`,
      headers: { cookie: f.cookie },
      payload: {
        draft: f.draft,
        expectedRevision: saved.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(mutation.statusCode).toBe(404);
    expect((await f.repository.getQuiz(f.owner.workspaceId, f.quizId))!.draftRevision).toBe(
      saved.draftRevision,
    );
  });

  it("fences old clients before room creation and preserves active rooms, answers and reports after rollback", async () => {
    const f = await fixture();
    expect((await f.save()).statusCode).toBe(200);
    expect((await f.publish()).statusCode).toBe(200);
    const reserve = vi.spyOn(f.cache, "reserveSessionCode");
    const writes = vi.spyOn(f.repository, "createSession");
    await expect(f.sessions.createSession(f.owner, f.quizId, settings)).rejects.toMatchObject({
      code: "CLIENT_UPDATE_REQUIRED",
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    const capable = currentRoundClientCapabilities();
    f.config.CORE_PARITY_WORKSPACE_ALLOWLIST = [];
    await expect(
      f.sessions.createSession(f.owner, f.quizId, settings, { clientCapabilities: capable }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    f.config.CORE_PARITY_WORKSPACE_ALLOWLIST = [f.owner.workspaceId];
    const room = await f.sessions.createSession(f.owner, f.quizId, settings, {
      clientCapabilities: capable,
    });
    expect(room.snapshot.roundProtocol).toEqual({
      schemaVersion: 1,
      minimumClientVersion: 3,
      requiredCapabilities: ["poll.multiselect"],
    });
    await expect(
      f.sessions.join({ code: room.code, nickname: "Old client" }),
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
    if (question.type !== "poll") throw new Error("Expected opinion poll");
    const choiceIds = question.choices.slice(0, 2).map((choice) => choice.id);
    const requests = guests.map((guest, index) => ({
      sessionId: room.sessionId,
      roundId: opened.roundId!,
      participantToken: guest.participantToken,
      idempotencyKey: randomUUID(),
      response: { kind: "poll" as const, choiceIds },
      clientCapabilities: index === 0 ? { protocolVersion: 2 as const, capabilities: [] } : capable,
    }));
    const commits = vi.spyOn(f.repository, "commitAnswers");
    const results = await Promise.allSettled(requests.map((request) => f.sessions.answer(request)));
    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { code: "CLIENT_UPDATE_REQUIRED" },
    });
    expect(results.slice(1).every((result) => result.status === "fulfilled")).toBe(true);
    expect(commits).toHaveBeenCalledTimes(1);
    expect(commits.mock.calls[0]![1]).toHaveLength(4);
    requests[0]!.clientCapabilities = capable;
    const receipt = await f.sessions.answer(requests[0]!);
    expect(receipt).toMatchObject({ accepted: true });
    expect(receipt).not.toHaveProperty("score");
    f.sessions.close();
    const restored = new SessionService(
      f.repository,
      new MemorySessionCache(),
      { ...f.config, FEATURE_ROUND_CLIENT_PROTOCOL: false, CORE_PARITY_WORKSPACE_ALLOWLIST: [] },
      new MetricsService(),
    );
    services.push(restored);
    await expect(
      restored.createSession(f.owner, f.quizId, settings, { clientCapabilities: capable }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const retry = await restored.answer({
      ...requests[1]!,
      response: { kind: "poll", choiceIds: [...choiceIds].reverse() },
    });
    expect(retry).toMatchObject({ accepted: true, duplicate: true });
    expect(retry).not.toHaveProperty("score");
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
      kind: "choice",
      respondents: 5,
      totalSelections: 10,
      percentBasis: "respondents",
      buckets: [
        { count: 5, percent: 100 },
        { count: 5, percent: 100 },
        { count: 0, percent: 0 },
      ],
    });
    const participant = await restored.sync({
      sessionId: room.sessionId,
      role: "participant",
      participantToken: guests[1]!.participantToken,
      lastSeq: 0,
      clientCapabilities: capable,
    });
    expect(participant.snapshot).toMatchObject({
      myCorrect: null,
      myResponse: { kind: "poll", choiceIds: [...choiceIds].sort() },
    });
    await restored.hostCommand({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      clientCapabilities: capable,
      action: "end",
      commandId: randomUUID(),
      expectedVersion: revealed.version,
    });
    const pending = await f.repository.getReportBySession(f.owner.workspaceId, room.sessionId);
    expect(pending).toMatchObject({ schemaVersion: 5, status: "pending" });
    expect(await new ReportWorker(f.repository, 60_000).runOnce()).toBe("completed");
    const report = (await f.repository.getReportBySession(f.owner.workspaceId, room.sessionId))!;
    expect(report).toMatchObject({
      schemaVersion: 5,
      status: "ready",
      metrics: { accuracyPercent: null },
      initialAccuracy: { correct: 0, responses: 0, percent: null },
      questions: [
        {
          responses: 5,
          correct: null,
          accuracyPercent: null,
          responseDistribution: {
            respondents: 5,
            totalSelections: 10,
            percentBasis: "respondents",
          },
        },
      ],
    });
    expect(
      report.participants.every(
        (participant) => participant.score === 0 && participant.correctCount === 0,
      ),
    ).toBe(true);
    expect(reportCsv(report)).toContain("respondents,5,10");
  });

  it("keeps assessed accuracy separate from opinion selections in a mixed report", () => {
    const quiz = pollDraft();
    const numericQuestion = {
      id: randomUUID(),
      type: "numeric" as const,
      prompt: "Two plus two?",
      purpose: "diagnostic" as const,
      confidence: "off" as const,
      correctValue: "4",
      tolerance: "0",
      unit: null,
      timeLimitSeconds: 300,
      basePoints: 100,
      explanation: "Two pairs.",
      mediaId: null,
      mediaAlt: null,
    };
    quiz.questions.unshift(numericQuestion);
    let state = createGameState({
      sessionId: randomUUID(),
      code: "1234567",
      quiz,
      settings,
      roundProtocol: deriveRoundProtocol(quiz),
    });
    const poll = quiz.questions[1]!;
    if (poll.type !== "poll") throw new Error("Expected poll");
    poll.choices[0]!.label = "=1+1";
    const participants = Array.from({ length: 5 }, () => randomUUID());
    for (const [index, id] of participants.entries()) {
      state = addParticipant(state, {
        id,
        nickname: `Guest ${index + 1}`,
        score: 0,
        correctCount: 0,
        acceptedResponseMs: 0,
        connected: false,
        kicked: false,
      }).state;
    }
    const numericRoundId = randomUUID();
    const pollRoundId = randomUUID();
    const evidence: SessionEvidence = {
      decisionReplayEnabled: false,
      decisionEvents: [],
      decisionEventsComplete: false,
      answers: participants.flatMap((participantId, index) => [
        {
          answerId: randomUUID(),
          participantId,
          roundId: numericRoundId,
          response: { kind: "numeric" as const, value: index < 4 ? "4" : "5" },
          confidence: null,
          choiceId: null,
          acceptedAtMs: 2_000,
          responseMs: 1_000,
          score: index < 4 ? 100 : 0,
          correct: index < 4,
          idempotencyKey: randomUUID(),
        },
        {
          answerId: randomUUID(),
          participantId,
          roundId: pollRoundId,
          response: {
            kind: "poll" as const,
            choiceIds: poll.choices.slice(0, 2).map((choice) => choice.id),
          },
          confidence: null,
          choiceId: null,
          acceptedAtMs: 4_000,
          responseMs: 1_000,
          score: 0,
          correct: false,
          idempotencyKey: randomUUID(),
        },
      ]),
      rounds: [numericQuestion, poll].map((question, index) => ({
        id: index === 0 ? numericRoundId : pollRoundId,
        questionId: question.id,
        position: index,
        kind: "main" as const,
        sourceRoundId: null,
        interventionId: null,
        openedAtMs: 1_000,
        deadlineMs: 301_000,
        lockedAtMs: 5_000,
      })),
      interventions: [],
      qna: { questions: 0, answered: 0, unresolved: 0 },
    };
    const report = generateReport(state, new Date("2026-11-01T00:00:00.000Z"), { evidence });
    expect(report).toMatchObject({
      schemaVersion: 5,
      metrics: { answerCount: 10, accuracyPercent: 80 },
      initialAccuracy: { correct: 4, responses: 5, percent: 80 },
      questions: [
        { correct: 4, accuracyPercent: 80 },
        { responses: 5, correct: null, accuracyPercent: null },
      ],
    });
    expect(reportCsv(report)).toContain(",'=1+1,5,100,respondents,5,10");
  });
});
