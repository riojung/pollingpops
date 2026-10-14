import {
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";

interface ComponentHooks {
  cursor: number;
  slots: unknown[];
}
interface EffectSlot {
  deps?: ReactModule.DependencyList;
  cleanup?: () => void;
}
const fixtures = vi.hoisted(() => ({
  workspaceId: "workspace-a",
  presentationsEnabled: true,
  query: "",
  replace: vi.fn(),
  apiFetch: vi.fn(),
  hooks: null as ComponentHooks | null,
  pendingEffects: [] as Array<() => void>,
  tree: null as ReactNode,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  const sameDeps = (previous?: ReactModule.DependencyList, next?: ReactModule.DependencyList) =>
    previous &&
    next &&
    previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]));
  const memo = <T,>(factory: () => T, deps?: ReactModule.DependencyList) => {
    const hooks = fixtures.hooks!;
    const index = hooks.cursor++;
    const prior = hooks.slots[index] as { deps?: ReactModule.DependencyList; value: T } | undefined;
    if (!prior || !sameDeps(prior.deps, deps)) hooks.slots[index] = { deps, value: factory() };
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
      const prior = hooks.slots[index] as EffectSlot | undefined;
      if (prior && sameDeps(prior.deps, deps)) return;
      const slot: EffectSlot = { deps };
      hooks.slots[index] = slot;
      fixtures.pendingEffects.push(() => {
        prior?.cleanup?.();
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
  return {
    useLocale: () => ({
      locale: "en-CA",
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate(messages, key, values),
    }),
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: fixtures.replace }),
  useSearchParams: () => new URLSearchParams(fixtures.query),
}));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => <a {...props} /> }));
vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: { workspaceId: fixtures.workspaceId },
    productFeatures: { presentations: fixtures.presentationsEnabled },
  }),
}));
vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({
    children,
    title,
    description,
  }: {
    children: ReactNode;
    title: string;
    description: string;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </main>
  ),
}));

import ResultsPage from "./page";

function report(id = "report-first", title = "First Round result") {
  return {
    id,
    sessionId: `session-${id}`,
    quizId: "round-source",
    title,
    status: "ready",
    trustMode: "learning",
    participantCount: 5,
    initialAccuracyPercent: 60,
    recovery: { recovered: 1, eligible: 2, percent: 50 },
    unresolvedConceptCount: 1,
    interventionCount: 1,
    followupId: null,
    followupStatus: null,
    generatedAt: "2026-10-01T12:00:00Z",
    createdAt: "2026-10-01T12:00:00Z",
    expiresAt: "2099-10-01T00:00:00Z",
  };
}
function practice(id = "practice-first", title = "First practice") {
  return {
    id,
    purpose: "recovery",
    trustMode: "learning",
    sourceQuizVersionId: "round-version",
    sourceSessionId: "session-first",
    sourceReportId: "report-first",
    quizId: "round-source",
    recoveryPackSource: null,
    title,
    status: "open",
    conceptKeys: ["fractions"],
    checkpointCount: 1,
    attemptCount: 3,
    completedAttemptCount: 2,
    opensAt: "2026-10-01T00:00:00Z",
    closesAt: "2099-10-01T00:00:00Z",
    expiresAt: "2099-11-01T00:00:00Z",
    createdAt: "2026-10-01T12:00:00Z",
  };
}
const presentation = {
  id: "presentation-first",
  presentationId: "presentation-source",
  title: "First Presentation result",
  status: "finished",
  phase: "finished",
  participantCount: 5,
  responseCount: 5,
  blockCount: 2,
  createdAt: "2026-10-10T12:00:00Z",
};
function response(path: string) {
  if (path.startsWith("/v1/quizzes?"))
    return { quizzes: [{ id: "round-source", title: "Source Round" }] };
  if (path.startsWith("/v1/reports?"))
    return path.includes("cursor=")
      ? { items: [report("report-later", "Later Round result")], nextCursor: null }
      : { items: [report()], nextCursor: "report-next" };
  if (path.startsWith("/v1/followups?"))
    return path.includes("cursor=")
      ? { items: [practice("practice-later", "Later practice")], nextCursor: null }
      : { items: [practice()], nextCursor: "practice-next" };
  if (path === "/v1/presentation-sessions") return { sessions: [presentation] };
  throw new Error(`Unexpected request: ${path}`);
}

