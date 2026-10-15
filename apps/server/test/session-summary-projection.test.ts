import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PresentationReportV3Schema, type ReportV7, type QuizDraft } from "@openround/contracts";
import { surveyAggregate, SurveyDraftSchema } from "@openround/contracts/surveys";
import {
  projectRoundSummary,
  projectPresentationSummary,
  projectSurveySummary,
  summaryPlainText,
} from "../src/session-summary-projection.js";

const finished = "2026-10-14T12:00:00.000Z";
function fixture() {
  const questions: QuizDraft["questions"] = [
    "single_select",
    "poll",
    "open_text",
    "word_cloud",
    "numeric",
    "ranking",
  ].map((type) => {
    const common = {
      id: randomUUID(),
      prompt: `Synthetic ${type} prompt`,
      purpose:
        type === "single_select" || type === "numeric"
          ? ("diagnostic" as const)
          : ("opinion" as const),
      confidence: "off" as const,
      delivery: "main" as const,
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 20,
      basePoints: 1000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    if (type === "open_text" || type === "word_cloud")
      return {
        ...common,
        type,
        purpose: "opinion" as const,
        maxLength: 500,
        moderation: "post_moderation" as const,
        basePoints: 0,
      };
    if (type === "numeric")
      return { ...common, type, correctValue: "3", tolerance: "0", unit: null };
    const choices = [0, 1].map((index) => ({
      id: randomUUID(),
      label: `Synthetic choice ${index}`,
      isCorrect: index === 0,
    }));
    if (type === "ranking")
      return {
        ...common,
        type,
        purpose: "opinion" as const,
        rankCount: 2,
        choices: choices.map(({ id, label }) => ({ id, label, isCorrect: false })),
        basePoints: 0,
      };
    if (type === "poll")
      return {
        ...common,
        type,
        purpose: "opinion" as const,
        maxSelections: 2,
        choices: choices.map(({ id, label }) => ({ id, label, isCorrect: false })),
        basePoints: 0,
      };
    return { ...common, type: "single_select" as const, choices };
  });
  const quiz: QuizDraft = { title: "Synthetic frozen title", description: "", questions };
  const report: ReportV7 = {
    schemaVersion: 7,
    id: randomUUID(),
    sessionId: randomUUID(),
    status: "ready",
    generatedAt: finished,
    expiresAt: "2027-01-01T00:00:00.000Z",
    metrics: { participantCount: 8, completedCount: 8, answerCount: 30, accuracyPercent: 50 },
    questions: questions.map((question, index) => ({
      questionId: question.id,
      prompt: question.prompt,
      responses: index === 1 ? 4 : 6,
      correct: question.purpose === "opinion" ? null : 3,
      accuracyPercent: question.purpose === "opinion" ? null : 50,
      difficult: false,
    })),
    participants: [
      {
        participantId: randomUUID(),
        nickname: "EXCLUDED_SYNTHETIC_IDENTITY",
        score: 0,
        correctCount: 0,
        answerCount: 0,
      },
    ],
    initialAccuracy: { correct: 6, responses: 12, percent: 50 },
    confidenceMatrix: [],
    misconceptions: [],
    interventions: [],
    recovery: [],
    unresolvedConcepts: [],
    participation: { participants: 8, respondents: 8, percent: 100 },
    responseTime: { responses: 30, medianMs: 3, p95Ms: 10 },
    qna: { questions: 0, answered: 0, unresolved: 0 },
    participantFeedback: Array.from({ length: 6 }, () => ({
      participantId: randomUUID(),
      correct: 1,
      responses: 2,
      unresolvedConcepts: [],
    })),
    evidenceNote: "EXCLUDED_PRIVATE_NOTE",
    experience: { category: "business", preset: { id: "focus", version: 1 } },
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
      transcriptAvailable: true,
    },
    decisionReplayAvailable: false,
    decisionReplayComplete: false,
    decisionTimeline: [],
  };
  return { quiz, report };
}

