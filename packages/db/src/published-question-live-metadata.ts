import {
  PresentationCompanionPublishedQuestionSchema,
  QuestionSchema,
  type QuestionDraft,
} from "@openround/contracts";
import type { QuizVersionRecord } from "./types.js";

/** A standalone live copy must not silently detach either side of a recovery sequence. */
export function publishedQuestionTextOnlyLiveEligible(
  question: QuestionDraft,
  sourceQuestions: readonly QuestionDraft[] = [],
) {
  return (
    QuestionSchema.safeParse(question).success &&
    question.mediaId == null &&
    (question.delivery ?? "main") === "main" &&
    !question.linkedRecheckQuestionId &&
    !question.recoveryPackSource &&
    !sourceQuestions.some((source) => source.linkedRecheckQuestionId === question.id)
  );
}

export function publishedQuestionMetadata(
  version: Pick<QuizVersionRecord, "id" | "quizId" | "version" | "contentHash"> & {
    content: Pick<QuizVersionRecord["content"], "title">;
  },
  question: QuestionDraft,
) {
  return PresentationCompanionPublishedQuestionSchema.parse({
    sourceQuizId: version.quizId,
    sourceQuizVersionId: version.id,
    sourceQuizVersion: version.version,
    sourceQuestionId: question.id,
    contentHash: version.contentHash,
    title: version.content.title,
    prompt: question.prompt,
    type: question.type,
  });
}

export function publishedQuestionCatalogOptions(search = "", limit = 100) {
  const normalizedSearch = search.trim();
  if (normalizedSearch.length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Published question catalogs require a bounded search and limit of 1–100");
  }
  return { search: normalizedSearch, limit };
}
