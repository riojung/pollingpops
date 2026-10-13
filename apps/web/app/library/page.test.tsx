import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import type * as ApiModule from "../../lib/api";

interface LibraryHooks {
  cursor: number;
  slots: unknown[];
  pendingEffects: Array<() => void>;
}

const fixtures = vi.hoisted(() => ({
  canEdit: true,
  presentationsEnabled: true,
  workspaceId: "",
  query: "",
  push: vi.fn(),
  replace: vi.fn(),
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
    creator: { role: "owner", workspaceId: fixtures.workspaceId },
    productFeatures: {
      builderV2: true,
      presentations: fixtures.presentationsEnabled,
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
    fixtures.workspaceId = "";
    fixtures.query = "";
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
  });

  it("defaults to the Round library with search, management, and creation actions", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    expect(markup).toContain("Library");
    expect(markup).toContain('role="tablist"');
    expect(markup).toMatch(/aria-selected="true"[^>]*role="tab"[^>]*>Rounds/);
    expect(markup).toContain('placeholder="Search rounds"');
    expect(markup).toContain('href="/create"');
    expect(markup).toContain("Create Round");
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

  it("deep-links to Presentations with shared folder and favorite controls", () => {
    fixtures.query = "type=presentations&q=recovery";
    const markup = renderToStaticMarkup(withEnglishLocale(<LibraryPage />));

    expect(markup).toMatch(/aria-selected="true"[^>]*role="tab"[^>]*>Presentations/);
    expect(markup).toContain('placeholder="Search presentations"');
    expect(markup).toContain('value="recovery"');
    expect(markup).toContain('href="/create/presentation"');
    expect(markup).toContain("Create Presentation");
    expect(markup).toContain('href="/library/folders?type=presentations"');
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
    expect(markup).toContain('href="/library/folders?type=surveys"');
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
    expect(markup).toContain('href="/library/folders?type=rounds"');
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
    fixtures.query = "folder=rounds-child&q=filed&status=draft&owner=workspace&favorites=true";
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
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
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
    updatedAt: "2026-10-01T00:00:00.000Z",
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

// Exercise the page's callbacks and effect ordering without adding a browser test dependency.
function libraryHarness() {
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
