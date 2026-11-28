import { randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { createGameState } from "@openround/game-engine";
import { LegacyReportSchema, type QuizDraft } from "@openround/contracts";
import type { CreatorContext, Repository } from "../../src/index.js";
import { packPracticeFixture } from "./recovery-pack-practice-conformance.js";

/** Search, sources, and analytics use retained history across pages. */
export async function expectResultsHistorySearchConformance(
  repository: Repository,
  owner: CreatorContext,
  outsider: CreatorContext,
  setReportDates: (workspaceId: string, reportIds: string[], dates: Date[]) => void | Promise<void>,
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 86_400_000);
  const dates = [
    "2023-12-31T23:59:59.999Z",
    "2024-01-01T00:00:00.000Z",
    "2024-03-31T23:59:59.999Z",
    "2024-04-01T00:00:00.000Z",
    "2024-07-01T00:00:00.000Z",
    "2024-10-01T00:00:00.000Z",
    "2025-01-31T23:59:59.999Z",
    "2025-02-01T00:00:00.000Z",
  ];
  const latest = new Date("2025-04-01T00:00:00.000Z");
  let nextCode = randomInt(1_000_000, 9_000_000);
  const content: QuizDraft = {
    title: "Library source",
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
        basePoints: 1_000,
        explanation: "Two",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };

  async function seed(
    actor: CreatorContext,
    count: number,
    firstStatus: "pending" | "failed" = "pending",
    expiredRecovery = false,
  ) {
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      title: content.title,
      description: "",
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    const reports = [];
    const followups = [];
    const reportIdPrefix = randomUUID().slice(0, 24);
    for (let index = 0; index < count; index += 1) {
      const sessionId = randomUUID();
      const title =
        index < 2
          ? `Frozen needle ${index === 0 ? "50%_" : "second"}`
          : index === 27
            ? "Renamed delivered Round"
            : "Recent room";
      const createdAt = new Date(now.getTime() - (count - index) * 1_000);
      await repository.createSession({
        id: sessionId,
        workspaceId: actor.workspaceId,
        quizVersionId: version.id,
        hostId: actor.userId,
        hostTokenHash: randomUUID(),
        state: createGameState({
          sessionId,
          code: String(nextCode++),
          quiz: { ...content, title },
          settings: {
            audienceLimit: 20,
            scoringMode: "accuracy",
            resultVisibility: "private",
            allowLateJoin: true,
            nicknamePolicy: "friendly_only",
          },
        }),
        expiresAt: new Date(now.getTime() - 1),
        retentionExpiresAt: expiresAt,
        createdAt,
        updatedAt: createdAt,
      });
      const reportId = `${reportIdPrefix}${index.toString(16).padStart(12, "0")}`;
      const status = index === 0 ? firstStatus : index === 2 ? "failed" : "ready";
      await repository.saveReport(actor.workspaceId, {
        id: reportId,
        sessionId,
        status,
        generatedAt: status === "ready" ? now.toISOString() : null,
        expiresAt: expiresAt.toISOString(),
        metrics: {
          participantCount: [11, 6, 12, 7][index] ?? 1,
          completedCount: 0,
          answerCount: 0,
          accuracyPercent: 0,
        },
        questions: [],
        participants: [],
      });
      reports.push(reportId);
      const practiceDate = dates[index];
      const expired = index === 0 && expiredRecovery;
      const base = {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        sourceQuizVersionId: version.id,
        title: index < 2 ? `Practice needle ${index === 0 ? "50%_" : "second"}` : "Recent practice",
        content,
        conceptKeys: index === 0 ? ["history-search"] : [],
        timeMode: "flex" as const,
        genericTokenHash: randomUUID(),
        opensAt: new Date(
          now.getTime() + (index === 0 && !expired ? 60_000 : index === 1 ? 0 : -60_000),
        ),
        closesAt: expired || index === 2 || index === 3 ? now : expiresAt,
        expiresAt: expired || index === 3 ? now : expiresAt,
        closedAt: index === 3 || index === 4 ? now : null,
        createdBy: actor.userId,
        createdAt: practiceDate ? new Date(practiceDate) : latest,
      };
      if (index === 0) {
        await repository.createFollowup(
          { ...base, purpose: "recovery", sourceSessionId: sessionId, sourceReportId: reportId },
          [],
        );
      } else {
        await expect(
          repository.createPracticeAssignment(
            quiz.id,
            { ...base, purpose: "assignment", sourceSessionId: null, sourceReportId: null },
            [],
          ),
        ).resolves.toBe(true);
      }
      followups.push(base.id);
    }
    return { quizId: quiz.id, versionId: version.id, reports, followups };
  }

  const owned = await seed(owner, 28);
  const foreign = await seed(outsider, 2);
  for (const [actor, followupId, completed] of [
    [owner, owned.followups[1]!, true],
    [owner, owned.followups[1]!, false],
    [owner, owned.followups[2]!, true],
    [owner, owned.followups[5]!, false],
    [outsider, foreign.followups[1]!, true],
  ] as const) {
    await repository.createOrGetFollowupAttempt({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      followupId,
      accessTokenId: null,
      sourceParticipantId: null,
      attemptTokenHash: randomUUID(),
      status: completed ? "completed" : "in_progress",
      phase: completed ? "completed" : "question_open",
      currentIndex: 0,
      version: 0,
      timeMultiplier: 1,
      questionOpenedAt: now,
      deadlineAt: null,
      completedAt: completed ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  }
  await repository.updateQuiz(owner.workspaceId, owned.quizId, {
    ...content,
    title: "Renamed library source",
  });

  const reports = (options: Partial<Parameters<Repository["listReportHistory"]>[1]> = {}) =>
    repository.listReportHistory(owner.workspaceId, { limit: 25, now, ...options });
  const totals = (filters: Parameters<Repository["getReportHistoryTotals"]>[1] = {}) =>
    repository.getReportHistoryTotals(owner.workspaceId, filters);
  const followups = (options: Partial<Parameters<Repository["listFollowupHistory"]>[1]> = {}) =>
    repository.listFollowupHistory(owner.workspaceId, { limit: 25, now, ...options });
  for (const history of [reports, followups]) {
    const recent = await history();
    expect(recent.items).toHaveLength(25);
    expect(recent.hasMore).toBe(true);
    expect(recent.items.some((item) => item.title.toLowerCase().includes("needle"))).toBe(false);
    const first = await history({ limit: 1, search: "  NeEdLe  " });
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const anchor = first.items[0]!;
    const second = await history({
      limit: 1,
      search: "needle",
      cursor: {
        createdAt: anchor.createdAt,
        cursorCreatedAt: anchor.cursorCreatedAt,
        id: anchor.id,
      },
    });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.items[0]!.id).not.toBe(anchor.id);
    const literal = await history({ search: "%_" });
    expect(literal.items).toHaveLength(1);
    expect(literal.items[0]!.title).toContain("50%_");
    expect((await history({ search: "needle", quizId: foreign.quizId })).items).toEqual([]);
    expect((await history({ search: "needle", from: expiresAt })).items).toEqual([]);
    expect((await history({ search: "needle", to: new Date(0) })).items).toEqual([]);
    expect((await history({ search: "Renamed library source" })).items).toEqual([]);
    expect((await history({ search: "   " })).items).toHaveLength(25);
  }
  expect((await reports({ search: "needle", limit: 25 })).items.map(({ id }) => id)).toEqual(
    owned.reports.slice(0, 2).reverse(),
  );
  expect((await reports({ search: "needle", status: "ready" })).items.map(({ id }) => id)).toEqual([
    owned.reports[1],
  ]);
  expect(await totals()).toEqual({ ready: 26, pending: 1, failed: 1 });
  expect(await totals({ search: "  NeEdLe  ", quizId: owned.quizId })).toEqual({
    ready: 1,
    pending: 1,
    failed: 0,
  });
  expect(await totals({ search: "%_", status: "pending", from: now, to: expiresAt })).toEqual({
    ready: 0,
    pending: 1,
    failed: 0,
  });
  expect(await totals({ status: "failed" })).toEqual({ ready: 0, pending: 0, failed: 1 });
  expect(await repository.getReportHistoryTotals(outsider.workspaceId, {})).toEqual({
    ready: 1,
    pending: 1,
    failed: 0,
  });
  for (const filters of [
    { quizId: foreign.quizId },
    { search: "Renamed library source" },
    { from: expiresAt },
    { to: new Date(0) },
  ]) {
    expect(await totals(filters)).toEqual({ ready: 0, pending: 0, failed: 0 });
  }
  expect(
    (await followups({ search: "needle", purpose: "recovery" })).items.map(({ id }) => id),
  ).toEqual([owned.followups[0]]);
  expect(
    (await followups({ search: "needle", purpose: "assignment" })).items.map(({ id }) => id),
  ).toEqual([owned.followups[1]]);
  expect(
    (await followups({ search: "needle", status: "scheduled" })).items.map(({ id }) => id),
  ).toEqual([owned.followups[0]]);
  expect((await followups({ search: "needle", status: "closed" })).items).toEqual([]);

  await setReportDates(
    owner.workspaceId,
    owned.reports,
    owned.reports.map((_, index) => (dates[index] ? new Date(dates[index]) : latest)),
  );
  await setReportDates(outsider.workspaceId, foreign.reports, [latest, latest]);

  const analytics = (filters: Parameters<Repository["getReportHistoryAnalytics"]>[1] = {}) =>
    repository.getReportHistoryAnalytics(owner.workspaceId, filters);
  expect((await reports()).items.some(({ id }) => id === owned.reports[1])).toBe(false);
  const activity = {
    month: [
      { start: "2024-04-01", count: 1 },
      { start: "2024-07-01", count: 1 },
      { start: "2024-10-01", count: 1 },
      { start: "2025-01-01", count: 1 },
      { start: "2025-02-01", count: 1 },
      { start: "2025-04-01", count: 20 },
    ],
    quarter: [
      { start: "2024-01-01", count: 2 },
      { start: "2024-04-01", count: 1 },
      { start: "2024-07-01", count: 1 },
      { start: "2024-10-01", count: 1 },
      { start: "2025-01-01", count: 2 },
      { start: "2025-04-01", count: 20 },
    ],
  };
  expect(await analytics()).toEqual({
    ready: 26,
    pending: 1,
    failed: 1,
    participantJoins: 37,
    activity,
  });
  const firstDate = new Date(dates[0]!);
  expect(
    await analytics({
      quizId: owned.quizId,
      search: "  FrOzEn needle 50%_  ",
      status: "pending",
      from: firstDate,
      to: firstDate,
    }),
  ).toEqual({
    ready: 0,
    pending: 1,
    failed: 0,
    participantJoins: 0,
    activity: {
      month: [{ start: "2023-12-01", count: 1 }],
      quarter: [{ start: "2023-10-01", count: 1 }],
    },
  });
  expect(await analytics({ from: new Date(dates[2]!), to: new Date(dates[3]!) })).toEqual({
    ready: 1,
    pending: 0,
    failed: 1,
    participantJoins: 7,
    activity: {
      month: [
        { start: "2024-03-01", count: 1 },
        { start: "2024-04-01", count: 1 },
      ],
      quarter: [
        { start: "2024-01-01", count: 1 },
        { start: "2024-04-01", count: 1 },
      ],
    },
  });
  for (const filters of [
    { quizId: foreign.quizId },
    { search: "Renamed library source" },
    { search: "%_", from: new Date(firstDate.getTime() + 1) },
    { to: new Date(firstDate.getTime() - 1) },
  ]) {
    expect(await analytics(filters)).toEqual({
      ready: 0,
      pending: 0,
      failed: 0,
      participantJoins: 0,
      activity: { month: [], quarter: [] },
    });
  }
  const oldReadyDate = new Date(dates[1]!);
  const oldReadyFilters = {
    quizId: owned.quizId,
    search: "  FrOzEn needle  ",
    status: "ready",
    from: oldReadyDate,
    to: oldReadyDate,
  } as const;
  const oldReadyAnalytics = {
    ready: 1,
    pending: 0,
    failed: 0,
    participantJoins: 6,
    activity: {
      month: [{ start: "2024-01-01", count: 1 }],
      quarter: [{ start: "2024-01-01", count: 1 }],
    },
  };
  expect(await analytics(oldReadyFilters)).toEqual(oldReadyAnalytics);
  expect(await repository.getReportHistoryAnalytics(outsider.workspaceId, {})).toMatchObject({
    ready: 1,
    pending: 1,
    participantJoins: 6,
  });

  const oldReadyReport = LegacyReportSchema.parse(
    await repository.getReport(owner.workspaceId, owned.reports[1]!),
  );
  for (const participantCount of [undefined, "6", -6, 6.5, Number.MAX_SAFE_INTEGER + 1]) {
    await repository.saveReport(owner.workspaceId, {
      ...oldReadyReport,
      metrics: { ...oldReadyReport.metrics, participantCount: participantCount as number },
    });
    expect(await analytics(oldReadyFilters)).toEqual({ ...oldReadyAnalytics, participantJoins: 0 });
  }
  await repository.saveReport(owner.workspaceId, oldReadyReport);

  const practiceAnalytics = (
    filters: Omit<Parameters<Repository["getFollowupHistoryAnalytics"]>[1], "now"> = {},
  ) => repository.getFollowupHistoryAnalytics(owner.workspaceId, { now, ...filters });
  const emptyPractice = {
    open: 0,
    scheduled: 0,
    closed: 0,
    expired: 0,
    attemptCount: 0,
    completedAttemptCount: 0,
    activity: { month: [], quarter: [] },
  };
  expect(await practiceAnalytics()).toEqual({
    open: 24,
    scheduled: 1,
    closed: 2,
    expired: 1,
    attemptCount: 4,
    completedAttemptCount: 2,
    activity,
  });
  const openDate = new Date(dates[1]!);
  const openFilter = {
    search: "  PrAcTiCe needle  ",
    quizId: owned.quizId,
    purpose: "assignment",
    status: "open",
    from: openDate,
    to: openDate,
  } as const;
  expect(await practiceAnalytics(openFilter)).toEqual({
    ...emptyPractice,
    open: 1,
    attemptCount: 2,
    completedAttemptCount: 1,
    activity: {
      month: [{ start: "2024-01-01", count: 1 }],
      quarter: [{ start: "2024-01-01", count: 1 }],
    },
  });
  expect((await followups(openFilter)).items).toMatchObject([
    { id: owned.followups[1], status: "open", attemptCount: 2, completedAttemptCount: 1 },
  ]);
  expect(await practiceAnalytics({ search: " 50%_ ", purpose: "recovery" })).toEqual({
    ...emptyPractice,
    scheduled: 1,
    activity: {
      month: [{ start: "2023-12-01", count: 1 }],
      quarter: [{ start: "2023-10-01", count: 1 }],
    },
  });
  expect(await practiceAnalytics({ status: "closed" })).toEqual({
    ...emptyPractice,
    closed: 2,
    attemptCount: 1,
    completedAttemptCount: 1,
    activity: {
      month: [
        { start: "2024-03-01", count: 1 },
        { start: "2024-07-01", count: 1 },
      ],
      quarter: [
        { start: "2024-01-01", count: 1 },
        { start: "2024-07-01", count: 1 },
      ],
    },
  });
  expect((await followups({ status: "expired" })).items).toMatchObject([
    { id: owned.followups[3], status: "expired" },
  ]);
  expect(await practiceAnalytics({ status: "expired" })).toEqual({
    ...emptyPractice,
    expired: 1,
    activity: {
      month: [{ start: "2024-04-01", count: 1 }],
      quarter: [{ start: "2024-04-01", count: 1 }],
    },
  });
  for (const filters of [
    { quizId: foreign.quizId },
    { search: "Renamed library source" },
    { search: "%_", from: new Date(firstDate.getTime() + 1) },
    { to: new Date(firstDate.getTime() - 1) },
  ]) {
    expect(await practiceAnalytics(filters)).toEqual(emptyPractice);
  }

  const pending = await seed(owner, 1);
  const failed = await seed(owner, 1, "failed", true);
  await seed(owner, 0);
  await setReportDates(
    owner.workspaceId,
    [...pending.reports, ...failed.reports],
    [firstDate, firstDate],
  );
  const recentReportIds = (await reports()).items.map(({ id }) => id);
  expect(recentReportIds).not.toContain(pending.reports[0]);
  expect(recentReportIds).not.toContain(failed.reports[0]);

  const latestReport = LegacyReportSchema.parse(
    await repository.getReport(owner.workspaceId, owned.reports.at(-1)!),
  );
  await repository.saveReport(owner.workspaceId, {
    ...latestReport,
    metrics: { ...latestReport.metrics, participantCount: -1 },
  });
  expect(await repository.listReportHistorySources(owner.workspaceId)).toEqual(
    [
      { id: owned.quizId, title: "Renamed delivered Round" },
      { id: pending.quizId, title: "Frozen needle 50%_" },
      { id: failed.quizId, title: "Frozen needle 50%_" },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  expect(await repository.listReportHistorySources(outsider.workspaceId)).toEqual([
    { id: foreign.quizId, title: "Frozen needle second" },
  ]);
  expect(await repository.listReportHistorySources(randomUUID())).toEqual([]);
  await repository.saveReport(owner.workspaceId, latestReport);

  const { workspaceId } = owner;
  const pack = await packPracticeFixture(repository, workspaceId, owner.userId);
  await repository.createRecoveryPackPracticeAssignment(
    pack.pack.id,
    pack.input,
    pack.access,
    pack.context,
  );

  const practicePage = await followups();
  expect(practicePage.items.some(({ id }) => id === pack.input.id)).toBe(true);
  expect(practicePage.items.some(({ quizId }) => quizId === pending.quizId)).toBe(false);
  expect(practicePage.items.some(({ quizId }) => quizId === failed.quizId)).toBe(false);
  const practiceSources = () => repository.listFollowupHistorySources(workspaceId);
  const expectedSources = (title: string) =>
    [
      { id: owned.quizId, title },
      { id: pending.quizId, title: content.title },
      { id: failed.quizId, title: content.title },
    ].sort((left, right) => left.id.localeCompare(right.id));
  expect(await practiceSources()).toEqual(expectedSources(content.title));
  expect(await repository.listFollowupHistorySources(outsider.workspaceId)).toEqual([
    { id: foreign.quizId, title: content.title },
  ]);
  expect(await repository.listFollowupHistorySources(randomUUID())).toEqual([]);
  expect((await followups({ quizId: failed.quizId })).items).toMatchObject([
    { id: failed.followups[0], status: "expired", purpose: "recovery" },
  ]);
  expect(await practiceAnalytics({ quizId: failed.quizId })).toMatchObject({ expired: 1 });

  const idPrefix = randomUUID().slice(0, 24);
  const tiedAt = new Date(latest.getTime() + 1);
  async function assign(versionId: string, idSuffix: string, createdAt: Date) {
    await expect(
      repository.createPracticeAssignment(
        owned.quizId,
        {
          id: `${idPrefix}${idSuffix}`,
          workspaceId,
          purpose: "assignment",
          sourceQuizVersionId: versionId,
          sourceSessionId: null,
          sourceReportId: null,
          title: "Practice name",
          content: { ...content, title: "Practice content title" },
          conceptKeys: [],
          timeMode: "flex",
          genericTokenHash: randomUUID(),
          opensAt: now,
          closesAt: expiresAt,
          expiresAt,
          closedAt: null,
          createdBy: owner.userId,
          createdAt,
        },
        [],
      ),
    ).resolves.toBe(true);
  }
  const publish = (version: number, title: string) =>
    repository.publishQuiz({
      id: randomUUID(),
      workspaceId,
      quizId: owned.quizId,
      version,
      content: { ...content, title },
      contentHash: randomUUID(),
      publishedAt: now,
    });

  await assign(owned.versionId, "000000000003", tiedAt);
  const publishedTitle = "Renamed published Round";
  const renamed = await publish(2, publishedTitle);
  await assign(renamed.id, "000000000002", tiedAt);
  expect(await practiceSources()).toEqual(expectedSources(content.title));

  await assign(renamed.id, "000000000001", new Date(tiedAt.getTime() + 1));
  await publish(3, "Unused published version");
  await repository.updateQuiz(workspaceId, owned.quizId, { ...content, title: "Current draft" });
  expect(await practiceSources()).toEqual(expectedSources(publishedTitle));
}
