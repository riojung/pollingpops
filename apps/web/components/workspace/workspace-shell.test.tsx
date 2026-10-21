import type { ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../locale-provider";
import { englishMessages } from "../../lib/i18n/catalog";
import { workspacePageEnglishMessages } from "../../lib/i18n/domains/workspace-pages";
import germanWorkspacePageMessages from "../../lib/i18n/domains/workspace-pages/de-DE";
import germanMessages from "../../lib/i18n/messages/de-DE";

const fixtures = vi.hoisted(() => ({
  captureEffects: false,
  effects: [] as Array<() => void>,
  pathname: "/library",
  push: vi.fn(),
  replace: vi.fn(),
  workspace: {
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

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactModule>()),
  useEffect: (effect: () => void) => {
    if (fixtures.captureEffects) fixtures.effects.push(effect);
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => fixtures.pathname,
  useRouter: () => ({ push: fixtures.push, replace: fixtures.replace }),
}));

vi.mock("./workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => fixtures.workspace,
}));

import { WorkspaceFeatureGate, WorkspaceShell } from "./workspace-shell";

describe("professional workspace shell", () => {
  beforeEach(() => {
    fixtures.captureEffects = false;
    fixtures.effects = [];
    fixtures.pathname = "/library";
    fixtures.workspace.error = "";
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
    expect(markup).toContain(">Start</a>");
    expect(markup).toContain(">Ergebnisse</a>");
    expect(markup).toContain(">Arbeitsbereich</a>");
    expect(markup).toContain('aria-label="Darstellung: System"');
    expect(markup).toMatch(/<aside class="[^"]+" lang="de-DE">/);
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
