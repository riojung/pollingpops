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
import type { SupportedLocale } from "@openround/contracts";
import { createdPackPractice } from "../../test-utils/recovery-pack-practice";
import { packPracticeDetailCopy } from "../../lib/i18n/pack-practice-detail-copy";

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
  locale: "en-CA" as SupportedLocale,
  presentationsEnabled: true,
  surveysEnabled: true,
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
      locale: fixtures.locale,
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
    productFeatures: {
      presentations: fixtures.presentationsEnabled,
      surveys: fixtures.surveysEnabled,
    },
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

const reportTotalsPath = "/v1/reports/totals";
const practiceAnalyticsPath = "/v1/followups/analytics";

function matchesRequest(path: string, endpoint: string) {
  return path === endpoint || path.startsWith(`${endpoint}?`);
}

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
const presentationResultsPath = "/v1/presentation-sessions/results";
const presentationAnalyticsPath = `${presentationResultsPath}/analytics`;
const presentationSourcesPath = `${presentationResultsPath}/sources`;
const presentation = {
  id: "presentation-first",
  presentationId: "presentation-source",
  title: "First Presentation result",
  status: "finished",
  reportStatus: "ready",
  phase: "finished",
  participantCount: 5,
  responseCount: 5,
  blockCount: 2,
  createdAt: "2026-10-10T12:00:00Z",
};
function survey(id = "survey-first", title = "First Survey result") {
  return {
    id,
    surveyId: "survey-source",
    title,
    code: "654321",
    closed: true,
    closesAt: "2026-10-10T12:00:00Z",
    expiresAt: "2099-10-10T12:00:00Z",
  };
}
function reportAnalytics(ready = 2, pending = 0, failed = 0) {
  const count = ready + pending + failed;
  const periods = count > 0 ? [{ start: "2026-10-01", count }] : [];
  return { ready, pending, failed, activity: { month: periods, quarter: periods } };
}
function practiceAnalytics(open = 2) {
  const periods = open > 0 ? [{ start: "2026-10-01", count: open }] : [];
  return {
    open,
    scheduled: 0,
    closed: 0,
    expired: 0,
    attemptCount: open * 3,
    completedAttemptCount: open * 2,
    activity: { month: periods, quarter: periods },
  };
}
function presentationAnalytics(active: number, finished: number, participantJoins: number) {
  const count = active + finished;
  const periods = count > 0 ? [{ start: "2026-10-01", count }] : [];
  return { active, finished, participantJoins, activity: { month: periods, quarter: periods } };
}
function response(path: string) {
  if (path.startsWith("/v1/quizzes?"))
    return { quizzes: [{ id: "round-source", title: "Source Round" }] };
  if (matchesRequest(path, reportTotalsPath)) {
    const search = new URLSearchParams(path.split("?")[1]).get("search");
    return reportAnalytics(search === "missing" ? 0 : 2);
  }
  if (matchesRequest(path, practiceAnalyticsPath)) {
    const search = new URLSearchParams(path.split("?")[1]).get("search");
    return practiceAnalytics(search === "missing" ? 0 : 2);
  }
  if (path.startsWith("/v1/reports?"))
    return path.includes("cursor=")
      ? { items: [report("report-later", "Later Round result")], nextCursor: null }
      : { items: [report()], nextCursor: "report-next" };
  if (path.startsWith("/v1/followups?"))
    return path.includes("cursor=")
      ? { items: [practice("practice-later", "Later practice")], nextCursor: null }
      : { items: [practice()], nextCursor: "practice-next" };
  if (matchesRequest(path, presentationAnalyticsPath)) {
    const search = new URLSearchParams(path.split("?")[1]).get("search");
    return search === "missing" ? presentationAnalytics(0, 0, 0) : presentationAnalytics(1, 1, 12);
  }
  if (matchesRequest(path, presentationSourcesPath)) {
    return {
      sources: [
        { id: "presentation-source", title: "Source Presentation" },
        { id: "older-source", title: "Older Presentation source" },
      ],
    };
  }
  if (matchesRequest(path, presentationResultsPath)) {
    const query = new URLSearchParams(path.split("?")[1]);
    const older = {
      ...presentation,
      id: "presentation-later",
      title: "Later Presentation result",
      presentationId: "older-source",
    };
    if (query.get("search") === "missing") return { items: [], nextCursor: null };
    if (query.has("cursor") || query.get("presentationId") === "older-source")
      return { items: [older], nextCursor: null };
    return { items: [presentation], nextCursor: "presentation-next" };
  }
  if (path.startsWith("/v1/survey-rooms?")) return { rooms: [survey()], nextCursor: null };
  throw new Error(`Unexpected request: ${path}`);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-10-14T12:00:00Z").getTime());
  fixtures.workspaceId = "workspace-a";
  fixtures.locale = "en-CA";
  fixtures.presentationsEnabled = true;
  fixtures.surveysEnabled = true;
  fixtures.query = "";
  fixtures.hooks = null;
  fixtures.pendingEffects = [];
  fixtures.tree = null;
  fixtures.apiFetch.mockReset().mockImplementation(async (path: string) => response(path));
  fixtures.replace.mockReset().mockImplementation((href: string) => {
    fixtures.query = href.split("?")[1] ?? "";
  });
  vi.stubGlobal("window", {
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  });
});
afterEach(() => {
  fixtures.hooks = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Results workspace", () => {
  it.each([
    { view: "practice", endpoints: ["/v1/followups", practiceAnalyticsPath] },
    { view: "presentations", endpoints: [presentationResultsPath, presentationAnalyticsPath] },
  ])(
    "coalesces $view search typing into one scoped list read and one analytics read",
    async ({ view, endpoints }) => {
      fixtures.query = `view=${view}&q=First`;
      const harness = resultsHarness();
      const searchReads = (endpoint: string) =>
        historyCalls(endpoint).map(([url]) => new URLSearchParams(url.split("?")[1]).get("search"));
      await harness.settle();
      for (const endpoint of endpoints) expect(searchReads(endpoint)).toEqual(["First"]);

      for (const value of ["R", "Re", "  Review  "]) {
        changeSearch(value);
        await harness.settle();
        expect(new URLSearchParams(fixtures.query).get("q")).toBe(value);
        vi.advanceTimersByTime(100);
      }
      vi.advanceTimersByTime(149);
      await harness.settle();
      for (const endpoint of endpoints) expect(searchReads(endpoint)).toEqual(["First"]);

      vi.advanceTimersByTime(1);
      await harness.settle();
      for (const endpoint of endpoints) expect(searchReads(endpoint)).toEqual(["First", "Review"]);

      changeSearch("Pending edit");
      await harness.settle();
      clickButton("Clear filters");
      await harness.settle();
      for (const endpoint of endpoints)
        expect(searchReads(endpoint)).toEqual(["First", "Review", null]);
      vi.advanceTimersByTime(250);
      await harness.settle();
      for (const endpoint of endpoints)
        expect(searchReads(endpoint)).toEqual(["First", "Review", null]);
      harness.dispose();
    },
  );

  it("shows full-history Practice counts and attempt-weighted completion while the list loads", async () => {
    fixtures.query = "view=practice";
    const firstPage = deferred<unknown>();
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (matchesRequest(path, "/v1/followups") && !path.includes("cursor="))
        return firstPage.promise;
      if (matchesRequest(path, practiceAnalyticsPath)) {
        return {
          open: 20,
          scheduled: 3,
          closed: 6,
          expired: 1,
          attemptCount: 80,
          completedAttemptCount: 21,
          activity: {
            month: [
              { start: "2026-10-01", count: 28 },
              { start: "2026-11-01", count: 2 },
            ],
            quarter: [{ start: "2026-10-01", count: 30 }],
          },
        };
      }
      return response(path);
    });
    const harness = resultsHarness();
    const loading = await harness.settle();
    expect(resultsPanel().props["aria-busy"]).toBeUndefined();
    expect(resultsBusyScope("practice").props["aria-busy"]).toBe(true);
    expect(loading).toContain(
      "Practice totals and activity include every page matching your filters.",
    );
    expect(loading).toContain("Grouped by practice creation date in UTC.");
    expect(loading).toContain("<dt>Matching practice items</dt><dd>30</dd>");
    expect(loading).toContain("Scheduled<strong>3</strong>");
    expect(loading).toContain("21 completed of 80 attempts");
    expect(loading).toContain('aria-valuenow="26.25"');
    expect(loading).not.toContain("First practice");
    expect(activityCounts()).toEqual(["28", "2"]);

    firstPage.resolve(response("/v1/followups?limit=25"));
    await harness.settle();
    clickButton("Load More Practice");
    const after = await harness.settle();
    expect(after).toContain("Later practice");
    expect(after).toContain("21 completed of 80 attempts");
    expect(activityCounts()).toEqual(["28", "2"]);
    changeField("Group by", "quarter");
    await harness.settle();
    expect(activityCounts()).toEqual(["30"]);
    expect(historyCalls(practiceAnalyticsPath)).toHaveLength(1);
    harness.dispose();
  });

  it("discards a retried Practice aggregate after the workspace switches", async () => {
    fixtures.query = "view=practice";
    const obsolete = deferred<unknown>();
    let reads = 0;
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (matchesRequest(path, practiceAnalyticsPath)) {
        const params = new URLSearchParams(path.split("?")[1]);
        if (params.get("expectedWorkspaceId") === "workspace-b") return practiceAnalytics(7);
        if (++reads === 1) throw new Error("Practice analytics unavailable");
        return obsolete.promise;
      }
      return response(path);
    });
    const harness = resultsHarness();
    const failed = await harness.settle();
    expect(failed).toContain("Practice totals and activity could not load.");
    expect(failed).toContain("<dt>Results shown</dt><dd>1</dd>");
    expect(failed).toContain("2 completed of 3 attempts");
    expect(activityCounts()).toEqual([]);
    clickButton("Retry practice analytics");
    expect(await harness.settle()).toContain("Loading practice totals and activity…");
    expect(historyCalls("/v1/followups")).toHaveLength(1);
    const pending = historyCalls(practiceAnalyticsPath).at(-1)!;

    fixtures.workspaceId = "workspace-b";
    expect(await harness.settle()).toContain("<dt>Matching practice items</dt><dd>7</dd>");
    expect(pending[1].signal?.aborted).toBe(true);
    obsolete.resolve(practiceAnalytics(88));
    expect(await harness.settle()).not.toContain("<dt>Matching practice items</dt><dd>88</dd>");
    expect(activityCounts()).toEqual(["7"]);
    harness.dispose();
  });

  it("uses exact Round activity across pages and switches grouping without another request", async () => {
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      matchesRequest(path, reportTotalsPath)
        ? {
            ...reportAnalytics(28, 3, 1),
            activity: {
              month: [
                { start: "2026-10-01", count: 25 },
                { start: "2026-11-01", count: 7 },
              ],
              quarter: [{ start: "2026-10-01", count: 32 }],
            },
          }
        : response(path),
    );
    const harness = resultsHarness();
    const before = await harness.settle();
    expect(before).toContain(
      "Report totals and activity include every page matching your filters.",
    );
    expect(before).toContain("Grouped by report creation date in UTC.");
    expect(before).toContain("Participant joins, recovery, and follow-ups use loaded reports.");
    expect(before).toContain("<dt>Matching reports</dt><dd>32</dd>");
    expect(before).toContain("Ready<strong>28</strong>");
    expect(before).toContain("Processing<strong>3</strong>");
    expect(before).toContain("Needs attention<strong>1</strong>");
    expect(before).toContain("<dt>Participant joins</dt><dd>5<");
    expect(before).toContain("1 results shown · More available");
    expect(activityCounts()).toEqual(["25", "7"]);

    clickButton("Load More");
    const after = await harness.settle();
    expect(after).toContain("<dt>Matching reports</dt><dd>32</dd>");
    expect(after).toContain("<dt>Participant joins</dt><dd>10<");
    expect(after).toContain("Later Round result");
    expect(activityCounts()).toEqual(["25", "7"]);
    changeField("Group by", "quarter");
    await harness.settle();
    expect(activityCounts()).toEqual(["32"]);
    expect(historyCalls(reportTotalsPath)).toHaveLength(1);
    const pagination = new URLSearchParams(historyCalls("/v1/reports").at(-1)![0].split("?")[1]);
    expect(pagination.get("expectedWorkspaceId")).toBe("workspace-a");
    expect(pagination.get("cursor")).toBe("report-next");
    harness.dispose();
  });

  it("uses the Round list filters for totals and ignores obsolete workspace responses", async () => {
    const previousTotals = deferred<unknown>();
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (matchesRequest(path, reportTotalsPath)) {
        const params = new URLSearchParams(path.split("?")[1]);
        if (!params.has("search")) return previousTotals.promise;
        return reportAnalytics(params.get("expectedWorkspaceId") === "workspace-a" ? 29 : 7);
      }
      return response(path);
    });
    const harness = resultsHarness();
    expect(await harness.settle()).toContain("Loading report totals and activity…");
    expect(activityCounts()).toEqual([]);
    const first = historyCalls(reportTotalsPath)[0]!;
    changeField("Result Status", "ready");
    changeField("Round", "round-source");
    changeField("From", "2026-10-01");
    changeField("To", "2026-10-31");
    changeSearch("First");
    expect(await harness.settle()).toContain("<dt>Matching reports</dt><dd>29</dd>");
    expect(first[1].signal?.aborted).toBe(true);
    const listUrl = historyCalls("/v1/reports").at(-1)![0];
    const totalsUrl = historyCalls(reportTotalsPath).at(-1)![0];
    const listParams = new URLSearchParams(listUrl.split("?")[1]);
    expect(listParams.get("limit")).toBe("25");
    listParams.delete("limit");
    const totalsParams = new URLSearchParams(totalsUrl.split("?")[1]);
    expect(totalsParams.get("includeActivity")).toBe("true");
    totalsParams.delete("includeActivity");
    expect(totalsParams.toString()).toBe(listParams.toString());
    expect(listParams.get("search")).toBe("First");
    expect(listParams.get("expectedWorkspaceId")).toBe("workspace-a");
    expect(listParams.get("status")).toBe("ready");
    expect(listParams.get("quizId")).toBe("round-source");
    expect(listParams.get("from")).toBe(new Date("2026-10-01T00:00:00").toISOString());
    expect(listParams.get("to")).toBe(new Date("2026-10-31T23:59:59.999").toISOString());

    fixtures.workspaceId = "workspace-b";
    expect(harness.render()).not.toContain("<dt>Matching reports</dt><dd>29</dd>");
    previousTotals.resolve(reportAnalytics(88));
    const after = await harness.settle();
    expect(after).toContain("<dt>Matching reports</dt><dd>7</dd>");
    expect(after).not.toContain("<dt>Matching reports</dt><dd>88</dd>");
    expect(activityCounts()).toEqual(["7"]);
    for (const endpoint of ["/v1/reports", reportTotalsPath]) {
      const params = new URLSearchParams(historyCalls(endpoint).at(-1)![0].split("?")[1]);
      expect(params.get("expectedWorkspaceId")).toBe("workspace-b");
    }
    harness.dispose();
  });

  it("retries a failed totals request independently while keeping Round results usable", async () => {
    let totalsReads = 0;
    const pendingRetry = deferred<unknown>();
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (matchesRequest(path, reportTotalsPath)) {
        if (++totalsReads === 1) throw new Error("Totals unavailable");
        return pendingRetry.promise;
      }
      return response(path);
    });
    const harness = resultsHarness();
    const before = await harness.settle();
    expect(before).toContain("Report totals and activity could not load.");
    expect(before).toContain("<dt>Results shown</dt><dd>1</dd>");
    expect(before).toContain('href="/report/report-first"');
    expect(before).not.toContain("Matching reports");
    expect(activityCounts()).toEqual([]);

    const heading = elements(fixtures.tree).find(
      (node) =>
        node.type === "h2" && elementText(node.props.children as ReactNode) === "Results analytics",
    )!;
    const focus = attachFocus(heading);
    clickButton("Retry report analytics");
    expect(focus).toHaveBeenCalledOnce();
    expect(await harness.settle()).toContain("Loading report totals and activity…");
    expect(historyCalls("/v1/reports")).toHaveLength(1);
    pendingRetry.resolve(reportAnalytics(27));
    expect(await harness.settle()).toContain("<dt>Matching reports</dt><dd>27</dd>");
    expect(activityCounts()).toEqual(["27"]);
    expect(totalsReads).toBe(2);
    harness.dispose();
  });

  it.each([
    { status: "ready", tone: "positive", label: "Ready", action: "result" },
    { status: "pending", tone: "warning", label: "Processing", action: "view" },
    { status: "failed", tone: "danger", label: "Needs attention", action: "view" },
  ])(
    "uses the actual $status report state while preserving zero and missing evidence",
    async ({ status, tone, label, action }) => {
      fixtures.apiFetch.mockImplementation(async (path: string) =>
        path.startsWith("/v1/reports?")
          ? {
              items: [
                {
                  ...report(),
                  status,
                  initialAccuracyPercent: 0,
                  recovery: { recovered: 0, eligible: 10, percent: 0 },
                },
              ],
              nextCursor: null,
            }
          : response(path),
      );
      await resultsHarness().settle();
      const card = elements(fixtures.tree).find((node) => node.type === "article")!;
      const markup = renderToStaticMarkup(card);
      expect(card.props["data-kind"]).toBe("round");
      expect(card.props["data-state-tone"]).toBe(tone);
      expect(markup).toContain(
        `data-status="${status}" data-tone="${status}" data-state-tone="${tone}"`,
      );
      expect(markup).toContain(`</svg>${label}</span>`);
      expect(markup).toMatch(/aria-hidden="true"[^>]*data-icon="[^"]+"[^>]*focusable="false"/);
      expect(markup).toContain(`data-action="${action}" href="/report/report-first"`);
      expect(markup).not.toContain('data-action="resume"');
      if (status === "ready") {
        expect(markup).toContain('aria-valuenow="0"');
        expect(markup).toContain("0%");
      } else {
        expect(markup).not.toContain('role="meter"');
        expect(markup).not.toContain("0%");
        expect(markup).toContain("No evidence recorded");
      }
    },
  );

  it.each([
    { view: "practice", kind: "practice", status: "open", tone: "active", label: "Open" },
    {
      view: "presentations",
      kind: "presentation",
      status: "finished",
      tone: "neutral",
      label: "Finished",
    },
    { view: "surveys", kind: "survey", status: "closed", tone: "neutral", label: "Closed" },
  ])(
    "preserves $view lifecycle signals in grid and list Results",
    async ({ view, kind, status, tone, label }) => {
      fixtures.query = `view=${view}`;
      const harness = resultsHarness();
      for (const layout of ["grid", "list"]) {
        if (layout === "list") clickButton("List view");
        const markup = await harness.settle();
        expect(markup).toContain(`data-view="${layout}"`);
        const card = elements(fixtures.tree).find((node) => node.type === "article")!;
        const cardMarkup = renderToStaticMarkup(card);
        expect(card.props["data-kind"]).toBe(kind);
        expect(card.props["data-state-tone"]).toBe(tone);
        expect(cardMarkup).toContain(
          `data-status="${status}" data-tone="${status}" data-state-tone="${tone}"`,
        );
        expect(cardMarkup).toContain(`</svg>${label}</span>`);
        expect(cardMarkup).not.toContain('data-action="resume"');
        if (view === "practice") {
          expect(cardMarkup).toContain('data-action="view" href="/practice/practice-first"');
          expect(cardMarkup).not.toContain('data-action="edit"');
        }
      }
    },
  );

  it.each([
    { view: "results", path: "/v1/reports", title: "First Round result" },
    { view: "practice", path: "/v1/followups", title: "First practice" },
    {
      view: "presentations",
      path: presentationResultsPath,
      title: "First Presentation result",
    },
    { view: "surveys", path: "/v1/survey-rooms", title: "First Survey result" },
  ])(
    "keeps $view loading, failure, and held retry distinct from zero results",
    async ({ view, path, title }) => {
      fixtures.query = `view=${view}&q=First`;
      vi.mocked(window.localStorage.getItem).mockReturnValue("list");
      const initial = deferred<unknown>();
      const pendingRetry = deferred<unknown>();
      let reads = 0;
      fixtures.apiFetch.mockImplementation((url: string) => {
        if (matchesRequest(url, path)) {
          reads++;
          return reads === 1 ? initial.promise : pendingRetry.promise;
        }
        return Promise.resolve(response(url));
      });
      const harness = resultsHarness();
      const loadingMarkup = await harness.settle();
      expect(resultsBusyScope(view).props["aria-busy"]).toBe(true);
      expect(resultsPanel().props["aria-labelledby"]).toBe(`results-${view}-link`);
      expect(
        elements(fixtures.tree).filter((node) => node.props.id === "results-panel"),
      ).toHaveLength(1);
      expect(
        elements(fixtures.tree).find((node) => node.props.id === `results-${view}-link`)?.props[
          "aria-current"
        ],
      ).toBe("page");
      expect(loadingMarkup).not.toMatch(/0 (?:results|practice items) shown|No .+ yet/);
      if (view === "results") {
        expect(resultsPanel().props["aria-busy"]).toBeUndefined();
        expect(
          elements(resultsBusyScope(view)).some(
            (node) => node.props["aria-label"] === "Results analytics",
          ),
        ).toBe(false);
        expect(loadingMarkup).toContain("<dt>Matching reports</dt><dd>2</dd>");
        expect(loadingMarkup).not.toContain("<dt>Participant joins</dt>");
        expect(activityCounts()).toEqual(["2"]);
      }
      const placeholders = elements(fixtures.tree).find(
        (node) => node.props["aria-hidden"] === "true" && node.props["data-view"] === "list",
      );
      expect(placeholders).toBeDefined();
      expect(
        elements(placeholders).filter((node) =>
          node.props.className?.toString().includes("loadingCard"),
        ),
      ).toHaveLength(3);
      initial.reject(new Error("Connection interrupted"));
      const failedMarkup = await harness.settle();
      expect(failedMarkup).toContain("Connection interrupted");
      if (view === "results") {
        expect(failedMarkup).toContain("<dt>Matching reports</dt><dd>2</dd>");
        expect(failedMarkup).not.toContain("<dt>Participant joins</dt>");
        expect(activityCounts()).toEqual(["2"]);
      }
      expect(failedMarkup).not.toMatch(/0 (?:results|practice items) shown|No .+ yet/);
      expect(resultsBusyScope(view).props["aria-busy"]).toBe(false);
      expect(failedMarkup).not.toContain(`<h2 lang="">${title}</h2>`);
      const focus = attachFocus(resultsPanel());
      clickButton("Try again");
      expect(focus).toHaveBeenCalledOnce();
      expect(harness.render()).not.toContain("Connection interrupted");
      expect(resultsBusyScope(view).props["aria-busy"]).toBe(true);
      const pendingMarkup = await harness.settle();
      expect(pendingMarkup).not.toContain("Try again");
      expect(pendingMarkup).not.toMatch(/0 (?:results|practice items) shown/);
      const requests = fixtures.apiFetch.mock.calls.filter(([url]) => matchesRequest(url, path));
      expect(requests).toHaveLength(2);
      expect(requests[1]![0]).toBe(requests[0]![0]);
      expect(requests.every(([, options]) => !options.method || options.method === "GET")).toBe(
        true,
      );
      pendingRetry.resolve(response(requests[1]![0]));
      const markup = await harness.settle();
      expect(markup).toContain(`<h2 lang="">${title}</h2>`);
      expect(markup).not.toContain("Connection interrupted");
      expect(resultsBusyScope(view).props["aria-busy"]).toBe(false);
      expect(
        elements(fixtures.tree).some((node) =>
          node.props.className?.toString().includes("loadingCard"),
        ),
      ).toBe(false);
      expect(markup).toContain('data-view="list"');
      if (view === "results") expect(historyCalls(reportTotalsPath)).toHaveLength(1);
      expect(new URLSearchParams(fixtures.query).get("q")).toBe("First");
      harness.dispose();
    },
  );

  it.each([
    { view: "results", path: "/v1/reports", empty: "No results yet", destination: "/library" },
    { view: "practice", path: "/v1/followups", empty: "No practice yet", destination: null },
    {
      view: "presentations",
      path: presentationResultsPath,
      empty: "No Presentation results yet",
      destination: "/library?type=presentations",
    },
    {
      view: "surveys",
      path: "/v1/survey-rooms",
      empty: "No Survey results yet",
      destination: "/sessions?type=surveys",
    },
  ])(
    "keeps successful empty $view evidence and its existing next step",
    async ({ view, path, empty, destination }) => {
      fixtures.query = `view=${view}`;
      fixtures.apiFetch.mockImplementation(async (url: string) => {
        if (matchesRequest(url, reportTotalsPath)) return reportAnalytics(0);
        if (matchesRequest(url, practiceAnalyticsPath)) return practiceAnalytics(0);
        if (matchesRequest(url, presentationAnalyticsPath)) return presentationAnalytics(0, 0, 0);
        if (!matchesRequest(url, path)) return response(url);
        if (view === "surveys") return { rooms: [], nextCursor: null };
        return { items: [], nextCursor: null };
      });
      const harness = resultsHarness();
      const markup = await harness.settle();
      expect(headings()).toEqual([empty]);
      if (view === "results") expect(markup).toContain("No reports match these filters.");
      if (view === "practice") expect(markup).toContain("No practice items match these filters.");
      if (view === "presentations")
        expect(markup).toContain("No Presentation sessions match these filters.");
      expect(markup).toContain(view === "practice" ? "0 practice items shown" : "0 results shown");
      expect(resultsBusyScope(view).props["aria-busy"]).toBe(false);
      expect(markup).not.toContain("Clear filters");
      if (destination) expect(markup).toContain(`<a class="button" href="${destination}">`);
      harness.dispose();
    },
  );

  it.each([
    {
      view: "results",
      path: "/v1/reports",
      title: "First Round result",
      source: "Round",
      sourceId: "round-source",
      status: "Result Status",
      statusValue: "ready",
    },
    {
      view: "practice",
      path: "/v1/followups",
      title: "First practice",
      source: "Round",
      sourceId: "round-source",
      status: "Practice Status",
      statusValue: "open",
    },
    {
      view: "presentations",
      path: presentationResultsPath,
      title: "First Presentation result",
      source: "Presentation",
      sourceId: "presentation-source",
      status: "Status",
      statusValue: "finished",
    },
    {
      view: "surveys",
      path: "/v1/survey-rooms",
      title: "First Survey result",
      source: "Survey",
      sourceId: "survey-source",
      status: null,
      statusValue: "",
    },
  ])(
    "recovers filtered empty $view from either reset with search focus, layout, and chart grouping",
    async ({ view, path, title, source, sourceId, status, statusValue }) => {
      fixtures.query = `view=${view}`;
      fixtures.apiFetch.mockImplementation(async (url: string) => {
        if (
          (view === "results" || view === "practice") &&
          matchesRequest(url, path) &&
          new URLSearchParams(url.split("?")[1]).get("search") === "missing"
        )
          return { items: [], nextCursor: null };
        return response(url);
      });
      const harness = resultsHarness();
      await harness.settle();
      clickButton("List view");
      expect(field("Group by")?.props.value).toBe("month");
      changeField("Group by", "quarter");
      harness.render();
      expect(field("Group by")?.props.value).toBe("quarter");
      const search = elements(fixtures.tree).find(
        (node) => node.type === "input" && node.props.type === "search",
      )!;
      const focus = attachFocus(search);
      for (const reset of ["toolbar", "empty"] as const) {
        if (status) changeField(status, statusValue);
        changeField(source, sourceId);
        changeField(view === "surveys" ? "Collection deadline from" : "From", "2026-10-01");
        changeField(view === "surveys" ? "Collection deadline to" : "To", "2026-10-31");
        changeSearch("missing");
        if (view === "practice" || view === "presentations") elapseHistorySearchDelay(harness);
        if (view !== "surveys") {
          harness.render();
          expect(resultsBusyScope(view).props["aria-busy"]).toBe(true);
          expect(field("Group by")).toBeUndefined();
        }
        const markup = await harness.settle();
        expect(field("Group by")).toBeUndefined();
        expect(headings()).toEqual([
          view === "practice"
            ? "No practice matches these filters."
            : "No results match these filters.",
        ]);
        expect(markup).toContain(
          view === "practice" ? "0 practice items shown" : "0 results shown",
        );
        const buttons = elements(fixtures.tree).filter(
          (node) =>
            node.type === "button" &&
            elementText(node.props.children as ReactNode) === "Clear filters",
        );
        expect(buttons).toHaveLength(2);
        const button = buttons.find(
          (node) => (node.props.className === "button") === (reset === "empty"),
        )!;
        (button.props.onClick as () => void)();
        expect(focus).toHaveBeenCalledTimes(reset === "toolbar" ? 1 : 2);
        const restored = await harness.settle();
        expect(restored).toContain(`<h2 lang="">${title}</h2>`);
        expect(restored).toContain('data-view="list"');
        expect(field("Group by")?.props.value).toBe("quarter");
        expect(new URLSearchParams(fixtures.query).get("view")).toBe(view);
        expect(new URLSearchParams(fixtures.query).has("q")).toBe(false);
        const filterFields = elements(historyFilters()).filter(
          (node) => node.type === "select" || (node.type === "input" && node.props.type === "date"),
        );
        expect(filterFields).toHaveLength(status ? 4 : 3);
        expect(
          filterFields.every((node) => node.props.value === (node.type === "select" ? "all" : "")),
        ).toBe(true);
      }
      if (view === "surveys")
        expect(
          fixtures.apiFetch.mock.calls.filter(([url]) => matchesRequest(url, path)),
        ).toHaveLength(1);
      harness.dispose();
    },
  );

  it.each([
    {
      view: "results",
      path: "/v1/reports",
      title: "First Round result",
      later: "Later Round result",
      more: "Load More",
    },
    {
      view: "practice",
      path: "/v1/followups",
      title: "First practice",
      later: "Later practice",
      more: "Load More Practice",
    },
    {
      view: "presentations",
      path: presentationResultsPath,
      title: "First Presentation result",
      later: "Later Presentation result",
      more: "Load More",
    },
  ])(
    "retains $view rows and retries the failed cursor",
    async ({ view, path, title, later, more }) => {
      fixtures.query = `view=${view}`;
      let failed = false;
      const pendingRetry = deferred<unknown>();
      fixtures.apiFetch.mockImplementation(async (url: string) => {
        if (matchesRequest(url, path) && url.includes("cursor=")) {
          if (!failed) {
            failed = true;
            throw new Error("Next page unavailable");
          }
          return pendingRetry.promise;
        }
        return response(url);
      });
      const harness = resultsHarness();
      await harness.settle();
      clickButton(more);
      let markup = await harness.settle();
      expect(markup).toContain(`<h2 lang="">${title}</h2>`);
      expect(markup).toContain("Previously loaded results remain below.");
      const count = view === "practice" ? "1 practice items shown" : "1 results shown";
      expect(markup).toContain(`${count} · More available`);
      expect(resultsBusyScope(view).props["aria-busy"]).toBe(false);
      const focus = attachFocus(resultsPanel());
      clickButton("Try again");
      expect(focus).toHaveBeenCalledOnce();
      markup = await harness.settle();
      expect(resultsBusyScope(view).props["aria-busy"]).toBe(true);
      expect(markup).toContain(`<h2 lang="">${title}</h2>`);
      expect(markup).toContain(`${count} · More available`);
      expect(markup).not.toContain("Next page unavailable");
      expect(markup).not.toContain("Try again");
      expect(
        elements(fixtures.tree).some((node) =>
          node.props.className?.toString().includes("loadingCard"),
        ),
      ).toBe(false);
      expect(
        elements(fixtures.tree).find(
          (node) =>
            node.type === "button" && elementText(node.props.children as ReactNode) === "Loading",
        )?.props[view === "presentations" ? "aria-disabled" : "disabled"],
      ).toBe(true);
      pendingRetry.resolve(response(historyCalls(path).at(-1)![0]));
      markup = await harness.settle();
      expect(markup).toContain(`<h2 lang="">${title}</h2>`);
      expect(markup).toContain(`<h2 lang="">${later}</h2>`);
      expect(resultsBusyScope(view).props["aria-busy"]).toBe(false);
      const calls = historyCalls(path);
      expect(calls.at(-1)![0]).toBe(calls.at(-2)![0]);
      if (view === "presentations") {
        expect(markup).toContain("<dt>Matching sessions</dt><dd>2</dd>");
        expect(historyCalls(presentationAnalyticsPath)).toHaveLength(1);
        expect(historyCalls(presentationSourcesPath)).toHaveLength(1);
      }
      harness.dispose();
    },
  );

  it.each([
    { view: "results", path: "/v1/reports", more: "Load More", count: "0 results shown" },
    {
      view: "practice",
      path: "/v1/followups",
      more: "Load More Practice",
      count: "0 practice items shown",
    },
  ])(
    "keeps trusted zero $view counts when a later page fails",
    async ({ view, path, more, count }) => {
      fixtures.query = `view=${view}`;
      fixtures.apiFetch.mockImplementation(async (url: string) => {
        if (!matchesRequest(url, path)) return response(url);
        if (url.includes("cursor=")) throw new Error("Later page unavailable");
        return { items: [], nextCursor: "later-page" };
      });
      const harness = resultsHarness();
      expect(await harness.settle()).toContain(`${count} · More available`);
      clickButton(more);
      const markup = await harness.settle();
      expect(markup).toContain("Later page unavailable");
      expect(markup).toContain(`${count} · More available`);
      expect(resultsBusyScope(view).props["aria-busy"]).toBe(false);
      harness.dispose();
    },
  );

  it.each([
    { view: "results", path: "/v1/reports" },
    { view: "practice", path: "/v1/followups" },
    { view: "presentations", path: presentationResultsPath },
    { view: "surveys", path: "/v1/survey-rooms" },
  ])("ignores an obsolete $view retry after the workspace changes", async ({ view, path }) => {
    fixtures.query = `view=${view}&q=First`;
    const pendingRetry = deferred<unknown>();
    let reads = 0;
    fixtures.apiFetch.mockImplementation(async (url: string) => {
      if (matchesRequest(url, path)) {
        reads++;
        if (reads === 1) throw new Error("First workspace unavailable");
        if (reads === 2) return pendingRetry.promise;
      }
      return response(url);
    });
    const harness = resultsHarness();
    await harness.settle();
    clickButton("Try again");
    await harness.settle();
    const obsolete = fixtures.apiFetch.mock.calls
      .filter(([url]) => matchesRequest(url, path))
      .at(-1)!;
    fixtures.workspaceId = "workspace-b";
    const markup = harness.render();
    expect(markup).not.toMatch(/0 (?:results|practice items) shown|First workspace unavailable/);
    await harness.settle();
    expect(obsolete[1].signal.aborted).toBe(true);
    pendingRetry.reject(new Error("Obsolete retry failed"));
    const settled = await harness.settle();
    expect(settled).not.toContain("Obsolete retry failed");
    expect(resultsBusyScope(view).props["aria-busy"]).toBe(false);
    expect(new URLSearchParams(fixtures.query).get("q")).toBe("First");
    harness.dispose();
  });

  it.each(["delayed_probe", "full_sequence"] as const)(
    "updates frozen %s Pack attribution on locale changes without reloading practice history",
    async (role) => {
      fixtures.query = "view=practice";
      const source = { ...createdPackPractice().followup.recoveryPackSource!, role };
      const frozen = structuredClone(source);
      fixtures.apiFetch.mockImplementation(async (path: string) => {
        const result = response(path);
        if (path.startsWith("/v1/followups?")) {
          const page = result as {
            items: ReturnType<typeof practice>[];
            nextCursor: string | null;
          };
          return {
            ...page,
            items: page.items.map((item) => ({ ...item, recoveryPackSource: source })),
          };
        }
        return result;
      });
      const harness = resultsHarness();
      await harness.settle();
      changeSearch("frozen evidence");
      clickButton("List view");
      elapseHistorySearchDelay(harness);
      await harness.settle();
      const reads = historyCalls("/v1/followups").length;
      for (const locale of ["ko-KR", "de-DE", "en-CA"] as const) {
        fixtures.locale = locale;
        const markup = await harness.settle();
        expect(markup).toMatch(new RegExp(`<p[^>]*lang="${locale}"`));
        expect(markup).toContain(
          packPracticeDetailCopy(locale)(
            role === "full_sequence"
              ? "Recovery Pack full sequence"
              : "Recovery Pack delayed probe",
          ),
        );
        expect(markup).toContain('<span lang="">Halves &lt; whole</span>');
        expect(markup).toContain('value="frozen evidence"');
        expect(markup).toContain('data-view="list"');
        expect(markup).toContain('href="/practice/practice-first"');
        expect(markup).not.toContain("#token=");
        expect(markup).not.toContain("Diagnostic only");
        expect(historyCalls("/v1/followups")).toHaveLength(reads);
        expect(
          fixtures.apiFetch.mock.calls.some(([path]) =>
            String(path).startsWith("/v1/recovery-packs"),
          ),
        ).toBe(false);
        expect(source).toEqual(frozen);
      }
      clickButton("Load More Practice");
      const loaded = await harness.settle();
      expect(loaded).toContain("First practice");
      expect(loaded).toContain("Later practice");
      expect(historyCalls("/v1/followups")).toHaveLength(reads + 1);
      harness.dispose();
    },
  );

  it("opens the modern Round library from the empty results state", async () => {
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.startsWith("/v1/reports?") ? { items: [], nextCursor: null } : response(path),
    );
    const markup = await resultsHarness().settle();
    expect(markup).toContain("No results yet");
    expect(markup).toContain('<a class="button" href="/library">Choose a Round</a>');
    expect(markup).not.toContain('href="/dashboard"');
  });

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
      path: presentationResultsPath,
      title: "First Presentation result",
      search: "Search Presentation results",
      library: "presentations",
    },
    {
      view: "surveys",
      path: "/v1/survey-rooms",
      title: "First Survey result",
      search: "Search Survey results",
      library: "surveys",
    },
  ])(
    "preserves the $view deep link and loads only its evidence collection",
    async ({ view, path, title, search, library }) => {
      fixtures.query = `view=${view}`;
      const markup = await resultsHarness().settle();
      const paths = fixtures.apiFetch.mock.calls.map(([url]) => String(url));
      for (const other of [
        "/v1/reports",
        "/v1/followups",
        presentationResultsPath,
        "/v1/survey-rooms",
      ])
        expect(paths.some((url) => matchesRequest(url, other))).toBe(other === path);
      expect(markup).toContain(`<h2 lang="">${title}</h2>`);
      expect(markup).toContain(`placeholder="${search}"`);
      expect(markup).toContain(`href="/library?type=${library}"`);
      expect(markup).toContain('href="/results?view=surveys"');
      expect(markup).not.toContain('href="/sessions?type=surveys"');
      expect(markup).toContain('aria-label="Results layout"');
      if (view === "practice") {
        expect(markup).toContain('href="/practice/practice-first"');
        expect(markup).toContain('href="/report/report-first"');
      } else if (view === "presentations")
        expect(markup).toContain('href="/presentation-session/presentation-first/report"');
      else if (view === "surveys") expect(markup).toContain('href="/results/surveys/survey-first"');
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
      fixtures.apiFetch.mock.calls.some(([path]) =>
        String(path).startsWith("/v1/presentation-sessions"),
      ),
    ).toBe(false);
    expect(
      new URLSearchParams(historyCalls("/v1/reports")[0]![0].split("?")[1]).get("search"),
    ).toBe("needle");
  });

  it("loads every Survey metadata page and links retained completed runs directly when creation is disabled", async () => {
    fixtures.query = "view=surveys";
    fixtures.surveysEnabled = false;
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/v1/survey-rooms?"))
        return path.includes("cursor=")
          ? {
              rooms: [
                {
                  ...survey("closed-later", "Closed early"),
                  closesAt: "2099-01-01T12:00:00Z",
                },
                { ...survey("elapsed", "Deadline reached"), closed: false },
                {
                  ...survey("boundary", "Deadline reached now"),
                  closed: false,
                  closesAt: "2026-10-14T12:00:00Z",
                },
              ],
              nextCursor: null,
            }
          : {
              rooms: [
                {
                  ...survey("closed-later", "Closed early"),
                  closesAt: "2099-01-01T12:00:00Z",
                },
                {
                  ...survey("active", "Active Survey"),
                  closed: false,
                  closesAt: "2099-01-01T12:00:00Z",
                },
                {
                  ...survey("expired", "Expired Survey"),
                  expiresAt: "2026-10-14T12:00:00Z",
                },
              ],
              nextCursor: "survey-next+ /",
            };
      return response(path);
    });
    const markup = await resultsHarness().settle();
    expect(headings()).toEqual(["Closed early", "Deadline reached now", "Deadline reached"]);
    expect(markup).toContain('href="/results/surveys/closed-later"');
    expect(markup).toContain('href="/results/surveys/elapsed"');
    expect(markup).toContain('href="/library?type=surveys"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Collection deadline:");
    expect(markup).toContain("Retained until");
    expect(markup).toContain("Run code: 654321");
    expect(markup).toContain("3 results shown");
    expect(markup).not.toContain("Active Survey");
    expect(markup).not.toContain("Expired Survey");
    expect(markup).not.toContain('href="/surveys/rooms/');
    expect(markup).not.toContain("Survey runs and results");
    expect(
      elements(historyFilters())
        .filter((element) => element.type === "select")
        .map((element) => element.props.value),
    ).toEqual(["all"]);
    const calls = historyCalls("/v1/survey-rooms");
    expect(
      calls.map(([url]) => Object.fromEntries(new URLSearchParams(url.split("?")[1]))),
    ).toEqual([{ limit: "50" }, { limit: "50", cursor: "survey-next+ /" }]);
    expect(
      fixtures.apiFetch.mock.calls.some(([path]) => /^\/v1\/survey-rooms\//.test(String(path))),
    ).toBe(false);
  });

  it("filters Survey metadata by title, code, source, and inclusive collection deadlines without refetching", async () => {
    fixtures.query = "view=surveys";
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.startsWith("/v1/survey-rooms?")
        ? {
            rooms: [
              { ...survey(), code: "AbC123" },
              {
                ...survey("start", "First Survey at start"),
                closesAt: new Date("2026-10-10T00:00:00").toISOString(),
              },
              {
                ...survey("end", "First Survey at end"),
                closesAt: new Date("2026-10-10T23:59:59.999").toISOString(),
              },
              { ...survey("other", "First Survey other source"), surveyId: "other-source" },
              {
                ...survey("old", "First Survey before range"),
                closesAt: new Date("2026-10-09T23:59:59.999").toISOString(),
              },
              {
                ...survey("next", "First Survey after range"),
                closesAt: new Date("2026-10-11T00:00:00").toISOString(),
              },
            ],
            nextCursor: null,
          }
        : response(path),
    );
    const harness = resultsHarness();
    await harness.settle();
    changeSearch("  FIRST SURVEY  ");
    changeField("Survey", "survey-source");
    changeField("Collection deadline from", "2026-10-10");
    changeField("Collection deadline to", "2026-10-10");
    let markup = await harness.settle();
    expect(headings()).toEqual([
      "First Survey at end",
      "First Survey result",
      "First Survey at start",
    ]);
    expect(markup).toContain("3 results shown");
    changeSearch("  abc123  ");
    await harness.settle();
    expect(headings()).toEqual(["First Survey result"]);
    changeSearch("missing");
    markup = await harness.settle();
    expect(markup).toContain("No results match these filters.");
    expect(markup).not.toContain('href="/sessions?type=surveys"');
    expect(fixtures.replace).not.toHaveBeenCalledWith("/sessions?type=surveys", expect.anything());
    clickButton("Clear filters");
    await harness.settle();
    expect(headings()).toHaveLength(6);
    expect(new URLSearchParams(fixtures.query).get("view")).toBe("surveys");
    expect(new URLSearchParams(fixtures.query).has("q")).toBe(false);
    expect(historyCalls("/v1/survey-rooms")).toHaveLength(1);
  });

  it("paginates Survey cards locally and resets the display limit when source filters change", async () => {
    fixtures.query = "view=surveys";
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.startsWith("/v1/survey-rooms?")
        ? {
            rooms: Array.from({ length: 27 }, (_, index) => ({
              ...survey(`survey-${String(index).padStart(2, "0")}`, `Survey ${index}`),
              surveyId: index === 26 ? "other-source" : "survey-source",
            })),
            nextCursor: null,
          }
        : response(path),
    );
    const harness = resultsHarness();
    let markup = await harness.settle();
    expect(headings()).toHaveLength(25);
    expect(markup).toContain("25 results shown · More available");
    clickButton("Load More");
    markup = await harness.settle();
    expect(headings()).toHaveLength(27);
    expect(markup).toContain("27 results shown");
    changeField("Survey", "other-source");
    await harness.settle();
    expect(headings()).toEqual(["Survey 26"]);
    changeField("Survey", "survey-source");
    await harness.settle();
    expect(headings()).toHaveLength(25);
    expect(historyCalls("/v1/survey-rooms")).toHaveLength(1);
  });

  it("updates Survey eligibility when collection deadlines and retention dates pass", async () => {
    fixtures.query = "view=surveys";
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.startsWith("/v1/survey-rooms?")
        ? {
            rooms: [
              {
                ...survey("expiring", "Retained briefly"),
                expiresAt: "2026-10-14T12:00:30Z",
              },
              {
                ...survey("closing", "Newly completed"),
                closed: false,
                closesAt: "2026-10-14T12:00:30Z",
              },
            ],
            nextCursor: null,
          }
        : response(path),
    );
    const harness = resultsHarness();
    await harness.settle();
    expect(headings()).toEqual(["Retained briefly"]);
    vi.mocked(Date.now).mockReturnValue(new Date("2026-10-14T12:00:30Z").getTime());
    const refresh = vi.mocked(window.setInterval).mock.calls[0]![0];
    if (typeof refresh !== "function") throw new Error("Missing Survey eligibility refresh");
    refresh();
    await harness.settle();
    expect(headings()).toEqual(["Newly completed"]);
    expect(historyCalls("/v1/survey-rooms")).toHaveLength(1);
    harness.dispose();
    expect(window.clearInterval).toHaveBeenCalledWith(1);
  });

  it("rejects repeated Survey metadata cursors without looping or showing partial results", async () => {
    fixtures.query = "view=surveys";
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.startsWith("/v1/survey-rooms?")
        ? { rooms: [survey()], nextCursor: "repeated" }
        : response(path),
    );
    const markup = await resultsHarness().settle();
    expect(historyCalls("/v1/survey-rooms")).toHaveLength(2);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Survey results could not be loaded. Try again.");
    expect(headings()).toEqual([]);
    expect(markup).not.toContain("No Survey results yet");
  });

  it("uses current Survey source filters when a pending metadata page completes", async () => {
    fixtures.query = "view=surveys";
    const pending = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path.startsWith("/v1/survey-rooms?") ? pending.promise : Promise.resolve(response(path)),
    );
    const harness = resultsHarness();
    await harness.settle();
    changeField("Survey", "other-source");
    changeSearch("wanted");
    await harness.settle();
    pending.resolve({
      rooms: [
        survey("wrong", "Wanted wrong source"),
        { ...survey("wanted", "Wanted current source"), surveyId: "other-source" },
      ],
      nextCursor: null,
    });
    await harness.settle();
    expect(headings()).toEqual(["Wanted current source"]);
    expect(historyCalls("/v1/survey-rooms")).toHaveLength(1);
  });

  it.each(["first", "later"] as const)(
    "aborts stale Survey %s metadata pages after a workspace change",
    async (stage) => {
      fixtures.query = "view=surveys";
      const stale = deferred<unknown>();
      let reads = 0;
      fixtures.apiFetch.mockImplementation((path: string) => {
        if (path.startsWith("/v1/survey-rooms?")) {
          reads++;
          if (reads === (stage === "first" ? 1 : 2)) return stale.promise;
          if (stage === "later" && reads === 1)
            return Promise.resolve({ rooms: [survey()], nextCursor: "next" });
          return Promise.resolve({
            rooms: [survey("fresh", "Fresh Survey history")],
            nextCursor: null,
          });
        }
        return Promise.resolve(response(path));
      });
      const harness = resultsHarness();
      await harness.settle();
      const request = historyCalls("/v1/survey-rooms").at(-1)!;
      fixtures.workspaceId = "workspace-b";
      expect(harness.render()).not.toContain("First Survey result");
      await harness.settle();
      expect(request[1].signal?.aborted).toBe(true);
      stale.resolve({ rooms: [survey("stale", "Stale Survey history")], nextCursor: "stale-next" });
      expect(await harness.settle()).not.toContain("Stale Survey history");
      expect(headings()).toEqual(["Fresh Survey history"]);
      expect(historyCalls("/v1/survey-rooms").some(([path]) => path.includes("stale-next"))).toBe(
        false,
      );
      harness.dispose();
    },
  );

  it.each([
    {
      view: "results",
      path: "/v1/reports",
      statusLabel: "Result Status",
      sourceLabel: "Round",
      sourceKey: "quizId",
      sourceId: "round-source",
      cursor: "report-next",
      analyticsPath: null,
      status: "ready",
      more: "Load More",
      later: "Later Round result",
    },
    {
      view: "practice",
      path: "/v1/followups",
      statusLabel: "Practice Status",
      sourceLabel: "Round",
      sourceKey: "quizId",
      sourceId: "round-source",
      cursor: "practice-next",
      analyticsPath: practiceAnalyticsPath,
      status: "open",
      more: "Load More Practice",
      later: "Later practice",
    },
    {
      view: "presentations",
      path: presentationResultsPath,
      statusLabel: "Status",
      sourceLabel: "Presentation",
      sourceKey: "presentationId",
      sourceId: "presentation-source",
      cursor: "presentation-next",
      analyticsPath: presentationAnalyticsPath,
      status: "finished",
      more: "Load More",
      later: "Later Presentation result",
    },
  ])(
    "sends $view search and filters on every page and clears all filters together",
    async ({
      view,
      path,
      statusLabel,
      sourceLabel,
      sourceKey,
      sourceId,
      cursor,
      analyticsPath,
      status,
      more,
      later,
    }) => {
      fixtures.query = `view=${view}`;
      const harness = resultsHarness();
      await harness.settle();
      changeField(statusLabel, status);
      changeField(sourceLabel, sourceId);
      changeField("From", "2026-10-01");
      changeField("To", "2026-10-31");
      changeSearch("  NeEdLe %_  ");
      if (analyticsPath) elapseHistorySearchDelay(harness);
      await harness.settle();
      const filters = Object.fromEntries(
        new URLSearchParams(historyCalls(path).at(-1)![0].split("?")[1]),
      );
      const scope = { expectedWorkspaceId: "workspace-a" };
      expect(filters).toEqual({
        limit: "25",
        ...scope,
        search: "NeEdLe %_",
        status,
        [sourceKey]: sourceId,
        from: new Date("2026-10-01T00:00:00").toISOString(),
        to: new Date("2026-10-31T23:59:59.999").toISOString(),
      });
      if (analyticsPath) {
        const aggregateFilters = new URLSearchParams(
          historyCalls(analyticsPath).at(-1)![0].split("?")[1],
        );
        const unpaginatedFilters = new URLSearchParams(filters);
        unpaginatedFilters.delete("limit");
        expect(Object.fromEntries(aggregateFilters)).toEqual(
          Object.fromEntries(unpaginatedFilters),
        );
      }
      clickButton(more);
      const markup = await harness.settle();
      expect(markup).toContain(`<h2 lang="">${later}</h2>`);
      expect(
        Object.fromEntries(new URLSearchParams(historyCalls(path).at(-1)![0].split("?")[1])),
      ).toEqual({ ...filters, cursor });
      expect(markup).toContain(view === "practice" ? "2 practice items shown" : "2 results shown");
      clickButton("Clear filters");
      await harness.settle();
      expect(new URLSearchParams(fixtures.query).get("view")).toBe(view);
      expect(new URLSearchParams(fixtures.query).has("q")).toBe(false);
      expect(
        Object.fromEntries(new URLSearchParams(historyCalls(path).at(-1)![0].split("?")[1])),
      ).toEqual({ limit: "25", ...scope });
    },
  );

  it.each([
    { view: "results", path: "/v1/reports", factory: report, more: "Load More" },
    { view: "practice", path: "/v1/followups", factory: practice, more: "Load More Practice" },
    {
      view: "presentations",
      path: presentationResultsPath,
      factory: (id: string, title: string) => ({ ...presentation, id, title }),
      more: "Load More",
    },
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
          if (change === "query") {
            changeSearch("new query");
            if (view !== "results") elapseHistorySearchDelay(harness);
          } else fixtures.workspaceId = "workspace-b";
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

  it("retries workspace-wide Presentation source options independently of the list and totals", async () => {
    fixtures.query = "view=presentations&q=Presentation";
    const previousWorkspace = deferred<unknown>();
    let sourceReads = 0;
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (matchesRequest(path, presentationSourcesPath)) {
        sourceReads++;
        if (sourceReads === 1) throw new Error("Presentation options unavailable");
        if (sourceReads === 2) return previousWorkspace.promise;
      }
      return response(path);
    });
    const harness = resultsHarness();
    const unavailable = await harness.settle();
    expect(unavailable).toContain("Presentation filter options could not load.");
    expect(unavailable).toContain("First Presentation result");
    expect(unavailable).toContain("<dt>Matching sessions</dt><dd>2</dd>");
    clickButton("Retry Presentation options");
    await harness.settle();
    const pending = historyCalls(presentationSourcesPath).at(-1)!;
    expect(historyCalls(presentationResultsPath)).toHaveLength(1);
    expect(historyCalls(presentationAnalyticsPath)).toHaveLength(1);

    fixtures.workspaceId = "workspace-b";
    await harness.settle();
    expect(pending[1].signal?.aborted).toBe(true);
    previousWorkspace.resolve({ sources: [{ id: "old-source", title: "Obsolete source" }] });
    const current = await harness.settle();
    expect(current).not.toContain("Obsolete source");
    expect(headings()).toEqual(["First Presentation result"]);
    expect(elements(field("Presentation")).map((node) => node.props.value)).toContain(
      "older-source",
    );
    changeField("Presentation", "older-source");
    await harness.settle();
    expect(headings()).toEqual(["Later Presentation result"]);
    expect(
      historyCalls(presentationSourcesPath).map(([path]) =>
        Object.fromEntries(new URLSearchParams(path.split("?")[1])),
      ),
    ).toEqual([
      { expectedWorkspaceId: "workspace-a" },
      { expectedWorkspaceId: "workspace-a" },
      { expectedWorkspaceId: "workspace-b" },
    ]);
    harness.dispose();
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
    clickButton("List view");
    expect(harness.render()).toContain('data-view="list"');
    expect(window.localStorage.setItem).toHaveBeenLastCalledWith(
      "openround:results-view:v1:workspace-a",
      "list",
    );
    fixtures.workspaceId = "workspace-b";
    expect(harness.render()).toContain('data-view="grid"');
    await harness.settle();
    clickButton("List view");
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
    clickButton("List view");
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
      return cloneElement(node, {
        key: node.key ?? identity,
        children: expand(node.props.children as ReactNode, identity),
      });
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
function elapseHistorySearchDelay(harness: ReturnType<typeof resultsHarness>) {
  harness.render();
  harness.flushEffects();
  vi.advanceTimersByTime(250);
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
  changeControl(field(name), value);
}
function field(name: string) {
  const label = elements(fixtures.tree).find(
    (element) =>
      element.type === "label" && elementText(element.props.children as ReactNode).startsWith(name),
  );
  return elements(label).find((element) => element.type === "select" || element.type === "input");
}
function changeControl(node: ReactElement<Record<string, unknown>> | undefined, value: string) {
  if (!node) throw new Error(`Missing control for: ${value}`);
  (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}
function headings() {
  return elements(fixtures.tree)
    .filter((element) => element.type === "h2")
    .map((element) => elementText(element.props.children as ReactNode))
    .filter((text) => text !== "Results analytics");
}
function historyFilters() {
  return elements(fixtures.tree).find(
    (element) => element.type === "section" && element.props["aria-label"] === "History filters",
  );
}
function resultsPanel() {
  return elements(fixtures.tree).find((node) => node.props.id === "results-panel")!;
}
function resultsBusyScope(view: string) {
  const panel = resultsPanel();
  if (view === "surveys") return panel;
  const collectionLabel =
    view === "results"
      ? "Results"
      : view === "practice"
        ? "Practice assignments and follow-ups"
        : "Presentation Results";
  return elements(panel).find(
    (node) => node.type === "section" && node.props["aria-label"] === collectionLabel,
  )!;
}
function activityCounts() {
  const chart = elements(fixtures.tree).find(
    (node) => node.props["aria-label"] === "Activity over time",
  );
  return elements(chart)
    .filter((node) => node.type === "strong")
    .map((node) => elementText(node.props.children as ReactNode));
}
function attachFocus(node: ReactElement<Record<string, unknown>>) {
  const focus = vi.fn();
  (node.props.ref as { current: { focus: () => void } | null }).current = { focus };
  return focus;
}
function historyCalls(path: string) {
  return fixtures.apiFetch.mock.calls.filter(([url]) => matchesRequest(String(url), path)) as Array<
    [string, { signal?: AbortSignal }]
  >;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
