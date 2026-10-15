import {
  PresentationContentSchema,
  PresentationRecoveryPackInterventionSchema,
} from "@openround/contracts";
import type {
  PresentationSessionCommandInput,
  PresentationSessionCommandReceiptRecord,
  PresentationSessionCreateInput,
  PresentationSessionRecord,
  PresentationSessionResponseRecord,
  PresentationSessionTransitionInput,
} from "./presentation-session-types.js";
import { upcastPresentationSessionContent } from "./artifact-schemas.js";

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function normalizeSession(input: PresentationSessionCreateInput): PresentationSessionRecord {
  const content = upcastPresentationSessionContent(input.content, input.content.schemaVersion);
  const settings = input.settings ?? { timeMode: "timed" as const };
  const recoveryPackCardsEnabled = input.recoveryPackCardsEnabled ?? false;
  const recoveryPackIntervention = input.recoveryPackIntervention
    ? PresentationRecoveryPackInterventionSchema.parse(input.recoveryPackIntervention)
    : null;
  if (
    recoveryPackIntervention !== null &&
    (!recoveryPackCardsEnabled || input.phase !== "intervention" || input.status !== "active")
  ) {
    throw new Error("Recovery Pack attribution requires an eligible active intervention");
  }
  let questionOpenedAt = input.questionOpenedAt ?? null;
  let questionClosesAt = input.questionClosesAt ?? null;
  if (input.phase === "question_open" && questionOpenedAt === null) {
    questionOpenedAt = input.updatedAt;
  }
  if (input.phase === "question_open" && settings.timeMode === "flex") {
    questionClosesAt = null;
  } else if (input.phase === "question_open" && questionClosesAt === null) {
    const block = content.blocks[input.currentBlockIndex];
    if (block?.kind === "question" && questionOpenedAt) {
      questionClosesAt = new Date(
        questionOpenedAt.getTime() + block.question.timeLimitSeconds * 1_000,
      );
    }
  }
  return {
    ...input,
    joinPasswordHash: input.joinPasswordHash ?? null,
    content,
    settings,
    trustMode: input.trustMode ?? "learning",
    recoveryPackCardsEnabled,
    recoveryPackIntervention,
    eventSeq: input.eventSeq ?? 0,
    questionOpenedAt,
    questionClosesAt,
  };
}

export function commandReceiptMatches(
  receipt: Pick<PresentationSessionCommandReceiptRecord, "expectedRevision" | "requestHash">,
  input: Pick<
    PresentationSessionCommandInput,
    "expectedRevision" | "requestHash" | "recoveryPackIntervention" | "content"
  >,
) {
  return (
    receipt.expectedRevision === input.expectedRevision &&
    (receipt.requestHash == null
      ? input.recoveryPackIntervention == null && input.content == null
      : receipt.requestHash === input.requestHash)
  );
}

export function transitionContent(
  session: PresentationSessionRecord,
  input: PresentationSessionTransitionInput,
) {
  return input.content === undefined
    ? session.content
    : PresentationContentSchema.parse(input.content);
}

export function assertCommandRequestHash(
  requestHash: PresentationSessionCommandInput["requestHash"],
) {
  if (requestHash != null && !/^[0-9a-f]{64}$/.test(requestHash)) {
    throw new Error("Presentation command request hash must be a canonical SHA-256 fingerprint");
  }
}

export function transitionRecoveryPackIntervention(input: PresentationSessionTransitionInput) {
  const intervention = input.recoveryPackIntervention
    ? PresentationRecoveryPackInterventionSchema.parse(input.recoveryPackIntervention)
    : null;
  const suppliedTimelineIntervention = input.event.recoveryPackIntervention
    ? PresentationRecoveryPackInterventionSchema.parse(input.event.recoveryPackIntervention)
    : null;
  if (
    (intervention !== null && (input.phase !== "intervention" || input.status !== "active")) ||
    (suppliedTimelineIntervention !== null && input.event.type !== "intervention.presented")
  ) {
    throw new Error("Recovery Pack attribution requires an intervention transition");
  }
  if (
    suppliedTimelineIntervention !== null &&
    JSON.stringify(suppliedTimelineIntervention) !== JSON.stringify(intervention)
  ) {
    throw new Error("Recovery Pack timeline attribution must match the active intervention");
  }
  const timelineIntervention = input.event.type === "intervention.presented" ? intervention : null;
  return { intervention, timelineIntervention };
}

export function transitionWindow(
  session: PresentationSessionRecord,
  input: PresentationSessionTransitionInput,
  occurredAt: Date,
) {
  if (input.phase !== "question_open") {
    return { questionOpenedAt: null, questionClosesAt: null };
  }
  const questionOpenedAt = input.questionOpenedAt ?? occurredAt;
  if (session.settings.timeMode === "flex") {
    return { questionOpenedAt, questionClosesAt: null };
  }
  if (input.questionClosesAt instanceof Date) {
    return { questionOpenedAt, questionClosesAt: input.questionClosesAt };
  }
  const block = session.content.blocks[input.currentBlockIndex];
  return {
    questionOpenedAt,
    questionClosesAt:
      block?.kind === "question"
        ? new Date(questionOpenedAt.getTime() + block.question.timeLimitSeconds * 1_000)
        : null,
  };
}

export function responseWindowOpen(
  session: PresentationSessionRecord,
  response: PresentationSessionResponseRecord,
  expectedSessionRevision: number,
) {
  if (
    session.status !== "active" ||
    session.phase !== "question_open" ||
    session.revision !== expectedSessionRevision ||
    response.submittedAt >= session.liveExpiresAt
  ) {
    return false;
  }
  const block = session.content.blocks[session.currentBlockIndex];
  if (
    block?.kind !== "question" ||
    block.id !== response.blockId ||
    block.question.id !== response.questionId ||
    session.questionOpenedAt === null ||
    response.submittedAt < session.questionOpenedAt
  ) {
    return false;
  }
  return (
    session.questionClosesAt === null ||
    response.submittedAt.getTime() <= session.questionClosesAt.getTime()
  );
}
