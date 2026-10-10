import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SurveyDraftSchema,
  SurveyContentSchema,
  surveyAggregate,
  validateSurveyResponses,
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
    expect(SurveyDraftSchema.safeParse({ ...content, schemaVersion: 2 }).success).toBe(false);
    content.items[0]!.question.basePoints = 100;
    expect(SurveyDraftSchema.safeParse(content).success).toBe(false);
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
