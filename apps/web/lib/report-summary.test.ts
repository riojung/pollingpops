import { describe, expect, it } from "vitest";
import type { ReportV2 } from "@openround/contracts";
import { deriveRecoverySummary } from "./report-summary";

function report(patch: Partial<ReportV2> = {}): ReportV2 {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    schemaVersion: 2,
    status: "ready",
    generatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-02-01T00:00:00.000Z",
    metrics: { participantCount: 10, completedCount: 10, answerCount: 20, accuracyPercent: 60 },
    questions: [],
    participants: [],
    initialAccuracy: { correct: 6, responses: 10, percent: 60 },
    confidenceMatrix: [
      { confidence: 1, correct: 2, incorrect: 0, total: 2 },
      { confidence: 2, correct: 4, incorrect: 1, total: 5 },
      { confidence: 3, correct: 0, incorrect: 3, total: 3 },
    ],
    misconceptions: [],
    interventions: [],
    recovery: [],
    unresolvedConcepts: [],
    participation: { participants: 10, respondents: 10, percent: 100 },
    responseTime: { responses: 10, medianMs: 1000, p95Ms: 2000 },
    qna: { questions: 0, answered: 0, unresolved: 0 },
    participantFeedback: [],
    evidenceNote: "Session evidence only.",
    ...patch,
  };
}

describe("recovery summary", () => {
  it("handles a zero denominator without presenting a fake percentage", () => {
    expect(deriveRecoverySummary(report()).recoveryPercent).toBeNull();
    expect(deriveRecoverySummary(report()).nextAction).toMatch(/linked recheck/i);
  });

  it("distinguishes missing concept evidence from measured recovery and flags a small initial sample", () => {
    expect(
      deriveRecoverySummary(report({ initialAccuracy: { correct: 0, responses: 1, percent: 0 } })),
    ).toMatchObject({
      conceptEvidenceCount: 0,
      initialSmallSample: true,
      recoveryPercent: null,
    });
    expect(
      deriveRecoverySummary(
        report({
          unresolvedConcepts: [
            { conceptKey: "fractions", initiallyIncorrect: 2, recovered: 2, unresolved: 0 },
          ],
        }),
      ),
    ).toMatchObject({ conceptEvidenceCount: 1, unresolved: [], initialSmallSample: false });
    expect(
      deriveRecoverySummary(report({ initialAccuracy: { correct: 0, responses: 0, percent: 0 } }))
        .initialSmallSample,
    ).toBe(false);
  });

  it("aggregates recovery, contradictions, and ranks unresolved concepts", () => {
    const summary = deriveRecoverySummary(
      report({
        recovery: [
          {
            sourceQuestionId: "00000000-0000-4000-8000-000000000003",
            recheckQuestionId: "00000000-0000-4000-8000-000000000004",
            sourceRoundId: "00000000-0000-4000-8000-000000000005",
            recheckRoundId: "00000000-0000-4000-8000-000000000006",
            evidenceType: "linked_recheck",
            recovered: 3,
            initiallyIncorrectWithBoth: 4,
            recoveryPercent: 75,
            smallSample: true,
          },
        ],
        unresolvedConcepts: [
          { conceptKey: "secondary", initiallyIncorrect: 2, recovered: 1, unresolved: 1 },
          { conceptKey: "primary", initiallyIncorrect: 5, recovered: 1, unresolved: 4 },
        ],
      }),
    );
    expect(summary).toMatchObject({
      recovered: 3,
      denominator: 4,
      recoveryPercent: 75,
      highConfidenceWrong: 3,
      correctButUnsure: 2,
      smallSample: true,
    });
    expect(summary.topUnresolved?.conceptKey).toBe("primary");
  });
});
