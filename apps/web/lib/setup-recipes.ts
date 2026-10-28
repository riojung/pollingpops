import type { ExperiencePresetId, SessionSettings } from "@openround/contracts";

export type SetupRecipe = "recovery" | "competition" | "discussion";

export interface ResolvedSetupRecipe {
  settings: SessionSettings;
  experiencePreset: ExperiencePresetId;
  presenterSoundEnabled: false;
}

export function defaultSetupSettings(
  segment: "education" | "workplace",
  maxParticipants: number,
): SessionSettings {
  return {
    audienceLimit: Math.min(segment === "education" ? 20 : 100, maxParticipants),
    scoringMode: segment === "education" ? "accuracy" : "speed",
    timeMode: "timed",
    resultVisibility: segment === "education" ? "private" : "leaderboard",
    allowLateJoin: true,
    nicknamePolicy: "custom",
    confidenceEnabled: false,
  };
}

export function resolveSetupRecipe(
  recipe: SetupRecipe,
  current: SessionSettings,
  options: {
    segment: "education" | "workplace";
    maxParticipants: number;
    roundExperiencesAvailable: boolean;
  },
): ResolvedSetupRecipe {
  const audienceLimit = Math.min(Math.max(1, current.audienceLimit), options.maxParticipants);
  const common = {
    audienceLimit,
    allowLateJoin: true,
    timeMode: current.timeMode ?? "timed",
    nicknamePolicy: current.nicknamePolicy,
    confidenceEnabled: current.confidenceEnabled ?? false,
  } as const;

  if (recipe === "competition") {
    return {
      settings: {
        ...common,
        timeMode: "timed",
        scoringMode: "speed",
        resultVisibility: "leaderboard",
      },
      experiencePreset: options.roundExperiencesAvailable ? "spark" : "focus",
      presenterSoundEnabled: false,
    };
  }

  if (recipe === "discussion") {
    return {
      settings: {
        ...common,
        scoringMode: "accuracy",
        resultVisibility: "private",
      },
      experiencePreset: "focus",
      presenterSoundEnabled: false,
    };
  }

  return {
    settings: {
      ...common,
      scoringMode: "accuracy",
      resultVisibility: "private",
    },
    experiencePreset: "focus",
    presenterSoundEnabled: false,
  };
}

export function setupRecipeStorageKey(workspaceId: string) {
  return `openround:setup:v1:${workspaceId}`;
}

export function describeDiscussionRecipe(options: {
  audiencePulseAvailable: boolean;
  roomChatAvailable: boolean;
}) {
  const tools = options.audiencePulseAvailable ? "Pulse and Q&A" : "Q&A";
  return `Private results with ${tools} available${
    options.roomChatAvailable ? "; chat starts closed" : ""
  }.`;
}
