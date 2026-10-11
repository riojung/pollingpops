import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SurveyDraftSchema,
  SurveyContentSchema,
  surveyAggregate,
  validateSurveyResponses,
  SurveyResponseSchema,
  upgradeSurveyDraft,
} from "../src/surveys";

function draft() {
  return SurveyDraftSchema.parse({
    schemaVersion: 1,
    title: "Feedback",
    items: [
      {
        required: true,
        question: {
          id: randomUUID(),
          type: "rating",
          prompt: "How useful?",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          min: 1,
          max: 5,
          minLabel: "Not useful",
          maxLabel: "Very useful",
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  });
}
describe("Survey contracts", () => {
  it("requires opinion-only content and rejects future versions", () => {
    const content = draft();
    expect(SurveyContentSchema.safeParse(content).success).toBe(true);
    expect(upgradeSurveyDraft(content).schemaVersion).toBe(2);
    expect(SurveyDraftSchema.safeParse({ ...content, schemaVersion: 3 }).success).toBe(false);
    content.items[0]!.question.basePoints = 100;
    expect(SurveyDraftSchema.safeParse(content).success).toBe(false);
  });
  it("keeps legacy polls single-choice and validates v2 selection bounds without scoring", () => {
    const content = draft();
    const poll = {
      ...content.items[0]!.question,
      type: "poll" as const,
      choices: ["Examples", "Practice", "Discussion"].map((label) => ({
        id: randomUUID(),
        label,
        isCorrect: false,
      })),
    };
    // The shared question parser removes irrelevant fields when publishing this poll.
    content.items = [{ required: true, question: poll }];
    const ids = poll.choices.map((choice) => choice.id);
    expect(
      validateSurveyResponses(
        content,
        { [poll.id]: { kind: "poll", choiceIds: ids.slice(0, 2) } },
        true,
      ),
    ).toHaveLength(1);
    const multiple = { ...poll, maxSelections: 2 };
    expect(
      SurveyDraftSchema.safeParse({ ...content, items: [{ required: true, question: multiple }] })
        .success,
    ).toBe(false);
    const v2 = SurveyContentSchema.parse({
      ...content,
      schemaVersion: 2,
      items: [{ required: true, question: multiple }],
    });
    expect(v2.items[0]!.question.maxSelections).toBe(2);
    expect(
      validateSurveyResponses(
        v2,
        { [poll.id]: { kind: "poll", choiceIds: ids.slice(0, 2) } },
        true,
      ),
    ).toEqual([]);
    expect(
      validateSurveyResponses(v2, { [poll.id]: { kind: "poll", choiceIds: ids } }, true),
    ).toHaveLength(1);
    expect(
      validateSurveyResponses(v2, { [poll.id]: { kind: "poll", choiceIds: [randomUUID()] } }, true),
    ).toHaveLength(1);
    for (const limit of [0, 4, 1.5]) {
      expect(
        SurveyDraftSchema.safeParse({
          ...v2,
          items: [{ required: true, question: { ...multiple, maxSelections: limit } }],
        }).success,
      ).toBe(false);
    }
    expect(
      SurveyDraftSchema.safeParse({
        ...draft(),
        schemaVersion: 2,
        items: [{ required: true, question: { ...draft().items[0]!.question, maxSelections: 2 } }],
      }).success,
    ).toBe(false);
  });
  it("normalizes poll sets, rejects duplicates, and counts each selected option per respondent", () => {
    const content = draft();
    const question = {
      ...content.items[0]!.question,
      type: "poll" as const,
      maxSelections: 2,
      choices: ["A", "B"].map((label) => ({ id: randomUUID(), label, isCorrect: false })),
    };
    const ids = question.choices.map((choice) => choice.id);
    expect(SurveyResponseSchema.parse({ kind: "poll", choiceIds: [...ids].reverse() })).toEqual({
      kind: "poll",
      choiceIds: [...ids].sort(),
    });
    for (const choiceIds of [[], [ids[0], ids[0]], Array(7).fill(ids[0])]) {
      expect(SurveyResponseSchema.safeParse({ kind: "poll", choiceIds }).success).toBe(false);
    }
    const v2 = SurveyContentSchema.parse({
      ...content,
      schemaVersion: 2,
      items: [{ required: true, question }],
    });
    const row = { [question.id]: { kind: "poll" as const, choiceIds: ids } };
    const results = surveyAggregate(v2, Array(5).fill(row), true);
    expect(results.schemaVersion).toBe(2);
    expect(results.questions[0]).toMatchObject({
      answeredCount: 5,
      maxSelections: 2,
      percentBasis: "respondents",
      distribution: [
        { label: "A", count: 5 },
        { label: "B", count: 5 },
      ],
    });
    expect(surveyAggregate(v2, Array(5).fill(row)).questions[0]!.distribution).toEqual([]);
    expect(surveyAggregate(v2, Array(4).fill(row), true).questions[0]!.distribution).toEqual([]);
  });
  it("enforces each limit for every subset of two through six poll options", () => {
    for (let optionCount = 2; optionCount <= 6; optionCount++) {
      const content = draft();
      const question = {
        ...content.items[0]!.question,
        type: "poll" as const,
        choices: Array.from({ length: optionCount }, (_, index) => ({
          id: randomUUID(),
          label: `Option ${index + 1}`,
          isCorrect: false,
        })),
      };
      for (let maxSelections = 1; maxSelections <= optionCount; maxSelections++) {
        const v2 = SurveyContentSchema.parse({
          ...content,
          schemaVersion: 2,
          items: [{ required: true, question: { ...question, maxSelections } }],
        });
        for (let subset = 1; subset < 2 ** optionCount; subset++) {
          const choiceIds = question.choices
            .filter((_, index) => subset & (1 << index))
            .map((choice) => choice.id);
          expect(
            validateSurveyResponses(v2, { [question.id]: { kind: "poll", choiceIds } }, true)
              .length === 0,
          ).toBe(choiceIds.length <= maxSelections);
          const normalized = SurveyResponseSchema.parse({
            kind: "poll",
            choiceIds: [...choiceIds].reverse(),
          });
          if (normalized.kind !== "poll") throw new Error("Expected poll response");
          expect(normalized.choiceIds).toEqual([...choiceIds].sort());
        }
      }
    }
  });
  it("permits incomplete drafts but fences publication and required final responses", () => {
    const content = draft();
    expect(validateSurveyResponses(content, {}, false)).toEqual([]);
    expect(validateSurveyResponses(content, {}, true)).toHaveLength(1);
    content.items[0]!.question.prompt = "";
    expect(SurveyDraftSchema.safeParse(content).success).toBe(true);
    expect(SurveyContentSchema.safeParse(content).success).toBe(false);
  });
  it("rejects unknown questions, wrong kinds, and out-of-range ratings", () => {
    const content = draft();
    const id = content.items[0]!.question.id;
    expect(
      validateSurveyResponses(content, { [id]: { kind: "rating", value: 6 } }, true),
    ).toHaveLength(1);
    expect(
      validateSurveyResponses(content, { [id]: { kind: "poll", choiceIds: [randomUUID()] } }, true),
    ).toHaveLength(1);
    expect(
      validateSurveyResponses(content, { [randomUUID()]: { kind: "rating", value: 2 } }, false),
    ).toHaveLength(1);
  });
  it("suppresses small-sample distributions and never emits linked answer rows", () => {
    const content = draft();
    const row = { [content.items[0]!.question.id]: { kind: "rating" as const, value: 4 } };
    expect(surveyAggregate(content, [row, row, row, row], true).questions[0]!.distribution).toEqual(
      [],
    );
    const results = surveyAggregate(content, [row, row, row, row, row], true);
    expect(results.questions[0]!.distribution[3]!.count).toBe(5);
    expect(JSON.stringify(results)).not.toContain("responses");
  });
  it("never releases changing distributions while collecting, even above the sample minimum", () => {
    const content = draft();
    const id = content.items[0]!.question.id;
    const row = { [id]: { kind: "rating" as const, value: 4 } };
    for (const count of [5, 6, 20]) {
      const result = surveyAggregate(
        content,
        Array.from({ length: count }, () => row),
      );
      expect(result).toMatchObject({
        suppressed: true,
        resultsStatus: "collecting",
        submittedCount: count,
      });
      expect(result.questions[0]).toMatchObject({
        answeredCount: null,
        suppressed: true,
        distribution: [],
      });
    }
  });
  it("enforces the sample minimum for optional questions, not just completed attempts", () => {
    const content = draft();
    content.items[0]!.required = false;
    const row = { [content.items[0]!.question.id]: { kind: "rating" as const, value: 4 } };
    const result = surveyAggregate(content, [row, {}, {}, {}, {}], true);
    expect(result).toMatchObject({ resultsStatus: "available", suppressed: false });
    expect(result.questions[0]).toMatchObject({
      answeredCount: null,
      suppressed: true,
      distribution: [],
    });
    expect(surveyAggregate(content, [row, row, row, row, row], true).questions[0]).toMatchObject({
      answeredCount: 5,
      suppressed: false,
    });
  });
});
