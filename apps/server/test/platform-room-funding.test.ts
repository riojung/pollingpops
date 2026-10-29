import { requestPinAndSignIn } from "./support/email-auth.js";
import { buildApp } from "../src/app.js";
import { workspaceFeatureEnabled, roomFeatureEnabled } from "../src/feature-policy.js";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as PrometheusClient from "@prometheus-io/client";
import {
  MemoryRepository,
  createPlatformRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
  createRecoveryPackRepository,
} from "@openround/db";
import {
  PresentationDraftSchema,
  PresentationContentSchema,
  WorkspaceProductFeaturesSchema,
  RecoveryPackContentSchema,
  recoveryPackContentHash,
} from "@openround/contracts";
import type {
  PresentationCompanionCommand,
  ProductFeatureRules,
  QuizDraft,
  SessionSettings,
} from "@openround/contracts";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";
import { MetricsService } from "../src/metrics.js";
import { SessionService } from "../src/session-service.js";
import { PresentationSessionService } from "../src/presentation-session-service.js";
import { StorageService } from "../src/storage.js";

vi.mock("@prometheus-io/client", async (original) => ({
  ...(await original<typeof PrometheusClient>()),
  collectDefaultMetrics: vi.fn(),
}));
const services: SessionService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.close();
});
const settings: SessionSettings = {
  audienceLimit: 100,
  scoringMode: "accuracy",
  resultVisibility: "private",
  allowLateJoin: true,
  nicknamePolicy: "custom",
};

