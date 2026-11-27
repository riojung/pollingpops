import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Client from "./client";
import type { DiscoveryPage, WorkspaceLibraryItem } from "./client";
import { LibraryDiscovery, type LibraryManagementType } from "./library-discovery";
import { LibraryShareActions } from "../library-sharing/share-actions";
import { AUTH_CHANGE_EVENT } from "../../../lib/api";
import { SESSION_LOGOUT_EVENT } from "../../../lib/idle-session";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  list: vi.fn(),
  query: "",
  push: vi.fn(),
  workspaceId: "workspace-a",
  actor: "actor-a",
  role: "owner",
  orgRole: "member",
  loading: false,
  error: "",
  features: true,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useRef: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
  useState: <T,>(initial: T | (() => T)) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [
      hooks.slots[index],
      (next: T | ((current: T) => T)) => {
        hooks.slots[index] =
          typeof next === "function" ? (next as (current: T) => T)(hooks.slots[index] as T) : next;
      },
    ];
  },
  useEffect: (effect: ReactModule.EffectCallback, deps: ReactModule.DependencyList) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as
      { deps: ReactModule.DependencyList; cleanup?: () => void } | undefined;
    if (
      previous &&
      previous.deps.length === deps.length &&
      deps.every((value, offset) => Object.is(previous.deps[offset], value))
    )
      return;
    const slot: { deps: ReactModule.DependencyList; cleanup?: () => void } = { deps };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() || undefined;
    });
  },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocked.query),
  useRouter: () => ({ push: mocked.push }),
}));
vi.mock("../../locale-provider", async () => {
  const { englishMessages, translate } = await import("../../../lib/i18n/catalog");
  const { workspacePageEnglishMessages } =
    await import("../../../lib/i18n/domains/workspace-pages");
  const messages = { ...englishMessages, ...workspacePageEnglishMessages };
  return {
    useLocale: () => ({
      locale: "en-CA",
      t: (key: Parameters<typeof translate>[1]) => translate(messages, key),
    }),
  };
});
vi.mock("../workspace-provider", () => ({
  useWorkspace: () => ({
    creator: { userId: mocked.actor, workspaceId: mocked.workspaceId, role: mocked.role },
    workspace: {
      id: mocked.workspaceId,
      organization: { id: "org", role: mocked.orgRole },
      permissions: { managePeople: mocked.orgRole === "admin" },
    },
    management: { organizations: [{ id: "org", role: mocked.orgRole }] },
    canEdit: mocked.role !== "viewer",
    loading: mocked.loading,
    error: mocked.error,
    productFeatures: { presentations: mocked.features, surveys: mocked.features },
  }),
}));
vi.mock("../workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof Client>()),
  readLibraryDiscovery: mocked.list,
}));
const own = (
  title = "Readiness",
  artifactType: WorkspaceLibraryItem["artifactType"] = "round",
): WorkspaceLibraryItem => ({
  id: "same-id",
  artifactType,
  title,
  description: "Metadata description",
  status: "draft",
  updatedAt: "2026-11-17T12:00:00.000Z",
  favorite: false,
  folderId: null,
  currentVersionId: null,
  itemCount: 3,
});
const facets = {
  kinds: { round: 80, presentation: 40, survey: 20 },
  statuses: { draft: 90, published: 50, archived: 0 },
  total: 140,
};
const page = (title = "Readiness"): DiscoveryPage => ({
  items: [own(title)],
  nextCursor: "next",
  facets,
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function deferredPage() {
  let resolve!: (page: DiscoveryPage) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<DiscoveryPage>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function focusTarget() {
  const target = {
    scrollIntoView: vi.fn(),
    focus: vi.fn(() =>
      Object.defineProperty(document, "activeElement", { configurable: true, value: target }),
    ),
  };
  return target;
}
function mount(
  scope: "workspace" | "shared" | "organization" | "managed" = "workspace",
  type: LibraryManagementType = "all",
) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const targets = {
    search: focusTarget(),
    results: focusTarget(),
    pagination: focusTarget(),
  };
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      const tree = elements(LibraryDiscovery({ scope, type }));
      for (const [element, target] of [
        [tree.find((node) => node.props.id === "library-discovery-search"), targets.search],
        [tree.find((node) => node.props["data-library-results"] === ""), targets.results],
        [tree.find((node) => node.props["data-library-pagination"] === ""), targets.pagination],
      ] as const) {
        if (element?.props.ref) (element.props.ref as { current: unknown }).current = target;
      }
      return tree;
    } finally {
      mocked.hooks = null;
    }
  }
  function flush() {
    hooks.effects.splice(0).forEach((effect) => effect());
  }
  async function settle() {
    for (let i = 0; i < 5; i++) {
      render();
      flush();
      await Promise.resolve();
    }
    return render();
  }
  function select(label: string) {
    const field = render().find(
      (element) =>
        element.type === "label" && text(element.props.children as ReactNode).startsWith(label),
    );
    if (!field) throw new Error(`Missing label ${label}`);
    return elements(field).find((element) => element.type === "select")!;
  }
  function button(label: string) {
    return render().find(
      (element) => element.type === "button" && text(element.props.children as ReactNode) === label,
    )!;
  }
  function category(label: string) {
    const nav = render().find((element) => element.props["aria-label"] === "Library content types");
    return elements(nav).find(
      (element) => element.props.href && text(element.props.children as ReactNode) === label,
    )!;
  }
  function click(label: string) {
    (button(label).props.onClick as () => void)();
  }
  function change(label: string, value: string) {
    (select(label).props.onChange as (event: { target: { value: string } }) => void)({
      target: { value },
    });
  }
  function input() {
    return render().find((element) => element.type === "input" && element.props.type === "search")!;
  }
  return {
    render,
    flush,
    settle,
    select,
    change,
    button,
    category,
    click,
    input,
    targets,
    setScope(next: typeof scope) {
      scope = next;
    },
    pagination: () => render().find((element) => element.props["data-library-pagination"] === "")!,
    results: () => render().find((element) => element.props["data-library-results"] === "")!,
    collection: () => render().find((element) => element.props["data-library-collection"] === "")!,
    titles: () =>
      render()
        .filter((element) => element.type === "h2")
        .map((element) => text(element.props.children as ReactNode)),
    search(value: string) {
      (input().props.onChange as (event: { target: { value: string } }) => void)({
        target: { value },
      });
      render();
      const form = render().find((element) => element.type === "form")!;
      (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
        preventDefault() {},
      });
    },
  };
}
beforeEach(() => {
  const preferences = new Map<string, string>();
  const browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => preferences.get(key) ?? null,
      setItem: (key: string, value: string) => preferences.set(key, value),
    },
  });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", document);
  Object.assign(mocked, {
    query: "",
    workspaceId: "workspace-a",
    actor: "actor-a",
    role: "owner",
    orgRole: "member",
    loading: false,
    error: "",
    features: true,
  });
  mocked.list.mockReset().mockResolvedValue(page());
  mocked.push.mockReset().mockImplementation((href: string) => {
    mocked.query = href.split("?")[1] ?? "";
  });
});
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("All content discovery", () => {
  it("shows server facets and total separately from loaded rows without mixed bulk mutations", async () => {
    const library = mount();
    await library.settle();
    const tree = library.render();
    expect(tree.some((element) => element.props["data-library-discovery"] === "")).toBe(true);
    expect(tree.filter((element) => element.props["data-library-item"])).toHaveLength(1);
    expect(
      text(tree.find((element) => element.props.role === "status")?.props.children as ReactNode),
    ).toBe("Results: 140Loaded: 1");
    expect(text(library.select("Status").props.children as ReactNode)).toContain("Draft (90)");
    expect(library.category("All content").props["aria-current"]).toBe("page");
    expect(
      tree.filter((element) => element.type === "input" && element.props.type === "checkbox"),
    ).toEqual([]);
    expect(tree.filter((element) => element.type === "img")).toEqual([]);
    expect(mocked.list).toHaveBeenCalledTimes(1);
  });

  it("uses URL query/filter/sort state for reload and back, replacing unsubmitted search drafts", async () => {
    mocked.query = "q=north&kind=survey&status=published&sort=title_desc";
    const library = mount();
    await library.settle();
    expect(library.input().props.value).toBe("north");
    expect(library.category("Surveys").props["aria-current"]).toBe("page");
    expect(library.category("Rounds").props.href).toBe(
      "/library?q=north&kind=round&sort=title_desc&status=published",
    );
    expect(library.select("Status").props.value).toBe("published");
    expect(library.select("Sort by").props.value).toBe("title_desc");
    library.search("  south  ");
    await library.settle();
    expect(new URLSearchParams(mocked.query).get("q")).toBe("south");
    library.change("Sort by", "title_asc");
    await library.settle();
    expect(new URLSearchParams(mocked.query).get("sort")).toBe("title_asc");
    mocked.query = "q=north&kind=survey&status=published&sort=title_desc";
    await library.settle();
    expect(library.input().props.value).toBe("north");
    expect(mocked.list.mock.calls.at(-1)?.[1]).toMatchObject({
      q: "north",
      kind: "survey",
      status: "published",
      sort: "title_desc",
    });
    expect(mocked.list.mock.calls.every((call) => call[2] === null)).toBe(true);
  });

  it("remembers grid and list across tabs and reload without requesting another page", async () => {
    mocked.query = "kind=round";
    const library = mount();
    await library.settle();
    expect(library.collection().props["data-view"]).toBe("grid");
    expect(library.button("Grid view").props["aria-pressed"]).toBe(true);
    library.click("List view");
    await library.settle();
    expect(library.collection().props["data-view"]).toBe("list");
    expect(library.button("List view").props["aria-pressed"]).toBe(true);
    expect(mocked.list).toHaveBeenCalledTimes(1);
    library.setScope("shared");
    await library.settle();
    expect(library.collection().props["data-view"]).toBe("list");
    expect(library.category("Rounds").props.href).toBe("/library?kind=round&scope=shared");
    const reloaded = mount();
    await reloaded.settle();
    expect(reloaded.collection().props["data-view"]).toBe("list");
    mocked.workspaceId = "workspace-b";
    await reloaded.settle();
    expect(reloaded.collection().props["data-view"]).toBe("grid");
  });

  it("opens management with the active workspace category and filters", async () => {
    mocked.query =
      "q=north&kind=round&status=archived&favorites=true&folder=unfiled&sort=title_desc";
    const library = mount();
    const tree = await library.settle();

    const manage = tree.find(
      (element) =>
        element.props.href && text(element.props.children as ReactNode) === "Manage Rounds",
    );
    expect(manage?.props.href).toBe(
      "/library?q=north&sort=title_desc&status=archived&favorites=true&folder=unfiled&type=rounds",
    );
  });

  it("loads discovery and switches layouts in memory when browser storage is blocked", async () => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage access is denied", "SecurityError");
      },
    });

    const library = mount();
    await library.settle();
    expect(library.titles()).toEqual(["Readiness"]);
    expect(library.collection().props["data-view"]).toBe("grid");

    library.click("List view");
    await library.settle();
    expect(library.collection().props["data-view"]).toBe("list");
    expect(mocked.list).toHaveBeenCalledTimes(1);
  });

  it("distinguishes loading, empty, no result, initial error and failed page retry", async () => {
    const library = mount();
    expect(text(library.render())).not.toContain("No content yet");
    mocked.list.mockRejectedValueOnce(new TypeError("offline"));
    await library.settle();
    expect(library.render().some((element) => element.props.role === "alert")).toBe(true);
    expect(library.titles()).toEqual([]);
    library.click("Retry");
    await library.settle();
    mocked.list.mockRejectedValueOnce(new TypeError("page offline"));
    library.click("Load more");
    await library.settle();
    expect(library.titles()).toEqual(["Readiness"]);
    expect(library.button("Retry")).toBeDefined();
    mocked.list.mockResolvedValueOnce({
      ...page(),
      items: [own("Second", "survey")],
      nextCursor: null,
    });
    library.click("Retry");
    await library.settle();
    expect(library.titles()).toEqual(["Readiness", "Second"]);
    mocked.list.mockResolvedValue({ items: [], nextCursor: null, facets: { ...facets, total: 0 } });
    mocked.query = "q=missing";
    await library.settle();
    expect(library.titles()).toEqual(["No matching content"]);
    mocked.query = "";
    await library.settle();
    expect(library.titles()).toEqual(["No content yet"]);
  });

  it.each([false, true])(
    "keeps cursor recovery below retained rows and respects moved focus: %s",
    async (moveFocus) => {
      const library = mount();
      await library.settle();
      const failedPage = deferredPage();
      mocked.list.mockReturnValueOnce(failedPage.promise);
      library.click("Load more");
      expect(document.activeElement).toBe(library.targets.pagination);
      expect(library.pagination().props).toMatchObject({
        "aria-label": "Results",
        "aria-busy": true,
        tabIndex: -1,
      });
      expect(library.titles()).toEqual(["Readiness"]);
      expect(library.button("Loading…").props.disabled).toBe(true);
      failedPage.reject(new TypeError("page offline"));
      await library.settle();
      const tree = library.render();
      const footer = library.pagination();
      const listIndex = tree.findIndex((element) => element.type === "ul");
      const footerIndex = tree.findIndex(
        (element) => element.props["data-library-pagination"] === "",
      );
      expect(footerIndex).toBeGreaterThan(listIndex);
      expect(text(footer)).toContain("Your current results are kept");
      expect(elements(footer).find((element) => element.props.role === "alert")).toBeDefined();
      expect(footer.props["aria-busy"]).toBe(false);
      expect(document.activeElement).toBe(library.targets.pagination);
      expect(text(tree.find((element) => element.props.id === "library-discovery-summary"))).toBe(
        "Results: 140Loaded: 1",
      );

      const retry = deferredPage();
      mocked.list.mockReturnValueOnce(retry.promise);
      const staleRetry = library.button("Retry").props.onClick as () => void;
      library.click("Retry");
      expect(document.activeElement).toBe(library.targets.pagination);
      expect(library.pagination().props["aria-busy"]).toBe(true);
      expect(mocked.list.mock.calls.slice(-2).map((call) => call[2])).toEqual(["next", "next"]);
      expect(library.titles()).toEqual(["Readiness"]);
      await library.settle();
      const scrolls = library.targets.pagination.scrollIntoView.mock.calls.length;
      if (moveFocus) library.targets.search.focus();
      retry.resolve({ ...page(), items: [own("Second", "survey")], nextCursor: null });
      await library.settle();
      expect(library.titles()).toEqual(["Readiness", "Second"]);
      expect(library.pagination().props["aria-busy"]).toBe(false);
      expect(text(library.pagination())).toBe("Loaded: 2");
      expect(library.button("Load more")).toBeUndefined();
      expect(document.activeElement).toBe(
        moveFocus ? library.targets.search : library.targets.pagination,
      );
      expect(library.targets.pagination.scrollIntoView).toHaveBeenCalledTimes(
        scrolls + (moveFocus ? 0 : 1),
      );
      expect(library.targets.pagination.scrollIntoView).toHaveBeenLastCalledWith({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
      const focusCalls = library.targets.pagination.focus.mock.calls.length;
      const requests = mocked.list.mock.calls.length;
      staleRetry();
      expect(library.targets.pagination.focus).toHaveBeenCalledTimes(focusCalls);
      expect(mocked.list).toHaveBeenCalledTimes(requests);
    },
  );

  it("focuses the stable results panel for a first-read retry without inventing a count", async () => {
    mocked.list.mockRejectedValueOnce(new TypeError("offline"));
    const library = mount();
    await library.settle();
    expect(text(library.pagination())).toBe("");
    expect(text(library.render())).not.toContain("Loaded: 0");
    const retry = deferredPage();
    mocked.list.mockReturnValueOnce(retry.promise);
    library.click("Retry");
    expect(document.activeElement).toBe(library.targets.results);
    expect(library.results().props).toMatchObject({
      "aria-label": "All content",
      "aria-busy": true,
      "aria-describedby": "library-discovery-summary",
      tabIndex: -1,
    });
    expect(library.button("Retry")).toBeUndefined();
    expect(mocked.list.mock.calls.at(-1)?.[2]).toBeNull();
    retry.resolve(page());
    await library.settle();
    expect(document.activeElement).toBe(library.targets.results);
    expect(library.results().props["aria-busy"]).toBe(false);
    expect(library.titles()).toEqual(["Readiness"]);
  });

  it.each(["workspace", "shared", "organization", "managed"] as const)(
    "resets both toolbar and no-match filters to search while preserving sort and %s scope",
    async (scope) => {
      mocked.query =
        "q=missing&kind=survey&status=published&favorites=true&folder=unfiled&progress=done&permission=view&sort=title_desc";
      mocked.list.mockResolvedValue({
        items: [],
        nextCursor: null,
        facets: { ...facets, total: 0 },
      });
      const library = mount(scope, "surveys");
      await library.settle();
      const buttons = library
        .render()
        .filter((element) => element.type === "button" && text(element) === "Clear filters");
      expect(buttons).toHaveLength(2);
      expect(buttons[1]?.props.className).toBe("button");
      for (const button of buttons) {
        const previousFocuses = library.targets.search.focus.mock.calls.length;
        const previousScrolls = library.targets.search.scrollIntoView.mock.calls.length;
        (button.props.onClick as () => void)();
        expect(document.activeElement).toBe(library.targets.search);
        expect(library.targets.search.focus).toHaveBeenCalledTimes(previousFocuses + 1);
        expect(library.targets.search.scrollIntoView).toHaveBeenCalledTimes(previousScrolls + 1);
        expect(library.targets.search.scrollIntoView).toHaveBeenLastCalledWith({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
        expect(library.targets.search.focus.mock.invocationCallOrder.at(-1)).toBeLessThan(
          library.targets.search.scrollIntoView.mock.invocationCallOrder.at(-1)!,
        );
        expect(library.targets.search.scrollIntoView.mock.invocationCallOrder.at(-1)).toBeLessThan(
          mocked.push.mock.invocationCallOrder.at(-1)!,
        );
        const href = mocked.push.mock.calls.at(-1)?.[0] as string;
        const params = new URLSearchParams(href.split("?")[1]);
        expect(params.get("sort")).toBe("title_desc");
        expect(params.get("scope")).toBe(scope === "workspace" ? null : scope);
        expect(params.has("type")).toBe(false);
        for (const name of ["q", "kind", "status", "favorites", "folder", "progress", "permission"])
          expect(params.has(name)).toBe(false);
      }
      await library.settle();
      expect(library.input().props.value).toBe("");
      expect(document.activeElement).toBe(library.targets.search);
    },
  );

  it.each(["query", "scope", "workspace", "actor", "role", "organization", "logout"])(
    "fences stale recovery focus and late pages after %s changes",
    async (change) => {
      const library = mount();
      await library.settle();
      const staleMore = library.button("Load more").props.onClick as () => void;
      const pending = deferredPage();
      mocked.list.mockReturnValueOnce(pending.promise);
      library.click("Load more");
      library.targets.search.focus();
      if (change === "query") mocked.query = "q=new";
      if (change === "scope") library.setScope("shared");
      if (change === "workspace") mocked.workspaceId = "workspace-b";
      if (change === "actor") mocked.actor = "actor-b";
      if (change === "role") mocked.role = "viewer";
      if (change === "organization") mocked.orgRole = "admin";
      if (change === "logout") window.dispatchEvent(new Event(SESSION_LOGOUT_EVENT));
      library.render();
      const requests = mocked.list.mock.calls.length;
      const focusCalls = library.targets.pagination.focus.mock.calls.length;
      staleMore();
      expect(mocked.list).toHaveBeenCalledTimes(requests);
      expect(library.targets.pagination.focus).toHaveBeenCalledTimes(focusCalls);
      pending.resolve({ ...page(), items: [own("Obsolete page", "survey")], nextCursor: null });
      await library.settle();
      expect(library.titles()).not.toContain("Obsolete page");
      expect(document.activeElement).toBe(library.targets.search);
      expect(library.targets.pagination.focus).toHaveBeenCalledTimes(focusCalls);
    },
  );

  it.each(["query", "scope", "role", "logout"])(
    "cancels footer scrolling when %s changes even if the footer retains focus",
    async (change) => {
      const library = mount();
      await library.settle();
      const pending = deferredPage();
      mocked.list.mockReturnValueOnce(pending.promise);
      library.click("Load more");
      await library.settle();
      expect(document.activeElement).toBe(library.targets.pagination);
      expect(library.targets.pagination.scrollIntoView).toHaveBeenCalled();
      library.targets.pagination.scrollIntoView.mockClear();
      if (change === "query") mocked.query = "q=new";
      if (change === "scope") library.setScope("shared");
      if (change === "role") mocked.role = "viewer";
      if (change === "logout") window.dispatchEvent(new Event(SESSION_LOGOUT_EVENT));
      await library.settle();
      pending.resolve({ ...page(), items: [own("Obsolete page", "survey")], nextCursor: null });
      await library.settle();
      expect(library.titles()).not.toContain("Obsolete page");
      expect(library.targets.pagination.scrollIntoView).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(library.targets.pagination);
    },
  );

  it.each(["query", "scope", "role"])(
    "rejects obsolete initial-retry and reset focus callbacks after %s changes",
    async (change) => {
      mocked.query = "q=missing";
      mocked.list.mockRejectedValueOnce(new TypeError("offline"));
      const library = mount();
      await library.settle();
      const staleRetry = library.button("Retry").props.onClick as () => void;
      const staleReset = library.button("Clear filters").props.onClick as () => void;
      const elsewhere = focusTarget();
      elsewhere.focus();
      if (change === "query") mocked.query = "q=new";
      if (change === "scope") library.setScope("shared");
      if (change === "role") mocked.role = "viewer";
      library.render();
      const requests = mocked.list.mock.calls.length;
      staleRetry();
      staleReset();
      expect(mocked.list).toHaveBeenCalledTimes(requests);
      expect(mocked.push).not.toHaveBeenCalled();
      expect(library.targets.results.focus).not.toHaveBeenCalled();
      expect(library.targets.search.focus).not.toHaveBeenCalled();
      expect(library.targets.search.scrollIntoView).not.toHaveBeenCalled();
      await library.settle();
      expect(document.activeElement).toBe(elsewhere);
    },
  );

  it.each(["workspace", "actor", "role", "organization", "loading", "error"])(
    "hides prior rows/counts immediately on %s context change",
    async (change) => {
      const library = mount();
      await library.settle();
      const staleMore = library.button("Load more").props.onClick as () => void;
      const calls = mocked.list.mock.calls.length;
      if (change === "workspace") mocked.workspaceId = "workspace-b";
      if (change === "actor") mocked.actor = "actor-b";
      if (change === "role") mocked.role = "viewer";
      if (change === "organization") mocked.orgRole = "admin";
      if (change === "loading") mocked.loading = true;
      if (change === "error") mocked.error = "access unavailable";
      expect(library.titles()).toEqual([]);
      staleMore();
      expect(mocked.list).toHaveBeenCalledTimes(calls);
      library.flush();
      await library.settle();
      expect(mocked.list).toHaveBeenCalledTimes(
        calls + (change === "loading" || change === "error" ? 0 : 1),
      );
    },
  );

  it("revalidates from the beginning on focus and auth, and fences logout through later auth/focus events", async () => {
    const library = mount();
    await library.settle();
    window.dispatchEvent(new Event("focus"));
    expect(library.titles()).toEqual([]);
    await library.settle();
    expect(mocked.list.mock.calls.at(-1)?.[2]).toBeNull();
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    await library.settle();
    expect(mocked.list).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event(SESSION_LOGOUT_EVENT));
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    window.dispatchEvent(new Event("focus"));
    expect(library.titles()).toEqual([]);
    await library.settle();
    expect(mocked.list).toHaveBeenCalledTimes(3);
  });

  it.each(["owner", "viewer"])(
    "keeps retained own metadata and kind filters available to a %s when writer features pause",
    async (role) => {
      mocked.features = false;
      mocked.role = role;
      mocked.list.mockResolvedValue({
        ...page(),
        items: [
          own(),
          own("Retained Presentation", "presentation"),
          own("Retained Survey", "survey"),
        ],
      });
      const library = mount();
      await library.settle();
      expect(library.titles()).toEqual(["Readiness", "Retained Presentation", "Retained Survey"]);
      expect(library.category("Rounds").props.href).toBe("/library?kind=round");
      expect(library.category("Presentations").props.href).toBe("/library?kind=presentation");
      expect(library.category("Surveys").props.href).toBe("/library?kind=survey");
      const links = library.render().filter((element) => element.props.href);
      expect(links.some((element) => element.props.href === "/presentation/same-id")).toBe(true);
      expect(links.some((element) => element.props.href === "/surveys/same-id")).toBe(true);
      expect(links.some((element) => text(element.props.children as ReactNode) === "View")).toBe(
        role === "viewer",
      );
      expect(links.some((element) => text(element.props.children as ReactNode) === "Edit")).toBe(
        role === "owner",
      );
    },
  );

  it("keeps shared metadata and authoritative actions when active workspace kinds are paused", async () => {
    mocked.features = false;
    const share = {
      id: "share",
      artifactType: "presentation",
      title: "Published briefing",
      description: "",
      organizationName: "Organization",
      sourceWorkspaceName: "Source",
      sharedAt: "2026-11-16T12:00:00.000Z",
      permission: "use",
      progress: "new",
      dueAt: null,
      message: "Review this",
      capabilities: { view: false, copy: false, manage: true },
      unavailableReason: "feature_disabled",
    };
    mocked.list.mockResolvedValue({
      items: [share],
      nextCursor: null,
      facets: {
        kinds: { round: 0, presentation: 71, survey: 0 },
        progress: { new: 70, in_progress: 0, done: 1 },
        permissions: { view: 1, use: 70 },
        total: 71,
      },
    });
    const library = mount("shared");
    await library.settle();
    expect(library.titles()).toEqual(["Published briefing"]);
    const action = library.render().find((element) => element.type === LibraryShareActions)!;
    expect(action.props.share).toBe(share);
    expect(
      library.render().find((element) => element.props["data-library-item"] === "share"),
    ).toBeDefined();
    expect(text(library.select("Sort by").props.children as ReactNode)).toContain(
      "Recently shared",
    );
    library.change("Review progress", "done");
    await library.settle();
    library.change("Permission", "view");
    await library.settle();
    expect(mocked.list.mock.calls.at(-1)?.[1]).toMatchObject({
      progress: "done",
      permission: "view",
    });
    expect(library.category("Presentations").props.href).toBe(
      "/library?kind=presentation&progress=done&permission=view&scope=shared",
    );
  });
});
