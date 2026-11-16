import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";

const fixtures = vi.hoisted(() => ({
  canEdit: true,
  creator: {
    userId: "user-1",
    workspaceId: "workspace-1",
    email: "owner@example.com",
    segment: "workplace" as const,
    role: "owner" as const,
    plan: "pro" as const,
  },
}));

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({ canEdit: fixtures.canEdit, creator: fixtures.creator }),
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({
    actions,
    children,
    description,
    eyebrow,
    title,
  }: {
    actions?: ReactNode;
    children: ReactNode;
    description: string;
    eyebrow: string;
    title: string;
  }) => (
    <main>
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
      {children}
    </main>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/groups",
}));

import GroupsPage from "./page";

describe("Groups workspace", () => {
  beforeEach(() => {
    fixtures.canEdit = true;
  });

  it("presents scope, purpose, role and lifecycle discovery before loading private details", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<GroupsPage />));

    expect(markup).toContain("Groups");
    expect(markup).toContain("All groups");
    expect(markup).toContain("My workspace");
    expect(markup).toContain("Organization");
    expect(markup).toContain("Purpose");
    expect(markup).toContain("My access");
    expect(markup).toContain("Status");
    expect(markup).toContain("Sort by");
    expect(markup).not.toContain("Create group");
    expect(markup).not.toContain("<dialog");
    expect(markup).toContain('placeholder="Search groups"');
    expect(markup).toContain('aria-label="Workspace groups"');
    expect(markup).toContain("Loading groups");
  });

  it("keeps read-only members inside the group workspace without offering creation", () => {
    fixtures.canEdit = false;
    const markup = renderToStaticMarkup(withEnglishLocale(<GroupsPage />));

    expect(markup).toContain("People &amp; collaboration");
    expect(markup).toContain('placeholder="Search groups"');
    expect(markup).not.toContain("Create group");
  });
});
