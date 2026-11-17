import { describe, expect, it } from "vitest";
import { publishedRoundPreset, roundLaunchExperience } from "./round-launch-experience";

const published = {
  category: "safety_compliance",
  experiencePreset: { id: "signal", version: 1 },
} as const;

describe("published Round launch experience", () => {
  it("uses the published preset unless this launch explicitly chooses another", () => {
    expect(publishedRoundPreset(published)).toBe("signal");
    expect(
      roundLaunchExperience({
        content: published,
        override: null,
        available: true,
        soundEnabled: false,
      }),
    ).toEqual({ presenterSoundEnabled: false });
  });

  it("sends an explicit room override without changing the published topic or preset", () => {
    const original = structuredClone(published);
    expect(
      roundLaunchExperience({
        content: published,
        override: "midnight",
        available: true,
        soundEnabled: true,
      }),
    ).toEqual({ experiencePresetOverride: "midnight", presenterSoundEnabled: true });
    expect(published).toEqual(original);
  });

  it("returns to the published version when an override is reset or matches the published look", () => {
    for (const override of [null, "signal"] as const) {
      expect(
        roundLaunchExperience({
          content: published,
          override,
          available: true,
          soundEnabled: false,
        }),
      ).not.toHaveProperty("experiencePresetOverride");
    }
  });

  it("does not send a look override or sound when the launch feature is unavailable", () => {
    expect(
      roundLaunchExperience({
        content: published,
        override: "spark",
        available: false,
        soundEnabled: true,
      }),
    ).toEqual({ presenterSoundEnabled: false });
  });

  it("matches the server recommendation fallback for missing legacy metadata and retains explicit legacy Focus", () => {
    expect(publishedRoundPreset({ category: "science" })).toBe("observatory");
    expect(publishedRoundPreset({})).toBe("pops");
    expect(
      publishedRoundPreset({ category: "general", experiencePreset: { id: "focus", version: 1 } }),
    ).toBe("focus");
  });
});
