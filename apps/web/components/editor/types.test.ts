import { describe, expect, it } from "vitest";
import { isChoiceQuestion, removeQuestionChoice, type ChoiceQuestionDraft } from "./types";

const ranking: ChoiceQuestionDraft = {
  id: "question",
  type: "ranking",
  prompt: "Choose priorities",
  purpose: "opinion",
  confidence: "off",
  delivery: "main",
  basePoints: 0,
  timeLimitSeconds: 30,
  explanation: "",
  mediaId: null,
  mediaAlt: null,
  choices: ["a", "b", "c"].map((id) => ({ id, label: id, isCorrect: false })),
};

describe("editor response type boundaries", () => {
  it("recognizes rankings as option-bearing questions without treating numbers and scales as choices", () => {
    expect(isChoiceQuestion(ranking)).toBe(true);
    expect(
      isChoiceQuestion({
        ...ranking,
        type: "numeric",
        correctValue: "1",
        tolerance: "0",
        unit: null,
        rankCount: undefined,
      }),
    ).toBe(false);
    expect(
      isChoiceQuestion({
        ...ranking,
        type: "rating",
        min: 1,
        max: 5,
        minLabel: "Low",
        maxLabel: "High",
        rankCount: undefined,
      }),
    ).toBe(false);
  });

  it("clamps explicit rank counts on removal while keeping implicit full-list behavior", () => {
    expect(removeQuestionChoice({ ...ranking, rankCount: 3 }, "b")).toMatchObject({
      rankCount: 2,
      choices: [{ id: "a" }, { id: "c" }],
    });
    expect(removeQuestionChoice(ranking, "b")).not.toHaveProperty("rankCount");
    expect(removeQuestionChoice({ ...ranking, rankCount: 1 }, "b")).toHaveProperty("rankCount", 1);
  });
});
