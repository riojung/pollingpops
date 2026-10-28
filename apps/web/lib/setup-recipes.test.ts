import { describe, expect, it } from "vitest";
import type { SessionSettings } from "@openround/contracts";
import {
  defaultSetupSettings,
  describeDiscussionRecipe,
  resolveSetupRecipe,
  setupRecipeStorageKey,
} from "./setup-recipes";

const current: SessionSettings = {
  audienceLimit: 80,
  timeMode: "flex",
  scoringMode: "speed",
  resultVisibility: "leaderboard",
  allowLateJoin: false,
  nicknamePolicy: "custom",
};

describe("setup recipes", () => {
  it.each(["education", "workplace"] as const)(
    "lets participants choose nicknames in new %s rooms and every recipe",
    (segment) => {
      const defaults = defaultSetupSettings(segment, 50);
      expect(defaults.nicknamePolicy).toBe("custom");
      expect(defaults.confidenceEnabled).toBe(false);
      expect(defaults.audienceLimit).toBeLessThanOrEqual(50);
      for (const recipe of ["recovery", "competition", "discussion"] as const) {
        expect(
          resolveSetupRecipe(recipe, defaults, {
            segment,
            maxParticipants: 50,
            roundExperiencesAvailable: true,
          }).settings.nicknamePolicy,
        ).toBe("custom");
      }
    },
  );

  it("preserves an explicitly chosen generated-only policy across recipes", () => {
    for (const recipe of ["recovery", "competition", "discussion"] as const) {
      expect(
        resolveSetupRecipe(
          recipe,
          { ...current, nicknamePolicy: "friendly_only" },
          {
            segment: "education",
            maxParticipants: 100,
            roundExperiencesAvailable: true,
          },
        ).settings.nicknamePolicy,
      ).toBe("friendly_only");
    }
  });

  it.each([true, false, undefined])(
    "preserves an explicit confidence choice and otherwise defaults off (%s)",
    (confidenceEnabled) => {
      for (const recipe of ["recovery", "competition", "discussion"] as const) {
        expect(
          resolveSetupRecipe(
            recipe,
            { ...current, ...(confidenceEnabled === undefined ? {} : { confidenceEnabled }) },
            {
              segment: "education",
              maxParticipants: 100,
              roundExperiencesAvailable: true,
            },
          ).settings.confidenceEnabled,
        ).toBe(confidenceEnabled ?? false);
      }
    },
  );

  it("maps recovery to private, accuracy-first facilitation while preserving a capped audience", () => {
    expect(
      resolveSetupRecipe("recovery", current, {
        segment: "workplace",
        maxParticipants: 50,
        roundExperiencesAvailable: true,
      }),
    ).toEqual({
      settings: {
        audienceLimit: 50,
        confidenceEnabled: false,
        timeMode: "flex",
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
      experiencePreset: "focus",
      presenterSoundEnabled: false,
    });
  });

  it("uses Spark only when experiences are available and never enables sound implicitly", () => {
    expect(
      resolveSetupRecipe("competition", current, {
        segment: "education",
        maxParticipants: 100,
        roundExperiencesAvailable: true,
      }),
    ).toMatchObject({
      settings: { timeMode: "timed", scoringMode: "speed" },
      experiencePreset: "spark",
      presenterSoundEnabled: false,
    });
    expect(
      resolveSetupRecipe("competition", current, {
        segment: "education",
        maxParticipants: 100,
        roundExperiencesAvailable: false,
      }),
    ).toMatchObject({ experiencePreset: "focus", presenterSoundEnabled: false });
  });

  it("keeps participant name choice for discussion and versions stored preferences", () => {
    expect(
      resolveSetupRecipe("discussion", current, {
        segment: "workplace",
        maxParticipants: 100,
        roundExperiencesAvailable: true,
      }).settings.nicknamePolicy,
    ).toBe("custom");
    expect(setupRecipeStorageKey("workspace-id")).toBe("openround:setup:v1:workspace-id");
  });

  it("describes only the discussion tools enabled for the workspace", () => {
    expect(
      describeDiscussionRecipe({ audiencePulseAvailable: true, roomChatAvailable: true }),
    ).toBe("Private results with Pulse and Q&A available; chat starts closed.");
    expect(
      describeDiscussionRecipe({ audiencePulseAvailable: false, roomChatAvailable: false }),
    ).toBe("Private results with Q&A available.");
  });
});
