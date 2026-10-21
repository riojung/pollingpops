import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { SessionCountsResponseSchema, type QuizDraft } from "@openround/contracts";
import { SurveyDraftSchema } from "@openround/contracts/surveys";
import { MemoryRepository, createSurveyRepository, type CreatorContext } from "@openround/db";
import { createGameState } from "@openround/game-engine";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

async function fixture(presentationsEnabled = true) {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId, initialPlan: "team" });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      FEATURE_PRESENTATIONS: String(presentationsEnabled),
      FEATURE_PRESENTATION_REALTIME: "false",
      FEATURE_SURVEYS: "false",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  async function signIn() {
    const verifiedEmail = `${randomUUID()}@example.com`;
    const magic = await built.app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: {
        email: verifiedEmail,
        segment: "workplace",
        acceptPolicies: true,
      },
    });
    const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token");
    const verified = await verifyEmailAndSignIn(
      built.app,
      `/v1/auth/verify?token=${token}`,
      verifiedEmail,
    );
    const cookies = verified.headers["set-cookie"]!;
    const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
    const me = await built.app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    return { headers: { cookie }, creator: me.json<{ creator: CreatorContext }>().creator };
  }
  const owner = await signIn();
  const outsider = await signIn();
  const now = new Date();
  let nextCode = 2_000_000;
  const content: QuizDraft = {
    title: "Library source",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "numeric",
        prompt: "How many?",
        correctValue: "2",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "Two",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };

  async function seedRounds(actor: CreatorContext, count: number) {
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      title: content.title,
      description: "",
      draft: content,
      status: "draft",
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    const rounds = [];
    for (let index = 0; index < count; index += 1) {
      const id = randomUUID();
      const createdAt = new Date(now.getTime() - (count - index) * 1_000);
      const state = createGameState({
        sessionId: id,
        code: String(nextCode++),
        quiz: {
          ...content,
          title: index < 2 ? `Frozen needle ${index === 0 ? "50%_" : "second"}` : "Recent room",
        },
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "friendly_only",
        },
      });
      await repository.createSession({
        id,
        workspaceId: actor.workspaceId,
        quizVersionId: version.id,
        hostId: actor.userId,
        hostTokenHash: randomUUID(),
        state,
        expiresAt: new Date(now.getTime() - 1),
        retentionExpiresAt: new Date(now.getTime() + 86_400_000),
        createdAt,
        updatedAt: createdAt,
      });
      rounds.push({ id, code: state.code });
    }
    return { quizId: quiz.id, rounds };
  }
  async function seedOtherKinds(actor: CreatorContext) {
    const presentation = await built.presentationSessions.createSession({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: "Retained presentation",
      content: {
        schemaVersion: 2,
        title: "Retained presentation",
        description: "",
        experiencePreset: { id: "focus", version: 1 },
        blocks: [{ id: randomUUID(), kind: "question", question: content.questions[0]! }],
      },
      code: String(nextCode++),
      status: "finished",
      phase: "finished",
      currentBlockIndex: 0,
      revision: 0,
      eventSeq: 0,
      settings: { timeMode: "flex" },
      trustMode: "learning",
      questionOpenedAt: null,
      questionClosesAt: null,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: now,
      liveExpiresAt: new Date(now.getTime() - 1),
      retentionExpiresAt: new Date(now.getTime() + 86_400_000),
    });
    const surveys = createSurveyRepository(repository);
    const survey = await surveys.create(
      actor.workspaceId,
      randomUUID(),
      SurveyDraftSchema.parse({
        schemaVersion: 2,
        title: "Retained survey",
        items: [
          {
            required: false,
            question: {
              id: randomUUID(),
              type: "rating",
              prompt: "How useful?",
              purpose: "opinion",
              confidence: "off",
              delivery: "main",
              min: 1,
              max: 5,
              minLabel: "Less",
              maxLabel: "More",
              timeLimitSeconds: 30,
              basePoints: 0,
              explanation: "",
              mediaId: null,
              mediaAlt: null,
            },
          },
        ],
      }),
      randomUUID(),
    );
    await surveys.publish(actor.workspaceId, survey.id, 0, randomUUID(), null);
    const surveyRoom = await surveys.createRoom(actor.workspaceId, survey.id, 0, randomUUID(), {
      code: String(nextCode++),
      closesAt: new Date(now.getTime() + 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      participantLimit: 20,
      windowDays: 1,
    });
    await surveys.close(actor.workspaceId, surveyRoom.id);
    return { presentation, surveyRoom, surveys };
  }
  return { ...built, repository, owner, outsider, seedRounds, seedOtherKinds };
}

