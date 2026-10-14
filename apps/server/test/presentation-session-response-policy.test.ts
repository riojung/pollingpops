import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  QuestionDraftSchema,
  type QuestionDraft,
} from "@openround/contracts";
import type { PresentationSessionRecord } from "@openround/db";
import {
  presentationResponseCorrect,
  presentationResponseRequestHash,
  presentationResponseScore,
  presentationResponseTiming,
  presentationResponseValidationMessage,
} from "../src/presentation-session-response-policy.js";
import { presentationParticipantBlock } from "../src/presentation-session-projections.js";

const correctChoiceId = randomUUID();
const alternateChoiceId = randomUUID();

function choiceQuestion(
  overrides: Partial<QuestionDraft> = {},
): Extract<QuestionDraft, { type: "single_select" | "true_false" | "multi_select" | "poll" }> {
  return QuestionDraftSchema.parse({
    id: randomUUID(),
    type: "single_select",
    prompt: "Choose the correct option",
    purpose: "diagnostic",
    confidence: "optional",
    delivery: "main",
    conceptKeys: ["response-policy"],
    linkedRecheckQuestionId: null,
    choices: [
      { id: correctChoiceId, label: "Correct", isCorrect: true },
      { id: alternateChoiceId, label: "Alternate", isCorrect: false },
    ],
    timeLimitSeconds: 60,
    basePoints: 1_000,
    explanation: "Because it is correct.",
    mediaId: null,
    mediaAlt: null,
    ...overrides,
  }) as Extract<QuestionDraft, { type: "single_select" | "true_false" | "multi_select" | "poll" }>;
}

function sessionFor(question: QuestionDraft, timeMode: "timed" | "flex") {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const content = PresentationContentSchema.parse({
    title: "Response policy",
    schemaVersion: 2,
    blocks: [{ id: randomUUID(), kind: "question", question }],
  });
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: content.title,
    content,
    code: "1234567",
    status: "active",
    phase: "question_open",
    currentBlockIndex: 0,
    revision: 1,
    settings: { timeMode },
    trustMode: "learning",
    eventSeq: 1,
    questionOpenedAt: now,
    questionClosesAt: new Date(now.getTime() + 60_000),
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 3_600_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  } satisfies PresentationSessionRecord;
}

