import {
  PresentationCompanionSnapshotSchema,
  PresentationHostSnapshotSchema,
  PresentationParticipantSnapshotSchema,
  PresentationStageSnapshotSchema,
  type PresentationBlock,
  type PresentationCompanionSnapshot,
  type PresentationHostSnapshot,
  type PresentationParticipantSnapshot,
  type PresentationSceneDesign,
  type PresentationStageSnapshot,
  type QuestionDraft,
  presentationQuestionSupported,
  questionPurpose,
  isPresentationOpinionResultQuestion,
  isPresentationTextResultQuestion,
  requiresPresentationTextOpinions,
} from "@openround/contracts";
import {
  comparePresentationLeaderboardEntries,
  type PresentationParticipantSnapshotProjection,
  type PresentationSessionParticipantRecord,
  type PresentationSessionRecord,
  type PresentationSessionResponseRecord,
  type PresentationSessionTimelineRecord,
} from "@openround/db";
import {
  frozenPresentationRecoveryPackCards,
  presentationRecoveryPackPlayback,
  presentationSnapshotSettings,
} from "./presentation-recovery-pack-cards.js";

import {
  presentationCompetitionStandings,
  presentationHasQuestions,
  presentationHasParticipantStandings,
  presentationScoredResponses,
} from "./presentation-competition.js";
import { presentationOpinionSummary } from "./presentation-opinion-results.js";
import { presentationNavigationSnapshot } from "./presentation-navigation.js";
import { presentationSpatialSnapshotFields } from "./presentation-spatial.js";
import {
  presentationDeliveredScene,
  presentationInteractionSnapshot,
  presentationBranchSnapshot,
} from "./presentation-advanced-interactions.js";
import {
  presentationResponseMatchesBlock,
  presentationResponsesForContent,
} from "./presentation-response-identifiers.js";

const PRESENTATION_PARTICIPANT_PRESENCE_WINDOW_MS = 15_000;

/** Only frozen, visible scene tokens cross the public delivery boundary. */
function presentationBlockDesign(
  block: PresentationBlock,
  session?: PresentationSessionRecord,
): PresentationSceneDesign | undefined {
  if (!session) return undefined;
  const blocks = session.content.blocks;
  const index = blocks.findIndex((candidate) => candidate.id === block.id);
  if (index < 0) return undefined;
  const explicitDesign = (candidate: PresentationBlock | undefined) => {
    if (
      candidate?.kind !== "content" ||
      ("hidden" in candidate && candidate.hidden === true) ||
      !candidate.scene?.design
    )
      return undefined;
    const { theme, font, spacing } = candidate.scene.design;
    return { theme, font, spacing };
  };
  const ownDesign = explicitDesign(blocks[index]);
  if (ownDesign) return ownDesign;
  for (let preceding = index - 1; preceding >= 0; preceding--) {
    const design = explicitDesign(blocks[preceding]);
    if (design) return design;
  }
  for (let following = index + 1; following < blocks.length; following++) {
    const design = explicitDesign(blocks[following]);
    if (design) return design;
  }
  // Omission keeps legacy wire records compatible; the renderer defaults to Paper/Sans/Relaxed.
  return undefined;
}

export interface PresentationProjectionData {
  participants: PresentationSessionParticipantRecord[];
  responses: PresentationSessionResponseRecord[];
  timeline: PresentationSessionTimelineRecord[];
  leaderboard: ReturnType<typeof rankedParticipants>;
  facilitatorLeaderboard: ReturnType<typeof rankedParticipants>;
  responseByParticipantAndBlock: Map<string, PresentationSessionResponseRecord>;
  latestReceiptByParticipant: Map<string, PresentationSessionResponseRecord>;
}

export function presentationCurrentBlock(session: PresentationSessionRecord) {
  return session.currentBlockIndex >= 0
    ? (session.content.blocks[session.currentBlockIndex] ?? null)
    : null;
}

export function presentationQuestionDeadline(session: PresentationSessionRecord) {
  const block = presentationCurrentBlock(session);
  if (session.phase !== "question_open" || block?.kind !== "question") return null;
  return session.questionClosesAt;
}

export function presentationAcceptingResponses(
  session: PresentationSessionRecord,
  now = new Date(),
) {
  const block = presentationCurrentBlock(session);
  if (session.phase !== "question_open" || block?.kind !== "question") return false;
  return session.questionClosesAt === null || session.questionClosesAt.getTime() >= now.getTime();
}

