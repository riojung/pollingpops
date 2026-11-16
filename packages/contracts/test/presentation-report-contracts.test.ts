import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationReportEnvelopeSchema,
  PresentationReportV1Schema,
  PresentationReportV2Schema,
  PresentationReportV3Schema,
  PresentationReportV4Schema,
  PresentationReportSchema,
  PresentationReportWithSessionContextEnvelopeSchema,
} from "../src/index";

function reportFixture() {
  const sessionId = randomUUID();
  return {
    schemaVersion: 1 as const,
    sessionId,
    artifactType: "presentation" as const,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: "Recovery review",
    status: "finished" as const,
    trustMode: "learning" as const,
    participantCount: 2,
    responseCount: 2,
    leaderboard: [
      { id: randomUUID(), nickname: "River", score: 1_000, rank: 1 },
      { id: randomUUID(), nickname: "Sage", score: 0, rank: 2 },
    ],
    evidence: [
      {
        blockId: randomUUID(),
        blockIndex: 0,
        kind: "content" as const,
        title: "Evidence first",
        assessmentStatus: "not_assessed" as const,
      },
      {
        blockId: randomUUID(),
        blockIndex: 1,
        kind: "question" as const,
        questionId: randomUUID(),
        prompt: "Which signal should guide the next action?",
        questionType: "single_select" as const,
        questionTypeLabel: "Single choice",
        delivery: "main" as const,
        respondents: 2,
        correct: 1,
        accuracyPercent: 50,
        totalScore: 1_000,
        averageResponseMs: 2_500,
      },
    ],
    recovery: [],
    timeline: [
      {
        sequence: 1,
        type: "content.presented" as const,
        blockIndex: 0,
        blockId: randomUUID(),
        occurredAt: "2026-09-24T10:00:00.000Z",
      },
      {
        sequence: 2,
        type: "presentation.finished" as const,
        blockIndex: null,
        blockId: null,
        occurredAt: "2026-09-24T10:05:00.000Z",
      },
    ],
    evidenceNote:
      "Content slides are recorded in the facilitation timeline but are not evidence of learning.",
    createdAt: "2026-09-24T09:55:00.000Z",
    finishedAt: "2026-09-24T10:05:00.000Z",
  };
}

