import { describe, expect, it } from "vitest";
import type { WorkspaceProductFeatures } from "@openround/contracts";
import { helpVideoScripts } from "./help-video-scripts";
import {
  filterHelpGuides,
  findHelpGuide,
  helpFeatureGuides,
  helpGuideAction,
  helpGuideAvailable,
  helpGuideTopics,
  helpGuideVideoLink,
} from "./help-feature-guides";

const enabled: WorkspaceProductFeatures = {
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
  questionHealth: true,
  recoveryPacks: true,
  surveys: true,
  groups: true,
  discover: true,
};
const classic = Object.fromEntries(
  Object.keys(enabled).map((key) => [key, false]),
) as WorkspaceProductFeatures;

describe("written Help guides", () => {
  it("has stable unique routes and useful written coverage for every topic", () => {
    expect(helpFeatureGuides.length).toBeGreaterThanOrEqual(30);
    expect(new Set(helpFeatureGuides.map((guide) => guide.id)).size).toBe(helpFeatureGuides.length);
    for (const guide of helpFeatureGuides) {
      expect(guide.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(findHelpGuide(guide.id)).toBe(guide);
      expect(guide.title.length).toBeGreaterThan(10);
      expect(guide.before.length).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
      expect(guide.steps.every((step) => step.title && step.body.length > 40)).toBe(true);
      expect(guide.check.length).toBeGreaterThan(30);
      expect(guide.notes.length).toBeGreaterThan(0);
      expect(guide.troubleshooting.length).toBeGreaterThan(0);
    }
    for (const topic of Object.keys(helpGuideTopics))
      expect(helpFeatureGuides.some((guide) => guide.topic === topic)).toBe(true);
    expect(findHelpGuide("does-not-exist")).toBeUndefined();
    expect(findHelpGuide("__proto__")).toBeUndefined();
  });

  it("searches instructions and troubleshooting, with normalized terms and topic filters", () => {
    expect(filterHelpGuides("  QR   PHONE ").map((guide) => guide.id)).toContain("hosting-and-qr");
    expect(filterHelpGuides("ＱＲ", "host").map((guide) => guide.id)).toContain("hosting-and-qr");
    expect(filterHelpGuides("chat", "interact").every((guide) => guide.topic === "interact")).toBe(
      true,
    );
    expect(filterHelpGuides("an-impossible-search")).toEqual([]);
    expect(filterHelpGuides("   ")).toHaveLength(helpFeatureGuides.length);
  });

  it("keeps basic documentation readable and marks unavailable optional capabilities", () => {
    expect(helpGuideAvailable(findHelpGuide("hosting-and-qr")!, null)).toBe(true);
    expect(helpGuideAvailable(findHelpGuide("room-chat")!, null)).toBe(false);
    expect(helpGuideAvailable(findHelpGuide("groups")!, { ...enabled, groups: false })).toBe(false);
    expect(helpGuideAvailable(findHelpGuide("groups")!, { ...enabled, uxBeta: false })).toBe(false);
    expect(helpGuideAvailable(findHelpGuide("groups")!, enabled)).toBe(true);
  });

  it("resolves classic destinations and never advertises unavailable or read-only creation actions", () => {
    expect(helpGuideAction(findHelpGuide("first-round")!, enabled, true)?.href).toBe(
      "/create?start=blank",
    );
    expect(helpGuideAction(findHelpGuide("first-round")!, classic, true)).toEqual({
      href: "/dashboard",
      label: "Open Round dashboard",
    });
    expect(helpGuideAction(findHelpGuide("first-round")!, enabled, false)).toBeNull();
    expect(
      helpGuideAction(findHelpGuide("presentations")!, { ...enabled, presentations: false }, true),
    ).toBeNull();
    expect(helpGuideAction(findHelpGuide("groups")!, classic, true)).toBeNull();
    expect(helpGuideAction(findHelpGuide("library")!, classic, false)?.href).toBe("/dashboard");
    expect(helpGuideAction(findHelpGuide("reports")!, enabled, false)?.href).toBe("/results");
    expect(helpGuideAction(findHelpGuide("source-authoring")!, enabled, false)).toBeNull();
    expect(helpGuideAction(findHelpGuide("imports-and-exports")!, enabled, false)).toBeNull();
  });

  it("links to existing captioned chapters only when that video is appropriate", () => {
    for (const guide of helpFeatureGuides.filter((item) => item.video)) {
      const video = guide.video!;
      expect(helpVideoScripts[video.guide].some((scene) => scene.id === video.chapter)).toBe(true);
      const link = helpGuideVideoLink(guide, enabled);
      expect(link?.href).toMatch(/^\/help\?watch=(quick-start|round-builder-guide)&chapter=\d+#/);
      expect(link?.title).toBeTruthy();
      expect(helpGuideVideoLink(guide, classic)).toBeNull();
    }
    expect(
      helpGuideVideoLink(findHelpGuide("themes")!, { ...enabled, roomChat: false }),
    ).toBeNull();
    expect(
      helpGuideVideoLink(findHelpGuide("first-round")!, { ...enabled, roomChat: false }),
    ).not.toBeNull();
    expect(helpGuideVideoLink(findHelpGuide("privacy-and-deletion")!, enabled)).toBeNull();
  });
});
