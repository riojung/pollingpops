import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { currentRoundClientCapabilities, ROUND_CLIENT_UPDATE_MESSAGE } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app";
import { MemorySessionCache } from "../src/cache";
import { ConfigSchema } from "../src/config";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

it("validates Round profiles at HTTP boundaries and authenticates before compatibility errors", async () => {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const cache = new MemorySessionCache();
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      LOG_LEVEL: "silent",
      FEATURE_ROUND_CLIENT_PROTOCOL: "true",
      CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
      TEST_INITIAL_WORKSPACE_ID: workspaceId,
    }),
    { repository, cache },
  );
  app = built.app;
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "protocol-http@example.com",
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  const token = new URL(magic.json().debugUrl).searchParams.get("token");
  const verified = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    "protocol-http@example.com",
  );
  const cookies = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
  const created = await app.inject({
    method: "POST",
    url: "/v1/quizzes",
    headers: { cookie },
    payload: { title: "HTTP protocol fixture", description: "" },
  });
  const quizId = created.json().quiz.id;
  const choiceId = randomUUID();
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: `/v1/quizzes/${quizId}`,
        headers: { cookie },
        payload: {
          title: "HTTP protocol fixture",
          description: "",
          questions: [
            {
              id: randomUUID(),
              type: "true_false",
              prompt: "This remains compatible?",
              choices: [
                { id: choiceId, label: "True", isCorrect: true },
                { id: randomUUID(), label: "False", isCorrect: false },
              ],
              timeLimitSeconds: 300,
              basePoints: 100,
              explanation: "",
              mediaId: null,
              mediaAlt: null,
            },
          ],
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/v1/quizzes/${quizId}/publish`,
        headers: { cookie },
      })
    ).statusCode,
  ).toBe(200);
  const sessionResponse = await app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: { cookie },
    payload: {
      quizId,
      clientCapabilities: currentRoundClientCapabilities(),
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    },
  });
  expect(sessionResponse.statusCode).toBe(201);
  const session = sessionResponse.json();
  expect(session.snapshot.stateSchemaVersion).toBe(7);
  const guestResponse = await app.inject({
    method: "POST",
    url: "/v1/sessions/join",
    payload: {
      code: session.code,
      nickname: "HTTP guest",
    },
  });
  expect(guestResponse.statusCode).toBe(201);
  const guest = guestResponse.json();
  const url = `/v1/sessions/${session.sessionId}/snapshot`;
  const headers = { authorization: `Bearer ${guest.participantToken}` };
  expect((await app.inject({ url, headers })).statusCode).toBe(200);
  for (const profile of [
    "not json",
    "x".repeat(257),
    JSON.stringify({ protocolVersion: 99, capabilities: [] }),
  ]) {
    expect(
      (
        await app.inject({
          url: `${url}?clientCapabilities=${encodeURIComponent(profile)}`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
  }
  const invalidJoin = await app.inject({
    method: "POST",
    url: "/v1/sessions/join",
    payload: {
      code: session.code,
      clientCapabilities: { protocolVersion: 3, capabilities: ["unknown"] },
    },
  });
  expect(invalidJoin.statusCode).toBe(400);

  // A synthetic future writer: readers must fence unsupported requirements even with the flag off.
  const stored = (await repository.getSessionById(session.sessionId))!;
  const expectedVersion = stored.state.version;
  stored.state = {
    ...stored.state,
    version: expectedVersion + 1,
    roundProtocol: {
      schemaVersion: 1,
      minimumClientVersion: 3,
      requiredCapabilities: ["poll.multiselect"],
    },
  };
  await repository.saveSession(stored, expectedVersion);
  await cache.delete(session.sessionId);
  const rejected = await app.inject({ url, headers });
  expect(rejected.statusCode).toBe(409);
  expect(rejected.json()).toMatchObject({
    error: { code: "CLIENT_UPDATE_REQUIRED", message: ROUND_CLIENT_UPDATE_MESSAGE },
  });
  expect(
    (await app.inject({ url, headers: { authorization: "Bearer invalid-token" } })).statusCode,
  ).toBe(401);
  const capable = encodeURIComponent(
    JSON.stringify({ protocolVersion: 3, capabilities: ["poll.multiselect"] }),
  );
  expect(
    (await app.inject({ url: `${url}?clientCapabilities=${capable}`, headers })).statusCode,
  ).toBe(200);
});