function rankedParticipants(
  participants: PresentationSessionParticipantRecord[],
  responses: PresentationSessionResponseRecord[],
) {
  const scores = new Map<string, number>();
  for (const response of responses) {
    scores.set(response.participantId, (scores.get(response.participantId) ?? 0) + response.score);
  }
  return participants
    .map((participant) => ({
      id: participant.id,
      nickname: participant.nickname,
      joinedAt: participant.joinedAt,
      score: scores.get(participant.id) ?? 0,
    }))
    .sort(comparePresentationLeaderboardEntries)
    .map((participant, index) => ({ ...participant, rank: index + 1 }));
}

function facilitatorVisibleResponses(
  session: PresentationSessionRecord,
  responses: PresentationSessionResponseRecord[],
) {
  const block = presentationCurrentBlock(session);
  if (session.phase !== "question_open" || block?.kind !== "question") return responses;
  // A correct response immediately earns points. Including the open question in the live
  // leaderboard would therefore disclose correctness (and timing through the exact score) before
  // the facilitator reveals the answer.
  return responses.filter((response) => response.blockId !== block.id);
}

/**
 * Participant projection is deliberately an allowlist. New authoring fields remain private until
 * explicitly reviewed for participant delivery.
 */
export function presentationParticipantBlock(
  block: PresentationBlock | null,
  session?: PresentationSessionRecord,
) {
  if (!block) return null;
  const design = presentationBlockDesign(block, session);
  if (block.kind === "content") {
    return {
      id: block.id,
      kind: block.kind,
      layout: block.layout,
      textElements: block.textElements.map((element) => ({ ...element })),
      mediaId: block.mediaId,
      mediaAlt: block.mediaAlt,
      ...(design ? { design } : {}),
      ...(block.scene ? { scene: presentationDeliveredScene(block, session) } : {}),
    };
  }
  const question = block.question;
  const blockFields = { id: block.id, kind: block.kind, ...(design ? { design } : {}) };
  if (!presentationQuestionSupported(question)) {
    throw new Error("This response format currently supports Live Rounds only");
  }
  const base = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    confidence:
      isPresentationOpinionResultQuestion(question) || isPresentationTextResultQuestion(question)
        ? "off"
        : question.confidence,
    timeLimitSeconds: question.timeLimitSeconds,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
    ...(question.type === "poll" && question.maxSelections !== undefined
      ? { maxSelections: question.maxSelections }
      : {}),
    ...(question.type === "ranking"
      ? { rankCount: question.rankCount ?? question.choices.length }
      : {}),
  };
  if (question.type === "numeric" || isPresentationTextResultQuestion(question))
    return { ...blockFields, question: base };
  if (question.type === "rating") {
    return {
      ...blockFields,
      question: {
        ...base,
        min: question.min,
        max: question.max,
        minLabel: question.minLabel,
        maxLabel: question.maxLabel,
      },
    };
  }
  if (!("choices" in question)) throw new Error("Unsupported Presentation response format");
  return {
    ...blockFields,
    question: {
      ...base,
      choices: question.choices.map(({ id, label }) => ({ id, label })),
    },
  };
}

function presentationLiveQuestion(question: QuestionDraft, facilitator: boolean) {
  if (!presentationQuestionSupported(question)) {
    throw new Error("This response format currently supports Live Rounds only");
  }
  const projected = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    confidence:
      isPresentationOpinionResultQuestion(question) || isPresentationTextResultQuestion(question)
        ? "off"
        : (question.confidence ?? "off"),
    choices:
      "choices" in question
        ? question.choices.map((choice) => ({ id: choice.id, label: choice.label }))
        : [],
    ...(question.type === "numeric" ? { unit: question.unit } : {}),
    ...(question.type === "rating"
      ? {
          rating: {
            min: question.min,
            max: question.max,
            minLabel: question.minLabel,
            maxLabel: question.maxLabel,
          },
        }
      : {}),
    timeLimitSeconds: question.timeLimitSeconds,
    basePoints:
      isPresentationOpinionResultQuestion(question) || isPresentationTextResultQuestion(question)
        ? 0
        : question.basePoints,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
    ...(question.type === "poll" && question.maxSelections !== undefined
      ? { maxSelections: question.maxSelections }
      : {}),
    ...(question.type === "ranking"
      ? { rankCount: question.rankCount ?? question.choices.length }
      : {}),
  };
  return facilitator
    ? {
        ...projected,
        purpose: questionPurpose(question),
        linkedRecheckAvailable: Boolean(question.linkedRecheckQuestionId),
      }
    : projected;
}

