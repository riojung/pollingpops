import { createHash, randomUUID } from "node:crypto";
import {
  PresentationParticipantSnapshotSchema,
  PresentationCommandSchema,
  PresentationCompanionCommandSchema,
  type PresentationCommand,
  type PresentationCompanionCommand,
  type PresentationCompanionSnapshot,
  type PresentationControlCommand,
  type PresentationHostSnapshot,
  type PresentationResponseAck,
  type PresentationResponseSubmit,
  type PresentationSessionResponse,
  type Entitlements,
} from "@openround/contracts";
import {
  PresentationPublishedQuestionSourceUnavailableError,
  PresentationSessionConflictError,
  WorkspaceDeletionInProgressError,
  type PresentationResponseAcknowledgementState,
  type PresentationSessionRecord,
  type PresentationSessionRepository,
  type PresentationSessionResponseRecord,
  type Repository,
  type RecoveryPackRepository,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import { entitlementsFor, retentionExpiry } from "./entitlements.js";
import type { ProductEventInput } from "./product-events.js";
import { PresentationSessionServiceError } from "./presentation-session-errors.js";
import {
  presentationCanInsertRecoveryPack,
  presentationRecoveryPackInsertionTransition,
} from "./presentation-live-recovery-packs.js";
import {
  presentationCanInsertQuickCheck,
  presentationQuickCheckInsertionTransition,
} from "./presentation-live-quick-checks.js";
import {
  presentationCanInsertPublishedQuestion,
  presentationPublishedQuestionInsertionTransition,
} from "./presentation-live-published-questions.js";
import {
  buildTargetedPresentationParticipantSnapshot,
  presentationCurrentBlock,
} from "./presentation-session-projections.js";
import {
  frozenPresentationRecoveryPackCards,
  presentationCommandRequestHash,
} from "./presentation-recovery-pack-cards.js";
import {
  presentationResponseCorrect,
  presentationResponseRequestHash,
  presentationResponseScore,
  presentationResponseTiming,
  presentationResponseValidationMessage,
} from "./presentation-session-response-policy.js";

export interface SubmitPresentationResponseInput {
  sessionId: string;
  participantToken: string;
  blockId: string;
  expectedRevision: number;
  idempotencyKey: string;
  response: PresentationSessionResponse;
  /** Server ingress time, captured before feature/auth/database work. */
  receivedAt?: Date;
}

export interface AdvancePresentationSessionInput {
  workspaceId: string;
  userId: string;
  sessionId: string;
  expectedRevision: number;
  requestId: string;
}

export interface SubmitLegacyPresentationResponseInput {
  sessionId: string;
  participantToken: string;
  response: PresentationSessionResponse;
  receivedAt?: Date;
}

export type PresentationRestHostSnapshot = PresentationHostSnapshot & {
  createdAt: Date;
  updatedAt: Date;
};

type PresentationMutationSessionRepository = Pick<
  PresentationSessionRepository,
  | "getSessionForWorkspace"
  | "getSessionById"
  | "transitionSession"
  | "transitionSessionCommand"
  | "findCommandReceipt"
  | "findParticipant"
  | "getResponseContext"
  | "acceptResponse"
  | "findResponseByIdempotencyKey"
>;

type PresentationMutationRepository = Pick<
  Repository,
  "getPlan" | "recordAudit" | "getQuizVersion" | "getQuiz"
>;

type PresentationEntitlementConfig = Pick<
  AppConfig,
  | "COMMUNITY_MODE"
  | "COMMUNITY_REPORT_RETENTION_DAYS"
  | "MAX_SESSION_PARTICIPANTS"
  | "MAX_PRACTICE_PERSONAL_LINKS"
>;

interface PresentationLiveMutationDependencies {
  resolveRoomEntitlements?: (sessionId: string, workspaceId: string) => Promise<Entitlements>;
  sessions: PresentationMutationSessionRepository;
  repository: PresentationMutationRepository;
  config: PresentationEntitlementConfig;
  packs?: Pick<RecoveryPackRepository, "getRecoveryPackVersion">;
  recoveryPackLiveInsertionEnabled?: (
    workspaceId: string,
    sessionId?: string,
  ) => boolean | Promise<boolean>;
  quickCheckLiveInsertionEnabled?: (
    workspaceId: string,
    sessionId?: string,
  ) => boolean | Promise<boolean>;
  publishedQuestionLiveInsertionEnabled?: (
    workspaceId: string,
    sessionId?: string,
  ) => boolean | Promise<boolean>;
  participantTokenHash(token: string): string;
  sessionExpired(session: PresentationSessionRecord, now?: Date): boolean;
  authorizeHostCredential(sessionId: string, token: string): Promise<PresentationSessionRecord>;
  authorizeCompanionCredential(
    sessionId: string,
    token: string,
  ): Promise<PresentationSessionRecord>;
  realtimeHostSnapshot(session: PresentationSessionRecord): Promise<PresentationHostSnapshot>;
  realtimeCompanionSnapshot(
    session: PresentationSessionRecord,
  ): Promise<PresentationCompanionSnapshot>;
  restHostSnapshot(session: PresentationSessionRecord): Promise<PresentationRestHostSnapshot>;
  recordProductEvents(workspaceId: string, events: ProductEventInput[]): void;
}

function nextTransition(session: PresentationSessionRecord) {
  const blocks = session.content.blocks;
  if (session.phase === "finished") return null;
  if (session.phase === "question_open") {
    const block = blocks[session.currentBlockIndex]!;
    return {
      phase: "question_reveal" as const,
      currentBlockIndex: session.currentBlockIndex,
      status: "active" as const,
      event: {
        type: "question.revealed" as const,
        blockIndex: session.currentBlockIndex,
        blockId: block.id,
      },
    };
  }
  if (session.phase === "question_reveal") {
    const block = blocks[session.currentBlockIndex];
    if (
      block?.kind === "question" &&
      (block.question.delivery ?? "main") === "main" &&
      block.question.linkedRecheckQuestionId
    ) {
      return {
        phase: "intervention" as const,
        currentBlockIndex: session.currentBlockIndex,
        status: "active" as const,
        event: {
          type: "intervention.presented" as const,
          blockIndex: session.currentBlockIndex,
          blockId: block.id,
        },
      };
    }
  }
  const nextIndex = session.phase === "lobby" ? 0 : session.currentBlockIndex + 1;
  const next = blocks[nextIndex];
  if (!next) {
    return {
      phase: "finished" as const,
      currentBlockIndex: Math.max(session.currentBlockIndex, 0),
      status: "finished" as const,
      event: {
        type: "presentation.finished" as const,
        blockIndex: null,
        blockId: null,
      },
    };
  }
  return {
    phase: next.kind === "content" ? ("content" as const) : ("question_open" as const),
    currentBlockIndex: nextIndex,
    status: "active" as const,
    event: {
      type:
        next.kind === "content" ? ("content.presented" as const) : ("question.launched" as const),
      blockIndex: nextIndex,
      blockId: next.id,
    },
  };
}

function recoveryCardTransition(
  session: PresentationSessionRecord,
  input: Extract<PresentationControlCommand, { action: "start_recovery_card" }>,
) {
  if (session.status !== "active" || session.phase !== "question_reveal") {
    throw new PresentationSessionServiceError(
      409,
      "PHASE_CLOSED",
      "Reveal this diagnostic before starting a Recovery Pack card",
    );
  }
  const card = frozenPresentationRecoveryPackCards(session).find(
    (candidate) =>
      candidate.reference.insertionId === input.recoveryPackCard.insertionId &&
      candidate.reference.cardId === input.recoveryPackCard.cardId,
  );
  if (!card) {
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "This card is not available for the current diagnostic in this session",
    );
  }
  const recoveryPackIntervention = { type: input.interventionType, reference: card.reference };
  return {
    phase: "intervention" as const,
    currentBlockIndex: session.currentBlockIndex,
    status: "active" as const,
    recoveryPackIntervention,
    event: {
      type: "intervention.presented" as const,
      blockIndex: session.currentBlockIndex,
      blockId: session.content.blocks[session.currentBlockIndex]!.id,
      recoveryPackIntervention,
    },
  };
}

