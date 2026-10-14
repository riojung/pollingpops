import { randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { createGameState } from "@openround/game-engine";
import type { QuizDraft } from "@openround/contracts";
import type { CreatorContext, Repository } from "../../src/index.js";

/** Search must operate on retained history before the cursor and page limit. */
export async function expectResultsHistorySearchConformance(
  repository: Repository,
  owner: CreatorContext,
  outsider: CreatorContext,
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 86_400_000);
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
      await repository.saveReport(actor.workspaceId, {
        id: reportId,
        sessionId,
        status: index === 0 ? "pending" : "ready",
        generatedAt: index === 0 ? null : now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        metrics: { participantCount: 0, completedCount: 0, answerCount: 0, accuracyPercent: 0 },
        questions: [],
        participants: [],
      });
      reports.push(reportId);
      const base = {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        sourceQuizVersionId: version.id,
        title: index < 2 ? `Practice needle ${index === 0 ? "50%_" : "second"}` : "Recent practice",
        content,
        conceptKeys: index === 0 ? ["history-search"] : [],
        timeMode: "flex" as const,
        genericTokenHash: randomUUID(),
        opensAt: new Date(now.getTime() + (index === 0 ? 60_000 : -60_000)),
        closesAt: expiresAt,
        expiresAt,
        closedAt: null,
        createdBy: actor.userId,
        createdAt,
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
  await repository.updateQuiz(owner.workspaceId, owned.quizId, {
    ...content,
    title: "Renamed library source",
  });

  const reports = (options: Partial<Parameters<Repository["listReportHistory"]>[1]> = {}) =>
    repository.listReportHistory(owner.workspaceId, { limit: 25, now, ...options });
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
}
