import {
  presentationSceneTitle,
  PresentationReportSchema,
  PresentationReportV1Schema,
  PresentationReportV2Schema,
  isPresentationOpinionResultQuestion,
  requiresPresentationOpinionFormats,
  questionTypeDefinition,
  type PresentationReport,
} from "@openround/contracts";
import {
  comparePresentationLeaderboardEntries,
  type PresentationSessionParticipantRecord,
  type PresentationSessionRecord,
  type PresentationSessionResponseRecord,
  type PresentationSessionTimelineRecord,
} from "@openround/db";
import {
  presentationHasQuestions,
  presentationHasScoredQuestions,
  presentationScoredResponses,
} from "./presentation-competition.js";
import { presentationOpinionSummary } from "./presentation-opinion-results.js";
import { PresentationSessionServiceError } from "./presentation-session-errors.js";
import { presentationResponsesForContent } from "./presentation-response-identifiers.js";

const PRESENTATION_EVIDENCE_NOTE =
  "Content slides are recorded in the facilitation timeline but are not evidence of learning.";
const PRESENTATION_CONTENT_EVIDENCE_NOTE =
  "This report records participant join counts and the sequence of slides presented.";

function reportLeaderboard(
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
    .map(({ joinedAt: _joinedAt, ...participant }, index) => ({
      ...participant,
      rank: index + 1,
    }));
}

