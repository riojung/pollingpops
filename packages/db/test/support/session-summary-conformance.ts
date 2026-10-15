import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import { createGameState } from "@openround/game-engine";
import type { AggregateSessionSummary, QuizDraft, SummarySource } from "@openround/contracts";
import {
  createPresentationRepository,
  createPresentationSessionRepository,
  createSessionSummaryRepository,
  createSurveyRepository,
  MemoryRepository,
  PostgresRepository,
  type CreatorContext,
  type Repository,
  type SessionSummarySnapshotRecord,
  type SurveyRoom,
  type MemoryRepositoryLifecycleExtension,
} from "../../src/index.js";
import { presentationSessionConformanceContent } from "./presentation-session-conformance.js";
import { surveyFixture } from "./survey-conformance.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function summaryFixture(kind: SummarySource["kind"], now: Date): AggregateSessionSummary {
  return {
    schemaVersion: 1,
    kind,
    title: "Synthetic aggregate summary",
    finishedAt: now.toISOString(),
    minimumRespondents: 5,
    participantCount: 5,
    responseCount: 5,
    questionCount: 0,
    initialAccuracy: null,
    recovery: [],
    questions: [],
    noteCodes: ["aggregate_only"],
    nextSteps: "",
  };
}

export async function summaryMember(
  repository: Repository,
  owner: CreatorContext,
  member: CreatorContext,
  role: "editor" | "viewer",
) {
  const tokenHash = hash(randomUUID());
  await repository.createWorkspaceInvitation({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    email: member.email,
    role,
    tokenHash,
    invitedBy: owner.userId,
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(),
  });
  expect(await repository.acceptWorkspaceInvitation(tokenHash, new Date(), "test")).not.toBeNull();
}

