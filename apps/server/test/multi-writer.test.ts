import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import { PostgresRepository, type CreatorContext } from "@openround/db";
import { RedisSessionCache } from "../src/cache.js";
import { ConfigSchema, type AppConfig } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import { ReportWorker } from "../src/report-worker.js";
import { SessionService } from "../src/session-service.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const enabled = Boolean(adminUrl && runtimeUrl && redisUrl);

describe.skipIf(!enabled)("distributed session mutation ownership", () => {
  let firstRepository: PostgresRepository;
  let secondRepository: PostgresRepository;
  let firstCache: RedisSessionCache;
  let secondCache: RedisSessionCache;
  let firstService: SessionService;
  let secondService: SessionService;
  let firstClosed = false;
  let creator: CreatorContext | null = null;

  beforeAll(async () => {
    const migrationRepository = new PostgresRepository(adminUrl!);
    await migrationRepository.pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
          CREATE ROLE openround_runtime NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_test_app') THEN
          CREATE ROLE openround_test_app LOGIN PASSWORD 'test-only-runtime';
        END IF;
      END $$;
      GRANT openround_runtime TO openround_test_app;
      GRANT CONNECT ON DATABASE openround TO openround_test_app;
    `);
    await migrationRepository.migrate();
    await migrationRepository.close();

    firstRepository = new PostgresRepository(runtimeUrl!);
    secondRepository = new PostgresRepository(runtimeUrl!);
    firstCache = new RedisSessionCache(redisUrl!);
    secondCache = new RedisSessionCache(redisUrl!);
    await Promise.all([
      firstRepository.initialize(),
      secondRepository.initialize(),
      firstCache.connect(),
      secondCache.connect(),
    ]);
    const config: AppConfig = ConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: runtimeUrl,
      REDIS_URL: redisUrl,
      COMMUNITY_MODE: "true",
      ALLOW_IN_MEMORY: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
    });
    firstService = new SessionService(firstRepository, firstCache, config, new MetricsService());
    secondService = new SessionService(secondRepository, secondCache, config, new MetricsService());
  });

  afterAll(async () => {
    if (creator) await secondRepository.deleteAccount(creator.userId);
    if (!firstClosed) {
      firstService.close();
      await firstCache.close();
      await firstRepository.close();
    }
    secondService.close();
    await secondCache.close();
    await secondRepository.close();
  });

  it("atomically charges each feedback intent once across independent Redis clients", async () => {
    const key = `feedback:${randomUUID()}`;
    const intent = `${randomUUID()}:${randomUUID()}`;
    const attempts = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        (index % 2 ? firstCache : secondCache).consumeIdempotentRateLimit(key, intent, 5, 60_000),
      ),
    );
    expect(attempts.every(Boolean)).toBe(true);
    for (let index = 0; index < 4; index++)
      expect(await secondCache.consumeIdempotentRateLimit(key, randomUUID(), 5, 60_000)).toBe(true);
    expect(await firstCache.consumeIdempotentRateLimit(key, randomUUID(), 5, 60_000)).toBe(false);
    expect(await secondCache.consumeIdempotentRateLimit(key, intent, 5, 60_000)).toBe(true);
    const expiringKey = `feedback:${randomUUID()}`;
    expect(await firstCache.consumeIdempotentRateLimit(expiringKey, "first", 1, 100)).toBe(true);
    expect(await secondCache.consumeIdempotentRateLimit(expiringKey, "second", 1, 100)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await secondCache.consumeIdempotentRateLimit(expiringKey, "second", 1, 100)).toBe(true);
  });

  it("serializes two writers and continues after one writer exits", async () => {
    const abandonedLeaseSession = randomUUID();
    const abandonedOwner = randomUUID();
    const takeoverOwner = randomUUID();
    expect(await firstCache.acquireMutationLease(abandonedLeaseSession, abandonedOwner, 75)).toBe(
      true,
    );
    expect(await secondCache.acquireMutationLease(abandonedLeaseSession, takeoverOwner, 75)).toBe(
      false,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await secondCache.acquireMutationLease(abandonedLeaseSession, takeoverOwner, 75)).toBe(
      true,
    );
    await secondCache.releaseMutationLease(abandonedLeaseSession, takeoverOwner);

    const reservedCode = "7654321";
    const firstCodeOwner = randomUUID();
    const secondCodeOwner = randomUUID();
    expect(await firstCache.reserveSessionCode(reservedCode, firstCodeOwner, 1_000)).toBe(true);
    expect(await secondCache.reserveSessionCode(reservedCode, secondCodeOwner, 1_000)).toBe(false);
    await secondCache.releaseSessionCode(reservedCode, secondCodeOwner);
    expect(await secondCache.reserveSessionCode(reservedCode, secondCodeOwner, 1_000)).toBe(false);
    await firstCache.releaseSessionCode(reservedCode, firstCodeOwner);
    expect(await secondCache.reserveSessionCode(reservedCode, secondCodeOwner, 1_000)).toBe(true);
    await secondCache.releaseSessionCode(reservedCode, secondCodeOwner);

    const abandonedCode = "7654322";
    expect(await firstCache.reserveSessionCode(abandonedCode, firstCodeOwner, 75)).toBe(true);
    expect(await secondCache.reserveSessionCode(abandonedCode, secondCodeOwner, 75)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await secondCache.reserveSessionCode(abandonedCode, secondCodeOwner, 75)).toBe(true);
    await secondCache.releaseSessionCode(abandonedCode, secondCodeOwner);

    const tokenHash = `multi-writer-${randomUUID()}`;
    await firstRepository.createMagicToken({
      id: randomUUID(),
      email: `multi-writer-${randomUUID()}@example.com`,
      segment: "workplace",
      tokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    creator = await firstRepository.consumeMagicToken(tokenHash, new Date());
    expect(creator).not.toBeNull();

    const correctChoiceId = randomUUID();
    const draft = {
      title: "Distributed ownership",
      description: "Two writers share one authoritative session.",
      questions: [
        {
          id: randomUUID(),
          type: "true_false",
          prompt: "Every accepted mutation is serialized.",
          choices: [
            { id: correctChoiceId, label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "Redis ownership is backed by PostgreSQL version fencing.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    } satisfies QuizDraft;
    const now = new Date();
    const quiz = await firstRepository.createQuiz({
      id: randomUUID(),
      workspaceId: creator!.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    await firstRepository.publishQuiz({
      id: randomUUID(),
      workspaceId: creator!.workspaceId,
      quizId: quiz.id,
      version: 1,
      content: draft,
      contentHash: randomUUID(),
      publishedAt: now,
    });

    const hosted = await firstService.createSession(creator!, quiz.id, {
      audienceLimit: 100,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    });
    const joins = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        (index % 2 === 0 ? firstService : secondService).join({
          code: hosted.code,
          nickname: "Shared nickname",
        }),
      ),
    );
    const lobby = await secondService.snapshot({
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      role: "host",
    });
    expect(lobby.participants).toHaveLength(40);
    expect(new Set(lobby.participants.map(({ nickname }) => nickname)).size).toBe(40);

    const startCommand = {
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      commandId: randomUUID(),
      expectedVersion: lobby.version,
      action: "start" as const,
    };
    const starts = await Promise.all([
      firstService.hostCommand(startCommand),
      secondService.hostCommand(startCommand),
    ]);
    expect(new Set(starts.map(({ version }) => version)).size).toBe(1);
    expect(new Set(starts.map(({ roundId }) => roundId)).size).toBe(1);
    const open = starts[0]!;

    const answerInputs = joins.map((joined, index) => ({
      sessionId: hosted.sessionId,
      participantToken: joined.participantToken,
      roundId: open.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
      service: index % 2 === 0 ? firstService : secondService,
    }));
    const duplicateInput = answerInputs[0]!;
    const acknowledgements = await Promise.all([
      ...answerInputs.map(({ service, ...input }) => service.answer(input)),
      secondService.answer({
        sessionId: duplicateInput.sessionId,
        participantToken: duplicateInput.participantToken,
        roundId: duplicateInput.roundId,
        choiceId: duplicateInput.choiceId,
        idempotencyKey: duplicateInput.idempotencyKey,
      }),
    ]);
    expect(acknowledgements.every(({ accepted }) => accepted)).toBe(true);
    expect(acknowledgements.filter(({ duplicate }) => duplicate)).toHaveLength(1);

    const answered = await firstService.snapshot({
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      role: "host",
    });
    expect(answered.answerCount).toBe(40);
    expect(answered.participants.every(({ score }) => score === 1_000)).toBe(true);

    const commandRace = await Promise.allSettled([
      firstService.hostCommand({
        sessionId: hosted.sessionId,
        hostToken: hosted.hostToken,
        commandId: randomUUID(),
        expectedVersion: answered.version,
        action: "lock",
      }),
      secondService.hostCommand({
        sessionId: hosted.sessionId,
        hostToken: hosted.hostToken,
        commandId: randomUUID(),
        expectedVersion: answered.version,
        action: "pause",
      }),
    ]);
    expect(commandRace.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = commandRace.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "STALE_VERSION" });

    firstService.close();
    await firstCache.close();
    await firstRepository.close();
    firstClosed = true;

    let current = await secondService.snapshot({
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      role: "host",
    });
    const command = async (action: "resume" | "lock" | "reveal" | "next") => {
      current = await secondService.hostCommand({
        sessionId: hosted.sessionId,
        hostToken: hosted.hostToken,
        commandId: randomUUID(),
        expectedVersion: current.version,
        action,
      });
    };
    if (current.phase === "paused") await command("resume");
    if (current.phase === "question_open") await command("lock");
    await command("reveal");
    await command("next");
    expect(current.phase).toBe("finished");
    const replacementCodeOwner = randomUUID();
    expect(await secondCache.reserveSessionCode(hosted.code, replacementCodeOwner, 1_000)).toBe(
      true,
    );
    await secondCache.releaseSessionCode(hosted.code, replacementCodeOwner);

    const synchronized = await secondService.sync({
      sessionId: hosted.sessionId,
      hostToken: hosted.hostToken,
      role: "host",
      lastSeq: 0,
    });
    expect(synchronized.replayComplete).toBe(true);
    expect(synchronized.replay.map(({ seq }) => seq)).toEqual(
      Array.from({ length: synchronized.snapshot.seq }, (_, index) => index + 1),
    );
    const persisted = await secondRepository.getSessionById(hosted.sessionId);
    expect(Object.keys(persisted!.state.answers)).toHaveLength(0);
    expect(
      (await secondRepository.getSessionEvidence(creator!.workspaceId, hosted.sessionId)).answers,
    ).toHaveLength(40);
    expect(await secondRepository.getParticipants(hosted.sessionId)).toHaveLength(40);
    expect(
      await secondRepository.getReportBySession(creator!.workspaceId, hosted.sessionId),
    ).toMatchObject({ status: "pending" });
    await expect(new ReportWorker(secondRepository, 60_000).runOnce()).resolves.toBe("completed");
    expect(
      await secondRepository.getReportBySession(creator!.workspaceId, hosted.sessionId),
    ).toMatchObject({
      status: "ready",
      metrics: { participantCount: 40, answerCount: 40 },
    });

    const disposable = await secondService.createSession(creator!, quiz.id, {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    });
    expect(await secondService.deleteSession(creator!.workspaceId, disposable.sessionId)).toBe(
      true,
    );
    const deletedCodeOwner = randomUUID();
    expect(await secondCache.reserveSessionCode(disposable.code, deletedCodeOwner, 1_000)).toBe(
      true,
    );
    await secondCache.releaseSessionCode(disposable.code, deletedCodeOwner);

    await secondService.invalidate([hosted.sessionId]);
    await secondRepository.deleteAccount(creator!.userId);
    creator = null;
  }, 30_000);
});
