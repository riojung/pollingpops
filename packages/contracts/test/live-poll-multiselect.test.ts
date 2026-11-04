import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OpenRoundCheckpointSetExportSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
  QuestionDraftSchema,
  QuestionSchema,
  ReportV4Schema,
  ReportV5Schema,
  ResponsePayloadSchema,
  RoundDraftMutationSchema,
  canonicalizeResponse,
} from "../src/index.js";

function poll() {
  return {
    id: randomUUID(),
    type: "poll" as const,
    prompt: "Which topics would help?",
    maxSelections: 2,
    choices: ["Examples", "Practice", "Discussion"].map((label) => ({
      id: randomUUID(),
      label,
      isCorrect: false,
    })),
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
}

describe("multiple-selection opinion contracts", () => {
  it("retains an implicit one-choice limit and validates bounded authored poll limits", () => {
    const question = poll();
    expect(QuestionSchema.parse(question).maxSelections).toBe(2);
    const { maxSelections: _limit, ...legacy } = question;
    expect(_limit).toBe(2);
    expect(QuestionSchema.parse(legacy)).not.toHaveProperty("maxSelections");
    for (const maxSelections of [0, 4, 7, 1.5]) {
      for (const schema of [QuestionDraftSchema, QuestionSchema])
        expect(schema.safeParse({ ...question, maxSelections }).success).toBe(false);
    }
    expect(QuestionDraftSchema.safeParse({ ...question, type: "multi_select" }).success).toBe(
      false,
    );
    expect(
      QuestionDraftSchema.safeParse({
        ...question,
        type: "numeric",
        correctValue: "2",
        tolerance: "0",
        unit: null,
      }).success,
    ).toBe(false);
    expect(QuestionSchema.safeParse({ ...question, basePoints: 100 }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...question, confidence: "required" }).success).toBe(false);
    const mutation = {
      draft: { title: "Opinions", description: "", questions: [question] },
      expectedRevision: 0,
      mutationId: randomUUID(),
    };
    expect(RoundDraftMutationSchema.safeParse({ ...mutation, schemaVersion: 1 }).success).toBe(
      false,
    );
    expect(RoundDraftMutationSchema.safeParse({ ...mutation, schemaVersion: 2 }).success).toBe(
      true,
    );
  });

  it("canonicalizes unordered poll sets while rejecting repeated choices", () => {
    const question = poll();
    const choiceIds = question.choices.slice(0, 2).map((choice) => choice.id);
    expect(canonicalizeResponse({ kind: "poll", choiceIds })).toEqual(
      canonicalizeResponse({ kind: "poll", choiceIds: [...choiceIds].reverse() }),
    );
    expect(
      ResponsePayloadSchema.safeParse({ kind: "poll", choiceIds: [choiceIds[0], choiceIds[0]] })
        .success,
    ).toBe(false);
  });

  it("preserves selection limits only in native interchange version 5", () => {
    const checkpointSet = { title: "Opinions", description: "", questions: [poll()] };
    const exported = {
      format: "openround.checkpoint-set",
      exportedAt: "2026-10-13T12:00:00.000Z",
      checkpointSet,
    };
    for (const version of [1, 2, 3, 4])
      expect(OpenRoundCheckpointSetExportSchema.safeParse({ ...exported, version }).success).toBe(
        false,
      );
    expect(
      OpenRoundCheckpointSetExportSchema.parse({ ...exported, version: 5 }).checkpointSet
        .questions[0]?.maxSelections,
    ).toBe(2);
    expect(OpenRoundCheckpointSetExportSchema.safeParse({ ...exported, version: 8 }).success).toBe(
      false,
    );
  });

  it("requires explicit Presentation version 9 before retaining an opinion selection limit", () => {
    const presentation = {
      title: "Opinions",
      schemaVersion: 2,
      blocks: [{ id: randomUUID(), kind: "question", question: poll() }],
    };
    for (const schema of [PresentationDraftSchema, PresentationContentSchema]) {
      for (const schemaVersion of [2, 3, 4, 5, 6, 7, 8]) {
        const result = schema.safeParse({ ...presentation, schemaVersion });
        expect(result.success).toBe(false);
        if (!result.success)
          expect(
            result.error.issues.some((issue) =>
              issue.message.includes("Presentation schema version 9"),
            ),
          ).toBe(true);
      }
      const supported = schema.parse({ ...presentation, schemaVersion: 9 });
      expect(supported.blocks[0]).toMatchObject({ question: { type: "poll", maxSelections: 2 } });
      expect(schema.safeParse({ ...presentation, schemaVersion: 10 }).success).toBe(false);
      for (const type of ["open_text", "word_cloud"]) {
        const { choices, maxSelections, ...fields } = poll();
        expect(choices).toHaveLength(3);
        expect(maxSelections).toBe(2);
        const question = { ...fields, type };
        expect(QuestionDraftSchema.safeParse(question).success).toBe(true);
        expect(QuestionSchema.safeParse(question).success).toBe(true);
        const unsupported = schema.safeParse({
          ...presentation,
          schemaVersion: 9,
          blocks: [{ ...presentation.blocks[0]!, question }],
        });
        expect(unsupported.success).toBe(false);
        if (!unsupported.success)
          expect(
            unsupported.error.issues.some((issue) =>
              issue.message.includes("Text opinions are not supported"),
            ),
          ).toBe(true);
      }
    }
  });

  it("represents unassessed opinion correctness in report version 5 without widening old reports", () => {
    const questions = [
      {
        questionId: randomUUID(),
        prompt: "Which topics?",
        responses: 5,
        correct: null,
        accuracyPercent: null,
        difficult: false,
      },
    ];
    expect(ReportV5Schema.shape.questions.parse(questions)).toEqual(questions);
    expect(ReportV4Schema.shape.questions.safeParse(questions).success).toBe(false);
    const metrics = {
      participantCount: 5,
      completedCount: 5,
      answerCount: 5,
      accuracyPercent: null,
    };
    expect(ReportV5Schema.shape.metrics.parse(metrics)).toEqual(metrics);
    expect(ReportV4Schema.shape.metrics.safeParse(metrics).success).toBe(false);
    expect(
      ReportV5Schema.shape.initialAccuracy.parse({ correct: 0, responses: 0, percent: null }),
    ).toEqual({ correct: 0, responses: 0, percent: null });
  });
});
