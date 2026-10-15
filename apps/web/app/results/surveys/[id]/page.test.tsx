import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../../../lib/api";

interface ReportHooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}

const fixtures = vi.hoisted(() => ({
  id: "survey-a",
  workspaceId: "workspace-a",
  role: "viewer" as "owner" | "editor" | "viewer",
  locale: "en-CA" as "en-CA" | "fr-FR",
  hooks: null as ReportHooks | null,
  tree: null as ReactNode,
  apiFetch: vi.fn(),
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
    useEffect: (effect: ReactModule.EffectCallback, deps?: ReactModule.DependencyList) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useEffect(effect, deps);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { deps?: ReactModule.DependencyList; cleanup?: () => void } | undefined;
      if (previous && sameDeps(previous.deps, deps)) return;
      const slot: { deps?: ReactModule.DependencyList; cleanup?: () => void } = { deps };
      hooks.slots[index] = slot;
      hooks.effects.push(() => {
        previous?.cleanup?.();
        slot.cleanup = effect() || undefined;
      });
    },
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: fixtures.id }),
  usePathname: () => `/results/surveys/${fixtures.id}`,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("../../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));
vi.mock("../../../../components/locale-provider", async () => {
  const { loadMessages, translate } = await import("../../../../lib/i18n/catalog");
  const domains = ["workspace-pages", "session-summary"] as const;
  const messages = {
    "en-CA": await loadMessages("en-CA", domains),
    "fr-FR": await loadMessages("fr-FR", domains),
  };
  return {
    useLocale: () => ({
      locale: fixtures.locale,
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate(messages[fixtures.locale], key, values),
    }),
  };
});
vi.mock("../../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: fixtures.workspaceId
      ? { workspaceId: fixtures.workspaceId, role: fixtures.role }
      : null,
    canEdit: fixtures.role !== "viewer",
    productFeatures: { surveys: false, workspaceShell: true, uxBeta: true },
  }),
}));
vi.mock("../../../../components/session-summary/summary-dialog", () => ({
  SessionSummaryButton: ({ source }: { source: { kind: string; id: string } }) => (
    <button data-source={`${source.kind}:${source.id}`}>Share summary</button>
  ),
}));

import SurveyResultsPage from "./page";

const room = {
  title: "Team feedback",
  closesAt: "2026-10-01T12:00:00Z",
  expiresAt: "2026-11-01T12:00:00Z",
  closed: true,
};
function aggregate() {
  return {
    schemaVersion: 2,
    title: room.title,
    submittedCount: 8,
    suppressed: false,
    resultsStatus: "available",
    minimumRespondents: 5,
    questions: [
      {
        id: "question-a",
        prompt: "Which topics should we discuss?",
        type: "poll",
        maxSelections: 2,
        percentBasis: "respondents",
        suppressed: false,
        answeredCount: 8,
        distribution: [
          { label: "Planning", count: 6 },
          { label: "Delivery", count: 5 },
        ],
      },
    ],
  };
}
function response(path: string) {
  return path.endsWith("/results") ? { results: aggregate() } : { room };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function reportHarness() {
  const hooks: ReportHooks = { cursor: 0, slots: [], effects: [] };
  const content = SurveyResultsPage().props.children as ReactElement<
    Record<string, never>,
    () => ReactElement
  >;
  const render = () => {
    hooks.cursor = 0;
    hooks.effects = [];
    fixtures.hooks = hooks;
    try {
      fixtures.tree = content.type();
    } finally {
      fixtures.hooks = null;
    }
    return renderToStaticMarkup(fixtures.tree);
  };
  const flushEffects = () => {
    const effects = hooks.effects;
    hooks.effects = [];
    effects.forEach((effect) => effect());
  };
  const settle = async () => {
    for (let index = 0; index < 8; index++) await Promise.resolve();
    const markup = render();
    flushEffects();
    for (let index = 0; index < 8; index++) await Promise.resolve();
    return render() || markup;
  };
  render();
  flushEffects();
  return { render, flushEffects, settle };
}

function findButton(node: ReactNode, text: string): ReactElement<{ onClick: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = findButton(child, text);
      if (result) return result;
    }
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === "button" && node.props.children === text)
    return node as ReactElement<{ onClick: () => void }>;
  return findButton(node.props.children, text);
}

