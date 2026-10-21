import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
const BETA_WORKSPACE_ID = "10000000-0000-4000-8000-000000000003";

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

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("facilitator collaboration groups", () => {
  it("curates artifacts, schedules a published Round, and keeps discussion workspace-private", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_PRESENTATIONS: "true",
        FEATURE_GROUPS: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID }),
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;
    const ownerCookie = await signIn(app, "group-owner@example.com");

    const createdGroup = await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: { cookie: ownerCookie },
      payload: { name: "Safety facilitators", description: "Curated recovery practice" },
    });
    expect(createdGroup.statusCode).toBe(201);
    const groupId = createdGroup.json<{ group: { id: string; role: string } }>().group.id;
    expect(createdGroup.json()).toMatchObject({ group: { role: "owner" } });

    const createdRound = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie: ownerCookie },
      payload: { title: "Lockout recovery", description: "A diagnostic and recheck" },
    });
    const roundId = createdRound.json<{ quiz: { id: string } }>().quiz.id;
    const questionId = randomUUID();
    const savedRound = await app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${roundId}`,
      headers: { cookie: ownerCookie },
      payload: {
        expectedDraftRevision: 0,
        draft: {
          title: "Lockout recovery",
          description: "A diagnostic and recheck",
          questions: [
            {
              id: questionId,
              type: "single_select",
              prompt: "What should happen before maintenance begins?",
              choices: [
                { id: randomUUID(), label: "Verify isolation", isCorrect: true },
                { id: randomUUID(), label: "Begin immediately", isCorrect: false },
              ],
              timeLimitSeconds: 20,
              basePoints: 1000,
              explanation: "Isolation must be verified before work begins.",
              mediaId: null,
              mediaAlt: null,
            },
          ],
        },
      },
    });
    expect(savedRound.statusCode).toBe(200);
    const publishedRound = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${roundId}/publish`,
      headers: { cookie: ownerCookie },
      payload: { expectedDraftRevision: 1 },
    });
    expect(publishedRound.statusCode).toBe(200);

    const createdPresentation = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie: ownerCookie },
      payload: { title: "Safety briefing", description: "Facilitator deck" },
    });
    const presentationId = createdPresentation.json<{ presentation: { id: string } }>().presentation
      .id;

    for (const payload of [
      { artifactType: "round", artifactId: roundId },
      { artifactType: "presentation", artifactId: presentationId },
    ]) {
      const shared = await app.inject({
        method: "POST",
        url: `/v1/groups/${groupId}/artifacts`,
        headers: { cookie: ownerCookie },
        payload,
      });
      expect(shared.statusCode).toBe(201);
    }

    const discussed = await app.inject({
      method: "POST",
      url: `/v1/groups/${groupId}/messages`,
      headers: { cookie: ownerCookie },
      payload: { body: "Use the recheck after the isolation walkthrough." },
    });
    expect(discussed.statusCode).toBe(201);

    const scheduledFor = new Date(Date.now() + 86_400_000).toISOString();
    const scheduled = await app.inject({
      method: "POST",
      url: `/v1/groups/${groupId}/schedule`,
      headers: { cookie: ownerCookie },
      payload: {
        artifactType: "round",
        artifactId: roundId,
        kind: "round_assignment",
        scheduledFor,
        note: "Complete before the next shift.",
      },
    });
    expect(scheduled.statusCode).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/groups/${groupId}`,
      headers: { cookie: ownerCookie },
    });
    expect(detail.statusCode).toBe(200);
    const groupDetail = detail.json<{
      group: {
        name: string;
        role: string;
        artifacts: Array<{ artifactType: string; title: string; published: boolean }>;
        messages: Array<{ body: string; authorEmail: string }>;
        schedule: Array<{ artifactTitle: string; kind: string }>;
      };
    }>().group;
    expect(groupDetail).toMatchObject({
      name: "Safety facilitators",
      role: "owner",
      messages: [
        {
          body: "Use the recheck after the isolation walkthrough.",
          authorEmail: "group-owner@example.com",
        },
      ],
      schedule: [{ artifactTitle: "Lockout recovery", kind: "round_assignment" }],
    });
    expect(groupDetail.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactType: "presentation",
          title: "Safety briefing",
          published: false,
        }),
        expect.objectContaining({
          artifactType: "round",
          title: "Lockout recovery",
          published: true,
        }),
      ]),
    );

    const listed = await app.inject({
      method: "GET",
      url: "/v1/groups",
      headers: { cookie: ownerCookie },
    });
    expect(listed.json()).toMatchObject({
      groups: [{ id: groupId, memberCount: 1, artifactCount: 2, upcomingCount: 1 }],
    });

    const outsiderCookie = await signIn(app, "outside-workspace@example.com");
    const hidden = await app.inject({
      method: "GET",
      url: `/v1/groups/${groupId}`,
      headers: { cookie: outsiderCookie },
    });
    expect(hidden.statusCode).toBe(404);
  });
});
