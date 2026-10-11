import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ReportV3Schema } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

async function signIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await target.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const me = await target.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  return {
    cookie,
    creator: me.json<{
      creator: { userId: string; workspaceId: string };
      entitlements: { cohosting: boolean };
      productFeatures: {
        uxBeta: boolean;
        recoveryRehearsal: boolean;
        practiceAssignments: boolean;
      };
    }>(),
  };
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("P0 beta creator APIs", () => {
  it("fails closed with an empty workspace allowlist, including session snapshots", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        FEATURE_RECOVERY_REHEARSAL: "true",
        FEATURE_PRACTICE_ASSIGNMENTS: "true",
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const signedIn = await signIn(app, "beta-excluded@example.com");
    expect(signedIn.creator.productFeatures).toMatchObject({
      uxBeta: false,
      recoveryRehearsal: false,
      practiceAssignments: false,
    });
    const starter = await app.inject({
      method: "POST",
      url: "/v1/starters/icebreaker-poll/use",
      headers: { cookie: signedIn.cookie },
    });
    const quizId = starter.json<{ quiz: { id: string } }>().quiz.id;
    await app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/publish`,
      headers: { cookie: signedIn.cookie },
      payload: { expectedDraftRevision: 0 },
    });
    const assignment = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/practice-assignments`,
      headers: { cookie: signedIn.cookie },
      payload: {
        closesAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        personalLabels: [],
      },
    });
    expect(assignment.statusCode).toBe(404);
    expect(assignment.json()).toMatchObject({
      error: { code: "NOT_FOUND", message: "Practice assignments are not available" },
    });
    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { cookie: signedIn.cookie },
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
    expect(session.statusCode).toBe(201);
    expect(session.json<{ snapshot: { uxBeta?: boolean } }>().snapshot.uxBeta).toBe(false);
  });

  it("instantiates immutable starters with fresh IDs and exposes allowlisted features", async () => {
    const workspaceId = randomUUID();
    const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        FEATURE_RECOVERY_REHEARSAL: "true",
        FEATURE_PRACTICE_ASSIGNMENTS: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const signedIn = await signIn(app, "beta-starters@example.com");

    expect(signedIn.creator.entitlements.cohosting).toBe(false);
    expect(signedIn.creator.productFeatures).toMatchObject({
      uxBeta: true,
      recoveryRehearsal: true,
      practiceAssignments: true,
    });
    const publicFeatures = await app.inject({ method: "GET", url: "/v1/features" });
    expect(publicFeatures.json()).toMatchObject({
      uxBeta: true,
      recoveryRehearsal: true,
      practiceAssignments: true,
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/starters",
      headers: { cookie: signedIn.cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ starters: unknown[] }>().starters).toHaveLength(24);

    const create = () =>
      app!.inject({
        method: "POST",
        url: "/v1/starters/misconception-check/use",
        headers: { cookie: signedIn.cookie },
      });
    const first = await create();
    const second = await create();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstQuiz = first.json<{
      quiz: {
        id: string;
        draft: {
          questions: Array<{
            id: string;
            choices: Array<{ id: string }>;
            linkedRecheckQuestionId: string | null;
          }>;
        };
      };
    }>().quiz;
    const secondQuiz =
      second.json<typeof firstQuiz extends never ? never : { quiz: typeof firstQuiz }>().quiz;
    expect(firstQuiz.id).not.toBe(secondQuiz.id);
    expect(firstQuiz.draft.questions.map((question) => question.id)).not.toEqual(
      secondQuiz.draft.questions.map((question) => question.id),
    );
    expect(
      firstQuiz.draft.questions.flatMap((question) => question.choices.map(({ id }) => id)),
    ).not.toEqual(
      secondQuiz.draft.questions.flatMap((question) => question.choices.map(({ id }) => id)),
    );
    expect(firstQuiz.draft.questions[0]!.linkedRecheckQuestionId).toBe(
      firstQuiz.draft.questions[1]!.id,
    );
    const roundOptions = await app.inject({
      method: "GET",
      url: "/v1/quizzes?archived=true&summary=true",
      headers: { cookie: signedIn.cookie },
    });
    expect(roundOptions.statusCode).toBe(200);
    const firstRoundOption = roundOptions
      .json<{ quizzes: Array<{ id: string; title: string }> }>()
      .quizzes.find((round) => round.id === firstQuiz.id);
    expect(firstRoundOption).toEqual({ id: firstQuiz.id, title: "Misconception check" });
    expect(roundOptions.body).not.toContain("questions");
  });

  it("creates and manages standalone practice with one-time private links", async () => {
    const workspaceId = randomUUID();
    const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_UX_BETA: "true",
      FEATURE_PRACTICE_ASSIGNMENTS: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      LOG_LEVEL: "silent",
    });
    const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
    app = built.app;
    const signedIn = await signIn(app, "practice-assignment@example.com");
    const starter = await app.inject({
      method: "POST",
      url: "/v1/starters/misconception-check/use",
      headers: { cookie: signedIn.cookie },
    });
    const quizId = starter.json<{ quiz: { id: string } }>().quiz.id;
    const published = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/publish`,
      headers: { cookie: signedIn.cookie },
      payload: { expectedDraftRevision: 0 },
    });
    expect(published.statusCode).toBe(200);
    const firstPublishedVersionId = published.json<{ version: { id: string } }>().version.id;
    const freeAttempt = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/practice-assignments`,
      headers: { cookie: signedIn.cookie },
      payload: {
        sourceQuizVersionId: firstPublishedVersionId,
        closesAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        personalLabels: [],
      },
    });
    expect(freeAttempt.statusCode).toBe(402);
    expect(freeAttempt.json()).toMatchObject({ error: { code: "ENTITLEMENT_LIMIT" } });
    await repository.setPlan(workspaceId, "pro");
    const beforeRepublish = (await repository.getQuiz(workspaceId, quizId))!;
    await repository.updateQuiz(
      workspaceId,
      quizId,
      { ...beforeRepublish.draft, title: `${beforeRepublish.title} updated` },
      beforeRepublish.draftRevision,
    );

    const republished = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/publish`,
      headers: { cookie: signedIn.cookie },
      payload: { expectedDraftRevision: (beforeRepublish.draftRevision ?? 0) + 1 },
    });
    expect(republished.statusCode).toBe(200);
    const currentPublishedVersionId = republished.json<{ version: { id: string } }>().version.id;
    const stale = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/practice-assignments`,
      headers: { cookie: signedIn.cookie },
      payload: {
        sourceQuizVersionId: firstPublishedVersionId,
        closesAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
        personalLabels: [],
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: {
        code: "CONFLICT",
        message: "The published Round changed. Refresh before assigning practice",
      },
    });

    const created = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/practice-assignments`,
      headers: { cookie: signedIn.cookie },
      payload: {
        sourceQuizVersionId: currentPublishedVersionId,
        title: "Controls practice",
        timeMode: "flex",
        closesAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
        personalLabels: ["Learner A", "Learner B"],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("private, no-store");
    const creation = created.json<{
      followup: {
        id: string;
        purpose: string;
        sourceQuizVersionId: string;
        sourceSessionId: null;
        sourceReportId: null;
      };
      genericUrl: string;
      personalAccess: Array<{ id: string; kind: string; label: string; url: string }>;
    }>();
    expect(creation.followup).toMatchObject({
      purpose: "assignment",
      sourceQuizVersionId: currentPublishedVersionId,
      sourceSessionId: null,
      sourceReportId: null,
    });
    expect(creation.personalAccess).toEqual([
      expect.objectContaining({ kind: "assignment_personal", label: "Learner A" }),
      expect.objectContaining({ kind: "assignment_personal", label: "Learner B" }),
    ]);
    expect(created.body).not.toContain("tokenHash");

    const assignmentHistory = await app.inject({
      method: "GET",
      url: "/v1/followups?purpose=assignment&limit=1",
      headers: { cookie: signedIn.cookie },
    });
    expect(assignmentHistory.statusCode, assignmentHistory.body).toBe(200);
    expect(assignmentHistory.json()).toMatchObject({
      items: [{ id: creation.followup.id, purpose: "assignment" }],
      nextCursor: null,
    });
    const recoveryHistory = await app.inject({
      method: "GET",
      url: "/v1/followups?purpose=recovery&limit=1",
      headers: { cookie: signedIn.cookie },
    });
    expect(recoveryHistory.statusCode, recoveryHistory.body).toBe(200);
    expect(recoveryHistory.json()).toMatchObject({ items: [], nextCursor: null });

    const detail = await app.inject({
      method: "GET",
      url: `/v1/followups/${creation.followup.id}`,
      headers: { cookie: signedIn.cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.headers["cache-control"]).toBe("private, no-store");
    expect(detail.headers.pragma).toBe("no-cache");
    expect(detail.json()).toMatchObject({
      followup: { id: creation.followup.id, purpose: "assignment" },
      context: { quizId, quizTitle: "Misconception check updated", version: 2 },
      access: [
        { kind: "assignment_personal", label: "Learner A" },
        { kind: "assignment_personal", label: "Learner B" },
      ],
    });
    expect(detail.body).not.toMatch(/token|url/i);

    const replacement = await app.inject({
      method: "POST",
      url: `/v1/followups/${creation.followup.id}/personal-passes`,
      headers: { cookie: signedIn.cookie },
      payload: { label: "Replacement" },
    });
    expect(replacement.statusCode).toBe(201);
    expect(replacement.headers["cache-control"]).toBe("private, no-store");
    expect(replacement.json()).toMatchObject({
      access: { kind: "assignment_personal", label: "Replacement", url: expect.any(String) },
    });

    const accommodation = await app.inject({
      method: "POST",
      url: `/v1/followups/${creation.followup.id}/accommodation-passes`,
      headers: { cookie: signedIn.cookie },
      payload: { label: "Extended time", timeMultiplier: 1.5 },
    });
    expect(accommodation.statusCode).toBe(201);
    expect(accommodation.headers["cache-control"]).toBe("private, no-store");
    expect(accommodation.headers.pragma).toBe("no-cache");
    expect(accommodation.json()).toMatchObject({
      access: { kind: "accommodation", label: "Extended time", url: expect.any(String) },
    });
    expect(accommodation.body).not.toContain("tokenHash");

    const genericToken = new URLSearchParams(new URL(creation.genericUrl).hash.slice(1)).get(
      "token",
    )!;
    const started = await app.inject({
      method: "POST",
      url: `/v1/followups/${creation.followup.id}/start`,
      headers: { authorization: `Bearer ${genericToken}` },
      payload: {},
    });
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({
      snapshot: { purpose: "assignment", phase: "question_open" },
    });

    config.FEATURE_PRACTICE_ASSIGNMENTS = false;
    const disabledMint = await app.inject({
      method: "POST",
      url: `/v1/followups/${creation.followup.id}/personal-passes`,
      headers: { cookie: signedIn.cookie },
      payload: { label: "Disabled mint" },
    });
    expect(disabledMint.statusCode).toBe(404);
    const detailAfterDisable = await app.inject({
      method: "GET",
      url: `/v1/followups/${creation.followup.id}`,
      headers: { cookie: signedIn.cookie },
    });
    expect(detailAfterDisable.statusCode).toBe(200);
    const startAfterDisable = await app.inject({
      method: "POST",
      url: `/v1/followups/${creation.followup.id}/start`,
      headers: { authorization: `Bearer ${genericToken}` },
      payload: {},
    });
    expect(startAfterDisable.statusCode).toBe(201);
    const replacementId = replacement.json<{ access: { id: string } }>().access.id;
    const revokedAfterDisable = await app.inject({
      method: "DELETE",
      url: `/v1/followups/${creation.followup.id}/access/${replacementId}`,
      headers: { cookie: signedIn.cookie },
    });
    expect(revokedAfterDisable.statusCode).toBe(204);
    const closedAfterDisable = await app.inject({
      method: "POST",
      url: `/v1/followups/${creation.followup.id}/close`,
      headers: { cookie: signedIn.cookie },
    });
    expect(closedAfterDisable.statusCode).toBe(204);

    await built.productEvents.drain();
    expect(repository.productEvents).toContainEqual(
      expect.objectContaining({
        workspaceId,
        name: "practice_assignment_created",
        dimensions: { segment: "workplace", betaVersion: "p0-2026" },
      }),
    );
    const assignmentAudits = repository.audits.filter((audit) =>
      audit.action.startsWith("practice_assignment."),
    );
    expect(assignmentAudits.map((audit) => audit.action)).toEqual([
      "practice_assignment.create",
      "practice_assignment.personal_pass.create",
    ]);
    expect(JSON.stringify(assignmentAudits)).not.toMatch(/Learner|Replacement|#token=/);
  });

  it("preserves exact database timestamps in session and follow-up cursors", async () => {
    const repository = new MemoryRepository();
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
    const { cookie } = await signIn(app, "exact-history-cursors@example.com");
    const exactCreatedAt = "2026-09-18T12:00:00.000900Z";
    const createdAt = new Date(exactCreatedAt);
    const future = new Date("2026-09-19T12:00:00.000Z");
    const sessionId = randomUUID();
    let receivedSessionCursor:
      Parameters<MemoryRepository["listSessionHistory"]>[1]["cursor"] | undefined;
    repository.listSessionHistory = async (_workspaceId, options) => {
      receivedSessionCursor = options.cursor;
      return options.cursor
        ? { items: [], hasMore: false }
        : {
            items: [
              {
                id: sessionId,
                quizId: randomUUID(),
                title: "Exact session cursor",
                status: "active",
                phase: "lobby",
                code: "1234567",
                participantCount: 0,
                answerCount: 0,
                questionCount: 0,
                questionPosition: null,
                createdAt,
                cursorCreatedAt: exactCreatedAt,
                updatedAt: createdAt,
                expiresAt: future,
                reportId: null,
              },
            ],
            hasMore: true,
          };
    };

    const firstSessionPage = await app.inject({
      method: "GET",
      url: "/v1/sessions?limit=1",
      headers: { cookie },
    });
    const sessionCursor = firstSessionPage.json<{ nextCursor: string }>().nextCursor;
    expect(JSON.parse(Buffer.from(sessionCursor, "base64url").toString("utf8"))).toMatchObject({
      createdAt: exactCreatedAt,
      id: sessionId,
    });
    await app.inject({
      method: "GET",
      url: `/v1/sessions?limit=1&cursor=${encodeURIComponent(sessionCursor)}`,
      headers: { cookie },
    });
    expect(receivedSessionCursor).toMatchObject({
      cursorCreatedAt: exactCreatedAt,
      id: sessionId,
    });

    const followupId = randomUUID();
    let receivedFollowupCursor:
      Parameters<MemoryRepository["listFollowupHistory"]>[1]["cursor"] | undefined;
    repository.listFollowupHistory = async (_workspaceId, options) => {
      receivedFollowupCursor = options.cursor;
      return options.cursor
        ? { items: [], hasMore: false }
        : {
            items: [
              {
                id: followupId,
                purpose: "recovery" as const,
                trustMode: "learning" as const,
                sourceQuizVersionId: randomUUID(),
                sourceSessionId: sessionId,
                sourceReportId: randomUUID(),
                quizId: randomUUID(),
                title: "Exact follow-up cursor",
                status: "open",
                conceptKeys: ["exact_cursor"],
                checkpointCount: 1,
                attemptCount: 0,
                completedAttemptCount: 0,
                opensAt: createdAt,
                closesAt: future,
                expiresAt: future,
                createdAt,
                cursorCreatedAt: exactCreatedAt,
              },
            ],
            hasMore: true,
          };
    };

    const firstFollowupPage = await app.inject({
      method: "GET",
      url: "/v1/followups?limit=1",
      headers: { cookie },
    });
    expect(firstFollowupPage.statusCode, firstFollowupPage.body).toBe(200);
    const followupCursor = firstFollowupPage.json<{ nextCursor: string | null }>().nextCursor;
    expect(followupCursor).not.toBeNull();
    expect(JSON.parse(Buffer.from(followupCursor!, "base64url").toString("utf8"))).toMatchObject({
      createdAt: exactCreatedAt,
      id: followupId,
    });
    await app.inject({
      method: "GET",
      url: `/v1/followups?limit=1&cursor=${encodeURIComponent(followupCursor!)}`,
      headers: { cookie },
    });
    expect(receivedFollowupCursor).toMatchObject({
      cursorCreatedAt: exactCreatedAt,
      id: followupId,
    });
  });

  it("paginates histories, resumes securely, accepts bounded telemetry, and creates V3 follow-ups", async () => {
    const allowlistedWorkspaceId = randomUUID();
    const repository = new MemoryRepository({ initialWorkspaceId: allowlistedWorkspaceId });
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        FEATURE_RECOVERY_REHEARSAL: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: allowlistedWorkspaceId,
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const auxiliaryEvents: Array<{
      sessionId: string;
      type: string;
      credentialId?: string;
    }> = [];
    built.sessions.subscribeAuxiliary(async (event) => {
      auxiliaryEvents.push({
        sessionId: event.sessionId,
        type: event.type,
        ...(typeof event.payload.credentialId === "string"
          ? { credentialId: event.payload.credentialId }
          : {}),
      });
    });
    const signedIn = await signIn(app, "beta-history@example.com");
    const { cookie } = signedIn;
    const workspaceId = signedIn.creator.creator.workspaceId;

    const starter = await app.inject({
      method: "POST",
      url: "/v1/starters/misconception-check/use",
      headers: { cookie },
    });
    const quiz = starter.json<{
      quiz: { id: string; title: string; draft: { questions: Array<{ id: string }> } };
    }>().quiz;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/quizzes/${quiz.id}/publish`,
          headers: { cookie },
          payload: { expectedDraftRevision: 0 },
        })
      ).statusCode,
    ).toBe(200);

    const createSession = () =>
      app!.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { cookie },
        payload: {
          quizId: quiz.id,
          settings: {
            audienceLimit: 20,
            scoringMode: "accuracy",
            resultVisibility: "private",
            allowLateJoin: true,
            nicknamePolicy: "friendly_only",
          },
        },
      });
    const firstSessionResponse = await createSession();
    const secondSessionResponse = await createSession();
    expect(firstSessionResponse.json<{ snapshot: { uxBeta?: boolean } }>().snapshot.uxBeta).toBe(
      true,
    );
    const firstSession = firstSessionResponse.json<{ sessionId: string }>();
    const secondSession = secondSessionResponse.json<{ sessionId: string }>();
    const listedRoundsResponse = await app.inject({
      method: "GET",
      url: "/v1/quizzes",
      headers: { cookie },
    });
    expect(listedRoundsResponse.statusCode).toBe(200);
    const listedRound = listedRoundsResponse
      .json<{
        quizzes: Array<{
          id: string;
          lastHostedAt: string | null;
          sessionId?: string;
          sessionIds?: string[];
          roomCode?: string;
        }>;
      }>()
      .quizzes.find((item) => item.id === quiz.id);
    const expectedLastHostedAt = [firstSession.sessionId, secondSession.sessionId]
      .map((sessionId) => repository.sessions.get(sessionId)!.createdAt)
      .sort((left, right) => right.getTime() - left.getTime())[0]!;
    expect(listedRound).toMatchObject({
      id: quiz.id,
      lastHostedAt: expectedLastHostedAt.toISOString(),
    });
    expect(listedRound).not.toHaveProperty("sessionId");
    expect(listedRound).not.toHaveProperty("sessionIds");
    expect(listedRound).not.toHaveProperty("roomCode");
    const durableAnswerId = randomUUID();
    const durableChoiceId = randomUUID();
    await repository.persistAnswer(workspaceId, firstSession.sessionId, {
      answerId: durableAnswerId,
      participantId: randomUUID(),
      roundId: randomUUID(),
      response: { kind: "choice", choiceIds: [durableChoiceId] },
      confidence: null,
      choiceId: durableChoiceId,
      acceptedAtMs: Date.now(),
      responseMs: 1_000,
      score: 0,
      correct: false,
      idempotencyKey: randomUUID(),
    });

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/sessions?limit=1",
      headers: { cookie },
    });
    const firstPageBody = firstPage.json<{
      items: Array<{ id: string; title: string; status: string; questionPosition: number | null }>;
      nextCursor: string | null;
    }>();
    expect(firstPageBody.items).toHaveLength(1);
    expect(firstPageBody.items[0]).toMatchObject({ title: quiz.title, status: "active" });
    expect(firstPageBody.nextCursor).toEqual(expect.any(String));
    const secondPage = await app.inject({
      method: "GET",
      url: `/v1/sessions?limit=1&cursor=${encodeURIComponent(firstPageBody.nextCursor!)}`,
      headers: { cookie },
    });
    expect(secondPage.json<{ items: Array<{ id: string }> }>().items[0]!.id).not.toBe(
      firstPageBody.items[0]!.id,
    );
    const completeHistory = await app.inject({
      method: "GET",
      url: "/v1/sessions?limit=50",
      headers: { cookie },
    });
    expect(
      completeHistory
        .json<{ items: Array<{ id: string; answerCount: number }> }>()
        .items.find((item) => item.id === firstSession.sessionId),
    ).toMatchObject({ answerCount: 1 });
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/sessions?cursor=not-a-cursor",
      headers: { cookie },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const cohostDenied = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/staff`,
      headers: { cookie },
      payload: { role: "cohost", label: "Shared host", expiresInMinutes: 60 },
    });
    expect(cohostDenied.statusCode).toBe(402);
    const presenterAllowed = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/staff`,
      headers: { cookie },
      payload: { role: "presenter", label: "Display", expiresInMinutes: 60 },
    });
    expect(presenterAllowed.statusCode).toBe(201);
    expect(presenterAllowed.json()).toMatchObject({
      credential: { purpose: "collaboration", role: "presenter" },
    });
    const presenterCredential = presenterAllowed.json<{
      credential: { id: string };
    }>().credential;
    const revocationAuditsBefore = repository.audits.filter(
      (event) => event.action === "session.staff.revoke",
    ).length;
    const wrongSessionRevoke = await app.inject({
      method: "DELETE",
      url: `/v1/sessions/${secondSession.sessionId}/staff/${presenterCredential.id}`,
      headers: { cookie },
    });
    expect(wrongSessionRevoke.statusCode).toBe(404);
    expect(
      (await repository.listSessionStaff(workspaceId, firstSession.sessionId)).find(
        (credential) => credential.id === presenterCredential.id,
      ),
    ).toMatchObject({ revokedAt: null });
    expect(
      repository.audits.filter((event) => event.action === "session.staff.revoke"),
    ).toHaveLength(revocationAuditsBefore);
    expect(auxiliaryEvents).toEqual([]);

    const correctSessionRevoke = await app.inject({
      method: "DELETE",
      url: `/v1/sessions/${firstSession.sessionId}/staff/${presenterCredential.id}`,
      headers: { cookie },
    });
    expect(correctSessionRevoke.statusCode).toBe(204);
    expect(auxiliaryEvents).toEqual([
      {
        sessionId: firstSession.sessionId,
        type: "session.staff.revoked",
        credentialId: presenterCredential.id,
      },
    ]);

    const firstPass = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/control-pass`,
      headers: { cookie },
    });
    const secondPass = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/control-pass`,
      headers: { cookie },
    });
    expect(firstPass.statusCode).toBe(201);
    expect(secondPass.statusCode).toBe(201);
    expect(secondPass.json()).toMatchObject({
      credential: { role: "cohost", purpose: "creator_resume", label: "Creator resume" },
    });
    const passTimes = secondPass.json<{
      credential: { createdAt: string; expiresAt: string };
    }>().credential;
    expect(
      new Date(passTimes.expiresAt).getTime() - new Date(passTimes.createdAt).getTime(),
    ).toBeLessThanOrEqual(4 * 60 * 60_000);
    expect(secondPass.body).not.toContain(firstPass.json<{ token: string }>().token);
    expect(auxiliaryEvents.at(-1)).toEqual({
      sessionId: firstSession.sessionId,
      type: "session.staff.revoked",
      credentialId: firstPass.json<{ credential: { id: string } }>().credential.id,
    });
    const staff = await repository.listSessionStaff(workspaceId, firstSession.sessionId);
    const resumePasses = staff.filter((credential) => credential.purpose === "creator_resume");
    expect(resumePasses).toHaveLength(2);
    expect(resumePasses.filter((credential) => !credential.revokedAt)).toHaveLength(1);

    const replaceCreatorResumeCredential =
      repository.replaceCreatorResumeCredential.bind(repository);
    const concurrentlyCreatedCredentialId = randomUUID();
    repository.replaceCreatorResumeCredential = async (input) => {
      await repository.createSessionStaffCredential({
        ...input,
        id: concurrentlyCreatedCredentialId,
        tokenHash: `concurrent-${randomUUID()}`,
        createdAt: new Date(input.createdAt.getTime() - 1),
      });
      return replaceCreatorResumeCredential(input);
    };
    const concurrentReplacementEventStart = auxiliaryEvents.length;
    const concurrentPass = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/control-pass`,
      headers: { cookie },
    });
    expect(concurrentPass.statusCode).toBe(201);
    expect(
      auxiliaryEvents.slice(concurrentReplacementEventStart).map((event) => event.credentialId),
    ).toEqual(
      expect.arrayContaining([
        secondPass.json<{ credential: { id: string } }>().credential.id,
        concurrentlyCreatedCredentialId,
      ]),
    );
    repository.replaceCreatorResumeCredential = replaceCreatorResumeCredential;

    const activeSession = repository.sessions.get(firstSession.sessionId)!;
    const activeExpiry = activeSession.expiresAt;
    repository.replaceCreatorResumeCredential = async (input) => {
      activeSession.expiresAt = new Date(input.createdAt);
      return replaceCreatorResumeCredential(input);
    };
    const racedExpiryPass = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/control-pass`,
      headers: { cookie },
    });
    expect(racedExpiryPass.statusCode).toBe(409);
    expect(racedExpiryPass.json()).toMatchObject({ error: { code: "CONFLICT" } });
    repository.replaceCreatorResumeCredential = replaceCreatorResumeCredential;
    activeSession.expiresAt = activeExpiry;

    const telemetry = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: { cookie },
      payload: {
        events: [
          {
            name: "creation_started",
            occurredAt: new Date().toISOString(),
            dimensions: { creationPath: "starter", artifactType: "round" },
          },
          {
            name: "draft_conflict",
            occurredAt: new Date().toISOString(),
            dimensions: { artifactType: "presentation" },
          },
        ],
      },
    });
    expect(telemetry.statusCode).toBe(202);
    expect(telemetry.json()).toEqual({ accepted: 2 });
    await built.productEvents.drain();
    const creationStartedEvent = repository.productEvents.find(
      (event) => event.name === "creation_started",
    );
    expect(creationStartedEvent).toMatchObject({
      workspaceId,
      name: "creation_started",
      dimensions: {
        creationPath: "starter",
        artifactType: "round",
        segment: "workplace",
        betaVersion: "p0-2026",
      },
    });
    expect(JSON.stringify(creationStartedEvent)).not.toContain(signedIn.creator.creator.userId);
    expect(repository.productEvents).toContainEqual(
      expect.objectContaining({
        name: "draft_conflict",
        dimensions: expect.objectContaining({
          artifactType: "presentation",
          segment: "workplace",
          betaVersion: "p0-2026",
        }),
      }),
    );
    const rejectedTelemetry = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: { cookie },
      payload: {
        events: [
          {
            name: "creation_started",
            occurredAt: new Date().toISOString(),
            dimensions: { objectId: quiz.id },
          },
        ],
      },
    });
    expect(rejectedTelemetry.statusCode).toBe(400);
    const meaninglessRehearsalCompletion = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: { cookie },
      payload: {
        events: [
          {
            name: "rehearsal_completed",
            occurredAt: new Date().toISOString(),
            dimensions: {},
          },
        ],
      },
    });
    expect(meaninglessRehearsalCompletion.statusCode).toBe(400);

    const session = await repository.getSessionById(firstSession.sessionId);
    expect(session).not.toBeNull();
    const reportId = randomUUID();
    const report = ReportV3Schema.parse({
      id: reportId,
      sessionId: firstSession.sessionId,
      schemaVersion: 3,
      status: "ready",
      generatedAt: new Date().toISOString(),
      expiresAt: session!.retentionExpiresAt.toISOString(),
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
      evidenceNote: "Synthetic API fixture",
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
    await repository.saveReport(workspaceId, report);

    const reports = await app.inject({ method: "GET", url: "/v1/reports", headers: { cookie } });
    expect(reports.statusCode).toBe(200);
    expect(reports.json()).toMatchObject({
      items: [
        {
          id: reportId,
          quizId: quiz.id,
          title: quiz.title,
          unresolvedConceptCount: 1,
          followupId: null,
          followupStatus: null,
        },
      ],
      nextCursor: null,
    });
    const reportDetail = await app.inject({
      method: "GET",
      url: `/v1/reports/${reportId}`,
      headers: { cookie },
    });
    expect(reportDetail.json()).toMatchObject({
      context: { quizId: quiz.id, quizTitle: quiz.title },
    });

    await repository.setPlan(workspaceId, "pro");
    const followup = await app.inject({
      method: "POST",
      url: `/v1/reports/${reportId}/followups`,
      headers: { cookie },
      payload: {
        conceptKeys: ["topic.core-model"],
        closesAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      },
    });
    expect(followup.statusCode).toBe(201);
    const followupId = followup.json<{ followup: { id: string } }>().followup.id;
    const reportsWithFollowup = await app.inject({
      method: "GET",
      url: "/v1/reports",
      headers: { cookie },
    });
    expect(reportsWithFollowup.json()).toMatchObject({
      items: [{ id: reportId, followupId, followupStatus: "open" }],
    });
    const followups = await app.inject({
      method: "GET",
      url: "/v1/followups",
      headers: { cookie },
    });
    expect(followups.json()).toMatchObject({
      items: [
        {
          id: followupId,
          sourceReportId: reportId,
          quizId: quiz.id,
          status: "open",
          attemptCount: 0,
          completedAttemptCount: 0,
        },
      ],
      nextCursor: null,
    });
    const followupCreatedAt = followups.json<{ items: Array<{ createdAt: string }> }>().items[0]!
      .createdAt;
    const filteredFollowups = await app.inject({
      method: "GET",
      url: `/v1/followups?${new URLSearchParams({
        status: "open",
        quizId: quiz.id,
        from: new Date(new Date(followupCreatedAt).getTime() - 1).toISOString(),
        to: new Date(new Date(followupCreatedAt).getTime() + 1).toISOString(),
      })}`,
      headers: { cookie },
    });
    expect(filteredFollowups.json()).toMatchObject({
      items: [{ id: followupId, quizId: quiz.id, status: "open" }],
    });
    const otherRoundFollowups = await app.inject({
      method: "GET",
      url: `/v1/followups?quizId=${randomUUID()}`,
      headers: { cookie },
    });
    expect(otherRoundFollowups.json()).toMatchObject({ items: [], nextCursor: null });

    const outsider = await signIn(app, "outside-history@example.com");
    for (const url of ["/v1/sessions", "/v1/reports", "/v1/followups"]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie: outsider.cookie },
      });
      expect(response.json()).toMatchObject({ items: [], nextCursor: null });
    }

    expect(firstSession.sessionId).not.toBe(secondSession.sessionId);
  });
});