function presentationRevealedAnswer(question: QuestionDraft) {
  if (!presentationQuestionSupported(question)) {
    throw new Error("This response format currently supports Live Rounds only");
  }
  if (question.type === "numeric") {
    return {
      kind: "numeric" as const,
      correctValue: question.correctValue,
      tolerance: question.tolerance,
      unit: question.unit,
      explanation: question.explanation,
    };
  }
  if (
    question.type === "poll" ||
    question.type === "rating" ||
    question.type === "ranking" ||
    isPresentationTextResultQuestion(question)
  ) {
    return { kind: "unscored" as const, explanation: question.explanation };
  }
  if (!("choices" in question)) throw new Error("Unsupported Presentation response format");
  return {
    kind: "choice" as const,
    correctChoiceIds: question.choices
      .filter((choice) => choice.isCorrect)
      .map((choice) => choice.id),
    explanation: question.explanation,
  };
}

function presentationRealtimeBlock(
  block: PresentationBlock | null,
  facilitator: boolean,
  revealAnswer = false,
  session?: PresentationSessionRecord,
  staffScene = facilitator,
) {
  if (!block) return null;
  const design = presentationBlockDesign(block, session);
  if (block.kind === "content") {
    return {
      id: block.id,
      kind: block.kind,
      layout: block.layout,
      textElements: block.textElements.map((element) => ({ ...element })),
      mediaId: block.mediaId,
      mediaAlt: block.mediaAlt,
      ...(design ? { design } : {}),
      ...(block.scene ? { scene: presentationDeliveredScene(block, session, staffScene) } : {}),
    };
  }
  return {
    id: block.id,
    kind: block.kind,
    ...(design ? { design } : {}),
    question: presentationLiveQuestion(block.question, facilitator),
    ...(facilitator
      ? {
          revealedAnswer: revealAnswer ? presentationRevealedAnswer(block.question) : null,
        }
      : {}),
  };
}

export function buildPresentationProjectionData(
  session: PresentationSessionRecord,
  participants: PresentationSessionParticipantRecord[],
  responses: PresentationSessionResponseRecord[],
  timeline: PresentationSessionTimelineRecord[] = [],
): PresentationProjectionData {
  responses = presentationResponsesForContent(session.content, responses);
  const responseByParticipantAndBlock = new Map<string, PresentationSessionResponseRecord>();
  const latestReceiptByParticipant = new Map<string, PresentationSessionResponseRecord>();
  for (const response of responses) {
    responseByParticipantAndBlock.set(`${response.participantId}:${response.blockId}`, response);
    if (response.idempotencyKey) {
      const current = latestReceiptByParticipant.get(response.participantId);
      if (!current || current.submittedAt <= response.submittedAt) {
        latestReceiptByParticipant.set(response.participantId, response);
      }
    }
  }
  return {
    participants,
    responses,
    timeline,
    leaderboard: rankedParticipants(participants, presentationScoredResponses(session, responses)),
    facilitatorLeaderboard: rankedParticipants(
      participants,
      facilitatorVisibleResponses(session, presentationScoredResponses(session, responses)),
    ),
    responseByParticipantAndBlock,
    latestReceiptByParticipant,
  };
}

