import {
  isPresentationOpinionResultQuestion,
  isPresentationTextResultQuestion,
  type PresentationBlock,
  type PresentationContent,
} from "@openround/contracts";
import type { PresentationSessionResponseRecord } from "@openround/db";

/** E04 compares UUID values while retaining the authored spelling in every public projection. */
export function presentationResponseMatchesBlock(block: PresentationBlock | null, blockId: string) {
  return Boolean(
    block &&
    (block.id === blockId ||
      (block.kind === "question" &&
        (isPresentationOpinionResultQuestion(block.question) ||
          isPresentationTextResultQuestion(block.question)) &&
        block.id.toLowerCase() === blockId.toLowerCase())),
  );
}

/** This is a read projection only: frozen content, stored response JSON and hashes are untouched. */
export function presentationResponseForBlock(
  block: PresentationBlock,
  response: PresentationSessionResponseRecord,
): PresentationSessionResponseRecord | undefined {
  if (!presentationResponseMatchesBlock(block, response.blockId)) return undefined;
  if (
    block.kind !== "question" ||
    !(
      isPresentationOpinionResultQuestion(block.question) ||
      isPresentationTextResultQuestion(block.question)
    )
  )
    return response;
  const choices = "choices" in block.question ? block.question.choices : [];
  const authoredChoices = new Map(choices.map(({ id }) => [id.toLowerCase(), id]));
  const authoredChoiceId = (id: string) => authoredChoices.get(id.toLowerCase()) ?? id;
  return {
    ...response,
    blockId: block.id,
    questionId: block.question.id,
    response: {
      ...response.response,
      ...(response.response.choiceIds !== undefined
        ? { choiceIds: response.response.choiceIds.map(authoredChoiceId) }
        : {}),
      ...(response.response.orderedChoiceIds !== undefined
        ? { orderedChoiceIds: response.response.orderedChoiceIds.map(authoredChoiceId) }
        : {}),
    },
  };
}

export function presentationResponsesForContent(
  content: PresentationContent,
  responses: readonly PresentationSessionResponseRecord[],
) {
  const opinionBlocks = new Map(
    content.blocks.flatMap((block) =>
      block.kind === "question" &&
      (isPresentationOpinionResultQuestion(block.question) ||
        isPresentationTextResultQuestion(block.question))
        ? [[block.id.toLowerCase(), block] as const]
        : [],
    ),
  );
  return responses.map((response) => {
    const block = opinionBlocks.get(response.blockId.toLowerCase());
    return block ? presentationResponseForBlock(block, response)! : response;
  });
}
