import type { IdeaBoardView } from "@openround/contracts";

type BoardAnalyticsIdea = {
  id: string;
  body: string | null;
  position: number;
  voteCount: number;
  share: number | null;
};

type AvailableBoardAnalyticsRound = {
  roundNumber: number;
  status: "available";
  closedAt: string | null;
  ballotCount: number | null;
  totalVotes: number;
  ideasWithVotes: number;
  ideas: BoardAnalyticsIdea[];
};

export type BoardAnalyticsRound =
  | { roundNumber: number; status: "open" }
  | { roundNumber: number; status: "withheld" }
  | AvailableBoardAnalyticsRound;

type ReleasedIdeaResult = Pick<BoardAnalyticsIdea, "id" | "body" | "voteCount">;

function availableRound(
  roundNumber: number,
  results: ReleasedIdeaResult[],
  closedAt: string | null = null,
  ballotCount: number | null = null,
): AvailableBoardAnalyticsRound {
  const totalVotes = results.reduce((total, idea) => total + idea.voteCount, 0);
  const ideas = results
    .map((idea, index) => ({
      ...idea,
      position: index + 1,
      share: totalVotes === 0 ? null : (idea.voteCount / totalVotes) * 100,
    }))
    .sort((left, right) => right.voteCount - left.voteCount || left.position - right.position);

  return {
    roundNumber,
    status: "available",
    closedAt,
    ballotCount,
    totalVotes,
    ideasWithVotes: ideas.filter((idea) => idea.voteCount > 0).length,
    ideas,
  };
}

function currentRound(board: IdeaBoardView): BoardAnalyticsRound {
  const roundNumber = board.roundNumber ?? 1;
  if (board.status !== "closed") return { roundNumber, status: "open" };
  if (board.countsVisible !== true) return { roundNumber, status: "withheld" };

  const results: ReleasedIdeaResult[] = [];
  for (const idea of board.ideas) {
    if (idea.status !== "approved") continue;
    const { id, body, voteCount } = idea;
    if (typeof voteCount !== "number" || !Number.isSafeInteger(voteCount) || voteCount < 0) {
      return { roundNumber, status: "withheld" };
    }
    results.push({ id, body, voteCount });
  }
  return availableRound(roundNumber, results);
}

export function boardAnalyticsRounds(board: IdeaBoardView): BoardAnalyticsRound[] {
  const historyBodies = new Map(
    (board.roundHistoryIdeas ?? []).map(({ ideaId, body }) => [ideaId, body]),
  );
  const history = (board.roundHistory ?? []).map((round) =>
    availableRound(
      round.roundNumber,
      round.results.map(({ ideaId, voteCount }) => ({
        id: ideaId,
        body: historyBodies.get(ideaId) ?? null,
        voteCount,
      })),
      round.closedAt,
      round.ballotCount,
    ),
  );
  return [currentRound(board), ...history].sort(
    (left, right) => right.roundNumber - left.roundNumber,
  );
}
