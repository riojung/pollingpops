import {
  PresentationContentSchema,
  QuestionSchema,
  requiresExtendedRoundResponses,
  type PresentationCompanionCommand,
} from "@openround/contracts";
import {
  publishedQuestionTextOnlyLiveEligible,
  type PresentationSessionRecord,
  type QuizVersionRecord,
} from "@openround/db";
import {
  assertPresentationLiveInsertionSize,
  presentationClosedInsertionBoundary,
  presentationLiveInsertionIndex,
} from "./presentation-live-insertion.js";
import { PresentationSessionServiceError } from "./presentation-session-errors.js";
import { recoveryPackCopyId } from "./recovery-pack-copies.js";

export function presentationCanInsertPublishedQuestion(session: PresentationSessionRecord) {
  return (
    session.content.blocks.length + 1 <= 100 &&
    (session.content.livePublishedQuestions?.length ?? 0) + 1 <= 100 &&
    presentationClosedInsertionBoundary(session)
  );
}

export function presentationPublishedQuestionInsertionTransition(
  session: PresentationSessionRecord,
  version: QuizVersionRecord,
  input: Extract<PresentationCompanionCommand, { action: "insert_published_question" }>,
) {
  const selection = input.publishedQuestion;
  if (version.contentHash !== selection.contentHash)
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "The selected published Round version hash does not match",
    );
  const matches = version.content.questions.filter(
    (question) => question.id === selection.sourceQuestionId,
  );
  const source = matches[0];
  if (source && requiresExtendedRoundResponses({ questions: [source] })) {
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "This response format currently supports live Rounds only",
    );
  }
  if (
    matches.length !== 1 ||
    !source ||
    !publishedQuestionTextOnlyLiveEligible(source, version.content.questions)
  )
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "Select one text-only standalone published question without linked recovery or Pack provenance",
    );
  const question = structuredClone(QuestionSchema.parse(source));
  const seed = `${input.commandId}:published-question:${version.id}:${source.id}`;
  const blockId = recoveryPackCopyId(`${seed}:block`);
  question.id = recoveryPackCopyId(`${seed}:question`);
  question.delivery = "main";
  question.linkedRecheckQuestionId = null;
  if ("choices" in question)
    question.choices = question.choices.map((choice, index) => ({
      ...choice,
      id: recoveryPackCopyId(`${seed}:choice:${index}:${choice.id}`),
    }));
  const insertionIndex = presentationLiveInsertionIndex(session);
  const blocks = [...session.content.blocks];
  blocks.splice(insertionIndex, 0, {
    id: blockId,
    kind: "question",
    question,
    provenance: { sourceQuizVersionId: version.id, sourceQuestionId: source.id },
  });
  const content = PresentationContentSchema.parse({
    ...session.content,
    blocks,
    livePublishedQuestions: [
      ...(session.content.livePublishedQuestions ?? []),
      {
        commandId: input.commandId,
        blockId,
        sourceQuizId: version.quizId,
        sourceQuizVersionId: version.id,
        sourceQuizVersion: version.version,
        sourceQuestionId: source.id,
        contentHash: version.contentHash,
      },
    ],
  });
  assertPresentationLiveInsertionSize(content);
  return {
    publishedQuestionSource: {
      quizId: version.quizId,
      versionId: version.id,
      contentHash: version.contentHash,
    },
    content,
    phase: "question_open" as const,
    currentBlockIndex: insertionIndex,
    status: "active" as const,
    event: { type: "question.launched" as const, blockIndex: insertionIndex, blockId },
  };
}
