import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceProductFeatures } from "@openround/contracts";
import { findHelpGuide } from "../../lib/help-feature-guides";

const fixtures = vi.hoisted(() => ({
  canEdit: true,
  productFeatures: {
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
    liveFlexMode: true,
    questionHealth: true,
    recoveryPacks: true,
    groups: true,
    discover: true,
  } as WorkspaceProductFeatures,
}));
vi.mock("../../components/workspace/workspace-provider", () => ({ useWorkspace: () => fixtures }));
import { FeatureGuideContent } from "./feature-guide";

describe("feature guide reading page", () => {
  beforeEach(() => {
    fixtures.canEdit = true;
    for (const feature of Object.keys(
      fixtures.productFeatures,
    ) as (keyof WorkspaceProductFeatures)[])
      fixtures.productFeatures[feature] = true;
  });

  it("renders steps, prerequisites, success, troubleshooting, and a matching video chapter", () => {
    const markup = renderToStaticMarkup(
      <FeatureGuideContent guide={findHelpGuide("hosting-and-qr")!} />,
    );
    expect(markup).toContain('lang="en-CA"');
    for (const id of [
      "before-you-start",
      "steps",
      "success-check",
      "good-to-know",
      "troubleshooting",
    ])
      expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain("A phone cannot reach the host computer through localhost");
    expect(markup).toContain("At least two separate devices");
    expect(markup).toContain("watch=quick-start&amp;chapter=4#quick-start");
    expect(markup).toContain('href="/library"');
    expect(markup).toContain('href="/help#feature-guides"');
  });

  it("lets readers learn unavailable features without a live feature action", () => {
    fixtures.productFeatures.roomChat = false;
    const markup = renderToStaticMarkup(
      <FeatureGuideContent guide={findHelpGuide("room-chat")!} />,
    );
    expect(markup).toContain("not enabled in this workspace");
    expect(markup).toContain("Step-by-step guide");
    expect(markup).not.toContain("Open session history");
    expect(markup).not.toContain("Watch related chapter");
  });

  it("does not send a viewer into a content-creation workflow", () => {
    fixtures.canEdit = false;
    const markup = renderToStaticMarkup(
      <FeatureGuideContent guide={findHelpGuide("first-round")!} />,
    );
    expect(markup).toContain("Your workspace role is read-only");
    expect(markup).not.toContain('href="/create?type=custom&amp;start=blank"');
    expect(markup).toContain("Watch related chapter");
  });

  it("uses the dashboard for classic report guidance", () => {
    fixtures.productFeatures.uxBeta = false;
    fixtures.productFeatures.workspaceShell = false;
    const markup = renderToStaticMarkup(<FeatureGuideContent guide={findHelpGuide("reports")!} />);
    expect(markup).toContain('href="/dashboard"');
    expect(markup).not.toContain('href="/results"');
    expect(markup).toContain("not proof of long-term learning");
  });
});