export class PresentationLiveMutationService {
  constructor(private readonly dependencies: PresentationLiveMutationDependencies) {}

  private workspaceDeletionClosed() {
    return new PresentationSessionServiceError(
      409,
      "PHASE_CLOSED",
      "This Presentation session is no longer accepting changes",
    );
  }

  private async acceptResponse(
    response: PresentationSessionResponseRecord,
    expectedRevision: number,
  ) {
    try {
      return await this.dependencies.sessions.acceptResponse(response, expectedRevision);
    } catch (error) {
      if (error instanceof WorkspaceDeletionInProgressError) {
        throw this.workspaceDeletionClosed();
      }
      throw error;
    }
  }

  async advance(input: AdvancePresentationSessionInput): Promise<PresentationRestHostSnapshot> {
    const session = await this.dependencies.sessions.getSessionForWorkspace(
      input.workspaceId,
      input.sessionId,
    );
    if (!session) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Presentation session not found");
    }
    if (this.dependencies.sessionExpired(session)) {
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "This Presentation session has expired",
      );
    }
    if (input.expectedRevision !== session.revision) {
      throw this.staleSession(input.expectedRevision, session.revision);
    }
    const transition = nextTransition(session);
    if (!transition) return this.dependencies.restHostSnapshot(session);
    try {
      const transitionRetentionExpiresAt = await this.transitionRetentionExpiry(
        input.workspaceId,
        transition.status,
        input.sessionId,
      );
      const updated = await this.dependencies.sessions.transitionSession({
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        expectedRevision: input.expectedRevision,
        ...transition,
        ...(transitionRetentionExpiresAt
          ? { retentionExpiresAt: transitionRetentionExpiresAt }
          : {}),
      });
      if (!updated) {
        throw new PresentationSessionServiceError(
          404,
          "NOT_FOUND",
          "Presentation session not found",
        );
      }
      this.recordAcceptedTransitionProductEvents(updated, transition);
      if (updated.status === "finished") {
        await this.dependencies.repository.recordAudit({
          workspaceId: input.workspaceId,
          actorId: input.userId,
          action: "presentation.session.finish",
          targetType: "presentation_live_session",
          targetId: updated.id,
          requestId: input.requestId,
        });
      }
      return this.dependencies.restHostSnapshot(updated);
    } catch (error) {
      if (error instanceof PresentationSessionConflictError) {
        throw this.staleSession(error.expectedRevision, error.currentRevision);
      }
      if (error instanceof WorkspaceDeletionInProgressError) {
        throw this.workspaceDeletionClosed();
      }
      throw error;
    }
  }

  async command(input: PresentationCommand): Promise<PresentationHostSnapshot> {
    const session = await this.dependencies.authorizeHostCredential(
      input.sessionId,
      input.controlToken,
    );
    const command = PresentationCommandSchema.parse(input);
    return this.acceptCommand(command, session, this.dependencies.realtimeHostSnapshot);
  }

  async companionCommand(
    input: PresentationCompanionCommand,
  ): Promise<PresentationCompanionSnapshot> {
    const command = PresentationCompanionCommandSchema.parse(input);
    const session = await this.dependencies.authorizeCompanionCredential(
      command.sessionId,
      command.companionToken,
    );
    return this.acceptCommand(command, session, this.dependencies.realtimeCompanionSnapshot);
  }

  private async replayCommand<T extends PresentationHostSnapshot | PresentationCompanionSnapshot>(
    input: PresentationControlCommand,
    session: PresentationSessionRecord,
    snapshot: (session: PresentationSessionRecord) => Promise<T>,
    requestHash: string,
  ): Promise<T | null> {
    // Recover an exact durable command before inspecting the current phase, revision or card.
    // An acknowledgement can be lost and retried after another host has advanced or finished.
    const receipt = await this.dependencies.sessions.findCommandReceipt(
      session.workspaceId,
      session.id,
      input.commandId,
    );
    if (receipt) {
      if (
        receipt.expectedRevision !== input.expectedRevision ||
        (receipt.requestHash ? receipt.requestHash !== requestHash : input.action !== "advance")
      ) {
        throw new PresentationSessionServiceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This command key was already used for a different request",
        );
      }
      const current = await this.dependencies.sessions.getSessionForWorkspace(
        session.workspaceId,
        session.id,
      );
      if (!current) {
        throw new PresentationSessionServiceError(
          404,
          "NOT_FOUND",
          "Presentation session not found",
        );
      }
      return snapshot(current);
    }
    return null;
  }

  private async acceptCommand<T extends PresentationHostSnapshot | PresentationCompanionSnapshot>(
    input: PresentationControlCommand,
    session: PresentationSessionRecord,
    snapshot: (session: PresentationSessionRecord) => Promise<T>,
  ): Promise<T> {
    const requestHash = presentationCommandRequestHash(input);
    const replayed = await this.replayCommand(input, session, snapshot, requestHash);
    if (replayed) return replayed;
    if (input.expectedRevision !== session.revision) {
      throw this.staleSession(input.expectedRevision, session.revision);
    }
    try {
      const transition =
        input.action === "advance"
          ? nextTransition(session)
          : input.action === "start_recovery_card"
            ? recoveryCardTransition(session, input)
            : input.action === "insert_quick_check"
              ? await this.quickCheckInsertionTransition(session, input)
              : input.action === "insert_published_question"
                ? await this.publishedQuestionInsertionTransition(session, input)
                : await this.recoveryPackInsertionTransition(session, input);
      if (!transition) return snapshot(session);
      const transitionRetentionExpiresAt = await this.transitionRetentionExpiry(
        session.workspaceId,
        transition.status,
        session.id,
      );
      const accepted = await this.dependencies.sessions.transitionSessionCommand({
        workspaceId: session.workspaceId,
        sessionId: session.id,
        commandId: input.commandId,
        requestHash,
        expectedRevision: input.expectedRevision,
        ...transition,
        ...(transitionRetentionExpiresAt
          ? { retentionExpiresAt: transitionRetentionExpiresAt }
          : {}),
      });
      if (accepted.status === "not_found") {
        throw new PresentationSessionServiceError(
          404,
          "NOT_FOUND",
          "Presentation session not found",
        );
      }
      if (accepted.status === "idempotency_conflict") {
        throw new PresentationSessionServiceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This command key was already used for a different request",
        );
      }
      if (accepted.status === "accepted" && accepted.session.status === "finished") {
        await this.dependencies.repository.recordAudit({
          workspaceId: accepted.session.workspaceId,
          actorId: null,
          action: "presentation.session.finish",
          targetType: "presentation_live_session",
          targetId: accepted.session.id,
          requestId: input.commandId,
        });
      }
      if (accepted.status === "accepted") {
        this.recordAcceptedTransitionProductEvents(accepted.session, transition);
        if (input.action === "insert_published_question") {
          const inserted = accepted.session.content.livePublishedQuestions!.find(
            (item) => item.commandId === input.commandId,
          )!;
          await this.dependencies.repository
            .recordAudit({
              workspaceId: accepted.session.workspaceId,
              actorId: null,
              action: "presentation.session.published_question.insert",
              targetType: "presentation_live_session",
              targetId: accepted.session.id,
              requestId: input.commandId,
              metadata: {
                blockId: inserted.blockId,
                sourceQuizId: inserted.sourceQuizId,
                sourceQuizVersionId: inserted.sourceQuizVersionId,
                sourceQuestionId: inserted.sourceQuestionId,
              },
            })
            .catch(() => undefined);
        }
        if (input.action === "insert_quick_check") {
          await this.dependencies.repository
            .recordAudit({
              workspaceId: accepted.session.workspaceId,
              actorId: null,
              action: "presentation.session.quick_check.insert",
              targetType: "presentation_live_session",
              targetId: accepted.session.id,
              requestId: input.commandId,
              metadata: {
                blockId: accepted.session.content.liveQuickCheck!.blockId,
                choiceCount: input.quickCheck.choices.length,
              },
            })
            .catch(() => undefined);
        }
        if (input.action === "insert_recovery_pack") {
          await this.dependencies.repository
            .recordAudit({
              workspaceId: accepted.session.workspaceId,
              actorId: null,
              action: "presentation.session.recovery_pack.insert",
              targetType: "presentation_live_session",
              targetId: accepted.session.id,
              requestId: input.commandId,
              metadata: { packVersionId: input.packVersionId, insertionId: input.commandId },
            })
            .catch(() => undefined);
        }
        if (input.action === "start_recovery_card" && accepted.session.recoveryPackIntervention) {
          await this.dependencies.repository
            .recordAudit({
              workspaceId: accepted.session.workspaceId,
              actorId: null,
              action: "presentation.session.recovery_pack_card.start",
              targetType: "presentation_live_session",
              targetId: accepted.session.id,
              requestId: input.commandId,
              metadata: { ...accepted.session.recoveryPackIntervention },
            })
            .catch(() => undefined);
        }
      }
      return snapshot(accepted.session);
    } catch (error) {
      if (
        input.action === "insert_published_question" &&
        (error instanceof PresentationPublishedQuestionSourceUnavailableError ||
          (error instanceof PresentationSessionServiceError && error.code === "NOT_FOUND"))
      ) {
        // Another copy of this exact command may have committed after our receipt preflight
        // and then lost its source. That is acknowledgement recovery, not a new insertion.
        const racedReplay = await this.replayCommand(input, session, snapshot, requestHash);
        if (racedReplay) return racedReplay;
      }
      if (error instanceof PresentationPublishedQuestionSourceUnavailableError) {
        throw new PresentationSessionServiceError(404, "NOT_FOUND", error.message);
      }
      if (error instanceof PresentationSessionConflictError) {
        throw this.staleSession(error.expectedRevision, error.currentRevision);
      }
      if (error instanceof WorkspaceDeletionInProgressError) {
        throw this.workspaceDeletionClosed();
      }
      throw error;
    }
  }

  private async publishedQuestionInsertionTransition(
    session: PresentationSessionRecord,
    input: Extract<PresentationCompanionCommand, { action: "insert_published_question" }>,
  ) {
    if (
      !(await this.dependencies.publishedQuestionLiveInsertionEnabled?.(
        session.workspaceId,
        session.id,
      ))
    )
      throw new PresentationSessionServiceError(
        404,
        "NOT_FOUND",
        "Live published question insertion is not enabled in this workspace",
      );
    if (!presentationCanInsertPublishedQuestion(session))
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "Insert a published question at a closed checkpoint without a pending recheck",
      );
    const version = await this.dependencies.repository.getQuizVersion(
      session.workspaceId,
      input.publishedQuestion.sourceQuizVersionId,
    );
    const quiz = version
      ? await this.dependencies.repository.getQuiz(session.workspaceId, version.quizId)
      : null;
    if (!version || !quiz || quiz.status === "archived")
      throw new PresentationSessionServiceError(
        404,
        "NOT_FOUND",
        "Published source Round version not found",
      );
    return presentationPublishedQuestionInsertionTransition(session, version, input);
  }

  private async quickCheckInsertionTransition(
    session: PresentationSessionRecord,
    input: Extract<PresentationCompanionCommand, { action: "insert_quick_check" }>,
  ) {
    if (
      !(await this.dependencies.quickCheckLiveInsertionEnabled?.(session.workspaceId, session.id))
    )
      throw new PresentationSessionServiceError(
        404,
        "NOT_FOUND",
        "Live Quick Checks are not enabled in this workspace",
      );
    if (!presentationCanInsertQuickCheck(session))
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "Insert one Quick Check at a closed checkpoint without a pending recheck",
      );
    return presentationQuickCheckInsertionTransition(session, input);
  }

  private async recoveryPackInsertionTransition(
    session: PresentationSessionRecord,
    input: Extract<PresentationCompanionCommand, { action: "insert_recovery_pack" }>,
  ) {
    if (
      !this.dependencies.packs ||
      !(await this.dependencies.recoveryPackLiveInsertionEnabled?.(session.workspaceId, session.id))
    ) {
      throw new PresentationSessionServiceError(
        404,
        "NOT_FOUND",
        "Live Recovery Pack insertion is not enabled in this workspace",
      );
    }
    if (!presentationCanInsertRecoveryPack(session)) {
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "Insert a Recovery Pack between presentation checkpoints without a pending recheck",
      );
    }
    const version = await this.dependencies.packs.getRecoveryPackVersion(
      session.workspaceId,
      input.packVersionId,
    );
    if (!version)
      throw new PresentationSessionServiceError(
        404,
        "NOT_FOUND",
        "Published Recovery Pack version not found",
      );
    return presentationRecoveryPackInsertionTransition(session, version, input);
  }

  async submitResponse(
    input: SubmitPresentationResponseInput | (PresentationResponseSubmit & { receivedAt?: Date }),
  ): Promise<PresentationResponseAck> {
    // Capture receipt before reads/validation so network or database latency cannot improve a score
    // or admit an answer after the server-side close instant.
    const receivedAt = input.receivedAt ?? new Date();
    const requestHash = presentationResponseRequestHash(input);
    const context = await this.dependencies.sessions.getResponseContext(
      input.sessionId,
      this.dependencies.participantTokenHash(input.participantToken),
      input.idempotencyKey,
    );
    if (!context || this.dependencies.sessionExpired(context.session, receivedAt)) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Participant credential is invalid",
      );
    }
    const { session, participant, priorResponse } = context;
    const acknowledgePriorReceipt = async (
      knownReceipt?: PresentationSessionResponseRecord | null,
    ): Promise<PresentationResponseAck | null> => {
      const receipt =
        knownReceipt ??
        (await this.dependencies.sessions.findResponseByIdempotencyKey(
          input.sessionId,
          participant.id,
          input.idempotencyKey,
        ));
      if (!receipt) return null;
      if (receipt.requestHash && receipt.requestHash !== requestHash) {
        throw new PresentationSessionServiceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This response key was already used for a different request",
        );
      }
      const duplicate = await this.acceptResponse(receipt, input.expectedRevision);
      if (duplicate.status !== "duplicate") {
        throw new Error("Durable Presentation response receipt could not be acknowledged");
      }
      return this.responseAcknowledgement(
        duplicate.acknowledgement,
        participant.id,
        duplicate.response,
        input.idempotencyKey,
        true,
      );
    };
    if (priorResponse) {
      return (await acknowledgePriorReceipt(priorResponse))!;
    }
    // Resolve the submitted block independently from the current pointer. The repository checks a
    // matching idempotency receipt before its live phase/revision fence, allowing a lost ack to be
    // recovered after the host advances without ever applying the payload to the next question.
    const submittedBlock = session.content.blocks.find((block) => block.id === input.blockId);
    if (submittedBlock?.kind !== "question") {
      const replayed = await acknowledgePriorReceipt();
      if (replayed) return replayed;
      throw new PresentationSessionServiceError(
        409,
        "STALE_SESSION",
        "This question changed before the response was saved. Refresh before trying again.",
        {
          expectedBlockId: input.blockId,
          currentBlockId: presentationCurrentBlock(session)?.id ?? null,
          expectedRevision: input.expectedRevision,
          currentRevision: session.revision,
        },
      );
    }
    const validationMessage = presentationResponseValidationMessage(
      submittedBlock.question,
      input.response,
    );
    if (validationMessage) {
      const replayed = await acknowledgePriorReceipt();
      if (replayed) return replayed;
      throw new PresentationSessionServiceError(422, "VALIDATION_ERROR", validationMessage);
    }
    const correct = presentationResponseCorrect(submittedBlock.question, input.response);
    const timing = presentationResponseTiming(session, receivedAt);
    const acceptance = await this.acceptResponse(
      {
        id: randomUUID(),
        workspaceId: session.workspaceId,
        sessionId: session.id,
        participantId: participant.id,
        blockId: submittedBlock.id,
        questionId: submittedBlock.question.id,
        response: input.response,
        correct,
        score: presentationResponseScore(submittedBlock.question, correct, timing.remainingRatio),
        responseMs: timing.responseMs,
        submittedAt: receivedAt,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      },
      input.expectedRevision,
    );
    if (acceptance.status === "phase_closed") {
      const currentSession =
        (await this.dependencies.sessions.getSessionById(input.sessionId)) ?? session;
      const current = presentationCurrentBlock(currentSession);
      if (currentSession.revision !== input.expectedRevision || current?.id !== input.blockId) {
        throw new PresentationSessionServiceError(
          409,
          "STALE_SESSION",
          "This question changed before the response was saved. Refresh before trying again.",
          {
            expectedBlockId: input.blockId,
            currentBlockId: current?.id ?? null,
            expectedRevision: input.expectedRevision,
            currentRevision: currentSession.revision,
          },
        );
      }
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "This question is no longer accepting responses",
      );
    }
    if (acceptance.status === "already_responded") {
      throw new PresentationSessionServiceError(
        409,
        "ALREADY_RESPONDED",
        "Your response is already saved",
      );
    }
    if (acceptance.status === "idempotency_conflict") {
      throw new PresentationSessionServiceError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This response key was already used for a different request",
      );
    }
    if (acceptance.status === "accepted") {
      this.dependencies.recordProductEvents(session.workspaceId, [
        {
          name: "response_saved_acknowledged",
          occurredAt: acceptance.response.submittedAt.toISOString(),
          dimensions: { artifactType: "presentation" },
        },
      ]);
    }
    return this.responseAcknowledgement(
      acceptance.acknowledgement,
      participant.id,
      acceptance.response,
      input.idempotencyKey,
      acceptance.status === "duplicate",
    );
  }

  async submitLegacyResponse(
    input: SubmitLegacyPresentationResponseInput,
  ): Promise<PresentationResponseAck> {
    const receivedAt = input.receivedAt ?? new Date();
    const session = await this.dependencies.sessions.getSessionById(input.sessionId);
    if (!session || this.dependencies.sessionExpired(session, receivedAt)) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Participant credential is invalid",
      );
    }
    const participant = await this.dependencies.sessions.findParticipant(
      input.sessionId,
      this.dependencies.participantTokenHash(input.participantToken),
    );
    if (!participant) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Participant credential is invalid",
      );
    }
    const block = presentationCurrentBlock(session);
    if (session.phase !== "question_open" || block?.kind !== "question") {
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "This question is no longer accepting responses",
      );
    }
    const idempotencyKey = `legacy:${createHash("sha256")
      .update(`${session.id}:${participant.id}:${block.id}`)
      .digest("hex")}`;
    return this.submitResponse({
      sessionId: session.id,
      participantToken: input.participantToken,
      blockId: block.id,
      expectedRevision: session.revision,
      idempotencyKey,
      response: input.response,
      receivedAt,
    });
  }

  private async transitionRetentionExpiry(
    workspaceId: string,
    status: "active" | "finished",
    sessionId: string,
  ) {
    if (status !== "finished") return undefined;
    return retentionExpiry(
      new Date(),
      this.dependencies.resolveRoomEntitlements
        ? await this.dependencies.resolveRoomEntitlements(sessionId, workspaceId)
        : entitlementsFor(
            await this.dependencies.repository.getPlan(workspaceId),
            this.dependencies.config,
          ),
    );
  }

  private recordAcceptedTransitionProductEvents(
    session: PresentationSessionRecord,
    transition: NonNullable<ReturnType<typeof nextTransition>>,
  ) {
    const occurredAt = session.updatedAt.toISOString();
    if (transition.event.type === "intervention.presented") {
      this.dependencies.recordProductEvents(session.workspaceId, [
        {
          name: "intervention_started",
          occurredAt,
          dimensions: { artifactType: "presentation" },
        },
      ]);
      return;
    }
    const block = presentationCurrentBlock(session);
    if (
      transition.event.type === "question.launched" &&
      block?.kind === "question" &&
      (block.question.delivery ?? "main") === "recheck"
    ) {
      this.dependencies.recordProductEvents(session.workspaceId, [
        {
          name: "linked_recheck_opened",
          occurredAt,
          dimensions: { artifactType: "presentation" },
        },
      ]);
    }
  }

  private staleSession(expectedRevision: number, currentRevision: number) {
    return new PresentationSessionServiceError(
      409,
      "STALE_SESSION",
      "This Presentation advanced in another host window. Refresh before continuing.",
      { expectedRevision, currentRevision },
    );
  }

  private async responseAcknowledgement(
    acknowledgement: PresentationResponseAcknowledgementState,
    participantId: string,
    response: PresentationSessionResponseRecord,
    idempotencyKey: string,
    duplicate: boolean,
  ): Promise<PresentationResponseAck> {
    const { session, projection } = acknowledgement;
    const acceptedAt = response.submittedAt.toISOString();
    const snapshot = buildTargetedPresentationParticipantSnapshot(
      session,
      participantId,
      projection,
      response,
    );
    const acknowledgedSnapshot = PresentationParticipantSnapshotSchema.parse({
      ...snapshot,
      responseReceipt: {
        responseId: response.id,
        blockId: response.blockId,
        idempotencyKey,
        acceptedAt,
      },
    });
    return {
      sessionId: session.id,
      accepted: true,
      duplicate,
      responseId: response.id,
      blockId: response.blockId,
      idempotencyKey,
      acceptedAt,
      snapshot: acknowledgedSnapshot,
    };
  }
}
