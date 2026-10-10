import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  query: "",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: fixtures.push }),
  useSearchParams: () => new URLSearchParams(fixtures.query),
}));

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({ canEdit: true, entitlements: { csvExport: true } }),
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
  });

  it("asks for an activity type before offering starting methods", () => {
    const markup = renderToStaticMarkup(<CreatePage />);

    expect(markup).toContain("What would you like to create?");
    expect(markup).toContain('href="/create?type=quiz"');
    expect(markup).toContain('href="/create?type=poll"');
    expect(markup).toContain('href="/surveys/new"');
    expect(markup).toContain('href="/create?type=custom"');
    expect(markup).toContain("at their own pace");
    expect(markup).not.toContain("Source authoring workflow");
    expect(markup).not.toContain("Structured import workflow");
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
