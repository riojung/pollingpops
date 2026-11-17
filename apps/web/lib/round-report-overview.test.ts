import { describe, expect, it } from "vitest";
import { LegacyReportSchema, ReportV2Schema, ReportV7Schema } from "@openround/contracts";
import { roundReportOverview } from "./round-report-overview";

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  status: "ready",
  generatedAt: null,
  expiresAt: "2099-01-01T00:00:00.000Z",
  metrics: { participantCount: 4, completedCount: 0, answerCount: 2, accuracyPercent: 0 },
  questions: [
    {
      questionId: "00000000-0000-4000-8000-000000000003",
      prompt: "Unanswered",
      responses: 0,
      correct: 0,
      accuracyPercent: 0,
      difficult: true,
    },
    {
      questionId: "00000000-0000-4000-8000-000000000004",
      prompt: "Observed zero",
      responses: 2,
      correct: 0,
      accuracyPercent: 0,
      difficult: true,
    },
  ],
  participants: [],
};
const evidence = {
  initialAccuracy: { correct: 0, responses: 2, percent: 0 },
  confidenceMatrix: [],
  misconceptions: [],
  interventions: [],
  recovery: [],
  unresolvedConcepts: [],
  participation: { participants: 4, respondents: 1, percent: 25 },
  responseTime: { responses: 2, medianMs: null, p95Ms: null },
  qna: { questions: 0, answered: 0, unresolved: 0 },
  participantFeedback: [],
  evidenceNote: "Retained evidence only.",
};

describe("Round report overview", () => {
  it("does not invent unique respondent coverage for legacy reports", () => {
    const summary = roundReportOverview(LegacyReportSchema.parse(base));
    expect(summary.respondentCoverage).toBeNull();
    expect(summary.questionCoveragePercent).toBe(50);
    expect(summary.reviewQuestions.map((question) => question.prompt)).toEqual(["Observed zero"]);
    expect(summary.accuracyPercent).toBe(0);
  });

  it("uses recorded unique participation instead of dividing answers by participants", () => {
    const summary = roundReportOverview(
      ReportV2Schema.parse({ ...base, ...evidence, schemaVersion: 2 }),
    );
    expect(summary.respondentCoverage).toEqual({ respondents: 1, participants: 4, percent: 25 });
  });

  it("keeps no-response accuracy and unknown coverage distinct from measured zero", () => {
    const summary = roundReportOverview(
      ReportV2Schema.parse({
        ...base,
        ...evidence,
        schemaVersion: 2,
        metrics: { ...base.metrics, answerCount: 0 },
        questions: [],
        participation: { participants: 0, respondents: 0, percent: 0 },
      }),
    );
    expect(summary.accuracyPercent).toBeNull();
    expect(summary.respondentCoverage).toBeNull();
    expect(summary.questionCoveragePercent).toBeNull();
    expect(summary.hasResponses).toBe(false);
  });

  it("retains opinion results without reporting correctness or review needs", () => {
    const report = ReportV7Schema.parse({
      ...base,
      ...evidence,
      schemaVersion: 7,
      metrics: { ...base.metrics, accuracyPercent: null },
      questions: base.questions.map((question) => ({
        ...question,
        correct: null,
        accuracyPercent: null,
      })),
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
    const summary = roundReportOverview(report);
    expect(summary.accuracyPercent).toBeNull();
    expect(summary.reviewQuestions).toEqual([]);
    expect(summary.questionPreview[1]?.prompt).toBe("Observed zero");
  });
});
