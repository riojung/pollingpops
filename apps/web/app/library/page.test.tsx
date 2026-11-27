import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import type * as ApiModule from "../../lib/api";
import { SURVEY_READER_HEADER } from "@openround/contracts/surveys";
import { LibraryDateRangeFields } from "../../components/workspace/library-discovery/library-date-range-fields";
import { SurveyLibraryCards } from "../../components/workspace/survey-library-cards";
import { surveyBranchingFixture } from "../../../../packages/contracts/test/support/survey-branching-fixture";

interface LibraryHooks {
  cursor: number;
  slots: unknown[];
  pendingEffects: Array<() => void>;
}

const fixtures = vi.hoisted(() => ({
  canEdit: true,
  presentationsEnabled: true,
  surveysEnabled: true,
  workspaceId: "",
  query: "",
  browserQuery: null as string | null,
  push: vi.fn(),
  replace: vi.fn(),
  replaceState: vi.fn(),
  apiFetch: vi.fn(),
  hooks: null as LibraryHooks | null,
  tree: null as ReactNode,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  const sameDeps = (
    previous: ReactModule.DependencyList | undefined,
    next: ReactModule.DependencyList | undefined,
  ) =>
    previous &&
    next &&
    previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]));
  const memo = <T,>(factory: () => T, deps: ReactModule.DependencyList | undefined) => {
    const hooks = fixtures.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as
      { deps: ReactModule.DependencyList | undefined; value: T } | undefined;
    if (!previous || !sameDeps(previous.deps, deps))
      hooks.slots[index] = { deps, value: factory() };
    return (hooks.slots[index] as { value: T }).value;
  };
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index] as T,
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useMemo: <T,>(factory: () => T, deps: ReactModule.DependencyList) =>
      fixtures.hooks ? memo(factory, deps) : react.useMemo(factory, deps),
    useCallback: <T,>(callback: T, deps: ReactModule.DependencyList) =>
      fixtures.hooks
        ? memo(() => callback, deps)
        : react.useCallback(callback as (...args: never[]) => unknown, deps),
    useEffect: (effect: ReactModule.EffectCallback, deps?: ReactModule.DependencyList) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useEffect(effect, deps);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { deps?: ReactModule.DependencyList; cleanup?: () => void } | undefined;
      if (previous && sameDeps(previous.deps, deps)) return;
      const slot: { deps?: ReactModule.DependencyList; cleanup?: () => void } = { deps };
      hooks.slots[index] = slot;
      hooks.pendingEffects.push(() => {
        previous?.cleanup?.();
        slot.cleanup = effect() || undefined;
      });
    },
  };
});

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));

vi.mock("../../components/locale-provider", async () => {
  const { englishMessages, translate } = await import("../../lib/i18n/catalog");
  const { workspacePageEnglishMessages } = await import("../../lib/i18n/domains/workspace-pages");
  const messages = { ...englishMessages, ...workspacePageEnglishMessages };
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    translate(messages, key, values);
  return {
    LocaleProvider: ({ children }: { children: ReactNode }) => children,
    useLocale: () => ({ locale: "en-CA", t }),
  };
});

vi.mock("next/navigation", () => {
  const router = { push: fixtures.push, replace: fixtures.replace };
  let previousQuery = "";
  let params = new URLSearchParams();
  return {
    usePathname: () => "/library",
    useRouter: () => router,
    useSearchParams: () => {
      if (fixtures.query !== previousQuery) {
        previousQuery = fixtures.query;
        params = new URLSearchParams(fixtures.query);
      }
      return params;
    },
  };
});

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: fixtures.canEdit,
    creator: { userId: "actor", role: "owner", workspaceId: fixtures.workspaceId },
    productFeatures: {
      builderV2: true,
      presentations: fixtures.presentationsEnabled,
      presentationRealtime: true,
      surveys: fixtures.surveysEnabled,
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
  }) => {
    fixtures.tree = children;
    return (
      <main>
        <h1>{title}</h1>
        <p>{description}</p>
        {actions}
        {children}
      </main>
    );
  },
}));

import LibraryPage from "./page";

