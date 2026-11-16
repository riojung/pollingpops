import { createHash } from "node:crypto";
import {
  RecoveryPackLiveCardSchema,
  PresentationQuickCheckInputSchema,
  PresentationPublishedQuestionSelectionSchema,
  questionDelivery,
  questionPurpose,
  type PresentationControlCommand,
  type RecoveryPackLiveCard,
} from "@openround/contracts";
import type { PresentationSessionRecord } from "@openround/db";

/** The source library is never consulted: publication and creation freeze every card. */
export function frozenPresentationRecoveryPackCards(
  session: PresentationSessionRecord,
): RecoveryPackLiveCard[] {
  const block = session.content.blocks[session.currentBlockIndex];
  if (
    !session.recoveryPackCardsEnabled ||
    block?.kind !== "question" ||
    questionDelivery(block.question) !== "main" ||
    questionPurpose(block.question) !== "diagnostic" ||
    session.content.blocks.filter(
      (item) => item.kind === "question" && item.question.id === block.question.id,
    ).length !== 1
  )
    return [];
  const insertions = session.content.recoveryPackInsertions ?? [];
  const owners = insertions.filter((item) => item.diagnosticQuestionId === block.question.id);
  if (owners.length !== 1) return [];
  const insertion = owners[0]!;
  if (
    insertions.filter((item) => item.id === insertion.id).length !== 1 ||
    insertions
      .flatMap((item) => [item.diagnosticQuestionId, item.recheckQuestionId])
      .filter((id) => id === block.question.id).length !== 1
  )
    return [];
  const baseline = insertion.updateBaseline ?? {
    packVersionId: insertion.packVersionId,
    packVersion: insertion.packVersion,
    contentHash: insertion.contentHash,
    content: insertion.originalContent,
  };
  const cards = baseline.content.interventions;
  if (cards.length > 5 || new Set(cards.map((card) => card.id)).size !== cards.length) return [];
  const parsed = cards.map((card) =>
    RecoveryPackLiveCardSchema.safeParse({
      reference: {
        insertionId: insertion.id,
        packId: insertion.packId,
        packVersionId: baseline.packVersionId,
        packVersion: baseline.packVersion,
        contentHash: baseline.contentHash,
        cardId: card.id,
      },
      title: card.title,
      body: card.body,
      citations: card.citations,
    }),
  );
  return parsed.every((card) => card.success) ? parsed.map((card) => card.data!) : [];
}

export function presentationRecoveryPackPlayback(session: PresentationSessionRecord) {
  const intervention = session.recoveryPackIntervention;
  if (session.phase !== "intervention" || !intervention) return undefined;
  const card = frozenPresentationRecoveryPackCards(session).find((candidate) =>
    Object.entries(candidate.reference).every(
      ([key, value]) =>
        intervention.reference[key as keyof typeof intervention.reference] === value,
    ),
  );
  return card ? { type: intervention.type, card } : undefined;
}

/** Credentials may rotate; canonical intent and revision must not change on a receipt retry. */
export function presentationCommandRequestHash(command: PresentationControlCommand) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        expectedRevision: command.expectedRevision,
        action: command.action,
        ...(command.action === "jump_to_block"
          ? { targetBlockId: command.targetBlockId.toLowerCase() }
          : {}),
        ...(command.action === "set_reveal" || command.action === "navigate_scene"
          ? {
              blockId: command.blockId.toLowerCase(),
              nodeId: command.nodeId,
              ...(command.action === "set_reveal" ? { revealed: command.revealed } : {}),
            }
          : {}),
        ...(command.action === "follow_branch"
          ? { blockId: command.blockId.toLowerCase(), branchId: command.branchId.toLowerCase() }
          : {}),
        ...(command.action === "start_recovery_card"
          ? {
              insertionId: command.recoveryPackCard.insertionId,
              cardId: command.recoveryPackCard.cardId,
              interventionType: command.interventionType,
            }
          : {}),
        ...(command.action === "insert_recovery_pack"
          ? { packVersionId: command.packVersionId }
          : {}),
        ...(command.action === "insert_quick_check"
          ? { quickCheck: PresentationQuickCheckInputSchema.parse(command.quickCheck) }
          : {}),
        ...(command.action === "insert_published_question"
          ? {
              publishedQuestion: PresentationPublishedQuestionSelectionSchema.parse(
                command.publishedQuestion,
              ),
            }
          : {}),
      }),
    )
    .digest("hex");
}

export function presentationSnapshotSettings(session: PresentationSessionRecord) {
  return {
    ...session.settings,
    trustMode: session.trustMode,
    ...(session.recoveryPackCardsEnabled ? { recoveryPackCardsEnabled: true } : {}),
  };
}
