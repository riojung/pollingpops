import {
  PresentationCompanionSnapshotSchema,
  PresentationHostSnapshotSchema,
  PresentationParticipantSnapshotSchema,
  type PresentationBlock,
  type PresentationCompanionSnapshot,
  type PresentationHostSnapshot,
  type PresentationParticipantSnapshot,
  type QuestionDraft,
  questionPurpose,
  requiresExtendedRoundResponses,
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

import { presentationCompetitionStandings } from "./presentation-competition.js";

const PRESENTATION_PARTICIPANT_PRESENCE_WINDOW_MS = 15_000;

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
export function presentationParticipantBlock(block: PresentationBlock | null) {
  if (!block) return null;
  if (block.kind === "content") {
    return {
      id: block.id,
      kind: block.kind,
      layout: block.layout,
      textElements: block.textElements.map((element) => ({ ...element })),
      mediaId: block.mediaId,
      mediaAlt: block.mediaAlt,
    };
  }
  const question = block.question;
  if (requiresExtendedRoundResponses({ questions: [question] })) {
    throw new Error("This response format currently supports Live Rounds only");
  }
  const base = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    confidence: question.confidence,
    timeLimitSeconds: question.timeLimitSeconds,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
  };
  if (question.type === "numeric") return { id: block.id, kind: block.kind, question: base };
  if (question.type === "rating") {
    return {
      id: block.id,
      kind: block.kind,
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
    id: block.id,
    kind: block.kind,
    question: {
      ...base,
      choices: question.choices.map(({ id, label }) => ({ id, label })),
    },
  };
}

function presentationLiveQuestion(question: QuestionDraft, facilitator: boolean) {
  if (requiresExtendedRoundResponses({ questions: [question] })) {
    throw new Error("This response format currently supports Live Rounds only");
  }
  const projected = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    confidence: question.confidence ?? "off",
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
    basePoints: question.basePoints,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
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
  if (requiresExtendedRoundResponses({ questions: [question] })) {
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
  if (question.type === "rating" || question.type === "poll") {
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
) {
  if (!block) return null;
  if (block.kind === "content") {
    return {
      id: block.id,
      kind: block.kind,
      layout: block.layout,
      textElements: block.textElements.map((element) => ({ ...element })),
      mediaId: block.mediaId,
      mediaAlt: block.mediaAlt,
    };
  }
  return {
    id: block.id,
    kind: block.kind,
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
    leaderboard: rankedParticipants(participants, responses),
    facilitatorLeaderboard: rankedParticipants(
      participants,
      facilitatorVisibleResponses(session, responses),
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
    currentBlock: presentationRealtimeBlock(
      block,
      true,
      session.phase === "question_reveal" ||
        session.phase === "intervention" ||
        session.phase === "finished",
    ),
    participantCount: participants.length,
    competitionStandings: presentationCompetitionStandings(
      session,
      participants,
      data.responses,
      data.timeline,
    ),
    responseCount,
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
    participantId,
    currentBlock: presentationRealtimeBlock(block, false),
    participantCount: data.participants.length,
    responseSubmitted: Boolean(currentResponse),
    responseReceipt: latestResponse?.idempotencyKey
      ? {
          responseId: latestResponse.id,
          blockId: latestResponse.blockId,
          idempotencyKey: latestResponse.idempotencyKey,
          acceptedAt: latestResponse.submittedAt.toISOString(),
        }
      : null,
    standing:
      session.phase !== "question_open" && standing
        ? { rank: standing.rank, score: standing.score }
        : null,
    responseResult:
      resultVisible && currentResponse
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
  const block = presentationCurrentBlock(session);
  const currentResponse =
    block?.id === acknowledgedResponse.blockId ? acknowledgedResponse : projection.currentResponse;
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
    participantId,
    currentBlock: presentationRealtimeBlock(block, false),
    participantCount: projection.participantCount,
    responseSubmitted: Boolean(currentResponse),
    standing: session.phase === "question_open" ? null : projection.standing,
    responseResult:
      resultVisible && currentResponse
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
    currentBlock: presentationRealtimeBlock(block, false),
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
      resultVisible && block?.kind === "question"
        ? { blockId: block.id, responseCount: currentResponses.length, choiceCounts }
        : null,
    primaryAction: session.status === "active" ? "advance" : "none",
    finishedAt: host.finishedAt,
  });
}

export function buildPresentationListSnapshot(
  session: PresentationSessionRecord,
  participants: PresentationSessionParticipantRecord[],
  responses: PresentationSessionResponseRecord[],
) {
  const block = presentationCurrentBlock(session);
  const leaderboard = rankedParticipants(
    participants,
    facilitatorVisibleResponses(session, responses),
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
    ),
    questionOpenedAt: session.questionOpenedAt?.toISOString() ?? null,
    questionClosesAt: presentationQuestionDeadline(session)?.toISOString() ?? null,
    acceptingResponses: presentationAcceptingResponses(session),
    participantCount: participants.length,
    responseCount:
      block?.kind === "question"
        ? responses.filter((response) => response.blockId === block.id).length
        : 0,
    participants: leaderboard,
    leaderboard,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    finishedAt: session.finishedAt?.toISOString() ?? null,
    liveExpiresAt: session.liveExpiresAt.toISOString(),
  };
}