describe("Library workspace", () => {
  beforeEach(() => {
    fixtures.canEdit = true;
    fixtures.presentationsEnabled = true;
    fixtures.surveysEnabled = true;
    fixtures.workspaceId = "";
    fixtures.query = "type=rounds";
    fixtures.browserQuery = null;
    fixtures.hooks = null;
    fixtures.tree = null;
    fixtures.apiFetch.mockReset();
    vi.unstubAllGlobals();
    fixtures.apiFetch.mockImplementation(async (path: string) => libraryResponse(path));
    fixtures.push.mockClear();
    fixtures.replace.mockReset();
    fixtures.replace.mockImplementation((href: string) => {
      fixtures.query = href.split("?")[1] ?? "";
    });
    fixtures.replaceState.mockReset();
    fixtures.replaceState.mockImplementation((_state: unknown, _title: string, href: URL) => {
      fixtures.query = href.searchParams.toString();
    });
  });

  it("defaults to All content with Discovery category links", () => {
    fixtures.query = "";
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));
    expect(markup).toContain('data-library-discovery=""');
    expect(markup).toContain('placeholder="Search all content"');
    expect(markup).toContain('href="/library?kind=round"');
    expect(markup).toContain('href="/library?kind=presentation"');
    expect(markup).toContain('href="/library?kind=survey"');
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain("Select all");
  });

  it.each([
    ["My workspace", ""],
    ["Shared with me", "&sort=title_asc&scope=shared"],
  ])("keeps all four category destinations in %s Discovery", (_scope, suffix) => {
    const escapedSuffix = suffix.replaceAll("&", "&amp;");
    for (const kind of ["round", "presentation", "survey"]) {
      fixtures.query = `kind=${kind}${suffix}`;
      const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));
      expect(markup).toContain('data-library-discovery=""');
      expect(markup).not.toContain('role="tablist"');
      expect(markup).toMatch(
        new RegExp(
          `<a(?=[^>]+href="/library\\?kind=${kind}${escapedSuffix}")(?=[^>]+aria-current="page")[^>]*>`,
        ),
      );
    }
    fixtures.query = suffix.slice(1);
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));
    expect(markup).toContain('data-library-discovery=""');
    expect(markup).toMatch(/<a[^>]*aria-current="page"[^>]*>All content<\/a>/);
  });

  it("keeps category, search and sort when changing scopes and resets the previous scope's filters", () => {
    fixtures.query =
      "kind=survey&q=preparedness&sort=title_asc&status=archived&folder=unfiled&favorites=true";
    const workspace = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));
    expect(workspace).toMatch(
      /<a[^>]*href="\/library\?q=preparedness&amp;kind=survey&amp;sort=title_asc&amp;scope=shared"[^>]*>Shared with me<\/a>/,
    );

    fixtures.query =
      "scope=shared&type=surveys&q=preparedness&sort=title_asc&progress=done&permission=view&organizationId=00000000-0000-4000-8000-000000000001";
    const shared = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));
    expect(shared).toMatch(
      /<a[^>]*href="\/library\?q=preparedness&amp;kind=survey&amp;sort=title_asc"[^>]*>My workspace<\/a>/,
    );
    expect(shared).toContain('value="preparedness"');
  });

  it("preserves the explicit Round management route with search and creation actions", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    expect(markup).toContain("Library");
    expect(markup).toContain('role="tablist"');
    expect(markup).toMatch(/aria-selected="true"[^>]*id="rounds-tab"[^>]*role="tab"/);
    expect(markup).toContain('placeholder="Search rounds"');
    expect(markup).toContain('href="/create?product=round"');
    expect(markup).toContain("Create Round");
    expect(markup).toMatch(/<a[^>]*href="\/library\?kind=round"[^>]*>Back to Round library<\/a>/);
    expect(markup).toContain('href="/library/folders?type=rounds"');
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

  it.each(["organization", "shared", "managed"])(
    "passes header-search queries into the %s collection",
    (scope) => {
      fixtures.query = `scope=${scope}&type=surveys&q=preparedness`;
      const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));
      expect(markup).toContain('placeholder="Search shared content"');
      expect(markup).toContain('value="preparedness"');
    },
  );

  it("deep-links to Presentations with shared folder and favorite controls", () => {
    fixtures.query = "type=presentations&q=recovery";
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    expect(markup).toMatch(/aria-selected="true"[^>]*id="presentations-tab"[^>]*role="tab"/);
    expect(markup).toContain('placeholder="Search presentations"');
    expect(markup).toContain('value="recovery"');
    expect(markup).toContain('href="/create/presentation"');
    expect(markup).toContain("Create Presentation");
    expect(markup).toContain('href="/library/folders?type=presentations"');
    expect(markup).toMatch(
      /<a[^>]*href="\/library\?q=recovery&amp;kind=presentation"[^>]*>Back to Presentation library<\/a>/,
    );
    expect(markup).toContain("Manage folders");
  });
  it("includes Surveys as a first-class Library tab with the same filters and layouts", () => {
    fixtures.query = "type=surveys&q=training&status=published&favorites=true";
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));
    expect(markup).toMatch(/aria-selected="true"[^>]*id="surveys-tab"[^>]*role="tab"/);
    expect(markup).toContain('placeholder="Search surveys"');
    expect(markup).toContain('value="training"');
    expect(markup).toContain('href="/surveys/new"');
    expect(markup).toContain('href="/sessions?type=surveys"');
    expect(markup).toContain("Survey runs and results");
    expect(markup).toContain('href="/library/folders?type=surveys"');
    expect(markup).toContain('aria-label="Filter by folder"');
    expect(markup).toContain('aria-label="Grid view"');
    expect(markup).not.toContain("Browse Surveys");
  });

  it("hydrates deep-linked status and ownership filters", () => {
    fixtures.query = "type=rounds&status=archived&owner=workspace&folder=unfiled&favorites=true";
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    expect(markup).toMatch(/<option value="archived" selected="">Archived<\/option>/);
    expect(markup).toMatch(/<option value="workspace" selected="">Workspace-owned<\/option>/);
    expect(markup).toMatch(/<option value="unfiled" selected="">Unfiled<\/option>/);
    expect(markup).toContain('aria-pressed="true"');
  });

  it.each(["rounds", "presentations", "surveys"])(
    "shows and filters loaded %s by inclusive updated dates, and clears one bound at a time",
    async (type) => {
      fixtures.query = `type=${type}&dateFrom=2026-10-01&dateTo=2026-10-01`;
      const harness = libraryHarness();
      let markup = await harness.settle();

      expect(markup).toMatch(/Updated from<\/span><input[^>]+type="date"[^>]+value="2026-10-01"/);
      expect(markup).toMatch(/Updated to<\/span><input[^>]+type="date"[^>]+value="2026-10-01"/);
      expect(markup).toContain(`aria-label="Select ${type} filed"`);
      expect(markup).not.toContain(`aria-label="Select ${type} unfiled"`);
      expect(markup).toMatch(
        /href="\/library\?dateFrom=2026-10-01&amp;dateTo=2026-10-01"[^>]*>All content<\/a>/,
      );
      expect(markup).toContain(
        `href="/library/folders?type=${type}&amp;dateFrom=2026-10-01&amp;dateTo=2026-10-01"`,
      );

      const label = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(
        new Date("2026-10-01T00:00:00"),
      );
      clickButton(`Updated from ${label} ×`);
      markup = await harness.settle();

      expect(new URLSearchParams(fixtures.query).get("dateFrom")).toBeNull();
      expect(new URLSearchParams(fixtures.query).get("dateTo")).toBe("2026-10-01");
      expect(markup).toContain(`aria-label="Select ${type} filed"`);
      expect(markup).toContain(`aria-label="Select ${type} unfiled"`);
    },
  );

  it("keeps newer live filters through date URL updates and hydrates an external query", async () => {
    const initialQuery =
      "type=rounds&q=original&status=draft&owner=workspace&folder=rounds-child&favorites=true&sort=title_asc";
    fixtures.query = initialQuery;
    fixtures.browserQuery = initialQuery;
    fixtures.replaceState.mockImplementation((_state: unknown, _title: string, href: URL) => {
      fixtures.browserQuery = href.searchParams.toString();
    });
    const harness = libraryHarness();
    await harness.settle();

    changeDateRange({ dateFrom: "2026-10-01", dateTo: "" });
    const firstQuery = fixtures.browserQuery;
    harness.render();
    const search = elements(fixtures.tree).find(
      (candidate) => candidate.type === "input" && candidate.props.type === "search",
    );
    if (!search) throw new Error("Expected Library search input");
    const { onChange } = search.props as ComponentProps<"input">;
    onChange?.({ target: { value: "newer" } } as Parameters<NonNullable<typeof onChange>>[0]);
    changeField("Filter by status", "published");
    changeField("Filter by ownership", "all");
    changeField("Filter by folder", "unfiled");
    clickButton("Favorites ×");
    harness.render();

    changeDateRange({ dateFrom: "2026-10-01", dateTo: "2026-10-02" });
    const lastQuery = fixtures.browserQuery;
    expect(firstQuery).toBe(`${initialQuery}&dateFrom=2026-10-01`);
    expect(lastQuery).toBe(`${initialQuery}&dateFrom=2026-10-01&dateTo=2026-10-02`);
    for (const query of [firstQuery, lastQuery]) {
      if (query === null) throw new Error("Expected a date query in the browser URL");
      fixtures.query = query;
      const markup = await harness.settle();
      expect(markup).toContain('value="newer"');
      expect(field("Filter by status").value).toBe("published");
      expect(field("Filter by ownership").value).toBe("all");
      expect(field("Filter by folder").value).toBe("unfiled");
      expect(markup).not.toContain("Favorites ×");
      expect(markup).toMatch(/Updated to<\/span><input[^>]+value="2026-10-02"/);
    }

    fixtures.browserQuery = null;
    fixtures.query = `${initialQuery}&dateFrom=2026-10-03`;
    const markup = await harness.settle();
    expect(markup).toContain('value="original"');
    expect(field("Filter by status").value).toBe("draft");
    expect(field("Filter by ownership").value).toBe("workspace");
    expect(field("Filter by folder").value).toBe("rounds-child");
    expect(markup).toContain("Favorites ×");
    expect(markup).toMatch(/Updated from<\/span><input[^>]+value="2026-10-03"/);
  });

  it("retains Survey management while pausing new Survey creation", () => {
    fixtures.query = "type=surveys";
    fixtures.surveysEnabled = false;
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));
    expect(markup).toMatch(/aria-selected="true"[^>]*id="surveys-tab"[^>]*role="tab"/);
    expect(markup).toContain('href="/library/folders?type=surveys"');
    expect(markup).not.toContain('href="/surveys/new"');
  });

  it.each(["rounds", "presentations", "surveys"])(
    "links an empty %s Library to the matching template section",
    async (type) => {
      fixtures.query = `type=${type}`;
      fixtures.apiFetch.mockImplementation(async (path: string) => emptyLibraryResponse(path));
      const markup = await libraryHarness().settle();
      expect(markup).toContain(`href="/templates?type=${type}"`);
      expect(markup).toContain("Templates");
    },
  );

  it("keeps filtered and read-only Library empty states free of copy actions", async () => {
    fixtures.apiFetch.mockImplementation(async (path: string) => emptyLibraryResponse(path));
    fixtures.canEdit = false;
    let markup = await libraryHarness().settle();
    expect(markup).not.toContain('href="/templates?type=rounds"');
    fixtures.canEdit = true;
    fixtures.query = "type=rounds&q=missing";
    markup = await libraryHarness().settle();
    expect(markup).toContain("Clear filters");
    expect(markup).not.toContain('href="/templates?type=rounds"');
  });

  it("keeps a read-only Library discoverable without offering creation", () => {
    fixtures.canEdit = false;
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    expect(markup).toContain("Rounds");
    expect(markup).toContain('placeholder="Search rounds"');
    expect(markup).not.toContain("Create Round");
    expect(markup).not.toContain('href="/create?product=round"');
    expect(markup).toContain('href="/library/folders?type=rounds"');
  });

  it("keeps named type tabs and decorates each with its content kind", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    for (const [type, kind, name] of [
      ["rounds", "round", "Rounds"],
      ["presentations", "presentation", "Presentations"],
      ["surveys", "survey", "Surveys"],
    ]) {
      const tab = elements(fixtures.tree).find((candidate) => candidate.props.id === `${type}-tab`);
      expect(tab?.props["data-kind"]).toBe(kind);
      expect(tab?.props["aria-controls"]).toBe(`${type}-panel`);
      expect(elementText(tab?.props.children as ReactNode)).toBe(`${name} 0`);
    }
    expect(markup.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(3);
  });

  it.each([
    ["rounds", "round"],
    ["presentations", "presentation"],
    ["surveys", "survey"],
  ])("marks %s drafts without adding delivery actions", async (type, kind) => {
    fixtures.query = `type=${type}`;
    const markup = await libraryHarness().settle();

    expect(markup).toContain(`data-kind="${kind}" data-state-tone="warning"`);
    expect(markup).toContain('data-status="draft"');
    expect(markup).toContain('data-tone="draft"');
    expect(markup).toContain('data-action="edit"');
    expect(markup).toContain(`aria-label="Select ${type} filed"`);
    expect(markup).not.toContain('data-action="host"');
    expect(markup).not.toContain('data-action="assign"');
    expect(markup).not.toContain('data-action="resume"');
    expect(markup).not.toContain(">Share</a>");
  });

  it.each([
    ["rounds", "round"],
    ["presentations", "presentation"],
    ["surveys", "survey"],
  ])("preserves published %s labels and available actions", async (type, kind) => {
    fixtures.query = `type=${type}`;
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      libraryResponseWithStatus(path, "published"),
    );
    const markup = await libraryHarness().settle();

    expect(markup).toContain(`data-kind="${kind}" data-state-tone="positive"`);
    expect(markup).toContain('data-status="published"');
    expect(markup).toContain('data-tone="published"');
    expect(markup).toContain("Published");
    expect(markup).toContain('data-action="edit"');
    if (type === "rounds") {
      expect(markup).toMatch(/data-action="host"[^>]*href="\/host\/setup\/rounds-filed"/);
      expect(markup).toMatch(/data-action="assign"[^>]*href="\/quiz\/rounds-filed\/assign"/);
    } else if (type === "presentations") {
      expect(markup).toMatch(
        /data-action="host"[^>]*href="\/presentation\/presentations-filed\/host"/,
      );
      expect(markup).toContain('data-status="changed"');
      expect(markup).toContain('data-tone="changed"');
      expect(markup).toContain(
        'data-status="changed" data-tone="changed" data-state-tone="warning"',
      );
      expect(markup).toContain("Unpublished changes");
    } else {
      expect(markup).toContain(">Share</a>");
      expect(markup).toContain('href="/surveys/surveys-filed"');
      expect(markup).not.toContain('data-action="host"');
    }
    expect(markup).not.toContain('data-action="resume"');
  });

  it("negotiates conditional Survey reads and retains view and metadata actions without content mutations", async () => {
    fixtures.query = "type=surveys";
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      const response = libraryResponseWithStatus(path, "published");
      if (!("surveys" in response) || !response.surveys) return response;
      return {
        ...response,
        surveys: response.surveys.map((survey) => ({
          ...survey,
          draft: { ...surveyBranchingFixture(), title: survey.title },
        })),
      };
    });
    const harness = libraryHarness();
    let markup = await harness.settle();
    expect(fixtures.apiFetch).toHaveBeenCalledWith("/v1/surveys?limit=50", {
      headers: { [SURVEY_READER_HEADER]: "4" },
    });
    expect(markup).toContain('data-action="view"');
    expect(markup).toContain('href="/surveys/surveys-filed"');
    expect(markup).not.toContain('data-action="edit"');
    expect(markup).not.toContain(">Share</a>");
    expect(markup).not.toContain("Duplicate");
    expect(markup).toContain("Archive");
    const cards = elements(fixtures.tree).find((element) => element.type === SurveyLibraryCards);
    if (!cards) throw new Error("Expected Survey cards");
    (cards.props as ComponentProps<typeof SurveyLibraryCards>).onAction(
      "duplicate",
      "surveys-filed",
    );
    await harness.settle();
    expect(fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
    selectAll();
    markup = harness.render();
    expect(markup).not.toContain("Duplicate");
    expect(markup).toContain("Archive (2)");
    expect(markup).toContain('aria-label="Destination folder"');
  });

  it("copies only supported Surveys in a mixed bulk selection", async () => {
    fixtures.query = "type=surveys";
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      const response = libraryResponse(path);
      if (!("surveys" in response) || !response.surveys) return response;
      return {
        ...response,
        surveys: response.surveys.map((survey, index) => ({
          ...survey,
          draft: index === 0 ? { ...surveyBranchingFixture(), title: survey.title } : survey.draft,
        })),
      };
    });
    const harness = libraryHarness();
    await harness.settle();
    selectAll();
    const markup = harness.render();
    expect(markup).toContain("Duplicate (1)");
    expect(markup).toContain("Archive (2)");
    clickButton("Duplicate (1)");
    await harness.settle();
    const writes = fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toBe("/v1/surveys");
    expect(JSON.parse(writes[0]![1].body)).toMatchObject({ sourceId: "surveys-unfiled" });
  });

  it.each([
    ["rounds", "round"],
    ["presentations", "presentation"],
    ["surveys", "survey"],
  ])("preserves archived %s status and the existing View action", async (type, kind) => {
    fixtures.query = `type=${type}&status=archived`;
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      libraryResponseWithStatus(path, "archived"),
    );
    const markup = await libraryHarness().settle();

    expect(markup).toContain(`data-kind="${kind}" data-state-tone="neutral"`);
    expect(markup).toContain('data-status="archived"');
    expect(markup).toContain('data-tone="archived"');
    expect(markup).toContain('data-action="view"');
    expect(markup).toContain(">View</a>");
    expect(markup).not.toContain('data-action="edit"');
    expect(markup).not.toContain('data-action="host"');
    expect(markup).not.toContain('data-action="assign"');
    expect(markup).not.toContain("Unpublished changes");
  });

  it.each(["rounds", "presentations", "surveys"])(
    "keeps published %s delivery actions hidden for viewers",
    async (type) => {
      fixtures.query = `type=${type}`;
      fixtures.canEdit = false;
      fixtures.apiFetch.mockImplementation(async (path: string) =>
        libraryResponseWithStatus(path, "published"),
      );
      const markup = await libraryHarness().settle();

      expect(markup).toContain('data-action="view"');
      expect(markup).not.toContain('data-action="edit"');
      expect(markup).not.toContain('data-action="host"');
      expect(markup).not.toContain('data-action="assign"');
      expect(markup).not.toContain(">Share</a>");
    },
  );

  it.each([
    ["rounds", "round"],
    ["presentations", "presentation"],
    ["surveys", "survey"],
  ])("retains %s state and actions when switching to list view", async (type, kind) => {
    fixtures.query = `type=${type}`;
    const harness = libraryHarness();
    await harness.settle();
    const listButton = elements(fixtures.tree).find(
      (candidate) => candidate.type === "button" && candidate.props["aria-label"] === "List view",
    );
    expect(listButton).toBeDefined();
    (listButton!.props as ComponentProps<"button">).onClick?.(
      {} as Parameters<NonNullable<ComponentProps<"button">["onClick"]>>[0],
    );
    const markup = await harness.settle();

    expect(markup).toContain('data-view="list"');
    expect(markup).toContain('aria-label="List view" aria-pressed="true"');
    expect(markup).toContain(`data-kind="${kind}" data-state-tone="warning"`);
    expect(markup).toContain('data-status="draft"');
    expect(markup).toContain('data-action="edit"');
  });

  it.each(["rounds", "presentations", "surveys"])(
    "loads only %s folders into the filter and bulk destination with full paths",
    async (type) => {
      fixtures.query = `type=${type}&folder=${type}-child`;
      const harness = libraryHarness();
      let markup = await harness.settle();

      for (const artifactType of ["round", "presentation", "survey"]) {
        expect(fixtures.apiFetch).toHaveBeenCalledWith(`/v1/folders?artifactType=${artifactType}`);
      }
      expect(field("Filter by folder").value).toBe(`${type}-child`);
      expect(options(field("Filter by folder"))).toEqual([
        ["all", "All folders"],
        ["unfiled", "Unfiled"],
        [`${type}-root`, `${type} collection`],
        [`${type}-child`, `${type} collection / Shared name`],
      ]);
      expect(markup).toContain(`${type} filed`);
      expect(markup).not.toContain(`${type} unfiled`);

      selectAll();
      harness.render();
      expect(options(field("Destination folder"))).toEqual([
        ["unfiled", "Unfiled"],
        [`${type}-root`, `${type} collection`],
        [`${type}-child`, `${type} collection / Shared name`],
      ]);
      changeField("Filter by folder", "all");
      markup = await harness.settle();
      expect(markup).toContain(`${type} unfiled`);
    },
  );

  it("clears folder, destination, and item selection when switching types, while retaining other filters", async () => {
    fixtures.query =
      "type=rounds&folder=rounds-child&q=filed&status=draft&owner=workspace&favorites=true&dateFrom=2026-10-01&dateTo=2026-10-02";
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path === "/v1/library/favorites"
        ? {
            favorites: [
              { artifactType: "round", artifactId: "rounds-filed" },
              { artifactType: "presentation", artifactId: "presentations-filed" },
            ],
          }
        : libraryResponse(path),
    );
    const harness = libraryHarness();
    await harness.settle();
    selectAll();
    harness.render();
    changeField("Destination folder", "rounds-child");
    harness.render();
    clickTab("presentations");
    const markup = await harness.settle();

    expect(field("Filter by folder").value).toBe("all");
    expect(markup).not.toContain('aria-label="Destination folder"');
    expect(markup).toContain("presentations filed");
    expect(markup).toContain('value="filed"');
    expect(markup).toContain('aria-pressed="true"');
    expect(new URLSearchParams(fixtures.query).get("folder")).toBeNull();
    expect(new URLSearchParams(fixtures.query).get("status")).toBe("draft");
    expect(new URLSearchParams(fixtures.query).get("owner")).toBe("workspace");
    expect(new URLSearchParams(fixtures.query).get("dateFrom")).toBe("2026-10-01");
    expect(new URLSearchParams(fixtures.query).get("dateTo")).toBe("2026-10-02");
    selectAll();
    harness.render();
    expect(field("Destination folder").value).toBe("unfiled");
  });

  it("resets a folder deep-link from a different artifact type after scoped folders load", async () => {
    fixtures.query = "type=surveys&folder=rounds-child";
    const harness = libraryHarness();
    const markup = await harness.settle();

    expect(field("Filter by folder").value).toBe("all");
    expect(markup).toContain("surveys filed");
    expect(markup).toContain("surveys unfiled");
  });

  it("uses the requested typed folder when navigating directly to another Library type", async () => {
    const harness = libraryHarness();
    await harness.settle();
    selectAll();
    harness.render();
    fixtures.query = "type=surveys&folder=surveys-child";
    const markup = await harness.settle();

    expect(field("Filter by folder").value).toBe("surveys-child");
    expect(markup).toContain("surveys filed");
    expect(markup).not.toContain("surveys unfiled");
    expect(markup).not.toContain('aria-label="Destination folder"');
  });

  it("omits cached tags and keeps a pending Round folder move scoped after a type switch", async () => {
    const request = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "PATCH" ? request.promise : Promise.resolve(libraryResponse(path)),
    );
    const harness = libraryHarness();
    await harness.settle();
    selectAll();
    harness.render();
    changeField("Destination folder", "rounds-child");
    harness.render();
    clickButton("Move");
    expect(fixtures.apiFetch).toHaveBeenCalledWith("/v1/quizzes/rounds-filed/organization", {
      method: "PATCH",
      body: JSON.stringify({ folderId: "rounds-child" }),
    });
    clickTab("surveys");
    await harness.settle();
    selectAll();
    harness.render();
    request.resolve({});
    const markup = await harness.settle();

    expect(markup).toContain("2 selected");
    expect(markup).not.toContain("items moved to");
    expect(field("Destination folder").value).toBe("unfiled");
    expect(
      fixtures.apiFetch.mock.calls
        .filter((call) => call[1]?.method === "PATCH")
        .every((call) => String(call[0]).startsWith("/v1/quizzes/")),
    ).toBe(true);
  });

  it("does not clear a new type's selection when an earlier bulk action finishes", async () => {
    const request = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "POST" ? request.promise : Promise.resolve(libraryResponse(path)),
    );
    const harness = libraryHarness();
    await harness.settle();
    selectAll();
    harness.render();
    clickButton("Archive (2)");
    clickTab("presentations");
    await harness.settle();
    selectAll();
    harness.render();
    request.resolve({});
    const markup = await harness.settle();

    expect(markup).toContain("2 selected");
    expect(markup).not.toContain("Rounds Archive.");
  });

  it("ignores an older refresh when Presentation availability changes during folder loading", async () => {
    const stale = deferred<unknown>();
    let roundReads = 0;
    fixtures.apiFetch.mockImplementation((path: string) => {
      if (path === "/v1/folders?artifactType=round" && roundReads++ === 0) return stale.promise;
      return Promise.resolve(libraryResponse(path));
    });
    const harness = libraryHarness();
    harness.render();
    harness.flushEffects();
    fixtures.presentationsEnabled = false;
    await harness.settle();
    stale.resolve({
      folders: [
        { id: "stale", name: "Stale folder", artifactType: "round", parentId: null, position: 0 },
      ],
    });
    const markup = await harness.settle();

    expect(markup).not.toContain("Stale folder");
    expect(options(field("Filter by folder"))).toContainEqual([
      "rounds-child",
      "rounds collection / Shared name",
    ]);
    expect(markup).not.toContain('id="presentations-tab"');
  });

  it("immediately hides old workspace folders and selections while the new workspace loads", async () => {
    fixtures.workspaceId = "first-workspace";
    const harness = libraryHarness();
    await harness.settle();
    selectAll();
    harness.render();
    changeField("Destination folder", "rounds-child");
    harness.render();
    const nextFolders = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === "/v1/folders?artifactType=round"
        ? nextFolders.promise
        : Promise.resolve(libraryResponse(path)),
    );
    fixtures.workspaceId = "second-workspace";
    const pendingMarkup = harness.render();

    expect(options(field("Filter by folder"))).toEqual([
      ["all", "All folders"],
      ["unfiled", "Unfiled"],
    ]);
    expect(pendingMarkup).not.toContain('aria-label="Destination folder"');
    expect(pendingMarkup).toContain('aria-label="Loading Library"');
    harness.flushEffects();
    nextFolders.resolve({
      folders: [
        {
          id: "new-folder",
          name: "New workspace folder",
          artifactType: "round",
          parentId: null,
          position: 0,
        },
      ],
    });
    const markup = await harness.settle();

    expect(options(field("Filter by folder"))).toContainEqual([
      "new-folder",
      "New workspace folder",
    ]);
    expect(markup).not.toContain("rounds collection");
    expect(markup).not.toContain('aria-label="Destination folder"');
  });

  it.each(["rounds", "presentations", "surveys"])(
    "keeps loaded %s folders readable for viewers without bulk mutations",
    async (type) => {
      fixtures.canEdit = false;
      fixtures.query = `type=${type}`;
      const harness = libraryHarness();
      const markup = await harness.settle();

      expect(markup).toContain(`href="/library/folders?type=${type}"`);
      expect(markup).toContain(`${type} collection / Shared name`);
      expect(markup).not.toContain('aria-label="Destination folder"');
      expect(markup).not.toContain("Select all");
    },
  );
});

