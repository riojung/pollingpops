import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

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
  return { app: built.app, repository };
}

async function signIn(target: FastifyInstance) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "join-preflight@example.com",
      segment: "education",
      acceptPolicies: true,
    },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await target.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

async function publishedStarter(target: FastifyInstance, cookie: string) {
  const starter = await target.inject({
    method: "POST",
    url: "/v1/starters/icebreaker-poll/use",
    headers: { cookie },
  });
  const quizId = starter.json<{ quiz: { id: string } }>().quiz.id;
  const published = await target.inject({
    method: "POST",
    url: `/v1/quizzes/${quizId}/publish`,
    headers: { cookie },
    payload: { expectedDraftRevision: 0 },
  });
  expect(published.statusCode).toBe(200);
  return quizId;
}

async function createSession(
  target: FastifyInstance,
  cookie: string,
  quizId: string,
  nicknamePolicy: "custom" | "friendly_only",
) {
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
        nicknamePolicy,
      },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{
    sessionId: string;
    code: string;
    hostToken: string;
    snapshot: SessionSnapshot;
  }>();
}

function preflight(target: FastifyInstance, code: string) {
  return target.inject({
    method: "GET",
    url: `/v1/sessions/join/preflight?${new URLSearchParams({ code })}`,
  });
}

function unavailable(response: Awaited<ReturnType<typeof preflight>>) {
  expect(response.statusCode).toBe(404);
  expect(response.json()).toMatchObject({
    error: {
      code: "INVALID_CODE",
      message: "This round is not accepting joins. Check the code or ask the facilitator",
    },
  });
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("guest join preflight", () => {
  it("returns only safe admission metadata and does not mutate valid or unavailable rooms", async () => {
    const { app: target, repository } = await build();
    const cookie = await signIn(target);
    const quizId = await publishedStarter(target, cookie);
    const friendly = await createSession(target, cookie, quizId, "friendly_only");
    const custom = await createSession(target, cookie, quizId, "custom");
    const expired = await createSession(target, cookie, quizId, "friendly_only");

    const friendlyBefore = repository.sessions.get(friendly.sessionId)!;
    const friendlyVersion = friendlyBefore.state.version;
    const friendlyUpdatedAt = friendlyBefore.updatedAt.toISOString();
    const participantRecords = repository.participants.size;
    const available = await preflight(target, friendly.code);
    expect(available.statusCode).toBe(200);
    expect(available.headers["cache-control"]).toContain("no-store");
    expect(available.json()).toEqual({
      artifactType: "round",
      destination: "/join",
      nicknamePolicy: "friendly_only",
      passwordRequired: false,
    });
    expect(repository.sessions.get(friendly.sessionId)!.state.version).toBe(friendlyVersion);
    expect(repository.sessions.get(friendly.sessionId)!.updatedAt.toISOString()).toBe(
      friendlyUpdatedAt,
    );
    expect(repository.participants.size).toBe(participantRecords);

    const customPolicy = await preflight(target, custom.code);
    expect(customPolicy.statusCode).toBe(200);
    expect(customPolicy.json()).toEqual({
      artifactType: "round",
      destination: "/join",
      nicknamePolicy: "custom",
      passwordRequired: false,
    });

    const locked = await target.inject({
      method: "POST",
      url: `/v1/sessions/${friendly.sessionId}/commands`,
      headers: { authorization: `Bearer ${friendly.hostToken}` },
      payload: {
        commandId: randomUUID(),
        expectedVersion: friendly.snapshot.version,
        action: "lock_lobby",
      },
    });
    expect(locked.statusCode).toBe(200);
    const lockedVersion = repository.sessions.get(friendly.sessionId)!.state.version;
    unavailable(await preflight(target, friendly.code));
    expect(repository.sessions.get(friendly.sessionId)!.state.version).toBe(lockedVersion);

    repository.sessions.get(expired.sessionId)!.expiresAt = new Date(0);
    unavailable(await preflight(target, expired.code));

    const usedCodes = new Set([friendly.code, custom.code, expired.code]);
    const invalidCode = ["0000000", "9999999", "1234567"].find((code) => !usedCodes.has(code))!;
    unavailable(await preflight(target, invalidCode));

    expect(repository.participants.size).toBe(participantRecords);
  });

  it("rate limits code probing independently of join mutation", async () => {
    const { app: target, repository } = await build();
    let response = await preflight(target, "0000000");
    for (let attempt = 1; attempt < 21; attempt += 1) {
      response = await preflight(target, "0000000");
    }

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(repository.sessions.size).toBe(0);
    expect(repository.participants.size).toBe(0);
  });
});
