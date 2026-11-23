import type { Entitlements, WorkspaceCapabilityUnavailableReason } from "@openround/contracts";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_URL } from "../../lib/api";
import type * as ApiModule from "../../lib/api";
import frenchMessages from "../../lib/i18n/domains/workspace-pages/fr-FR";

interface DashboardHooks {
  cursor: number;
  values: unknown[];
  effects: Array<() => void>;
}

const fixtures = vi.hoisted(() => ({
  hooks: null as DashboardHooks | null,
  locale: "en-CA" as "en-CA" | "fr-FR",
  request: vi.fn(),
  workspace: {
    loading: false,
    error: "",
    creator: null as { userId: string; workspaceId: string; role: "owner" | "viewer" } | null,
    entitlements: null as Pick<Entitlements, "csvExport" | "maxPublishedQuizzes" | "plan"> | null,
    csvExportUnavailableReason: undefined as WorkspaceCapabilityUnavailableReason | undefined,
    canEdit: false,
    productFeatures: { workspaceShell: true, uxBeta: false, builderV2: true },
    management: { user: null, organizationManagementEnabled: false },
  },
}));

vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.values)) {
        hooks.values[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
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
  useLocale: () => ({
    locale: fixtures.locale,
    t: (key: string) =>
      fixtures.locale === "fr-FR"
        ? (frenchMessages[key as keyof typeof frenchMessages] ?? key)
        : key,
  }),
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

function dashboardView() {
  const gate = DashboardPage().props.children as ReactElement;
  const dashboard = (gate.type as () => ReactElement)();
  const render = dashboard.type as () => ReactElement;
  const hooks: DashboardHooks = { cursor: 0, values: [], effects: [] };
  function renderTree() {
    hooks.cursor = 0;
    fixtures.hooks = hooks;
    try {
      return render();
    } finally {
      fixtures.hooks = null;
    }
  }
  return {
    render: () => renderToStaticMarkup(renderTree()),
    renderTree,
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
      const view = dashboardView();
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

const round = {
  id: "checkpoint-set",
  title: "Safety checkpoints",
  description: "",
  status: "published",
  draft: { questions: [] },
  currentVersionId: "version",
  folderId: null,
  tags: [],
  updatedAt: "2026-11-22T00:00:00.000Z",
  lastHostedAt: null,
};
const exportLabels = ["Export JSON", "Export CSV", "Export QTI 3"];
const noticePrefix = "pages.library.roundExport";
const planNotice = `${noticePrefix}PlanLimit`;
const operatorNotice = `${noticePrefix}OperatorPolicy`;
const genericNotice = `${noticePrefix}Unavailable`;
const reader = { userId: "actor", workspaceId: "workspace", role: "viewer" } as const;

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function exportButton(tree: ReactElement, label: string) {
  const button = elements(tree).find(
    (element) => element.type === "button" && element.props.children === label,
  );
  if (!button) throw new Error(`Expected ${label} button`);
  return button.props;
}

function loadExportDashboard({
  legacy,
  csvExport = false,
  reason,
  legacyReason = reason,
  accountScope = {},
  quizzes = [round],
}: {
  legacy: boolean;
  csvExport?: boolean;
  reason?: WorkspaceCapabilityUnavailableReason;
  legacyReason?: string;
  accountScope?: Partial<Record<"userId" | "workspaceId", string>>;
  quizzes?: (typeof round)[];
}) {
  const entitlements = { csvExport, maxPublishedQuizzes: null, plan: "pro" } as const;
  Object.assign(fixtures.workspace, {
    loading: false,
    error: "",
    creator: reader,
    canEdit: false,
    entitlements,
    csvExportUnavailableReason: reason,
    productFeatures: { workspaceShell: true, uxBeta: false, builderV2: !legacy },
  });
  fixtures.request.mockImplementation(async (path: string) => {
    if (path === "/v1/auth/me") {
      return {
        creator: { ...reader, ...accountScope, plan: "pro" },
        entitlements,
        csvExportUnavailableReason: legacyReason,
      };
    }
    return path.startsWith("/v1/folders") ? { folders: [] } : { quizzes };
  });

  const view = dashboardView();
  const initialMarkup = view.render();
  view.runEffects();
  return {
    ...view,
    initialMarkup,
    loadedMarkup: () =>
      vi.waitFor(() => {
        const markup = view.render();
        expect(markup).not.toMatch(/Loading (checkpoint sets|Rounds)/);
        return markup;
      }),
  };
}

describe("checkpoint set export availability", () => {
  beforeEach(() => {
    fixtures.locale = "en-CA";
    fixtures.request.mockReset();
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
  });

  afterEach(() => vi.unstubAllGlobals());

  describe.each([
    { name: "modern", legacy: false },
    { name: "legacy", legacy: true },
  ])("$name dashboard", ({ legacy }) => {
    it.each([
      { reason: "plan_limit", notice: planNotice },
      { reason: "operator_policy", notice: operatorNotice },
      { reason: undefined, notice: genericNotice },
    ] as const)("explains a confirmed viewer export lock ($reason)", async ({ reason, notice }) => {
      const view = loadExportDashboard({ legacy, reason });
      expect(view.initialMarkup).not.toContain(noticePrefix);
      const markup = await view.loadedMarkup();
      expect(markup).toContain(round.title);
      expect(markup).toContain(`href="/quiz/${round.id}/preview"`);
      expect(markup).toContain(notice);
      for (const label of exportLabels) expect(markup).not.toContain(label);

      fixtures.locale = "fr-FR";
      expect(view.render()).toContain(`class="notice" lang="fr-FR">${frenchMessages[notice]}</p>`);
    });

    it("keeps all export buttons enabled for a viewer with export access", async () => {
      const view = loadExportDashboard({ legacy, csvExport: true, reason: "operator_policy" });
      const markup = await view.loadedMarkup();
      expect(markup).toContain(round.title);
      expect(markup).not.toContain(noticePrefix);
      const tree = view.renderTree();
      for (const label of exportLabels) expect(exportButton(tree, label).disabled).toBeFalsy();
    });

    it("omits the export notice when no checkpoint sets are visible", async () => {
      const view = loadExportDashboard({ legacy, reason: "plan_limit", quizzes: [] });
      const markup = await view.loadedMarkup();
      expect(markup).not.toContain(round.title);
      expect(markup).not.toContain(noticePrefix);
    });

    it.each([
      { scope: {}, notice: operatorNotice },
      { scope: { actorId: "other-actor" }, notice: genericNotice },
      { scope: { workspaceId: "other-workspace" }, notice: genericNotice },
    ] as const)(
      "uses only a scoped reason from a late export denial ($scope)",
      async ({ scope, notice }) => {
        const fetch = vi.fn().mockResolvedValue(
          Response.json(
            {
              error: {
                code: "ENTITLEMENT_LIMIT",
                message: "Export denied",
                details: {
                  actorId: reader.userId,
                  workspaceId: reader.workspaceId,
                  unavailableReason: "operator_policy",
                  ...scope,
                },
              },
            },
            { status: 402 },
          ),
        );
        vi.stubGlobal("fetch", fetch);
        const view = loadExportDashboard({ legacy, csvExport: true });
        await view.loadedMarkup();
        (exportButton(view.renderTree(), "Export CSV").onClick as () => void)();

        expect(fetch).toHaveBeenCalledExactlyOnceWith(
          `${API_URL}/v1/quizzes/${round.id}/export.csv?expectedWorkspaceId=${reader.workspaceId}`,
          { credentials: "include" },
        );
        await vi.waitFor(() => {
          expect(view.render()).toContain(`>${notice}</p>`);
        });

        fixtures.locale = "fr-FR";
        const translatedMarkup = view.render();
        expect(translatedMarkup).toContain(
          `role="alert" lang="fr-FR">${frenchMessages[notice]}</p>`,
        );
        expect(translatedMarkup).not.toContain(notice);
      },
    );
  });

  it("uses the generic notice for a future reason in the legacy account response", async () => {
    const view = loadExportDashboard({ legacy: true, legacyReason: "future_reason" });
    expect(await view.loadedMarkup()).toContain(genericNotice);
  });

  it.each([
    { accountScope: { userId: "other-actor" }, csvExport: false },
    { accountScope: { workspaceId: "other-workspace" }, csvExport: false },
    { accountScope: { userId: "other-actor" }, csvExport: true },
    { accountScope: { workspaceId: "other-workspace" }, csvExport: true },
  ])("ignores export access from an unmatched legacy account (%j)", async (options) => {
    const view = loadExportDashboard({ legacy: true, reason: "operator_policy", ...options });
    const markup = await view.loadedMarkup();
    expect(markup).toContain(round.title);
    expect(markup).not.toContain(noticePrefix);
    for (const label of exportLabels) expect(markup).not.toContain(label);
  });
});