function libraryResponse(path: string) {
  const common = {
    workspaceId: "workspace",
    status: "draft",
    description: "",
    currentVersionId: null,
  };
  if (path.startsWith("/v1/folders?")) {
    const artifactType = new URLSearchParams(path.split("?")[1]).get("artifactType");
    const type =
      artifactType === "round"
        ? "rounds"
        : artifactType === "presentation"
          ? "presentations"
          : "surveys";
    return {
      folders: [
        {
          id: `${type}-child`,
          name: "Shared name",
          artifactType,
          parentId: `${type}-root`,
          position: 0,
        },
        {
          id: `${type}-root`,
          name: `${type} collection`,
          artifactType,
          parentId: null,
          position: 0,
        },
        {
          id: "wrong-type",
          name: "Wrong-type folder",
          artifactType: artifactType === "round" ? "survey" : "round",
          parentId: null,
          position: 1,
        },
      ],
    };
  }
  const records = (type: string) =>
    ["filed", "unfiled"].map((suffix) => ({
      ...common,
      id: `${type}-${suffix}`,
      title: `${type} ${suffix}`,
      folderId: suffix === "filed" ? `${type}-child` : null,
      updatedAt: new Date(
        suffix === "filed" ? "2026-10-01T23:59:59.999" : "2026-09-30T23:59:59.999",
      ).toISOString(),
    }));
  if (path.startsWith("/v1/quizzes?"))
    return {
      quizzes: records("rounds").map((row) => ({
        ...row,
        draft: { questions: [] },
        tags: ["topic"],
      })),
    };
  if (path.startsWith("/v1/presentations?"))
    return {
      presentations: records("presentations").map((row) => ({
        ...row,
        blockCount: 1,
        hasUnpublishedChanges: false,
      })),
    };
  if (path.startsWith("/v1/surveys?"))
    return {
      surveys: records("surveys").map((row) => ({
        ...row,
        draft: { title: row.title, description: "", items: [] },
        revision: 1,
        versionId: null,
      })),
      nextCursor: null,
    };
  if (path === "/v1/library/favorites") return { favorites: [] };
  return {};
}

