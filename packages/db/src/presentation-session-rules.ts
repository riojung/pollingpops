import { validatePresentationInteractionState } from "./presentation-interactions.js";
import { validatePresentationNavigationState } from "./presentation-navigation.js";
import { PresentationTextCapacityError } from "./presentation-text-types.js";
import {
  PresentationContentSchema,
  isPresentationOpinionResultQuestion,
  isPresentationTextResultQuestion,
  normalizeTextResponse,
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
import {
  presentationResponseSchemaVersion,
  upcastPresentationResponse,
} from "./response-schemas.js";
import { upcastPresentationSessionContent } from "./artifact-schemas.js";

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function normalizeSession(input: PresentationSessionCreateInput): PresentationSessionRecord {
  const content = upcastPresentationSessionContent(input.content, input.content.schemaVersion);
  if (content.schemaVersion < 12 && input.navigationState !== undefined)
    throw new Error("Navigation requires Presentation schema version 12");
  if (content.schemaVersion !== 13 && input.interactionState !== undefined)
    throw new Error("Shared interactions require Presentation schema version 13");
  if (content.schemaVersion === 13 && (input.interactionState?.reveals.length ?? 0) !== 0)
    throw new Error("Initial interaction state cannot invent reveals");
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
  const currentQuestion = content.blocks[input.currentBlockIndex];
  const progressOpenedAt =
    content.schemaVersion >= 12 && currentQuestion?.kind === "question"
      ? (questionOpenedAt ?? input.updatedAt)
      : null;
  const progressClosesAt =
    progressOpenedAt && currentQuestion?.kind === "question" && settings.timeMode !== "flex"
      ? (questionClosesAt ??
        new Date(progressOpenedAt.getTime() + currentQuestion.question.timeLimitSeconds * 1000))
      : null;
  return {
    ...input,
    joinPasswordHash: input.joinPasswordHash ?? null,
    content,
    settings,
    ...(content.schemaVersion >= 10 ? { textModerationSeq: input.textModerationSeq ?? 0 } : {}),
    ...(content.schemaVersion >= 12
      ? {
          navigationState: validatePresentationNavigationState(
            content,
            input.navigationState ?? {
              returnBlockId: null,
              blocks:
                input.phase === "lobby" || input.phase === "finished"
                  ? []
                  : [
                      {
                        blockId: content.blocks[input.currentBlockIndex]?.id,
                        phase: input.phase,
                        questionOpenedAt: progressOpenedAt?.toISOString() ?? null,
                        questionClosesAt: progressClosesAt?.toISOString() ?? null,
                        ...(input.phase === "intervention" ? { recoveryPackIntervention } : {}),
                      },
                    ],
            },
          ),
        }
      : {}),
    ...(content.schemaVersion === 13
      ? {
          interactionState: validatePresentationInteractionState(
            content,
            input.interactionState ?? { reveals: [] },
          ),
        }
      : {}),
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
    | "expectedRevision"
    | "requestHash"
    | "recoveryPackIntervention"
    | "content"
    | "navigationState"
    | "interactionState"
    | "event"
  >,
) {
  return (
    receipt.expectedRevision === input.expectedRevision &&
    (receipt.requestHash == null
      ? input.recoveryPackIntervention == null &&
        input.content == null &&
        input.navigationState == null &&
        input.interactionState == null &&
        input.event.interaction == null &&
        input.event.branch == null &&
        input.event.type !== "scene.reveal_changed" &&
        input.event.navigation == null &&
        !input.event.type.startsWith("navigation.")
      : receipt.requestHash === input.requestHash)
  );
}

export function transitionContent(
  session: PresentationSessionRecord,
  input: Pick<PresentationSessionTransitionInput, "content">,
) {
  if (input.content === undefined) return session.content;
  const content = PresentationContentSchema.parse(input.content);
  if (session.content.schemaVersion >= 12) {
    if (
      content.schemaVersion !== session.content.schemaVersion ||
      JSON.stringify(content.sections) !== JSON.stringify(session.content.sections)
    )
      throw new Error("Live navigation content must preserve frozen sections");
    let previousIndex = -1;
    for (const block of session.content.blocks) {
      const index = content.blocks.findIndex(
        (candidate) => candidate.id.toLowerCase() === block.id.toLowerCase(),
      );
      if (index <= previousIndex || JSON.stringify(content.blocks[index]) !== JSON.stringify(block))
        throw new Error(
          "Live navigation insertions must preserve existing frozen blocks and their order",
        );
      previousIndex = index;
    }
  }
  return content;
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
    (session.content.schemaVersion >= 12 ||
    isPresentationOpinionResultQuestion(block.question) ||
    isPresentationTextResultQuestion(block.question)
      ? block.id.toLowerCase() !== response.blockId.toLowerCase() ||
        block.question.id.toLowerCase() !== response.questionId.toLowerCase()
      : block.id !== response.blockId || block.question.id !== response.questionId) ||
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

/** E04 UUIDs share the frozen block identity; legacy key spelling remains literal. */
export function presentationResponseBlockId(
  session: PresentationSessionRecord | undefined,
  blockId: string,
): string {
  return (
    session?.content.blocks.find(
      (block) =>
        block.kind === "question" &&
        (session.content.schemaVersion >= 12 ||
          isPresentationOpinionResultQuestion(block.question) ||
          isPresentationTextResultQuestion(block.question)) &&
        block.id.toLowerCase() === blockId.toLowerCase(),
    )?.id ?? blockId
  );
}

/** Private text rows keep a complete retry fingerprint even after their body is erased. */
export function assertPresentationTextReceiptIdentity(
  input: PresentationSessionResponseRecord,
): void {
  if (input.responseSchemaVersion !== 3 && input.response.textValue === undefined) return;
  if (
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.length < 1 ||
    input.idempotencyKey.length > 160 ||
    typeof input.requestHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.requestHash)
  )
    throw new Error("Presentation text responses require a complete retry receipt");
}

export function normalizePresentationResponse(
  session: PresentationSessionRecord | undefined,
  input: PresentationSessionResponseRecord,
): PresentationSessionResponseRecord {
  assertPresentationTextReceiptIdentity(input);
  const block = session?.content.blocks.find(
    (candidate) =>
      candidate.id === input.blockId ||
      (candidate.kind === "question" &&
        ((session?.content.schemaVersion ?? 0) >= 12 ||
          isPresentationOpinionResultQuestion(candidate.question) ||
          isPresentationTextResultQuestion(candidate.question)) &&
        candidate.id.toLowerCase() === input.blockId.toLowerCase()),
  );
  const question = block?.kind === "question" ? block.question : undefined;
  const responseSchemaVersion =
    input.responseSchemaVersion ?? presentationResponseSchemaVersion(input.response, question);
  if (question && isPresentationTextResultQuestion(question)) {
    if (
      (session?.content.schemaVersion ?? 0) < 10 ||
      responseSchemaVersion !== 3 ||
      input.correct !== null ||
      input.score !== 0 ||
      question.id.toLowerCase() !== input.questionId.toLowerCase() ||
      input.response.textValue === undefined ||
      input.response.choiceIds !== undefined ||
      input.response.orderedChoiceIds !== undefined ||
      input.response.numericValue !== undefined ||
      input.response.ratingValue !== undefined ||
      input.response.confidence != null
    )
      throw new Error("Invalid unscored Presentation text response");
    normalizeTextResponse(input.response.textValue, question.type);
    return {
      ...clone(input),
      blockId: block!.id,
      questionId: question.id,
      response: {},
      responseSchemaVersion: 3,
      moderationStatus: "pending",
      moderationVersion: 0,
      moderatedAt: null,
    };
  }
  const response = upcastPresentationResponse(input.response, responseSchemaVersion);
  const opinion = question && isPresentationOpinionResultQuestion(question);
  if (opinion || response.orderedChoiceIds !== undefined) {
    const choices = question && "choices" in question ? question.choices : [];
    const selected = question?.type === "ranking" ? response.orderedChoiceIds : response.choiceIds;
    const limit =
      question?.type === "ranking"
        ? (question.rankCount ?? choices.length)
        : question?.type === "poll"
          ? (question.maxSelections ?? 1)
          : 0;
    if (
      !opinion ||
      (session?.content.schemaVersion ?? 0) < 9 ||
      responseSchemaVersion !== 2 ||
      question?.id.toLowerCase() !== input.questionId.toLowerCase() ||
      input.correct !== null ||
      input.score !== 0 ||
      response.confidence != null ||
      response.numericValue !== undefined ||
      response.ratingValue !== undefined ||
      !selected ||
      selected.length < 1 ||
      selected.length > limit ||
      new Set(selected.map((id) => id.toLowerCase())).size !== selected.length ||
      selected.some(
        (id) => !choices.some((choice) => choice.id.toLowerCase() === id.toLowerCase()),
      ) ||
      (question?.type === "ranking" &&
        (response.choiceIds !== undefined || selected.length !== limit)) ||
      (question?.type === "poll" && response.orderedChoiceIds !== undefined)
    ) {
      throw new Error(
        "Presentation opinion responses must match the frozen v9 unscored response v2 question",
      );
    }
  }
  return {
    ...clone(input),
    ...((opinion || (session?.content.schemaVersion ?? 0) >= 12) && block && question
      ? { blockId: block.id, questionId: question.id }
      : {}),
    responseSchemaVersion,
    response,
  };
}

export function presentationTextValue(
  session: PresentationSessionRecord,
  input: PresentationSessionResponseRecord,
): string | null {
  const block = session.content.blocks.find(
    (block) => block.id.toLowerCase() === input.blockId.toLowerCase(),
  );
  return block?.kind === "question" &&
    isPresentationTextResultQuestion(block.question) &&
    input.response.textValue !== undefined
    ? normalizeTextResponse(input.response.textValue, block.question.type)
    : null;
}
export function assertPresentationTextCapacity(
  session: PresentationSessionRecord,
  responses: PresentationSessionResponseRecord[],
  blockId: string,
) {
  if (
    responses.filter((response) => response.responseSchemaVersion === 3).length >= 2500 ||
    responses.filter(
      (response) =>
        response.responseSchemaVersion === 3 &&
        response.blockId.toLowerCase() === blockId.toLowerCase(),
    ).length >= 250
  )
    throw new PresentationTextCapacityError();
}
