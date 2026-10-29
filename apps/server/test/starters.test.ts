import { describe, expect, it } from "vitest";
import { QuizContentSchema, StarterIdSchema, questionTypeDefinition } from "@openround/contracts";
import { SurveyContentSchema } from "@openround/contracts/surveys";
import { instantiateStarter, starterSummaries } from "../src/starters.js";
describe("original template library", () => {
  it("provides 36 ready-to-edit templates across all categories and live intents", () => {
    expect(starterSummaries).toHaveLength(36);
    expect(starterSummaries.map((starter) => starter.id).sort()).toEqual(
      [...StarterIdSchema.options].sort(),
    );
    expect(new Set(starterSummaries.map((s) => s.category)).size).toBe(6);
    for (const starter of starterSummaries) {
      const draft = instantiateStarter(starter.id);
      expect(QuizContentSchema.safeParse(draft).success).toBe(true);
      expect(JSON.stringify(draft)).not.toMatch(/Replace with|Replace this|Option one|Option two/i);
      expect(starter.previewPrompt).toBe(draft.questions[0]!.prompt);
      expect(starter.roundType).toBe(
        draft.questions.every((q) => !questionTypeDefinition(q.type).scored)
          ? "poll"
          : draft.questions.every((q) => questionTypeDefinition(q.type).scored)
            ? "quiz"
            : "custom",
      );
      const copy = instantiateStarter(starter.id);
      expect(copy.questions[0]!.id).not.toBe(draft.questions[0]!.id);
      if ("choices" in draft.questions[0]! && "choices" in copy.questions[0]!)
        expect(copy.questions[0]!.choices[0]!.id).not.toBe(draft.questions[0]!.choices[0]!.id);
      if (draft.questions[0]?.linkedRecheckQuestionId)
        expect(draft.questions[0].linkedRecheckQuestionId).toBe(draft.questions[1]!.id);
    }
  });

  it("offers 17 survey-compatible feedback templates without scored or diagnostic metadata", () => {
    const feedback = starterSummaries.filter((starter) =>
      starter.responseTypes.every((type) => type === "poll" || type === "rating"),
    );
    expect(feedback).toHaveLength(17);
    for (const starter of feedback) {
      const draft = instantiateStarter(starter.id);
      const result = SurveyContentSchema.safeParse({
        schemaVersion: 2,
        title: draft.title,
        description: draft.description,
        category: draft.category,
        experiencePreset: draft.experiencePreset,
        items: draft.questions.map((question) => ({ required: true, question })),
      });
      expect(result.success, starter.id).toBe(true);
    }
    expect(instantiateStarter("event-feedback").questions).toHaveLength(4);
    expect(instantiateStarter("learning-needs").questions).toHaveLength(4);
  });
});
