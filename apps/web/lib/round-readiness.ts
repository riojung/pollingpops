import {
  QuizContentSchema,
  TEXT_RESPONSE_MAX_QUESTIONS,
  isTextOpinionQuestion,
  type QuizDraft,
} from "@openround/contracts";
import { isChoiceQuestion } from "../components/editor/types";

export interface RoundReadinessIssue {
  id: string;
  source: string;
  resolution: string;
  questionId?: string;
  questionIndex?: number;
}

function readableList(values: number[]) {
  if (values.length === 1) return String(values[0]);
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

export function roundReadinessIssues(draft: QuizDraft, uxBeta: boolean): RoundReadinessIssue[] {
  const issues: RoundReadinessIssue[] = [];
  const decimalPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

  if (!draft.title.trim()) {
    issues.push({
      id: "round-title",
      source: uxBeta ? "Round title" : "Checkpoint set title",
      resolution: "Enter a title before previewing or publishing.",
    });
  }

  if (draft.questions.length === 0) {
    issues.push({
      id: "questions-empty",
      source: uxBeta ? "Questions" : "Checkpoints",
      resolution: uxBeta ? "Add at least one question." : "Add at least one checkpoint.",
    });
    return issues;
  }

  if (draft.questions.filter(isTextOpinionQuestion).length > TEXT_RESPONSE_MAX_QUESTIONS)
    issues.push({
      id: "text-question-limit",
      source: "Text questions",
      resolution: `Use up to ${TEXT_RESPONSE_MAX_QUESTIONS} open-text or word-cloud questions in one Round. Split additional questions into another Round.`,
    });

  for (const [questionIndex, question] of draft.questions.entries()) {
    const actions: string[] = [];
    if (!question.prompt.trim()) {
      actions.push(uxBeta ? "enter the question prompt" : "enter the checkpoint prompt");
    }
    if (isChoiceQuestion(question)) {
      const emptyChoices = question.choices
        .map((choice, choiceIndex) => (!choice.label.trim() ? choiceIndex + 1 : null))
        .filter((choiceIndex): choiceIndex is number => choiceIndex !== null);
      if (emptyChoices.length > 0)
        actions.push(`fill answer choices ${readableList(emptyChoices)}`);

      const correctCount = question.choices.filter((choice) => choice.isCorrect).length;
      if (question.type === "multi_select" && correctCount === 0) {
        actions.push("select at least one correct answer");
      } else if (
        question.type !== "multi_select" &&
        question.type !== "poll" &&
        question.type !== "ranking" &&
        correctCount !== 1
      ) {
        actions.push("select exactly one correct answer");
      } else if ((question.type === "poll" || question.type === "ranking") && correctCount > 0) {
        actions.push("clear correct answers because opinion questions are unscored");
      }

      if (
        question.choices.some((choice) => {
          const key = choice.misconceptionKey?.trim();
          return Boolean(key && !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(key));
        })
      ) {
        actions.push("use valid private misconception keys");
      }
    } else if (question.type === "numeric") {
      if (!decimalPattern.test(question.correctValue.trim())) {
        actions.push("enter a decimal correct value without exponent notation");
      }
      if (
        !decimalPattern.test(question.tolerance.trim()) ||
        question.tolerance.trim().startsWith("-")
      ) {
        actions.push("enter a non-negative decimal tolerance without exponent notation");
      }
    }

    const invalidConcepts = (question.conceptKeys ?? []).filter(
      (key) => !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(key),
    );
    if (invalidConcepts.length > 0) {
      actions.push(
        `replace invalid concept ${invalidConcepts.join(", ")} with letters, numbers, dots, dashes, or underscores`,
      );
    }
    if (
      question.linkedRecheckQuestionId &&
      !draft.questions.some(
        (candidate) =>
          candidate.id === question.linkedRecheckQuestionId &&
          (candidate.delivery ?? "main") === "recheck",
      )
    ) {
      actions.push(
        uxBeta
          ? "choose an existing question marked as a recheck"
          : "choose an existing checkpoint marked as a recheck",
      );
    }
    if (question.mediaId && !question.mediaAlt?.trim()) {
      actions.push("describe the instructional image");
    }

    if (actions.length > 0) {
      const instruction = actions.join("; ");
      issues.push({
        id: `question-${question.id}`,
        source: `${uxBeta ? "Question" : "Checkpoint"} ${questionIndex + 1}`,
        resolution: `${instruction[0]?.toUpperCase()}${instruction.slice(1)} before previewing or publishing.`,
        questionId: question.id,
        questionIndex,
      });
    }
  }

  const strict = QuizContentSchema.safeParse(draft);
  if (!strict.success) {
    for (const [issueIndex, issue] of strict.error.issues.entries()) {
      const questionIndex = issue.path[0] === "questions" ? Number(issue.path[1]) : undefined;
      const question =
        questionIndex !== undefined && Number.isInteger(questionIndex)
          ? draft.questions[questionIndex]
          : undefined;
      if (
        (question && issues.some((existing) => existing.questionId === question.id)) ||
        (!question && issue.path[0] === "title" && issues.some(({ id }) => id === "round-title")) ||
        (!question &&
          issue.path[0] === "questions" &&
          issues.some(({ id }) => id === "questions-empty"))
      ) {
        continue;
      }
      if (
        issues.some(
          (existing) =>
            existing.questionId === question?.id && existing.resolution.includes(issue.message),
        )
      ) {
        continue;
      }
      issues.push({
        id: `schema-${issue.path.join("-") || "artifact"}-${issueIndex}`,
        source: question
          ? `${uxBeta ? "Question" : "Checkpoint"} ${questionIndex! + 1}`
          : uxBeta
            ? "Round"
            : "Checkpoint set",
        resolution: issue.message,
        ...(question ? { questionId: question.id, questionIndex } : {}),
      });
    }
  }
  return issues;
}
