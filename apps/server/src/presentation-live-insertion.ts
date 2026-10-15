import type { Repository } from "@openround/db";
import { roomFeatureEnabled, workspaceFeatureEnabled } from "./feature-policy.js";
import type { PresentationContent } from "@openround/contracts";
import type { PresentationSessionRecord } from "@openround/db";
import type { AppConfig } from "./config.js";
import { PRESENTATION_PACK_INSERTION_DRAFT_LIMIT } from "./draft-limits.js";
import { PresentationSessionServiceError } from "./presentation-session-errors.js";
import {
  evidenceWorkspaceFeatureEnabled,
  professionalWorkspaceFeatureEnabled,
} from "./workspace-rollout.js";

export function presentationLiveInsertionEnabled(
  config: AppConfig,
  workspaceId: string,
  repository?: Repository,
  sessionId?: string,
) {
  if (repository)
    return sessionId
      ? roomFeatureEnabled(
          repository,
          config,
          "presentation",
          sessionId,
          workspaceId,
          "presentationCompanion",
          true,
        )
      : workspaceFeatureEnabled(repository, config, workspaceId, "presentationCompanion");
  return (
    professionalWorkspaceFeatureEnabled(config, workspaceId, "presentations") &&
    evidenceWorkspaceFeatureEnabled(config, workspaceId, "presentationCompanion")
  );
}

/** Linked recovery stays indivisible even across intervening slides or standalone questions. */
export function presentationClosedInsertionBoundary(session: PresentationSessionRecord) {
  if (session.status !== "active") return false;
  if (session.phase === "lobby") return true;
  const block = session.content.blocks[session.currentBlockIndex];
  if (
    session.phase !== "content" &&
    !(session.phase === "question_reveal" && block?.kind === "question")
  )
    return false;
  const pendingQuestions = new Set(
    session.content.blocks
      .slice(session.currentBlockIndex + 1)
      .filter((item) => item.kind === "question")
      .map((item) => item.question.id),
  );
  return !session.content.blocks
    .slice(0, session.currentBlockIndex + 1)
    .some(
      (item) =>
        item.kind === "question" &&
        typeof item.question.linkedRecheckQuestionId === "string" &&
        pendingQuestions.has(item.question.linkedRecheckQuestionId),
    );
}

export function presentationLiveInsertionIndex(session: PresentationSessionRecord) {
  return session.phase === "lobby" ? 0 : session.currentBlockIndex + 1;
}

export function assertPresentationLiveInsertionSize(content: PresentationContent) {
  if (Buffer.byteLength(JSON.stringify(content), "utf8") > PRESENTATION_PACK_INSERTION_DRAFT_LIMIT)
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "This insertion would make the live presentation too large",
    );
}
