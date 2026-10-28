import { randomUUID } from "node:crypto";
import type * as PrometheusClient from "@prometheus-io/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuizDraft, Report } from "@openround/contracts";
import {
  MemoryRepository,
  WorkspaceDeletionInProgressError,
  type ParticipantRecord,
  type StoredSession,
} from "@openround/db";
import {
  addParticipant,
  applyHostCommand,
  avatarIdForSeed,
  createGameState,
} from "@openround/game-engine";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import { ProductEventDispatcher } from "../src/product-events.js";
import { hashToken } from "../src/security.js";
import { SessionService } from "../src/session-service.js";
import * as roomPasswords from "../src/room-password.js";

// Process collectors keep sampling intervals alive across fake/real clock transitions. Their
// hrtime catch-up loop can block the worker; these ordering tests need only service metrics.
vi.mock("@prometheus-io/client", async (importOriginal) => ({
  ...(await importOriginal<typeof PrometheusClient>()),
  collectDefaultMetrics: vi.fn(),
}));

const config = ConfigSchema.parse({
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  COMMUNITY_MODE: "false",
  WEB_ORIGIN: "http://localhost:3000",
  PUBLIC_API_URL: "http://localhost:4000",
  LOG_LEVEL: "silent",
});

function quizFixture(): { quiz: QuizDraft; correctChoiceId: string } {
  const correctChoiceId = randomUUID();
  return {
    correctChoiceId,
    quiz: {
      title: "Session service fixture",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "true_false",
          prompt: "Durable answers are accepted before the deadline.",
          choices: [
            { id: correctChoiceId, label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    },
  };
}

function storedSession(input: {
  state: ReturnType<typeof createGameState>;
  hostToken: string;
}): StoredSession {
  const now = new Date();
  return {
    id: input.state.sessionId,
    workspaceId: randomUUID(),
    quizVersionId: randomUUID(),
    hostId: randomUUID(),
    hostTokenHash: hashToken(input.hostToken),
    state: input.state,
    expiresAt: new Date(now.getTime() + 60_000),
    retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    createdAt: now,
    updatedAt: now,
  };
}

async function hostedRoundFixture() {
  const repository = new MemoryRepository();
  const cache = new MemorySessionCache();
  const service = new SessionService(repository, cache, config, new MetricsService());
  const tokenHash = `deletion-race-${randomUUID()}`;
  const now = new Date();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `deletion-race-${randomUUID()}@example.com`,
    segment: "workplace",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const creator = await repository.consumeMagicToken(tokenHash, now);
  if (!creator) throw new Error("Could not create deletion-race owner");
  const { quiz } = quizFixture();
  const quizRecord = await repository.createQuiz({
    id: randomUUID(),
    workspaceId: creator.workspaceId,
    title: quiz.title,
    description: quiz.description,
    status: "draft",
    draft: quiz,
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  await repository.publishQuiz({
    id: randomUUID(),
    workspaceId: creator.workspaceId,
    quizId: quizRecord.id,
    version: 1,
    content: quiz,
    contentHash: randomUUID(),
    publishedAt: now,
  });
  return { repository, cache, service, creator, quizId: quizRecord.id };
}

async function openQuestionFixture(participantCount: number) {
  const repository = new MemoryRepository();
  const service = new SessionService(
    repository,
    new MemorySessionCache(),
    config,
    new MetricsService(),
  );
  const { quiz, correctChoiceId } = quizFixture();
  const sessionId = randomUUID();
  const hostToken = "host-answer-batch-token-long-enough";
  const participantInputs = Array.from({ length: participantCount }, (_, index) => ({
    id: randomUUID(),
    nickname: `Learner ${index + 1}`,
    token: `answer-batch-token-${index}-${randomUUID()}`,
  }));
  let state = createGameState({
    sessionId,
    code: "3456789",
    quiz,
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    },
  });
  for (const participant of participantInputs) {
    state = addParticipant(state, {
      id: participant.id,
      nickname: participant.nickname,
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
  }
  state = applyHostCommand(state, {
    commandId: randomUUID(),
    expectedVersion: state.version,
    action: "start",
    nowMs: Date.now(),
    newRoundId: randomUUID,
  }).state;
  await repository.createSession(storedSession({ state, hostToken }));
  for (const participant of participantInputs) {
    await repository.createParticipant({
      id: participant.id,
      sessionId,
      nickname: participant.nickname,
      tokenHash: hashToken(participant.token),
      status: "active",
      joinedAt: new Date(),
    });
  }
  await service.snapshot({ sessionId, hostToken, role: "host" });
  return { correctChoiceId, hostToken, participantInputs, repository, service, sessionId, state };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("session service ordering", () => {
  // Five real scrypt derivations exercise exact-password and resume boundaries on shared CI CPUs.
  it("gates protected creation and keeps password admission frozen across downgrade and resume", async () => {
    const { repository, service, creator, quizId } = await hostedRoundFixture();
    const settings = {
      audienceLimit: 20,
      scoringMode: "accuracy" as const,
      resultVisibility: "private" as const,
      allowLateJoin: true,
      nicknamePolicy: "custom" as const,
    };
    const password = " Exact room password ";
    const create = vi.spyOn(repository, "createSession");
    await expect(
      service.createSession(creator, quizId, settings, { joinPassword: password }),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_LIMIT" });
    expect(create).not.toHaveBeenCalled();
    const open = await service.createSession(creator, quizId, settings);
    await expect(service.join({ code: open.code, nickname: "Open" })).resolves.toHaveProperty(
      "participantId",
    );
    expect(await service.preflightJoin({ code: open.code })).toMatchObject({
      passwordRequired: false,
    });
    await repository.setPlan(creator.workspaceId, "pro");
    const hosted = await service.createSession(creator, quizId, settings, {
      joinPassword: password,
    });
    const stored = await repository.getSessionById(hosted.sessionId);
    expect(stored?.joinPasswordHash).toBeTruthy();
    expect(stored?.joinPasswordHash).not.toBe(password);
    const preflight = await service.preflightJoin({ code: hosted.code });
    expect(preflight).toEqual({ nicknamePolicy: "custom", passwordRequired: true });
    for (const [supplied, code] of [
      [undefined, "PASSWORD_REQUIRED"],
      [password.trim(), "INVALID_PASSWORD"],
      [password.toLowerCase(), "INVALID_PASSWORD"],
    ] as const) {
      await expect(
        service.join({
          code: hosted.code,
          nickname: "New",
          ...(supplied === undefined ? {} : { password: supplied }),
        }),
      ).rejects.toMatchObject({ code });
    }
    expect(
      Object.keys((await repository.getSessionById(hosted.sessionId))!.state.participants),
    ).toHaveLength(0);
    const joined = await service.join({ code: hosted.code, nickname: "River", password });
    for (const value of [hosted, joined, preflight]) {
      expect(JSON.stringify(value)).not.toContain(password);
      expect(JSON.stringify(value)).not.toContain(stored!.joinPasswordHash!);
      expect(JSON.stringify(value)).not.toContain("joinPasswordHash");
    }
    await repository.setPlan(creator.workspaceId, "free");
    await expect(service.join({ code: hosted.code, nickname: "Next" })).rejects.toMatchObject({
      code: "PASSWORD_REQUIRED",
    });
    const resumed = await service.join({ code: hosted.code, resumeToken: joined.participantToken });
    expect(resumed.participantId).toBe(joined.participantId);
    await expect(
      service.join({ code: hosted.code, nickname: "Next", password }),
    ).resolves.toHaveProperty("participantId");
    service.close();
  }, 15_000);

  it("allows Community rooms to use their effective paid protection", async () => {
    const {
      repository,
      cache,
      service: previousService,
      creator,
      quizId,
    } = await hostedRoundFixture();
    const communityConfig = { ...config, COMMUNITY_MODE: true };
    const service = new SessionService(repository, cache, communityConfig, new MetricsService());
    const hosted = await service.createSession(
      creator,
      quizId,
      {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
      { joinPassword: "Community password" },
    );
    expect(await repository.getPlan(creator.workspaceId)).toBe("free");
    await expect(
      service.join({ code: hosted.code, nickname: "River", password: "Community password" }),
    ).resolves.toHaveProperty("participantId");
    service.close();
    previousService.close();
  });

  it("admits a maximum protected burst with one shared password verification per batch", async () => {
    const {
      repository,
      cache,
      service: defaultService,
      creator,
      quizId,
    } = await hostedRoundFixture();
    defaultService.close();
    const service = new SessionService(
      repository,
      cache,
      { ...config, MAX_SESSION_PARTICIPANTS: 250 },
      new MetricsService(),
    );
    await repository.setPlan(creator.workspaceId, "team");
    const password = " Exact synchronized room ";
    const hosted = await service.createSession(
      creator,
      quizId,
      {
        audienceLimit: 250,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
      { joinPassword: password },
    );
    const verify = vi.spyOn(roomPasswords, "verifyRoomPassword");
    const joined = await Promise.all(
      Array.from({ length: 250 }, (_, index) =>
        service.join({
          code: hosted.code,
          nickname: `Learner ${index + 1}`,
          password,
        }),
      ),
    );
    expect(joined).toHaveLength(250);
    expect(new Set(joined.map((participant) => participant.participantId)).size).toBe(250);
    expect(verify).toHaveBeenCalledExactlyOnceWith(password, expect.any(String));
    expect(await repository.getParticipants(hosted.sessionId)).toHaveLength(250);
    await expect(
      service.join({ code: hosted.code, nickname: "Late learner", password }),
    ).rejects.toMatchObject({ code: "SESSION_FULL" });
    expect(verify).toHaveBeenCalledTimes(2);
    service.close();
  });

  it("starts distinct batch password checks together and keeps failed guests outside the room", async () => {
    const { repository, service, creator, quizId } = await hostedRoundFixture();
    await repository.setPlan(creator.workspaceId, "pro");
    const password = " Exact concurrent room ";
    const hosted = await service.createSession(
      creator,
      quizId,
      {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
      { joinPassword: password },
    );
    let releaseVerification!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const realVerify = roomPasswords.verifyRoomPassword;
    const verify = vi
      .spyOn(roomPasswords, "verifyRoomPassword")
      .mockImplementation(async (...input) => {
        await blocked;
        return realVerify(...input);
      });
    const inputs = [password, password.trim(), password, password.toLowerCase(), undefined, ""];
    const pending = Promise.allSettled(
      inputs.map((supplied, index) =>
        service.join({
          code: hosted.code,
          nickname: `Learner ${index + 1}`,
          ...(supplied === undefined ? {} : { password: supplied }),
        }),
      ),
    );
    try {
      await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(3));
      expect(await repository.getParticipants(hosted.sessionId)).toHaveLength(0);
      // Host mutation remains available while the independent verification work is pending.
      await service.hostCommand({
        sessionId: hosted.sessionId,
        hostToken: hosted.hostToken,
        commandId: randomUUID(),
        expectedVersion: hosted.snapshot.version,
        action: "lock_lobby",
      });
    } finally {
      releaseVerification();
    }
    const settled = await pending;
    expect(
      settled.map((result) => (result.status === "rejected" ? result.reason.code : "admitted")),
    ).toEqual([
      "SESSION_LOCKED",
      "INVALID_PASSWORD",
      "SESSION_LOCKED",
      "INVALID_PASSWORD",
      "PASSWORD_REQUIRED",
      "PASSWORD_REQUIRED",
    ]);
    expect(await repository.getParticipants(hosted.sessionId)).toHaveLength(0);
    expect(verify.mock.calls.map(([supplied]) => supplied)).toEqual([
      password,
      password.trim(),
      password.toLowerCase(),
    ]);
    service.close();
  });

  it.each([undefined, " Exact duplicate-nickname room "])(
    "admits and disambiguates eleven legitimate duplicate nicknames with password %j",
    async (password) => {
      const { repository, service, creator, quizId } = await hostedRoundFixture();
      try {
        await repository.setPlan(creator.workspaceId, "pro");
        const hosted = await service.createSession(
          creator,
          quizId,
          {
            audienceLimit: 20,
            scoringMode: "accuracy",
            resultVisibility: "private",
            allowLateJoin: true,
            nicknamePolicy: "custom",
          },
          password === undefined ? {} : { joinPassword: password },
        );
        const joined = await Promise.all(
          Array.from({ length: 11 }, () =>
            service.join({
              code: hosted.code,
              nickname: "River",
              ...(password === undefined ? {} : { password }),
            }),
          ),
        );
        expect(new Set(joined.map((participant) => participant.participantId)).size).toBe(11);
        const participants = await repository.getParticipants(hosted.sessionId);
        expect(participants).toHaveLength(11);
        expect(new Set(participants.map((participant) => participant.nickname))).toEqual(
          new Set(["River", ...Array.from({ length: 10 }, (_, index) => `River ${index + 2}`)]),
        );
      } finally {
        service.close();
      }
    },
  );

  it("keeps a nickname available to a legitimate joiner after ten incorrect password attempts", async () => {
    const { repository, service, creator, quizId } = await hostedRoundFixture();
    try {
      await repository.setPlan(creator.workspaceId, "pro");
      const password = " Exact legitimate room ";
      const hosted = await service.createSession(
        creator,
        quizId,
        {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "custom",
        },
        { joinPassword: password },
      );
      const failed = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          service.join({
            code: hosted.code,
            nickname: "River",
            password: "Incorrect room password",
          }),
        ),
      );
      expect(
        failed.map((result) => (result.status === "rejected" ? result.reason.code : "admitted")),
      ).toEqual(Array.from({ length: 10 }, () => "INVALID_PASSWORD"));
      expect(await repository.getParticipants(hosted.sessionId)).toHaveLength(0);
      const joined = await service.join({ code: hosted.code, nickname: "River", password });
      expect(await repository.getParticipants(hosted.sessionId)).toMatchObject([
        { id: joined.participantId, nickname: "River" },
      ]);
    } finally {
      service.close();
    }
  });

  it("shares the six-hundred-attempt room budget between service instances before password verification", async () => {
    const { repository, cache, service, creator, quizId } = await hostedRoundFixture();
    const otherService = new SessionService(repository, cache, config, new MetricsService());
    try {
      await repository.setPlan(creator.workspaceId, "pro");
      const password = " Exact shared-budget room ";
      const hosted = await service.createSession(
        creator,
        quizId,
        {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "custom",
        },
        { joinPassword: password },
      );
      const verify = vi.spyOn(roomPasswords, "verifyRoomPassword");
      const failed = await Promise.allSettled(
        Array.from({ length: 600 }, (_, index) =>
          (index % 2 === 0 ? service : otherService).join({
            code: hosted.code,
            nickname: "River",
            password: "Incorrect room password",
          }),
        ),
      );
      expect(
        failed.map((result) => (result.status === "rejected" ? result.reason.code : "admitted")),
      ).toEqual(Array.from({ length: 600 }, () => "INVALID_PASSWORD"));
      const verificationCalls = verify.mock.calls.length;
      for (const instance of [service, otherService]) {
        await expect(
          instance.join({ code: hosted.code, nickname: "River", password }),
        ).rejects.toMatchObject({ code: "RATE_LIMITED" });
      }
      expect(verify).toHaveBeenCalledTimes(verificationCalls);
      expect(await repository.getParticipants(hosted.sessionId)).toHaveLength(0);
    } finally {
      service.close();
      otherService.close();
    }
  });

  it("uses the shared admission budget before verifying protected join attempts", async () => {
    const { repository, cache, service, creator, quizId } = await hostedRoundFixture();
    await repository.setPlan(creator.workspaceId, "pro");
    const hosted = await service.createSession(
      creator,
      quizId,
      {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
      { joinPassword: "Room password" },
    );
    vi.spyOn(cache, "consumeRateLimit").mockResolvedValue(false);
    await expect(service.join({ code: hosted.code, nickname: "River" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(
      Object.keys((await repository.getSessionById(hosted.sessionId))!.state.participants),
    ).toHaveLength(0);
    service.close();
  });

  it("gates new flex rooms while keeping existing rooms readable after the flag is disabled", async () => {
    const { repository, cache, service, creator, quizId } = await hostedRoundFixture();
    const settings = {
      audienceLimit: 20,
      timeMode: "flex" as const,
      scoringMode: "speed" as const,
      resultVisibility: "private" as const,
      allowLateJoin: true,
      nicknamePolicy: "custom" as const,
    };
    await expect(service.createSession(creator, quizId, settings)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const enabledConfig = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      FEATURE_LIVE_FLEX_MODE: "true",
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: creator.workspaceId,
    });
    const enabled = new SessionService(repository, cache, enabledConfig, new MetricsService());
    const hosted = await enabled.createSession(creator, quizId, settings);
    expect(hosted.snapshot.settings).toMatchObject({
      timeMode: "flex",
      scoringMode: "accuracy",
    });
    const started = await enabled.hostCommand({
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      commandId: randomUUID(),
      expectedVersion: hosted.snapshot.version,
      action: "start",
    });
    expect(started.deadline).toBeNull();
    expect(
      (enabled as unknown as { timers: Map<string, unknown> }).timers.has(hosted.sessionId),
    ).toBe(false);
    const disabled = new SessionService(repository, cache, config, new MetricsService());
    expect(
      await disabled.snapshot({ sessionId: hosted.sessionId, hostToken: hosted.hostToken }),
    ).toMatchObject({ settings: { timeMode: "flex" }, deadline: null });
    expect(
      await disabled.hostCommand({
        sessionId: hosted.sessionId,
        hostToken: hosted.hostToken,
        commandId: randomUUID(),
        expectedVersion: started.version,
        action: "lock",
      }),
    ).toMatchObject({ phase: "question_locked", settings: { timeMode: "flex" } });
    enabled.close();
    disabled.close();
    service.close();
  });

  it("freezes the allowlisted replay feature at session creation and captures later commands", async () => {
    const { repository, creator, quizId } = await hostedRoundFixture();
    const replayConfig = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      FEATURE_DECISION_REPLAY: "true",
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: creator.workspaceId,
    });
    const service = new SessionService(
      repository,
      new MemorySessionCache(),
      replayConfig,
      new MetricsService(),
    );
    const hosted = await service.createSession(creator, quizId, {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    });
    expect(await repository.getSessionById(hosted.sessionId)).toMatchObject({
      decisionReplayEnabled: true,
    });

    const started = await service.hostCommand({
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      commandId: randomUUID(),
      expectedVersion: hosted.snapshot.version,
      action: "start",
    });
    const locked = await service.hostCommand({
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      commandId: randomUUID(),
      expectedVersion: started.version,
      action: "lock",
    });
    expect(
      await repository.getSessionEvidence(creator.workspaceId, hosted.sessionId),
    ).toMatchObject({
      decisionReplayEnabled: true,
      decisionEvents: [
        expect.objectContaining({
          type: "insight_shown",
          sampleSize: 0,
          recommendationCode: "insufficient_sample",
        }),
      ],
    });
    const revealed = await service.hostCommand({
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      commandId: randomUUID(),
      expectedVersion: locked.version,
      action: "reveal",
    });
    await service.hostCommand({
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      commandId: randomUUID(),
      expectedVersion: revealed.version,
      action: "next",
    });
    expect(
      await repository.getReportBySession(creator.workspaceId, hosted.sessionId),
    ).toMatchObject({
      schemaVersion: 4,
      status: "pending",
      decisionReplayAvailable: false,
      decisionTimeline: [],
    });
    service.close();
  });

  it("reserves PostgreSQL capacity while synchronized rooms commit answers", async () => {
    const service = new SessionService(
      new MemoryRepository(),
      new MemorySessionCache(),
      config,
      new MetricsService(),
    );
    const commitGate = service as unknown as {
      withAnswerCommitSlot<T>(work: () => Promise<T>): Promise<T>;
    };
    let releaseCommits!: () => void;
    const commitsBlocked = new Promise<void>((resolve) => {
      releaseCommits = resolve;
    });
    let activeCommits = 0;
    let maximumActiveCommits = 0;
    const commits = Array.from({ length: 11 }, () =>
      commitGate.withAnswerCommitSlot(async () => {
        activeCommits += 1;
        maximumActiveCommits = Math.max(maximumActiveCommits, activeCommits);
        await commitsBlocked;
        activeCommits -= 1;
      }),
    );

    await vi.waitFor(() => expect(activeCommits).toBe(10));
    expect(maximumActiveCommits).toBe(10);
    releaseCommits();
    await Promise.all(commits);
    expect(activeCommits).toBe(0);
    service.close();
  });

  it("waits for in-flight creation publication before account-deletion invalidation", async () => {
    const { repository, cache, service, creator, quizId } = await hostedRoundFixture();
    const originalSet = cache.set.bind(cache);
    let markSetStarted!: () => void;
    let releaseSet!: () => void;
    const setStarted = new Promise<void>((resolve) => {
      markSetStarted = resolve;
    });
    const setBlocked = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    vi.spyOn(cache, "set").mockImplementation(async (state, ttlSeconds) => {
      markSetStarted();
      await setBlocked;
      await originalSet(state, ttlSeconds);
    });

    const creation = service.createSession(creator, quizId, {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    });
    await setStarted;
    await repository.claimWorkspaceMediaDeletion(creator.workspaceId, new Date());
    const targets = await repository.listSessionInvalidationTargets(creator.workspaceId);
    expect(targets).toHaveLength(1);
    const invalidation = service.invalidateWorkspaceDeletion(targets);

    releaseSet();
    const hosted = await creation;
    await invalidation;

    expect(await cache.get(hosted.sessionId)).toBeNull();
    expect(
      (service as unknown as { active: Map<string, unknown> }).active.has(hosted.sessionId),
    ).toBe(false);
    expect(await cache.reserveSessionCode(hosted.code, "probe-owner", 1_000)).toBe(true);
    await cache.releaseSessionCode(hosted.code, "probe-owner");
    service.close();
  });

  it("waits for a post-commit mutation before account-deletion invalidation", async () => {
    const { repository, cache, service, creator, quizId } = await hostedRoundFixture();
    const hosted = await service.createSession(creator, quizId, {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    });
    const originalSave = repository.saveSession.bind(repository);
    let markSaveCommitted!: () => void;
    let releaseSave!: () => void;
    const saveCommitted = new Promise<void>((resolve) => {
      markSaveCommitted = resolve;
    });
    const saveBlocked = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    vi.spyOn(repository, "saveSession").mockImplementation(
      async (session, expectedVersion, report) => {
        await originalSave(session, expectedVersion, report);
        markSaveCommitted();
        await saveBlocked;
      },
    );
    const command = service.hostCommand({
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      commandId: randomUUID(),
      expectedVersion: hosted.snapshot.version,
      action: "start",
    });
    await saveCommitted;
    await repository.claimWorkspaceMediaDeletion(creator.workspaceId, new Date());
    const targets = await repository.listSessionInvalidationTargets(creator.workspaceId);
    const invalidation = service.invalidateWorkspaceDeletion(targets);

    releaseSave();
    await command;
    await invalidation;

    expect(await cache.get(hosted.sessionId)).toBeNull();
    expect(
      (service as unknown as { active: Map<string, unknown> }).active.has(hosted.sessionId),
    ).toBe(false);
    expect(await cache.reserveSessionCode(hosted.code, "probe-owner", 1_000)).toBe(true);
    await cache.releaseSessionCode(hosted.code, "probe-owner");
    service.close();
  });

  it("maps a deletion-fenced participant commit to a stable join conflict", async () => {
    const { repository, service, creator, quizId } = await hostedRoundFixture();
    const hosted = await service.createSession(creator, quizId, {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    });
    vi.spyOn(repository, "commitParticipants").mockRejectedValueOnce(
      new WorkspaceDeletionInProgressError(creator.workspaceId),
    );

    await expect(
      service.join({ code: hosted.code, nickname: "Late learner" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await repository.getParticipants(hosted.sessionId)).toEqual([]);
    service.close();
  });

  it("maps a deletion-fenced answer commit to a stable response conflict", async () => {
    const { correctChoiceId, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(1);
    const persisted = await repository.getSessionById(sessionId);
    vi.spyOn(repository, "commitAnswers").mockRejectedValueOnce(
      new WorkspaceDeletionInProgressError(persisted!.workspaceId),
    );

    await expect(
      service.answer({
        sessionId,
        participantToken: participantInputs[0]!.token,
        roundId: state.roundId!,
        choiceId: correctChoiceId,
        idempotencyKey: "deletion-fenced-answer",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repository.answers.size).toBe(0);
    service.close();
  });

  it("does not admit anonymous code-entry participants when institution identity is required", async () => {
    const repository = new MemoryRepository();
    const cache = new MemorySessionCache();
    const service = new SessionService(repository, cache, config, new MetricsService());
    const { quiz } = quizFixture();
    const state = createGameState({
      sessionId: randomUUID(),
      code: "7654321",
      quiz,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    const stored = storedSession({ state, hostToken: "host-token-long-enough-for-test" });
    await repository.createSession(stored);
    repository.institutionPolicies.set(stored.workspaceId, {
      workspaceId: stored.workspaceId,
      contractStatus: "pilot",
      identityRequirement: "institution",
      capabilities: {
        oidc: false,
        managedSso: false,
        scim: false,
        lti: true,
        nrps: false,
        ags: false,
        auditExports: true,
        residencyControls: true,
      },
      k12Enabled: false,
      updatedAt: new Date(),
    });
    const sessionLookup = vi.spyOn(repository, "getSessionByCode");
    const policyLookup = vi.spyOn(repository, "getInstitutionPolicy");

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        service.join({ code: "7654321", nickname: `Anonymous learner ${index + 1}` }),
      ),
    );

    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "INSTITUTION_AUTH_REQUIRED" });
      }
    }
    expect(sessionLookup).toHaveBeenCalledTimes(1);
    expect(policyLookup).toHaveBeenCalledTimes(1);
    expect(repository.participants.size).toBe(0);
    service.close();
  });

  it("coalesces session and policy lookups for concurrent code joins", async () => {
    const repository = new MemoryRepository();
    const cache = new MemorySessionCache();
    const service = new SessionService(repository, cache, config, new MetricsService());
    const { quiz } = quizFixture();
    const state = createGameState({
      sessionId: randomUUID(),
      code: "8765432",
      quiz,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    await repository.createSession(
      storedSession({ state, hostToken: "host-token-long-enough-for-test" }),
    );
    const sessionLookup = vi.spyOn(repository, "getSessionByCode");
    const policyLookup = vi.spyOn(repository, "getInstitutionPolicy");

    const joined = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        service.join({ code: "8765432", nickname: `Learner ${index + 1}` }),
      ),
    );

    expect(new Set(joined.map(({ participantId }) => participantId)).size).toBe(20);
    expect(sessionLookup).toHaveBeenCalledTimes(1);
    expect(policyLookup).toHaveBeenCalledTimes(1);
    service.close();
  });

  it("persists selected and deterministic fallback avatars across reconnect", async () => {
    const repository = new MemoryRepository();
    const service = new SessionService(
      repository,
      new MemorySessionCache(),
      config,
      new MetricsService(),
    );
    const { quiz } = quizFixture();
    const hostToken = "avatar-host-token-long-enough";
    const state = createGameState({
      sessionId: randomUUID(),
      code: "1122334",
      quiz,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    await repository.createSession(storedSession({ state, hostToken }));

    const selected = await service.join({
      code: state.code,
      nickname: "Selected avatar",
      avatarId: "owl",
    });
    expect(
      selected.snapshot.participants.find(({ id }) => id === selected.participantId),
    ).toMatchObject({ avatarId: "owl" });

    const fallback = await service.join({ code: state.code, nickname: "Fallback avatar" });
    const expectedFallback = avatarIdForSeed(fallback.participantId);
    expect(
      fallback.snapshot.participants.find(({ id }) => id === fallback.participantId),
    ).toMatchObject({ avatarId: expectedFallback });

    const resumed = await service.join({
      code: state.code,
      resumeToken: fallback.participantToken,
      avatarId: "fox",
    });
    expect(
      resumed.snapshot.participants.find(({ id }) => id === fallback.participantId),
    ).toMatchObject({ avatarId: expectedFallback });
    expect(
      (
        await service.snapshot({
          sessionId: state.sessionId,
          hostToken,
          role: "host",
        })
      ).participants,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: selected.participantId, avatarId: "owl" }),
        expect.objectContaining({ id: fallback.participantId, avatarId: expectedFallback }),
      ]),
    );
    service.close();
  });

  it("accepts an answer received before the deadline even when credential lookup finishes later", async () => {
    vi.useFakeTimers();
    const receivedAtMs = new Date("2026-09-15T12:00:00.000Z").getTime();
    vi.setSystemTime(receivedAtMs);
    const repository = new MemoryRepository();
    const cache = new MemorySessionCache();
    const service = new SessionService(repository, cache, config, new MetricsService());
    const { quiz, correctChoiceId } = quizFixture();
    const sessionId = randomUUID();
    const participantId = randomUUID();
    const participantToken = "participant-token-long-enough-for-test";
    let state = createGameState({
      sessionId,
      code: "1234567",
      quiz,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    state = addParticipant(state, {
      id: participantId,
      nickname: "Deadline learner",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
    state = applyHostCommand(state, {
      commandId: randomUUID(),
      expectedVersion: state.version,
      action: "start",
      nowMs: receivedAtMs,
      newRoundId: randomUUID,
    }).state;
    const deadlineMs = receivedAtMs + 100;
    state.deadlineMs = deadlineMs;
    const stored = {
      ...storedSession({ state, hostToken: "host-token-long-enough-for-test" }),
      decisionReplayEnabled: true,
    };
    const participant: ParticipantRecord = {
      id: participantId,
      sessionId,
      nickname: "Deadline learner",
      tokenHash: hashToken(participantToken),
      status: "active",
      joinedAt: new Date(receivedAtMs),
    };
    await repository.createSession(stored);
    await repository.createParticipant(participant);

    let releaseLookup!: () => void;
    const delayedLookup = new Promise<ParticipantRecord>((resolve) => {
      releaseLookup = () => resolve(participant);
    });
    vi.spyOn(repository, "getParticipantByToken").mockReturnValue(delayedLookup);
    const answer = service.answer({
      sessionId,
      participantToken,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    vi.setSystemTime(deadlineMs + 1);
    const automaticLock = (
      service as unknown as {
        autoLock(targetSessionId: string, cutoffMs: number): Promise<void>;
      }
    ).autoLock(sessionId, deadlineMs);
    releaseLookup();

    const acknowledgement = await answer;
    expect(acknowledgement).toMatchObject({ accepted: true, duplicate: false });
    expect(acknowledgement).not.toHaveProperty("score");
    await automaticLock;
    expect((await repository.getSessionById(sessionId))?.decisionReplayEnabled).toBe(true);
    expect((await repository.getSessionById(sessionId))?.state).toMatchObject({
      phase: "question_locked",
      answers: expect.objectContaining({}),
    });
    expect(repository.answers).toHaveLength(1);
    expect([...repository.answers.values()][0]?.score).toBe(1_000);
    const evidence = await repository.getSessionEvidence(stored.workspaceId, sessionId);
    expect(evidence.decisionReplayEnabled).toBe(true);
    expect(evidence.decisionEvents).toContainEqual(
      expect.objectContaining({
        type: "insight_shown",
        occurredAt: new Date(deadlineMs + 1).toISOString(),
      }),
    );
    service.close();
  });

  it("keeps a synchronized open-round burst in one complete answer batch", async () => {
    vi.useFakeTimers();
    const { correctChoiceId, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(3);
    const commitAnswers = vi.spyOn(repository, "commitAnswers");
    const findAnswers = vi.spyOn(repository, "findAnswers");

    const first = service.answer({
      sessionId,
      participantToken: participantInputs[0]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    await vi.advanceTimersByTimeAsync(40);
    expect(commitAnswers).not.toHaveBeenCalled();

    const second = service.answer({
      sessionId,
      participantToken: participantInputs[1]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(commitAnswers).not.toHaveBeenCalled();

    const third = service.answer({
      sessionId,
      participantToken: participantInputs[2]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    await vi.advanceTimersByTimeAsync(0);

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      expect.objectContaining({ accepted: true, duplicate: false }),
      expect.objectContaining({ accepted: true, duplicate: false }),
      expect.objectContaining({ accepted: true, duplicate: false }),
    ]);
    expect(commitAnswers).toHaveBeenCalledTimes(1);
    expect(commitAnswers.mock.calls[0]?.[1]).toHaveLength(3);
    expect(commitAnswers.mock.calls[0]?.[3]).toEqual({ roundEvidencePersisted: true });
    expect(findAnswers).not.toHaveBeenCalled();
    service.close();
  });

  it("caps a trailing answer batch while the room remains incomplete", async () => {
    vi.useFakeTimers();
    const { correctChoiceId, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(5);
    const commitAnswers = vi.spyOn(repository, "commitAnswers");
    const answers: Array<ReturnType<SessionService["answer"]>> = [];

    for (let index = 0; index < 4; index += 1) {
      answers.push(
        service.answer({
          sessionId,
          participantToken: participantInputs[index]!.token,
          roundId: state.roundId!,
          choiceId: correctChoiceId,
          idempotencyKey: randomUUID(),
        }),
      );
      await vi.advanceTimersByTimeAsync(index === 3 ? 29 : 40);
    }

    expect(commitAnswers).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(Promise.all(answers)).resolves.toHaveLength(4);
    expect(commitAnswers).toHaveBeenCalledTimes(1);
    expect(commitAnswers.mock.calls[0]?.[1]).toHaveLength(4);
    service.close();
  });

  it("holds answers received after a lock command behind the host mutation", async () => {
    vi.useFakeTimers();
    const startedAtMs = new Date("2026-09-18T12:00:00.000Z").getTime();
    vi.setSystemTime(startedAtMs);
    const { correctChoiceId, hostToken, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(3);
    const commitAnswers = vi.spyOn(repository, "commitAnswers");

    let releaseParticipantLookup!: () => void;
    const participantLookupBlocked = new Promise<void>((resolve) => {
      releaseParticipantLookup = resolve;
    });
    const getParticipantByToken = repository.getParticipantByToken.bind(repository);
    vi.spyOn(repository, "getParticipantByToken").mockImplementationOnce(
      async (participantTokenHash) => {
        await participantLookupBlocked;
        return getParticipantByToken(participantTokenHash);
      },
    );

    const beforeLock = service.answer({
      sessionId,
      participantToken: participantInputs[0]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });

    vi.setSystemTime(startedAtMs + 10);
    const lock = service.hostCommand({
      sessionId,
      hostToken,
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: state.version + 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (
        service as unknown as {
          answerIngressBarriers: Map<string, unknown>;
        }
      ).answerIngressBarriers.has(sessionId),
    ).toBe(true);

    vi.setSystemTime(startedAtMs + 20);
    const afterLock = service.answer({
      sessionId,
      participantToken: participantInputs[1]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    await vi.advanceTimersByTimeAsync(0);

    releaseParticipantLookup();
    await vi.advanceTimersByTimeAsync(0);

    await expect(beforeLock).resolves.toMatchObject({ accepted: true, duplicate: false });
    await expect(lock).resolves.toMatchObject({ phase: "question_locked" });
    await vi.advanceTimersByTimeAsync(0);
    await expect(afterLock).resolves.toMatchObject({ accepted: false, duplicate: false });
    expect(commitAnswers).toHaveBeenCalledTimes(1);
    expect(commitAnswers.mock.calls[0]?.[1]).toHaveLength(1);
    expect(repository.answers).toHaveLength(1);
    service.close();
  });

  it("does not let an unauthorized closing command stall answers", async () => {
    vi.useFakeTimers();
    const startedAtMs = new Date("2026-09-18T13:00:00.000Z").getTime();
    vi.setSystemTime(startedAtMs);
    const { correctChoiceId, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(1);

    let releaseAuthorization!: () => void;
    const authorizationBlocked = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const getSessionById = repository.getSessionById.bind(repository);
    vi.spyOn(repository, "getSessionById").mockImplementationOnce(async (targetSessionId) => {
      await authorizationBlocked;
      return getSessionById(targetSessionId);
    });

    vi.setSystemTime(startedAtMs + 10);
    const unauthorizedLock = service.hostCommand({
      sessionId,
      hostToken: "invalid-host-token-long-enough",
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: state.version,
    });
    vi.setSystemTime(startedAtMs + 20);
    const answer = service.answer({
      sessionId,
      participantToken: participantInputs[0]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    const unauthorizedLockRejection = expect(unauthorizedLock).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(
      (
        service as unknown as {
          answerIngressBarriers: Map<string, unknown>;
        }
      ).answerIngressBarriers.has(sessionId),
    ).toBe(false);
    await expect(answer).resolves.toMatchObject({ accepted: true, duplicate: false });
    expect(repository.answers).toHaveLength(1);

    releaseAuthorization();
    await vi.advanceTimersByTimeAsync(0);

    await unauthorizedLockRejection;
    expect((await repository.getSessionById(sessionId))?.state.phase).toBe("question_open");
    service.close();
  });

  it("rejects a held answer when the service closes", async () => {
    vi.useFakeTimers();
    const startedAtMs = new Date("2026-09-18T14:00:00.000Z").getTime();
    vi.setSystemTime(startedAtMs);
    const { correctChoiceId, hostToken, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(2);

    let releaseParticipantLookup!: () => void;
    const participantLookupBlocked = new Promise<void>((resolve) => {
      releaseParticipantLookup = resolve;
    });
    const getParticipantByToken = repository.getParticipantByToken.bind(repository);
    vi.spyOn(repository, "getParticipantByToken").mockImplementationOnce(
      async (participantTokenHash) => {
        await participantLookupBlocked;
        return getParticipantByToken(participantTokenHash);
      },
    );

    const beforeLock = service.answer({
      sessionId,
      participantToken: participantInputs[0]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });

    vi.setSystemTime(startedAtMs + 10);
    const lock = service.hostCommand({
      sessionId,
      hostToken,
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: state.version + 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (
        service as unknown as {
          answerIngressBarriers: Map<string, unknown>;
        }
      ).answerIngressBarriers.has(sessionId),
    ).toBe(true);

    vi.setSystemTime(startedAtMs + 20);
    const afterLock = service.answer({
      sessionId,
      participantToken: participantInputs[1]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    const beforeLockRejection = expect(beforeLock).rejects.toMatchObject({ code: "CONFLICT" });
    const afterLockRejection = expect(afterLock).rejects.toMatchObject({ code: "CONFLICT" });
    const lockRejection = expect(lock).rejects.toMatchObject({ code: "CONFLICT" });
    await vi.advanceTimersByTimeAsync(0);

    service.close();
    releaseParticipantLookup();
    await vi.advanceTimersByTimeAsync(0);

    await beforeLockRejection;
    await afterLockRejection;
    await lockRejection;
    expect(repository.answers).toHaveLength(0);
  });

  it("rejects an idempotency key reused for a different round", async () => {
    const repository = new MemoryRepository();
    const service = new SessionService(
      repository,
      new MemorySessionCache(),
      config,
      new MetricsService(),
    );
    const first = quizFixture();
    const secondCorrectChoiceId = randomUUID();
    const secondQuestion = {
      ...structuredClone(first.quiz.questions[0]!),
      id: randomUUID(),
      prompt: "A different checkpoint needs a different idempotency key.",
      choices: [
        { id: secondCorrectChoiceId, label: "True", isCorrect: true },
        { id: randomUUID(), label: "False", isCorrect: false },
      ],
    };
    const sessionId = randomUUID();
    const participantId = randomUUID();
    const participantToken = "participant-idempotency-token-long-enough";
    const hostToken = "host-idempotency-token-long-enough";
    let state = createGameState({
      sessionId,
      code: "2345678",
      quiz: { ...first.quiz, questions: [first.quiz.questions[0]!, secondQuestion] },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    state = addParticipant(state, {
      id: participantId,
      nickname: "Retry tester",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
    state = applyHostCommand(state, {
      commandId: randomUUID(),
      expectedVersion: state.version,
      action: "start",
      nowMs: Date.now(),
      newRoundId: randomUUID,
    }).state;
    await repository.createSession(storedSession({ state, hostToken }));
    await repository.createParticipant({
      id: participantId,
      sessionId,
      nickname: "Retry tester",
      tokenHash: hashToken(participantToken),
      status: "active",
      joinedAt: new Date(),
    });
    const reusedKey = "same-key-must-not-cross-rounds";
    await expect(
      service.answer({
        sessionId,
        participantToken,
        roundId: state.roundId!,
        response: { kind: "choice", choiceIds: [first.correctChoiceId] },
        idempotencyKey: reusedKey,
      }),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });

    let snapshot = await service.hostCommand({
      sessionId,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: (await repository.getSessionById(sessionId))!.state.version,
      action: "lock",
    });
    snapshot = await service.hostCommand({
      sessionId,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: snapshot.version,
      action: "reveal",
    });
    snapshot = await service.hostCommand({
      sessionId,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: snapshot.version,
      action: "next",
    });

    await expect(
      service.answer({
        sessionId,
        participantToken,
        roundId: snapshot.roundId!,
        response: { kind: "choice", choiceIds: [secondCorrectChoiceId] },
        idempotencyKey: reusedKey,
      }),
    ).resolves.toMatchObject({
      accepted: false,
      duplicate: false,
      code: "ANSWER_INVALID",
    });
    expect(repository.answers).toHaveLength(1);
    service.close();
  });

  it("returns a durable duplicate when a first-round answer is retried after finish", async () => {
    const { correctChoiceId, hostToken, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(1);
    const answerInput = {
      sessionId,
      participantToken: participantInputs[0]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: "finished-first-round-retry",
    };
    const first = await service.answer(answerInput);
    expect(first).toMatchObject({ accepted: true, duplicate: false });

    let snapshot = await service.hostCommand({
      sessionId,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: (await repository.getSessionById(sessionId))!.state.version,
      action: "lock",
    });
    snapshot = await service.hostCommand({
      sessionId,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: snapshot.version,
      action: "reveal",
    });
    snapshot = await service.hostCommand({
      sessionId,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: snapshot.version,
      action: "next",
    });
    expect(snapshot).toMatchObject({ phase: "finished" });
    expect((await repository.getSessionById(sessionId))?.state.answers).toEqual({});

    await expect(service.answer(answerInput)).resolves.toMatchObject({
      accepted: true,
      answerId: first.answerId,
      duplicate: true,
    });
    expect(repository.answers).toHaveLength(1);
    service.close();
  });

  it("records linked rechecks separately from same-question revotes", async () => {
    const repository = new MemoryRepository();
    const metrics = new MetricsService();
    const productEvents = new ProductEventDispatcher(repository, metrics);
    const workspaceId = randomUUID();
    const betaConfig = {
      ...config,
      FEATURE_UX_BETA: true,
      UX_BETA_WORKSPACE_ALLOWLIST: [workspaceId],
    };
    const service = new SessionService(
      repository,
      new MemorySessionCache(),
      betaConfig,
      metrics,
      productEvents,
    );
    const diagnosticId = randomUUID();
    const linkedRecheckId = randomUUID();
    const diagnosticCorrectId = randomUUID();
    const recheckCorrectId = randomUUID();
    const quiz: QuizDraft = {
      title: "Funnel evidence",
      description: "",
      questions: [
        {
          id: diagnosticId,
          type: "true_false",
          prompt: "A durable write precedes its acknowledgement.",
          choices: [
            { id: diagnosticCorrectId, label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "The server acknowledges only after persistence.",
          mediaId: null,
          mediaAlt: null,
          linkedRecheckQuestionId: linkedRecheckId,
        },
        {
          id: linkedRecheckId,
          type: "true_false",
          delivery: "recheck",
          prompt: "A retry may be acknowledged from its durable receipt.",
          choices: [
            { id: recheckCorrectId, label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 0,
          explanation: "Idempotent retries reuse the saved result.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    };

    const openRecheck = async (mode: "linked" | "revote", code: string) => {
      const hostToken = `host-${mode}-token-long-enough`;
      let state = createGameState({
        sessionId: randomUUID(),
        code,
        quiz,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "custom",
        },
      });
      for (const action of ["start", "lock"] as const) {
        state = applyHostCommand(state, {
          commandId: randomUUID(),
          expectedVersion: state.version,
          action,
          nowMs: Date.now(),
          newRoundId: randomUUID,
        }).state;
      }
      await repository.createSession({
        ...storedSession({ state, hostToken }),
        workspaceId,
      });
      await service.hostCommand({
        sessionId: state.sessionId,
        hostToken,
        commandId: randomUUID(),
        expectedVersion: state.version,
        action: "recheck.open",
        recheckMode: mode,
        ...(mode === "linked" ? { recheckQuestionId: linkedRecheckId } : {}),
      });
    };

    await openRecheck("linked", "2233445");
    await openRecheck("revote", "2233446");
    await productEvents.drain();

    expect(repository.productEvents.filter(({ name }) => name === "recheck_opened")).toHaveLength(
      2,
    );
    expect(repository.productEvents.filter(({ name }) => name === "linked_recheck_opened")).toEqual(
      [
        expect.objectContaining({
          workspaceId,
          dimensions: {
            artifactType: "round",
            segment: "workplace",
            betaVersion: "p0-2026",
          },
        }),
      ],
    );
    await expect(metrics.render()).resolves.toContain(
      'openround_recovery_funnel_stages_total{stage="linked_recheck",artifact_type="round",segment="workplace"} 1',
    );
    service.close();
  });

  it("rolls final state back when its report cannot be persisted, then succeeds on retry", async () => {
    class FailOnceFinalizationRepository extends MemoryRepository {
      private failFinalization = true;

      override async saveSession(input: StoredSession, expectedVersion: number, report?: Report) {
        if (report && this.failFinalization) {
          this.failFinalization = false;
          throw new Error("simulated report persistence failure");
        }
        return super.saveSession(input, expectedVersion, report);
      }

      override async saveReport(workspaceId: string, report: Report) {
        if (this.failFinalization) {
          this.failFinalization = false;
          throw new Error("simulated report persistence failure");
        }
        return super.saveReport(workspaceId, report);
      }
    }

    const repository = new FailOnceFinalizationRepository();
    const service = new SessionService(
      repository,
      new MemorySessionCache(),
      config,
      new MetricsService(),
    );
    const { quiz } = quizFixture();
    const hostToken = "host-token-long-enough-for-finalization";
    let state = createGameState({
      sessionId: randomUUID(),
      code: "7654321",
      quiz,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    for (const action of ["start", "lock", "reveal"] as const) {
      state = applyHostCommand(state, {
        commandId: randomUUID(),
        expectedVersion: state.version,
        action,
        nowMs: Date.now(),
        newRoundId: randomUUID,
      }).state;
    }
    const stored = storedSession({ state, hostToken });
    await repository.createSession(stored);
    const command = {
      sessionId: stored.id,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: state.version,
      action: "next" as const,
    };

    await expect(service.hostCommand(command)).rejects.toThrow(
      "simulated report persistence failure",
    );
    expect((await repository.getSessionById(stored.id))?.state.phase).toBe("question_reveal");
    expect(await repository.getReportBySession(stored.workspaceId, stored.id)).toBeNull();

    await expect(service.hostCommand(command)).resolves.toMatchObject({ phase: "finished" });
    expect((await repository.getSessionById(stored.id))?.state.phase).toBe("finished");
    expect(await repository.getReportBySession(stored.workspaceId, stored.id)).toMatchObject({
      sessionId: stored.id,
      status: "pending",
      schemaVersion: 3,
    });
    service.close();
  });
});
