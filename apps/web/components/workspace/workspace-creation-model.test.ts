import { WorkspaceProductFeaturesSchema } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  workspaceCreationGoals,
  workspaceCreationOptions,
  workspaceBlankCreationHref,
  roundCreationHref,
  presentationCreationHref,
  surveyCreationHref,
  templateCatalogHref,
  resolveRoundCreation,
  resolvePresentationCreation,
  resolveSurveyCreation,
} from "./workspace-creation-model";

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

describe("creation destinations and legacy selection", () => {
  it("keeps goal, method and catalog links on fixed setup destinations", () => {
    expect(roundCreationHref()).toBe("/create?product=round");
    expect(roundCreationHref("poll")).toBe("/create?type=poll");
    expect(roundCreationHref("custom", "source")).toBe("/create?type=custom&start=source");
    expect(presentationCreationHref("outline")).toBe("/create/presentation?start=outline");
    expect(surveyCreationHref("template")).toBe("/surveys/new?start=template");
    expect(templateCatalogHref()).toBe("/templates");
    expect(templateCatalogHref("surveys", "team-meetings")).toBe(
      "/templates?type=surveys&collection=team-meetings",
    );
  });

  it("uses the same grants for catalog blank starts and the global launcher", () => {
    const input = { canEdit: true, productFeatures: features };
    expect(workspaceBlankCreationHref("round", input)).toBe("/create?type=custom&start=blank");
    expect(workspaceBlankCreationHref("presentation", input)).toBe(
      "/create/presentation?start=blank",
    );
    expect(workspaceBlankCreationHref("survey", input)).toBe("/surveys/new?start=blank");
    expect(
      workspaceBlankCreationHref("round", {
        ...input,
        productFeatures: { ...features, builderV2: false },
      }),
    ).toBe("/dashboard");
    for (const kind of ["round", "presentation", "survey", "ideaBoard"] as const) {
      expect(workspaceBlankCreationHref(kind, { ...input, canEdit: false })).toBeNull();
      expect(workspaceBlankCreationHref(kind, { ...input, productFeatures: null })).toBeNull();
    }
    expect(
      workspaceBlankCreationHref("presentation", {
        ...input,
        productFeatures: { ...features, presentations: false },
      }),
    ).toBeNull();
  });

  it.each(["blank", "starters", "source", "import"])(
    "keeps Round legacy #%s and start aliases",
    (method) => {
      const expected = { kind: "custom", method, issue: null, roundOnly: false };
      expect(resolveRoundCreation(new URLSearchParams(), `#${method}`, true)).toEqual(expected);
      expect(resolveRoundCreation(new URLSearchParams({ start: method }), "", true)).toEqual(
        expected,
      );
    },
  );

  it("lets a unique query override a hash and retains the Round-only goal chooser", () => {
    expect(
      resolveRoundCreation(new URLSearchParams("type=quiz&start=blank"), "#source", true),
    ).toEqual({ kind: "quiz", method: "blank", issue: null, roundOnly: false });
    expect(resolveRoundCreation(new URLSearchParams("product=round"), "", true)).toEqual({
      kind: null,
      method: null,
      issue: null,
      roundOnly: true,
    });
    expect(resolveRoundCreation(new URLSearchParams("type=poll"), "", true)).toEqual({
      kind: "poll",
      method: "blank",
      issue: null,
      roundOnly: false,
    });
    expect(resolveRoundCreation(new URLSearchParams("type=quiz&start=source"), "", false)).toEqual({
      kind: null,
      method: null,
      issue: null,
      roundOnly: false,
    });
  });

  it.each(["source", "import"])(
    "explains incompatible poll %s links without choosing blank",
    (start) => {
      expect(resolveRoundCreation(new URLSearchParams({ type: "poll", start }), "", true)).toEqual({
        kind: "poll",
        method: null,
        issue: "incompatible-method",
        roundOnly: false,
      });
    },
  );

  it.each([
    "type=other",
    "type=quiz&type=poll",
    "type=quiz&type=quiz",
    "start=other",
    "start=blank&start=source",
    "start=blank&start=blank",
    "start=",
  ])("rejects ambiguous or unknown Round selection %s even with a valid hash", (query) => {
    const result = resolveRoundCreation(new URLSearchParams(query), "#source", true);
    expect(result.issue).toBe("invalid-selection");
    expect(result.method).toBeNull();
  });

  it("ignores unrelated queries/hashes and does not forward arbitrary input into a destination", () => {
    expect(
      resolveRoundCreation(
        new URLSearchParams("redirect=javascript:alert(1)"),
        "#unrecognized",
        true,
      ),
    ).toEqual({ kind: null, method: null, issue: null, roundOnly: false });
    expect(
      resolveRoundCreation(new URLSearchParams("product=round&product=other"), "", true).roundOnly,
    ).toBe(false);
  });

  it.each(["blank", "source", "template", "outline", "design"])(
    "preserves Presentation %s method links",
    (method) => {
      expect(resolvePresentationCreation(new URLSearchParams({ start: method }))).toEqual({
        method,
        issue: null,
      });
    },
  );
  it.each(["start=source&start=outline", "start=source&start=source", "start=unknown", "start="])(
    "rejects ambiguous Presentation methods %s",
    (query) => {
      expect(resolvePresentationCreation(new URLSearchParams(query))).toEqual({
        method: null,
        issue: "invalid-selection",
      });
    },
  );
  it("keeps Survey methods bounded to blank or template and preserves its old overview", () => {
    expect(resolveSurveyCreation(new URLSearchParams())).toEqual({ method: null, issue: null });
    for (const method of ["blank", "template"])
      expect(resolveSurveyCreation(new URLSearchParams({ start: method }))).toEqual({
        method,
        issue: null,
      });
    for (const query of [
      "start=outline",
      "start=blank&start=template",
      "start=template&start=template",
    ])
      expect(resolveSurveyCreation(new URLSearchParams(query))).toEqual({
        method: null,
        issue: "invalid-selection",
      });
  });
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