beforeEach(() => {
  fixtures.workspaceId = "workspace-a";
  fixtures.presentationsEnabled = true;
  fixtures.query = "";
  fixtures.hooks = null;
  fixtures.pendingEffects = [];
  fixtures.tree = null;
  fixtures.apiFetch.mockReset().mockImplementation(async (path: string) => response(path));
  fixtures.replace.mockReset().mockImplementation((href: string) => {
    fixtures.query = href.split("?")[1] ?? "";
  });
  vi.stubGlobal("window", { localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() } });
});
afterEach(() => {
  fixtures.hooks = null;
  vi.unstubAllGlobals();
});

describe("Results workspace", () => {
  it.each([
    {
      view: "results",
      path: "/v1/reports",
      title: "First Round result",
      search: "Search Round results",
      library: "rounds",
    },
    {
      view: "practice",
      path: "/v1/followups",
      title: "First practice",
      search: "Search practice",
      library: "rounds",
    },
    {
      view: "presentations",
      path: "/v1/presentation-sessions",
      title: "First Presentation result",
      search: "Search Presentation results",
      library: "presentations",
    },
  ])(
    "preserves the $view deep link and loads only its evidence collection",
    async ({ view, path, title, search, library }) => {
      fixtures.query = `view=${view}`;
      const markup = await resultsHarness().settle();
      const paths = fixtures.apiFetch.mock.calls.map(([url]) => String(url));
      for (const other of ["/v1/reports", "/v1/followups", "/v1/presentation-sessions"])
        expect(paths.some((url) => url.startsWith(other))).toBe(other === path);
      expect(markup).toContain(`<h2 lang="">${title}</h2>`);
      expect(markup).toContain(`placeholder="${search}"`);
      expect(markup).toContain(`href="/library?type=${library}"`);
      expect(markup).toContain('href="/sessions?type=surveys"');
      expect(markup).toContain('aria-label="Results layout"');
      if (view === "practice") {
        expect(markup).toContain('href="/practice/practice-first"');
        expect(markup).toContain('href="/report/report-first"');
      } else if (view === "presentations")
        expect(markup).toContain('href="/presentation-session/presentation-first/report"');
      else expect(markup).toContain('href="/report/report-first"');
    },
  );

  it("falls back from unavailable Presentation links without requesting gated history", async () => {
    fixtures.presentationsEnabled = false;
    fixtures.query = "view=presentations&q=needle";
    const markup = await resultsHarness().settle();
    expect(markup).toContain('placeholder="Search Round results"');
    expect(markup).not.toContain('href="/results?view=presentations"');
    expect(
      fixtures.apiFetch.mock.calls.some(([path]) => path === "/v1/presentation-sessions"),
    ).toBe(false);
    expect(
      new URLSearchParams(historyCalls("/v1/reports")[0]![0].split("?")[1]).get("search"),
    ).toBe("needle");
  });

  it.each([
    {
      view: "results",
      path: "/v1/reports",
      statusLabel: "Result Status",
      status: "ready",
      more: "Load More",
      later: "Later Round result",
    },
    {
      view: "practice",
      path: "/v1/followups",
      statusLabel: "Practice Status",
      status: "open",
      more: "Load More Practice",
      later: "Later practice",
    },
  ])(
    "sends $view search and filters on every page and clears all filters together",
    async ({ view, path, statusLabel, status, more, later }) => {
      fixtures.query = `view=${view}`;
      const harness = resultsHarness();
      await harness.settle();
      changeField(statusLabel, status);
      changeField("Round", "round-source");
      changeField("From", "2026-10-01");
      changeField("To", "2026-10-31");
      changeSearch("  NeEdLe %_  ");
      await harness.settle();
      const filters = Object.fromEntries(
        new URLSearchParams(historyCalls(path).at(-1)![0].split("?")[1]),
      );
      expect(filters).toEqual({
        limit: "25",
        search: "NeEdLe %_",
        status,
        quizId: "round-source",
        from: new Date("2026-10-01T00:00:00").toISOString(),
        to: new Date("2026-10-31T23:59:59.999").toISOString(),
      });
      clickButton(more);
      const markup = await harness.settle();
      expect(markup).toContain(`<h2 lang="">${later}</h2>`);
      expect(
        Object.fromEntries(new URLSearchParams(historyCalls(path).at(-1)![0].split("?")[1])),
      ).toEqual({ ...filters, cursor: view === "practice" ? "practice-next" : "report-next" });
      expect(markup).toContain(view === "practice" ? "2 practice items shown" : "2 results shown");
      clickButton("Clear filters");
      await harness.settle();
      expect(new URLSearchParams(fixtures.query).get("view")).toBe(view);
      expect(new URLSearchParams(fixtures.query).has("q")).toBe(false);
      expect(
        Object.fromEntries(new URLSearchParams(historyCalls(path).at(-1)![0].split("?")[1])),
      ).toEqual({ limit: "25" });
    },
  );

  it.each([
    { view: "results", path: "/v1/reports", factory: report, more: "Load More" },
    { view: "practice", path: "/v1/followups", factory: practice, more: "Load More Practice" },
  ])(
    "discards stale $view first pages and load-more responses after query or workspace changes",
    async ({ view, path, factory, more }) => {
      for (const stage of ["first", "more"] as const)
        for (const change of ["query", "workspace"] as const) {
          fixtures.query = `view=${view}`;
          fixtures.workspaceId = "workspace-a";
          fixtures.apiFetch.mockReset();
          const stale = deferred<unknown>();
          let reads = 0;
          fixtures.apiFetch.mockImplementation((url: string) => {
            if (url.startsWith(`${path}?`)) {
              reads++;
              if (reads === (stage === "first" ? 1 : 2)) return stale.promise;
              if (reads > (stage === "first" ? 1 : 2))
                return Promise.resolve({
                  items: [factory("fresh", "Fresh history")],
                  nextCursor: null,
                });
            }
            return Promise.resolve(response(url));
          });
          const harness = resultsHarness();
          await harness.settle();
          if (stage === "more") clickButton(more);
          const request = historyCalls(path).at(-1)!;
          if (change === "query") changeSearch("new query");
          else fixtures.workspaceId = "workspace-b";
          expect(harness.render()).not.toContain('<h2 lang="">First');
          let markup = await harness.settle();
          expect(request[1]?.signal?.aborted).toBe(true);
          expect(markup).toContain('<h2 lang="">Fresh history</h2>');
          stale.resolve({ items: [factory("stale", "Stale history")], nextCursor: null });
          markup = await harness.settle();
          expect(markup).not.toContain("Stale history");
          expect(markup).toContain('<h2 lang="">Fresh history</h2>');
          harness.dispose();
        }
    },
  );

  it("filters Presentation snapshots locally by title, status, source, and inclusive dates", async () => {
    fixtures.query = "view=presentations";
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path === "/v1/presentation-sessions"
        ? {
            sessions: [
              presentation,
              {
                ...presentation,
                id: "presentation-active",
                title: "Active Presentation",
                status: "active",
              },
              {
                ...presentation,
                id: "presentation-other",
                presentationId: "other-source",
                title: "Other Presentation",
              },
              {
                ...presentation,
                id: "presentation-old",
                title: "Old Presentation",
                createdAt: "2026-09-01T12:00:00Z",
              },
            ],
          }
        : response(path),
    );
    const harness = resultsHarness();
    await harness.settle();
    changeSearch("  PRESENTATION  ");
    changeField("Status", "finished");
    changeField("Presentation", "presentation-source");
    changeField("From", "2026-10-10");
    changeField("To", "2026-10-10");
    let markup = await harness.settle();
    expect(headings()).toEqual(["First Presentation result"]);
    expect(markup).toContain("1 results shown");
    expect(
      fixtures.apiFetch.mock.calls.filter(([path]) => path === "/v1/presentation-sessions"),
    ).toHaveLength(1);
    changeSearch("absent");
    markup = await harness.settle();
    expect(markup).toContain("No results match these filters.");
    expect(headings()).toEqual(["No Presentation results yet"]);
    clickButton("Clear filters");
    await harness.settle();
    expect(headings()).toHaveLength(4);
    expect(
      fixtures.apiFetch.mock.calls.filter(([path]) => path === "/v1/presentation-sessions"),
    ).toHaveLength(1);
  });

  it("aborts a stale Presentation snapshot on workspace remount", async () => {
    fixtures.query = "view=presentations";
    const stale = deferred<unknown>();
    let reads = 0;
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === "/v1/presentation-sessions" && ++reads === 1
        ? stale.promise
        : Promise.resolve(response(path)),
    );
    const harness = resultsHarness();
    await harness.settle();
    const request = fixtures.apiFetch.mock.calls.find(
      ([path]) => path === "/v1/presentation-sessions",
    )!;
    fixtures.workspaceId = "workspace-b";
    expect(harness.render()).not.toContain("First Presentation result");
    await harness.settle();
    expect(request[1].signal.aborted).toBe(true);
    stale.resolve({ sessions: [{ ...presentation, title: "Stale Presentation" }] });
    expect(await harness.settle()).not.toContain("Stale Presentation");
    expect(headings()).toEqual(["First Presentation result"]);
  });

  it("persists Results layout separately per workspace and survives browser storage failures", async () => {
    const saved = new Map([
      ["openround:library-view:v1:workspace-a", "list"],
      ["openround:sessions-view:v1:workspace-a", "list"],
    ]);
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => saved.get(key) ?? null);
    vi.mocked(window.localStorage.setItem).mockImplementation((key, value) => {
      saved.set(key, value);
    });
    const harness = resultsHarness();
    expect(await harness.settle()).toContain('data-view="grid"');
    clickButton("List");
    expect(harness.render()).toContain('data-view="list"');
    expect(window.localStorage.setItem).toHaveBeenLastCalledWith(
      "openround:results-view:v1:workspace-a",
      "list",
    );
    fixtures.workspaceId = "workspace-b";
    expect(harness.render()).toContain('data-view="grid"');
    await harness.settle();
    clickButton("List");
    expect(window.localStorage.setItem).toHaveBeenLastCalledWith(
      "openround:results-view:v1:workspace-b",
      "list",
    );
    fixtures.workspaceId = "workspace-a";
    expect(await harness.settle()).toContain('data-view="list"');
    fixtures.workspaceId = "workspace-c";
    vi.mocked(window.localStorage.getItem).mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    vi.mocked(window.localStorage.setItem).mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    expect(await harness.settle()).toContain('data-view="grid"');
    clickButton("List");
    expect(harness.render()).toContain('data-view="list"');
    expect(headings()).toEqual(["First Round result"]);
  });
});

