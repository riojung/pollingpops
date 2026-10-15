import { describe, expect, it } from "vitest";
import {
  AggregateSessionSummarySchema,
  CreateSummaryShareSchema,
  PublicSummaryExportRequestSchema,
  SummaryExportRequestSchema,
  SummaryQuestionSchema,
  type AggregateSessionSummary,
} from "../src/index";

function fixture(): AggregateSessionSummary {
  return {
    schemaVersion: 1,
    kind: "survey",
    title: "Synthetic summary",
    finishedAt: "2026-10-14T12:00:00.000Z",
    minimumRespondents: 5,
    participantCount: 8,
    responseCount: 8,
    questionCount: 1,
    initialAccuracy: null,
    recovery: [],
    nextSteps: "",
    noteCodes: ["aggregate_only"],
    questions: [
      {
        index: 0,
        prompt: "Synthetic authored prompt",
        type: "poll",
        purpose: "opinion",
        respondents: 8,
        accuracy: null,
        suppression: "none",
        measure: "respondents",
        maxSelections: 2,
        results: [{ label: "Synthetic choice", value: 5 }],
      },
    ],
  };
}

describe("aggregate session summary boundary", () => {
  it("rejects identity, transcript, source and credential fields at every level", () => {
    const summary = fixture();
    for (const field of [
      "participants",
      "sessionId",
      "workspaceId",
      "tokenHash",
      "timeline",
      "transcript",
    ])
      expect(
        AggregateSessionSummarySchema.safeParse({ ...summary, [field]: "excluded" }).success,
      ).toBe(false);
    for (const field of ["participantId", "questionId", "entries", "rawResponse"])
      expect(
        SummaryQuestionSchema.safeParse({ ...summary.questions[0], [field]: "excluded" }).success,
      ).toBe(false);
    expect(
      AggregateSessionSummarySchema.safeParse({
        ...summary,
        questions: [
          {
            ...summary.questions[0],
            results: [{ label: "Synthetic choice", value: 5, participantId: "excluded" }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("cannot carry low-sample, suppressed or unscored accuracy/distribution evidence", () => {
    const question = fixture().questions[0]!;
    for (const patch of [
      { respondents: 4 },
      { suppression: "participant_text" },
      { suppression: "insufficient_sample" },
      { respondents: null },
      { accuracy: { correct: 5, responses: 8, percent: 62.5 } },
    ])
      expect(SummaryQuestionSchema.safeParse({ ...question, ...patch }).success).toBe(false);
    expect(
      SummaryQuestionSchema.safeParse({
        ...question,
        suppression: "insufficient_sample",
        respondents: null,
        results: [],
      }).success,
    ).toBe(true);
    expect(
      AggregateSessionSummarySchema.safeParse({
        ...fixture(),
        recovery: [
          { kind: "linked", label: "Synthetic prompt", eligible: 4, recovered: 3, percent: 75 },
        ],
      }).success,
    ).toBe(false);
    expect(
      AggregateSessionSummarySchema.safeParse({
        ...fixture(),
        initialAccuracy: { correct: 6, responses: 5, percent: 100 },
      }).success,
    ).toBe(false);
  });

  it("bounds publication intent and accepts only supported export formats/locales", () => {
    const idempotencyKey = "00000000-0000-4000-8000-000000000001";
    expect(CreateSummaryShareSchema.parse({ idempotencyKey })).toMatchObject({
      expiresInDays: 7,
      allowDownloads: true,
      nextSteps: "",
    });
    for (const expiresInDays of [0, 31])
      expect(CreateSummaryShareSchema.safeParse({ idempotencyKey, expiresInDays }).success).toBe(
        false,
      );
    expect(
      CreateSummaryShareSchema.safeParse({ idempotencyKey, nextSteps: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(SummaryExportRequestSchema.safeParse({ format: "csv" }).success).toBe(false);
    for (const format of ["pdf", "xlsx"])
      expect(SummaryExportRequestSchema.safeParse({ format, questionIndex: 0 }).success).toBe(
        false,
      );
    expect(
      PublicSummaryExportRequestSchema.safeParse({ format: "png", questionIndex: 0 }).success,
    ).toBe(true);
    expect(SummaryExportRequestSchema.safeParse({ format: "pdf", locale: "en-US" }).success).toBe(
      false,
    );
    expect(
      PublicSummaryExportRequestSchema.safeParse({
        format: "pdf",
        nextSteps: "cannot change a public snapshot",
      }).success,
    ).toBe(false);
    expect(
      AggregateSessionSummarySchema.safeParse({
        ...fixture(),
        questions: [fixture().questions[0], fixture().questions[0]],
      }).success,
    ).toBe(false);
  });
});
