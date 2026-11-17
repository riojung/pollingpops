import type { ExperiencePresetId, QuizDraft } from "@openround/contracts";
import { presetForCategory } from "@openround/experience";

/** Match the server's published-version fallback, including legacy content. */
export function publishedRoundPreset(content: Pick<QuizDraft, "category" | "experiencePreset">) {
  return content.experiencePreset?.id ?? presetForCategory(content.category ?? "general");
}

/** A room look is an explicit choice for this launch, never a saved workspace preference. */
export function roundLaunchExperience(input: {
  content: Pick<QuizDraft, "category" | "experiencePreset">;
  override: ExperiencePresetId | null;
  available: boolean;
  soundEnabled: boolean;
}) {
  const publishedPreset = publishedRoundPreset(input.content);
  return {
    ...(input.available && input.override !== null && input.override !== publishedPreset
      ? { experiencePresetOverride: input.override }
      : {}),
    presenterSoundEnabled: input.available && input.soundEnabled,
  };
}
