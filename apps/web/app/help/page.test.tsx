import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";

const fixtures = vi.hoisted(() => ({
  workspace: {
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
      questionHealth: false,
      groups: true,
      discover: true,
    },
  },
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspacePage: ({
    children,
    requireBeta,
    title,
  }: {
    children: ReactNode;
    requireBeta?: boolean;
    title: string;
  }) => (
    <main>
      <h1>{title}</h1>
      <span data-require-beta={String(requireBeta)} />
      {children}
    </main>
  ),
}));

vi.mock("../../components/workspace/workspace-provider", () => ({
  useWorkspace: () => fixtures.workspace,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/help",
}));

import HelpPage from "./page";

describe("Help centre video guides", () => {
  beforeEach(() => {
    fixtures.workspace.canEdit = true;
    for (const feature of [
      "uxBeta",
      "practiceAssignments",
      "workspaceShell",
      "builderV2",
      "presentations",
      "presentationRealtime",
      "groups",
      "discover",
      "roundExperiences",
      "audiencePulse",
      "roomChat",
    ] as const) {
      fixtures.workspace.productFeatures[feature] = true;
    }
  });

  it("renders both captioned guides, transcripts, and direct next steps", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<HelpPage />));

    expect(markup).toContain('data-require-beta="false"');
    expect(markup).toContain('id="quick-start"');
    expect(markup).toContain('id="round-builder-guide"');
    expect(markup).toContain('src="/guides/polling-pops-quick-start.mp4"');
    expect(markup).toContain('src="/guides/polling-pops-user-guide.mp4"');
    expect(markup).toContain('src="/guides/polling-pops-quick-start.vtt"');
    expect(markup).toContain('src="/guides/polling-pops-user-guide.vtt"');
    expect(markup.match(/kind="captions"/g)).toHaveLength(2);
    expect(markup.match(/controls=""/g)).toHaveLength(2);
    expect(markup.match(/preload="none"/g)).toHaveLength(2);
    expect(markup.match(/Read transcript for/g)).toHaveLength(2);
    expect(markup).toContain("Quick start: create your first Round");
    expect(markup).toContain("User guide: interact, recover, and follow up");
    expect(markup).toContain("make your first Polling Pops Round together.");
    expect(markup).toContain("Chat starts off.");
    expect(markup).not.toContain("recorded before the Polling Pops rebrand");
    expect(markup).toContain('href="/help/first-round"');
    expect(markup).toContain('href="/create?type=custom&amp;start=blank"');
  });

  it("shows accurate classic guidance without beta-only media or links", () => {
    fixtures.workspace.productFeatures.uxBeta = false;
    fixtures.workspace.productFeatures.practiceAssignments = false;
    fixtures.workspace.productFeatures.workspaceShell = false;
    fixtures.workspace.productFeatures.builderV2 = false;
    fixtures.workspace.productFeatures.presentations = false;
    fixtures.workspace.productFeatures.groups = false;
    fixtures.workspace.productFeatures.discover = false;

    const markup = renderToStaticMarkup(withEnglishLocale(<HelpPage />));

    expect(markup).toContain("Use the classic Round workflow");
    expect(markup).toContain("Open the dashboard, name a checkpoint set");
    expect(markup).toContain('href="/dashboard"');
    expect(markup).not.toContain("polling-pops-quick-start.mp4");
    expect(markup).not.toContain('href="/create?type=custom&amp;start=starters"');
    expect(markup).not.toContain("Presentations have their own grounded starting methods");
    expect(markup).not.toContain("Groups lets facilitator teams");
  });

  it("keeps quick start available when an advanced capability is unavailable", () => {
    fixtures.workspace.productFeatures.presentations = false;

    const markup = renderToStaticMarkup(withEnglishLocale(<HelpPage />));

    expect(markup).toContain("The full user-guide video is hidden");
    expect(markup).toContain('href="/help/first-round"');
    expect(markup).toContain("polling-pops-quick-start.mp4");
    expect(markup).not.toContain("polling-pops-user-guide.mp4");
    expect(markup).toContain('href="/create?type=custom&amp;start=blank"');
  });

  it("sends read-only members to Library instead of a creation route", () => {
    fixtures.workspace.canEdit = false;

    const markup = renderToStaticMarkup(withEnglishLocale(<HelpPage />));

    expect(markup.match(/href="\/library"/g)?.length).toBeGreaterThan(1);
    expect(markup).toContain("Open Library");
    expect(markup).not.toContain('href="/create?type=custom&amp;start=blank"');
    expect(markup).not.toContain("Start a blank Round");
  });

  it.each(["roundExperiences", "audiencePulse", "roomChat"] as const)(
    "hides advanced guidance when %s is disabled",
    (feature) => {
      fixtures.workspace.productFeatures[feature] = false;
      const markup = renderToStaticMarkup(withEnglishLocale(<HelpPage />));
      expect(markup).toContain("polling-pops-quick-start.mp4");
      expect(markup).not.toContain("polling-pops-user-guide.mp4");
    },
  );

  it("covers each feature with an illustrated searchable written guide", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<HelpPage />));
    expect(markup).toContain('id="feature-guides"');
    expect(markup).toContain("Written feature guides");
    expect(markup).toContain('type="search"');
    expect(markup).toContain("currently written in English");
    for (const id of [
      "audience-pulse",
      "room-chat",
      "q-and-a",
      "reports",
      "groups",
      "recovery-packs",
      "privacy-and-deletion",
    ])
      expect(markup).toContain(`href="/help/${id}"`);
    expect(markup).toContain('href="#video-guides"');
    expect(markup).toContain("Not enabled here");
  });
});
