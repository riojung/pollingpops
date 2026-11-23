import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkspaceProductFeaturesSchema,
  type WorkspaceProductFeatures,
} from "@openround/contracts";
import { MemoryRepository, createPlatformRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

async function signIn(target: FastifyInstance) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "rollout-owner@example.com",
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(
    target,
    `/v1/auth/verify?token=${token}`,
    "rollout-owner@example.com",
  );
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("professional workspace rollout flags", () => {
  it("reports workspace Board creation decisions and handles older or unfamiliar reasons", async () => {
    const workspaceId = randomUUID();
    const repository = new MemoryRepository({
      initialWorkspaceId: workspaceId,
      initialPlan: "free",
    });
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      FEATURE_IDEA_BOARDS: "true",
      FEATURE_CANVAS_BOARDS: "true",
      FEATURE_SESSION_CREATION: "false",
      LOG_LEVEL: "silent",
    });
    const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
    app = built.app;
    const cookie = await signIn(app);
    const productFeatures = async () => {
      const response = await built.app.inject({ url: "/v1/auth/me", headers: { cookie } });
      expect(response.statusCode, response.body).toBe(200);
      return response.json<{ productFeatures: WorkspaceProductFeatures }>().productFeatures;
    };

    const rollout = await productFeatures();
    expect(rollout).toMatchObject({
      ideaBoards: false,
      ideaBoardsCreationUnavailableReason: "rollout_unavailable",
      canvasBoards: false,
      canvasBoardsCreationUnavailableReason: "rollout_unavailable",
    });
    const legacy = { ...rollout };
    delete legacy.ideaBoardsCreationUnavailableReason;
    delete legacy.canvasBoardsCreationUnavailableReason;
    const legacyParsed = WorkspaceProductFeaturesSchema.parse(legacy);
    expect(legacyParsed).not.toHaveProperty("ideaBoardsCreationUnavailableReason");
    expect(legacyParsed).not.toHaveProperty("canvasBoardsCreationUnavailableReason");
    expect(legacyParsed).not.toHaveProperty("ideaBoardsLaunchUnavailableReason");
    expect(legacyParsed).not.toHaveProperty("canvasBoardsLaunchUnavailableReason");
    expect(
      WorkspaceProductFeaturesSchema.parse({
        ...legacy,
        ideaBoardsCreationUnavailableReason: "future_reason",
        canvasBoardsCreationUnavailableReason: null,
        ideaBoardsLaunchUnavailableReason: "future_reason",
        canvasBoardsLaunchUnavailableReason: null,
      }),
    ).toMatchObject({
      ideaBoards: false,
      ideaBoardsCreationUnavailableReason: undefined,
      canvasBoards: false,
      canvasBoardsCreationUnavailableReason: undefined,
      ideaBoardsLaunchUnavailableReason: undefined,
      canvasBoardsLaunchUnavailableReason: undefined,
    });

    config.CORE_PARITY_WORKSPACE_ALLOWLIST = [workspaceId];
    const enabled = await productFeatures();
    expect(enabled).toMatchObject({ ideaBoards: true, canvasBoards: true });
    expect(enabled).not.toHaveProperty("ideaBoardsCreationUnavailableReason");
    expect(enabled).not.toHaveProperty("canvasBoardsCreationUnavailableReason");
    expect(enabled).not.toHaveProperty("ideaBoardsLaunchUnavailableReason");
    expect(enabled).not.toHaveProperty("canvasBoardsLaunchUnavailableReason");
    const publicFeatures = await app.inject({ url: "/v1/features" });
    expect(publicFeatures.statusCode).toBe(200);
    expect(publicFeatures.json()).not.toHaveProperty("ideaBoardsLaunchUnavailableReason");
    expect(publicFeatures.json()).not.toHaveProperty("canvasBoardsLaunchUnavailableReason");

    const platform = createPlatformRepository(repository);
    await repository.updateOperationalFeatures({ sessionCreation: false }, randomUUID());
    expect(WorkspaceProductFeaturesSchema.parse(await productFeatures())).toMatchObject({
      ideaBoards: true,
      canvasBoards: true,
      ideaBoardsLaunchUnavailableReason: "operational_pause",
      canvasBoardsLaunchUnavailableReason: "operational_pause",
    });
    const canvasRule = await platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: { canvasBoards: { enabled: true, plans: ["pro"] } },
    });
    const canvasDenied = await productFeatures();
    expect(canvasDenied).toMatchObject({
      ideaBoards: true,
      ideaBoardsLaunchUnavailableReason: "operational_pause",
      canvasBoards: false,
      canvasBoardsCreationUnavailableReason: "operator_policy",
    });
    expect(canvasDenied).not.toHaveProperty("ideaBoardsCreationUnavailableReason");
    expect(canvasDenied).not.toHaveProperty("canvasBoardsLaunchUnavailableReason");

    config.CORE_PARITY_WORKSPACE_ALLOWLIST = [];
    await platform.saveFeaturePolicy({
      expectedRevision: canvasRule.revision,
      features: { ideaBoards: { enabled: false, plans: [] } },
    });
    const bothDenied = WorkspaceProductFeaturesSchema.parse(await productFeatures());
    expect(bothDenied).toMatchObject({
      ideaBoards: false,
      ideaBoardsCreationUnavailableReason: "operator_policy",
      canvasBoards: false,
      canvasBoardsCreationUnavailableReason: "operator_policy",
    });
    expect(bothDenied).not.toHaveProperty("ideaBoardsLaunchUnavailableReason");
    expect(bothDenied).not.toHaveProperty("canvasBoardsLaunchUnavailableReason");
  });

  it("fails closed for new Presentation creation while keeping recovery reads registered", async () => {
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
    const cookie = await signIn(app);

    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(account.json()).toMatchObject({
      productFeatures: {
        workspaceShell: true,
        builderV2: false,
        presentations: false,
        presentationRealtime: false,
        presentationRealtimeUnavailableReason: "rollout_unavailable",
        liveFlexMode: false,
        groups: false,
        discover: false,
      },
    });
    expect((await app.inject({ method: "GET", url: "/v1/features" })).json()).toMatchObject({
      presentations: false,
    });
    for (const url of ["/v1/home/summary", "/v1/library/favorites"]) {
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(200);
    }
    expect(
      (await app.inject({ method: "GET", url: "/v1/presentations", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/presentations",
          headers: { cookie },
          payload: { title: "Blocked during rollout pause", description: "" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/v1/presentation-sessions", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/presentation-sessions",
          headers: { cookie },
          payload: { presentationId: randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/v1/groups", headers: { cookie } })).statusCode,
    ).toBe(404);
  });

  it("keeps staged capabilities gated while core workspace navigation is available", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        FEATURE_WORKSPACE_SHELL: "true",
        FEATURE_BUILDER_V2: "true",
        FEATURE_PRESENTATIONS: "true",
        FEATURE_GROUPS: "true",
        FEATURE_DISCOVER: "true",
        LOG_LEVEL: "silent",
      }),
      { repository: new MemoryRepository(), cache: new MemorySessionCache() },
    );
    app = built.app;
    const cookie = await signIn(app);

    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(account.json()).toMatchObject({
      productFeatures: {
        uxBeta: false,
        workspaceShell: true,
        builderV2: false,
        presentations: false,
        presentationRealtime: false,
        groups: false,
        discover: false,
      },
    });
    expect((await app.inject({ method: "GET", url: "/v1/features" })).json()).toMatchObject({
      presentations: true,
    });
    expect(
      (await app.inject({ method: "GET", url: "/v1/presentations", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/presentation-sessions", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/groups", headers: { cookie } })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/v1/home/summary", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/library/favorites", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/quizzes", headers: { cookie } })).statusCode,
    ).toBe(200);
  });

  it("exposes independently enabled professional features to an allowlisted workspace", async () => {
    const workspaceId = randomUUID();
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
        FEATURE_WORKSPACE_SHELL: "true",
        FEATURE_BUILDER_V2: "true",
        FEATURE_PRESENTATIONS: "true",
        FEATURE_GROUPS: "true",
        FEATURE_DISCOVER: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository({ initialWorkspaceId: workspaceId }),
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;
    const cookie = await signIn(app);

    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(account.json()).toMatchObject({
      productFeatures: {
        uxBeta: true,
        workspaceShell: true,
        builderV2: true,
        presentations: true,
        presentationRealtime: false,
        groups: true,
        discover: true,
      },
    });
    for (const url of [
      "/v1/presentations",
      "/v1/presentation-sessions",
      "/v1/groups",
      "/v1/home/summary",
      "/v1/library/favorites",
    ]) {
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(200);
    }
  });

  it("keeps existing Presentation participation readable when rollout eligibility is removed", async () => {
    const workspaceId = randomUUID();
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      FEATURE_PRESENTATIONS: "true",
      FEATURE_PRESENTATION_REALTIME: "true",
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
      LOG_LEVEL: "silent",
    });
    const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
    const built = await buildApp(config, {
      repository,
      cache: new MemorySessionCache(),
    });
    app = built.app;
    const cookie = await signIn(app);
    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(account.json()).toMatchObject({
      productFeatures: {
        presentations: true,
        presentationRealtime: true,
      },
    });
    const creator = account.json<{ creator: { userId: string } }>().creator;
    const createdPresentation = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "Existing authoring content", description: "Must remain readable" },
    });
    expect(createdPresentation.statusCode).toBe(201);
    const presentationId = createdPresentation.json<{ presentation: { id: string } }>().presentation
      .id;
    const now = new Date();
    const sessionId = randomUUID();
    await built.presentationSessions.createSession({
      id: sessionId,
      workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: "Allowlisted briefing",
      content: {
        title: "Allowlisted briefing",
        description: "",
        experiencePreset: { id: "focus", version: 1 },
        schemaVersion: 2,
        blocks: [
          {
            id: randomUUID(),
            kind: "content",
            layout: "title_body",
            textElements: [
              {
                id: "welcome:title",
                role: "title",
                text: "Welcome",
                region: "top_center",
                order: 0,
              },
              {
                id: "welcome:body",
                role: "body",
                text: "A source-grounded briefing.",
                region: "middle_center",
                order: 0,
              },
            ],
            mediaId: null,
            mediaAlt: null,
            speakerNotes: "",
          },
        ],
      },
      code: "7654321",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: creator.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(now.getTime() + 86_400_000),
    });

    config.FEATURE_PRESENTATION_REALTIME = false;
    config.EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST.splice(0);

    const accountDuringRealtimePause = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie },
    });
    expect(accountDuringRealtimePause.json()).toMatchObject({
      productFeatures: {
        presentations: true,
        presentationRealtime: false,
      },
    });

    const authoringList = await app.inject({
      method: "GET",
      url: "/v1/presentations",
      headers: { cookie },
    });
    expect(authoringList.statusCode).toBe(200);
    expect(authoringList.json()).toMatchObject({
      presentations: [expect.objectContaining({ id: presentationId })],
    });
    for (const url of [
      `/v1/presentations/${presentationId}`,
      `/v1/presentations/${presentationId}/history`,
    ]) {
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(200);
    }
    const privacyExport = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: { cookie },
    });
    expect(privacyExport.statusCode).toBe(200);
    expect(privacyExport.json()).toMatchObject({
      presentations: [expect.objectContaining({ id: presentationId })],
    });

    const joinedDuringRollback = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: "7654321", nickname: "Learner" },
    });
    expect(joinedDuringRollback.statusCode, JSON.stringify(joinedDuringRollback.json())).toBe(201);
    const participantToken = joinedDuringRollback.json<{ participantToken: string }>()
      .participantToken;

    const hostDetailDuringRollback = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${sessionId}`,
      headers: { cookie },
    });
    expect(hostDetailDuringRollback.statusCode).toBe(200);
    const participantDetailDuringRollback = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${sessionId}/participant`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(participantDetailDuringRollback.statusCode).toBe(200);

    const rotatedControlPass = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${sessionId}/control-pass`,
      headers: { cookie },
    });
    expect(rotatedControlPass.statusCode).toBe(201);
    const controlCredentialId = rotatedControlPass.json<{ credentialId: string }>().credentialId;

    const contentDuringRollback = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${sessionId}/advance`,
      headers: { cookie },
      payload: { expectedRevision: 0 },
    });
    expect(contentDuringRollback.statusCode).toBe(200);
    expect(contentDuringRollback.json()).toMatchObject({ snapshot: { phase: "content" } });
    const finishedDuringRollback = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${sessionId}/advance`,
      headers: { cookie },
      payload: { expectedRevision: 1 },
    });
    expect(finishedDuringRollback.statusCode).toBe(200);
    expect(finishedDuringRollback.json()).toMatchObject({ snapshot: { phase: "finished" } });
    await built.presentationReportWorker.runUntilIdle();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/presentation-sessions/${sessionId}/report`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/presentation-sessions/${sessionId}/control-passes/${controlCredentialId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);

    const listedDuringRollback = await app.inject({
      method: "GET",
      url: "/v1/presentation-sessions",
      headers: { cookie },
    });
    expect(listedDuringRollback.statusCode).toBe(200);
    expect(listedDuringRollback.json()).toMatchObject({
      sessions: [expect.objectContaining({ code: "7654321" })],
    });

    const blockedCreation = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions",
      headers: { cookie },
      payload: { presentationId: randomUUID() },
    });
    expect(blockedCreation.statusCode).toBe(404);

    // Pausing only new realtime rooms must not also pause Presentation authoring.
    const authoringDuringRealtimePause = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "Authoring remains available", description: "" },
    });
    expect(authoringDuringRealtimePause.statusCode).toBe(201);

    config.UX_BETA_WORKSPACE_ALLOWLIST.splice(0);
    const blockedAuthoringCreation = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "New content", description: "" },
    });
    expect(blockedAuthoringCreation.statusCode).toBe(404);
    const blockedDraftMutation = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${presentationId}/draft`,
      headers: { cookie },
      payload: {},
    });
    expect(blockedDraftMutation.statusCode).toBe(404);
    await built.productEvents.drain();
    expect(repository.productEvents.map(({ name }) => name)).toEqual([
      "participant_joined",
      "report_reconciled",
    ]);
  });
});
