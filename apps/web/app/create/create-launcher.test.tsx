import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProductFeaturesSchema } from "@openround/contracts";
import type { WorkspaceProductFeatures } from "@openround/contracts";

const allFeatures = () =>
  WorkspaceProductFeaturesSchema.parse({
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

const fixtures = vi.hoisted(() => ({
  query: "",
  push: vi.fn(),
  features: null as WorkspaceProductFeatures | null,
  canEdit: true,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: fixtures.push }),
  useSearchParams: () => new URLSearchParams(fixtures.query),
}));

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: fixtures.canEdit,
    entitlements: { csvExport: true },
    productFeatures: fixtures.features,
  }),
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

vi.mock("../../components/authoring-assistant", () => ({
  AuthoringAssistant: () => <div>Source authoring workflow</div>,
}));

vi.mock("../../components/checkpoint-set-import", () => ({
  CheckpointSetImport: () => <div>Structured import workflow</div>,
}));

vi.mock("../../components/workspace/starter-gallery", () => ({
  StarterGallery: () => <div>Starter gallery</div>,
}));

import CreatePage from "./page";

describe("Round creation launcher", () => {
  beforeEach(() => {
    fixtures.query = "";
    fixtures.push.mockClear();
    fixtures.features = allFeatures();
    fixtures.canEdit = true;
  });

  it("asks for an activity type before offering starting methods", () => {
    const markup = renderToStaticMarkup(<CreatePage />);

    expect(markup).toContain("What would you like to create?");
    expect(markup).toContain('href="/create?type=quiz"');
    expect(markup).toContain('href="/create?type=poll"');
    expect(markup).toContain('href="/surveys/new"');
    expect(markup).toContain('href="/create?type=custom"');
    expect(markup).toContain('href="/create/presentation"');
    expect(markup).toContain('href="/boards?create=1"');
    expect(markup).toContain("at their own pace");
    expect(markup).not.toContain("Source authoring workflow");
    expect(markup).not.toContain("Structured import workflow");
  });

  it("hides ungranted products while retaining independently granted boards and legacy Rounds", () => {
    fixtures.features = {
      ...allFeatures(),
      builderV2: false,
      presentations: false,
      surveys: false,
      canvasBoards: false,
      ideaBoards: true,
    };
    fixtures.query = "type=quiz&start=blank";
    const markup = renderToStaticMarkup(<CreatePage />);
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain('href="/boards?create=1"');
    expect(markup).not.toContain('href="/surveys/new"');
    expect(markup).not.toContain('href="/create/presentation"');
    expect(markup).not.toContain("Create Round and write question");
  });
  it("keeps the Round menu choice focused on Round variants and blocks viewer creation", () => {
    fixtures.query = "product=round";
    const markup = renderToStaticMarkup(<CreatePage />);
    expect(markup).toContain('href="/create?type=quiz"');
    expect(markup).not.toContain('href="/boards?create=1"');
    fixtures.canEdit = false;
    const viewer = renderToStaticMarkup(<CreatePage />);
    expect(viewer).not.toContain('href="/create?type=quiz"');
    expect(viewer).not.toContain('href="/surveys/new"');
    expect(viewer).not.toContain('href="/boards?create=1"');
  });

  it("offers only unscored responses for a live poll", () => {
    fixtures.query = "type=poll&start=blank";
    const markup = renderToStaticMarkup(<CreatePage />);
    expect(markup).toContain('value="poll"');
    expect(markup).toContain('value="rating"');
    expect(markup).not.toContain('value="single_select"');
    expect(markup).not.toContain('value="numeric"');
  });
  it("offers scored responses for a quiz and every format for custom", () => {
    fixtures.query = "type=quiz&start=blank";
    const quiz = renderToStaticMarkup(<CreatePage />);
    expect(quiz).toContain('value="numeric"');
    expect(quiz).not.toContain('value="rating"');
    fixtures.query = "type=custom&start=blank";
    expect(renderToStaticMarkup(<CreatePage />)).toContain('value="rating"');
  });

  it("renders only the selected creation workflow", () => {
    fixtures.query = "start=blank";
    const markup = renderToStaticMarkup(<CreatePage />);

    expect(markup).toContain("Start a blank Round");
    expect(markup).toContain("First response type");
    expect(markup).toContain("Create Round and write question");
    expect(markup).not.toContain("Source authoring workflow");
    expect(markup).not.toContain("Structured import workflow");
    expect(markup).not.toContain("Starter gallery");
  });
});