export function buildPresentationHostSnapshot(
  session: PresentationSessionRecord,
  data: PresentationProjectionData,
  connectedParticipantIds: ReadonlySet<string> = new Set(),
): PresentationHostSnapshot {
  const { participants, responses } = data;
  const block = presentationCurrentBlock(session);
  const responseCount =
    block?.kind === "question"
      ? responses.filter((response) => response.blockId === block.id).length
      : 0;
  const sampledAt = new Date();
  const recoveryPackCards =
    session.phase === "question_reveal" ? frozenPresentationRecoveryPackCards(session) : [];
  const recoveryPackIntervention = presentationRecoveryPackPlayback(session);
  const connectedCount = participants.filter(
    (participant) =>
      connectedParticipantIds.has(participant.id) ||
      sampledAt.getTime() - participant.lastSeenAt.getTime() <=
        PRESENTATION_PARTICIPANT_PRESENCE_WINDOW_MS,
  ).length;
  const opinionSummary = ["question_reveal", "intervention", "finished"].includes(session.phase)
    ? presentationOpinionSummary(block, responses)
    : undefined;
  return PresentationHostSnapshotSchema.parse({
    sessionId: session.id,
    artifactType: "presentation",
    presentationId: session.presentationId,
    presentationVersionId: session.presentationVersionId,
    title: session.title,
    code: session.code,
    status: session.status,
    phase: session.phase,
    currentBlockIndex: session.currentBlockIndex,
    blockCount: session.content.blocks.length,
    revision: session.revision,
    seq: session.eventSeq,
    serverTime: sampledAt.toISOString(),
    questionOpenedAt: session.questionOpenedAt?.toISOString() ?? null,
    questionClosesAt: presentationQuestionDeadline(session)?.toISOString() ?? null,
    acceptingResponses: presentationAcceptingResponses(session),
    settings: presentationSnapshotSettings(session),
    ...(recoveryPackCards.length ? { recoveryPackCards } : {}),
    ...(recoveryPackIntervention ? { recoveryPackIntervention } : {}),
    projection: "host",
    ...presentationSpatialSnapshotFields(session.content),
    ...(session.content.schemaVersion >= 12
      ? { navigation: presentationNavigationSnapshot(session) }
      : {}),
    ...(session.content.schemaVersion >= 13
      ? {
          interactionState: presentationInteractionSnapshot(session, true),
          branches: presentationBranchSnapshot(session, responses),
        }
      : {}),
    ...(requiresPresentationTextOpinions(session.content) ? { textModerationAvailable: true } : {}),
    presenter: {
      speakerNotes: block?.kind === "content" ? block.speakerNotes : "",
      nextBlock:
        session.status === "finished"
          ? null
          : presentationRealtimeBlock(
              session.content.blocks[session.currentBlockIndex + 1] ?? null,
              false,
              false,
              session,
              true,
            ),
    },
    currentBlock: presentationRealtimeBlock(
      block,
      true,
      session.phase === "question_reveal" ||
        session.phase === "intervention" ||
        session.phase === "finished",
      session,
    ),
    participantCount: participants.length,
    ...(presentationHasQuestions(session)
      ? {
          competitionStandings: presentationCompetitionStandings(
            session,
            participants,
            data.responses,
            data.timeline,
          ),
        }
      : {}),
    responseCount,
    ...(opinionSummary ? { opinionSummary } : {}),
    participants: data.facilitatorLeaderboard.map(({ id, nickname, joinedAt, score, rank }) => ({
      id,
      nickname,
      joinedAt: joinedAt.toISOString(),
      score,
      rank,
    })),
    roomStatus: {
      sessionId: session.id,
      joinedCount: participants.length,
      connectedCount,
      notCurrentlyConnectedCount: participants.length - connectedCount,
      responseCount,
      sampledAt: sampledAt.toISOString(),
    },
    finishedAt: session.finishedAt?.toISOString() ?? null,
  });
}

export function buildPresentationStageSnapshot(
  session: PresentationSessionRecord,
  data: PresentationProjectionData,
): PresentationStageSnapshot {
  const block = presentationCurrentBlock(session);
  const recoveryPackIntervention = presentationRecoveryPackPlayback(session);
  const answerVisible = ["question_reveal", "intervention", "finished"].includes(session.phase);
  const opinionSummary = answerVisible
    ? presentationOpinionSummary(block, data.responses)
    : undefined;
  return PresentationStageSnapshotSchema.parse({
    sessionId: session.id,
    artifactType: "presentation",
    presentationId: session.presentationId,
    presentationVersionId: session.presentationVersionId,
    title: session.title,
    code: session.code,
    status: session.status,
    phase: session.phase,
    currentBlockIndex: session.currentBlockIndex,
    blockCount: session.content.blocks.length,
    revision: session.revision,
    seq: session.eventSeq,
    serverTime: new Date().toISOString(),
    questionOpenedAt: session.questionOpenedAt?.toISOString() ?? null,
    questionClosesAt: presentationQuestionDeadline(session)?.toISOString() ?? null,
    acceptingResponses: presentationAcceptingResponses(session),
    settings: presentationSnapshotSettings(session),
    ...(recoveryPackIntervention ? { recoveryPackIntervention } : {}),
    projection: "stage",
    ...presentationSpatialSnapshotFields(session.content),
    ...(session.content.schemaVersion >= 13
      ? { interactionState: presentationInteractionSnapshot(session) }
      : {}),
    currentBlock: presentationRealtimeBlock(block, false, false, session),
    revealedAnswer:
      answerVisible && block?.kind === "question"
        ? presentationRevealedAnswer(block.question)
        : null,
    ...(opinionSummary ? { opinionSummary } : {}),
    participantCount: data.participants.length,
    responseCount:
      block?.kind === "question"
        ? data.responses.filter((response) => response.blockId === block.id).length
        : 0,
    finishedAt: session.finishedAt?.toISOString() ?? null,
  });
}