async function fixture(credits = 1) {
  const repository = new MemoryRepository();
  const now = new Date();
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `${randomUUID()}@example.test`,
    segment: "workplace",
    tokenHash,
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const creator = (await repository.consumeMagicToken(tokenHash, now))!;
  const platform = createPlatformRepository(repository);
  const organization = (await platform.getOrganizationForWorkspace(creator.workspaceId))!;
  await platform.grantCredits({
    organizationId: organization.id,
    quantity: credits,
    actorId: creator.userId,
    reason: "test purchase",
    sourceKey: randomUUID(),
  });
  const quiz: QuizDraft = {
    title: "Credit-funded event",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "true_false",
        prompt: "Credits are consumed once.",
        choices: [
          { id: randomUUID(), label: "True", isCorrect: true },
          { id: randomUUID(), label: "False", isCorrect: false },
        ],
        timeLimitSeconds: 20,
        basePoints: 1000,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  const quizId = randomUUID();
  await repository.createQuiz({
    id: quizId,
    workspaceId: creator.workspaceId,
    title: quiz.title,
    description: "",
    status: "draft",
    draft: quiz,
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  await repository.publishQuiz({
    id: randomUUID(),
    workspaceId: creator.workspaceId,
    quizId,
    version: 1,
    content: quiz,
    contentHash: createHash("sha256").update(JSON.stringify(quiz)).digest("hex"),
    publishedAt: now,
  });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    BUSINESS_PLATFORM_ENABLED: "true",
    BUSINESS_EVENT_CREDITS_ENABLED: "true",
    LOG_LEVEL: "silent",
  });
  const service = new SessionService(
    repository,
    new MemorySessionCache(),
    config,
    new MetricsService(),
  );
  services.push(service);
  return { repository, platform, organization, service, creator, quizId, config };
}

describe("live event credit integration", () => {
  it("previews the funded plan's product features without upgrading the workspace", async () => {
    const f = await fixture();
    const features: ProductFeatureRules = {
      uxBeta: { enabled: true, plans: ["free", "pro", "team"] },
      presentations: { enabled: true, plans: ["free", "pro", "team"] },
      presentationRealtime: { enabled: true, plans: ["pro", "team"] },
      liveFlexMode: { enabled: true, plans: ["pro", "team"] },
      roundExperiences: { enabled: true, plans: ["pro", "team"] },
      audiencePulse: { enabled: true, plans: ["free"] },
    };
    await f.platform.saveFeaturePolicy({
      expectedRevision: 0,
      features,
    });
    const built = await buildApp(f.config, {
      repository: f.repository,
      cache: new MemorySessionCache(),
    });
    try {
      const verified = await requestPinAndSignIn(built.app, f.creator.email);
      const cookie = String(verified.headers["set-cookie"]).split(";")[0]!;
      const account = await built.app.inject({
        method: "GET",
        url: "/v1/auth/me",
        headers: { cookie },
      });
      expect(account.json()).toMatchObject({
        entitlements: { plan: "free" },
        productFeatures: {
          presentations: true,
          presentationRealtime: false,
          liveFlexMode: false,
          roundExperiences: false,
          audiencePulse: true,
        },
      });
      const preview = () =>
        built.app.inject({
          method: "GET",
          url: "/v1/workspaces/current/room-funding",
          headers: { cookie },
        });
      const funded = await preview();
      expect(funded.statusCode).toBe(200);
      expect(funded.headers["cache-control"]).toBe("private, no-store");
      expect(funded.json()).toMatchObject({
        enabled: true,
        availableCredits: 1,
        eventEntitlements: { plan: "pro" },
        eventProductFeatures: {
          presentationRealtime: true,
          liveFlexMode: true,
          roundExperiences: true,
          audiencePulse: false,
        },
      });
      expect(
        WorkspaceProductFeaturesSchema.safeParse(funded.json().eventProductFeatures).success,
      ).toBe(true);
      expect(await f.repository.getPlan(f.creator.workspaceId)).toBe("free");
      await f.repository.updateOperationalFeatures({ roundExperiences: false }, randomUUID());
      expect((await preview()).json().eventProductFeatures).toMatchObject({
        roundExperiences: false,
        presentationRealtime: true,
      });
      await f.platform.saveFeaturePolicy({
        expectedRevision: 1,
        features: {
          ...features,
          presentationRealtime: { enabled: false, plans: [] },
        },
      });
      expect((await preview()).json().eventProductFeatures.presentationRealtime).toBe(false);
    } finally {
      await built.app.close();
    }
  });

  it("preserves legacy rollout access for older commercial coverage without feature grants", async () => {
    const f = await fixture();
    f.config.FEATURE_AUDIENCE_PULSE = true;
    f.config.FEATURE_ROOM_CHAT = true;
    f.config.THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST = [f.creator.workspaceId];
    const room = await f.service.createSession(f.creator, f.quizId, settings, {
      useEventCredit: true,
    });
    const coverage = (await f.platform.getRoomCoverage("round", room.sessionId))!;
    const legacyEntitlements = { ...coverage.snapshot };
    delete legacyEntitlements.featureGrants;
    vi.spyOn(f.platform, "getRoomCoverage").mockResolvedValue({
      ...coverage,
      snapshot: legacyEntitlements,
    });
    await f.platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: {
        audiencePulse: { enabled: false, plans: [] },
        roomChat: { enabled: true, plans: ["team"] },
      },
    });
    expect(
      await roomFeatureEnabled(
        f.repository,
        f.config,
        "round",
        room.sessionId,
        f.creator.workspaceId,
        "audiencePulse",
        true,
      ),
    ).toBe(true);
    expect(
      await roomFeatureEnabled(
        f.repository,
        f.config,
        "round",
        room.sessionId,
        f.creator.workspaceId,
        "roomChat",
        true,
      ),
    ).toBe(true);
    expect(
      await roomFeatureEnabled(
        f.repository,
        f.config,
        "round",
        room.sessionId,
        f.creator.workspaceId,
        "audiencePulse",
      ),
    ).toBe(false);
    expect(
      await roomFeatureEnabled(
        f.repository,
        f.config,
        "round",
        room.sessionId,
        f.creator.workspaceId,
        "roomChat",
      ),
    ).toBe(false);
  });
  it("keeps funded feature grants and exact API retries when product access is paused", async () => {
    const f = await fixture();
    await f.platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: {
        roundExperiences: { enabled: true, plans: ["pro"] },
        audiencePulse: { enabled: true, plans: ["pro"] },
        roomChat: { enabled: true, plans: ["pro"] },
        sessionSummaries: { enabled: true, plans: ["pro"] },
      },
    });
    const built = await buildApp(f.config, {
      repository: f.repository,
      cache: new MemorySessionCache(),
    });
    try {
      const verified = await requestPinAndSignIn(built.app, f.creator.email);
      const cookie = String(verified.headers["set-cookie"]).split(";")[0]!;
      const key = randomUUID();
      const create = () =>
        built.app.inject({
          method: "POST",
          url: "/v1/sessions",
          headers: { cookie, "x-idempotency-key": key },
          payload: {
            quizId: f.quizId,
            settings,
            useEventCredit: true,
            experiencePresetOverride: "campus",
            presenterSoundEnabled: true,
          },
        });
      const response = await create();
      expect(response.statusCode).toBe(201);
      const room = response.json();
      expect(room.snapshot.experienceTheme).toMatchObject({
        preset: { id: "campus" },
        soundEnabled: true,
      });
      expect(await f.repository.getPlan(f.creator.workspaceId)).toBe("free");
      expect(await built.interactions.getSettings(room.sessionId, room.hostToken)).toMatchObject({
        capabilities: { audiencePulse: true, roomChat: true },
      });
      const probe = () =>
        built.app.inject({
          method: "GET",
          url: `/v1/session-summaries/features?kind=round&id=${room.sessionId}`,
          headers: { cookie },
        });
      expect((await probe()).json()).toEqual({ enabled: true });
      await f.platform.saveFeaturePolicy({
        expectedRevision: 1,
        features: {
          roundExperiences: { enabled: false, plans: [] },
          audiencePulse: { enabled: false, plans: [] },
          roomChat: { enabled: false, plans: [] },
          sessionSummaries: { enabled: false, plans: [] },
        },
      });
      expect((await create()).json()).toMatchObject({
        sessionId: room.sessionId,
        snapshot: { experienceTheme: { preset: { id: "campus" }, soundEnabled: true } },
      });
      expect(await built.interactions.getSettings(room.sessionId, room.hostToken)).toMatchObject({
        capabilities: { audiencePulse: true, roomChat: true },
      });
      expect((await probe()).json()).toEqual({ enabled: false });
      await f.repository.updateOperationalFeatures(
        { audiencePulse: false, roomChat: false },
        randomUUID(),
      );
      expect(await built.interactions.getSettings(room.sessionId, room.hostToken)).toMatchObject({
        capabilities: { audiencePulse: false, roomChat: false },
      });
      vi.spyOn(f.platform, "getFeaturePolicy").mockRejectedValue(
        new Error("Telemetry policy read failed"),
      );
      const finished = await built.sessions.hostCommand({
        sessionId: room.sessionId,
        hostToken: room.hostToken,
        commandId: randomUUID(),
        expectedVersion: room.snapshot.version,
        action: "end",
      });
      expect(finished.phase).toBe("finished");
    } finally {
      await built.app.close();
    }
  });
  it("rejects password protection before reserving event credits unless credit funding is chosen", async () => {
    const f = await fixture();
    await expect(
      f.service.createSession(
        f.creator,
        f.quizId,
        { ...settings, audienceLimit: 20 },
        { joinPassword: "Protected event" },
      ),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT" });
    expect(await f.platform.getCreditBalance(f.organization.id)).toMatchObject({
      balance: 1,
      reserved: 0,
      available: 1,
    });
  });
  it("keeps an unconsumed reservation and no audience when durable admission fails", async () => {
    const f = await fixture();
    const room = await f.service.createSession(f.creator, f.quizId, settings, {
      useEventCredit: true,
    });
    vi.spyOn(f.repository, "saveSession").mockRejectedValueOnce(new Error("Commit rejected"));
    await expect(f.service.join({ code: room.code, nickname: "First guest" })).rejects.toThrow(
      "Commit rejected",
    );
    expect(await f.repository.getParticipants(room.sessionId)).toHaveLength(0);
    expect(await f.platform.getRoomCoverage("round", room.sessionId)).toMatchObject({
      reservationState: "reserved",
    });
    expect(await f.platform.getCreditBalance(f.organization.id)).toMatchObject({
      balance: 1,
      reserved: 1,
      available: 0,
    });
    await f.service.join({ code: room.code, nickname: "Retry guest" });
    expect(await f.repository.getParticipants(room.sessionId)).toHaveLength(1);
    expect(await f.platform.getCreditBalance(f.organization.id)).toMatchObject({
      balance: 0,
      reserved: 0,
      available: 0,
    });
  });
  it("revokes a departing host while preserving the organization's live room and successor control", async () => {
    const f = await fixture();
    const now = new Date();
    const token = randomUUID();
    await f.repository.createMagicToken({
      id: randomUUID(),
      email: "successor@example.test",
      segment: "workplace",
      tokenHash: token,
      policyVersion: "test",
      consumedAt: null,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const successor = (await f.repository.consumeMagicToken(token, now))!;
    await f.platform.setOrganizationMember({
      organizationId: f.organization.id,
      actorId: f.creator.userId,
      userId: successor.userId,
      role: "owner",
    });
    const invitationToken = randomUUID();
    await f.repository.createWorkspaceInvitation({
      id: randomUUID(),
      workspaceId: f.creator.workspaceId,
      email: successor.email,
      role: "editor",
      tokenHash: invitationToken,
      invitedBy: f.creator.userId,
      expiresAt: new Date(now.getTime() + 60_000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
    });
    await f.repository.acceptWorkspaceInvitation(invitationToken, now, "test");
    await f.platform.transferWorkspaceOwnership(
      f.creator.workspaceId,
      f.creator.userId,
      successor.userId,
    );
    const room = await f.service.createSession(f.creator, f.quizId, settings, {
      useEventCredit: true,
    });
    await f.service.join({ code: room.code, nickname: "Audience stays" });
    await f.repository.deleteUserIdentity(f.creator.userId);
    await expect(
      f.service.hostCommand({
        sessionId: room.sessionId,
        hostToken: room.hostToken,
        commandId: randomUUID(),
        expectedVersion: 1,
        action: "end",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await f.service.join({ code: room.code, nickname: "Another audience member" });
    const creator = (await f.repository.getCreatorByUserId(
      successor.userId,
      f.creator.workspaceId,
    ))!;
    const pass = await f.service.createCreatorControlPass(creator, room.sessionId);
    const current = await f.service.snapshot({
      sessionId: room.sessionId,
      hostToken: pass.token,
      role: "host",
    });
    await f.service.hostCommand({
      sessionId: room.sessionId,
      hostToken: pass.token,
      commandId: randomUUID(),
      expectedVersion: current.version,
      action: "end",
    });
    expect((await f.repository.getSessionById(room.sessionId))!.state.phase).toBe("finished");
  });
  // Four creation hashes and three admission checks use real scrypt on shared CI CPUs.
  it("applies the same funding and retention rules to Presentations", async () => {
    const f = await fixture();
    const presentations = createPresentationRepository(f.repository);
    const sessions = createPresentationSessionRepository(f.repository);
    const now = new Date();
    const id = randomUUID();
    const source = (await f.repository.getQuiz(f.creator.workspaceId, f.quizId))!;
    const sourceVersion = (await f.repository.getQuizVersion(
      f.creator.workspaceId,
      source.currentVersionId!,
    ))!;
    const draft = PresentationDraftSchema.parse({
      title: "One credit presentation",
      description: "",
      schemaVersion: 2,
      experiencePreset: { id: "focus", version: 1 },
      blocks: [
        { id: randomUUID(), kind: "question", question: sourceVersion.content.questions[0] },
      ],
    });
    const content = PresentationContentSchema.parse(draft);
    await presentations.createPresentation({
      id,
      workspaceId: f.creator.workspaceId,
      title: draft.title,
      description: "",
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: f.creator.userId,
      createdAt: now,
      updatedAt: now,
    });
    await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: f.creator.workspaceId,
        presentationId: id,
        version: 1,
        content,
        contentSchemaVersion: 1,
        contentHash: randomUUID(),
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    await f.platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: {
        uxBeta: { enabled: true, plans: ["pro"] },
        presentations: { enabled: true, plans: ["pro"] },
        presentationRealtime: { enabled: true, plans: ["pro"] },
        presentationCompanion: { enabled: true, plans: ["pro"] },
      },
    });
    const service = new PresentationSessionService({
      repository: f.repository,
      presentations,
      sessions,
      config: f.config,
      workspaceEnabled: (workspaceId, planOverride) =>
        workspaceFeatureEnabled(
          f.repository,
          f.config,
          workspaceId,
          "presentationRealtime",
          planOverride,
        ),
      storage: new StorageService(f.config, null),
    });
    const password = "Protected Presentation";
    const createInput = {
      workspaceId: f.creator.workspaceId,
      userId: f.creator.userId,
      presentationId: id,
      useEventCredit: true,
      joinPassword: password,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
    };
    const room = await service.createSession(createInput);
    expect(
      await roomFeatureEnabled(
        f.repository,
        f.config,
        "presentation",
        room.snapshot.sessionId,
        f.creator.workspaceId,
        "presentationCompanion",
      ),
    ).toBe(true);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 1,
      features: { presentationRealtime: { enabled: false, plans: [] } },
    });
    const replay = await service.createSession(createInput);
    expect(replay.snapshot.sessionId).toBe(room.snapshot.sessionId);
    await f.platform.updateOrganizationStatus(f.organization.id, "suspended");
    const pausedReplay = await service.createSession(createInput);
    expect(pausedReplay.snapshot.sessionId).toBe(room.snapshot.sessionId);
    await f.platform.updateOrganizationStatus(f.organization.id, "active");
    await expect(
      service.createSession({ ...createInput, joinPassword: "Another Presentation password" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.join(room.snapshot.code, "Missing password")).rejects.toMatchObject({
      code: "PASSWORD_REQUIRED",
    });
    await expect(
      service.join(room.snapshot.code, "Wrong password", "Wrong password"),
    ).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    const roomId = room.snapshot.sessionId;
    expect(await f.platform.getCreditBalance(f.organization.id)).toMatchObject({ reserved: 1 });
    await Promise.all(
      ["First", "Second"].map((name) => service.join(room.snapshot.code, name, password)),
    );
    expect(await f.platform.getCreditBalance(f.organization.id)).toMatchObject({
      balance: 0,
      reserved: 0,
    });
    expect(
      (await f.platform.listCreditLedger(f.organization.id, f.creator.userId)).filter(
        (entry) => entry.delta === -1,
      ),
    ).toHaveLength(1);
    let current = room.snapshot;
    for (let step = 0; step < 5 && current.phase !== "finished"; step += 1) {
      current = await service.advance({
        workspaceId: f.creator.workspaceId,
        userId: f.creator.userId,
        sessionId: roomId,
        expectedRevision: current.revision,
        requestId: randomUUID(),
      });
    }
    expect(current.phase).toBe("finished");
    expect(
      (await sessions.getSessionById(roomId))!.retentionExpiresAt.getTime() - Date.now(),
    ).toBeGreaterThan(364 * 86_400_000);
  }, 15_000);
  it.each([
    { funding: "credit", change: "disabled" },
    { funding: "subscription", change: "reassigned" },
  ] as const)(
    "retains launched $funding Presentation capabilities when managed features are $change",
    async ({ funding, change }) => {
      const f = await fixture(2);
      if (funding === "subscription") {
        await f.platform.applySubscriptionSnapshot({
          organizationId: f.organization.id,
          customerId: "cus_presentation",
          subscriptionId: "sub_presentation",
          status: "active",
          licenseQuantity: 1,
          offerId: null,
          paidThrough: new Date(Date.now() + 86_400_000),
          graceUntil: null,
          legacyPlan: "pro",
        });
        await f.platform.assignWorkspaceLicense(
          f.organization.id,
          f.creator.userId,
          f.creator.workspaceId,
          true,
        );
      }
      const features: ProductFeatureRules = {
        uxBeta: { enabled: true, plans: ["pro"] },
        presentations: { enabled: true, plans: ["pro"] },
        presentationRealtime: { enabled: true, plans: ["pro"] },
        presentationCompanion: { enabled: true, plans: ["pro"] },
        recoveryPacks: { enabled: true, plans: ["pro"] },
        recoveryPackLiveCards: { enabled: true, plans: ["pro"] },
      };
      await f.platform.saveFeaturePolicy({ expectedRevision: 0, features });
      const presentations = createPresentationRepository(f.repository);
      const packs = createRecoveryPackRepository(f.repository);
      const now = new Date();
      const sourceQuiz = (await f.repository.getQuiz(f.creator.workspaceId, f.quizId))!;
      const source = (await f.repository.getQuizVersion(
        f.creator.workspaceId,
        sourceQuiz.currentVersionId!,
      ))!;
      const question = source.content.questions[0]!;
      const draft = PresentationDraftSchema.parse({
        title: "Retained funded Presentation",
        description: "",
        schemaVersion: 2,
        blocks: [
          {
            id: randomUUID(),
            kind: "content",
            layout: "title_body",
            textElements: [
              { id: "title", role: "title", text: "Continue", region: "top_center", order: 0 },
            ],
            mediaId: null,
            mediaAlt: null,
            speakerNotes: "",
          },
          { id: randomUUID(), kind: "question", question },
        ],
      });
      const presentation = await presentations.createPresentation({
        id: randomUUID(),
        workspaceId: f.creator.workspaceId,
        title: draft.title,
        description: "",
        status: "draft",
        draft,
        draftRevision: 0,
        draftSchemaVersion: 2,
        currentVersionId: null,
        folderId: null,
        publishedDraftRevision: null,
        lastEditedBy: f.creator.userId,
        createdAt: now,
        updatedAt: now,
      });
      const content = PresentationContentSchema.parse(draft);
      await presentations.publishPresentation(
        {
          id: randomUUID(),
          workspaceId: f.creator.workspaceId,
          presentationId: presentation.id,
          version: 1,
          content,
          contentSchemaVersion: 2,
          contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
          sourceDraftRevision: 0,
          publishedAt: now,
        },
        0,
      );
      const packQuestion = {
        ...question,
        purpose: "diagnostic",
        delivery: "main",
        conceptKeys: ["retained.funding"],
        linkedRecheckQuestionId: null,
      };
      const recheck = {
        ...packQuestion,
        id: randomUUID(),
        prompt: "Check the rule in another setting.",
        delivery: "recheck",
      };
      const packContent = RecoveryPackContentSchema.parse({
        title: "Retained published Pack",
        description: "",
        diagnostic: { ...packQuestion, id: randomUUID(), linkedRecheckQuestionId: recheck.id },
        recheck,
        delayedProbe: { ...packQuestion, id: randomUUID(), prompt: "Check the rule again later." },
        interventions: [{ id: randomUUID(), title: "Review", body: "Try again", citations: [] }],
        conceptKeys: ["retained.funding"],
        misconceptionKeys: [],
        citations: [],
      });
      const pack = await packs.createRecoveryPack({
        id: randomUUID(),
        workspaceId: f.creator.workspaceId,
        title: packContent.title,
        description: "",
        draft: packContent,
        draftRevision: 0,
        draftSchemaVersion: 1,
        currentVersionId: null,
        publishedDraftRevision: null,
        lastEditedBy: f.creator.userId,
        createdAt: now,
        updatedAt: now,
      });
      const packVersion = await packs.publishRecoveryPack(
        {
          id: randomUUID(),
          workspaceId: f.creator.workspaceId,
          packId: pack.id,
          version: 1,
          content: packContent,
          contentHash: recoveryPackContentHash(packContent),
          sourceDraftRevision: 0,
          publishedAt: now,
        },
        0,
      );
      const built = await buildApp(f.config, {
        repository: f.repository,
        cache: new MemorySessionCache(),
      });
      try {
        const verified = await requestPinAndSignIn(built.app, f.creator.email);
        const cookie = String(verified.headers["set-cookie"]).split(";")[0]!;
        const service = built.presentationService;
        const create = () =>
          service.createSession({
            workspaceId: f.creator.workspaceId,
            userId: f.creator.userId,
            presentationId: presentation.id,
            useEventCredit: funding === "credit",
            requestId: randomUUID(),
          });
        const issuePass = (sessionId: string) =>
          built.app.inject({
            method: "POST",
            url: `/v1/presentation-sessions/${sessionId}/companion-pass`,
            headers: { cookie },
          });
        const room = await create();
        const sessionId = room.snapshot.sessionId;
        await service.join(room.snapshot.code, "Presentation learner");
        expect(await f.platform.getRoomCoverage("presentation", sessionId)).toMatchObject({
          funding,
          snapshot: {
            plan: "pro",
            featureGrants: { presentationCompanion: true, recoveryPackLiveCards: true },
          },
        });
        const unavailable: NonNullable<ProductFeatureRules["presentationCompanion"]> =
          change === "disabled"
            ? { enabled: false, plans: [] }
            : { enabled: true, plans: ["team"] };
        await f.platform.saveFeaturePolicy({
          expectedRevision: 1,
          features: {
            ...features,
            presentationCompanion: unavailable,
            recoveryPackLiveCards: unavailable,
          },
        });
        const issued = await issuePass(sessionId);
        expect(issued.statusCode).toBe(201);
        const companionToken = issued.json<{ companionToken: string }>().companionToken;
        expect(await service.getCompanionSnapshot(sessionId, companionToken)).toMatchObject({
          canInsertQuickCheck: true,
          canInsertPublishedQuestion: true,
          canInsertRecoveryPack: true,
        });
        expect(await service.getCompanionRecoveryPacks(sessionId, companionToken)).toMatchObject({
          packs: [expect.objectContaining({ packVersionId: packVersion.id })],
        });
        expect(
          await service.getCompanionPublishedQuestions(sessionId, companionToken),
        ).toMatchObject({
          questions: [expect.objectContaining({ sourceQuizVersionId: source.id })],
        });
        const insertionCommands = (
          id: string,
          credential: string,
        ): PresentationCompanionCommand[] => {
          const common = {
            sessionId: id,
            companionToken: credential,
            commandId: randomUUID(),
            expectedRevision: 0,
          };
          return [
            {
              ...common,
              action: "insert_quick_check",
              quickCheck: { prompt: "Ready?", choices: ["Yes", "More time"], timeLimitSeconds: 20 },
            },
            {
              ...common,
              commandId: randomUUID(),
              action: "insert_published_question",
              publishedQuestion: {
                sourceQuizVersionId: source.id,
                sourceQuestionId: question.id,
                contentHash: source.contentHash,
              },
            },
            {
              ...common,
              commandId: randomUUID(),
              action: "insert_recovery_pack",
              packVersionId: packVersion.id,
            },
          ];
        };
        for (const command of insertionCommands(sessionId, companionToken)) {
          const before = (await built.presentationSessions.getSessionById(sessionId))!;
          expect(
            await service.companionCommand({ ...command, expectedRevision: before.revision }),
          ).toMatchObject({ phase: "question_open", revision: before.revision + 1 });
          expect(
            (await built.presentationSessions.getSessionById(sessionId))!.content.blocks,
          ).toHaveLength(
            before.content.blocks.length + (command.action === "insert_recovery_pack" ? 2 : 1),
          );
          if (command.action !== "insert_recovery_pack") {
            const current = (await built.presentationSessions.getSessionById(sessionId))!;
            await service.command({
              sessionId,
              controlToken: room.controlToken,
              commandId: randomUUID(),
              expectedRevision: current.revision,
              action: "advance",
            });
          }
        }

        const newRoom = await create();
        const newSessionId = newRoom.snapshot.sessionId;
        expect(await f.platform.getRoomCoverage("presentation", newSessionId)).toMatchObject({
          snapshot: {
            featureGrants: { presentationCompanion: false, recoveryPackLiveCards: false },
          },
        });
        expect((await issuePass(newSessionId)).statusCode).toBe(404);
        // A valid credential cannot add capabilities absent from this room's launch grant.
        const newPass = await service.createCompanionPass({
          workspaceId: f.creator.workspaceId,
          userId: f.creator.userId,
          sessionId: newSessionId,
          requestId: randomUUID(),
        });
        for (const reenabled of [false, true]) {
          if (reenabled) await f.platform.saveFeaturePolicy({ expectedRevision: 2, features });
          expect((await issuePass(newSessionId)).statusCode).toBe(404);
          expect(
            await service.getCompanionSnapshot(newSessionId, newPass.companionToken),
          ).toMatchObject({
            canInsertQuickCheck: false,
            canInsertPublishedQuestion: false,
            canInsertRecoveryPack: false,
          });
          await expect(
            service.getCompanionPublishedQuestions(newSessionId, newPass.companionToken),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
          await expect(
            service.getCompanionRecoveryPacks(newSessionId, newPass.companionToken),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
          const before = await built.presentationSessions.getSessionById(newSessionId);
          for (const command of insertionCommands(newSessionId, newPass.companionToken)) {
            await expect(service.companionCommand(command)).rejects.toMatchObject({
              code: "NOT_FOUND",
            });
          }
          expect(await built.presentationSessions.getSessionById(newSessionId)).toEqual(before);
          expect(await built.presentationSessions.listTimeline(newSessionId)).toEqual([]);
        }
        expect(await f.repository.getPlan(f.creator.workspaceId)).toBe(
          funding === "credit" ? "free" : "pro",
        );
      } finally {
        await built.app.close();
      }
    },
  );
  it("reserves one credit across competing rooms without upgrading the workspace", async () => {
    const f = await fixture();
    const rooms = await Promise.allSettled(
      [1, 2].map(() =>
        f.service.createSession(f.creator, f.quizId, settings, { useEventCredit: true }),
      ),
    );
    expect(rooms.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await f.platform.getCreditBalance(f.organization.id)).toMatchObject({
      balance: 1,
      reserved: 1,
      available: 0,
    });
    expect(await f.repository.getPlan(f.creator.workspaceId)).toBe("free");
  });

  it("charges a joined batch once, supports retries, and freezes report retention", async () => {
    const f = await fixture();
    const key = randomUUID();
    const password = "Protected Round";
    const room = await f.service.createSession(f.creator, f.quizId, settings, {
      useEventCredit: true,
      joinPassword: password,
      idempotencyKey: key,
    });
    const replay = await f.service.createSession(f.creator, f.quizId, settings, {
      useEventCredit: true,
      joinPassword: password,
      idempotencyKey: key,
    });
    expect(replay.sessionId).toBe(room.sessionId);
    await f.platform.updateOrganizationStatus(f.organization.id, "suspended");
    const pausedReplay = await f.service.createSession(f.creator, f.quizId, settings, {
      useEventCredit: true,
      joinPassword: password,
      idempotencyKey: key,
    });
    expect(pausedReplay.sessionId).toBe(room.sessionId);
    await f.platform.updateOrganizationStatus(f.organization.id, "active");
    await expect(
      f.service.createSession(
        f.creator,
        f.quizId,
        { ...settings, audienceLimit: 99 },
        { useEventCredit: true, joinPassword: password, idempotencyKey: key },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.service.createSession(f.creator, f.quizId, settings, {
        useEventCredit: true,
        joinPassword: "Different password",
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.service.join({ code: room.code, nickname: "Missing" })).rejects.toMatchObject({
      code: "PASSWORD_REQUIRED",
    });
    await expect(
      f.service.join({ code: room.code, nickname: "Wrong", password: "wrong password" }),
    ).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    expect(await f.platform.getCreditBalance(f.organization.id)).toMatchObject({
      balance: 1,
      reserved: 1,
    });
    const joined = await Promise.all(
      ["First", "Second"].map((nickname) =>
        f.service.join({ code: room.code, nickname, password }),
      ),
    );
    expect(await f.platform.getCreditBalance(f.organization.id)).toMatchObject({
      balance: 0,
      reserved: 0,
    });
    await f.service.join({ code: room.code, resumeToken: joined[0]!.participantToken });
    const ledger = await f.platform.listCreditLedger(f.organization.id, f.creator.userId);
    expect(ledger.filter((entry) => entry.delta === -1)).toHaveLength(1);
    const cohost = await f.service.createSessionStaffCredential(f.creator, room.sessionId, {
      role: "cohost",
      label: "Event cohost",
      expiresInMinutes: 15,
    });
    expect(cohost.token).toBeTruthy();
    const current = await f.service.snapshot({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      role: "host",
    });
    await f.service.hostCommand({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      commandId: randomUUID(),
      expectedVersion: current.version,
      action: "end",
    });
    const stored = (await f.repository.getSessionById(room.sessionId))!;
    expect(stored.retentionExpiresAt.getTime() - Date.now()).toBeGreaterThan(364 * 86_400_000);
    await f.repository.deleteSession(f.creator.workspaceId, room.sessionId);
    expect(await f.platform.getCreditBalance(f.organization.id)).toMatchObject({
      balance: 0,
      reserved: 0,
    });
  });

  it("returns an empty canceled reservation and separates pause from admission restriction", async () => {
    const f = await fixture();
    const room = await f.service.createSession(f.creator, f.quizId, settings, {
      useEventCredit: true,
    });
    await f.service.hostCommand({
      sessionId: room.sessionId,
      hostToken: room.hostToken,
      commandId: randomUUID(),
      expectedVersion: room.snapshot.version,
      action: "end",
    });
    expect(await f.platform.getCreditBalance(f.organization.id)).toMatchObject({
      balance: 1,
      reserved: 0,
    });
    const active = await f.service.createSession(f.creator, f.quizId, settings, {
      useEventCredit: true,
    });
    await f.platform.updateOrganizationStatus(f.organization.id, "suspended");
    await expect(
      f.service.createSession(f.creator, f.quizId, settings, { useEventCredit: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.service.join({ code: active.code, nickname: "Allowed in existing room" });
    await f.platform.setWorkspaceAdmissionRestriction(f.creator.workspaceId, true);
    await expect(f.service.join({ code: active.code, nickname: "Blocked" })).rejects.toMatchObject({
      code: "ADMISSION_RESTRICTED",
    });
  });
});
