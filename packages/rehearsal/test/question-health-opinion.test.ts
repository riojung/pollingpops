import { QuestionDraftSchema, type QuestionDraft, type QuizDraft } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { evaluateQuestionHealth } from "../src/index.js";

function id(value: number) {
  return `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

const labels = [
  "Wetlands",
  "Forest habitat",
  "Coastal restoration with sustained monitoring of water quality over the next twelve months",
];

function choiceQuestion(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return QuestionDraftSchema.parse({
    id: id(1),
    type: "ranking",
    prompt: "Which habitat restoration projects should receive priority?",
    choices: labels.map((label, index) => ({
      id: id(index + 100),
      label,
      isCorrect: false,
    })),
    confidence: "off",
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
    ...overrides,
  });
}

function evaluate(questions: QuestionDraft[]) {
  const draft: QuizDraft = { title: "Choice quality", description: "", questions };
  return evaluateQuestionHealth(draft);
}

const rankingCases = [
  { mode: "default full ranking", rankCount: undefined, purpose: undefined },
  { mode: "explicit full ranking", rankCount: 3, purpose: "opinion" },
  { mode: "top-N ranking", rankCount: 2, purpose: "opinion" },
] as const;

describe("Question Health opinion choices", () => {
  it.each(rankingCases)("does not invent answer warnings for $mode", async (configuration) => {
    const question = choiceQuestion({
      rankCount: configuration.rankCount,
      purpose: configuration.purpose,
    });

    const result = await evaluate([question]);

    expect(result.findings).toEqual([]);
  });

  it.each(rankingCases)("retains duplicate and overlap advice for $mode", async (configuration) => {
    const question = choiceQuestion({
      rankCount: configuration.rankCount,
      purpose: configuration.purpose,
      choices: [
        { id: id(101), label: "Restore native plants", isCorrect: false },
        { id: id(102), label: "restore native plants!", isCorrect: false },
        { id: id(103), label: "Restore native plants near wetlands", isCorrect: false },
      ],
    });

    const result = await evaluate([question]);

    expect(result.findings.map((finding) => finding.ruleId).sort()).toEqual([
      "choice.duplicate",
      "choice.overlap",
      "choice.overlap",
    ]);
  });

  it.each([
    { mode: "single-selection poll", type: "poll", maxSelections: undefined },
    { mode: "multiple-selection poll", type: "poll", maxSelections: 2 },
    { mode: "opinion single-select", type: "single_select", maxSelections: undefined },
    { mode: "opinion multi-select", type: "multi_select", maxSelections: undefined },
  ] as const)("skips scoring advice for $mode", async (configuration) => {
    const question = choiceQuestion({
      type: configuration.type,
      maxSelections: configuration.maxSelections,
      purpose: "opinion",
      choices: labels.map((label, index) => ({
        id: id(index + 100),
        label,
        isCorrect: configuration.type !== "poll" && index === 0,
      })),
    });

    const result = await evaluate([question]);

    expect(result.findings).toEqual([]);
  });

  it.each([
    { type: "single_select", purpose: "diagnostic" },
    { type: "multi_select", purpose: "practice" },
  ] as const)("retains scoring advice for $purpose $type", async (configuration) => {
    const question = choiceQuestion({
      ...configuration,
      basePoints: 1_000,
      choices: labels.map((label, index) => ({
        id: id(index + 100),
        label,
        isCorrect: index === 0,
      })),
    });

    const result = await evaluate([question]);

    expect(result.findings.map((finding) => finding.ruleId).sort()).toEqual([
      "choice.length_cue",
      "choice.missing_rationale",
      "choice.missing_rationale",
      "question.missing_citation",
      "question.missing_explanation",
    ]);
  });
});
