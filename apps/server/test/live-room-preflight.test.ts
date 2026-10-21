import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository, type PresentationSessionRecord } from "@openround/db";
import type { SessionSnapshot } from "@openround/contracts";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000021";
let app: FastifyInstance | undefined;

class RecordingAdmissionCache extends MemorySessionCache {
  readonly calls: Array<{ key: string; maximum: number; windowMs: number }> = [];
  deny = false;

  override async consumeRateLimit(key: string, maximum: number, windowMs: number) {
    this.calls.push({ key, maximum, windowMs });
    return this.deny ? false : super.consumeRateLimit(key, maximum, windowMs);
  }
}

async function setup(cache: MemorySessionCache = new MemorySessionCache()) {
  const repository = new MemoryRepository({
    initialWorkspaceId: WORKSPACE_ID,
    initialPlan: "free",
  });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      MAX_SESSION_PARTICIPANTS: 100,
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: WORKSPACE_ID,
      FEATURE_PRESENTATIONS: "true",
      LOG_LEVEL: "silent",
    }),
    { repository, cache },
  );
  app = built.app;

  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "unified-join@example.com",
      segment: "education",
      acceptPolicies: true,
    },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    "unified-join@example.com",
  );
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  const creator = me.json<{ creator: { userId: string } }>().creator;

  return { ...built, cookie, creator };
}

async function createRound(target: FastifyInstance, cookie: string) {
  const starter = await target.inject({
    method: "POST",
    url: "/v1/starters/icebreaker-poll/use",
    headers: { cookie },
  });
  const quizId = starter.json<{ quiz: { id: string } }>().quiz.id;
  await target.inject({
    method: "POST",
    url: `/v1/quizzes/${quizId}/publish`,
    headers: { cookie },
    payload: { expectedDraftRevision: 0 },
  });
  const hosted = await target.inject({
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
  expect(hosted.statusCode).toBe(201);
  return hosted.json<{ code: string; snapshot: SessionSnapshot }>();
}

async function createPresentation(
  sessions: Awaited<ReturnType<typeof setup>>["presentationSessions"],
  createdBy: string,
  input: { code: string; workspaceId?: string; status?: "active" | "finished"; expired?: boolean },
) {
  const now = new Date();
  const content: PresentationSessionRecord["content"] = {
    title: "Unified join test",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    blocks: [
      {
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        textElements: [
          { id: "welcome:title", role: "title", text: "Welcome", region: "top_center", order: 0 },
          {
            id: "welcome:body",
            role: "body",
            text: "Test room",
            region: "middle_center",
            order: 0,
          },
        ],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "",
      },
    ],
  };
  return sessions.createSession({
    id: randomUUID(),
    workspaceId: input.workspaceId ?? WORKSPACE_ID,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: content.title,
    content,
    code: input.code,
    status: input.status ?? "active",
    phase: input.status === "finished" ? "finished" : "lobby",
    currentBlockIndex: -1,
    revision: 0,
    createdBy,
    createdAt: now,
    updatedAt: now,
    finishedAt: input.status === "finished" ? now : null,
    liveExpiresAt: new Date(now.getTime() + (input.expired ? -1 : 60_000)),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  });
}

function preflight(target: FastifyInstance, code: string) {
  return target.inject({
    method: "GET",
    url: `/v1/live-rooms/join/preflight?${new URLSearchParams({ code })}`,
  });
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("unified live-room join preflight", () => {
  it("keeps a shared per-code admission budget alongside the global IP limiter", async () => {
    const cache = new RecordingAdmissionCache();
    const built = await setup(cache);

    await preflight(built.app, "1234567");
    expect(cache.calls.at(-1)).toEqual({
      key: "live-room-preflight:1234567",
      maximum: 600,
      windowMs: 60_000,
    });

    cache.deny = true;
    const limited = await preflight(built.app, "7654321");
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("routes the authoritative Round or Presentation registry claim", async () => {
    const built = await setup();
    const round = await createRound(built.app, built.cookie);
    const presentation = await createPresentation(
      built.presentationSessions,
      built.creator.userId,
      { code: "7654321" },
    );

    const roundResult = await preflight(built.app, round.code);
    expect(roundResult.statusCode).toBe(200);
    expect(roundResult.headers["cache-control"]).toContain("no-store");
    expect(roundResult.json()).toEqual({
      nicknamePolicy: "friendly_only",
      artifactType: "round",
      destination: "/join",
      passwordRequired: false,
    });

    const presentationResult = await preflight(built.app, presentation.code);
    expect(presentationResult.statusCode).toBe(200);
    expect(presentationResult.json()).toEqual({
      nicknamePolicy: "custom",
      artifactType: "presentation",
      destination: "/join",
      passwordRequired: false,
    });
  });

  it("does not probe a different engine when an authoritative claim has no joinable source", async () => {
    const built = await setup();
    const round = await createRound(built.app, built.cookie);
    await built.repository.releaseLiveRoomCode("round", round.snapshot.sessionId);
    await built.repository.claimLiveRoomCode({
      code: round.code,
      workspaceId: WORKSPACE_ID,
      artifactType: "presentation",
      artifactId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });

    const response = await preflight(built.app, round.code);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_CODE" } });
  });

  it("hides unavailable, expired, finished, full, and institution-only rooms", async () => {
    const built = await setup();
    const expired = await createPresentation(built.presentationSessions, built.creator.userId, {
      code: "1000001",
      expired: true,
    });
    const finished = await createPresentation(built.presentationSessions, built.creator.userId, {
      code: "1000002",
      status: "finished",
    });
    const notAllowlisted = await createPresentation(
      built.presentationSessions,
      built.creator.userId,
      { code: "1000003", workspaceId: randomUUID() },
    );
    const full = await createPresentation(built.presentationSessions, built.creator.userId, {
      code: "1000004",
    });
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        built.presentationSessions.addParticipant({
          id: randomUUID(),
          workspaceId: WORKSPACE_ID,
          sessionId: full.id,
          nickname: `Participant ${index + 1}`,
          tokenHash: `hash-${index}`,
          joinedAt: new Date(),
          lastSeenAt: new Date(),
        }),
      ),
    );

    for (const code of ["9999999", expired.code, finished.code, full.code]) {
      const response = await preflight(built.app, code);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_CODE" } });
    }

    const existingDuringRollback = await preflight(built.app, notAllowlisted.code);
    expect(existingDuringRollback.statusCode).toBe(200);
    expect(existingDuringRollback.json()).toMatchObject({ artifactType: "presentation" });

    const institutionOnly = await createPresentation(
      built.presentationSessions,
      built.creator.userId,
      { code: "1000005" },
    );
    const currentPolicy = await built.repository.getInstitutionPolicy(WORKSPACE_ID);
    await built.repository.updateInstitutionPolicy(
      { ...currentPolicy, identityRequirement: "institution", updatedAt: new Date() },
      randomUUID(),
    );
    const institutionResult = await preflight(built.app, institutionOnly.code);
    expect(institutionResult.statusCode).toBe(404);
    expect(institutionResult.json()).toMatchObject({ error: { code: "INVALID_CODE" } });
  });
});