export function generatePresentationReport(input: {
  session: PresentationSessionRecord;
  participants: PresentationSessionParticipantRecord[];
  responses: PresentationSessionResponseRecord[];
  timeline: PresentationSessionTimelineRecord[];
}): PresentationReport {
  const { session, participants, timeline } = input;
  const responses = presentationResponsesForContent(session.content, input.responses);
  if (session.status !== "finished") {
    throw new Error("A Presentation report can only be generated for a finished session");
  }
  // Pre-foundation and directly imported rows could mark a session finished without populating
  // finished_at. updatedAt was the legacy transition timestamp and is the lossless fallback also
  // used by the report-queue migration.
  const finishedAt = session.finishedAt ?? session.updatedAt;
  const includesOpinionResults = requiresPresentationOpinionFormats(session.content);

  const responsesByBlock = new Map<string, PresentationSessionResponseRecord[]>();
  for (const response of responses) {
    const group = responsesByBlock.get(response.blockId) ?? [];
    group.push(response);
    responsesByBlock.set(response.blockId, group);
  }
  const evidence = session.content.blocks.map((block, blockIndex) => {
    if (block.kind === "content") {
      return {
        blockId: block.id,
        blockIndex,
        kind: "content" as const,
        title: block.scene
          ? presentationSceneTitle(block.scene)
          : (block.textElements.find((element) => element.role === "title")?.text ?? ""),
        assessmentStatus: "not_assessed" as const,
      };
    }
    const blockResponses = responsesByBlock.get(block.id) ?? [];
    const quickCheck = session.content.liveQuickCheck?.blockId === block.id;
    const assessed =
      quickCheck || isPresentationOpinionResultQuestion(block.question)
        ? []
        : blockResponses.filter((response) => response.correct !== null);
    const correct = assessed.filter((response) => response.correct).length;
    const opinionSummary = includesOpinionResults
      ? presentationOpinionSummary(block, blockResponses)
      : undefined;
    return {
      blockId: block.id,
      blockIndex,
      kind: "question" as const,
      ...(quickCheck ? { sessionOnly: "quick_check" as const } : {}),
      ...(opinionSummary ? { opinionSummary } : {}),
      questionId: block.question.id,
      prompt: block.question.prompt,
      questionType: block.question.type,
      questionTypeLabel: questionTypeDefinition(block.question.type).label,
      delivery: block.question.delivery ?? "main",
      respondents: blockResponses.length,
      correct: assessed.length ? correct : null,
      accuracyPercent: assessed.length ? Math.round((correct / assessed.length) * 100) : null,
      totalScore:
        quickCheck || isPresentationOpinionResultQuestion(block.question)
          ? 0
          : blockResponses.reduce((total, response) => total + response.score, 0),
      averageResponseMs: blockResponses.length
        ? Math.round(
            blockResponses.reduce((total, response) => total + response.responseMs, 0) /
              blockResponses.length,
          )
        : null,
    };
  });

  const responseByParticipantQuestion = new Map(
    responses.map((response) => [`${response.participantId}:${response.questionId}`, response]),
  );
  const recovery = session.content.blocks.flatMap((block) => {
    if (
      block.kind !== "question" ||
      isPresentationOpinionResultQuestion(block.question) ||
      !block.question.linkedRecheckQuestionId
    )
      return [];
    const recheckBlock = session.content.blocks.find(
      (candidate) =>
        candidate.kind === "question" &&
        candidate.question.id === block.question.linkedRecheckQuestionId,
    );
    if (
      recheckBlock?.kind === "question" &&
      isPresentationOpinionResultQuestion(recheckBlock.question)
    )
      return [];
    let eligible = 0;
    let recovered = 0;
    for (const participant of participants) {
      const initial = responseByParticipantQuestion.get(`${participant.id}:${block.question.id}`);
      const recheck = responseByParticipantQuestion.get(
        `${participant.id}:${block.question.linkedRecheckQuestionId}`,
      );
      if (initial?.correct === false && recheck) {
        eligible += 1;
        if (recheck.correct === true) recovered += 1;
      }
    }
    return [
      {
        sourceQuestionId: block.question.id,
        recheckQuestionId: block.question.linkedRecheckQuestionId,
        eligible,
        recovered,
        recoveryPercent: eligible ? Math.round((recovered / eligible) * 100) : null,
      },
    ];
  });

  const includesPackEvidence = timeline.some((event) => event.recoveryPackIntervention);
  return PresentationReportSchema.parse({
    schemaVersion: includesOpinionResults
      ? 4
      : session.content.liveQuickCheck
        ? 3
        : includesPackEvidence
          ? 2
          : 1,
    sessionId: session.id,
    artifactType: "presentation",
    presentationId: session.presentationId,
    presentationVersionId: session.presentationVersionId,
    title: session.title,
    status: "finished",
    trustMode: session.trustMode,
    participantCount: participants.length,
    responseCount: responses.length,
    leaderboard: (
      includesOpinionResults
        ? presentationHasScoredQuestions(session)
        : presentationHasQuestions(session)
    )
      ? reportLeaderboard(
          participants,
          includesOpinionResults ? presentationScoredResponses(session, responses) : responses,
        )
      : [],
    evidence,
    recovery,
    timeline: timeline.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      blockIndex: event.blockIndex,
      blockId: event.blockId,
      occurredAt: event.occurredAt.toISOString(),
      ...(event.recoveryPackIntervention
        ? { recoveryPackIntervention: event.recoveryPackIntervention }
        : {}),
    })),
    evidenceNote: presentationHasQuestions(session)
      ? PRESENTATION_EVIDENCE_NOTE
      : PRESENTATION_CONTENT_EVIDENCE_NOTE,
    createdAt: session.createdAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  });
}

/** REST opt-ins preserve strict older readers without mutating the stored versioned evidence. */
export function presentationReportRestProjection(
  report: PresentationReport,
  includeQuickChecks: boolean,
  includeOpinionResults = false,
) {
  if (report.schemaVersion === 4 && !includeOpinionResults) {
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "This report includes opinion results. Use includeOpinionResults=true.",
    );
  }
  if (includeQuickChecks || report.schemaVersion !== 3) return report;
  const includesPackEvidence = report.timeline.some((event) => event.recoveryPackIntervention);
  const legacy = {
    ...report,
    schemaVersion: includesPackEvidence ? 2 : 1,
    evidence: report.evidence.map((entry) => {
      if (entry.kind !== "question") return entry;
      const evidence = { ...entry };
      delete evidence.sessionOnly;
      return evidence;
    }),
  };
  return includesPackEvidence
    ? PresentationReportV2Schema.parse(legacy)
    : PresentationReportV1Schema.parse(legacy);
}
