import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";

const fixtures = vi.hoisted(() => ({
  canEdit: true,
  query: "",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
  useRouter: () => ({ push: fixtures.push, replace: fixtures.replace }),
  useSearchParams: () => new URLSearchParams(fixtures.query),
}));

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: fixtures.canEdit,
    productFeatures: {
      builderV2: true,
      presentations: true,
      presentationRealtime: true,
      surveys: true,
    },
  }),
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({
    actions,
    children,
    description,
    title,
  }: {
    actions?: ReactNode;
    children: ReactNode;
    description: string;
    title: string;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
      {children}
    </main>
  ),
}));

import LibraryPage from "./page";

describe("Library workspace", () => {
  beforeEach(() => {
    fixtures.canEdit = true;
    fixtures.query = "";
    fixtures.push.mockClear();
    fixtures.replace.mockClear();
  });

  it("defaults to the Round library with search, management, and creation actions", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    expect(markup).toContain("Library");
    expect(markup).toContain('role="tablist"');
    expect(markup).toMatch(/aria-selected="true"[^>]*role="tab"[^>]*>Rounds/);
    expect(markup).toContain('placeholder="Search rounds"');
    expect(markup).toContain('href="/create"');
    expect(markup).toContain("Create Round");
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain('aria-label="Filter by status"');
    expect(markup).toContain('aria-label="Filter by ownership"');
    expect(markup).toContain('aria-label="Filter by folder"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain("Favorites");
    expect(markup).toContain('aria-label="Library layout"');
    expect(markup).toContain('aria-label="Grid view" aria-pressed="true"');
    expect(markup).toContain("Active");
    expect(markup).toContain("Workspace-owned");
    expect(markup).toContain('aria-label="Loading Library"');
  });

  it("deep-links to Presentations with shared folder and favorite controls", () => {
    fixtures.query = "type=presentations&q=recovery";
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    expect(markup).toMatch(/aria-selected="true"[^>]*role="tab"[^>]*>Presentations/);
    expect(markup).toContain('placeholder="Search presentations"');
    expect(markup).toContain('value="recovery"');
    expect(markup).toContain('href="/create/presentation"');
    expect(markup).toContain("Create Presentation");
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain("Manage folders");
  });
  it("includes Surveys as a first-class Library tab with the same filters and layouts", () => {
    fixtures.query = "type=surveys&q=training&status=published&favorites=true";
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));
    expect(markup).toMatch(/aria-selected="true"[^>]*role="tab"[^>]*>Surveys/);
    expect(markup).toContain('placeholder="Search surveys"');
    expect(markup).toContain('value="training"');
    expect(markup).toContain('href="/surveys/new"');
    expect(markup).toContain('href="/surveys/runs"');
    expect(markup).toContain('aria-label="Filter by folder"');
    expect(markup).toContain('aria-label="Grid view"');
    expect(markup).not.toContain("Browse Surveys");
  });

  it("hydrates deep-linked status and ownership filters", () => {
    fixtures.query = "status=archived&owner=workspace&folder=unfiled&favorites=true";
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    expect(markup).toMatch(/<option value="archived" selected="">Archived<\/option>/);
    expect(markup).toMatch(/<option value="workspace" selected="">Workspace-owned<\/option>/);
    expect(markup).toMatch(/<option value="unfiled" selected="">Unfiled<\/option>/);
    expect(markup).toContain('aria-pressed="true"');
  });

  it("keeps a read-only Library discoverable without offering creation", () => {
    fixtures.canEdit = false;
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    expect(markup).toContain("Rounds");
    expect(markup).toContain('placeholder="Search rounds"');
    expect(markup).not.toContain("Create Round");
    expect(markup).not.toContain('href="/create"');
  });
});