export function buildPresentationParticipantSnapshot(
  session: PresentationSessionRecord,
  participantId: string,
  data: PresentationProjectionData,
): PresentationParticipantSnapshot {
  const block = presentationCurrentBlock(session);
  const currentResponse = block
    ? data.responseByParticipantAndBlock.get(`${participantId}:${block.id}`)
    : undefined;
  const latestResponse = data.latestReceiptByParticipant.get(participantId);
  const standing = data.leaderboard.find((entry) => entry.id === participantId);
  const resultVisible =
    session.phase === "question_reveal" ||
    session.phase === "intervention" ||
    session.phase === "finished";
  const recoveryPackIntervention = presentationRecoveryPackPlayback(session);
  const opinionSummary = resultVisible
    ? presentationOpinionSummary(block, data.responses)
    : undefined;
  const ownTextResponse =
    block?.kind === "question" &&
    isPresentationTextResultQuestion(block.question) &&
    currentResponse?.moderationStatus
      ? {
          responseId: currentResponse.id,
          blockId: block.id,
          status: currentResponse.moderationStatus,
          moderationVersion: currentResponse.moderationVersion ?? 0,
        }
      : undefined;
  return PresentationParticipantSnapshotSchema.parse({
    sessionId: session.id,
    artifactType: "presentation",
    presentationId: session.presentationId,
    presentationVersionId: session.presentationVersionId,
    title: session.title,
    code: session.code,
    status: session.status,
    phase: session.phase,
    currentBlockIndex: session.currentBlockIndex,
    blockCount: session.content.blocks.length,
    revision: session.revision,
    seq: session.eventSeq,
    serverTime: new Date().toISOString(),
    questionOpenedAt: session.questionOpenedAt?.toISOString() ?? null,
    questionClosesAt: presentationQuestionDeadline(session)?.toISOString() ?? null,
    acceptingResponses: presentationAcceptingResponses(session),
    settings: presentationSnapshotSettings(session),
    ...(recoveryPackIntervention ? { recoveryPackIntervention } : {}),
    projection: "participant",
    ...presentationSpatialSnapshotFields(session.content),
    ...(session.content.schemaVersion >= 13
      ? { interactionState: presentationInteractionSnapshot(session) }
      : {}),
    participantId,
    currentBlock: presentationRealtimeBlock(block, false, false, session),
    participantCount: data.participants.length,
    responseSubmitted: Boolean(currentResponse),
    ...(ownTextResponse ? { ownTextResponse } : {}),
    responseReceipt: latestResponse?.idempotencyKey
      ? {
          responseId: latestResponse.id,
          blockId: latestResponse.blockId,
          idempotencyKey: latestResponse.idempotencyKey,
          acceptedAt: latestResponse.submittedAt.toISOString(),
        }
      : null,
    standing:
      presentationHasParticipantStandings(session) && session.phase !== "question_open" && standing
        ? { rank: standing.rank, score: standing.score }
        : null,
    ...(opinionSummary ? { opinionSummary } : {}),
    responseResult:
      resultVisible &&
      currentResponse &&
      !(
        block?.kind === "question" &&
        (isPresentationOpinionResultQuestion(block.question) ||
          isPresentationTextResultQuestion(block.question))
      )
        ? { correct: currentResponse.correct, score: currentResponse.score }
        : null,
    finishedAt: session.finishedAt?.toISOString() ?? null,
  });
}

