import { verifyEmailAndSignIn, requestPinAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type PresentationContent,
  type PresentationStagePassResponse,
  type PresentationStageSnapshot,
} from "@openround/contracts";
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
    realtimeEnabled?: boolean;
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
    FEATURE_PRESENTATION_REALTIME: options.realtimeEnabled === false ? "false" : "true",
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
    blocks?: PresentationContent["blocks"],
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
    if (blocks) session.content.blocks = blocks;
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

describe("Presentation scoped stage API", () => {
  it("expires stage reads at the server's one-hour deadline and refuses finished/expired issuance", async () => {
    const { app, cookie, creator, seedSession } = await fixture();
    const { session } = await seedSession();
    const base = `/v1/presentation-sessions/${session.id}`;
    const pass = (
      await app.inject({ method: "POST", url: `${base}/stage-pass`, headers: { cookie } })
    ).json<PresentationStagePassResponse>();
    const headers = { authorization: `Bearer ${pass.stageToken}` };
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(pass.expiresAt));
      for (const path of [`${base}/stage`, `${base}/stage-media/${randomUUID()}`]) {
        const response = await app.inject({ method: "GET", url: path, headers });
        expect(response.statusCode).toBe(401);
        expect(response.headers["cache-control"]).toContain("no-store");
      }
    } finally {
      vi.useRealTimers();
    }
    for (const state of ["finished", "expired"] as const) {
      const seeded = await seedSession(creator.workspaceId, state);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/presentation-sessions/${seeded.session.id}/stage-pass`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(409);
    }
  });

  it("requires creator authority to mint/revoke while stage reads accept only their own bearer", async () => {
    const { app, cookie, seedSession, memberCookie } = await fixture();
    const { session, credential, controlToken } = await seedSession();
    const base = `/v1/presentation-sessions/${session.id}`;
    expect((await app.inject({ method: "POST", url: `${base}/stage-pass` })).statusCode).toBe(401);
    const viewer = await memberCookie("viewer");
    expect(
      (await app.inject({ method: "POST", url: `${base}/stage-pass`, headers: { cookie: viewer } }))
        .statusCode,
    ).toBe(403);
    const editor = await memberCookie("editor");
    const issued = await app.inject({
      method: "POST",
      url: `${base}/stage-pass`,
      headers: { cookie: editor },
    });
    expect(issued.statusCode).toBe(201);
    expect(issued.headers["cache-control"]).toContain("no-store");
    const pass = issued.json<PresentationStagePassResponse>();
    const headers = { authorization: `Bearer ${pass.stageToken}` };
    const read = await app.inject({ method: "GET", url: `${base}/stage`, headers });
    expect(read.statusCode).toBe(200);
    expect(read.headers["cache-control"]).toContain("no-store");
    expect(read.json()).toMatchObject({
      snapshot: { projection: "stage", currentBlock: null, revealedAnswer: null },
    });
    for (const invalidHeaders of [{ cookie }, { authorization: `Bearer ${controlToken}` }]) {
      expect(
        (await app.inject({ method: "GET", url: `${base}/stage`, headers: invalidHeaders }))
          .statusCode,
      ).toBe(401);
    }
    const joined = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: session.code, nickname: "Audience" },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${base}/stage`,
          headers: { authorization: `Bearer ${joined.json().participantToken}` },
        })
      ).statusCode,
    ).toBe(401);
    const foreign = await seedSession(randomUUID());
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/presentation-sessions/${foreign.session.id}/stage`,
          headers,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/presentation-sessions/${foreign.session.id}/stage-pass`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${base}/stage-passes/${credential.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${base}/stage-passes/${pass.credentialId}`,
          headers: { cookie: viewer },
        })
      ).statusCode,
    ).toBe(403);
    const replacement = (
      await app.inject({ method: "POST", url: `${base}/stage-pass`, headers: { cookie } })
    ).json<PresentationStagePassResponse>();
    expect((await app.inject({ method: "GET", url: `${base}/stage`, headers })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${base}/stage-passes/${replacement.credentialId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${base}/stage`,
          headers: { authorization: `Bearer ${replacement.stageToken}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/command`,
          payload: {
            sessionId: session.id,
            controlToken,
            expectedRevision: 0,
            commandId: randomUUID(),
            action: "advance",
          },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("never turns an anonymous stage bearer into host, participant, Companion or creator authority", async () => {
    const { app, cookie, seedSession } = await fixture();
    const { session } = await seedSession();
    const base = `/v1/presentation-sessions/${session.id}`;
    const pass = (
      await app.inject({ method: "POST", url: `${base}/stage-pass`, headers: { cookie } })
    ).json<PresentationStagePassResponse>();
    const headers = { authorization: `Bearer ${pass.stageToken}` };
    for (const path of [
      base,
      `${base}/participant`,
      `${base}/companion`,
      `${base}/host-media/${randomUUID()}`,
    ]) {
      expect((await app.inject({ method: "GET", url: path, headers })).statusCode).toBe(401);
    }
    for (const path of ["stage-pass", "control-pass", "companion-pass", "advance"]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `${base}/${path}`,
            headers,
            payload: { expectedRevision: 0 },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${base}/stage-passes/${pass.credentialId}`,
          headers,
        })
      ).statusCode,
    ).toBe(401);
    const command = {
      sessionId: session.id,
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "advance",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/command`,
          payload: { ...command, controlToken: pass.stageToken },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/companion-command`,
          payload: { ...command, companionToken: pass.stageToken },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${base}/responses`,
          payload: {
            participantToken: pass.stageToken,
            blockId: session.content.blocks[0]!.id,
            expectedRevision: 0,
            idempotencyKey: randomUUID(),
            response: { choiceIds: [randomUUID()] },
          },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/presentations/${session.presentationId}/draft`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
  });

  it("exposes only current safe content and media while creator previews the frozen next block", async () => {
    const built = await fixture();
    const { app, cookie, creator, repository, storage, seedSession } = built;
    vi.spyOn(storage, "createDownloadUrl").mockImplementation(
      async (asset) => `https://storage.example.test/${asset.id}`,
    );
    const mediaIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of mediaIds)
      await repository.createMediaAsset({
        id,
        workspaceId: creator.workspaceId,
        objectKey: `stage/${id}.png`,
        mimeType: "image/png",
        sizeBytes: 128,
        scanStatus: "clean",
        altText: "Image",
        createdAt: new Date(),
      });
    const blocks: PresentationContent["blocks"] = mediaIds.map((mediaId, index) => ({
      id: randomUUID(),
      kind: "content",
      layout: "title_body",
      textElements: [
        {
          id: `title-${index}`,
          role: "title",
          text: `Public slide ${index + 1}`,
          region: "top_center",
          order: 0,
        },
      ],
      mediaId,
      mediaAlt: "Image",
      speakerNotes: `PRIVATE note ${index}`,
      citations: [{ locator: "internal", excerpt: `PRIVATE source ${index}` }],
    }));
    const { session, controlToken } = await seedSession(creator.workspaceId, "active", blocks);
    const base = `/v1/presentation-sessions/${session.id}`;
    const pass = (
      await app.inject({ method: "POST", url: `${base}/stage-pass`, headers: { cookie } })
    ).json<PresentationStagePassResponse>();
    const headers = { authorization: `Bearer ${pass.stageToken}` };
    const command = {
      sessionId: session.id,
      controlToken,
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "advance",
    };
    const host = await app.inject({ method: "POST", url: `${base}/command`, payload: command });
    expect(host.json()).toMatchObject({
      snapshot: { presenter: { speakerNotes: "PRIVATE note 0", nextBlock: { id: blocks[1]!.id } } },
    });
    const read = await app.inject({ method: "GET", url: `${base}/stage`, headers });
    const snapshot = read.json<{ snapshot: PresentationStageSnapshot }>().snapshot;
    expect(snapshot).toMatchObject({ currentBlock: { id: blocks[0]!.id }, revealedAnswer: null });
    for (const secret of [
      "PRIVATE",
      "Public slide 2",
      "Public slide 3",
      "presenter",
      "participants",
      "roomStatus",
      "citations",
    ])
      expect(JSON.stringify(snapshot)).not.toContain(secret);
    for (const [index, mediaId] of mediaIds.entries()) {
      expect(
        (await app.inject({ method: "GET", url: `${base}/stage-media/${mediaId}`, headers }))
          .statusCode,
      ).toBe(index === 0 ? 200 : 404);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `${base}/host-media/${mediaId}`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(index < 2 ? 200 : 404);
    }
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${base}/stage-media/${mediaIds[0]}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
    await app.inject({
      method: "POST",
      url: `${base}/command`,
      payload: { ...command, commandId: randomUUID(), expectedRevision: 1 },
    });
    expect(
      (await app.inject({ method: "GET", url: `${base}/stage-media/${mediaIds[0]}`, headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: `${base}/stage-media/${mediaIds[1]}`, headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: `${base}/stage`, headers })).json(),
    ).toMatchObject({ snapshot: { revision: 2, currentBlock: { id: blocks[1]!.id } } });
  });

  it.each([{ realtimeEnabled: false }, { allowlisted: false }, { presentationsEnabled: false }])(
    "gates stage issuance for disabled rollout %j",
    async (options) => {
      const { app, cookie, seedSession } = await fixture(options);
      const { session } = await seedSession();
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/presentation-sessions/${session.id}/stage-pass`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404);
    },
  );
});
