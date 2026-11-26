import { IdeaBoardViewSchema, type IdeaBoardIdea } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { boardFixture } from "../../test-utils/idea-board";
import { boardAnalyticsRounds } from "./board-analytics-model";

function idea(index: number, attributes: Partial<IdeaBoardIdea> = {}): IdeaBoardIdea {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    body: "An approved idea",
    alias: null,
    groupId: null,
    status: "approved",
    createdAt: boardFixture.createdAt,
    voteCount: null,
    ...attributes,
  };
}

describe("board analytics rounds", () => {
  it.each(["draft", "collecting", "voting"] as const)(
    "does not expose current results while %s",
    (status) => {
      const board = {
        ...boardFixture,
        status,
        countsVisible: true,
        ideas: [idea(10, { voteCount: 5 })],
      };
      expect(boardAnalyticsRounds(board)).toEqual([{ roundNumber: 1, status: "open" }]);
    },
  );

  it("withholds current results when the board's count gate is closed", () => {
    expect(
      boardAnalyticsRounds({
        ...boardFixture,
        status: "closed",
        ideas: [idea(10, { voteCount: 5 })],
      }),
    ).toEqual([{ roundNumber: 1, status: "withheld" }]);
  });

  it.each([null, undefined, -1, 1.2, NaN, Infinity])(
    "withholds the whole current round when an approved count is %s",
    (voteCount) => {
      expect(
        boardAnalyticsRounds({
          ...boardFixture,
          status: "closed",
          countsVisible: true,
          ideas: [idea(10, { voteCount: 5 }), idea(11, { voteCount })],
        }),
      ).toEqual([{ roundNumber: 1, status: "withheld" }]);
    },
  );

  it("ranks approved results by votes and calculates each share from the votes cast", () => {
    const first = idea(10, { body: "First idea", alias: "Private alias", voteCount: 2 });
    const pending = idea(11, { status: "pending", voteCount: 99 });
    const tiedFirst = idea(12, { body: "Earlier tie", voteCount: 4 });
    const tiedSecond = idea(13, { body: "Later tie", voteCount: 4 });
    const removed = idea(14, { status: "removed", voteCount: 99 });
    const noVotes = idea(15, { body: "No votes", voteCount: 0 });
    const board = {
      ...boardFixture,
      status: "closed" as const,
      countsVisible: true,
      participantCount: 4,
      ideas: [first, pending, tiedFirst, tiedSecond, removed, noVotes],
    };
    expect(boardAnalyticsRounds(board)).toEqual([
      {
        roundNumber: 1,
        status: "available",
        closedAt: null,
        ballotCount: null,
        totalVotes: 10,
        ideasWithVotes: 3,
        ideas: [
          { id: tiedFirst.id, body: tiedFirst.body, position: 2, voteCount: 4, share: 40 },
          { id: tiedSecond.id, body: tiedSecond.body, position: 3, voteCount: 4, share: 40 },
          { id: first.id, body: first.body, position: 1, voteCount: 2, share: 20 },
          { id: noVotes.id, body: noVotes.body, position: 4, voteCount: 0, share: 0 },
        ],
      },
    ]);
  });

  it("keeps released rounds visible during voting and uses only the released history labels", () => {
    const removed = idea(10, { status: "removed", body: "Hidden removed idea" });
    const missing = idea(11, { status: "pending", body: "Hidden pending idea" });
    const approved = idea(12, { body: "Current wording", voteCount: 99 });
    const closedAt = "2026-10-17T12:00:00.000Z";
    expect(
      boardAnalyticsRounds({
        ...boardFixture,
        status: "voting",
        roundNumber: 3,
        ideas: [removed, missing, approved],
        roundHistory: [
          {
            roundNumber: 2,
            closedAt,
            ballotCount: 3,
            results: [
              { ideaId: removed.id, voteCount: 2 },
              { ideaId: approved.id, voteCount: 2 },
              { ideaId: missing.id, voteCount: 1 },
            ],
          },
          { roundNumber: 1, closedAt: null, ballotCount: 0, results: [] },
        ],
        roundHistoryIdeas: [
          { ideaId: removed.id, body: null },
          { ideaId: approved.id, body: "Released wording" },
        ],
      }),
    ).toEqual([
      { roundNumber: 3, status: "open" },
      {
        roundNumber: 2,
        status: "available",
        closedAt,
        ballotCount: 3,
        totalVotes: 5,
        ideasWithVotes: 3,
        ideas: [
          { id: removed.id, body: null, position: 1, voteCount: 2, share: 40 },
          { id: approved.id, body: "Released wording", position: 2, voteCount: 2, share: 40 },
          { id: missing.id, body: null, position: 3, voteCount: 1, share: 20 },
        ],
      },
      {
        roundNumber: 1,
        status: "available",
        closedAt: null,
        ballotCount: 0,
        totalVotes: 0,
        ideasWithVotes: 0,
        ideas: [],
      },
    ]);
  });

  it("reports measured zero and the default first round for a closed legacy board", () => {
    const noVotes = idea(10, { voteCount: 0 });
    const board = IdeaBoardViewSchema.parse({
      ...boardFixture,
      status: "closed",
      countsVisible: true,
      roundNumber: undefined,
      roundHistory: undefined,
      roundHistoryIdeas: undefined,
      ideas: [noVotes],
    });
    expect(boardAnalyticsRounds(board)).toEqual([
      {
        roundNumber: 1,
        status: "available",
        closedAt: null,
        ballotCount: null,
        totalVotes: 0,
        ideasWithVotes: 0,
        ideas: [{ id: noVotes.id, body: noVotes.body, position: 1, voteCount: 0, share: null }],
      },
    ]);
  });
});
