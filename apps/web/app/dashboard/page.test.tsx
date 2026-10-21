import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  workspace: {
    loading: false,
    error: "",
    creator: null,
    entitlements: null,
    canEdit: false,
    productFeatures: { workspaceShell: true, uxBeta: false, builderV2: true },
    management: { user: null, organizationManagementEnabled: false },
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => fixtures.workspace,
}));
vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("../../components/management-navigation", () => ({
  ManagementNavigationLinks: () => null,
}));
vi.mock("../../components/authoring-assistant", () => ({ AuthoringAssistant: () => null }));
vi.mock("../../components/checkpoint-set-import", () => ({ CheckpointSetImport: () => null }));

import DashboardPage from "./page";

describe("legacy dashboard compatibility", () => {
  beforeEach(() => {
    fixtures.workspace.loading = false;
    fixtures.workspace.error = "";
    fixtures.workspace.productFeatures = { workspaceShell: true, uxBeta: false, builderV2: true };
  });

  it("uses the modern Round library without requiring UX beta", () => {
    const markup = renderToStaticMarkup(<DashboardPage />);
    expect(markup).toContain("<h1>Rounds</h1>");
    expect(markup).not.toContain("Your checkpoint sets");
  });

  it("preserves classic Round creation when the professional builder is disabled", () => {
    fixtures.workspace.productFeatures.builderV2 = false;
    const markup = renderToStaticMarkup(<DashboardPage />);
    expect(markup).toContain("Your checkpoint sets");
  });

  it("preserves the explicitly disabled workspace-shell fallback", () => {
    fixtures.workspace.productFeatures.workspaceShell = false;
    const markup = renderToStaticMarkup(<DashboardPage />);
    expect(markup).toContain("Your checkpoint sets");
  });

  it("does not choose classic authoring while account access is unresolved or failed", () => {
    fixtures.workspace.loading = true;
    expect(renderToStaticMarkup(<DashboardPage />)).not.toContain("Your checkpoint sets");
    fixtures.workspace.loading = false;
    fixtures.workspace.error = "Account unavailable";
    expect(renderToStaticMarkup(<DashboardPage />)).not.toContain("Your checkpoint sets");
    fixtures.workspace.error = "";
    Object.assign(fixtures.workspace, { productFeatures: null });
    expect(renderToStaticMarkup(<DashboardPage />)).not.toContain("Your checkpoint sets");
  });
});
