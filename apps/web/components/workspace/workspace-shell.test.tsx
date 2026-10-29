import type { ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAccountContext } from "./workspace-provider";
import type { ManagementNavigationState } from "../management-navigation";
import { LocaleProvider } from "../locale-provider";
import { englishMessages } from "../../lib/i18n/catalog";
import { workspacePageEnglishMessages } from "../../lib/i18n/domains/workspace-pages";
import germanWorkspacePageMessages from "../../lib/i18n/domains/workspace-pages/de-DE";
import germanMessages from "../../lib/i18n/messages/de-DE";

const fixtures = vi.hoisted(() => ({
  captureEffects: false,
  effects: [] as Array<() => void>,
  collapsedOverride: undefined as boolean | undefined,
  sidebarStateReads: 0,
  setSidebarCollapsed: vi.fn(),
  pathname: "/library",
  push: vi.fn(),
  replace: vi.fn(),
  workspace: {
    management: null as ManagementNavigationState | null,
    workspace: null as WorkspaceAccountContext | null,
    entitlements: null as { plan: "free" | "pro" | "team" } | null,
    creator: {
      userId: "user-1",
      workspaceId: "workspace-1",
      email: "owner@example.com",
      locale: "en-CA" as const,
      localePreferenceSet: true,
      segment: "workplace" as const,
      role: "owner" as const,
      plan: "pro" as const,
    },
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
      ideaBoards: false,
    },
    loading: false,
    error: "",
    canEdit: true,
    signOut: vi.fn(),
    startUpgrade: vi.fn(),
    refreshAccount: vi.fn(async () => undefined),
  },
}));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof ReactModule>();
  return {
    ...original,
    useState: (initial: unknown) => {
      if (
        fixtures.collapsedOverride !== undefined &&
        initial === false &&
        fixtures.sidebarStateReads++ === 0
      )
        return [fixtures.collapsedOverride, fixtures.setSidebarCollapsed];
      return original.useState(initial);
    },
    useEffect: (effect: () => void) => {
      if (fixtures.captureEffects) fixtures.effects.push(effect);
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => fixtures.pathname,
  useRouter: () => ({ push: fixtures.push, replace: fixtures.replace }),
}));

vi.mock("./workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => fixtures.workspace,
}));

import {
  SIDEBAR_PREFERENCE_KEY,
  readSidebarCollapsed,
  saveSidebarCollapsed,
  WorkspaceFeatureGate,
  WorkspaceShell,
  WorkspaceManagementRail,
} from "./workspace-shell";

afterEach(() => vi.unstubAllGlobals());

describe("desktop sidebar preference", () => {
  it("defaults to expanded and only restores the explicit collapsed value", () => {
    expect(readSidebarCollapsed()).toBe(false);
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    expect(readSidebarCollapsed()).toBe(false);
    saveSidebarCollapsed(true);
    expect(values.get(SIDEBAR_PREFERENCE_KEY)).toBe("true");
    expect(readSidebarCollapsed()).toBe(true);
    saveSidebarCollapsed(false);
    expect(readSidebarCollapsed()).toBe(false);
    values.set(SIDEBAR_PREFERENCE_KEY, "invalid");
    expect(readSidebarCollapsed()).toBe(false);
  });

  it("keeps navigation usable when browser storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("Blocked");
      },
    });
    expect(readSidebarCollapsed()).toBe(false);
    expect(() => saveSidebarCollapsed(true)).not.toThrow();
  });
});

