import type { QuestionDraft } from "@openround/contracts";

export type ChoiceQuestionDraft = Extract<
  QuestionDraft,
  { type: "single_select" | "true_false" | "multi_select" | "poll" | "ranking" }
>;

export type QuestionUpdater = (updater: (question: QuestionDraft) => QuestionDraft) => void;

export type ChoiceQuestionUpdater = (
  updater: (question: ChoiceQuestionDraft) => ChoiceQuestionDraft,
) => void;

export type QuestionStructuralChange = (question: QuestionDraft, message: string) => void;

export function isChoiceQuestion(question: QuestionDraft): question is ChoiceQuestionDraft {
  return ["single_select", "true_false", "multi_select", "poll", "ranking"].includes(question.type);
}

export function removeQuestionChoice(
  question: ChoiceQuestionDraft,
  choiceId: string,
): ChoiceQuestionDraft {
  const choices = question.choices.filter((choice) => choice.id !== choiceId);
  if (question.type === "ranking")
    return {
      ...question,
      choices,
      ...(question.rankCount === undefined
        ? {}
        : { rankCount: Math.min(question.rankCount, choices.length) }),
    };
  if (question.type === "poll")
    return {
      ...question,
      choices,
      ...(question.maxSelections === undefined
        ? {}
        : { maxSelections: Math.min(question.maxSelections, choices.length) }),
    };
  return { ...question, choices };
}
