import { randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { createGameState } from "@openround/game-engine";
import type { QuizDraft } from "@openround/contracts";
import type { CreatorContext, Repository } from "../../src/index.js";

/** Search and analytics use retained history across pages. */
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

  async function seed(actor: CreatorContext, count: number) {
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
      const title = index < 2 ? `Frozen needle ${index === 0 ? "50%_" : "second"}` : "Recent room";
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
      const status = index === 0 ? "pending" : index === 2 ? "failed" : "ready";
      await repository.saveReport(actor.workspaceId, {
        id: reportId,
        sessionId,
        status,
        generatedAt: status === "ready" ? now.toISOString() : null,
        expiresAt: expiresAt.toISOString(),
        metrics: { participantCount: 0, completedCount: 0, answerCount: 0, accuracyPercent: 0 },
        questions: [],
        participants: [],
      });
      reports.push(reportId);
      const practiceDate = dates[index];
      const base = {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        sourceQuizVersionId: version.id,
        title: index < 2 ? `Practice needle ${index === 0 ? "50%_" : "second"}` : "Recent practice",
        content,
        conceptKeys: index === 0 ? ["history-search"] : [],
        timeMode: "flex" as const,
        genericTokenHash: randomUUID(),
        opensAt: new Date(now.getTime() + (index === 0 ? 60_000 : index === 1 ? 0 : -60_000)),
        closesAt: index === 2 || index === 3 ? now : expiresAt,
        expiresAt: index === 3 ? now : expiresAt,
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
    return { quizId: quiz.id, reports, followups };
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
  expect((await reports()).items.some(({ id }) => id === owned.reports[0])).toBe(false);
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
    activity: {
      month: [{ start: "2023-12-01", count: 1 }],
      quarter: [{ start: "2023-10-01", count: 1 }],
    },
  });
  expect(await analytics({ from: new Date(dates[2]!), to: new Date(dates[3]!) })).toEqual({
    ready: 1,
    pending: 0,
    failed: 1,
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
      activity: { month: [], quarter: [] },
    });
  }

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
}