/** Keep hooks isolated by component/key, including effect cleanup when React would remount. */
function resultsHarness() {
  const instances = new Map<string, ComponentHooks>();
  const cleanup = (hooks: ComponentHooks) =>
    hooks.slots.forEach((slot) => (slot as EffectSlot | undefined)?.cleanup?.());
  const render = () => {
    const active = new Set<string>();
    const expand = (node: ReactNode, path: string): ReactNode => {
      if (Array.isArray(node))
        return node.map((child, index) =>
          expand(
            child,
            `${path}/${isValidElement(child) && child.key !== null ? child.key : index}`,
          ),
        );
      if (!isValidElement<Record<string, unknown>>(node)) return node;
      const identity = `${path}/${typeof node.type === "function" ? node.type.name : String(node.type)}:${node.key ?? ""}`;
      if (typeof node.type === "function") {
        const hooks = instances.get(identity) ?? { cursor: 0, slots: [] };
        instances.set(identity, hooks);
        active.add(identity);
        hooks.cursor = 0;
        fixtures.hooks = hooks;
        let children: ReactNode;
        try {
          children = (node.type as (props: Record<string, unknown>) => ReactNode)(node.props);
        } finally {
          fixtures.hooks = null;
        }
        return expand(children, identity);
      }
      return cloneElement(node, { children: expand(node.props.children as ReactNode, identity) });
    };
    fixtures.tree = expand(<ResultsPage />, "root");
    for (const [key, hooks] of instances)
      if (!active.has(key)) {
        cleanup(hooks);
        instances.delete(key);
      }
    return renderToStaticMarkup(fixtures.tree);
  };
  const flushEffects = () => fixtures.pendingEffects.splice(0).forEach((effect) => effect());
  const settle = async () => {
    for (let index = 0; index < 12; index++) {
      render();
      flushEffects();
      await Promise.resolve();
    }
    return render();
  };
  const dispose = () => {
    instances.forEach(cleanup);
    instances.clear();
    fixtures.pendingEffects = [];
  };
  return { render, flushEffects, settle, dispose };
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
function clickButton(name: string) {
  const node = elements(fixtures.tree).find(
    (element) =>
      element.type === "button" && elementText(element.props.children as ReactNode) === name,
  );
  if (!node) throw new Error(`Missing button: ${name}`);
  (node.props as ComponentProps<"button">).onClick?.(
    {} as Parameters<NonNullable<ComponentProps<"button">["onClick"]>>[0],
  );
}
function changeSearch(value: string) {
  changeControl(
    elements(fixtures.tree).find(
      (element) => element.type === "input" && element.props.type === "search",
    ),
    value,
  );
}
function changeField(name: string, value: string) {
  const label = elements(fixtures.tree).find(
    (element) =>
      element.type === "label" && elementText(element.props.children as ReactNode).startsWith(name),
  );
  changeControl(
    elements(label).find((element) => element.type === "select" || element.type === "input"),
    value,
  );
}
function changeControl(node: ReactElement<Record<string, unknown>> | undefined, value: string) {
  if (!node) throw new Error(`Missing control for: ${value}`);
  (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}
function headings() {
  return elements(fixtures.tree)
    .filter((element) => element.type === "h2")
    .map((element) => elementText(element.props.children as ReactNode));
}
function historyCalls(path: string) {
  return fixtures.apiFetch.mock.calls.filter(([url]) =>
    String(url).startsWith(`${path}?`),
  ) as Array<[string, { signal?: AbortSignal }]>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
