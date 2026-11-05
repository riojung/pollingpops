import {
  isPresentationOpinionResultQuestion,
  isPresentationTextResultQuestion,
  type PresentationBlock,
  type PresentationContent,
  type PresentationSessionResponse,
  type QuestionDraft,
} from "@openround/contracts";
import type { PresentationSessionResponseRecord } from "@openround/db";

/** Opinion formats and v12 compare UUID values while projecting their authored spelling. */
export function presentationResponseMatchesBlock(
  block: PresentationBlock | null,
  blockId: string,
  semanticIds = false,
) {
  return Boolean(
    block &&
    (block.id === blockId ||
      (block.kind === "question" &&
        (semanticIds ||
          isPresentationOpinionResultQuestion(block.question) ||
          isPresentationTextResultQuestion(block.question)) &&
        block.id.toLowerCase() === blockId.toLowerCase())),
  );
}

/** Resolve v12 response choices to frozen authored UUIDs before validation and scoring. */
export function presentationAuthoredResponse(
  question: QuestionDraft,
  response: PresentationSessionResponse,
): PresentationSessionResponse {
  const choices = "choices" in question ? question.choices : [];
  const authoredChoices = new Map(choices.map(({ id }) => [id.toLowerCase(), id]));
  const authoredChoiceId = (id: string) => authoredChoices.get(id.toLowerCase()) ?? id;
  return {
    ...response,
    ...(response.choiceIds !== undefined
      ? { choiceIds: response.choiceIds.map(authoredChoiceId) }
      : {}),
    ...(response.orderedChoiceIds !== undefined
      ? { orderedChoiceIds: response.orderedChoiceIds.map(authoredChoiceId) }
      : {}),
  };
}

/** This is a read projection only: frozen content, stored response JSON and hashes are untouched. */
export function presentationResponseForBlock(
  block: PresentationBlock,
  response: PresentationSessionResponseRecord,
  semanticIds = false,
): PresentationSessionResponseRecord | undefined {
  if (!presentationResponseMatchesBlock(block, response.blockId, semanticIds)) return undefined;
  if (
    block.kind !== "question" ||
    !(
      semanticIds ||
      isPresentationOpinionResultQuestion(block.question) ||
      isPresentationTextResultQuestion(block.question)
    )
  )
    return response;
  return {
    ...response,
    blockId: block.id,
    questionId: block.question.id,
    response: presentationAuthoredResponse(block.question, response.response),
  };
}

export function presentationResponsesForContent(
  content: PresentationContent,
  responses: readonly PresentationSessionResponseRecord[],
) {
  const semanticIds = content.schemaVersion >= 12;
  const opinionBlocks = new Map(
    content.blocks.flatMap((block) =>
      block.kind === "question" &&
      (semanticIds ||
        isPresentationOpinionResultQuestion(block.question) ||
        isPresentationTextResultQuestion(block.question))
        ? [[block.id.toLowerCase(), block] as const]
        : [],
    ),
  );
  return responses.map((response) => {
    const block = opinionBlocks.get(response.blockId.toLowerCase());
    return block ? presentationResponseForBlock(block, response, semanticIds)! : response;
  });
}
