import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CompetitionStandingsSchema } from "../src/index.js";

const base = {
  status: "live",
  totalParticipants: 1,
  scoringMode: "accuracy",
  timeMode: "flex",
  completedScoredQuestions: 1,
  totalScoredQuestions: 2,
  tieBreak: "score_correct",
  entries: [
    {
      id: randomUUID(),
      nickname: "River",
      rank: 1,
      previousRank: null,
      score: 1_000,
      tied: false,
      pointsToLeader: 0,
      pointsToNextRank: null,
    },
  ],
};

describe("competition standings wire contract", () => {
  it("accepts optional released recognition without requiring it from older rooms", () => {
    expect(CompetitionStandingsSchema.parse(base).entries[0]).not.toHaveProperty("correctStreak");
    const recognized = {
      ...base,
      entries: [{ ...base.entries[0], lastScoreDelta: 1_000, correctStreak: 2 }],
    };
    expect(CompetitionStandingsSchema.parse(recognized).entries[0]).toMatchObject({
      lastScoreDelta: 1_000,
      correctStreak: 2,
    });
    for (const fields of [{ lastScoreDelta: -1 }, { correctStreak: -1 }, { correctStreak: 1.5 }]) {
      expect(
        CompetitionStandingsSchema.safeParse({
          ...base,
          entries: [{ ...base.entries[0], ...fields }],
        }).success,
      ).toBe(false);
    }
  });
  it("accepts released standings and rejects impossible progress and duplicate participants", () => {
    expect(CompetitionStandingsSchema.safeParse(base).success).toBe(true);
    expect(
      CompetitionStandingsSchema.safeParse({ ...base, completedScoredQuestions: 3 }).success,
    ).toBe(false);
    expect(
      CompetitionStandingsSchema.safeParse({
        ...base,
        totalParticipants: 2,
        entries: [...base.entries, ...base.entries],
      }).success,
    ).toBe(false);
  });

  it("does not permit fabricated ranked entries for waiting or unscored polls", () => {
    for (const status of ["waiting", "unscored"]) {
      expect(CompetitionStandingsSchema.safeParse({ ...base, status }).success).toBe(false);
      expect(CompetitionStandingsSchema.safeParse({ ...base, status, entries: [] }).success).toBe(
        true,
      );
    }
  });
});