beforeEach(() => {
  fixtures.id = "survey-a";
  fixtures.workspaceId = "workspace-a";
  fixtures.role = "viewer";
  fixtures.locale = "en-CA";
  fixtures.hooks = null;
  fixtures.tree = null;
  fixtures.apiFetch.mockReset();
  fixtures.apiFetch.mockImplementation(async (path: string) => response(path));
});

describe("Survey results detail", () => {
  it("labels the translated report and its back action with the active language", async () => {
    fixtures.locale = "fr-FR";
    const markup = await reportHarness().settle();
    expect(markup).toMatch(/<main\b[^>]*\blang="fr-FR">/);
    expect(markup).toContain("Actualiser les résultats");
    expect(markup).toContain("Résultats agrégés");
    expect(markup).toMatch(
      /<div\b[^>]*\blang="fr-FR"><a\b[^>]*href="\/results\?view=surveys"[^>]*>Retour aux résultats de sondage<\/a><\/div>/,
    );
  });

  it("shows finalized aggregate evidence to viewers when new Surveys are disabled", async () => {
    const markup = await reportHarness().settle();
    expect(markup).toContain("Team feedback");
    expect(markup).toContain("8 finalized submissions. Only finalized responses are counted.");
    expect(markup).toContain("No aliases or account identities are collected.");
    expect(markup).toContain("Organizers cannot inspect linked respondent answers.");
    expect(markup).toContain("Results and responses expire");
    expect(markup).toContain("Closing early does not change this deadline.");
    expect(markup).toContain('id="survey-counts-question-a">Response counts</caption>');
    expect(markup).toContain('scope="col">Response</th>');
    expect(markup).toContain("Planning</th><td>6</td>");
    expect(markup).toContain("Multiple selections allowed.");
    expect(markup).toContain('data-source="survey:survey-a"');
    expect(markup).toContain('href="/results?view=surveys"');
    expect(markup).not.toContain("Manage Survey run");
    expect(markup).not.toContain("/surveys/rooms/");
    expect(markup).not.toContain("Delete");
    expect(markup).not.toContain("QR");
    expect(fixtures.apiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/v1/survey-rooms/survey-a",
      "/v1/survey-rooms/survey-a/results",
    ]);
    for (const [, init] of fixtures.apiFetch.mock.calls) {
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("preserves long authored labels within a labelled keyboard-accessible table region", async () => {
    const label = "A".repeat(120);
    const prompt = "B".repeat(120);
    const results = aggregate();
    results.questions = results.questions.map((question) => ({
      ...question,
      prompt,
      distribution: [{ label, count: 8 }],
    }));
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.endsWith("/results") ? { results } : { room },
    );
    const markup = await reportHarness().settle();
    expect(markup).toContain(`id="survey-question-question-a" lang="">${prompt}</h3>`);
    expect(markup).toContain(`scope="row" lang="">${label}</th>`);
    expect(markup).toContain('role="region"');
    expect(markup).toContain(`aria-label="Question 1 results: ${prompt}" tabindex="0"`);
    expect(markup).toContain('id="survey-counts-question-a">Response counts</caption>');
  });

  it("gives duplicate-prompt table regions distinct indexed accessible names", async () => {
    const results = aggregate();
    results.questions = [
      ...results.questions,
      ...results.questions.map((question) => ({ ...question, id: "question-b" })),
    ];
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.endsWith("/results") ? { results } : { room },
    );
    const markup = await reportHarness().settle();
    const regionNames = [...markup.matchAll(/role="region" aria-label="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(regionNames).toEqual([
      "Question 1 results: Which topics should we discuss?",
      "Question 2 results: Which topics should we discuss?",
    ]);
    expect(markup.match(/<h3[^>]*>Which topics should we discuss\?<\/h3>/g)).toHaveLength(2);
    expect(markup.match(/Response counts<\/caption>/g)).toHaveLength(2);
  });

  it.each(["owner", "editor"] as const)(
    "links %s to the existing run management page",
    async (role) => {
      fixtures.role = role;
      const markup = await reportHarness().settle();
      expect(markup).toContain('href="/surveys/rooms/survey-a"');
      expect(markup).toContain("Manage Survey run");
      expect(markup).not.toContain("Close admissions");
      expect(markup).not.toContain("Delete");
    },
  );

  it("keeps all distributions and summary sharing hidden while collecting", async () => {
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.endsWith("/results")
        ? { results: { ...aggregate(), resultsStatus: "collecting", suppressed: true } }
        : { room: { ...room, closed: false } },
    );
    const markup = await reportHarness().settle();
    expect(markup).toContain("Collecting responses");
    expect(markup).toContain("Distributions stay hidden while this Survey is open.");
    expect(markup).toContain("Each question needs at least five responses.");
    expect(markup).not.toContain("Planning");
    expect(markup).not.toContain("Response counts");
    expect(markup).not.toContain("Share summary");
  });

  it("preserves global and per-question five-response suppression", async () => {
    let results = {
      ...aggregate(),
      submittedCount: 4,
      resultsStatus: "insufficient_sample",
      suppressed: true,
    };
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path.endsWith("/results") ? { results } : { room },
    );
    const harness = reportHarness();
    let markup = await harness.settle();
    expect(markup).toContain(
      "Distributions are hidden because fewer than five respondents submitted.",
    );
    expect(markup).not.toContain("Planning");
    expect(markup).toContain("Share summary");
    results = {
      ...aggregate(),
      questions: aggregate().questions.map((question) => ({ ...question, suppressed: true })),
    };
    findButton(fixtures.tree, "Refresh results")!.props.onClick();
    markup = await harness.settle();
    expect(markup).toContain(
      "Distributions are hidden because this question has fewer than five responses.",
    );
    expect(markup).not.toContain("Planning");
    expect(markup).not.toContain("Response counts");
  });

  it.each(["id", "workspace"] as const)(
    "immediately hides old evidence and rejects stale success after a %s change",
    async (field) => {
      const harness = reportHarness();
      await harness.settle();
      const stale = deferred<unknown>();
      const next = deferred<unknown>();
      fixtures.apiFetch.mockImplementation(() => stale.promise);
      findButton(fixtures.tree, "Refresh results")!.props.onClick();
      harness.render();
      harness.flushEffects();
      const staleSignal = fixtures.apiFetch.mock.calls.at(-1)![1].signal as AbortSignal;
      if (field === "id") fixtures.id = "survey-b";
      else fixtures.workspaceId = "workspace-b";
      fixtures.apiFetch.mockImplementation(() => next.promise);
      const pending = harness.render();
      expect(pending).not.toContain("Team feedback");
      expect(pending).not.toContain("Planning");
      expect(pending).not.toContain("Share summary");
      harness.flushEffects();
      expect(staleSignal.aborted).toBe(true);
      stale.resolve({ room, results: aggregate() });
      let markup = await harness.settle();
      expect(markup).not.toContain("Team feedback");
      next.resolve({ room: { ...room, title: "Current evidence" }, results: aggregate() });
      markup = await harness.settle();
      expect(markup).toContain("Current evidence");
      expect(markup).not.toContain("Team feedback");
    },
  );

  it("ignores a stale failure and renders only generic errors for current failures", async () => {
    const old = deferred<unknown>();
    const current = deferred<unknown>();
    fixtures.apiFetch.mockImplementation(() => old.promise);
    const harness = reportHarness();
    fixtures.workspaceId = "workspace-b";
    fixtures.apiFetch.mockImplementation(() => current.promise);
    harness.render();
    harness.flushEffects();
    old.reject(new Error("old private detail"));
    let markup = await harness.settle();
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain("private");
    current.reject(new Error("private server detail"));
    markup = await harness.settle();
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Survey results could not be loaded. Try again.");
    expect(markup).not.toContain("private");
    fixtures.apiFetch.mockImplementation(async (path: string) => response(path));
    findButton(fixtures.tree, "Refresh results")!.props.onClick();
    markup = await harness.settle();
    expect(markup).toContain("Team feedback");
    expect(markup).not.toContain('role="alert"');
  });

  it("waits for an authenticated workspace before reading report evidence", async () => {
    fixtures.workspaceId = "";
    const harness = reportHarness();
    expect(await harness.settle()).toContain('role="status"');
    expect(fixtures.apiFetch).not.toHaveBeenCalled();
    fixtures.workspaceId = "workspace-a";
    harness.render();
    harness.flushEffects();
    expect(await harness.settle()).toContain("Team feedback");
  });
});
