import { WorkspaceProductFeaturesSchema } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { workspaceCreationGoals, workspaceCreationOptions } from "./workspace-creation-model";

const features = WorkspaceProductFeaturesSchema.parse({
  workspaceShell: true,
  builderV2: true,
  presentations: true,
  surveys: true,
  ideaBoards: true,
  canvasBoards: true,
  roundExperiences: false,
  audiencePulse: false,
  roomChat: false,
  uxBeta: false,
  recoveryRehearsal: false,
  practiceAssignments: false,
  presentationRealtime: false,
  groups: false,
  discover: false,
});
describe("workspace creation availability", () => {
  it("offers beginner goals without bypassing roles or resolved feature grants", () => {
    expect(workspaceCreationGoals({ canEdit: true, productFeatures: features })).toEqual([
      { kind: "poll", href: "/create?type=poll" },
      { kind: "quiz", href: "/create?type=quiz" },
      { kind: "presentation", href: "/create/presentation" },
    ]);
    expect(workspaceCreationGoals({ canEdit: false, productFeatures: features })).toEqual([]);
    expect(workspaceCreationGoals({ canEdit: true, productFeatures: null })).toEqual([]);
    expect(
      workspaceCreationGoals({
        canEdit: true,
        productFeatures: { ...features, builderV2: false, presentations: false },
      }),
    ).toEqual([{ kind: "round", href: "/dashboard" }]);
  });
  it("offers all enabled products using their actual creation routes", () => {
    expect(workspaceCreationOptions({ canEdit: true, productFeatures: features })).toEqual([
      { kind: "round", href: "/create?product=round" },
      { kind: "presentation", href: "/create/presentation" },
      { kind: "survey", href: "/surveys/new" },
      { kind: "ideaBoard", href: "/boards?create=1" },
    ]);
  });
  it("offers no creation actions for viewers or unresolved account grants", () => {
    expect(workspaceCreationOptions({ canEdit: false, productFeatures: features })).toEqual([]);
    expect(workspaceCreationOptions({ canEdit: true, productFeatures: null })).toEqual([]);
  });
  it("honors each optional grant independently and retains the legacy Round route", () => {
    expect(
      workspaceCreationOptions({
        canEdit: true,
        productFeatures: {
          ...features,
          builderV2: false,
          presentations: false,
          surveys: false,
          ideaBoards: false,
          canvasBoards: false,
        },
      }),
    ).toEqual([{ kind: "round", href: "/dashboard" }]);
    for (const mode of ["ideaBoards", "canvasBoards"] as const) {
      const enabled = { ...features, ideaBoards: false, canvasBoards: false, [mode]: true };
      expect(
        workspaceCreationOptions({ canEdit: true, productFeatures: enabled }).find(
          (option) => option.kind === "ideaBoard",
        ),
      ).toEqual({ kind: "ideaBoard", href: "/boards?create=1" });
    }
  });
});