describe("public summary projection", () => {
  it("excludes identities and all participant text, including moderated cloud terms", () => {
    const { quiz, report } = fixture();
    report.questions[2]!.responseDistribution = {
      kind: "open_text",
      respondents: 6,
      entries: Array.from({ length: 6 }, () => ({ value: "EXCLUDED_SYNTHETIC_BODY" })),
    };
    report.questions[3]!.responseDistribution = {
      kind: "word_cloud",
      respondents: 6,
      buckets: [
        {
          value: "EXCLUDED_SYNTHETIC_TERM",
          label: "EXCLUDED_SYNTHETIC_TERM",
          count: 6,
          percent: 100,
        },
      ],
    };
    const summary = projectRoundSummary(report, quiz, finished);
    expect(JSON.stringify(summary)).not.toMatch(
      /EXCLUDED|participantId|questionId|sessionId|responseTime/,
    );
    expect(summary.questions[1]).toMatchObject({
      respondents: null,
      accuracy: null,
      results: [],
      suppression: "insufficient_sample",
    });
    expect(summary.questions[2]).toMatchObject({
      accuracy: null,
      results: [],
      suppression: "participant_text",
    });
    expect(summary.initialAccuracy).toEqual({ correct: 6, responses: 12, percent: 50 });
    report.participantFeedback = report.participantFeedback.slice(0, 4);
    expect(projectRoundSummary(report, quiz, finished).initialAccuracy).toBeNull();
  });

  it("keeps weighted rankings and paired linked/revote recovery denominators distinct", () => {
    const { quiz, report } = fixture();
    report.questions[5]!.responseDistribution = {
      kind: "ranking",
      respondents: 6,
      rankCount: 2,
      totalRankings: 12,
      buckets: [
        {
          value: randomUUID(),
          label: "Synthetic ranked choice",
          weightedScore: 9,
          rankedRespondents: 6,
          averageRank: 1.5,
        },
      ],
    };
    report.recovery = ["linked_recheck", "revote", "linked_recheck"].map((evidenceType, index) => ({
      sourceQuestionId: quiz.questions[0]!.id,
      recheckQuestionId: randomUUID(),
      sourceRoundId: randomUUID(),
      recheckRoundId: randomUUID(),
      evidenceType: evidenceType as "linked_recheck" | "revote",
      recovered: 3,
      initiallyIncorrectWithBoth: index === 2 ? 4 : 6,
      recoveryPercent: 50,
      smallSample: index === 2,
    }));
    const summary = projectRoundSummary(report, quiz, finished);
    expect(summary.questions[5]).toMatchObject({
      measure: "weighted_points",
      results: [{ label: "Synthetic ranked choice", value: 9 }],
    });
    expect(
      summary.recovery.map(({ kind, eligible, recovered, percent }) => ({
        kind,
        eligible,
        recovered,
        percent,
      })),
    ).toEqual([
      { kind: "linked", eligible: 6, recovered: 3, percent: 50 },
      { kind: "revote", eligible: 6, recovered: 3, percent: 50 },
    ]);
  });

  it("keeps Presentation content unassessed and does not invent missing distributions", () => {
    const report = PresentationReportV3Schema.parse({
      schemaVersion: 3,
      sessionId: randomUUID(),
      artifactType: "presentation",
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: "Synthetic presentation",
      status: "finished",
      participantCount: 8,
      responseCount: 6,
      leaderboard: [],
      evidence: [
        {
          kind: "content",
          blockId: randomUUID(),
          blockIndex: 0,
          title: "Synthetic content",
          assessmentStatus: "not_assessed",
        },
        {
          kind: "question",
          blockId: randomUUID(),
          blockIndex: 1,
          questionId: randomUUID(),
          prompt: "Synthetic poll",
          questionType: "poll",
          questionTypeLabel: "Poll",
          delivery: "main",
          respondents: 6,
          correct: null,
          accuracyPercent: null,
          totalScore: 0,
          averageResponseMs: 3,
          sessionOnly: "quick_check",
        },
      ],
      recovery: [],
      timeline: [],
      evidenceNote: "Synthetic note",
      createdAt: finished,
      finishedAt: finished,
    });
    const summary = projectPresentationSummary(report);
    expect(summary.initialAccuracy).toBeNull();
    expect(summary.questions[0]).toMatchObject({ purpose: "content", accuracy: null, results: [] });
    expect(summary.questions[1]).toMatchObject({
      purpose: "opinion",
      accuracy: null,
      respondents: 6,
      results: [],
    });
  });

  it("preserves Survey suppression and authored multiselect labels", () => {
    const id = randomUUID(),
      choice = randomUUID();
    const content = SurveyDraftSchema.parse({
      schemaVersion: 2,
      title: "Synthetic survey",
      items: [
        {
          required: false,
          question: {
            ...fixture().quiz.questions[1],
            id,
            type: "poll",
            prompt: "Synthetic poll",
            choices: [
              { id: choice, label: "=1+1", isCorrect: false },
              { id: randomUUID(), label: "Synthetic alternative", isCorrect: false },
            ],
            maxSelections: 2,
          },
        },
      ],
    });
    const responses = Array.from({ length: 5 }, () => ({
      [id]: { kind: "poll" as const, choiceIds: [choice] },
    }));
    const summary = projectSurveySummary(surveyAggregate(content, responses, true), finished);
    expect(summary.questions[0]).toMatchObject({
      purpose: "opinion",
      maxSelections: 2,
      measure: "respondents",
      accuracy: null,
      results: [
        { label: "=1+1", value: 5 },
        { label: "Synthetic alternative", value: 0 },
      ],
    });
    expect(
      projectSurveySummary(surveyAggregate(content, responses.slice(0, 4), true), finished)
        .questions[0],
    ).toMatchObject({ respondents: null, results: [], suppression: "insufficient_sample" });
  });

  it("preserves plain text and emoji while removing spoofing and invalid controls", () => {
    expect(summaryPlainText("  <b>Français 日本語 👩‍💻</b>\u202e\u0000\ufffe\uffff\ud800  ")).toBe(
      "<b>Français 日本語 👩‍💻</b>\ufffd",
    );
  });
});
