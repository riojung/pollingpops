import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ReportV3Schema, type SessionSnapshot } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

const sessionSummaryKeys = [
  "id",
  "quizId",
  "title",
  "status",
  "phase",
  "code",
  "participantCount",
  "answerCount",
  "questionCount",
  "questionPosition",
  "createdAt",
  "updatedAt",
  "expiresAt",
  "reportId",
] as const;

const reportSummaryKeys = [
  "id",
  "sessionId",
  "quizId",
  "title",
  "status",
  "trustMode",
  "participantCount",
  "initialAccuracyPercent",
  "recovery",
  "unresolvedConceptCount",
  "interventionCount",
  "followupId",
  "followupStatus",
  "generatedAt",
  "createdAt",
  "expiresAt",
] as const;

const followupSummaryKeys = [
  "id",
  "purpose",
  "trustMode",
  "sourceQuizVersionId",
  "sourceSessionId",
  "sourceReportId",
  "quizId",
  "recoveryPackSource",
  "title",
  "status",
  "conceptKeys",
  "checkpointCount",
  "attemptCount",
  "completedAttemptCount",
  "opensAt",
  "closesAt",
  "expiresAt",
  "createdAt",
] as const;

function expectExactKeys(value: unknown, keys: readonly string[]) {
  expect(value).toBeTypeOf("object");
  expect(Object.keys(value as Record<string, unknown>).sort()).toEqual([...keys].sort());
}

function expectApiError(
  response: LightMyRequestResponse,
  statusCode: number,
  code: string,
  message: string,
) {
  expect(response.statusCode).toBe(statusCode);
  expect(response.json()).toEqual({
    error: { code, message, requestId: expect.any(String) },
  });
}

async function build(repository = new MemoryRepository()) {
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  return { app: built.app, repository, sessions: built.sessions };
}

async function signIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(target, `/v1/auth/verify?token=${token}`, email);
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const me = await target.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  return {
    cookie,
    creator: me.json<{ creator: { userId: string; workspaceId: string } }>().creator,
  };
}

async function createPublishedRound(target: FastifyInstance, cookie: string) {
  const starter = await target.inject({
    method: "POST",
    url: "/v1/starters/misconception-check/use",
    headers: { cookie },
  });
  expect(starter.statusCode).toBe(201);
  const quiz = starter.json<{ quiz: { id: string; title: string } }>().quiz;
  const published = await target.inject({
    method: "POST",
    url: `/v1/quizzes/${quiz.id}/publish`,
    headers: { cookie },
    payload: { expectedDraftRevision: 0 },
  });
  expect(published.statusCode).toBe(200);
  return quiz;
}

