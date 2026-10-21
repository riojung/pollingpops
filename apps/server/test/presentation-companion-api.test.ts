import { verifyEmailAndSignIn, requestPinAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryRepository,
  type CreatorContext,
  type PresentationSessionRecord,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { presentationParticipantTokenHash } from "../src/presentation-session-service.js";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000004";
let app: FastifyInstance | undefined;

class RecordingSessionCache extends MemorySessionCache {
  readonly admissionKeys: string[] = [];
  override async consumeRateLimit(key: string, maximum: number, windowMs: number) {
    this.admissionKeys.push(key);
    return super.consumeRateLimit(key, maximum, windowMs);
  }
}

function responseCookie(headers: { "set-cookie"?: string | string[] }) {
  const cookies = headers["set-cookie"]!;
  return (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
}

async function fixture(
  options: {
    companionEnabled?: boolean;
    allowlisted?: boolean;
    presentationsEnabled?: boolean;
  } = {},
) {
  const repository = new MemoryRepository({
    initialWorkspaceId: WORKSPACE_ID,
    initialPlan: "team",
  });
  const cache = new RecordingSessionCache();
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    FEATURE_UX_BETA: "true",
    UX_BETA_WORKSPACE_ALLOWLIST: WORKSPACE_ID,
    FEATURE_PRESENTATIONS: options.presentationsEnabled === false ? "false" : "true",
    FEATURE_PRESENTATION_REALTIME: "true",
    FEATURE_PRESENTATION_COMPANION: options.companionEnabled === false ? "false" : "true",
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST:
      options.allowlisted === false ? randomUUID() : WORKSPACE_ID,
    LOG_LEVEL: "silent",
  });
  const built = await buildApp(config, { repository, cache });
  app = built.app;
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: "companion-owner@example.com", segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    app,
    `/v1/auth/verify?token=${token}`,
    "companion-owner@example.com",
  );
  const cookie = responseCookie(verified.headers);
  const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  const creator = account.json<{ creator: CreatorContext }>().creator;
  let nextCode = 2_000_000;
  async function seedSession(
    workspaceId = creator.workspaceId,
    state: "active" | "finished" | "expired" = "active",
  ) {
    const now = new Date();
    const session: PresentationSessionRecord = {
      id: randomUUID(),
      workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: "Companion session",
      content: {
        title: "Companion session",
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
            speakerNotes: "Private facilitator note",
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
      liveExpiresAt: new Date(now.getTime() + (state === "expired" ? -1 : 86_400_000)),
      retentionExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    };
    const controlToken = `${randomUUID()}.${randomUUID()}`;
    const created = await built.presentationSessions.createSessionWithCredential(session, {
      id: randomUUID(),
      workspaceId,
      sessionId: session.id,
      role: "host",
      tokenHash: presentationParticipantTokenHash(controlToken),
      createdAt: now,
      expiresAt: session.liveExpiresAt,
      revokedAt: null,
    });
    return { ...created, controlToken };
  }
  async function memberCookie(role: "editor" | "viewer") {
    const invitation = await built.app.inject({
      method: "POST",
      url: "/v1/workspace/invitations",
      headers: { cookie },
      payload: { email: `companion-${role}@example.com`, role },
    });
    const invitationToken = new URL(
      invitation.json<{ debugUrl: string }>().debugUrl,
    ).searchParams.get("token")!;
    const accepted = await built.app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      payload: { token: invitationToken, acceptPolicies: true },
    });
    expect(accepted.headers["set-cookie"]).toBeUndefined();
    const acceptedSignIn = await requestPinAndSignIn(built.app, `companion-${role}@example.com`);
    expect(accepted.statusCode).toBe(200);
    return responseCookie(acceptedSignIn.headers);
  }
  return { ...built, config, cache, cookie, creator, seedSession, memberCookie };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("Presentation companion API", () => {
  it("requires an owner or editor, hides other tenants, and fences companion revocation by role", async () => {
    const { app, cookie, seedSession, memberCookie } = await fixture();
    const { session, credential } = await seedSession();
    const url = `/v1/presentation-sessions/${session.id}/companion-pass`;
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(401);
    const viewer = await memberCookie("viewer");
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie: viewer } })).statusCode,
    ).toBe(403);
    const editor = await memberCookie("editor");
    const issued = await app.inject({ method: "POST", url, headers: { cookie: editor } });
    expect(issued.statusCode).toBe(201);
    expect(issued.headers["cache-control"]).toContain("no-store");
    const pass = issued.json<{ credentialId: string; companionToken: string; expiresAt: string }>();
    const foreign = await seedSession(randomUUID());
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/presentation-sessions/${foreign.session.id}/companion-pass`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    const revokeUrl = `/v1/presentation-sessions/${session.id}/companion-passes/`;
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${revokeUrl}${credential.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${revokeUrl}${pass.credentialId}`,
          headers: { cookie: viewer },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${revokeUrl}${pass.credentialId}`,
          headers: { cookie: editor },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/presentation-sessions/${session.id}/companion`,
          headers: { authorization: `Bearer ${pass.companionToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("uses bearer-only recovery and strict scoped commands and continues after rollout rollback", async () => {
    const { app, cookie, seedSession, config, cache } = await fixture();
    const { session, controlToken } = await seedSession();
    const base = `/v1/presentation-sessions/${session.id}`;
    const issued = await app.inject({
      method: "POST",
      url: `${base}/companion-pass`,
      headers: { cookie },
    });
    expect(issued.statusCode).toBe(201);
    const pass = issued.json<{ credentialId: string; companionToken: string }>();
    config.FEATURE_PRESENTATION_COMPANION = false;
    config.FEATURE_PRESENTATION_REALTIME = false;
    config.FEATURE_PRESENTATIONS = false;
    expect(
      (await app.inject({ method: "POST", url: `${base}/companion-pass`, headers: { cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${base}/companion?companionToken=${pass.companionToken}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${base}/companion`,
          headers: { authorization: `Bearer ${controlToken}` },
        })
      ).statusCode,
    ).toBe(401);
    const recovered = await app.inject({
      method: "GET",
      url: `${base}/companion`,
      headers: { authorization: `Bearer ${pass.companionToken}` },
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.headers["cache-control"]).toContain("no-store");
    const command = {
      sessionId: session.id,
      companionToken: pass.companionToken,
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "advance",
    };
    for (const { payload, status } of [
      { payload: { ...command, action: "start_recovery_card" }, status: 400 },
      { payload: { ...command, controlToken }, status: 400 },
      { payload: { ...command, sessionId: randomUUID() }, status: 422 },
    ]) {
      expect(
        (await app.inject({ method: "POST", url: `${base}/companion-command`, payload }))
          .statusCode,
      ).toBe(status);
    }
    const advanced = await app.inject({
      method: "POST",
      url: `${base}/companion-command`,
      payload: command,
    });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json()).toMatchObject({
      snapshot: { projection: "companion", phase: "content", revision: 1, resultSummary: null },
    });
    expect(advanced.body).not.toContain("Private facilitator note");
    expect(advanced.headers["cache-control"]).toContain("no-store");
    expect(cache.admissionKeys).toContain(
      `presentation-companion:snapshot:${session.id}:${presentationParticipantTokenHash(pass.companionToken)}`,
    );
    expect(cache.admissionKeys).toContain(
      `presentation-companion:command:${session.id}:${presentationParticipantTokenHash(pass.companionToken)}`,
    );
    const hostCommand = await app.inject({
      method: "POST",
      url: `${base}/command`,
      payload: {
        sessionId: session.id,
        controlToken,
        commandId: randomUUID(),
        expectedRevision: 1,
        action: "advance",
      },
    });
    expect(hostCommand.statusCode).toBe(200);
    expect(
      (await app.inject({ method: "POST", url: `${base}/companion-command`, payload: command }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${base}/companion-passes/${pass.credentialId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
  });

  it.each([{ companionEnabled: false }, { allowlisted: false }, { presentationsEnabled: false }])(
    "gates issuance for disabled deployment or workspace rollout %j",
    async (options) => {
      const { app, cookie, seedSession } = await fixture(options);
      const { session } = await seedSession();
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/presentation-sessions/${session.id}/companion-pass`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404);
    },
  );

  it("refuses new passes for finished or expired sessions", async () => {
    const { app, cookie, creator, seedSession } = await fixture();
    for (const state of ["finished", "expired"] as const) {
      const { session } = await seedSession(creator.workspaceId, state);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/presentation-sessions/${session.id}/companion-pass`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(409);
    }
  });
});
