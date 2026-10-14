import { describe, expect, it } from "vitest";
import {
  QUESTION_TYPE_REGISTRY,
  QUESTION_TYPE_REGISTRY_VERSION,
  QuestionTypeSchema,
  questionTypeDefinition,
} from "../src/index.js";

describe("question type registry", () => {
  it("covers every public question type from one versioned source", () => {
    expect(QUESTION_TYPE_REGISTRY_VERSION).toBe(3);
    expect(Object.keys(QUESTION_TYPE_REGISTRY).sort()).toEqual(
      [...QuestionTypeSchema.options].sort(),
    );
    for (const type of QuestionTypeSchema.options) {
      const definition = questionTypeDefinition(type);
      expect(definition.type).toBe(type);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });

  it("marks opinion formats as unscored and ineligible for Recovery links", () => {
    expect(questionTypeDefinition("poll")).toMatchObject({
      scored: false,
      supportsConfidence: false,
      supportsRecovery: false,
    });
    expect(questionTypeDefinition("rating")).toMatchObject({
      scored: false,
      supportsConfidence: false,
      supportsRecovery: false,
    });
    expect(questionTypeDefinition("numeric")).toMatchObject({
      scored: true,
      supportsConfidence: true,
      supportsRecovery: true,
    });
  });
});
