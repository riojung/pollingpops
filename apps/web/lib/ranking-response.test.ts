import { describe, expect, it } from "vitest";
import {
  initialRanking,
  moveRankedChoice,
  rankingCount,
  toggleRankedChoice,
} from "./ranking-response";

const question = { choices: ["a", "b", "c"].map((id) => ({ id, label: id })) };

describe("ranking response controls", () => {
  it("starts full rankings in authored order and top-N rankings empty", () => {
    expect(rankingCount(question)).toBe(3);
    expect(initialRanking(question)).toEqual(["a", "b", "c"]);
    expect(initialRanking({ ...question, rankCount: 3 })).toEqual(["a", "b", "c"]);
    expect(initialRanking({ ...question, rankCount: 2 })).toEqual([]);
  });

  it("moves priorities without sorting, mutating or losing any selection", () => {
    const selected = ["c", "a", "b"];
    expect(moveRankedChoice(selected, "a", -1)).toEqual(["a", "c", "b"]);
    expect(moveRankedChoice(selected, "a", 1)).toEqual(["c", "b", "a"]);
    expect(moveRankedChoice(selected, "c", -1)).toBe(selected);
    expect(moveRankedChoice(selected, "unknown", 1)).toBe(selected);
    expect(selected).toEqual(["c", "a", "b"]);
  });

  it("preserves remaining order on removal and caps top-N selection", () => {
    expect(toggleRankedChoice(["c", "a"], "b", 2)).toEqual(["c", "a"]);
    expect(toggleRankedChoice(["c", "a"], "c", 2)).toEqual(["a"]);
    expect(toggleRankedChoice(["c"], "a", 2)).toEqual(["c", "a"]);
  });
});
