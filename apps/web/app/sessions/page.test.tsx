import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import type * as ApiModule from "../../lib/api";

interface SessionHooks {
  cursor: number;
  slots: unknown[];
  pendingEffects: Array<() => void>;
}

const fixtures = vi.hoisted(() => ({
  role: "owner" as "owner" | "editor" | "viewer",
  surveysEnabled: true,
  presentationsEnabled: true,
  workspaceId: "workspace-a",
  query: "",
  push: vi.fn(),
  replace: vi.fn(),
  apiFetch: vi.fn(),
  hooks: null as SessionHooks | null,
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
    usePathname: () => "/sessions",
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
    canEdit: fixtures.role !== "viewer",
    creator: { role: fixtures.role, workspaceId: fixtures.workspaceId },
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

import SessionsPage from "./page";

function round(id = "round-one") {
  return {
    id,
    quizId: "11111111-1111-4111-8111-111111111111",
    title: id === "round-one" ? "First Round" : "Later Round",
    code: "1234567",
    status: "finished",
    phase: "finished",
    participantCount: 2,
    answerCount: 2,
    questionCount: 1,
    questionPosition: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    expiresAt: "2099-10-01T00:00:00Z",
    reportId: "report-one",
  };
}
const presentation = {
  id: "presentation-one",
  presentationId: "22222222-2222-4222-8222-222222222222",
  title: "First Presentation",
  code: "2345678",
  status: "active",
  phase: "lobby",
  currentBlockIndex: -1,
  blockCount: 1,
  participantCount: 0,
  responseCount: 0,
  createdAt: "2026-10-01T00:00:00Z",
  liveExpiresAt: "2099-11-01T00:00:00Z",
};
const openSurvey = {
  id: "survey-open",
  surveyId: "33333333-3333-4333-8333-333333333333",
  title: "Open Survey",
  code: "3456789",
  closesAt: "2099-10-01T00:00:00Z",
  expiresAt: "2099-11-01T00:00:00Z",
  closed: false,
};
const closedSurvey = { ...openSurvey, id: "survey-closed", title: "Closed Survey", closed: true };
const expiredSurvey = {
  ...closedSurvey,
  id: "survey-expired",
  title: "Expired Survey",
  expiresAt: "2020-10-01T00:00:00Z",
};

function response(path: string) {
  if (path === "/v1/sessions/counts")
    return { counts: { rounds: 77, presentations: 7, surveys: 55 } };
  if (path.startsWith("/v1/quizzes?"))
    return { quizzes: [{ id: "11111111-1111-4111-8111-111111111111", title: "Source Round" }] };
  if (path.startsWith("/v1/sessions?")) return { items: [round()], nextCursor: "next-round" };
  if (path === "/v1/presentation-sessions") return { sessions: [presentation] };
  if (path.startsWith("/v1/survey-rooms?")) {
    return path.includes("cursor=")
      ? { rooms: [closedSurvey, expiredSurvey], nextCursor: null }
      : { rooms: [openSurvey], nextCursor: "next-survey" };
  }
  return {};
}

describe("Sessions workspace", () => {
  beforeEach(() => {
    fixtures.role = "owner";
    fixtures.presentationsEnabled = true;
    fixtures.surveysEnabled = true;
    fixtures.workspaceId = "workspace-a";
    fixtures.query = "";
    fixtures.hooks = null;
    fixtures.tree = null;
    fixtures.apiFetch.mockReset();
    fixtures.apiFetch.mockImplementation(async (path: string) => response(path));
    for (const navigate of [fixtures.push, fixtures.replace]) {
      navigate.mockReset();
      navigate.mockImplementation((href: string) => {
        fixtures.query = href.split("?")[1] ?? "";
      });
    }
    vi.unstubAllGlobals();
    vi.stubGlobal("window", {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
      sessionStorage: { setItem: vi.fn(), removeItem: vi.fn() },
      confirm: vi.fn(() => true),
    });
  });

  it("defaults to Rounds with unknown counts instead of a false zero", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<SessionsPage />));
    expect(markup).toContain('aria-label="Session type"');
    expect(markup).toMatch(/aria-selected="true"[^>]*role="tab"[^>]*>Rounds/);
    expect(markup).toContain('aria-label="Loading session count"');
    expect(markup).toContain('placeholder="Search Round sessions"');
    expect(markup).toContain('href="/library?type=rounds"');
    expect(markup).not.toContain("Artifact type");
    expect(markup).not.toContain("Browse Surveys");
  });

  it.each(["rounds", "presentations", "surveys"])(
    "loads only the selected %s session history and displays total counts",
    async (type) => {
      fixtures.query = `type=${type}`;
      const harness = sessionsHarness();
      const markup = await harness.settle();
      const paths = fixtures.apiFetch.mock.calls.map(([path]) => String(path));
      expect(paths).toContain("/v1/sessions/counts");
      expect(paths.some((path) => path.startsWith("/v1/sessions?"))).toBe(type === "rounds");
      expect(paths.includes("/v1/presentation-sessions")).toBe(type === "presentations");
      expect(paths.some((path) => path.startsWith("/v1/survey-rooms?"))).toBe(type === "surveys");
      expect(paths.some((path) => path.startsWith("/v1/quizzes?"))).toBe(type === "rounds");
      expect(markup).toContain("Rounds <span>77</span>");
      expect(markup).toContain("Presentations <span>7</span>");
      expect(markup).toContain("Surveys <span>55</span>");
      if (type === "surveys") {
        expect(markup).toContain("Open Survey");
        expect(markup).toContain("Closed Survey");
        expect(markup).toContain("Expired Survey");
        expect(paths).toContain("/v1/survey-rooms?limit=50&cursor=next-survey");
      }
    },
  );

  it("honors typed URL filters and browser back/forward query changes", async () => {
    fixtures.query =
      "type=presentations&q=234&status=active&source=22222222-2222-4222-8222-222222222222&from=2026-10-01&to=2026-10-01";
    const harness = sessionsHarness();
    let markup = await harness.settle();
    expect(markup).toContain("First Presentation");
    expect(markup).toContain('value="234"');
    expect(markup).toContain('value="2026-10-01"');
    fixtures.query = "type=surveys&q=Closed&status=finished";
    markup = await harness.settle();
    expect(markup).toContain("Closed Survey");
    expect(markup).not.toContain("First Presentation");
    expect(markup).not.toContain('<h2 lang="">Open Survey</h2>');
    expect(markup).not.toContain('<h2 lang="">Expired Survey</h2>');
    expect(markup).toContain("Closes from");
    fixtures.query =
      "type=rounds&q=next-page&status=expired&source=11111111-1111-4111-8111-111111111111";
    await harness.settle();
    expect(
      fixtures.apiFetch.mock.calls.some(([path]) =>
        String(path).includes(
          "search=next-page&status=expired&quizId=11111111-1111-4111-8111-111111111111",
        ),
      ),
    ).toBe(true);
  });

  it("clears source and date filters on a tab switch while retaining the search and status", async () => {
    fixtures.query =
      "type=rounds&q=Room&status=finished&source=11111111-1111-4111-8111-111111111111&from=2026-10-01&to=2026-10-13";
    const harness = sessionsHarness();
    await harness.settle();
    clickTab("surveys");
    const params = new URLSearchParams(fixtures.query);
    expect(params.get("type")).toBe("surveys");
    expect(params.get("q")).toBe("Room");
    expect(params.get("status")).toBe("finished");
    expect(params.has("source")).toBe(false);
    expect(params.has("from")).toBe(false);
    expect(params.has("to")).toBe(false);
  });

  it("keeps Survey history visible with creation disabled and hides disabled Presentations", async () => {
    fixtures.surveysEnabled = false;
    fixtures.presentationsEnabled = false;
    fixtures.query = "type=surveys";
    const harness = sessionsHarness();
    const markup = await harness.settle();
    expect(markup).toContain("Open Survey");
    expect(markup).not.toContain('id="presentations-tab"');
    fixtures.query = "type=presentations&source=22222222-2222-4222-8222-222222222222";
    const fallback = await harness.settle();
    expect(fallback).toContain('id="rounds-panel"');
    expect(fixtures.replace).toHaveBeenCalledWith("/sessions?type=rounds", { scroll: false });
  });

  it("does not block session rows when the count request fails", async () => {
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === "/v1/sessions/counts"
        ? Promise.reject(new Error("counts unavailable"))
        : Promise.resolve(response(path)),
    );
    const markup = await sessionsHarness().settle();
    expect(markup).toContain("First Round");
    expect(markup).toContain('aria-label="Session count unavailable"');
    expect(markup).not.toContain("counts unavailable");
  });

  it("paginates Rounds and ignores a stale page after switching tabs", async () => {
    const stale = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path.includes("cursor=next-round") ? stale.promise : Promise.resolve(response(path)),
    );
    const harness = sessionsHarness();
    await harness.settle();
    clickButton("Load more sessions");
    const request = fixtures.apiFetch.mock.calls.find(([path]) =>
      String(path).includes("cursor=next-round"),
    );
    expect(request).toBeDefined();
    clickTab("surveys");
    await harness.settle();
    expect(request?.[1].signal.aborted).toBe(true);
    stale.resolve({ items: [round("later-round")], nextCursor: null });
    const markup = await harness.settle();
    expect(markup).toContain("Open Survey");
    expect(markup).not.toContain("Later Round");
  });

  it("appends the next Round page without duplicate rows", async () => {
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.includes("cursor=next-round")
        ? { items: [round(), round("later-round")], nextCursor: null }
        : response(path),
    );
    const harness = sessionsHarness();
    await harness.settle();
    clickButton("Load more sessions");
    const markup = await harness.settle();
    expect(markup).toContain("Later Round");
    expect(markup.match(/<h2 lang="">First Round<\/h2>/g)).toHaveLength(1);
    expect(markup).not.toContain("Load more sessions");
  });

  it.each(["presentations", "surveys"])(
    "pages the filtered %s display without fetching Round history",
    async (type) => {
      fixtures.query = `type=${type}`;
      fixtures.apiFetch.mockImplementation(async (path: string) => {
        const records = Array.from({ length: 30 }, (_, index) => ({
          ...(type === "presentations" ? presentation : openSurvey),
          id: `paged-${index}`,
          title: `Paged session ${index}`,
        }));
        if (path === "/v1/presentation-sessions") return { sessions: records };
        if (path.startsWith("/v1/survey-rooms?")) return { rooms: records, nextCursor: null };
        return response(path);
      });
      const harness = sessionsHarness();
      let markup = await harness.settle();
      expect(markup.match(/<article /g)).toHaveLength(25);
      expect(markup).not.toContain('<h2 lang="">Paged session 29</h2>');
      const reads = fixtures.apiFetch.mock.calls.length;
      clickButton("Load more sessions");
      markup = await harness.settle();
      expect(markup.match(/<article /g)).toHaveLength(30);
      expect(fixtures.apiFetch.mock.calls).toHaveLength(reads);
      expect(markup).not.toContain("Load more sessions");
      fixtures.query = `type=${type}&q=Paged+session+29`;
      markup = await harness.settle();
      expect(markup.match(/<article /g)).toHaveLength(1);
      expect(markup).toContain('<h2 lang="">Paged session 29</h2>');
      expect(fixtures.apiFetch.mock.calls).toHaveLength(reads);
      fixtures.query = `type=${type}`;
      markup = harness.render();
      expect(markup.match(/<article /g)).toHaveLength(25);
      expect(markup).toContain("Load more sessions");
    },
  );

  it.each(["presentations", "surveys"])(
    "immediately reuses loaded %s history for every local filter",
    async (type) => {
      fixtures.query = `type=${type}`;
      const secondSource = "44444444-4444-4444-8444-444444444444";
      const rows =
        type === "presentations"
          ? [
              presentation,
              {
                ...presentation,
                id: "second-presentation",
                presentationId: secondSource,
                title: "Closed history",
                code: "4567890",
                status: "finished",
                createdAt: "2026-10-02T12:00:00Z",
              },
            ]
          : [
              openSurvey,
              {
                ...closedSurvey,
                surveyId: secondSource,
                title: "Closed history",
                code: "4567890",
                closesAt: "2099-10-02T12:00:00Z",
              },
            ];
      fixtures.apiFetch.mockImplementation(async (path: string) => {
        if (path === "/v1/presentation-sessions") return { sessions: rows };
        if (path.startsWith("/v1/survey-rooms?"))
          return path.includes("cursor=")
            ? { rooms: [rows[1]], nextCursor: null }
            : { rooms: [rows[0]], nextCursor: "next-survey" };
        return response(path);
      });
      const harness = sessionsHarness();
      await harness.settle();
      const reads = fixtures.apiFetch.mock.calls.length;
      const dateYear = type === "presentations" ? "2026" : "2099";
      const firstTitle = type === "presentations" ? "First Presentation" : "Open Survey";
      const cases: Array<[Record<string, string>, string[]]> = [
        [{ q: "absent" }, []],
        [{ q: "7890" }, ["Closed history"]],
        [{ status: "active" }, [firstTitle]],
        [{ status: "finished" }, ["Closed history"]],
        [{ source: secondSource }, ["Closed history"]],
        [{ from: `${dateYear}-10-02`, to: `${dateYear}-10-02` }, ["Closed history"]],
        [
          {
            q: "Closed",
            status: "finished",
            source: secondSource,
            from: `${dateYear}-10-02`,
            to: `${dateYear}-10-02`,
          },
          ["Closed history"],
        ],
      ];
      for (const [filters, titles] of cases) {
        fixtures.query = new URLSearchParams({ type, ...filters }).toString();
        const immediate = harness.render();
        expect(immediate.match(/<h2 lang="">[^<]+<\/h2>/g) ?? []).toEqual(
          titles.map((title) => `<h2 lang="">${title}</h2>`),
        );
        expect(immediate).not.toContain("Loading sessions");
        await harness.settle();
        expect(fixtures.apiFetch.mock.calls).toHaveLength(reads);
      }
    },
  );

  it.each(["presentations", "surveys"])(
    "does not restart an in-flight %s history load when local filters change",
    async (type) => {
      fixtures.query = `type=${type}`;
      const pending = deferred<unknown>();
      fixtures.apiFetch.mockImplementation((path: string) => {
        if (path === "/v1/presentation-sessions" || path.includes("cursor=next-survey"))
          return pending.promise;
        return Promise.resolve(response(path));
      });
      const harness = sessionsHarness();
      await harness.settle();
      const request = fixtures.apiFetch.mock.calls.find(
        ([path]) =>
          path === "/v1/presentation-sessions" || String(path).includes("cursor=next-survey"),
      );
      const reads = fixtures.apiFetch.mock.calls.length;
      const source = type === "presentations" ? presentation.presentationId : openSurvey.surveyId;
      for (const filter of [
        "q=C",
        "q=Closed",
        "status=finished",
        `source=${source}&status=finished`,
        "q=Closed&status=finished&from=2026-01-01&to=2099-12-31",
      ]) {
        fixtures.query = `type=${type}&${filter}`;
        await harness.settle();
        expect(fixtures.apiFetch.mock.calls).toHaveLength(reads);
        expect(request?.[1].signal.aborted).toBe(false);
      }
      pending.resolve(
        type === "presentations"
          ? { sessions: [{ ...presentation, title: "Closed history", status: "finished" }] }
          : { rooms: [{ ...closedSurvey, title: "Closed history" }], nextCursor: null },
      );
      const markup = await harness.settle();
      expect(markup).toContain('<h2 lang="">Closed history</h2>');
      expect(markup).not.toContain("Loading sessions");
      expect(fixtures.apiFetch.mock.calls).toHaveLength(reads);
    },
  );

  it.each(["presentations", "surveys"])(
    "keeps a pending %s load failure visible after local filter changes",
    async (type) => {
      fixtures.query = `type=${type}`;
      const pending = deferred<unknown>();
      fixtures.apiFetch.mockImplementation((path: string) =>
        path === "/v1/presentation-sessions" || path.includes("cursor=next-survey")
          ? pending.promise
          : Promise.resolve(response(path)),
      );
      const harness = sessionsHarness();
      await harness.settle();
      fixtures.query = `type=${type}&q=changed&status=finished`;
      await harness.settle();
      pending.reject(new Error("History read failed"));
      let markup = await harness.settle();
      expect(markup).toContain('role="alert"');
      expect(markup).toContain("History read failed");
      expect(markup).not.toContain("No sessions match");
      const reads = fixtures.apiFetch.mock.calls.length;
      fixtures.query = `type=${type}&q=changed-again`;
      markup = await harness.settle();
      expect(markup).toContain("History read failed");
      expect(fixtures.apiFetch.mock.calls).toHaveLength(reads);
    },
  );

  it.each(["presentations", "surveys"])(
    "aborts stale %s reads on a workspace or tab change and reloads the selected history",
    async (type) => {
      fixtures.query = `type=${type}`;
      const stale = deferred<unknown>();
      let historyReads = 0;
      fixtures.apiFetch.mockImplementation((path: string) => {
        if (
          path === "/v1/presentation-sessions" ||
          (path.startsWith("/v1/survey-rooms?") && !path.includes("cursor="))
        ) {
          historyReads++;
          if (historyReads === 1) return stale.promise;
        }
        return Promise.resolve(response(path));
      });
      const harness = sessionsHarness();
      await harness.settle();
      const request = fixtures.apiFetch.mock.calls.find(
        ([path]) =>
          path === "/v1/presentation-sessions" || String(path).startsWith("/v1/survey-rooms?"),
      );
      fixtures.workspaceId = "workspace-b";
      let markup = await harness.settle();
      expect(request?.[1].signal.aborted).toBe(true);
      expect(historyReads).toBe(2);
      expect(markup).toContain(
        type === "presentations"
          ? '<h2 lang="">First Presentation</h2>'
          : '<h2 lang="">Closed Survey</h2>',
      );
      stale.resolve(
        type === "presentations"
          ? { sessions: [{ ...presentation, title: "Stale history" }] }
          : { rooms: [{ ...openSurvey, title: "Stale history" }], nextCursor: null },
      );
      markup = await harness.settle();
      expect(markup).not.toContain("Stale history");
      clickTab("rounds");
      await harness.settle();
      clickTab(type);
      markup = await harness.settle();
      expect(historyReads).toBe(3);
      expect(markup).not.toContain("Stale history");
    },
  );

  it("continues to request filtered Round history from the server on each query change", async () => {
    const harness = sessionsHarness();
    await harness.settle();
    for (const query of ["f", "first", "first round"]) {
      fixtures.query = new URLSearchParams({ type: "rounds", q: query }).toString();
      await harness.settle();
    }
    const historyReads = fixtures.apiFetch.mock.calls.filter(([path]) =>
      String(path).startsWith("/v1/sessions?"),
    );
    expect(historyReads).toHaveLength(4);
    expect(
      historyReads.map(([path]) => new URLSearchParams(String(path).split("?")[1]).get("search")),
    ).toEqual([null, "f", "first", "first round"]);
  });

  it.each(["presentations", "surveys"])(
    "discards a pending %s history response after changing tabs",
    async (type) => {
      fixtures.query = `type=${type}`;
      const stale = deferred<unknown>();
      let heldReads = 0;
      fixtures.apiFetch.mockImplementation((path: string) => {
        if (path === "/v1/presentation-sessions" || path.includes("cursor=next-survey")) {
          heldReads++;
          if (heldReads === 1) return stale.promise;
        }
        return Promise.resolve(response(path));
      });
      const harness = sessionsHarness();
      await harness.settle();
      const request = fixtures.apiFetch.mock.calls.find(
        ([path]) =>
          path === "/v1/presentation-sessions" || String(path).includes("cursor=next-survey"),
      );
      clickTab("rounds");
      await harness.settle();
      expect(request?.[1].signal.aborted).toBe(true);
      stale.resolve(
        type === "presentations"
          ? { sessions: [{ ...presentation, title: "Stale history" }] }
          : { rooms: [{ ...openSurvey, title: "Stale history" }], nextCursor: null },
      );
      let markup = await harness.settle();
      expect(markup).toContain('<h2 lang="">First Round</h2>');
      expect(markup).not.toContain("Stale history");
      clickTab(type);
      markup = await harness.settle();
      expect(heldReads).toBe(2);
      expect(markup).toContain(
        type === "presentations"
          ? '<h2 lang="">First Presentation</h2>'
          : '<h2 lang="">Closed Survey</h2>',
      );
      expect(markup).not.toContain("Stale history");
    },
  );

  it.each(["presentations", "surveys"])(
    "reconciles a deleted %s snapshot after local filter changes without reloading it",
    async (type) => {
      fixtures.query = `type=${type}`;
      const deletion = deferred<unknown>();
      let committed = false;
      fixtures.apiFetch.mockImplementation((path: string, init?: RequestInit) => {
        if (init?.method === "DELETE") return deletion.promise;
        if (path === "/v1/sessions/counts")
          return Promise.resolve({
            counts: {
              rounds: 77,
              presentations: type === "presentations" && committed ? 6 : 7,
              surveys: type === "surveys" && committed ? 54 : 55,
            },
          });
        if (path === "/v1/presentation-sessions")
          return Promise.resolve({
            sessions: [{ ...presentation, title: "Deletable history", status: "finished" }],
          });
        if (path.startsWith("/v1/survey-rooms?"))
          return Promise.resolve({
            rooms: [{ ...closedSurvey, title: "Deletable history" }],
            nextCursor: null,
          });
        return Promise.resolve(response(path));
      });
      const harness = sessionsHarness();
      await harness.settle();
      const historyReads = () =>
        fixtures.apiFetch.mock.calls.filter(
          ([path]) =>
            path === "/v1/presentation-sessions" || String(path).startsWith("/v1/survey-rooms?"),
        ).length;
      expect(historyReads()).toBe(1);
      clickButton(type === "presentations" ? "Delete session" : "Delete Survey run");
      fixtures.query = `type=${type}&q=Deletable&status=finished`;
      await harness.settle();
      expect(historyReads()).toBe(1);
      committed = true;
      deletion.resolve(undefined);
      let markup = await harness.settle();
      expect(markup).not.toContain('<h2 lang="">Deletable history</h2>');
      expect(markup).toContain(
        type === "presentations" ? "Presentations <span>6</span>" : "Surveys <span>54</span>",
      );
      expect(historyReads()).toBe(1);
      clickTab("rounds");
      await harness.settle();
      clickTab(type);
      markup = await harness.settle();
      expect(historyReads()).toBe(2);
      expect(markup).not.toContain('<h2 lang="">Deletable history</h2>');
    },
  );

  it("stops repeated Survey pagination cursors instead of looping", async () => {
    fixtures.query = "type=surveys";
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.startsWith("/v1/survey-rooms?")
        ? { rooms: [openSurvey], nextCursor: "repeat" }
        : response(path),
    );
    const markup = await sessionsHarness().settle();
    expect(
      fixtures.apiFetch.mock.calls.filter(([path]) => String(path).startsWith("/v1/survey-rooms?")),
    ).toHaveLength(2);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Sessions could not be loaded. Try again.");
  });

  it("immediately hides rows from a previous workspace while a new request is pending", async () => {
    const harness = sessionsHarness();
    await harness.settle();
    const next = deferred<unknown>();
    fixtures.workspaceId = "workspace-b";
    fixtures.apiFetch.mockImplementation((path: string) =>
      path.startsWith("/v1/sessions?") ? next.promise : Promise.resolve(response(path)),
    );
    const pending = harness.render();
    expect(pending).not.toContain("First Round");
    expect(pending).toContain('aria-label="Loading session count"');
    harness.flushEffects();
    next.resolve({ items: [round("later-round")], nextCursor: null });
    const markup = await harness.settle();
    expect(markup).toContain("Later Round");
    expect(markup).not.toContain("First Round");
  });

  it("keeps Survey viewer browsing read-only and expired rows free of dead result links", async () => {
    fixtures.role = "viewer";
    fixtures.query = "type=surveys";
    const markup = await sessionsHarness().settle();
    expect(markup).toContain('href="/results/surveys/survey-open"');
    expect(markup).toContain('href="/results/surveys/survey-closed"');
    expect(markup).not.toContain('href="/results/surveys/survey-expired"');
    expect(markup).not.toContain('href="/surveys/rooms/');
    expect(markup).not.toContain("Manage sharing");
    expect(markup).not.toContain("Delete Survey run");
    expect(markup).not.toContain("Participants");
    expect(markup).not.toContain("Answers received");
  });

  it("offers editor sharing only for open Surveys and owner deletion only after closure", async () => {
    fixtures.query = "type=surveys";
    fixtures.role = "editor";
    const harness = sessionsHarness();
    let markup = await harness.settle();
    expect(markup.match(/>Manage sharing<\/a>/g)).toHaveLength(1);
    expect(markup).toContain('href="/surveys/rooms/survey-open"');
    expect(markup).toContain('href="/results/surveys/survey-closed"');
    expect(markup).not.toContain("Delete Survey run");
    fixtures.role = "owner";
    markup = harness.render();
    expect(markup.match(/>Delete Survey run<\/button>/g)).toHaveLength(2);
  });

  it("keeps a pending resume scoped to the original query", async () => {
    const request = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path.endsWith("/control-pass")
        ? request.promise
        : path.startsWith("/v1/sessions?")
          ? Promise.resolve({ items: [{ ...round(), status: "active" }], nextCursor: null })
          : Promise.resolve(response(path)),
    );
    const harness = sessionsHarness();
    await harness.settle();
    clickButton("Resume Session");
    clickTab("surveys");
    await harness.settle();
    request.resolve({ token: "resume-token" });
    await harness.settle();
    expect(window.sessionStorage.setItem).not.toHaveBeenCalled();
    expect(fixtures.push).not.toHaveBeenCalledWith("/host/round-one");
  });

  it("deletes owner history through the typed endpoint and clears Round credentials", async () => {
    const harness = sessionsHarness();
    await harness.settle();
    clickButton("Delete session");
    const markup = await harness.settle();
    expect(
      fixtures.apiFetch.mock.calls.some(
        ([path, init]) => path === "/v1/sessions/round-one" && init.method === "DELETE",
      ),
    ).toBe(true);
    expect(window.sessionStorage.removeItem).toHaveBeenCalledWith("openround:host:round-one");
    expect(markup).not.toContain("First Round");
  });

  it("reconciles an acknowledged deletion with a different current filter", async () => {
    const deletion = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "DELETE" ? deletion.promise : Promise.resolve(response(path)),
    );
    const harness = sessionsHarness();
    await harness.settle();
    clickButton("Delete session");
    fixtures.query = "type=rounds&status=finished";
    let markup = await harness.settle();
    expect(markup).toContain('<h2 lang="">First Round</h2>');
    const request = fixtures.apiFetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(request?.[1].signal.aborted).toBe(false);
    deletion.resolve(undefined);
    markup = await harness.settle();
    expect(markup).not.toContain('<h2 lang="">First Round</h2>');
    expect(
      fixtures.apiFetch.mock.calls.filter(([path]) => path === "/v1/sessions/counts"),
    ).toHaveLength(2);
  });

  it("keeps a pending deletion alive across filter and type changes, then refreshes counts and its tombstone", async () => {
    const deletion = deferred<unknown>();
    let committed = false;
    fixtures.apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return deletion.promise;
      if (path === "/v1/sessions/counts")
        return Promise.resolve({
          counts: { rounds: committed ? 76 : 77, presentations: 7, surveys: 55 },
        });
      return Promise.resolve(response(path));
    });
    const harness = sessionsHarness();
    await harness.settle();
    clickButton("Delete session");
    fixtures.query = "type=rounds&status=finished";
    await harness.settle();
    clickButton("Deleting…");
    expect(
      fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(1);
    clickTab("surveys");
    await harness.settle();
    const request = fixtures.apiFetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(request?.[1].signal.aborted).toBe(false);
    committed = true;
    deletion.resolve(undefined);
    let markup = await harness.settle();
    expect(markup).toContain('<h2 lang="">Closed Survey</h2>');
    expect(markup).toContain("Rounds <span>76</span>");
    expect(markup).toContain("Surveys <span>55</span>");
    expect(window.sessionStorage.removeItem).toHaveBeenCalledWith("openround:host:round-one");
    clickTab("rounds");
    markup = await harness.settle();
    expect(markup).not.toContain('<h2 lang="">First Round</h2>');
    expect(
      fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(1);
  });

  it("does not reconcile a completed deletion into a different workspace with the same row ID", async () => {
    const deletion = deferred<unknown>();
    let committed = false;
    const countWorkspaces: string[] = [];
    fixtures.apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return deletion.promise;
      if (path === "/v1/sessions/counts") {
        countWorkspaces.push(fixtures.workspaceId);
        return Promise.resolve({
          counts: {
            rounds: fixtures.workspaceId === "workspace-b" ? 99 : committed ? 76 : 77,
            presentations: 7,
            surveys: 55,
          },
        });
      }
      return Promise.resolve(response(path));
    });
    const harness = sessionsHarness();
    await harness.settle();
    clickButton("Delete session");
    fixtures.workspaceId = "workspace-b";
    await harness.settle();
    committed = true;
    deletion.resolve(undefined);
    let markup = await harness.settle();
    expect(markup).toContain('<h2 lang="">First Round</h2>');
    expect(markup).toContain("Rounds <span>99</span>");
    expect(countWorkspaces).toEqual(["workspace-a", "workspace-b"]);
    fixtures.workspaceId = "workspace-a";
    markup = await harness.settle();
    expect(markup).not.toContain('<h2 lang="">First Round</h2>');
    expect(markup).toContain("Rounds <span>76</span>");
    expect(countWorkspaces).toEqual(["workspace-a", "workspace-b", "workspace-a"]);
  });

  it("stores a Sessions view per workspace separately from the Library preference", async () => {
    const harness = sessionsHarness();
    await harness.settle();
    clickButton("List");
    expect(harness.render()).toContain('data-view="list"');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      "openround:sessions-view:v1:workspace-a",
      "list",
    );
    fixtures.workspaceId = "workspace-b";
    expect(harness.render()).not.toContain('data-view="list"');
  });
});

function sessionsHarness() {
  const hooks: SessionHooks = { cursor: 0, slots: [], pendingEffects: [] };
  const render = () => {
    hooks.cursor = 0;
    fixtures.hooks = hooks;
    try {
      return renderToStaticMarkup(<SessionsPage />);
    } finally {
      fixtures.hooks = null;
    }
  };
  const flushEffects = () => hooks.pendingEffects.splice(0).forEach((effect) => effect());
  const settle = async () => {
    for (let index = 0; index < 16; index++) {
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
  if (!button)
    throw new Error(
      `Expected button: ${name}; saw ${elements(fixtures.tree)
        .filter((row) => row.type === "button")
        .map((row) => elementText(row.props.children as ReactNode))
        .join(", ")}`,
    );
  (button.props as ComponentProps<"button">).onClick?.(
    {} as Parameters<NonNullable<ComponentProps<"button">["onClick"]>>[0],
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
