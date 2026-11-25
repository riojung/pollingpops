import { describe, expect, it } from "vitest";
import type { Report, ReportV2, ReportV7 } from "@openround/contracts";
import { roundReportAnalytics } from "./round-report-analytics";

const assessment = {
  questionId: "00000000-0000-4000-8000-000000000003",
  prompt: "What happened first?",
  responses: 3,
  correct: 1,
  accuracyPercent: 33.3,
  difficult: true,
};

const unsubmitted = {
  ...assessment,
  questionId: "00000000-0000-4000-8000-000000000004",
  prompt: "What happened next?",
  responses: 0,
  correct: 0,
  accuracyPercent: 0,
  difficult: false,
};

const legacy = {
  id: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  status: "ready",
  generatedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z",
  metrics: { participantCount: 8, completedCount: 3, answerCount: 3, accuracyPercent: 33.3 },
  questions: [assessment, unsubmitted],
  participants: [],
} satisfies Report;

const reportV2: ReportV2 = {
  ...legacy,
  schemaVersion: 2,
  initialAccuracy: { correct: 1, responses: 3, percent: 33.3 },
  confidenceMatrix: [],
  misconceptions: [],
  interventions: [],
  recovery: [],
  unresolvedConcepts: [],
  participation: { participants: 8, respondents: 3, percent: 37.5 },
  responseTime: { responses: 3, medianMs: 1000, p95Ms: 2000 },
  qna: { questions: 0, answered: 0, unresolved: 0 },
  participantFeedback: [],
  evidenceNote: "Session evidence only.",
};

