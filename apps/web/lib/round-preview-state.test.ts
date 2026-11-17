import { describe, expect, it } from "vitest";
import type { QuestionDraft } from "@openround/contracts";
import { liveQuestionConfidence, supportedLocales } from "@openround/contracts";
import { roundPreviewCopy } from "./i18n/round-preview-copy";
import {
  canCheckPreviewAnswer,
  initialPreviewResponse,
  togglePreviewChoice,
} from "./round-preview-state";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  prompt: "Try this question",
  timeLimitSeconds: 30,
  basePoints: 1000,
  explanation: "An authored explanation.",
  mediaId: null,
  mediaAlt: null,
};
const choices = [
  { id: "22222222-2222-4222-8222-222222222222", label: "First", isCorrect: true },
  { id: "33333333-3333-4333-8333-333333333333", label: "Second", isCorrect: false },
  { id: "44444444-4444-4444-8444-444444444444", label: "Third", isCorrect: false },
];
const choiceQuestion: QuestionDraft = { ...base, type: "single_select", choices };

describe("local Round rehearsal answers", () => {
  it("switches single choices and bounds multi-answer polls without mutating the draft", () => {
    const source = structuredClone(choiceQuestion);
    expect(togglePreviewChoice(choiceQuestion, [choices[0]!.id], choices[1]!.id)).toEqual([
      choices[1]!.id,
    ]);
    expect(togglePreviewChoice(choiceQuestion, [], "unknown")).toEqual([]);
    const multi: QuestionDraft = { ...choiceQuestion, type: "multi_select" };
    expect(togglePreviewChoice(multi, [choices[0]!.id], choices[1]!.id)).toEqual([
      choices[0]!.id,
      choices[1]!.id,
    ]);
    expect(togglePreviewChoice(multi, [choices[0]!.id], choices[0]!.id)).toEqual([]);
    const poll: QuestionDraft = { ...choiceQuestion, type: "poll", maxSelections: 2 };
    expect(togglePreviewChoice(poll, [choices[0]!.id, choices[1]!.id], choices[2]!.id)).toEqual([
      choices[0]!.id,
      choices[1]!.id,
    ]);
    const singlePoll: QuestionDraft = { ...poll, maxSelections: 1 };
    expect(togglePreviewChoice(singlePoll, [choices[0]!.id], choices[1]!.id)).toEqual([
      choices[1]!.id,
    ]);
    expect(choiceQuestion).toEqual(source);
  });

  it("supports all nine types and only enables complete, valid test answers", () => {
    const cases: QuestionDraft[] = [
      choiceQuestion,
      { ...choiceQuestion, type: "true_false" },
      { ...choiceQuestion, type: "multi_select" },
      { ...choiceQuestion, type: "poll" },
      { ...base, type: "numeric", correctValue: "12", tolerance: "0", unit: null },
      { ...base, type: "rating", min: 1, max: 5, minLabel: "Low", maxLabel: "High" },
      { ...base, type: "ranking", choices, rankCount: 2 },
      { ...base, type: "open_text" },
      { ...base, type: "word_cloud" },
    ];
    expect(new Set(cases.map(({ type }) => type)).size).toBe(9);
    for (const question of cases) {
      const empty = initialPreviewResponse(question);
      expect(canCheckPreviewAnswer(question, empty), question.type).toBe(false);
      const answered = {
        ...empty,
        choices: choices.slice(0, question.type === "ranking" ? 2 : 1).map(({ id }) => id),
        text: "12",
        rating: 3,
      };
      expect(canCheckPreviewAnswer(question, answered), question.type).toBe(true);
      expect(canCheckPreviewAnswer(question, { ...answered, submitted: true }), question.type).toBe(
        false,
      );
      expect(initialPreviewResponse(question)).toEqual(empty);
    }
    const numeric = cases[4]!;
    for (const text of [" ", "NaN", "Infinity", "1e3", "0xFF", "12,5"])
      expect(canCheckPreviewAnswer(numeric, { ...initialPreviewResponse(numeric), text })).toBe(
        false,
      );
    const textQuestion = cases[7]!;
    expect(
      canCheckPreviewAnswer(textQuestion, {
        ...initialPreviewResponse(textQuestion),
        text: " ".repeat(4),
      }),
    ).toBe(false);
    expect(
      canCheckPreviewAnswer(textQuestion, {
        ...initialPreviewResponse(textQuestion),
        text: "a".repeat(1001),
      }),
    ).toBe(false);
  });

  it("starts a full ranking in authored order and clears submitted/confidence state on reset", () => {
    const ranking: QuestionDraft = { ...base, type: "ranking", choices };
    expect(initialPreviewResponse(ranking).choices).toEqual(choices.map(({ id }) => id));
    expect(canCheckPreviewAnswer(ranking, initialPreviewResponse(ranking))).toBe(true);
    expect(initialPreviewResponse(choiceQuestion)).toMatchObject({
      choices: [],
      confidence: null,
      submitted: false,
    });
  });

  it("does not require confidence for a live Round, including legacy authored required settings", () => {
    for (const confidence of ["required", "optional", "off"] as const) {
      const diagnostic: QuestionDraft = { ...choiceQuestion, purpose: "diagnostic", confidence };
      const response = { ...initialPreviewResponse(diagnostic), choices: [choices[0]!.id] };
      expect(response.confidence).toBeNull();
      expect(liveQuestionConfidence(diagnostic, {})).toBe(
        confidence === "off" ? "off" : "optional",
      );
      expect(canCheckPreviewAnswer(diagnostic, response)).toBe(true);
      const opinion: QuestionDraft = { ...diagnostic, purpose: "opinion", basePoints: 0 };
      expect(liveQuestionConfidence(opinion, {})).toBe("off");
      expect(canCheckPreviewAnswer(opinion, response)).toBe(true);
    }
  });

  it("provides the complete rehearsal interface in every supported locale", () => {
    for (const locale of supportedLocales) {
      expect(Object.keys(roundPreviewCopy[locale]).sort()).toEqual(
        Object.keys(roundPreviewCopy["en-CA"]).sort(),
      );
      for (const value of Object.values(roundPreviewCopy[locale]))
        expect(value.trim().length).toBeGreaterThan(0);
      expect(roundPreviewCopy[locale].points).toContain("{points}");
    }
  });
});
