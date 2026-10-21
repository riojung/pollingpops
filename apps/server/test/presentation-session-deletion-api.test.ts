import { verifyEmailAndSignIn, requestPinAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationRestV1SessionListResponseSchema } from "@openround/contracts";
import {
  MemoryRepository,
  type CreatorContext,
  type PresentationSessionRecord,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { presentationParticipantTokenHash } from "../src/presentation-session-service.js";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000003";
let app: FastifyInstance | undefined;

function responseCookie(headers: { "set-cookie"?: string | string[] }) {
  const cookies = headers["set-cookie"]!;
  return (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
}

async function fixture(options: { rolloutEnabled?: boolean } = {}) {
  const repository = new MemoryRepository({
    initialWorkspaceId: WORKSPACE_ID,
    initialPlan: "team",
  });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: WORKSPACE_ID,
      FEATURE_PRESENTATIONS: "true",
      FEATURE_PRESENTATION_REALTIME: options.rolloutEnabled === false ? "false" : "true",
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: WORKSPACE_ID,
      LOG_LEVEL: "silent",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "session-deletion-owner@example.com",
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  expect(magic.statusCode).toBe(202);
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    "session-deletion-owner@example.com",
  );
  expect(verified.statusCode).toBe(200);
  const cookie = responseCookie(verified.headers);
  const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  const creator = account.json<{ creator: CreatorContext }>().creator;
  let nextCode = 1_000_000;

  async function seedSession(
    options: {
      workspaceId?: string;
      state?: "active" | "finished" | "expired";
    } = {},
  ) {
    const now = new Date();
    const state = options.state ?? "active";
    const liveExpiresAt = new Date(now.getTime() + (state === "expired" ? -1 : 86_400_000));
    const session: PresentationSessionRecord = {
      id: randomUUID(),
      workspaceId: options.workspaceId ?? creator.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: "Retained session",
      content: {
        title: "Retained session",
        description: "",
        experiencePreset: { id: "focus", version: 1 },
        schemaVersion: 2,
        blocks: [
          {
            id: randomUUID(),
            kind: "content",
            layout: "title_body",
            textElements: [
              { id: "title", role: "title", text: "Review", region: "top_center", order: 0 },
            ],
            mediaId: null,
            mediaAlt: null,
            speakerNotes: "",
          },
        ],
      },
      code: String(nextCode++),
      status: state === "finished" ? "finished" : "active",
      phase: state === "finished" ? "finished" : "lobby",
      currentBlockIndex: state === "finished" ? 0 : -1,
      revision: 0,
      eventSeq: 0,
      settings: { timeMode: "timed" },
      trustMode: "learning",
      questionOpenedAt: null,
      questionClosesAt: null,
      createdBy: creator.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: state === "finished" ? now : null,
      liveExpiresAt,
      retentionExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    };
    return built.presentationSessions.createSessionWithCredential(session, {
      id: randomUUID(),
      workspaceId: session.workspaceId,
      sessionId: session.id,
      role: "host",
      tokenHash: presentationParticipantTokenHash(randomUUID()),
      createdAt: now,
      expiresAt: liveExpiresAt,
      revokedAt: null,
    });
  }

  async function memberCookie(role: "editor" | "viewer") {
    const invited = await built.app.inject({
      method: "POST",
      url: "/v1/workspace/invitations",
      headers: { cookie },
      payload: { email: `session-deletion-${role}@example.com`, role },
    });
    expect(invited.statusCode).toBe(201);
    const invitationToken = new URL(invited.json<{ debugUrl: string }>().debugUrl).searchParams.get(
      "token",
    )!;
    const accepted = await built.app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      payload: { token: invitationToken, acceptPolicies: true },
    });
    expect(accepted.headers["set-cookie"]).toBeUndefined();
    const acceptedSignIn = await requestPinAndSignIn(
      built.app,
      `session-deletion-${role}@example.com`,
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ creator: { workspaceId: creator.workspaceId, role } });
    return responseCookie(acceptedSignIn.headers);
  }

  return { ...built, repository, creator, cookie, seedSession, memberCookie };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("Presentation session deletion API", () => {
  it("requires an authenticated owner and hides sessions in another workspace", async () => {
    const { app, presentationSessions, seedSession, memberCookie, cookie } = await fixture();
    const { session } = await seedSession({ state: "finished" });
    const url = `/v1/presentation-sessions/${session.id}`;
    const anonymous = await app.inject({ method: "DELETE", url });
    expect(anonymous.statusCode).toBe(401);
    for (const role of ["editor", "viewer"] as const) {
      const member = await app.inject({
        method: "DELETE",
        url,
        headers: { cookie: await memberCookie(role) },
      });
      expect(member.statusCode).toBe(403);
      expect(member.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
      expect(await presentationSessions.getSessionById(session.id)).not.toBeNull();
    }

    const { session: foreign } = await seedSession({
      workspaceId: randomUUID(),
      state: "finished",
    });
    const foreignDeletion = await app.inject({
      method: "DELETE",
      url: `/v1/presentation-sessions/${foreign.id}`,
      headers: { cookie },
    });
    expect(foreignDeletion.statusCode).toBe(404);
    expect(foreignDeletion.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(await presentationSessions.getSessionById(foreign.id)).not.toBeNull();
    expect(await presentationSessions.getReport(foreign.workspaceId, foreign.id)).not.toBeNull();
  });

  it("protects active rooms and deletes both finished and expired retained sessions", async () => {
    const {
      app,
      presentationSessions,
      presentationService,
      repository,
      creator,
      seedSession,
      cookie,
    } = await fixture();
    const deleted = vi.fn();
    presentationService.setSessionDeletedHandler(deleted);
    const { session: active } = await seedSession();
    const protectedRoom = await app.inject({
      method: "DELETE",
      url: `/v1/presentation-sessions/${active.id}`,
      headers: { cookie },
    });
    expect(protectedRoom.statusCode).toBe(409);
    expect(protectedRoom.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect(await presentationSessions.getSessionById(active.id)).not.toBeNull();
    expect(await repository.getLiveRoomCode(active.code)).not.toBeNull();
    expect(deleted).not.toHaveBeenCalled();

    for (const state of ["finished", "expired"] as const) {
      const { session, credential } = await seedSession({ state });
      const response = await app.inject({
        method: "DELETE",
        url: `/v1/presentation-sessions/${session.id}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(204);
      expect(response.body).toBe("");
      expect(await presentationSessions.getSessionById(session.id)).toBeNull();
      expect(
        await presentationSessions.findValidCredential(session.id, credential.tokenHash),
      ).toBeNull();
      expect(await presentationSessions.getReport(session.workspaceId, session.id)).toBeNull();
      expect(await repository.getLiveRoomCode(session.code)).toBeNull();
      expect(deleted).toHaveBeenCalledWith(session.id);
      expect(repository.audits).toContainEqual(
        expect.objectContaining({
          workspaceId: creator.workspaceId,
          actorId: creator.userId,
          action: "presentation.session.delete",
          targetId: session.id,
        }),
      );
      const repeated = await app.inject({
        method: "DELETE",
        url: `/v1/presentation-sessions/${session.id}`,
        headers: { cookie },
      });
      expect(repeated.statusCode).toBe(404);
    }
    const listed = await app.inject({
      method: "GET",
      url: "/v1/presentation-sessions",
      headers: { cookie },
    });
    expect(PresentationRestV1SessionListResponseSchema.parse(listed.json()).sessions).toEqual([
      expect.objectContaining({ id: active.id }),
    ]);
    expect(deleted).toHaveBeenCalledTimes(2);
  });

  it("gates deletion on Presentation session rollout eligibility", async () => {
    const { app, presentationSessions, seedSession, cookie } = await fixture({
      rolloutEnabled: false,
    });
    const { session } = await seedSession({ state: "finished" });
    const response = await app.inject({
      method: "DELETE",
      url: `/v1/presentation-sessions/${session.id}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(await presentationSessions.getSessionById(session.id)).not.toBeNull();
  });
});
