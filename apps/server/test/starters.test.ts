import { describe, expect, it } from "vitest";
import { QuizContentSchema, questionTypeDefinition } from "@openround/contracts";
import { instantiateStarter, starterSummaries } from "../src/starters.js";
describe("original template library", () => {
  it("provides 24 valid templates across all six categories and both live intents", () => {
    expect(starterSummaries).toHaveLength(24);
    expect(new Set(starterSummaries.map((s) => s.category)).size).toBe(6);
    for (const starter of starterSummaries) {
      const draft = instantiateStarter(starter.id);
      expect(QuizContentSchema.safeParse(draft).success).toBe(true);
      expect(starter.roundType).toBe(
        draft.questions.every((q) => !questionTypeDefinition(q.type).scored)
          ? "poll"
          : draft.questions.every((q) => questionTypeDefinition(q.type).scored)
            ? "quiz"
            : "custom",
      );
      const copy = instantiateStarter(starter.id);
      expect(copy.questions[0]!.id).not.toBe(draft.questions[0]!.id);
      if (draft.questions[0]?.linkedRecheckQuestionId)
        expect(draft.questions[0].linkedRecheckQuestionId).toBe(draft.questions[1]!.id);
    }
  });
});
