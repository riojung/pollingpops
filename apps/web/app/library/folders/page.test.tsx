import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderRecord } from "../../../lib/folders";
import { withEnglishLocale } from "../../../test-utils/english-locale";

const fixtures = vi.hoisted(() => ({
  canEdit: true,
  query: "",
  presentations: true,
  uxBeta: true,
  workspaceShell: true,
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/library/folders",
  useRouter: () => ({ replace: fixtures.replace }),
  useSearchParams: () => new URLSearchParams(fixtures.query),
}));

vi.mock("../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: { workspaceId: "workspace-one", role: fixtures.canEdit ? "editor" : "viewer" },
    canEdit: fixtures.canEdit,
    loading: false,
    productFeatures: {
      presentations: fixtures.presentations,
      uxBeta: fixtures.uxBeta,
      workspaceShell: fixtures.workspaceShell,
    },
  }),
}));

vi.mock("../../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({
    actions,
    children,
    description,
    title,
    requireBeta,
  }: {
    actions?: ReactNode;
    children: ReactNode;
    description: string;
    title: string;
    requireBeta?: boolean;
  }) => (
    <main data-require-beta={String(requireBeta)}>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
      {children}
    </main>
  ),
}));

import FoldersPage from "./page";
import { FolderTree } from "./folder-tree";

const folders: FolderRecord[] = [
  { id: "first", name: "First", artifactType: "round", parentId: null, position: 0 },
  { id: "last", name: "Last", artifactType: "round", parentId: null, position: 1 },
  { id: "child", name: "Nested", artifactType: "round", parentId: "first", position: 0 },
];

function treeMarkup(canEdit = true, busy = false) {
  return renderToStaticMarkup(
    withEnglishLocale(
      <FolderTree
        busy={busy}
        canEdit={canEdit}
        counts={new Map([["first", 2]])}
        folders={folders}
        onCommand={vi.fn()}
        onReorder={vi.fn()}
        onSelect={vi.fn()}
        selectedFolderId="child"
      />,
    ),
  );
}

describe("dedicated folder manager", () => {
  beforeEach(() => {
    fixtures.canEdit = true;
    fixtures.query = "";
    fixtures.presentations = true;
    fixtures.uxBeta = true;
    fixtures.workspaceShell = true;
    fixtures.replace.mockClear();
  });

  it.each(["rounds", "presentations", "surveys"])(
    "follows the %s Library content type and keeps the return link scoped",
    (type) => {
      fixtures.query = `type=${type}`;
      const markup = renderToStaticMarkup(withEnglishLocale(<FoldersPage />));
      expect(markup).toContain("<h1>Manage folders</h1>");
      expect(markup).toContain(`href="/library?type=${type}"`);
      expect(markup).toMatch(
        new RegExp(`aria-current="page"[^>]*href="/library/folders\\?type=${type}"`),
      );
      expect(markup).toContain("Folder name");
      expect(markup).toContain("Parent folder");
      expect(markup).toContain("Create folder");
      expect(markup).toContain('aria-busy="true"');
    },
  );

  it("keeps Round folder management available when the beta workspace is disabled", () => {
    fixtures.uxBeta = false;
    fixtures.workspaceShell = false;
    const markup = renderToStaticMarkup(withEnglishLocale(<FoldersPage />));
    expect(markup).toContain('data-require-beta="false"');
    expect(markup).toContain("Create folder");
  });

  it("guards a disabled Presentation type and defaults unknown types to Rounds", () => {
    fixtures.query = "type=presentations";
    fixtures.presentations = false;
    let markup = renderToStaticMarkup(withEnglishLocale(<FoldersPage />));
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/library\/folders\?type=rounds"/);
    expect(markup).not.toContain('href="/library/folders?type=presentations"');
    fixtures.query = "type=unknown";
    markup = renderToStaticMarkup(withEnglishLocale(<FoldersPage />));
    expect(markup).toContain('href="/library?type=rounds"');
  });

  it("offers viewers folder browsing without creation or mutation controls", () => {
    fixtures.canEdit = false;
    const markup = renderToStaticMarkup(withEnglishLocale(<FoldersPage />));
    expect(markup).toContain("An owner or editor can make changes.");
    expect(markup).toContain("Unfiled");
    expect(markup).not.toContain("Create folder");
    const tree = treeMarkup(false);
    expect(tree).toContain('aria-label="Open folder First / Nested 0"');
    expect(tree).not.toContain('aria-label="Rename');
    expect(tree).not.toContain('aria-label="Delete');
    expect(tree).not.toContain('aria-label="Move');
  });

  it("expresses nesting and scopes accessible actions to full folder paths", () => {
    const markup = treeMarkup();
    expect(markup).toMatch(/data-folder-id="first"[^]*?<ul[^]*?data-folder-id="child"/);
    expect(markup).toContain('aria-label="Open folder First / Nested 0" aria-pressed="true"');
    expect(markup).toContain('aria-label="Rename First / Nested"');
    expect(markup).toContain('aria-label="Move First / Nested"');
    expect(markup).toMatch(/aria-label="Move up: First" disabled=""/);
    expect(markup).not.toMatch(/aria-label="Move down: First" disabled=""/);
    expect(markup).toMatch(/aria-label="Move down: Last" disabled=""/);
    expect(markup).toMatch(/aria-label="Move down: First \/ Nested" disabled=""/);
  });

  it("disables folder selection and every mutation while an action is in flight", () => {
    const markup = treeMarkup(true, true);
    const buttons = markup.match(/<button[^>]*>/g)!;
    expect(buttons.length).toBe(18);
    expect(buttons.every((button) => button.includes('disabled=""'))).toBe(true);
  });
});
