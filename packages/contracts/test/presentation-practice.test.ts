import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  presentationPracticeEligibility,
  CreatePresentationPracticeAssignmentSchema,
  PresentationPracticeProgressSchema,
  PresentationPracticeAttemptSchema,
  PresentationPracticePreviewSchema,
  PresentationPracticeInsightsSchema,
} from "../src/index.js";

function content() {
  return PresentationContentSchema.parse({
    schemaVersion: 2,
    title: "Practice checks",
    blocks: [
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: randomUUID(),
          type: "single_select",
          prompt: "Choose one",
          explanation: "Personal explanation",
          timeLimitSeconds: 30,
          basePoints: 1000,
          mediaId: null,
          mediaAlt: null,
          choices: [
            { id: randomUUID(), label: "A", isCorrect: true },
            { id: randomUUID(), label: "B", isCorrect: false },
          ],
        },
      },
    ],
  });
}
describe("Presentation practice contracts", () => {
  it("requires explicit bounded choice practice without silently dropping other activities", () => {
    const source = content();
    expect(presentationPracticeEligibility(source).eligible).toBe(true);
    const block = source.blocks[0]!;
    if (block.kind !== "question") throw new Error("Expected question");
    block.question.purpose = "practice";
    block.question.confidence = "optional";
    expect(presentationPracticeEligibility(source).eligible).toBe(true);
    block.question.confidence = "required";
    expect(presentationPracticeEligibility(source).eligible).toBe(false);
    block.question.confidence = "off";
    block.question.linkedRecheckQuestionId = randomUUID();
    expect(presentationPracticeEligibility(source).eligible).toBe(false);
    expect(presentationPracticeEligibility({ blocks: [] }).eligible).toBe(false);
    expect(
      presentationPracticeEligibility({
        blocks: Array.from({ length: 26 }, () => structuredClone(block)),
      }).eligible,
    ).toBe(false);
    expect(
      presentationPracticeEligibility({
        blocks: Array.from({ length: 51 }, () => structuredClone(block)),
      }).eligible,
    ).toBe(false);
  });
  it("rejects ambiguous legacy UUID spelling without rewriting publications", () => {
    const source = content(),
      block = source.blocks[0]!;
    if (block.kind !== "question" || !("choices" in block.question))
      throw new Error("Expected choice question");
    block.question.choices[1]!.id = block.question.choices[0]!.id.toUpperCase();
    expect(presentationPracticeEligibility(source).eligible).toBe(false);
    const pages = content();
    pages.blocks.push({
      ...structuredClone(pages.blocks[0]!),
      id: pages.blocks[0]!.id.toUpperCase(),
    });
    expect(presentationPracticeEligibility(pages).eligible).toBe(false);
  });
  it("permits only a choice identifier in answer requests and keeps read/complete distinct", () => {
    const answer = {
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "answer",
      blockId: randomUUID(),
      choiceId: randomUUID(),
    };
    expect(PresentationPracticeProgressSchema.safeParse(answer).success).toBe(true);
    for (const field of ["correct", "feedback", "score", "response", "confidence", "token"])
      expect(
        PresentationPracticeProgressSchema.safeParse({ ...answer, [field]: true }).success,
      ).toBe(false);
    expect(PresentationPracticeProgressSchema.safeParse({ ...answer, kind: "read" }).success).toBe(
      false,
    );
    expect(
      PresentationPracticeProgressSchema.safeParse({ ...answer, expectedRevision: 101 }).success,
    ).toBe(false);
    expect(
      CreatePresentationPracticeAssignmentSchema.safeParse({
        token: "a".repeat(43),
        requestId: randomUUID(),
        versionId: randomUUID(),
        expiresAt: new Date().toISOString(),
        mode: "reading",
      }).success,
    ).toBe(false);
  });
  it("validates private accepted-answer consistency without accepting credential fields", () => {
    const blockId = randomUUID(),
      choiceId = randomUUID(),
      now = new Date().toISOString();
    const value = {
      id: randomUUID(),
      assignmentId: randomUUID(),
      revision: 1,
      readBlockIds: [blockId],
      currentBlockId: blockId,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      answers: [
        {
          blockId,
          choiceId,
          correct: true,
          submittedAt: now,
          feedback: { correctChoiceId: choiceId, explanation: null, selectedFeedback: null },
        },
      ],
    };
    expect(PresentationPracticeAttemptSchema.safeParse(value).success).toBe(true);
    expect(
      PresentationPracticeAttemptSchema.safeParse({ ...value, readBlockIds: [] }).success,
    ).toBe(false);
    expect(
      PresentationPracticeAttemptSchema.safeParse({
        ...value,
        answers: [...value.answers, ...value.answers],
      }).success,
    ).toBe(false);
    expect(
      PresentationPracticeAttemptSchema.safeParse({ ...value, tokenHash: "secret" }).success,
    ).toBe(false);
    expect(
      PresentationPracticeAttemptSchema.safeParse({
        ...value,
        answers: [{ ...value.answers[0], correct: false }],
      }).success,
    ).toBe(false);
  });
  it("rejects preview keys and non-practice activity DTOs", () => {
    const source = content(),
      block = source.blocks[0]!;
    if (block.kind !== "question" || !("choices" in block.question))
      throw new Error("Expected choices");
    const now = new Date().toISOString(),
      versionId = randomUUID();
    const value = {
      assignment: {
        id: randomUUID(),
        mode: "practice",
        versionId,
        createdAt: now,
        expiresAt: now,
        revokedAt: null,
      },
      review: {
        schemaVersion: 1,
        versionId,
        version: 1,
        title: source.title,
        sections: [],
        expiresAt: now,
        blocks: [
          {
            id: block.id,
            kind: "question",
            question: {
              type: "single_select",
              prompt: "Choose one",
              mediaId: null,
              mediaAlt: null,
              choices: block.question.choices.map(({ id, label }) => ({ id, label })),
            },
          },
        ],
      },
    };
    expect(PresentationPracticePreviewSchema.safeParse(value).success).toBe(true);
    const q = value.review.blocks[0]!;
    for (const key of ["correctChoiceId", "explanation", "feedback", "isCorrect"])
      expect(
        PresentationPracticePreviewSchema.safeParse({
          ...value,
          review: {
            ...value.review,
            blocks: [{ ...q, question: { ...q.question, [key]: "secret" } }],
          },
        }).success,
      ).toBe(false);
    expect(
      PresentationPracticePreviewSchema.safeParse({
        ...value,
        review: { ...value.review, blocks: [{ ...q, question: { ...q.question, type: "poll" } }] },
      }).success,
    ).toBe(false);
  });
  it("suppresses small creator samples and complementary completion cells", () => {
    const now = new Date().toISOString();
    const base = {
      schemaVersion: 1,
      assignment: {
        id: randomUUID(),
        mode: "practice",
        versionId: randomUUID(),
        createdAt: now,
        expiresAt: now,
        revokedAt: null,
      },
      generatedAt: now,
      minimumAttempts: 5,
      startedAttempts: 10,
      completedAttempts: 5,
      inProgressAttempts: 5,
    };
    expect(PresentationPracticeInsightsSchema.safeParse(base).success).toBe(true);
    expect(
      PresentationPracticeInsightsSchema.safeParse({
        ...base,
        startedAttempts: null,
        completedAttempts: null,
        inProgressAttempts: null,
      }).success,
    ).toBe(true);
    for (const change of [
      { startedAttempts: 4 },
      { completedAttempts: 1, inProgressAttempts: 9 },
      { completedAttempts: null },
      { startedAttempts: null },
      { correctCount: 5 },
    ])
      expect(PresentationPracticeInsightsSchema.safeParse({ ...base, ...change }).success).toBe(
        false,
      );
  });
});
