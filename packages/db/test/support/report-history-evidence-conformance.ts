import { randomInt, randomUUID } from "node:crypto";
import { ReportSchema, type QuizDraft, type Report } from "@openround/contracts";
import { createGameState } from "@openround/game-engine";
import { expect } from "vitest";
import type { CreatorContext, Repository } from "../../src/index.js";

/** Both stores must project absent evidence without rewriting historical report payloads. */
export async function expectReportHistoryEvidenceConformance(
  repository: Repository,
  owner: CreatorContext,
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 86_400_000);
  const content: QuizDraft = {
    title: "Report evidence",
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
  const quiz = await repository.createQuiz({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
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
    workspaceId: owner.workspaceId,
    quizId: quiz.id,
    version: 1,
    content,
    contentHash: randomUUID(),
    publishedAt: now,
  });
  const cases: Array<{
    name: string;
    schemaVersion: 1 | 2 | 3 | 4 | 5;
    responses: number;
    percent: number | null;
    answerCount?: number;
    status?: Report["status"];
    expected: number | null;
  }> = [
    { name: "V1 without answers", schemaVersion: 1, responses: 0, percent: 0, expected: null },
    { name: "V1 measured zero", schemaVersion: 1, responses: 1, percent: 0, expected: 0 },
    { name: "V1 answered percentage", schemaVersion: 1, responses: 5, percent: 60, expected: 60 },
    { name: "V2 without answers", schemaVersion: 2, responses: 0, percent: 0, expected: null },
    { name: "V3 without answers", schemaVersion: 3, responses: 0, percent: 0, expected: null },
    { name: "V4 without answers", schemaVersion: 4, responses: 0, percent: 0, expected: null },
    {
      name: "pending V3 placeholder",
      schemaVersion: 3,
      responses: 0,
      percent: 0,
      status: "pending",
      expected: null,
    },
    {
      name: "failed V4 placeholder",
      schemaVersion: 4,
      responses: 0,
      percent: 0,
      status: "failed",
      expected: null,
    },
    {
      name: "historical V4 poll responses without assessed evidence",
      schemaVersion: 4,
      responses: 0,
      answerCount: 2,
      percent: 0,
      expected: null,
    },
    {
      name: "current V5 opinion responses",
      schemaVersion: 5,
      responses: 0,
      answerCount: 2,
      percent: null,
      expected: null,
    },
    { name: "V3 measured zero", schemaVersion: 3, responses: 1, percent: 0, expected: 0 },
    {
      name: "mixed V5 opinion and incorrect assessed responses",
      schemaVersion: 5,
      responses: 1,
      answerCount: 2,
      percent: 0,
      expected: 0,
    },
    { name: "V4 measured percentage", schemaVersion: 4, responses: 2, percent: 50, expected: 50 },
  ];
  const reports: Array<{ report: Report; expected: number | null; name: string }> = [];
  let code = randomInt(1_000_000, 9_000_000);
  for (const entry of cases) {
    const sessionId = randomUUID();
    await repository.createSession({
      id: sessionId,
      workspaceId: owner.workspaceId,
      quizVersionId: version.id,
      hostId: owner.userId,
      hostTokenHash: randomUUID(),
      state: createGameState({
        sessionId,
        code: String(code++),
        quiz: content,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "custom",
        },
      }),
      expiresAt,
      retentionExpiresAt: expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const report = ReportSchema.parse({
      id: randomUUID(),
      sessionId,
      schemaVersion: entry.schemaVersion,
      status: entry.status ?? "ready",
      generatedAt: entry.status ? null : now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      metrics: {
        participantCount: 2,
        completedCount: 0,
        answerCount: entry.answerCount ?? entry.responses,
        accuracyPercent: entry.percent,
      },
      questions: [],
      participants: [],
      initialAccuracy: { correct: 0, responses: entry.responses, percent: entry.percent },
      confidenceMatrix: [],
      misconceptions: [],
      interventions: [],
      recovery: [],
      unresolvedConcepts: [],
      participation: { participants: 2, respondents: 0, percent: 0 },
      responseTime: { responses: 0, medianMs: null, p95Ms: null },
      qna: { questions: 0, answered: 0, unresolved: 0 },
      participantFeedback: [],
      evidenceNote: "Session evidence only.",
      experience: { category: "general", preset: { id: "focus", version: 1 } },
      audiencePulse: {
        uniqueParticipants: 0,
        events: 0,
        bySignal: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
        contexts: [],
      },
      conversation: {
        messages: 0,
        uniqueContributors: 0,
        reactions: 0,
        reports: 0,
        removed: 0,
        moderationActions: 0,
        peakMessagesPerMinute: 0,
        transcriptAvailable: false,
      },
      decisionReplayAvailable: false,
      decisionReplayComplete: false,
      decisionTimeline: [],
    });
    await repository.saveReport(owner.workspaceId, report);
    reports.push({ report, expected: entry.expected, name: entry.name });
  }
  const storedBefore = await Promise.all(
    reports.map(({ report }) => repository.getReport(owner.workspaceId, report.id)),
  );
  const history = await repository.listReportHistory(owner.workspaceId, { limit: 25, now });
  expect(history.items).toHaveLength(cases.length);
  for (const { report, expected, name } of reports) {
    const summary = history.items.find((item) => item.id === report.id);
    expect(summary?.initialAccuracyPercent, name).toBe(expected);
    expect(summary?.recovery.percent, name).toBeNull();
  }
  expect(
    await Promise.all(
      reports.map(({ report }) => repository.getReport(owner.workspaceId, report.id)),
    ),
  ).toEqual(storedBefore);
}
