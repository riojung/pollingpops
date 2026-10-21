import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { HostAction, SessionSnapshot } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { generateReport } from "../src/reporting.js";

let app: FastifyInstance | undefined;

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
    workspaceId: me.json<{ creator: { workspaceId: string } }>().creator.workspaceId,
  };
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("P0 product-event funnel", () => {
  it("records durable allowlisted milestones without content or object identifiers", async () => {
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
        UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const signedIn = await signIn(app, "funnel@example.com");

    const starterResponse = await app.inject({
      method: "POST",
      url: "/v1/starters/misconception-check/use",
      headers: { cookie: signedIn.cookie },
    });
    const quiz = starterResponse.json<{
      quiz: {
        id: string;
        draft: {
          questions: Array<{
            id: string;
            linkedRecheckQuestionId: string | null;
            choices: Array<{ id: string }>;
          }>;
        };
      };
    }>().quiz;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/quizzes/${quiz.id}/publish`,
          headers: { cookie: signedIn.cookie },
          payload: { expectedDraftRevision: 0 },
        })
      ).statusCode,
    ).toBe(200);

    const sessionResponse = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { cookie: signedIn.cookie },
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
    expect(sessionResponse.statusCode).toBe(201);
    const session = sessionResponse.json<{
      sessionId: string;
      code: string;
      hostToken: string;
      snapshot: SessionSnapshot;
    }>();
    const joinResponse = await app.inject({
      method: "POST",
      url: "/v1/sessions/join",
      payload: { code: session.code },
    });
    expect(joinResponse.statusCode).toBe(201);
    const joined = joinResponse.json<{
      participantId: string;
      participantToken: string;
      snapshot: SessionSnapshot;
    }>();

    const command = async (
      snapshot: SessionSnapshot,
      action: HostAction,
      extras: Record<string, unknown> = {},
    ) => {
      const response = await app!.inject({
        method: "POST",
        url: `/v1/sessions/${session.sessionId}/commands`,
        headers: { authorization: `Bearer ${session.hostToken}` },
        payload: {
          commandId: randomUUID(),
          expectedVersion: snapshot.version,
          action,
          ...extras,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json<{ snapshot: SessionSnapshot }>().snapshot;
    };

    let snapshot = await command(joined.snapshot, "start");
    const choiceId = quiz.draft.questions[0]!.choices[0]!.id;
    const idempotencyKey = randomUUID();
    const submit = () =>
      app!.inject({
        method: "POST",
        url: `/v1/sessions/${session.sessionId}/answers`,
        headers: { authorization: `Bearer ${joined.participantToken}` },
        payload: {
          roundId: snapshot.roundId,
          response: { kind: "choice", choiceIds: [choiceId] },
          confidence: 3,
          idempotencyKey,
        },
      });
    expect((await submit()).json()).toMatchObject({ accepted: true, duplicate: false });
    expect((await submit()).json()).toMatchObject({ accepted: true, duplicate: true });
    expect(
      await repository.findParticipantIdsWithAnswers(workspaceId, session.sessionId, [
        joined.participantId,
        randomUUID(),
      ]),
    ).toEqual([joined.participantId]);
    const synced = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/snapshot?role=host`,
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    snapshot = synced.json<{ snapshot: SessionSnapshot }>().snapshot;

    snapshot = await command(snapshot, "lock");
    snapshot = await command(snapshot, "reveal");
    snapshot = await command(snapshot, "intervention.start", { interventionType: "explain" });
    snapshot = await command(snapshot, "intervention.finish");
    snapshot = await command(snapshot, "recheck.open", {
      recheckMode: "linked",
      recheckQuestionId: quiz.draft.questions[0]!.linkedRecheckQuestionId,
    });
    const recheckResponse = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/answers`,
      headers: { authorization: `Bearer ${joined.participantToken}` },
      payload: {
        roundId: snapshot.roundId,
        response: { kind: "choice", choiceIds: [quiz.draft.questions[1]!.choices[0]!.id] },
        confidence: 3,
        idempotencyKey: randomUUID(),
      },
    });
    expect(recheckResponse.json()).toMatchObject({ accepted: true, duplicate: false });
    const postRecheckSync = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/snapshot?role=host`,
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    snapshot = postRecheckSync.json<{ snapshot: SessionSnapshot }>().snapshot;
    snapshot = await command(snapshot, "end");

    const stored = await repository.getSessionById(session.sessionId);
    const pendingReport = await repository.getReportBySession(workspaceId, session.sessionId);
    expect(stored).not.toBeNull();
    expect(pendingReport).toMatchObject({ status: "pending" });
    const readyReport = generateReport(stored!.state, stored!.retentionExpiresAt, {
      id: pendingReport!.id,
      evidence: await repository.getSessionEvidence(workspaceId, session.sessionId),
    });
    await repository.saveReport(workspaceId, readyReport);
    const reportView = await app.inject({
      method: "GET",
      url: `/v1/reports/${readyReport.id}`,
      headers: { cookie: signedIn.cookie },
    });
    expect(reportView.statusCode).toBe(200);
    await built.productEvents.drain();

    const names = repository.productEvents.map((event) => event.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "round_published",
        "host_setup_completed",
        "participant_joined",
        "first_answer_submitted",
        "response_saved_acknowledged",
        "question_locked",
        "insight_shown",
        "intervention_started",
        "recheck_opened",
        "report_viewed",
      ]),
    );
    expect(names.filter((name) => name === "first_answer_submitted")).toHaveLength(1);
    expect(names.filter((name) => name === "response_saved_acknowledged")).toHaveLength(2);
    expect(names.filter((name) => name === "question_locked")).toHaveLength(1);
    expect(names.filter((name) => name === "intervention_started")).toHaveLength(1);
    expect(names.filter((name) => name === "recheck_opened")).toHaveLength(1);
    for (const event of repository.productEvents) {
      expect(event.workspaceId).toBe(workspaceId);
      expect(event.dimensions.betaVersion).toBe("p0-2026");
      expect(Object.keys(event.dimensions)).toEqual(expect.arrayContaining(["betaVersion"]));
      for (const forbiddenKey of ["actorId", "objectId", "sessionId", "quizId"])
        expect(Object.keys(event.dimensions)).not.toContain(forbiddenKey);
    }
  });

  it("accepts no client telemetry when the workspace is outside the beta allowlist", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const signedIn = await signIn(app, "excluded-funnel@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: { cookie: signedIn.cookie },
      payload: {
        events: [
          {
            name: "followup_shared",
            occurredAt: new Date().toISOString(),
            dimensions: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 0 });
    expect(repository.productEvents).toEqual([]);
  });
});
