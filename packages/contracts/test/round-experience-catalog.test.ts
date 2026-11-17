import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreateSessionSchema,
  ExperiencePresetIdSchema,
  ExperienceThemeSnapshotSchema,
  QuizContentSchema,
  RoundCategorySchema,
} from "../src/index.js";

const additions = [
  ["science", "observatory"],
  ["health_wellbeing", "breath"],
  ["arts_culture", "gallery"],
  ["leadership", "summit"],
  ["sustainability", "grove"],
  ["community", "commons"],
] as const;

const settings = {
  audienceLimit: 20,
  scoringMode: "accuracy",
  resultVisibility: "private",
  allowLateJoin: true,
  nicknamePolicy: "custom",
} as const;

const question = {
  id: randomUUID(),
  type: "true_false",
  prompt: "A published topic can use any supported look.",
  choices: [
    { id: randomUUID(), label: "True", isCorrect: true },
    { id: randomUUID(), label: "False", isCorrect: false },
  ],
  timeLimitSeconds: 20,
  basePoints: 1000,
  explanation: "",
  mediaId: null,
  mediaAlt: null,
};

describe("additive Round experience catalog contracts", () => {
  it.each(additions)("preserves the published %s topic and %s preset", (category, preset) => {
    const content = QuizContentSchema.parse({
      title: "Round",
      description: "",
      category,
      experiencePreset: { id: preset, version: 1 },
      questions: [question],
    });
    expect(content.category).toBe(category);
    expect(content.experiencePreset).toEqual({ id: preset, version: 1 });
    expect(
      CreateSessionSchema.parse({
        quizId: randomUUID(),
        settings,
        experiencePresetOverride: preset,
      }).experiencePresetOverride,
    ).toBe(preset);
  });

  it("keeps existing IDs, accepts Midnight as an independent look, and rejects unknown or future references", () => {
    expect(RoundCategorySchema.options.slice(0, 6)).toEqual([
      "general",
      "education",
      "business",
      "technical",
      "safety_compliance",
      "icebreaker",
    ]);
    expect(ExperiencePresetIdSchema.options.slice(0, 7)).toEqual([
      "pops",
      "focus",
      "campus",
      "studio",
      "blueprint",
      "signal",
      "spark",
    ]);
    expect(
      CreateSessionSchema.parse({
        quizId: randomUUID(),
        settings,
        experiencePresetOverride: "midnight",
      }).experiencePresetOverride,
    ).toBe("midnight");
    expect(ExperiencePresetIdSchema.safeParse("unknown").success).toBe(false);
    expect(
      ExperienceThemeSnapshotSchema.shape.preset.safeParse({ id: "midnight", version: 2 }).success,
    ).toBe(false);
  });
});