describe("Round report analytics", () => {
  it("uses retained assessment counts for legacy accuracy and keeps absent sources unavailable", () => {
    expect(roundReportAnalytics(legacy)).toEqual({
      joined: 8,
      submissions: 3,
      participation: null,
      questions: [
        {
          id: assessment.questionId,
          prompt: assessment.prompt,
          number: 1,
          responses: 3,
          kind: "assessment",
        },
        {
          id: unsubmitted.questionId,
          prompt: unsubmitted.prompt,
          number: 2,
          responses: 0,
          kind: "assessment",
        },
      ],
      questionSummary: {
        answered: 1,
        assessmentSubmissions: 3,
        opinionSubmissions: 0,
        maximumResponses: 3,
      },
      qna: null,
      conversation: null,
      accuracy: { percent: 33.3, correct: 1, responses: 3 },
      recovery: null,
    });
    expect(roundReportAnalytics({ ...legacy, questions: [unsubmitted] }).accuracy).toBeNull();
  });

  it("keeps an empty denominator unavailable while retaining recorded channel counts", () => {
    expect(
      roundReportAnalytics({
        ...reportV2,
        metrics: { participantCount: 0, completedCount: 0, answerCount: 0, accuracyPercent: 0 },
        participation: { participants: 0, respondents: 0, percent: 0 },
        initialAccuracy: { correct: 0, responses: 0, percent: 0 },
        questions: [],
      }),
    ).toMatchObject({
      joined: 0,
      submissions: 0,
      participation: { participants: 0, respondents: 0, percent: null },
      questionSummary: { answered: 0, maximumResponses: 0 },
      qna: { questions: 0, answered: 0, unresolved: 0 },
      accuracy: null,
      recovery: null,
    });
  });

  it("displays a measured zero for response participation, assessment accuracy, and paired recovery", () => {
    const noResponses = roundReportAnalytics({
      ...reportV2,
      metrics: { participantCount: 8, completedCount: 0, answerCount: 0, accuracyPercent: 0 },
      participation: { participants: 8, respondents: 0, percent: 0 },
      initialAccuracy: { correct: 0, responses: 0, percent: 0 },
      questions: [unsubmitted],
    });
    expect(noResponses.participation).toEqual({ participants: 8, respondents: 0, percent: 0 });
    expect(noResponses.accuracy).toBeNull();

    const paired = {
      sourceQuestionId: assessment.questionId,
      recheckQuestionId: unsubmitted.questionId,
      sourceRoundId: "00000000-0000-4000-8000-000000000005",
      recheckRoundId: "00000000-0000-4000-8000-000000000006",
      evidenceType: "linked_recheck" as const,
      recovered: 0,
      initiallyIncorrectWithBoth: 2,
      recoveryPercent: 0,
      smallSample: true,
    };
    const measured = roundReportAnalytics({
      ...reportV2,
      metrics: { participantCount: 8, completedCount: 3, answerCount: 5, accuracyPercent: 0 },
      initialAccuracy: { correct: 0, responses: 3, percent: 0 },
      questions: [{ ...assessment, correct: 0, accuracyPercent: 0 }, unsubmitted],
      recovery: [paired],
    });
    expect(measured.accuracy).toEqual({ percent: 0, correct: 0, responses: 3 });
    expect(measured.recovery).toEqual({
      percent: 0,
      recovered: 0,
      denominator: 2,
      smallSample: true,
    });

    expect(
      roundReportAnalytics({
        ...reportV2,
        recovery: [{ ...paired, initiallyIncorrectWithBoth: 0, recoveryPercent: null }],
      }).recovery,
    ).toBeNull();
  });

  it("uses independent retained question and interaction totals and projects no participant or response details", () => {
    const opinion = {
      ...unsubmitted,
      prompt: "What would you change?",
      responses: 7,
      correct: null,
      accuracyPercent: null,
    };
    const report: ReportV7 = {
      ...reportV2,
      schemaVersion: 7,
      metrics: { participantCount: 8, completedCount: 7, answerCount: 12, accuracyPercent: 33.3 },
      questions: [
        assessment,
        {
          ...opinion,
          responseDistribution: {
            kind: "open_text",
            respondents: 5,
            entries: Array.from({ length: 5 }, () => ({ value: "Retained audience text" })),
          },
        },
        {
          ...opinion,
          questionId: "00000000-0000-4000-8000-000000000007",
          prompt: "Which option do you prefer?",
          responses: 1,
        },
      ],
      participants: [
        {
          participantId: "00000000-0000-4000-8000-000000000008",
          nickname: "Participant alias",
          score: 0,
          correctCount: 0,
          answerCount: 1,
        },
      ],
      participation: { participants: 8, respondents: 7, percent: 87.5 },
      qna: { questions: 7, answered: 2, unresolved: 1 },
      experience: { category: "general", preset: { id: "focus", version: 1 } },
      audiencePulse: {
        uniqueParticipants: 2,
        events: 4,
        bySignal: { got_it: 1, unsure: 1, need_example: 0, too_fast: 0 },
        contexts: [],
      },
      conversation: {
        messages: 6,
        uniqueContributors: 3,
        reactions: 4,
        reports: 0,
        removed: 0,
        moderationActions: 0,
        peakMessagesPerMinute: 4,
        transcriptAvailable: true,
      },
      decisionReplayAvailable: false,
      decisionReplayComplete: false,
      decisionTimeline: [],
    };
    const analytics = roundReportAnalytics(report);
    expect(analytics).toMatchObject({
      joined: 8,
      submissions: 12,
      participation: { participants: 8, respondents: 7, percent: 87.5 },
      questionSummary: {
        answered: 3,
        assessmentSubmissions: 3,
        opinionSubmissions: 8,
        maximumResponses: 7,
      },
      accuracy: { percent: 33.3, correct: 1, responses: 3 },
    });
    expect(analytics.questions.slice(1)).toEqual([
      { id: opinion.questionId, prompt: opinion.prompt, number: 2, responses: 7, kind: "opinion" },
      {
        id: report.questions[2]!.questionId,
        prompt: report.questions[2]!.prompt,
        number: 3,
        responses: 1,
        kind: "opinion",
      },
    ]);
    expect(analytics.qna).toEqual({ questions: 7, answered: 2, unresolved: 1 });
    expect(analytics.conversation).toEqual({
      pulseParticipants: 2,
      pulseEvents: 4,
      messages: 6,
      reactions: 4,
    });
    expect(JSON.stringify(analytics)).not.toMatch(
      /Participant alias|Retained audience text|participantId|responseDistribution/,
    );

    const opinionOnly = roundReportAnalytics({
      ...report,
      questions: report.questions.slice(1),
      initialAccuracy: { correct: 0, responses: 0, percent: null },
    });
    expect(opinionOnly.accuracy).toBeNull();
    expect(opinionOnly.questionSummary.assessmentSubmissions).toBe(0);
  });
});