function emptyLibraryResponse(path: string) {
  if (path.startsWith("/v1/quizzes?")) return { quizzes: [] };
  if (path.startsWith("/v1/presentations?")) return { presentations: [] };
  if (path.startsWith("/v1/surveys?")) return { surveys: [], nextCursor: null };
  return libraryResponse(path);
}

function libraryResponseWithStatus(path: string, status: "published" | "archived") {
  const response = libraryResponse(path);
  if ("quizzes" in response && response.quizzes) {
    return {
      ...response,
      quizzes: response.quizzes.map((row) => ({ ...row, status, currentVersionId: "version" })),
    };
  }
  if ("presentations" in response && response.presentations) {
    return {
      ...response,
      presentations: response.presentations.map((row) => ({
        ...row,
        status,
        currentVersionId: "version",
        hasUnpublishedChanges: true,
      })),
    };
  }
  if ("surveys" in response && response.surveys) {
    return {
      ...response,
      surveys: response.surveys.map((row) => ({ ...row, status, versionId: "version" })),
    };
  }
  return response;
}

// Exercise the page's callbacks and effect ordering without adding a browser test dependency.
function libraryHarness() {
  vi.stubGlobal("window", {
    location: {
      get href() {
        return `https://example.com/library${this.search}`;
      },
      get search() {
        return `?${fixtures.browserQuery ?? fixtures.query}`;
      },
    },
    history: { replaceState: fixtures.replaceState },
    localStorage: { getItem: () => null },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const hooks: LibraryHooks = { cursor: 0, slots: [], pendingEffects: [] };
  const render = () => {
    hooks.cursor = 0;
    fixtures.hooks = hooks;
    try {
      return renderToStaticMarkup(<LibraryPage />);
    } finally {
      fixtures.hooks = null;
    }
  };
  const flushEffects = () => hooks.pendingEffects.splice(0).forEach((effect) => effect());
  const settle = async () => {
    for (let index = 0; index < 12; index++) {
      render();
      flushEffects();
      await Promise.resolve();
    }
    return render();
  };
  return { render, flushEffects, settle };
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function elementText(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return elementText(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

function field(label: string): ComponentProps<"select"> {
  const element = elements(fixtures.tree).find(
    (candidate) => candidate.type === "select" && candidate.props["aria-label"] === label,
  );
  if (!element) throw new Error(`Expected select: ${label}`);
  return element.props as ComponentProps<"select">;
}

function options(select: ComponentProps<"select">) {
  return elements(select.children)
    .filter((candidate) => candidate.type === "option")
    .map((option) => [option.props.value, elementText(option.props.children as ReactNode)]);
}

function changeField(label: string, value: string) {
  field(label).onChange?.({ target: { value } } as Parameters<
    NonNullable<ComponentProps<"select">["onChange"]>
  >[0]);
}

function changeDateRange(range: ComponentProps<typeof LibraryDateRangeFields>["range"]) {
  const fields = elements(fixtures.tree).find(
    (candidate) => candidate.type === LibraryDateRangeFields,
  );
  if (!fields) throw new Error("Expected Library date fields");
  (fields.props as ComponentProps<typeof LibraryDateRangeFields>).onChange(range);
}

function selectAll() {
  const checkbox = elements(fixtures.tree).find(
    (candidate) => candidate.type === "input" && candidate.props.type === "checkbox",
  );
  if (!checkbox) throw new Error("Expected select all checkbox");
  (checkbox.props as ComponentProps<"input">).onChange?.(
    {} as Parameters<NonNullable<ComponentProps<"input">["onChange"]>>[0],
  );
}

function clickTab(type: string) {
  const tab = elements(fixtures.tree).find(
    (candidate) => candidate.type === "button" && candidate.props.id === `${type}-tab`,
  );
  if (!tab) throw new Error(`Expected tab: ${type}`);
  (tab.props as ComponentProps<"button">).onClick?.(
    {} as Parameters<NonNullable<ComponentProps<"button">["onClick"]>>[0],
  );
}

function clickButton(name: string) {
  const button = elements(fixtures.tree).find(
    (candidate) =>
      candidate.type === "button" && elementText(candidate.props.children as ReactNode) === name,
  );
  if (!button) throw new Error(`Expected button: ${name}`);
  (button.props as ComponentProps<"button">).onClick?.(
    {} as Parameters<NonNullable<ComponentProps<"button">["onClick"]>>[0],
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