describe("Presentation response policy", () => {
  it.each(["ranking", "open_text", "word_cloud"] as const)(
    "rejects %s before legacy Presentation delivery",
    (type) => {
      const common: Record<string, unknown> = { ...choiceQuestion() };
      delete common.choices;
      const question = QuestionDraftSchema.parse({
        ...common,
        type,
        purpose: "opinion",
        confidence: "off",
        basePoints: 0,
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        ...(type === "ranking"
          ? {
              choices: [
                { id: correctChoiceId, label: "One", isCorrect: false },
                { id: alternateChoiceId, label: "Two", isCorrect: false },
              ],
            }
          : {}),
      });
      const response = { choiceIds: [correctChoiceId] };
      expect(presentationResponseValidationMessage(question, response)).toContain(
        "Live Rounds only",
      );
      expect(presentationResponseCorrect(question, response)).toBeNull();
      expect(presentationResponseScore(question, true, 1)).toBe(0);
      expect(() =>
        presentationParticipantBlock({ id: randomUUID(), kind: "question", question }),
      ).toThrow("Live Rounds only");
    },
  );
  it("canonicalizes multi-select choice order without weakening the revision or payload fence", () => {
    const first = presentationResponseRequestHash({
      blockId: "block-1",
      expectedRevision: 4,
      response: { choiceIds: [correctChoiceId, alternateChoiceId], confidence: 2 },
    });
    const reordered = presentationResponseRequestHash({
      blockId: "block-1",
      expectedRevision: 4,
      response: { choiceIds: [alternateChoiceId, correctChoiceId], confidence: 2 },
    });

    expect(reordered).toBe(first);
    expect(
      presentationResponseRequestHash({
        blockId: "block-1",
        expectedRevision: 5,
        response: { choiceIds: [correctChoiceId, alternateChoiceId], confidence: 2 },
      }),
    ).not.toBe(first);
    expect(
      presentationResponseRequestHash({
        blockId: "block-1",
        expectedRevision: 4,
        response: { choiceIds: [correctChoiceId, alternateChoiceId], confidence: 3 },
      }),
    ).not.toBe(first);
  });

  it("preserves participant-facing validation for confidence, choice, numeric, and rating input", () => {
    expect(
      presentationResponseValidationMessage(choiceQuestion({ confidence: "required" }), {
        choiceIds: [correctChoiceId],
      }),
    ).toBe("Choose a confidence level before submitting");
    expect(presentationResponseValidationMessage(choiceQuestion(), { choiceIds: [] })).toBe(
      "Choose a valid response option",
    );
    expect(
      presentationResponseValidationMessage(choiceQuestion(), {
        choiceIds: [correctChoiceId, alternateChoiceId],
      }),
    ).toBe("Choose one response option");

    const numeric = QuestionDraftSchema.parse({
      id: randomUUID(),
      type: "numeric",
      prompt: "Enter a value",
      purpose: "diagnostic",
      confidence: "optional",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      correctValue: "10",
      tolerance: "0.5",
      unit: null,
      timeLimitSeconds: 60,
      basePoints: 1_000,
      explanation: "Ten is expected.",
      mediaId: null,
      mediaAlt: null,
    });
    expect(presentationResponseValidationMessage(numeric, { numericValue: " " })).toBe(
      "Enter a valid numeric response",
    );
    expect(presentationResponseValidationMessage(numeric, { numericValue: "10.25" })).toBeNull();

    const rating = QuestionDraftSchema.parse({
      id: randomUUID(),
      type: "rating",
      prompt: "Rate this",
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      min: 1,
      max: 5,
      minLabel: "Low",
      maxLabel: "High",
      timeLimitSeconds: 60,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    });
    expect(presentationResponseValidationMessage(rating, { ratingValue: 6 })).toBe(
      "Choose a rating from 1 to 5",
    );
    expect(presentationResponseValidationMessage(rating, { ratingValue: 5 })).toBeNull();
  });

  it("keeps exact-set and numeric-tolerance correctness semantics", () => {
    const multiSelect = choiceQuestion({
      type: "multi_select",
      choices: [
        { id: correctChoiceId, label: "Correct A", isCorrect: true },
        { id: alternateChoiceId, label: "Correct B", isCorrect: true },
      ],
    });
    expect(
      presentationResponseCorrect(multiSelect, {
        choiceIds: [alternateChoiceId, correctChoiceId],
      }),
    ).toBe(true);
    expect(presentationResponseCorrect(multiSelect, { choiceIds: [correctChoiceId] })).toBe(false);

    const numeric = QuestionDraftSchema.parse({
      id: randomUUID(),
      type: "numeric",
      prompt: "Enter a value",
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      correctValue: "10",
      tolerance: "0.5",
      unit: null,
      timeLimitSeconds: 60,
      basePoints: 1_000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    });
    expect(presentationResponseCorrect(numeric, { numericValue: "10.5" })).toBe(true);
    expect(presentationResponseCorrect(numeric, { numericValue: "10.51" })).toBe(false);
  });

  it("freezes receipt-time scoring while disabling speed scoring in flex mode", () => {
    const question = choiceQuestion();
    const timed = sessionFor(question, "timed");
    const receivedAt = new Date(timed.questionOpenedAt!.getTime() + 15_000);
    const timedResult = presentationResponseTiming(timed, receivedAt);
    const flexResult = presentationResponseTiming(
      { ...timed, settings: { timeMode: "flex" } },
      receivedAt,
    );

    expect(timedResult).toEqual({ responseMs: 15_000, remainingRatio: 0.75 });
    expect(presentationResponseScore(question, true, timedResult.remainingRatio)).toBe(875);
    expect(flexResult).toEqual({ responseMs: 15_000, remainingRatio: 1 });
    expect(presentationResponseScore(question, true, flexResult.remainingRatio)).toBe(1_000);
    expect(presentationResponseScore(question, false, flexResult.remainingRatio)).toBe(0);
    expect(
      presentationResponseTiming(
        { ...timed, settings: { timeMode: "flex" }, questionClosesAt: null },
        new Date(timed.questionOpenedAt!.getTime() + 90_000),
      ),
    ).toEqual({ responseMs: 90_000, remainingRatio: 1 });
  });

  it("clamps timing at both boundaries and keeps the missing-open fallback", () => {
    const question = choiceQuestion();
    const session = sessionFor(question, "timed");

    expect(
      presentationResponseTiming(session, new Date(session.questionOpenedAt!.getTime() - 1_000)),
    ).toEqual({ responseMs: 0, remainingRatio: 1 });
    expect(
      presentationResponseTiming(session, new Date(session.questionOpenedAt!.getTime() + 90_000)),
    ).toEqual({ responseMs: 60_000, remainingRatio: 0 });
    expect(presentationResponseTiming({ ...session, questionOpenedAt: null }, new Date())).toEqual({
      responseMs: 60_000,
      remainingRatio: 0,
    });
  });
});
