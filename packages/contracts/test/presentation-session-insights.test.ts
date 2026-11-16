import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationSessionInsightsSchema,
  PresentationSessionInsightsEnvelopeSchema,
  PresentationSessionInsightsQnaSchema,
  type PresentationSessionInsights,
} from "../src/index";

function fixture(): PresentationSessionInsights {
  const blockId = randomUUID();
  const totals = {
    totalBlocks: 1,
    presentedBlocks: 1,
    skippedBlocks: 0,
    unknownBlocks: 0,
    coveragePercent: 100,
  };
  return {
    schemaVersion: 1,
    sessionId: randomUUID(),
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    publishedVersion: 2,
    contentScope: "frozen_session",
    sourceReportSchemaVersion: 6,
    title: "Frozen lesson",
    minimumRespondents: 5,
    freshness: {
      finishedAt: "2026-11-05T12:00:00.000Z",
      finishedAtBasis: "finished_at",
      reportGeneratedAt: "2026-11-05T12:00:02.000Z",
      calculatedAt: "2026-11-05T12:01:00.000Z",
      retentionExpiresAt: "2026-12-05T12:00:00.000Z",
    },
    delivery: {
      basis: "navigation",
      startedAt: "2026-11-05T11:59:00.000Z",
      wallClockElapsedSeconds: 60,
      totals,
      blocks: [
        {
          blockId,
          blockIndex: 0,
          title: "Authored question",
          kind: "question",
          sectionId: null,
          status: "presented",
          purpose: "assessment",
          isSessionAddition: false,
        },
      ],
      sections: [{ sectionId: null, title: null, ...totals }],
    },
    participation: {
      joinedParticipantCount: 7,
      acceptedResponseCount: 5,
      questions: [
        {
          blockId,
          purpose: "assessment",
          status: "available",
          unavailableReason: null,
          acceptedRespondents: 5,
          joinedByRevealCount: 6,
          notRespondedByRevealCount: 1,
          responseRatePercent: 83.3,
          denominatorBasis: "joined_by_reveal",
          denominatorStatus: "recorded",
          measure: "respondents",
          maxSelections: null,
          distributionStatus: "not_applicable",
          results: [],
        },
      ],
    },
    recovery: [],
    qna: {
      status: "not_enabled",
      asOf: null,
      audienceSeq: null,
      publicQuestionCount: null,
      answeredQuestionCount: null,
      unansweredQuestionCount: null,
      upvoteCount: null,
    },
  };
}
describe("separate Presentation session insights contracts", () => {
  it("accepts a strict versioned resource and only ready envelopes with evidence", () => {
    const value = fixture();
    expect(PresentationSessionInsightsSchema.parse(value)).toEqual(value);
    expect(
      PresentationSessionInsightsEnvelopeSchema.parse({ status: "ready", insights: value }),
    ).toEqual({ status: "ready", insights: value });
    for (const status of ["pending", "failed"] as const) {
      expect(PresentationSessionInsightsEnvelopeSchema.parse({ status, insights: null })).toEqual({
        status,
        insights: null,
      });
      expect(
        PresentationSessionInsightsEnvelopeSchema.safeParse({ status, insights: value }).success,
      ).toBe(false);
    }
    expect(
      PresentationSessionInsightsEnvelopeSchema.safeParse({ status: "ready", insights: null })
        .success,
    ).toBe(false);
  });
  it("rejects private or duplicated assessment evidence even when nested", () => {
    const value = fixture();
    for (const change of [
      { ...value, participantIds: [randomUUID()] },
      { ...value, leaderboard: [] },
      { ...value, notes: "Private note" },
      { ...value, participation: { ...value.participation, uniqueResponders: 5 } },
      {
        ...value,
        participation: {
          ...value.participation,
          questions: [
            {
              ...value.participation.questions[0],
              accuracy: { correct: 4, responses: 5, percent: 80 },
            },
          ],
        },
      },
      { ...value, qna: { ...value.qna, body: "Audience authored body" } },
    ])
      expect(PresentationSessionInsightsSchema.safeParse(change).success).toBe(false);
  });
  it("requires distinct matching block, section and participation coverage", () => {
    for (const mutate of [
      (value: PresentationSessionInsights) => {
        value.delivery.blocks.push({
          ...value.delivery.blocks[0]!,
          blockId: value.delivery.blocks[0]!.blockId.toUpperCase(),
        });
      },
      (value: PresentationSessionInsights) => {
        value.delivery.totals.coveragePercent = 50;
      },
      (value: PresentationSessionInsights) => {
        value.delivery.sections[0]!.presentedBlocks = 0;
      },
      (value: PresentationSessionInsights) => {
        value.participation.questions[0]!.blockId = randomUUID();
      },
    ]) {
      const value = fixture();
      mutate(value);
      expect(PresentationSessionInsightsSchema.safeParse(value).success).toBe(false);
    }
  });
  it("requires null legacy coverage and exact reveal-based rates with distinct known zero", () => {
    const value = fixture();
    value.delivery.basis = "recorded_timeline";
    value.delivery.blocks[0]!.status = "unknown";
    value.delivery.totals = {
      totalBlocks: 1,
      presentedBlocks: 0,
      skippedBlocks: 0,
      unknownBlocks: 1,
      coveragePercent: null,
    };
    value.delivery.sections = [{ sectionId: null, title: null, ...value.delivery.totals }];
    expect(PresentationSessionInsightsSchema.safeParse(value).success).toBe(true);
    value.delivery.totals.coveragePercent = 0;
    expect(PresentationSessionInsightsSchema.safeParse(value).success).toBe(false);
    const zero = fixture();
    Object.assign(zero.participation.questions[0]!, {
      acceptedRespondents: 0,
      joinedByRevealCount: 0,
      notRespondedByRevealCount: 0,
      responseRatePercent: null,
    });
    expect(PresentationSessionInsightsSchema.safeParse(zero).success).toBe(true);
    zero.participation.questions[0]!.responseRatePercent = 0;
    expect(PresentationSessionInsightsSchema.safeParse(zero).success).toBe(false);
  });
  it("enforces minimum-five privacy and blocks counts/results inside suppressed evidence", () => {
    const value = fixture();
    value.participation.questions[0]!.acceptedRespondents = 4;
    expect(PresentationSessionInsightsSchema.safeParse(value).success).toBe(false);
    const question = value.participation.questions[0]!;
    Object.assign(question, {
      status: "suppressed",
      unavailableReason: "insufficient_sample",
      acceptedRespondents: null,
      joinedByRevealCount: null,
      notRespondedByRevealCount: null,
      responseRatePercent: null,
      denominatorBasis: "unavailable",
      denominatorStatus: "suppressed",
    });
    expect(PresentationSessionInsightsSchema.safeParse(value).success).toBe(true);
    question.results = [{ label: "Leaking bucket", value: 1 }];
    expect(PresentationSessionInsightsSchema.safeParse(value).success).toBe(false);
  });
  it("requires explicit adequate distribution availability without replacing accepted participation evidence", () => {
    const value = fixture();
    const question = value.participation.questions[0]!;
    question.purpose = "opinion";
    value.delivery.blocks[0]!.purpose = "opinion";
    question.distributionStatus = "unavailable";
    expect(PresentationSessionInsightsSchema.safeParse(value).success).toBe(true);
    question.distributionStatus = "available";
    expect(PresentationSessionInsightsSchema.safeParse(value).success).toBe(false);
    question.results = [
      { label: "First", value: 3 },
      { label: "Second", value: 2 },
    ];
    expect(PresentationSessionInsightsSchema.safeParse(value).success).toBe(true);
    question.distributionStatus = "unavailable";
    expect(PresentationSessionInsightsSchema.safeParse(value).success).toBe(false);
  });
  it("accepts thresholded public Q&A counts while suppressing all nonpublic or small-sample counts", () => {
    const qna = {
      status: "available",
      asOf: "2026-11-05T12:00:00.000Z",
      audienceSeq: 10,
      publicQuestionCount: 5,
      answeredQuestionCount: 2,
      unansweredQuestionCount: 3,
      upvoteCount: 12,
    };
    expect(PresentationSessionInsightsQnaSchema.safeParse(qna).success).toBe(true);
    for (const change of [
      { publicQuestionCount: 4, unansweredQuestionCount: 2 },
      { status: "suppressed" },
      { status: "unavailable" },
      { answeredQuestionCount: 6 },
      { hiddenQuestionCount: 3 },
    ])
      expect(PresentationSessionInsightsQnaSchema.safeParse({ ...qna, ...change }).success).toBe(
        false,
      );
    expect(
      PresentationSessionInsightsQnaSchema.safeParse({
        ...qna,
        publicQuestionCount: 0,
        answeredQuestionCount: 0,
        unansweredQuestionCount: 0,
        upvoteCount: 0,
      }).success,
    ).toBe(true);
  });
});