async function createSession(target: FastifyInstance, cookie: string, quizId: string) {
  const response = await target.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: { cookie },
    payload: {
      quizId,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{
    sessionId: string;
    hostToken: string;
    snapshot: SessionSnapshot;
  }>();
}

function readyReport(sessionId: string, reportId: string, expiresAt: Date) {
  return ReportV3Schema.parse({
    id: reportId,
    sessionId,
    schemaVersion: 3,
    status: "ready",
    generatedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    metrics: {
      participantCount: 0,
      completedCount: 0,
      answerCount: 0,
      accuracyPercent: 0,
    },
    questions: [],
    participants: [],
    initialAccuracy: { correct: 0, responses: 0, percent: 0 },
    confidenceMatrix: [],
    misconceptions: [],
    interventions: [],
    recovery: [],
    unresolvedConcepts: [
      { conceptKey: "topic.core-model", initiallyIncorrect: 1, recovered: 0, unresolved: 1 },
    ],
    participation: { participants: 0, respondents: 0, percent: 0 },
    responseTime: { responses: 0, medianMs: null, p95Ms: null },
    qna: { questions: 0, answered: 0, unresolved: 0 },
    participantFeedback: [],
    evidenceNote: "Security regression fixture",
    experience: { category: "education", preset: { id: "campus", version: 1 } },
    audiencePulse: {
      uniqueParticipants: 0,
      events: 0,
      bySignal: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
      contexts: [],
    },
    conversation: {
      messages: 0,
      uniqueContributors: 0,
      reactions: 0,
      reports: 0,
      removed: 0,
      moderationActions: 0,
      peakMessagesPerMinute: 0,
      transcriptAvailable: false,
    },
  });
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("P0 beta API privacy and recovery regressions", () => {
  it("round-trips the exact report keyset cursor and returns only the summary contract", async () => {
    const { app: target, repository } = await build();
    const { cookie } = await signIn(target, "report-cursor-security@example.com");
    const exactCreatedAt = "2026-09-18T12:00:00.000900Z";
    const createdAt = new Date(exactCreatedAt);
    const reportId = randomUUID();
    let receivedCursor: Parameters<MemoryRepository["listReportHistory"]>[1]["cursor"];

    repository.listReportHistory = async (_workspaceId, options) => {
      receivedCursor = options.cursor;
      return options.cursor
        ? { items: [], hasMore: false }
        : {
            items: [
              {
                id: reportId,
                sessionId: randomUUID(),
                quizId: randomUUID(),
                title: "Exact report cursor",
                status: "ready",
                trustMode: "learning",
                participantCount: 5,
                initialAccuracyPercent: 40,
                recovery: { recovered: 2, eligible: 3, percent: 66.67 },
                unresolvedConceptCount: 1,
                interventionCount: 1,
                followupId: null,
                followupStatus: null,
                generatedAt: createdAt,
                createdAt,
                cursorCreatedAt: exactCreatedAt,
                expiresAt: new Date("2026-10-18T12:00:00.000Z"),
              },
            ],
            hasMore: true,
          };
    };

    const firstPage = await target.inject({
      method: "GET",
      url: "/v1/reports?limit=1",
      headers: { cookie },
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json<{
      items: Array<Record<string, unknown>>;
      nextCursor: string;
    }>();
    expectExactKeys(firstBody, ["items", "nextCursor"]);
    expectExactKeys(firstBody.items[0], reportSummaryKeys);
    expect(JSON.parse(Buffer.from(firstBody.nextCursor, "base64url").toString("utf8"))).toEqual({
      createdAt: exactCreatedAt,
      id: reportId,
    });

    const nextPage = await target.inject({
      method: "GET",
      url: `/v1/reports?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: { cookie },
    });
    expect(nextPage.statusCode).toBe(200);
    expect(nextPage.json()).toEqual({ items: [], nextCursor: null });
    expect(receivedCursor).toMatchObject({
      cursorCreatedAt: exactCreatedAt,
      id: reportId,
    });
  });

  it("keeps history DTOs minimal and denies known IDs across tenants", async () => {
    const primaryWorkspaceId = randomUUID();
    const { app: target, repository } = await build(
      new MemoryRepository({ initialWorkspaceId: primaryWorkspaceId }),
    );
    const primary = await signIn(target, "history-owner@example.com");
    expect(primary.creator.workspaceId).toBe(primaryWorkspaceId);
    const quiz = await createPublishedRound(target, primary.cookie);
    const session = await createSession(target, primary.cookie, quiz.id);
    const storedSession = await repository.getSessionById(session.sessionId);
    expect(storedSession).not.toBeNull();
    const reportId = randomUUID();
    await repository.saveReport(
      primaryWorkspaceId,
      readyReport(session.sessionId, reportId, storedSession!.retentionExpiresAt),
    );
    await repository.setPlan(primaryWorkspaceId, "pro");
    const followupResponse = await target.inject({
      method: "POST",
      url: `/v1/reports/${reportId}/followups`,
      headers: { cookie: primary.cookie },
      payload: {
        conceptKeys: ["topic.core-model"],
        closesAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      },
    });
    expect(followupResponse.statusCode).toBe(201);
    const followupId = followupResponse.json<{ followup: { id: string } }>().followup.id;

    const sessionsPage = await target.inject({
      method: "GET",
      url: "/v1/sessions",
      headers: { cookie: primary.cookie },
    });
    const sessionsBody = sessionsPage.json<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>();
    expectExactKeys(sessionsBody, ["items", "nextCursor"]);
    expectExactKeys(sessionsBody.items[0], sessionSummaryKeys);

    const reportsPage = await target.inject({
      method: "GET",
      url: "/v1/reports",
      headers: { cookie: primary.cookie },
    });
    const reportsBody = reportsPage.json<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>();
    expectExactKeys(reportsBody, ["items", "nextCursor"]);
    expectExactKeys(reportsBody.items[0], reportSummaryKeys);

    const followupsPage = await target.inject({
      method: "GET",
      url: "/v1/followups",
      headers: { cookie: primary.cookie },
    });
    const followupsBody = followupsPage.json<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>();
    expectExactKeys(followupsBody, ["items", "nextCursor"]);
    expectExactKeys(followupsBody.items[0], followupSummaryKeys);
    expect(followupsBody.items[0]!.recoveryPackSource).toBeNull();
    expect(JSON.stringify([sessionsBody, reportsBody, followupsBody])).not.toMatch(
      /hostToken|state_snapshot|participantAlias|responsePayload|chatContent/,
    );

    const outsider = await signIn(target, "known-id-outsider@example.com");
    expect(outsider.creator.workspaceId).not.toBe(primaryWorkspaceId);
    const outsiderQuiz = await createPublishedRound(target, outsider.cookie);
    const outsiderSession = await createSession(target, outsider.cookie, outsiderQuiz.id);
    const credentialsBefore = await repository.listSessionStaff(
      primaryWorkspaceId,
      session.sessionId,
    );
    const auditsBefore = repository.audits.length;

    expectApiError(
      await target.inject({
        method: "GET",
        url: `/v1/sessions/${session.sessionId}/staff`,
        headers: { cookie: outsider.cookie },
      }),
      404,
      "NOT_FOUND",
      "Session not found",
    );
    expectApiError(
      await target.inject({
        method: "GET",
        url: `/v1/sessions/${session.sessionId}/snapshot?role=host`,
        headers: { authorization: `Bearer ${outsiderSession.hostToken}` },
      }),
      401,
      "UNAUTHORIZED",
      "Session staff credential is invalid or expired",
    );
    expectApiError(
      await target.inject({
        method: "POST",
        url: `/v1/sessions/${session.sessionId}/control-pass`,
        headers: { cookie: outsider.cookie },
      }),
      404,
      "NOT_FOUND",
      "Session not found",
    );
    expectApiError(
      await target.inject({
        method: "GET",
        url: `/v1/sessions/${session.sessionId}/report`,
        headers: { cookie: outsider.cookie },
      }),
      404,
      "NOT_FOUND",
      "Report not found",
    );
    expectApiError(
      await target.inject({
        method: "GET",
        url: `/v1/reports/${reportId}`,
        headers: { cookie: outsider.cookie },
      }),
      404,
      "NOT_FOUND",
      "Report not found",
    );
    expectApiError(
      await target.inject({
        method: "GET",
        url: `/v1/followups/${followupId}`,
        headers: { cookie: outsider.cookie },
      }),
      404,
      "NOT_FOUND",
      "Follow-up not found",
    );

    expect(await repository.listSessionStaff(primaryWorkspaceId, session.sessionId)).toEqual(
      credentialsBefore,
    );
    expect(repository.audits).toHaveLength(auditsBefore);
  });

  it("does not issue or audit a creator pass when the session finishes during replacement", async () => {
    const { app: target, repository } = await build();
    const owner = await signIn(target, "control-pass-race@example.com");
    const quiz = await createPublishedRound(target, owner.cookie);
    const session = await createSession(target, owner.cookie, quiz.id);
    const initialPass = await target.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/control-pass`,
      headers: { cookie: owner.cookie },
    });
    expect(initialPass.statusCode).toBe(201);

    const storedSession = repository.sessions.get(session.sessionId)!;
    const activePhase = storedSession.state.phase;
    const replacement = repository.replaceCreatorResumeCredential.bind(repository);
    const credentialsBefore = await repository.listSessionStaff(
      owner.creator.workspaceId,
      session.sessionId,
    );
    const auditsBefore = repository.audits.length;
    repository.replaceCreatorResumeCredential = async (input) => {
      storedSession.state.phase = "finished";
      return replacement(input);
    };

    const racedPass = await target.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/control-pass`,
      headers: { cookie: owner.cookie },
    });
    expectApiError(racedPass, 409, "CONFLICT", "Only an active live session can be resumed");
    expect(await repository.listSessionStaff(owner.creator.workspaceId, session.sessionId)).toEqual(
      credentialsBefore,
    );
    expect(repository.audits).toHaveLength(auditsBefore);

    repository.replaceCreatorResumeCredential = replacement;
    storedSession.state.phase = activePhase;
  });
});