export function buildTargetedPresentationParticipantSnapshot(
  session: PresentationSessionRecord,
  participantId: string,
  projection: PresentationParticipantSnapshotProjection,
  acknowledgedResponse: PresentationSessionResponseRecord,
): PresentationParticipantSnapshot {
  acknowledgedResponse = presentationResponsesForContent(session.content, [
    acknowledgedResponse,
  ])[0]!;
  const projectedCurrentResponse = projection.currentResponse
    ? presentationResponsesForContent(session.content, [projection.currentResponse])[0]!
    : null;
  const block = presentationCurrentBlock(session);
  const currentResponse = presentationResponseMatchesBlock(
    block,
    acknowledgedResponse.blockId,
    session.content.schemaVersion >= 12,
  )
    ? block?.kind === "question" &&
      isPresentationTextResultQuestion(block.question) &&
      projectedCurrentResponse?.id === acknowledgedResponse.id
      ? projectedCurrentResponse
      : acknowledgedResponse
    : projectedCurrentResponse;
  const ownTextResponse =
    block?.kind === "question" &&
    isPresentationTextResultQuestion(block.question) &&
    currentResponse?.moderationStatus
      ? {
          responseId: currentResponse.id,
          blockId: block.id,
          status: currentResponse.moderationStatus,
          moderationVersion: currentResponse.moderationVersion ?? 0,
        }
      : undefined;
  const resultVisible =
    session.phase === "question_reveal" ||
    session.phase === "intervention" ||
    session.phase === "finished";
  const recoveryPackIntervention = presentationRecoveryPackPlayback(session);
  return PresentationParticipantSnapshotSchema.parse({
    sessionId: session.id,
    artifactType: "presentation",
    presentationId: session.presentationId,
    presentationVersionId: session.presentationVersionId,
    title: session.title,
    code: session.code,
    status: session.status,
    phase: session.phase,
    currentBlockIndex: session.currentBlockIndex,
    blockCount: session.content.blocks.length,
    revision: session.revision,
    seq: session.eventSeq,
    serverTime: new Date().toISOString(),
    questionOpenedAt: session.questionOpenedAt?.toISOString() ?? null,
    questionClosesAt: presentationQuestionDeadline(session)?.toISOString() ?? null,
    acceptingResponses: presentationAcceptingResponses(session),
    settings: presentationSnapshotSettings(session),
    ...(recoveryPackIntervention ? { recoveryPackIntervention } : {}),
    projection: "participant",
    ...presentationSpatialSnapshotFields(session.content),
    participantId,
    ...(session.content.schemaVersion >= 13
      ? { interactionState: presentationInteractionSnapshot(session) }
      : {}),
    currentBlock: presentationRealtimeBlock(block, false, false, session),
    participantCount: projection.participantCount,
    responseSubmitted: Boolean(currentResponse),
    ...(ownTextResponse ? { ownTextResponse } : {}),
    standing:
      presentationHasParticipantStandings(session) && session.phase !== "question_open"
        ? projection.standing
        : null,
    responseResult:
      resultVisible &&
      currentResponse &&
      !(
        block?.kind === "question" &&
        (isPresentationOpinionResultQuestion(block.question) ||
          isPresentationTextResultQuestion(block.question))
      )
        ? { correct: currentResponse.correct, score: currentResponse.score }
        : null,
    finishedAt: session.finishedAt?.toISOString() ?? null,
  });
}

