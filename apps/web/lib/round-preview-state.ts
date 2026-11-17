import {
  normalizeDecimalString,
  type ConfidenceValue,
  type QuestionDraft,
} from "@openround/contracts";
import { initialRanking, rankingCount } from "./ranking-response";
import { isTextQuestion, textResponseError } from "./text-response";

/** Rehearsal state stays in memory and is never a live response payload. */
export interface RoundPreviewResponse {
  choices: string[];
  text: string;
  rating: number | null;
  confidence: ConfidenceValue | null;
  submitted: boolean;
}

export function initialPreviewResponse(question: QuestionDraft): RoundPreviewResponse {
  return {
    choices: question.type === "ranking" ? initialRanking(question) : [],
    text: "",
    rating: null,
    confidence: null,
    submitted: false,
  };
}

export function togglePreviewChoice(
  question: QuestionDraft,
  selected: string[],
  choiceId: string,
): string[] {
  if (!("choices" in question) || !question.choices.some((choice) => choice.id === choiceId))
    return selected;
  if (question.type !== "multi_select" && question.type !== "poll") return [choiceId];
  if (selected.includes(choiceId)) return selected.filter((id) => id !== choiceId);
  const limit = question.type === "poll" ? (question.maxSelections ?? 1) : question.choices.length;
  if (limit === 1) return [choiceId];
  return selected.length < limit ? [...selected, choiceId] : selected;
}

/** Live Round confidence is always optional when enabled, even for legacy authored required values. */
export function canCheckPreviewAnswer(question: QuestionDraft, response: RoundPreviewResponse) {
  if (response.submitted) return false;
  if (isTextQuestion(question.type))
    return textResponseError(question.type, response.text) === null;
  if (question.type === "numeric") {
    if (response.text.trim().length > 64) return false;
    try {
      normalizeDecimalString(response.text);
      return true;
    } catch {
      return false;
    }
  }
  if (question.type === "rating")
    return (
      response.rating !== null && response.rating >= question.min && response.rating <= question.max
    );
  if (question.type === "ranking") return response.choices.length === rankingCount(question);
  return response.choices.length > 0;
}