/** Seed each real parent and exercise its completion fence before any snapshot is stored. */
export async function summarySourceFixtures(repository: Repository, owner: CreatorContext) {
  const summaries = createSessionSummaryRepository(repository);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3 * 86_400_000);
  let nextCode = randomInt(1_000_000, 9_000_000);
  const code = () => String(nextCode++);
  const content: QuizDraft = {
    title: "Summary Round",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "numeric",
        prompt: "How many?",
        correctValue: "2",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 30,
        basePoints: 1000,
        explanation: "Two",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  const quiz = await repository.createQuiz({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    title: content.title,
    description: "",
    draft: content,
    status: "draft",
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  const version = await repository.publishQuiz({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    quizId: quiz.id,
    version: 1,
    content,
    contentHash: hash(randomUUID()),
    publishedAt: now,
  });
  const round: SummarySource = { kind: "round", id: randomUUID() };
  const state = createGameState({
    sessionId: round.id,
    code: code(),
    quiz: content,
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "friendly_only",
    },
  });
  state.phase = "finished";
  await repository.createSession({
    id: round.id,
    workspaceId: owner.workspaceId,
    quizVersionId: version.id,
    hostId: owner.userId,
    hostTokenHash: hash(randomUUID()),
    state,
    expiresAt: now,
    retentionExpiresAt: expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  const report = {
    id: randomUUID(),
    sessionId: round.id,
    status: "pending" as "pending" | "ready",
    generatedAt: null as string | null,
    expiresAt: expiresAt.toISOString(),
    metrics: { participantCount: 0, completedCount: 0, answerCount: 0, accuracyPercent: 0 },
    questions: [],
    participants: [],
  };
  await repository.saveReport(owner.workspaceId, report);
  await expect(
    summaries.getOrCreateSnapshot({
      workspaceId: owner.workspaceId,
      source: round,
      actorId: owner.userId,
      summary: summaryFixture("round", now),
      expiresAt,
      now,
    }),
  ).resolves.toBeNull();
  await repository.saveReport(owner.workspaceId, {
    ...report,
    status: "ready",
    generatedAt: now.toISOString(),
  });
  const activeId = randomUUID();
  await repository.createSession({
    id: activeId,
    workspaceId: owner.workspaceId,
    quizVersionId: version.id,
    hostId: owner.userId,
    hostTokenHash: hash(randomUUID()),
    state: createGameState({
      sessionId: activeId,
      code: code(),
      quiz: content,
      settings: state.settings,
    }),
    expiresAt,
    retentionExpiresAt: expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  await repository.saveReport(owner.workspaceId, {
    ...report,
    id: randomUUID(),
    sessionId: activeId,
    status: "ready",
    generatedAt: now.toISOString(),
  });
  await expect(
    summaries.getOrCreateSnapshot({
      workspaceId: owner.workspaceId,
      source: { kind: "round", id: activeId },
      actorId: owner.userId,
      summary: summaryFixture("round", now),
      expiresAt,
      now,
    }),
  ).resolves.toBeNull();
  await repository.deleteSession(owner.workspaceId, activeId);

  const presentations = createPresentationRepository(repository);
  const presentationSessions = createPresentationSessionRepository(repository);
  const presentationContent = presentationSessionConformanceContent();
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    title: presentationContent.title,
    description: "",
    status: "draft",
    draft: presentationContent,
    draftRevision: 0,
    draftSchemaVersion: 2,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: owner.userId,
    createdAt: now,
    updatedAt: now,
  });
  const presentationVersion = await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      version: 1,
      content: presentationContent,
      contentHash: hash(randomUUID()),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  const presentationSource: SummarySource = { kind: "presentation", id: randomUUID() };
  await presentationSessions.createSession({
    id: presentationSource.id,
    workspaceId: owner.workspaceId,
    presentationId: presentation.id,
    presentationVersionId: presentationVersion.id,
    title: presentationContent.title,
    content: presentationContent,
    code: code(),
    status: "finished",
    phase: "finished",
    currentBlockIndex: -1,
    revision: 0,
    createdBy: owner.userId,
    createdAt: now,
    updatedAt: now,
    finishedAt: new Date(0),
    liveExpiresAt: now,
    retentionExpiresAt: expiresAt,
  });
  await expect(
    summaries.getOrCreateSnapshot({
      workspaceId: owner.workspaceId,
      source: presentationSource,
      actorId: owner.userId,
      summary: summaryFixture("presentation", now),
      expiresAt,
      now,
    }),
  ).resolves.toBeNull();
  // An early synthetic finish sorts this isolated fixture ahead of other retained report jobs.
  const job = await presentationSessions.claimReportJob(now, new Date(now.getTime() + 60_000));
  expect(job?.sessionId).toBe(presentationSource.id);
  await presentationSessions.completeReportJob(job!, {
    reportId: job!.reportId,
    sessionId: presentationSource.id,
    schemaVersion: 1,
    payload: { syntheticSummaryFixture: true },
    generatedAt: now,
  });

  const surveys = createSurveyRepository(repository);
  const survey = await surveys.create(
    owner.workspaceId,
    randomUUID(),
    surveyFixture(),
    randomUUID(),
  );
  await surveys.publish(owner.workspaceId, survey.id, 0, randomUUID(), null);
  const room = await surveys.createRoom(owner.workspaceId, survey.id, 0, randomUUID(), {
    code: code(),
    closesAt: new Date(now.getTime() + 60_000).toISOString(),
    expiresAt: expiresAt.toISOString(),
    participantLimit: 20,
    windowDays: 1,
  });
  const surveySource: SummarySource = { kind: "survey", id: room.id };
  await expect(
    summaries.getOrCreateSnapshot({
      workspaceId: owner.workspaceId,
      source: surveySource,
      actorId: owner.userId,
      summary: summaryFixture("survey", now),
      expiresAt,
      now,
    }),
  ).resolves.toBeNull();
  await surveys.close(owner.workspaceId, room.id);
  return { now, expiresAt, sources: [round, presentationSource, surveySource], summaries };
}

export async function expectSessionSummaryConformance(
  repository: Repository,
  owner: CreatorContext,
  member: CreatorContext,
  outsider: CreatorContext,
) {
  await summaryMember(repository, owner, member, "viewer");
  const { now, expiresAt, sources, summaries } = await summarySourceFixtures(repository, owner);
  const snapshots: SessionSummarySnapshotRecord[] = [];
  for (const source of sources) {
    const input = {
      workspaceId: owner.workspaceId,
      source,
      actorId: member.userId,
      summary: summaryFixture(source.kind, now),
      expiresAt: new Date(expiresAt.getTime() + 86_400_000),
      now,
    };
    await expect(
      summaries.getOrCreateSnapshot({ ...input, workspaceId: outsider.workspaceId }),
    ).resolves.toBeNull();
    const results = await Promise.all([
      summaries.getOrCreateSnapshot(input),
      summaries.getOrCreateSnapshot({
        ...input,
        summary: { ...input.summary, title: "A later projection must not replace the snapshot" },
      }),
    ]);
    expect(results[0]).not.toBeNull();
    expect(results[1]).toEqual(results[0]);
    const snapshot = results[0]!;
    const frozenTitle = snapshot.summary.title;
    expect(snapshot.expiresAt).toEqual(expiresAt);
    snapshot.summary.title = "Mutation of a returned clone";
    const stored = await summaries.getSnapshot(owner.workspaceId, source);
    expect(stored?.summary.title).toBe(frozenTitle);
    expect(
      await summaries.getOrCreateSnapshot({
        ...input,
        summary: { ...input.summary, title: "A refreshed projection" },
      }),
    ).toEqual(stored);
    expect(await summaries.getSnapshot(outsider.workspaceId, source)).toBeNull();
    snapshots.push(stored!);
  }
  expect(await summaries.hasSnapshots(owner.workspaceId)).toBe(true);
  expect(await summaries.hasSnapshots(outsider.workspaceId)).toBe(false);
  const snapshot = snapshots[0]!;
  const create = {
    workspaceId: owner.workspaceId,
    snapshotId: snapshot.id,
    actorId: member.userId,
    idempotencyKey: randomUUID(),
    intentHash: hash(randomUUID()),
    tokenHash: hash(randomUUID()),
    expiresInDays: 30,
    allowDownloads: true,
    nextSteps: "Practice together next week.",
    now,
  };
  await expect(summaries.createShare(create)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await repository.updateWorkspaceMemberRole(owner.workspaceId, member.userId, "editor");
  const created = await Promise.all([
    summaries.createShare(create),
    summaries.createShare({ ...create, tokenHash: hash(randomUUID()) }),
  ]);
  expect(created.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
  expect(created[0]!.share).toEqual(created[1]!.share);
  const share = created[0]!.share;
  expect(share.expiresAt).toEqual(expiresAt);
  expect(
    await summaries.getShareIntent(owner.workspaceId, member.userId, create.idempotencyKey),
  ).toEqual(share);
  expect(
    await summaries.getShareIntent(outsider.workspaceId, member.userId, create.idempotencyKey),
  ).toBeNull();
  await expect(
    summaries.createShare({ ...create, intentHash: hash("changed intent") }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    summaries.createShare({ ...create, snapshotId: snapshots[1]!.id }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    summaries.createShare({
      ...create,
      workspaceId: outsider.workspaceId,
      actorId: outsider.userId,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect((await summaries.getPublicShare(share.id, create.tokenHash, now))?.share.nextSteps).toBe(
    create.nextSteps,
  );
  expect(
    (await summaries.getPublicShare(share.id, create.tokenHash, now))?.snapshot.summary.nextSteps,
  ).toBe("");
  expect(await summaries.getPublicShare(share.id, hash("wrong capability"), now)).toBeNull();
  expect(await summaries.getPublicShare(share.id, create.tokenHash, expiresAt)).toBeNull();
  await repository.updateWorkspaceMemberRole(owner.workspaceId, member.userId, "viewer");
  expect(await summaries.getPublicShare(share.id, create.tokenHash, now)).toBeNull();
  await expect(
    summaries.revokeShare(owner.workspaceId, sources[0]!, share.id, member.userId, now),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await repository.updateWorkspaceMemberRole(owner.workspaceId, member.userId, "editor");
  expect(await summaries.getPublicShare(share.id, create.tokenHash, now)).not.toBeNull();
  expect(
    await summaries.revokeShare(owner.workspaceId, sources[1]!, share.id, owner.userId, now),
  ).toBe(false);
  expect(
    await summaries.revokeShare(owner.workspaceId, sources[0]!, share.id, owner.userId, now),
  ).toBe(true);
  expect(await summaries.getPublicShare(share.id, create.tokenHash, now)).toBeNull();
  expect(await summaries.createShare(create)).toMatchObject({
    replayed: true,
    share: { revokedAt: now },
  });

  const links = await Promise.all(
    Array.from({ length: 21 }, async (_, index) => {
      try {
        return await summaries.createShare({
          ...create,
          actorId: owner.userId,
          idempotencyKey: randomUUID(),
          intentHash: hash(`limit-${index}`),
          tokenHash: hash(`token-${randomUUID()}`),
        });
      } catch (error) {
        return error;
      }
    }),
  );
  expect(links.filter((result) => result instanceof Error)).toHaveLength(1);
  expect(links.find((result) => result instanceof Error)).toMatchObject({ code: "LINK_LIMIT" });
  expect((await summaries.listShares(owner.workspaceId, sources[0]!)).length).toBe(21);

  const exported = await repository.exportAccount(owner.userId);
  expect(exported.sessionSummarySnapshots).toHaveLength(3);
  expect(exported.sessionSummaryShares).toHaveLength(21);
  const text = JSON.stringify(exported.sessionSummaryShares);
  expect(text).not.toContain(create.tokenHash);
  expect(text).not.toContain(create.intentHash);
  expect(text).not.toContain("tokenHash");
  expect(text).not.toContain("intentHash");

  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]!;
    const link =
      index === 0
        ? share
        : (
            await summaries.createShare({
              ...create,
              actorId: owner.userId,
              snapshotId: snapshots[index]!.id,
              idempotencyKey: randomUUID(),
              intentHash: hash(randomUUID()),
              tokenHash: hash(randomUUID()),
            })
          ).share;
    if (source.kind === "round") await repository.deleteSession(owner.workspaceId, source.id);
    if (source.kind === "presentation")
      await createPresentationSessionRepository(repository).deleteSession(
        owner.workspaceId,
        source.id,
        now,
      );
    if (source.kind === "survey")
      await createSurveyRepository(repository).deleteRoom(owner.workspaceId, source.id);
    expect(await summaries.getSnapshot(owner.workspaceId, source)).toBeNull();
    expect(await summaries.listShares(owner.workspaceId, source)).toEqual([]);
    expect(await summaries.getPublicShare(link.id, link.tokenHash, now)).toBeNull();
  }
  expect((await repository.exportAccount(owner.userId)).sessionSummarySnapshots).toEqual([]);
  expect((await repository.exportAccount(owner.userId)).sessionSummaryShares).toEqual([]);
  expect(await summaries.hasSnapshots(owner.workspaceId)).toBe(false);
}

export async function expectSessionSummaryAccountLifecycle(
  repository: Repository,
  owner: CreatorContext,
  member: CreatorContext,
) {
  await summaryMember(repository, owner, member, "editor");
  const { now, expiresAt, sources, summaries } = await summarySourceFixtures(repository, owner);
  const links = [];
  for (const source of sources) {
    const snapshot = await summaries.getOrCreateSnapshot({
      workspaceId: owner.workspaceId,
      source,
      actorId: owner.userId,
      summary: summaryFixture(source.kind, now),
      expiresAt,
      now,
    });
    links.push(
      (
        await summaries.createShare({
          workspaceId: owner.workspaceId,
          snapshotId: snapshot!.id,
          actorId: member.userId,
          idempotencyKey: randomUUID(),
          intentHash: hash(randomUUID()),
          tokenHash: hash(randomUUID()),
          expiresInDays: 1,
          allowDownloads: false,
          nextSteps: "",
          now,
        })
      ).share,
    );
  }
  await repository.removeWorkspaceMember(owner.workspaceId, member.userId);
  for (const link of links)
    expect(await summaries.getPublicShare(link.id, link.tokenHash, now)).toBeNull();
  await summaryMember(repository, owner, member, "editor");
  await repository.deleteAccount(member.userId);
  for (const link of links)
    expect(await summaries.getPublicShare(link.id, link.tokenHash, now)).toBeNull();
  expect((await repository.exportAccount(owner.userId)).sessionSummaryShares).toEqual([]);
  expect((await repository.exportAccount(owner.userId)).sessionSummarySnapshots).toHaveLength(3);
  await repository.deleteAccount(owner.userId);
  for (const source of sources)
    expect(await summaries.getSnapshot(owner.workspaceId, source)).toBeNull();
  for (const link of links)
    expect(await summaries.getPublicShare(link.id, link.tokenHash, now)).toBeNull();
}

export async function expectSessionSummaryRetention(repository: Repository, owner: CreatorContext) {
  const { now, expiresAt, sources, summaries } = await summarySourceFixtures(repository, owner);
  const links = [];
  for (const source of sources) {
    const snapshot = await summaries.getOrCreateSnapshot({
      workspaceId: owner.workspaceId,
      source,
      actorId: owner.userId,
      summary: summaryFixture(source.kind, now),
      expiresAt,
      now,
    });
    links.push(
      (
        await summaries.createShare({
          workspaceId: owner.workspaceId,
          snapshotId: snapshot!.id,
          actorId: owner.userId,
          idempotencyKey: randomUUID(),
          intentHash: hash(randomUUID()),
          tokenHash: hash(randomUUID()),
          expiresInDays: 1,
          allowDownloads: false,
          nextSteps: "",
          now,
        })
      ).share,
    );
    await expect(
      summaries.getOrCreateSnapshot({
        workspaceId: owner.workspaceId,
        source,
        actorId: owner.userId,
        summary: summaryFixture(source.kind, now),
        expiresAt,
        now: expiresAt,
      }),
    ).resolves.toBeNull();
  }
  for (const link of links) {
    expect(await summaries.getPublicShare(link.id, link.tokenHash, now)).not.toBeNull();
    expect(
      await summaries.getPublicShare(link.id, link.tokenHash, new Date(now.getTime() + 86_400_000)),
    ).toBeNull();
    expect(await summaries.getPublicShare(link.id, link.tokenHash, expiresAt)).toBeNull();
  }
  await repository.purgeExpired(expiresAt);
  expect((await repository.exportAccount(owner.userId)).sessionSummarySnapshots).toEqual([]);
  expect((await repository.exportAccount(owner.userId)).sessionSummaryShares).toEqual([]);
  for (const source of sources)
    expect(await summaries.getSnapshot(owner.workspaceId, source)).toBeNull();
  for (const link of links)
    expect(await summaries.getPublicShare(link.id, link.tokenHash, now)).toBeNull();
}

export async function expectSurveySummaryCompletionFence(
  repository: Repository,
  owner: CreatorContext,
) {
  const surveys = createSurveyRepository(repository);
  const now = new Date();
  const draft = surveyFixture();
  const survey = await surveys.create(owner.workspaceId, randomUUID(), draft, randomUUID());
  await surveys.publish(owner.workspaceId, survey.id, 0, randomUUID(), null);
  let nextCode = randomInt(1_000_000, 9_000_000);
  const room = () =>
    surveys.createRoom(owner.workspaceId, survey.id, 0, randomUUID(), {
      code: String(nextCode++),
      closesAt: new Date(now.getTime() + 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
      participantLimit: 20,
      windowDays: 1,
    });
  const manual = await room();
  const beforeClose = Date.now();
  await surveys.close(owner.workspaceId, manual.id);
  const manuallyClosed = (await surveys.getRoom(manual.id, owner.workspaceId))!;
  expect(Date.parse(manuallyClosed.closedAt!)).toBeGreaterThanOrEqual(beforeClose);
  expect(Date.parse(manuallyClosed.closedAt!)).toBeLessThanOrEqual(Date.now());
  await surveys.close(owner.workspaceId, manual.id);
  await surveys.results(owner.workspaceId, manual.id, new Date());
  expect((await surveys.getRoom(manual.id, owner.workspaceId))?.closedAt).toBe(
    manuallyClosed.closedAt,
  );

  const natural = await room();
  const tokenHash = hash(randomUUID());
  await surveys.admit(natural.id, tokenHash, now);
  const final = await surveys.results(owner.workspaceId, natural.id, new Date(natural.closesAt));
  expect(await surveys.getRoom(natural.id, owner.workspaceId)).toMatchObject({
    closed: true,
    closedAt: natural.closesAt,
  });
  const question = draft.items[0]!.question;
  if (question.type !== "poll") throw new Error("Expected a fixture poll");
  await expect(
    surveys.respond(
      natural.id,
      tokenHash,
      { [question.id]: { kind: "poll", choiceIds: [question.choices[0]!.id] } },
      0,
      randomUUID(),
      true,
      now,
    ),
  ).rejects.toMatchObject({ code: "ROOM_CLOSED" });
  expect(
    await surveys.results(
      owner.workspaceId,
      natural.id,
      new Date(Date.parse(natural.closesAt) + 1000),
    ),
  ).toEqual(final);
  expect((await surveys.getRoom(natural.id, owner.workspaceId))?.closedAt).toBe(natural.closesAt);

  const frozen = await room();
  const summaries = createSessionSummaryRepository(repository);
  const closedNow = new Date(frozen.closesAt);
  const snapshot = await summaries.getOrCreateSnapshot({
    workspaceId: owner.workspaceId,
    source: { kind: "survey", id: frozen.id },
    actorId: owner.userId,
    summary: summaryFixture("survey", closedNow),
    expiresAt: new Date(frozen.expiresAt),
    now: closedNow,
  });
  expect(snapshot).not.toBeNull();
  expect(await surveys.getRoom(frozen.id, owner.workspaceId)).toMatchObject({
    closed: true,
    closedAt: frozen.closesAt,
  });
  const seedLegacyClosed = async (legacy: SurveyRoom) => {
    if (repository instanceof MemoryRepository) {
      const store = repository.getOrCreateLifecycleExtension<
        MemoryRepositoryLifecycleExtension & { survey_feedback_rooms: Map<string, SurveyRoom> }
      >("surveys", () => {
        throw new Error("Expected the existing Survey store");
      });
      const row = store.survey_feedback_rooms.get(legacy.id)!;
      row.closed = true;
      delete row.closedAt;
    } else if (repository instanceof PostgresRepository) {
      const client = await repository.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
        await client.query(
          "UPDATE survey_feedback_rooms SET data = jsonb_set(data, '{closed}', 'true'::jsonb) - 'closedAt' WHERE workspace_id = $1 AND id = $2",
          [owner.workspaceId, legacy.id],
        );
        await client.query("COMMIT");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    } else throw new Error("Unsupported fixture repository");
  };
  const legacy = await room();
  await seedLegacyClosed(legacy);
  const capturedAt = new Date(now.getTime() + 1_000);
  expect(capturedAt < new Date(legacy.closesAt)).toBe(true);
  await surveys.results(owner.workspaceId, legacy.id, capturedAt);
  expect((await surveys.getRoom(legacy.id, owner.workspaceId))?.closedAt).toBe(
    capturedAt.toISOString(),
  );
  await surveys.results(owner.workspaceId, legacy.id, new Date(now.getTime() + 2_000));
  expect((await surveys.getRoom(legacy.id, owner.workspaceId))?.closedAt).toBe(
    capturedAt.toISOString(),
  );

  const legacyFrozen = await room();
  await seedLegacyClosed(legacyFrozen);
  const freezeAt = new Date(now.getTime() + 3_000);
  expect(
    await summaries.getOrCreateSnapshot({
      workspaceId: owner.workspaceId,
      source: { kind: "survey", id: legacyFrozen.id },
      actorId: owner.userId,
      summary: summaryFixture("survey", freezeAt),
      expiresAt: new Date(legacyFrozen.expiresAt),
      now: freezeAt,
    }),
  ).not.toBeNull();
  expect((await surveys.getRoom(legacyFrozen.id, owner.workspaceId))?.closedAt).toBe(
    freezeAt.toISOString(),
  );
  await surveys.results(owner.workspaceId, legacyFrozen.id, new Date(now.getTime() + 4_000));
  expect((await surveys.getRoom(legacyFrozen.id, owner.workspaceId))?.closedAt).toBe(
    freezeAt.toISOString(),
  );
  await repository.deleteAccount(owner.userId);
}

export async function expectSessionSummaryShareManagement(
  repository: Repository,
  owner: CreatorContext,
) {
  const { now, expiresAt, sources, summaries } = await summarySourceFixtures(repository, owner);
  const source = sources[0]!;
  const snapshot = (await summaries.getOrCreateSnapshot({
    workspaceId: owner.workspaceId,
    source,
    actorId: owner.userId,
    summary: summaryFixture("round", now),
    expiresAt,
    now,
  }))!;
  const create = (createdAt: Date, expiresInDays: number) =>
    summaries.createShare({
      workspaceId: owner.workspaceId,
      snapshotId: snapshot.id,
      actorId: owner.userId,
      idempotencyKey: randomUUID(),
      intentHash: hash(randomUUID()),
      tokenHash: hash(randomUUID()),
      expiresInDays,
      allowDownloads: false,
      nextSteps: "",
      now: createdAt,
    });
  const active = (await create(now, 30)).share;
  const expired = (await create(new Date(now.getTime() + 1), 1)).share;
  const history = [];
  for (let index = 0; index < 101; index++) {
    // Tied newer timestamps also verify deterministic ID ordering within the history group.
    const createdAt = new Date(now.getTime() + 2);
    const share = (await create(createdAt, 30)).share;
    await summaries.revokeShare(owner.workspaceId, source, share.id, owner.userId, createdAt);
    history.push(share.id);
  }
  const listingNow = new Date(now.getTime() + 2 * 86_400_000);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(listingNow);
  try {
    expect(await summaries.getPublicShare(active.id, active.tokenHash, listingNow)).not.toBeNull();
    expect(await summaries.getPublicShare(expired.id, expired.tokenHash, listingNow)).toBeNull();
    const listed = await summaries.listShares(owner.workspaceId, source);
    expect(listed).toHaveLength(100);
    expect(listed[0]!.id).toBe(active.id);
    expect(listed[1]!.id).toBe(history.sort((a, b) => b.localeCompare(a))[0]);
    expect(listed.slice(1).every((share) => share.revokedAt !== null)).toBe(true);
    expect(
      await summaries.revokeShare(
        owner.workspaceId,
        source,
        listed[0]!.id,
        owner.userId,
        listingNow,
      ),
    ).toBe(true);
    expect(await summaries.getPublicShare(active.id, active.tokenHash, listingNow)).toBeNull();
  } finally {
    vi.useRealTimers();
    await repository.deleteAccount(owner.userId);
  }
}
