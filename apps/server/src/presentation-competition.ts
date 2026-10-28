import {
  type CompetitionStandings,
  questionDelivery,
  questionPurpose,
  questionTypeDefinition,
} from "@openround/contracts";
import {
  comparePresentationLeaderboardEntries,
  type PresentationSessionParticipantRecord,
  type PresentationSessionRecord,
  type PresentationSessionResponseRecord,
  type PresentationSessionTimelineRecord,
} from "@openround/db";

/** Staff-only competition view; this does not expand Presentation audience identity access. */
export function presentationCompetitionStandings(
  session: PresentationSessionRecord,
  participants: PresentationSessionParticipantRecord[],
  responses: PresentationSessionResponseRecord[],
  timeline: PresentationSessionTimelineRecord[],
): CompetitionStandings {
  const scoredBlocks = session.content.blocks.flatMap((block, index) =>
    block.kind === "question" &&
    questionTypeDefinition(block.question.type).scored &&
    questionPurpose(block.question) !== "opinion" &&
    questionDelivery(block.question) === "main" &&
    block.question.basePoints > 0
      ? [{ id: block.id, index }]
      : [],
  );
  const revealed = ["question_reveal", "intervention", "finished"].includes(session.phase);
  const completed = scoredBlocks.filter(
    (block) =>
      block.index < session.currentBlockIndex ||
      (block.index === session.currentBlockIndex && revealed),
  );
  const releasedIds = new Set(completed.map((block) => block.id));
  const previousIds = new Set(completed.slice(0, -1).map((block) => block.id));
  function rank(
    blockIds: ReadonlySet<string>,
    roster: PresentationSessionParticipantRecord[] = participants,
  ) {
    const totals = new Map<string, number>();
    for (const response of responses) {
      if (!blockIds.has(response.blockId)) continue;
      totals.set(
        response.participantId,
        (totals.get(response.participantId) ?? 0) + response.score,
      );
    }
    return roster
      .map((participant) => ({ ...participant, score: totals.get(participant.id) ?? 0 }))
      .sort(comparePresentationLeaderboardEntries);
  }
  const ranked = rank(releasedIds);
  const previousBlockId = completed.at(-2)?.id;
  // A skipped response still had a published zero-score rank. Use the roster captured with
  // that reveal rather than response history or request-time join timestamps. Missing legacy
  // history cannot establish membership, so it deliberately produces no previous ranks.
  const previousRosterIds = new Set(
    timeline.find(
      (event) =>
        event.type === "question.revealed" &&
        event.blockId === previousBlockId &&
        event.sequence <= session.eventSeq,
    )?.revealedParticipantIds ?? [],
  );
  const previous = rank(
    previousIds,
    participants.filter((participant) => previousRosterIds.has(participant.id)),
  );
  const previousRanks = new Map(previous.map((entry, index) => [entry.id, index + 1]));
  const responseByParticipantAndBlock = new Map(
    responses.map((response) => [`${response.participantId}:${response.blockId}`, response]),
  );
  const leaderScore = ranked[0]?.score ?? 0;
  return {
    status:
      scoredBlocks.length === 0
        ? "unscored"
        : completed.length === 0
          ? "waiting"
          : session.phase === "finished"
            ? "final"
            : "live",
    entries:
      completed.length === 0
        ? []
        : ranked.map((entry, index) => {
            let correctStreak = 0;
            for (const block of [...completed].reverse()) {
              if (!responseByParticipantAndBlock.get(`${entry.id}:${block.id}`)?.correct) break;
              correctStreak += 1;
            }
            const lastBlockId = completed.at(-1)?.id;
            const lastScoreDelta = lastBlockId
              ? (responseByParticipantAndBlock.get(`${entry.id}:${lastBlockId}`)?.score ?? 0)
              : 0;
            return {
              id: entry.id,
              nickname: entry.nickname,
              score: entry.score,
              rank: index + 1,
              previousRank: previousRanks.get(entry.id) ?? null,
              tied:
                ranked[index - 1]?.score === entry.score ||
                ranked[index + 1]?.score === entry.score,
              pointsToLeader: leaderScore - entry.score,
              pointsToNextRank:
                index === 0 ? null : Math.max(0, ranked[index - 1]!.score - entry.score),
              lastScoreDelta,
              correctStreak,
            };
          }),
    totalParticipants: participants.length,
    scoringMode: session.settings.timeMode === "flex" ? "accuracy" : "speed",
    timeMode: session.settings.timeMode,
    completedScoredQuestions: completed.length,
    totalScoredQuestions: scoredBlocks.length,
    tieBreak: "score_join_order",
  };
}
