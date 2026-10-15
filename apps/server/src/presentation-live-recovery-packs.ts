import type { Repository } from "@openround/db";
import { roomFeatureEnabled, resolveWorkspaceFeatures } from "./feature-policy.js";
import { PresentationContentSchema, type PresentationCompanionCommand } from "@openround/contracts";
import {
  recoveryPackTextOnlyLiveEligible,
  type PresentationSessionRecord,
  type RecoveryPackVersionRecord,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import { recoveryPackCopyId, recoveryPackQuestions } from "./recovery-pack-copies.js";
import { PresentationSessionServiceError } from "./presentation-session-errors.js";
import { evidenceWorkspaceFeatureEnabled } from "./workspace-rollout.js";
import {
  assertPresentationLiveInsertionSize,
  presentationClosedInsertionBoundary,
  presentationLiveInsertionEnabled,
  presentationLiveInsertionIndex,
} from "./presentation-live-insertion.js";

export function presentationRecoveryPackLiveInsertionEnabled(
  config: AppConfig,
  workspaceId: string,
  repository?: Repository,
  sessionId?: string,
) {
  if (repository && sessionId)
    return Promise.all([
      roomFeatureEnabled(
        repository,
        config,
        "presentation",
        sessionId,
        workspaceId,
        "presentationCompanion",
        true,
      ),
      roomFeatureEnabled(
        repository,
        config,
        "presentation",
        sessionId,
        workspaceId,
        "recoveryPackLiveCards",
        true,
      ),
    ]).then((values) => values.every(Boolean));
  if (repository)
    return resolveWorkspaceFeatures(repository, config, workspaceId).then(
      (features) =>
        features.enabled("presentationCompanion") && features.enabled("recoveryPackLiveCards"),
    );
  return (
    presentationLiveInsertionEnabled(config, workspaceId) &&
    evidenceWorkspaceFeatureEnabled(config, workspaceId, "recoveryPacks") &&
    evidenceWorkspaceFeatureEnabled(config, workspaceId, "recoveryPackLiveCards")
  );
}

export function presentationCanInsertRecoveryPack(session: PresentationSessionRecord) {
  if (
    session.status !== "active" ||
    !session.recoveryPackCardsEnabled ||
    session.content.blocks.length + 2 > 100 ||
    (session.content.recoveryPackInsertions?.length ?? 0) + 1 > 100
  )
    return false;
  return presentationClosedInsertionBoundary(session);
}

export function presentationRecoveryPackInsertionTransition(
  session: PresentationSessionRecord,
  version: RecoveryPackVersionRecord,
  input: Extract<PresentationCompanionCommand, { action: "insert_recovery_pack" }>,
) {
  if (!recoveryPackTextOnlyLiveEligible(version.content)) {
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "Only text-only Recovery Packs can be inserted into this live session",
    );
  }
  const questions = recoveryPackQuestions(version, input.commandId);
  const insertedBlocks = questions.map((question, index) => ({
    id: recoveryPackCopyId(
      `${input.commandId}:presentation-block:${index === 0 ? "diagnostic" : "recheck"}:${version.id}`,
    ),
    kind: "question" as const,
    question,
  }));
  const insertionIndex = presentationLiveInsertionIndex(session);
  const blocks = [...session.content.blocks];
  blocks.splice(insertionIndex, 0, ...insertedBlocks);
  const content = PresentationContentSchema.parse({
    ...session.content,
    schemaVersion: 3,
    blocks,
    recoveryPackInsertions: [
      ...(session.content.recoveryPackInsertions ?? []),
      {
        id: input.commandId,
        packId: version.packId,
        packVersionId: version.id,
        packVersion: version.version,
        contentHash: version.contentHash,
        diagnosticQuestionId: questions[0]!.id,
        recheckQuestionId: questions[1]!.id,
        originalContent: version.content,
      },
    ],
  });
  assertPresentationLiveInsertionSize(content);
  return {
    content,
    phase: "question_open" as const,
    currentBlockIndex: insertionIndex,
    status: "active" as const,
    event: {
      type: "question.launched" as const,
      blockIndex: insertionIndex,
      blockId: insertedBlocks[0]!.id,
    },
  };
}
