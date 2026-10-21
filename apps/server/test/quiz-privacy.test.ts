import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { OutgoingHttpHeaders } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

async function signIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(target, `/v1/auth/verify?token=${token}`, email);
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

function expectPrivateNoStore(response: { headers: OutgoingHttpHeaders }) {
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers.pragma).toBe("no-cache");
}

describe("private Round reads", () => {
  it("prevents storage of list and detail responses and hides a known foreign Round ID", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
      }),
      { repository: new MemoryRepository(), cache: new MemorySessionCache() },
    );
    app = built.app;

    const ownerCookie = await signIn(app, "round-privacy-owner@example.com");
    const foreignCookie = await signIn(app, "round-privacy-foreign@example.com");
    const privateTitle = "Private merger readiness";
    const privatePrompt = "Which confidential milestone comes next?";
    const created = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie: ownerCookie },
      payload: { title: privateTitle, description: "Internal planning only" },
    });
    expect(created.statusCode).toBe(201);
    const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie: ownerCookie },
      payload: {
        expectedDraftRevision: 0,
        draft: {
          title: privateTitle,
          description: "Internal planning only",
          questions: [
            {
              id: randomUUID(),
              type: "single_select",
              prompt: privatePrompt,
              choices: [
                { id: randomUUID(), label: "Private option A", isCorrect: true },
                { id: randomUUID(), label: "Private option B", isCorrect: false },
              ],
              timeLimitSeconds: 20,
              basePoints: 1_000,
              explanation: "Confidential rationale",
              mediaId: null,
              mediaAlt: null,
            },
          ],
        },
      },
    });
    expect(updated.statusCode).toBe(200);

    const fullList = await app.inject({
      method: "GET",
      url: "/v1/quizzes",
      headers: { cookie: ownerCookie },
    });
    expect(fullList.statusCode).toBe(200);
    expectPrivateNoStore(fullList);
    expect(fullList.body).toContain(privatePrompt);

    const summaryList = await app.inject({
      method: "GET",
      url: "/v1/quizzes?summary=true",
      headers: { cookie: ownerCookie },
    });
    expect(summaryList.statusCode).toBe(200);
    expectPrivateNoStore(summaryList);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie: ownerCookie },
    });
    expect(detail.statusCode).toBe(200);
    expectPrivateNoStore(detail);
    expect(detail.body).toContain(privatePrompt);

    const foreignList = await app.inject({
      method: "GET",
      url: "/v1/quizzes",
      headers: { cookie: foreignCookie },
    });
    expect(foreignList.statusCode).toBe(200);
    expectPrivateNoStore(foreignList);
    expect(foreignList.body).not.toContain(quizId);
    expect(foreignList.body).not.toContain(privateTitle);

    const foreignDetail = await app.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie: foreignCookie },
    });
    expect(foreignDetail.statusCode).toBe(404);
    expectPrivateNoStore(foreignDetail);
    expect(foreignDetail.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(foreignDetail.body).not.toContain(privateTitle);
    expect(foreignDetail.body).not.toContain(privatePrompt);
  });
});