describe("professional workspace shell", () => {
  beforeEach(() => {
    fixtures.captureEffects = false;
    fixtures.effects = [];
    fixtures.collapsedOverride = undefined;
    fixtures.sidebarStateReads = 0;
    fixtures.workspace.management = null;
    fixtures.pathname = "/library";
    fixtures.workspace.error = "";
    fixtures.workspace.workspace = null;
    fixtures.workspace.entitlements = null;
    fixtures.workspace.refreshAccount.mockClear();
    fixtures.workspace.canEdit = true;
    fixtures.workspace.productFeatures.uxBeta = true;
    fixtures.workspace.productFeatures.workspaceShell = true;
    fixtures.workspace.productFeatures.builderV2 = true;
    fixtures.workspace.productFeatures.presentations = true;
    fixtures.workspace.productFeatures.presentationRealtime = true;
    fixtures.workspace.productFeatures.groups = true;
    fixtures.workspace.productFeatures.discover = true;
    fixtures.workspace.productFeatures.ideaBoards = false;
    fixtures.push.mockClear();
    fixtures.replace.mockClear();
  });

  it("exposes an expanded desktop sidebar with an explicitly named collapse control", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Library">
        <p>Content</p>
      </WorkspaceShell>,
    );
    const sidebar = markup.match(/<aside[^]*?<\/aside>/)?.[0] ?? "";
    expect(sidebar).toContain('data-collapsed="false"');
    expect(sidebar).toContain('aria-label="Workspace sidebar"');
    expect(sidebar).toContain('aria-expanded="true"');
    expect(sidebar).toContain('aria-label="Collapse navigation"');
    expect(sidebar).toContain('aria-controls="workspace-sidebar-navigation"');
    expect(sidebar).toContain('id="workspace-sidebar-navigation"');
    expect(sidebar).toContain("owner@example.com");
  });

  it("keeps names, active destinations, account and sign-out reachable in the compact rail", () => {
    fixtures.collapsedOverride = true;
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Library">
        <p>Content</p>
      </WorkspaceShell>,
    );
    const sidebar = markup.match(/<aside[^]*?<\/aside>/)?.[0] ?? "";
    expect(sidebar).toContain('data-collapsed="true"');
    expect(sidebar).toContain('aria-expanded="false"');
    expect(sidebar).toContain('aria-label="Expand navigation"');
    expect(sidebar).toMatch(/aria-current="page" aria-label="Library"[^>]*href="\/library"/);
    expect(sidebar).toContain('data-sidebar-hint="Library"');
    expect(sidebar).toContain('title="Library"');
    expect(sidebar).toContain(
      'aria-label="Open account and workspace settings: owner@example.com"',
    );
    expect(sidebar).toContain('aria-label="Sign out"');
    // Mobile remains a separate text navigation, without compact-only labelling.
    const mobile = markup.match(/<nav[^>]*aria-label="Workspace sections"[^]*?<\/nav>/)?.[0] ?? "";
    expect(mobile).toContain(">Library</a>");
    expect(mobile).not.toContain("data-sidebar-hint");
  });

  it.each(["owner", "admin", "billing", "member"] as const)(
    "preserves %s management permissions in the compact rail",
    (role) => {
      const navigation: ManagementNavigationState = {
        user: { userId: "user-1", email: "owner@example.com" },
        organizationManagementEnabled: true,
        organizations: [{ id: "company-1", name: "Company", role }],
        operatorConsoleOrigin: null,
        loading: false,
        error: "",
        refresh: async () => {},
      };
      const markup = renderToStaticMarkup(<WorkspaceManagementRail navigation={navigation} />);
      expect(markup).toContain('aria-label="Organization management"');
      expect(markup).toContain('aria-label="Organization"');
      expect(markup.includes('aria-label="Members"')).toBe(role === "owner" || role === "admin");
      expect(markup.includes('aria-label="Billing"')).toBe(role !== "member");
      expect(markup.includes('aria-label="Event credits"')).toBe(role !== "member");
      expect(markup.includes('aria-label="Organization settings"')).toBe(
        role === "owner" || role === "admin",
      );
      expect(
        renderToStaticMarkup(
          <WorkspaceManagementRail
            navigation={{ ...navigation, organizationManagementEnabled: false }}
          />,
        ),
      ).toBe("");
    },
  );

  it.each([
    ["/activity", "/activity"],
    ["/help/getting-started", "/help"],
    ["/account", "/account"],
  ])("marks the current topbar destination for %s", (pathname, href) => {
    fixtures.pathname = pathname;
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Workspace">
        <p>Content</p>
      </WorkspaceShell>,
    );
    const topbar = markup.match(/<header[^]*?<\/header>/)?.[0] ?? "";
    expect(topbar).toMatch(new RegExp(`aria-current="page"[^>]*href="${href}"`));
  });

  it("shows organization identity, the assigned user workspace and organization role", () => {
    fixtures.workspace.workspace = {
      id: "workspace-1",
      name: "Sales - Alex",
      accountType: "organization",
      licenseUnit: "user",
      planSource: "subscription",
      organization: { id: "org-1", name: "ABC Company", role: "admin" },
      permissions: {
        manageWorkspace: true,
        managePeople: true,
        manageBilling: true,
        manageIntegrations: true,
      },
    };
    fixtures.workspace.entitlements = { plan: "team" };
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Home">
        <p>Content</p>
      </WorkspaceShell>,
    );
    expect(markup).toContain("ABC Company");
    expect(markup).toContain("Sales - Alex");
    expect(markup).toContain("Administrator · Team plan");
    expect(markup).not.toContain("Workplace workspace");
  });

  it("identifies personal community access without implying a paid team organization", () => {
    fixtures.workspace.workspace = {
      id: "workspace-1",
      name: "Alex's workspace",
      accountType: "personal",
      licenseUnit: "workspace",
      planSource: "community",
      organization: null,
      permissions: {
        manageWorkspace: true,
        managePeople: true,
        manageBilling: true,
        manageIntegrations: true,
      },
    };
    fixtures.workspace.entitlements = { plan: "team" };
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Home">
        <p>Content</p>
      </WorkspaceShell>,
    );
    expect(markup).toContain("Alex&#x27;s workspace");
    expect(markup).toContain("Personal workspace");
    expect(markup).toContain("Owner · Community access");
    expect(markup).not.toContain("Team plan");
  });

  it("exposes the complete task navigation and marks Library current", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell description="Workspace test" title="Library">
        <p>Workspace content</p>
      </WorkspaceShell>,
    );

    for (const [href, label] of [
      ["/home", "Home"],
      ["/library", "Library"],
      ["/sessions", "Sessions"],
      ["/assignments", "Assignments"],
      ["/results", "Results"],
      ["/discover", "Discover"],
      ["/groups", "Groups"],
      ["/account", "Workspace"],
    ]) {
      expect(markup).toContain(`href="${href}"`);
      expect(markup).toContain(label);
    }
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/library"/);
    expect(markup.match(/class="brand" href="\/home"/g)).toHaveLength(2);
    expect(markup).toContain("Workspace content");
  });

  it("shows independently enabled boards in desktop and mobile navigation and hides new entry when paused", () => {
    fixtures.pathname = "/boards/example";
    fixtures.workspace.productFeatures.ideaBoards = true;
    fixtures.workspace.productFeatures.uxBeta = false;
    fixtures.workspace.productFeatures.workspaceShell = false;
    const enabled = renderToStaticMarkup(
      <WorkspaceShell requireBeta={false} title="Idea boards">
        <p>Existing boards</p>
      </WorkspaceShell>,
    );
    expect(enabled.match(/href="\/boards"/g)).toHaveLength(2);
    expect(enabled).toMatch(/aria-current="page"[^>]*href="\/boards"/);
    expect(enabled).toContain("Idea boards");
    fixtures.workspace.productFeatures.ideaBoards = false;
    const paused = renderToStaticMarkup(
      <WorkspaceShell requireBeta={false} title="Idea boards">
        <p>Existing boards remain readable</p>
      </WorkspaceShell>,
    );
    expect(paused).not.toContain('href="/boards"');
    expect(paused).toContain("Existing boards remain readable");
  });

  it("keeps search, activity, help, account, and both Create destinations global", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Home">
        <p>Home</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain('role="search"');
    expect(markup).toContain('placeholder="Search your library"');
    expect(markup).toContain('href="/activity"');
    expect(markup).toContain('href="/help"');
    expect(markup).toContain('aria-label="Open account and workspace settings"');
    expect(markup).toMatch(/<summary[^>]*class="[^"]*createButton[^"]*"[^>]*role="button"[^>]*>/);
    expect(markup).toContain('aria-label="EN: Language: English (Canada)"');
    expect(markup).toContain('aria-label="Interface language"');
    expect(markup).toContain('lang="en-CA" role="radio" tabindex="0"');
    for (const language of ["Français", "Deutsch", "日本語", "한국어", "简体中文", "繁體中文"]) {
      expect(markup).toContain(language);
    }
    expect(markup).toContain('aria-label="Appearance: System"');
    expect(markup).toMatch(/aria-label="Appearance: System"[^>]*role="button"/);
    expect(markup).toContain('aria-label="Interface appearance"');
    expect(markup).toContain('role="radio"');
    expect(markup).toMatch(
      /aria-label="Interface appearance"[^]*?aria-checked="true"[^>]*role="radio" tabindex="0"/,
    );
    expect(markup).toContain("Create new");
    expect(markup).toContain('href="/create"');
    expect(markup).toContain('href="/create/presentation"');
    expect(markup).toContain("Questions, diagnosis, rechecks, and practice");
  });

  it("renders workspace navigation and global controls from a non-English catalog", () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider
        initialDomains={["workspace-pages"]}
        initialLocale="de-DE"
        initialMessages={{
          ...englishMessages,
          ...workspacePageEnglishMessages,
          ...germanMessages,
          ...germanWorkspacePageMessages,
        }}
      >
        <WorkspaceShell
          description="Lokalisierter Arbeitsbereich"
          title="Bibliothek"
          translationLevel="header"
        >
          <p>Lokalisierter Inhalt</p>
        </WorkspaceShell>
      </LocaleProvider>,
    );

    expect(markup).toContain('aria-label="DE: Sprache: Deutsch"');
    expect(markup).toContain('aria-label="Sprache der Benutzeroberfläche"');
    expect(markup).toContain('placeholder="Bibliothek durchsuchen"');
    expect(markup).toContain("Neu erstellen");
    expect(markup).toContain("Abmelden");
    expect(markup).toContain("Inhaber · Tarif Pro");
    expect(markup).toContain(">Start</span></a>");
    expect(markup).toContain(">Ergebnisse</span></a>");
    expect(markup).toContain(">Arbeitsbereich</span></a>");
    expect(markup).toContain('aria-label="Darstellung: System"');
    expect(markup).toMatch(/<aside[^>]*lang="de-DE">/);
    expect(markup).toMatch(/<main class="[^"]+" id="main" lang="en-CA">/);
    expect(markup).toMatch(/<header class="[^"]+" lang="de-DE">/);
  });

  it("does not expose creation controls to a read-only member", () => {
    fixtures.workspace.canEdit = false;
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Library">
        <p>Read only</p>
      </WorkspaceShell>,
    );

    expect(markup).not.toContain("Create new");
    expect(markup).not.toContain('href="/create/presentation"');
    expect(markup).toContain("Read only");
  });

  it("removes independently disabled destinations and preserves the legacy Round fallback", () => {
    fixtures.workspace.productFeatures.builderV2 = false;
    fixtures.workspace.productFeatures.presentations = false;
    fixtures.workspace.productFeatures.groups = false;
    fixtures.workspace.productFeatures.discover = false;

    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Library">
        <p>Feature-gated workspace</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain('href="/dashboard"');
    expect(markup).not.toContain('href="/create/presentation"');
    expect(markup).not.toContain('href="/groups"');
    expect(markup).not.toContain('href="/discover"');
  });

  it("keeps explicitly non-beta surfaces available when the workspace shell rollout is off", () => {
    fixtures.workspace.productFeatures.uxBeta = false;
    fixtures.workspace.productFeatures.workspaceShell = false;

    const markup = renderToStaticMarkup(
      <WorkspaceShell requireBeta={false} title="Legacy Round workflow">
        <p>Legacy, account, practice, and assignment content</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain("Legacy, account, practice, and assignment content");
    expect(markup).not.toContain("Loading your workspace");
    expect(markup.match(/class="brand" href="\/dashboard"/g)).toHaveLength(2);
    expect(markup).not.toContain('class="brand" href="/home"');
  });

  it("keeps account failures on the modern route with an explicit retry action", () => {
    fixtures.workspace.error = "Workspace could not be loaded";
    fixtures.captureEffects = true;
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Home">
        <p>Workspace content</p>
      </WorkspaceShell>,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Workspace could not be loaded");
    expect(markup).toContain("Try again");
    expect(markup).not.toContain('href="/dashboard"');
    expect(markup).not.toContain("Workspace content");
    fixtures.effects.forEach((effect) => effect());
    expect(fixtures.replace).not.toHaveBeenCalled();
  });

  it.each([
    ["presentations", "/home"],
    ["builderV2", "/dashboard"],
  ] as const)(
    "falls back from disabled %s without losing the baseline workspace",
    (feature, destination) => {
      fixtures.workspace.productFeatures[feature] = false;
      fixtures.captureEffects = true;
      renderToStaticMarkup(
        <WorkspaceShell requiredFeature={feature} title="Unavailable feature">
          <p>Hidden</p>
        </WorkspaceShell>,
      );
      fixtures.effects.forEach((effect) => effect());
      expect(fixtures.replace).toHaveBeenCalledWith(destination);
    },
  );

  it("renders the core workspace without the UX beta rollout", () => {
    fixtures.workspace.productFeatures.uxBeta = false;
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Home">
        <p>Core workspace content</p>
      </WorkspaceShell>,
    );
    expect(markup).toContain("Core workspace content");
    expect(markup).not.toContain("Loading your workspace");
    expect(markup).toContain('class="brand" href="/home"');
  });

  it("continues to honor an explicitly disabled core workspace shell", () => {
    fixtures.workspace.productFeatures.workspaceShell = false;

    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Library">
        <p>Beta workspace content</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain("Loading your workspace");
    expect(markup).not.toContain("Beta workspace content");
  });

  it("fails closed on direct feature routes", () => {
    fixtures.workspace.productFeatures.presentations = false;
    const disabled = renderToStaticMarkup(
      <WorkspaceFeatureGate feature="presentations">
        <p>Presentation builder</p>
      </WorkspaceFeatureGate>,
    );
    expect(disabled).toContain("Loading your workspace");
    expect(disabled).not.toContain("Presentation builder");

    fixtures.workspace.productFeatures.presentations = true;
    const enabled = renderToStaticMarkup(
      <WorkspaceFeatureGate feature="presentations">
        <p>Presentation builder</p>
      </WorkspaceFeatureGate>,
    );
    expect(enabled).toContain("Presentation builder");
  });
});
