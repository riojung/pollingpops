import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ query: "", canEdit: true, push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocked.push }),
  useSearchParams: () => new URLSearchParams(mocked.query),
}));
vi.mock("../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({ canEdit: mocked.canEdit }),
}));
vi.mock("../../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("../../../components/authoring-assistant", () => ({
  AuthoringAssistant: () => <div>Source authoring workflow</div>,
}));
vi.mock("../../../components/workspace/presentation-template-gallery", () => ({
  PresentationTemplateGallery: () => <div>Presentation template gallery</div>,
}));
vi.mock("../../../components/workspace/presentation-outline-start", () => ({
  PresentationOutlineStart: () => <div>Outline draft creation workflow</div>,
}));

import CreatePresentationPage from "./page";

beforeEach(() => {
  mocked.query = "";
  mocked.canEdit = true;
  vi.clearAllMocks();
});
describe("Presentation creation launcher", () => {
  it("offers outline, source, template and blank starting points without creating a draft on render", () => {
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain('href="/create/presentation?start=outline"');
    expect(markup).toContain('aria-label="From outline"');
    expect(markup).toContain('href="/create/presentation?start=source"');
    expect(markup).toContain('href="/create/presentation?start=template"');
    expect(markup).toContain("Start a blank presentation");
    expect(markup).not.toContain("Outline draft creation workflow");
    expect(mocked.push).not.toHaveBeenCalled();
  });
  it.each([
    ["outline", "Outline draft creation workflow"],
    ["source", "Source authoring workflow"],
    ["template", "Presentation template gallery"],
  ])("renders only the chosen %s workflow", (start, expected) => {
    mocked.query = `start=${start}`;
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain(expected);
    for (const other of [
      "Outline draft creation workflow",
      "Source authoring workflow",
      "Presentation template gallery",
    ].filter((value) => value !== expected))
      expect(markup).not.toContain(other);
    expect(markup).not.toContain('aria-label="From outline"');
  });
  it.each([
    "start=unknown",
    "start=outline&start=template",
    "start=outline&start=outline",
    "start=",
  ])("shows starting points for invalid query %s", (query) => {
    mocked.query = query;
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain('aria-label="From outline"');
    expect(markup).not.toContain("Outline draft creation workflow");
  });
  it("preserves read-only creation protection for direct outline links", () => {
    mocked.query = "start=outline";
    mocked.canEdit = false;
    const markup = renderToStaticMarkup(<CreatePresentationPage />);
    expect(markup).toContain("cannot create a new draft");
    expect(markup).not.toContain("Outline draft creation workflow");
    expect(markup).not.toContain('aria-label="From outline"');
  });
});
