import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as PrometheusClient from "@prometheus-io/client";
import {
  MemoryRepository,
  createPlatformRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
} from "@openround/db";
import { PresentationDraftSchema, PresentationContentSchema } from "@openround/contracts";
import type { QuizDraft, SessionSettings } from "@openround/contracts";
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
    contentHash: randomUUID(),
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
    const service = new PresentationSessionService({
      repository: f.repository,
      presentations,
      sessions,
      config: f.config,
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
  });
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