describe("Presentation report contracts", () => {
  it.each([1, 2, 3] as const)(
    "already supports content-only, unassessed evidence in report v%s",
    (schemaVersion) => {
      const source = reportFixture();
      const value = {
        ...source,
        schemaVersion,
        title: "Project update",
        responseCount: 0,
        leaderboard: [],
        evidence: [source.evidence[0]!],
        recovery: [],
      };
      const parsed = PresentationReportSchema.parse(value);
      expect(parsed).toEqual(value);
      expect(parsed.evidence).toEqual([
        expect.objectContaining({ kind: "content", assessmentStatus: "not_assessed" }),
      ]);
      expect(
        PresentationReportEnvelopeSchema.parse({ reportStatus: "ready", report: value }).report,
      ).toEqual(value);
    },
  );

  it("versions session-only Quick Checks without widening strict legacy report readers", () => {
    const report = reportFixture();
    const existing = report.evidence[1]!;
    const quickCheck = {
      ...existing,
      questionType: "poll",
      questionTypeLabel: "Poll",
      sessionOnly: "quick_check",
      correct: null,
      accuracyPercent: null,
      totalScore: 0,
    };
    const value = { ...report, schemaVersion: 3, evidence: [quickCheck] };
    expect(PresentationReportV3Schema.parse(value).evidence[0]).toMatchObject({
      sessionOnly: "quick_check",
      correct: null,
      accuracyPercent: null,
      totalScore: 0,
    });
    for (const extra of [
      { questionType: "single_select" },
      { delivery: "recheck" },
      { correct: 1 },
      { accuracyPercent: 50 },
      { totalScore: 1 },
    ]) {
      expect(
        PresentationReportV3Schema.safeParse({ ...value, evidence: [{ ...quickCheck, ...extra }] })
          .success,
      ).toBe(false);
    }
    expect(PresentationReportSchema.parse(value).schemaVersion).toBe(3);
    for (const schemaVersion of [1, 2] as const) {
      const schema = schemaVersion === 1 ? PresentationReportV1Schema : PresentationReportV2Schema;
      expect(schema.safeParse({ ...value, schemaVersion }).success).toBe(false);
      expect(schema.parse({ ...report, schemaVersion }).schemaVersion).toBe(schemaVersion);
    }
  });

  it("versions immutable opinion aggregates without widening older reports", () => {
    const report = reportFixture();
    const original = report.evidence[1]!;
    const opinionSummary = {
      blockId: original.blockId,
      kind: "poll",
      responseCount: 2,
      maxSelections: 2,
      totalSelections: 3,
      choices: [
        { choiceId: randomUUID(), label: "One", count: 2, percentOfRespondents: 100 },
        { choiceId: randomUUID(), label: "Two", count: 1, percentOfRespondents: 50 },
      ],
    };
    const evidence = {
      ...original,
      questionType: "poll",
      correct: null,
      accuracyPercent: null,
      totalScore: 0,
      opinionSummary,
    };
    const value = { ...report, schemaVersion: 4, evidence: [evidence] };
    expect(PresentationReportV4Schema.parse(value).evidence[0]).toMatchObject({ opinionSummary });
    expect(PresentationReportSchema.parse(value).schemaVersion).toBe(4);
    for (const [schemaVersion, schema] of [
      [1, PresentationReportV1Schema],
      [2, PresentationReportV2Schema],
      [3, PresentationReportV3Schema],
    ] as const) {
      expect(schema.safeParse({ ...value, schemaVersion }).success).toBe(false);
    }
    for (const extra of [
      { correct: 1 },
      { totalScore: 1 },
      { respondents: 1 },
      { questionType: "ranking" },
    ]) {
      expect(
        PresentationReportV4Schema.safeParse({ ...value, evidence: [{ ...evidence, ...extra }] })
          .success,
      ).toBe(false);
    }
  });

  it("accepts a strict, versioned aggregate report", () => {
    expect(PresentationReportV1Schema.parse(reportFixture())).toMatchObject({
      schemaVersion: 1,
      artifactType: "presentation",
      status: "finished",
      trustMode: "learning",
    });
  });

  it("keeps stored V1 and its default envelope strict while opting into session context", () => {
    const legacy = reportFixture();
    expect(PresentationReportV1Schema.parse(legacy)).not.toHaveProperty("timeMode");
    expect(PresentationReportV1Schema.safeParse({ ...legacy, timeMode: "flex" }).success).toBe(
      false,
    );
    expect(
      PresentationReportEnvelopeSchema.parse({ reportStatus: "ready", report: legacy }),
    ).toEqual({ reportStatus: "ready", report: legacy });
    for (const timeMode of ["timed", "flex"] as const) {
      expect(
        PresentationReportWithSessionContextEnvelopeSchema.parse({
          reportStatus: "ready",
          report: legacy,
          sessionContext: { timeMode },
        }),
      ).toMatchObject({ report: legacy, sessionContext: { timeMode } });
    }
    expect(
      PresentationReportEnvelopeSchema.safeParse({
        reportStatus: "ready",
        report: legacy,
        sessionContext: { timeMode: "flex" },
      }).success,
    ).toBe(false);
  });

  it("keeps queue state separate from the finished session status", () => {
    expect(
      PresentationReportEnvelopeSchema.parse({
        reportStatus: "pending",
        report: null,
      }),
    ).toEqual({ reportStatus: "pending", report: null });
    expect(
      PresentationReportEnvelopeSchema.parse({
        reportStatus: "pending",
        report: reportFixture(),
      }),
    ).toMatchObject({ reportStatus: "pending", report: { schemaVersion: 1 } });
    expect(
      PresentationReportEnvelopeSchema.safeParse({
        reportStatus: "ready",
        report: null,
      }).success,
    ).toBe(false);
    expect(
      PresentationReportEnvelopeSchema.safeParse({
        reportStatus: "failed",
        report: reportFixture(),
      }).success,
    ).toBe(false);
  });
});
