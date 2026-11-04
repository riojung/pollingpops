import type {
  PresentationOpinionResultSummary,
  PresentationParticipantQuestionBlock,
  PresentationSessionResponse,
} from "@openround/contracts";
import { initialRanking, rankingCount } from "./ranking-response";

type Question = PresentationParticipantQuestionBlock["question"];

/** Keep displayed results tied to this closed block even while a client reconnects. */
export function presentationOpinionSummaryFor(
  snapshot: {
    phase: string;
    acceptingResponses: boolean;
    currentBlock: { id: string; kind: string; question?: { type: string } } | null;
    opinionSummary?: PresentationOpinionResultSummary;
  } | null,
): PresentationOpinionResultSummary | undefined {
  if (!snapshot) return undefined;
  const summary = snapshot.opinionSummary;
  return summary &&
    !snapshot.acceptingResponses &&
    ["question_reveal", "intervention", "finished"].includes(snapshot.phase) &&
    snapshot.currentBlock?.kind === "question" &&
    snapshot.currentBlock.id === summary.blockId &&
    snapshot.currentBlock.question?.type === summary.kind
    ? summary
    : undefined;
}

export function initialPresentationChoiceIds(question: Question, submitted = false): string[] {
  return question.type === "ranking" && !submitted ? initialRanking(question) : [];
}

export function presentationChoiceLimit(question: Question): number {
  return question.type === "ranking"
    ? rankingCount(question)
    : question.type === "multi_select"
      ? question.choices.length
      : question.type === "poll"
        ? (question.maxSelections ?? 1)
        : 1;
}

export function togglePresentationChoice(
  question: Question,
  selected: string[],
  id: string,
): string[] {
  if (!question.choices.some((choice) => choice.id === id)) return selected;
  const limit = presentationChoiceLimit(question);
  if (limit === 1) return [id];
  if (selected.includes(id)) return selected.filter((value) => value !== id);
  return selected.length < limit ? [...selected, id] : selected;
}

export function validPresentationChoiceSelection(question: Question, selected: string[]): boolean {
  const ids = new Set(question.choices.map((choice) => choice.id));
  const limit = presentationChoiceLimit(question);
  return (
    selected.length > 0 &&
    new Set(selected).size === selected.length &&
    selected.every((id) => ids.has(id)) &&
    (question.type === "ranking" ? selected.length === limit : selected.length <= limit)
  );
}

export function presentationChoiceResponse(
  question: Question,
  selected: string[],
): PresentationSessionResponse {
  return question.type === "ranking"
    ? { orderedChoiceIds: [...selected] }
    : { choiceIds: [...selected] };
}