describe("Sessions Library history APIs", () => {
  it.each([true, false])(
    "returns exact private tenant counts with Presentations enabled=%s and Survey creation disabled",
    async (enabled) => {
      const f = await fixture(enabled);
      const rounds = await f.seedRounds(f.owner.creator, 28);
      const other = await f.seedOtherKinds(f.owner.creator);
      await f.seedRounds(f.outsider.creator, 1);
      await f.seedOtherKinds(f.outsider.creator);
      const history = vi.spyOn(f.repository, "listSessionHistory");
      const presentationList = vi.spyOn(f.presentationSessions, "listSessions");
      const surveyList = vi.spyOn(other.surveys, "listRooms");
      expect((await f.app.inject({ method: "GET", url: "/v1/sessions/counts" })).statusCode).toBe(
        401,
      );
      const counts = await f.app.inject({
        method: "GET",
        url: "/v1/sessions/counts?search=absent&status=active",
        headers: f.owner.headers,
      });
      expect(counts.statusCode).toBe(200);
      expect(counts.headers["cache-control"]).toBe("private, no-store");
      expect(SessionCountsResponseSchema.parse(counts.json())).toEqual({
        counts: { rounds: 28, presentations: enabled ? 1 : 0, surveys: 1 },
      });
      expect(history).not.toHaveBeenCalled();
      expect(presentationList).not.toHaveBeenCalled();
      expect(surveyList).not.toHaveBeenCalled();
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: "/v1/sessions/counts",
            headers: f.outsider.headers,
          })
        ).json(),
      ).toEqual({ counts: { rounds: 1, presentations: 0, surveys: 1 } });

      const deletedRound = await f.app.inject({
        method: "DELETE",
        url: `/v1/sessions/${rounds.rounds[0]!.id}`,
        headers: f.owner.headers,
      });
      expect(deletedRound.statusCode).toBe(204);
      await f.presentationSessions.deleteSession(
        f.owner.creator.workspaceId,
        other.presentation.id,
      );
      await other.surveys.deleteRoom(f.owner.creator.workspaceId, other.surveyRoom.id);
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: "/v1/sessions/counts",
            headers: f.owner.headers,
          })
        ).json(),
      ).toEqual({ counts: { rounds: 27, presentations: 0, surveys: 0 } });
    },
  );

  it("searches frozen titles and codes before pagination, with bounded literal matching and existing filters", async () => {
    const f = await fixture();
    const owned = await f.seedRounds(f.owner.creator, 28);
    const foreign = await f.seedRounds(f.outsider.creator, 1);
    const get = (query = "") =>
      f.app.inject({ method: "GET", url: `/v1/sessions${query}`, headers: f.owner.headers });
    const recent = await get();
    expect(recent.json().items).toHaveLength(25);
    expect(
      recent.json().items.every((item: { title: string }) => item.title === "Recent room"),
    ).toBe(true);
    const first = await get("?search=%20NeEdLe%20&limit=1");
    expect(first.json().items.map((item: { id: string }) => item.id)).toEqual([
      owned.rounds[1]!.id,
    ]);
    expect(first.json().nextCursor).toEqual(expect.any(String));
    const second = await get(`?search=needle&limit=1&cursor=${first.json().nextCursor}`);
    expect(second.json().items.map((item: { id: string }) => item.id)).toEqual([
      owned.rounds[0]!.id,
    ]);
    expect(second.json().nextCursor).toBeNull();
    expect(first.json().items[0]).not.toHaveProperty("state");
    for (const search of ["%_", owned.rounds[0]!.code]) {
      const matching = await get(`?search=${encodeURIComponent(search)}`);
      expect(matching.json().items.map((item: { id: string }) => item.id)).toEqual([
        owned.rounds[0]!.id,
      ]);
    }
    expect((await get(`?search=needle&quizId=${foreign.quizId}`)).json().items).toEqual([]);
    expect((await get("?search=needle&status=active")).json().items).toEqual([]);
    expect((await get("?search=%20%20%20")).json().items).toHaveLength(25);
    expect((await get(`?search=${"x".repeat(161)}`)).statusCode).toBe(400);
  });
});

describe("Results history search APIs", () => {
  it.each([
    { path: "/v1/reports", method: "listReportHistory" as const, status: "pending" },
    { path: "/v1/followups", method: "listFollowupHistory" as const, status: "scheduled" },
  ])(
    "passes bounded literal title search and existing filters to $path within the active workspace",
    async ({ path, method, status }) => {
      const f = await fixture();
      const history = vi
        .spyOn(f.repository, method)
        .mockResolvedValue({ items: [], hasMore: false });
      const query = new URLSearchParams({
        search: "  NeEdLe 50%_  ",
        limit: "1",
        status,
        quizId: randomUUID(),
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-12-31T00:00:00.000Z",
      });
      if (method === "listFollowupHistory") query.set("purpose", "assignment");
      const exactCreatedAt = "2026-09-18T12:00:00.000900Z";
      const anchorId = randomUUID();
      query.set(
        "cursor",
        Buffer.from(JSON.stringify({ createdAt: exactCreatedAt, id: anchorId })).toString(
          "base64url",
        ),
      );
      expect((await f.app.inject({ method: "GET", url: `${path}?${query}` })).statusCode).toBe(401);
      expect(history).not.toHaveBeenCalled();
      const response = await f.app.inject({
        method: "GET",
        url: `${path}?${query}`,
        headers: f.owner.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ items: [], nextCursor: null });
      expect(history).toHaveBeenLastCalledWith(f.owner.creator.workspaceId, {
        search: "NeEdLe 50%_",
        limit: 1,
        status,
        quizId: query.get("quizId"),
        from: new Date(query.get("from")!),
        to: new Date(query.get("to")!),
        cursor: {
          createdAt: new Date(exactCreatedAt),
          cursorCreatedAt: exactCreatedAt,
          id: anchorId,
        },
        now: expect.any(Date),
        ...(method === "listFollowupHistory" ? { purpose: "assignment" } : {}),
      });
      const get = (search: string) =>
        f.app.inject({
          method: "GET",
          url: `${path}?search=${encodeURIComponent(search)}`,
          headers: f.owner.headers,
        });
      expect((await get("x".repeat(160))).statusCode).toBe(200);
      history.mockClear();
      expect((await get("x".repeat(161))).statusCode).toBe(400);
      expect(history).not.toHaveBeenCalled();
      expect((await get("   ")).statusCode).toBe(200);
      expect(history).toHaveBeenLastCalledWith(f.owner.creator.workspaceId, {
        limit: 25,
        now: expect.any(Date),
      });
      await f.app.inject({
        method: "GET",
        url: `${path}?search=needle`,
        headers: f.outsider.headers,
      });
      expect(history).toHaveBeenLastCalledWith(f.outsider.creator.workspaceId, {
        search: "needle",
        limit: 25,
        now: expect.any(Date),
      });
    },
  );
});
