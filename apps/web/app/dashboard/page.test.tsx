import type { ReactElement, ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";

interface DashboardHooks {
  cursor: number;
  values: unknown[];
  effects: Array<() => void>;
}

const fixtures = vi.hoisted(() => ({
  hooks: null as DashboardHooks | null,
  request: vi.fn(),
  workspace: {
    loading: false,
    error: "",
    creator: null as { userId: string; workspaceId: string; role: "owner" } | null,
    entitlements: null,
    canEdit: false,
    productFeatures: { workspaceShell: true, uxBeta: false, builderV2: true },
    management: { user: null, organizationManagementEnabled: false },
  },
}));

vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = initial;
      return [hooks.values[index] as T, (update: T) => (hooks.values[index] = update)];
    },
    useEffect: ((effect, dependencies) => {
      if (fixtures.hooks) fixtures.hooks.effects.push(effect);
      else react.useEffect(effect, dependencies);
    }) satisfies typeof react.useEffect,
    useCallback: ((callback, dependencies) =>
      fixtures.hooks
        ? callback
        : react.useCallback(callback, dependencies)) satisfies typeof react.useCallback,
  };
});

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
vi.mock("../../components/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: fixtures.request,
}));
vi.mock("../../components/authoring-assistant", () => ({ AuthoringAssistant: () => null }));
vi.mock("../../components/checkpoint-set-import", () => ({
  CheckpointSetImport: ({ unavailableReason }: { unavailableReason?: string }) => (
    <div data-import-unavailable-reason={unavailableReason}>Checkpoint set import panel</div>
  ),
}));

import DashboardPage from "./page";

function legacyDashboardView() {
  const gate = DashboardPage().props.children as ReactElement;
  const dashboard = (gate.type as () => ReactElement)();
  const render = dashboard.type as () => ReactElement;
  const hooks: DashboardHooks = { cursor: 0, values: [], effects: [] };
  return {
    render() {
      hooks.cursor = 0;
      fixtures.hooks = hooks;
      let tree: ReactElement;
      try {
        tree = render();
      } finally {
        fixtures.hooks = null;
      }
      return renderToStaticMarkup(tree);
    },
    runEffects() {
      hooks.effects.splice(0).forEach((effect) => effect());
    },
  };
}

describe("legacy dashboard compatibility", () => {
  beforeEach(() => {
    fixtures.workspace.creator = null;
    fixtures.workspace.canEdit = false;
    fixtures.workspace.loading = false;
    fixtures.workspace.error = "";
    fixtures.workspace.productFeatures = { workspaceShell: true, uxBeta: false, builderV2: true };
    fixtures.request.mockReset();
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

  it.each([
    {
      userId: "actor",
      workspaceId: "workspace",
      csvExport: false,
      reason: "operator_policy",
      expected: "operator_policy",
    },
    {
      userId: "other-actor",
      workspaceId: "workspace",
      csvExport: false,
      reason: "operator_policy",
    },
    {
      userId: "actor",
      workspaceId: "other-workspace",
      csvExport: false,
      reason: "operator_policy",
    },
    { userId: "actor", workspaceId: "workspace", csvExport: true, reason: "operator_policy" },
    { userId: "actor", workspaceId: "workspace", csvExport: false, reason: "unknown_reason" },
    { userId: "actor", workspaceId: "workspace", csvExport: false, reason: undefined },
  ])(
    "uses only a known denial in the matching legacy dashboard account (%j)",
    async ({ userId, workspaceId, csvExport, reason, expected }) => {
      fixtures.workspace.productFeatures.builderV2 = false;
      fixtures.workspace.canEdit = true;
      fixtures.workspace.creator = { userId: "actor", workspaceId: "workspace", role: "owner" };
      fixtures.request.mockImplementation(async (path: string) => {
        if (path === "/v1/auth/me") {
          return {
            creator: { userId, workspaceId, role: "owner", plan: "pro" },
            entitlements: { csvExport, maxPublishedQuizzes: null, plan: "pro" },
            checkpointSetImportUnavailableReason: reason,
          };
        }
        return path.startsWith("/v1/folders") ? { folders: [] } : { quizzes: [] };
      });
      const view = legacyDashboardView();
      view.render();
      view.runEffects();
      await vi.waitFor(() => {
        const markup = view.render();
        expect(markup).toContain("Checkpoint set import panel");
        if (expected) expect(markup).toContain(`data-import-unavailable-reason="${expected}"`);
        else expect(markup).not.toContain("data-import-unavailable-reason");
      });
    },
  );

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