export function buildPresentationCompanionSnapshot(
  session: PresentationSessionRecord,
  data: PresentationProjectionData,
  connectedParticipantIds: ReadonlySet<string> = new Set(),
  canInsertRecoveryPack = false,
  canInsertQuickCheck = false,
  canInsertPublishedQuestion = false,
): PresentationCompanionSnapshot {
  const host = buildPresentationHostSnapshot(session, data, connectedParticipantIds);
  const block = presentationCurrentBlock(session);
  const resultVisible =
    session.phase === "question_reveal" ||
    session.phase === "intervention" ||
    session.phase === "finished";
  const currentResponses =
    resultVisible && block?.kind === "question"
      ? data.responses.filter((response) => response.blockId === block.id)
      : [];
  const choiceCounts =
    block?.kind === "question" && "choices" in block.question
      ? block.question.choices.map(({ id }) => ({
          choiceId: id,
          count: currentResponses.filter(({ response }) => response.choiceIds?.includes(id)).length,
        }))
      : [];
  return PresentationCompanionSnapshotSchema.parse({
    sessionId: host.sessionId,
    artifactType: host.artifactType,
    presentationId: host.presentationId,
    presentationVersionId: host.presentationVersionId,
    title: host.title,
    code: host.code,
    status: host.status,
    phase: host.phase,
    currentBlockIndex: host.currentBlockIndex,
    blockCount: host.blockCount,
    revision: host.revision,
    seq: host.seq,
    serverTime: host.serverTime,
    questionOpenedAt: host.questionOpenedAt,
    questionClosesAt: host.questionClosesAt,
    acceptingResponses: host.acceptingResponses,
    settings: host.settings,
    ...(host.recoveryPackIntervention
      ? { recoveryPackIntervention: host.recoveryPackIntervention }
      : {}),
    projection: "companion",
    ...(host.spatial ? { spatial: host.spatial } : {}),
    ...(host.navigation ? { navigation: host.navigation } : {}),
    ...(host.interactionState
      ? { interactionState: host.interactionState, branches: host.branches }
      : {}),
    currentBlock: presentationRealtimeBlock(block, false, false, session, true),
    roomStatus: host.roomStatus,
    canInsertRecoveryPack,
    canInsertQuickCheck,
    canInsertPublishedQuestion,
    ...(host.recoveryPackCards?.length
      ? {
          recoveryPackCards: host.recoveryPackCards.map(({ reference, title }) => ({
            reference,
            title,
          })),
        }
      : {}),
    resultSummary:
      resultVisible &&
      block?.kind === "question" &&
      block.question.type !== "ranking" &&
      !isPresentationTextResultQuestion(block.question)
        ? { blockId: block.id, responseCount: currentResponses.length, choiceCounts }
        : null,
    ...(host.opinionSummary ? { opinionSummary: host.opinionSummary } : {}),
    primaryAction: session.status === "active" ? "advance" : "none",
    finishedAt: host.finishedAt,
  });
}

export function buildPresentationListSnapshot(
  session: PresentationSessionRecord,
  participants: PresentationSessionParticipantRecord[],
  responses: PresentationSessionResponseRecord[],
) {
  responses = presentationResponsesForContent(session.content, responses);
  const block = presentationCurrentBlock(session);
  const opinionSummary = ["question_reveal", "intervention", "finished"].includes(session.phase)
    ? presentationOpinionSummary(block, responses)
    : undefined;
  const leaderboard = rankedParticipants(
    participants,
    facilitatorVisibleResponses(session, presentationScoredResponses(session, responses)),
  ).map(({ joinedAt, ...participant }) => ({
    ...participant,
    joinedAt: joinedAt.toISOString(),
  }));
  return {
    id: session.id,
    artifactType: "presentation" as const,
    presentationId: session.presentationId,
    presentationVersionId: session.presentationVersionId,
    title: session.title,
    code: session.code,
    status: session.status,
    phase: session.phase,
    currentBlockIndex: session.currentBlockIndex,
    blockCount: session.content.blocks.length,
    revision: session.revision,
    settings: { ...session.settings, trustMode: session.trustMode },
    trustMode: session.trustMode,
    eventSeq: session.eventSeq,
    currentBlock: presentationRealtimeBlock(
      block,
      true,
      session.phase === "question_reveal" ||
        session.phase === "intervention" ||
        session.phase === "finished",
      session,
    ),
    questionOpenedAt: session.questionOpenedAt?.toISOString() ?? null,
    questionClosesAt: presentationQuestionDeadline(session)?.toISOString() ?? null,
    acceptingResponses: presentationAcceptingResponses(session),
    participantCount: participants.length,
    responseCount:
      block?.kind === "question"
        ? responses.filter((response) => response.blockId === block.id).length
        : 0,
    ...(opinionSummary ? { opinionSummary } : {}),
    participants: leaderboard,
    // REST v1 requires this roster alias to match participants, including unassessed decks.
    leaderboard,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    finishedAt: session.finishedAt?.toISOString() ?? null,
    liveExpiresAt: session.liveExpiresAt.toISOString(),
  };
}
