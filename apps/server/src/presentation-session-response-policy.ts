import { createHash } from "node:crypto";
import {
  type PresentationSessionResponse,
  type QuestionDraft,
  presentationQuestionSupported,
  isPresentationOpinionResultQuestion,
  questionTypeDefinition,
} from "@openround/contracts";
import type { PresentationSessionRecord } from "@openround/db";
import { presentationCurrentBlock } from "./presentation-session-projections.js";

export interface PresentationResponseTiming {
  responseMs: number;
  remainingRatio: number;
}

/**
 * Canonical fingerprint for response idempotency. Choice order is intentionally normalized so a
 * retry of one multi-select answer cannot conflict merely because the client serialized it in a
 * different order. Ranking order is meaningful. Keep the legacy object shape unchanged whenever
 * no ordered response was submitted, so accepted pre-E04 receipts retain their fingerprint.
 */
export function presentationResponseRequestHash(input: {
  blockId: string;
  expectedRevision: number;
  response: PresentationSessionResponse;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        blockId: input.blockId,
        expectedRevision: input.expectedRevision,
        response: {
          choiceIds: [...(input.response.choiceIds ?? [])].sort(),
          numericValue: input.response.numericValue ?? null,
          ratingValue: input.response.ratingValue ?? null,
          confidence: input.response.confidence ?? null,
          ...(input.response.orderedChoiceIds !== undefined
            ? { orderedChoiceIds: [...input.response.orderedChoiceIds] }
            : {}),
        },
      }),
    )
    .digest("hex");
}

export function presentationResponseTiming(
  session: PresentationSessionRecord,
  receivedAt: Date,
): PresentationResponseTiming {
  const block = presentationCurrentBlock(session);
  if (block?.kind !== "question") return { responseMs: 0, remainingRatio: 0 };
  const durationMs = block.question.timeLimitSeconds * 1_000;
  if (!session.questionOpenedAt) {
    return {
      responseMs: session.settings.timeMode === "flex" ? 0 : durationMs,
      remainingRatio: session.settings.timeMode === "flex" ? 1 : 0,
    };
  }
  const elapsedMs = Math.max(0, receivedAt.getTime() - session.questionOpenedAt.getTime());
  const responseMs =
    session.settings.timeMode === "flex" ? elapsedMs : Math.min(durationMs, elapsedMs);
  return {
    responseMs,
    remainingRatio:
      session.settings.timeMode === "flex" ? 1 : Math.max(0, 1 - responseMs / durationMs),
  };
}

export function presentationResponseScore(
  question: QuestionDraft,
  correct: boolean | null,
  remainingRatio: number,
) {
  if (!correct || !questionTypeDefinition(question.type).scored) return 0;
  return Math.round(question.basePoints * (0.5 + remainingRatio * 0.5));
}

/** Returns the existing participant-facing validation message, or null for a valid response. */
export function presentationResponseValidationMessage(
  question: QuestionDraft,
  response: PresentationSessionResponse,
): string | null {
  if (!presentationQuestionSupported(question)) {
    return "This response format currently supports Live Rounds only";
  }
  if (isPresentationOpinionResultQuestion(question) && response.confidence != null) {
    return "Confidence is not collected for opinion responses";
  }
  if (question.type === "ranking") {
    const selected = response.orderedChoiceIds ?? [];
    const validIds = new Set(question.choices.map((choice) => choice.id.toLowerCase()));
    const selectedKeys = selected.map((choiceId) => choiceId.toLowerCase());
    const rankCount = question.rankCount ?? question.choices.length;
    if (
      response.choiceIds !== undefined ||
      response.numericValue !== undefined ||
      response.ratingValue !== undefined ||
      selected.length !== rankCount ||
      new Set(selectedKeys).size !== selected.length ||
      selectedKeys.some((choiceId) => !validIds.has(choiceId))
    )
      return `Rank exactly ${rankCount} different response options`;
    return null;
  }
  if (response.orderedChoiceIds !== undefined) return "Choose a valid response option";
  if (question.confidence === "required" && response.confidence == null) {
    return "Choose a confidence level before submitting";
  }
  if (question.type === "numeric") {
    const value = Number(response.numericValue);
    if (
      response.numericValue === undefined ||
      response.numericValue.trim() === "" ||
      !Number.isFinite(value)
    ) {
      return "Enter a valid numeric response";
    }
    return null;
  }
  if (question.type === "rating") {
    if (
      response.ratingValue === undefined ||
      response.ratingValue < question.min ||
      response.ratingValue > question.max
    ) {
      return `Choose a rating from ${question.min} to ${question.max}`;
    }
    return null;
  }
  const selected = response.choiceIds ?? [];
  if (!("choices" in question)) return "Unsupported Presentation response format";
  const choiceKey = isPresentationOpinionResultQuestion(question)
    ? (id: string) => id.toLowerCase()
    : (id: string) => id;
  const selectedKeys = selected.map(choiceKey);
  const validIds = new Set(question.choices.map((choice) => choiceKey(choice.id)));
  if (
    !selected.length ||
    (isPresentationOpinionResultQuestion(question) &&
      new Set(selectedKeys).size !== selected.length) ||
    selectedKeys.some((choiceId) => !validIds.has(choiceId))
  ) {
    return "Choose a valid response option";
  }
  if (question.type === "poll") {
    const maxSelections = question.maxSelections ?? 1;
    if (
      maxSelections > 1 &&
      (response.numericValue !== undefined || response.ratingValue !== undefined)
    )
      return "Choose a valid response option";
    return selected.length > maxSelections
      ? maxSelections === 1
        ? "Choose one response option"
        : `Choose up to ${maxSelections} response options`
      : null;
  }
  if (question.type !== "multi_select" && selected.length !== 1) {
    return "Choose one response option";
  }
  return null;
}

export function presentationResponseCorrect(
  question: QuestionDraft,
  response: PresentationSessionResponse,
): boolean | null {
  if (
    !presentationQuestionSupported(question) ||
    question.type === "poll" ||
    question.type === "rating" ||
    question.type === "ranking"
  )
    return null;
  if (question.type === "numeric") {
    const actual = Number(response.numericValue);
    const expected = Number(question.correctValue);
    const tolerance = Number(question.tolerance || 0);
    return Math.abs(actual - expected) <= tolerance;
  }
  const selected = new Set(response.choiceIds ?? []);
  if (!("choices" in question)) return null;
  const correct = new Set(
    question.choices.filter((choice) => choice.isCorrect).map((choice) => choice.id),
  );
  return selected.size === correct.size && [...selected].every((choiceId) => correct.has(choiceId));
}
