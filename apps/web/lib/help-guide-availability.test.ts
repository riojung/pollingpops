import type { WorkspaceProductFeatures } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  professionalBuilderGuidesAvailable,
  professionalRoundBuilderAvailable,
} from "./help-guide-availability";

const enabledFeatures: WorkspaceProductFeatures = {
  roundExperiences: true,
  audiencePulse: true,
  roomChat: true,
  uxBeta: true,
  recoveryRehearsal: true,
  practiceAssignments: true,
  workspaceShell: true,
  builderV2: true,
  presentations: true,
  presentationRealtime: true,
  presentationCompanion: false,
  liveFlexMode: true,
  questionHealth: false,
  recoveryPacks: false,
  surveys: false,
  groups: true,
  discover: true,
};

describe("help guide availability", () => {
  it("requires every capability demonstrated by the combined videos", () => {
    expect(professionalBuilderGuidesAvailable(enabledFeatures)).toBe(true);

    for (const feature of [
      "uxBeta",
      "practiceAssignments",
      "workspaceShell",
      "builderV2",
      "presentations",
      "roundExperiences",
      "audiencePulse",
      "roomChat",
    ] as const) {
      expect(professionalBuilderGuidesAvailable({ ...enabledFeatures, [feature]: false })).toBe(
        false,
      );
    }
  });

  it("keeps Round Builder availability independent from optional professional features", () => {
    expect(
      professionalRoundBuilderAvailable({
        ...enabledFeatures,
        presentations: false,
        roundExperiences: false,
        audiencePulse: false,
        roomChat: false,
        groups: false,
        discover: false,
        practiceAssignments: false,
      }),
    ).toBe(true);
    expect(professionalRoundBuilderAvailable({ ...enabledFeatures, builderV2: false })).toBe(false);
    expect(professionalRoundBuilderAvailable(undefined)).toBe(false);
  });
});
