import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationReportSchema, type PresentationReportEnvelope } from "@openround/contracts";
import type * as ApiModule from "../../../../lib/api";
import { AUTH_CHANGE_EVENT, ApiClientError } from "../../../../lib/api";
import { translate, type MessageKey } from "../../../../lib/i18n/catalog";
import { liveDeliveryEnglishMessages } from "../../../../lib/i18n/domains/live-delivery";
import PresentationReportPage from "./page";

interface ReportHooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => unknown>;
  cleanups: Map<number, () => unknown>;
}

const fixtures = vi.hoisted(() => ({
  hooks: null as ReportHooks | null,
  apiFetch: vi.fn(),
  insightsSource: vi.fn(),
  insightsGuard: vi.fn(),
  replace: vi.fn(),
  refreshAccount: vi.fn(),
  accountLoading: false,
  accountError: "",
  creator: { userId: "creator-one", workspaceId: "workspace-one", role: "owner" },
  presentations: true,
  csvExport: true,
  id: "11111111-1111-4111-8111-111111111111",
  unmounts: [] as Array<() => void>,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
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
      return hooks.slots[index] as { current: T };
    },
    useEffect: (effect: () => unknown, deps?: unknown[]) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useEffect(effect as Parameters<typeof react.useEffect>[0], deps);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as unknown[] | undefined;
      if (previous && deps && deps.every((value, cursor) => Object.is(value, previous[cursor])))
        return;
      hooks.slots[index] = deps;
      hooks.effects.push(() => {
        hooks.cleanups.get(index)?.();
        const cleanup = effect();
        if (typeof cleanup === "function") hooks.cleanups.set(index, cleanup as () => unknown);
        else hooks.cleanups.delete(index);
      });
    },
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: fixtures.id }),
  useRouter: () => ({ replace: fixtures.replace }),
}));
vi.mock("../../../../components/locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate(liveDeliveryEnglishMessages, key, values),
  }),
}));
vi.mock("../../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    creator: fixtures.creator,
    loading: fixtures.accountLoading,
    error: fixtures.accountError,
    refreshAccount: fixtures.refreshAccount,
    productFeatures: { workspaceShell: false, presentations: fixtures.presentations },
    entitlements: { csvExport: fixtures.csvExport },
  }),
}));
vi.mock("../../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));
vi.mock("../../../../components/session-summary/summary-dialog", () => ({
  SessionSummaryButton: () => <button>Share summary</button>,
}));
vi.mock("../../../../components/presentation-insights/session-insights", () => ({
  PresentationSessionInsightsPanel: ({
    source,
    canUseEvidence,
  }: {
    source: unknown;
    canUseEvidence?: () => boolean;
  }) => {
    fixtures.insightsSource(source);
    fixtures.insightsGuard(canUseEvidence);
    return <section aria-label="Session insights">Session insights</section>;
  },
}));

beforeEach(() => {
  fixtures.hooks = null;
  fixtures.apiFetch.mockReset();
  fixtures.insightsSource.mockReset();
  fixtures.insightsGuard.mockReset();
  fixtures.replace.mockReset();
  fixtures.refreshAccount.mockReset().mockResolvedValue(undefined);
  fixtures.accountLoading = false;
  fixtures.accountError = "";
  fixtures.creator = { userId: "creator-one", workspaceId: "workspace-one", role: "owner" };
  fixtures.presentations = true;
  fixtures.csvExport = true;
  fixtures.id = "11111111-1111-4111-8111-111111111111";
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout: vi.fn() }));
});

afterEach(() => {
  for (const unmount of fixtures.unmounts.splice(0)) unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function reportFixture(schemaVersion: 1 | 2 | 3) {
  return PresentationReportSchema.parse({
    schemaVersion,
    sessionId: "11111111-1111-4111-8111-111111111111",
    artifactType: "presentation",
    presentationId: "22222222-2222-4222-8222-222222222222",
    presentationVersionId: "33333333-3333-4333-8333-333333333333",
    title: "A facilitated discussion",
    status: "finished",
    participantCount: 2,
    responseCount: 2,
    leaderboard: [],
    recovery: [],
    timeline: [],
    evidence: [
      {
        blockId: "44444444-4444-4444-8444-444444444444",
        blockIndex: 0,
        kind: "question",
        questionId: "55555555-5555-4555-8555-555555555555",
        prompt: "Which approach should we discuss?",
        questionType: "poll",
        questionTypeLabel: "Poll",
        delivery: "main",
        respondents: 2,
        correct: null,
        accuracyPercent: null,
        totalScore: 0,
        averageResponseMs: 1_000,
        ...(schemaVersion === 3 ? { sessionOnly: "quick_check" } : {}),
      },
    ],
    evidenceNote: "Participation evidence from the finished session.",
    createdAt: "2026-10-08T12:00:00.000Z",
    finishedAt: "2026-10-08T12:10:00.000Z",
  });
}

function reportHarness() {
  const hooks: ReportHooks = { cursor: 0, slots: [], effects: [], cleanups: new Map() };
  const content = PresentationReportPage().props.children as ReactElement<
    Record<string, never>,
    () => ReactElement
  >;
  const render = (flushEffects = true) => {
    hooks.cursor = 0;
    hooks.effects = [];
    fixtures.hooks = hooks;
    let node: ReactElement;
    try {
      node = content.type();
    } finally {
      fixtures.hooks = null;
    }
    if (flushEffects) for (const effect of hooks.effects.splice(0)) effect();
    return node;
  };
  render();
  const unmount = () => {
    for (const cleanup of hooks.cleanups.values()) cleanup();
    hooks.cleanups.clear();
  };
  fixtures.unmounts.push(unmount);
  return {
    render,
    unmount,
    flushEffects: () => {
      for (const effect of hooks.effects.splice(0)) effect();
    },
  };
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

interface ButtonProps {
  children?: ReactNode;
  onClick: () => unknown;
  disabled?: boolean;
}

function findButton(node: ReactNode, label: string): ReactElement<ButtonProps> {
  function visit(value: ReactNode): ReactElement<ButtonProps> | null {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }
    if (!isValidElement<ButtonProps>(value)) return null;
    if (value.type === "button" && renderToStaticMarkup(value).includes(label)) return value;
    return visit(value.props.children);
  }
  const found = visit(node);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

function spyOnExport() {
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report-test");
  const link = { click: vi.fn(), remove: vi.fn(), href: "", download: "" };
  vi.stubGlobal("document", { createElement: () => link, body: { append: vi.fn() } });
  return { createObjectURL, link };
}

describe("Presentation report scoped loading and recovery", () => {
  it("passes the same synchronous authority fence to the embedded insights downloads", async () => {
    fixtures.apiFetch.mockResolvedValue({ reportStatus: "ready", report: reportFixture(1) });
    const harness = reportHarness();
    await settle();
    renderToStaticMarkup(harness.render());
    const guard = fixtures.insightsGuard.mock.calls.at(-1)?.[0] as () => boolean;
    expect(guard()).toBe(true);
    const account = deferred<void>();
    fixtures.refreshAccount.mockReturnValueOnce(account.promise);
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(guard()).toBe(false);
    account.resolve();
    await settle();
    harness.render();
    await settle();
    renderToStaticMarkup(harness.render());
    expect(guard()).toBe(false);
    expect((fixtures.insightsGuard.mock.calls.at(-1)?.[0] as () => boolean)()).toBe(true);
  });

  it("stops after bounded transient retries and explicitly retries once while disabling duplicate reads", async () => {
    vi.useFakeTimers();
    fixtures.apiFetch.mockRejectedValue(new ApiClientError("Temporary outage", "UNAVAILABLE", 503));
    const harness = reportHarness();
    await settle();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(6);
    let node = harness.render();
    let markup = renderToStaticMarkup(node);
    expect(markup).toContain("Temporary outage");
    expect(markup).toContain("The report could not be loaded. Try again.");
    expect(markup).not.toContain("Loading report");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(6);
    const recovered = deferred<PresentationReportEnvelope>();
    fixtures.apiFetch.mockReturnValueOnce(recovered.promise);
    const retry = findButton(node, "Try again");
    retry.props.onClick();
    retry.props.onClick();
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(7);
    node = harness.render();
    expect(findButton(node, "Retrying report").props.disabled).toBe(true);
    recovered.resolve({ reportStatus: "ready", report: reportFixture(1) });
    await settle();
    markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain("Which approach should we discuss?");
    expect(markup).not.toContain("Temporary outage");
    expect(markup).not.toContain("Try again");
  });

  it("retains same-scope pending evidence during a transient outage and clears it on a failed generation", async () => {
    vi.useFakeTimers();
    fixtures.apiFetch.mockResolvedValueOnce({ reportStatus: "pending", report: reportFixture(1) });
    const harness = reportHarness();
    await settle();
    fixtures.apiFetch.mockRejectedValue(new ApiClientError("Temporary outage", "UNAVAILABLE", 503));
    await vi.advanceTimersByTimeAsync(26_000);
    let node = harness.render();
    expect(renderToStaticMarkup(node)).toContain("Which approach should we discuss?");
    expect(renderToStaticMarkup(node)).not.toContain("Share summary");
    fixtures.apiFetch.mockResolvedValueOnce({ reportStatus: "failed", report: null });
    findButton(node, "Try again").props.onClick();
    await settle();
    node = harness.render();
    expect(renderToStaticMarkup(node)).not.toContain("Which approach should we discuss?");
    expect(renderToStaticMarkup(node)).not.toContain("Export evidence CSV");
    expect(findButton(node, "Try again").props.disabled).toBe(false);
  });

  it.each([401, 403, 404])(
    "clears private evidence and captured exports on a %s read",
    async (status) => {
      vi.useFakeTimers();
      fixtures.apiFetch.mockResolvedValueOnce({
        reportStatus: "pending",
        report: reportFixture(1),
      });
      const harness = reportHarness();
      await settle();
      const oldExport = findButton(harness.render(), "Export evidence CSV").props.onClick;
      const revoked = deferred<PresentationReportEnvelope>();
      fixtures.apiFetch.mockReturnValueOnce(revoked.promise);
      await vi.advanceTimersByTimeAsync(1_000);
      revoked.reject(new ApiClientError("No access", "FORBIDDEN", status));
      await settle();
      const { createObjectURL } = spyOnExport();
      // Rejection invalidates the old callback before React commits a replacement view.
      oldExport();
      expect(createObjectURL).not.toHaveBeenCalled();
      const markup = renderToStaticMarkup(harness.render());
      expect(markup).not.toContain("Which approach should we discuss?");
      expect(markup).not.toContain("Export evidence CSV");
      expect(fixtures.replace).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
    },
  );

  it.each([AUTH_CHANGE_EVENT, "polling-pops:workspace-updated"])(
    "invalidates evidence, held responses and captured exports synchronously on %s, then waits for canonical account resolution",
    async (eventName) => {
      vi.useFakeTimers();
      fixtures.apiFetch.mockResolvedValueOnce({
        reportStatus: "pending",
        report: reportFixture(1),
      });
      const harness = reportHarness();
      await settle();
      const oldExport = findButton(harness.render(), "Export evidence CSV").props.onClick;
      const held = deferred<PresentationReportEnvelope>();
      fixtures.apiFetch.mockReturnValueOnce(held.promise);
      await vi.advanceTimersByTimeAsync(1_000);
      const account = deferred<void>();
      fixtures.refreshAccount.mockReturnValueOnce(account.promise);
      window.dispatchEvent(new Event(eventName));
      const { createObjectURL } = spyOnExport();
      oldExport();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(renderToStaticMarkup(harness.render())).not.toContain(
        "Which approach should we discuss?",
      );
      held.resolve({ reportStatus: "ready", report: reportFixture(1) });
      await settle();
      expect(renderToStaticMarkup(harness.render())).not.toContain(
        "Which approach should we discuss?",
      );
      expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
      fixtures.accountLoading = true;
      harness.render();
      account.resolve();
      await settle();
      harness.render();
      expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
      fixtures.creator = {
        ...fixtures.creator,
        userId: "creator-two",
        workspaceId: "workspace-two",
      };
      fixtures.accountLoading = false;
      fixtures.apiFetch.mockResolvedValueOnce({
        reportStatus: "ready",
        report: { ...reportFixture(1), title: "Current actor evidence" },
      });
      harness.render();
      await settle();
      expect(fixtures.apiFetch).toHaveBeenCalledTimes(3);
      expect(renderToStaticMarkup(harness.render())).toContain("Current actor evidence");
      oldExport();
      expect(createObjectURL).not.toHaveBeenCalled();
      findButton(harness.render(), "Export evidence CSV").props.onClick();
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    },
  );

  it("refetches on a same-ID auth change after canonical account refresh finishes", async () => {
    fixtures.apiFetch.mockResolvedValue({ reportStatus: "ready", report: reportFixture(1) });
    const harness = reportHarness();
    await settle();
    const oldExport = findButton(harness.render(), "Export evidence CSV").props.onClick;
    const account = deferred<void>();
    fixtures.refreshAccount.mockReturnValueOnce(account.promise);
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    harness.render();
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(1);
    account.resolve();
    await settle();
    harness.render();
    await settle();
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
    expect(renderToStaticMarkup(harness.render())).toContain("Which approach should we discuss?");
    const { createObjectURL } = spyOnExport();
    oldExport();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("waits for the latest overlapping auth refresh and rejects a scheduled poll before effect cleanup", async () => {
    vi.useFakeTimers();
    fixtures.apiFetch.mockResolvedValue({ reportStatus: "pending", report: reportFixture(1) });
    const harness = reportHarness();
    await settle();
    const firstAccount = deferred<void>();
    const latestAccount = deferred<void>();
    fixtures.refreshAccount
      .mockReturnValueOnce(firstAccount.promise)
      .mockReturnValueOnce(latestAccount.promise);
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    // A delayed React effect cleanup must not let its old poll send another request.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(1);
    firstAccount.resolve();
    await settle();
    expect(renderToStaticMarkup(harness.render())).not.toContain(
      "Which approach should we discuss?",
    );
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(1);
    latestAccount.resolve();
    await settle();
    harness.render();
    await settle();
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
    expect(renderToStaticMarkup(harness.render())).toContain("Which approach should we discuss?");
  });

  it("invalidates captured exports and ignores a held response after unmount", async () => {
    vi.useFakeTimers();
    fixtures.apiFetch.mockResolvedValueOnce({ reportStatus: "pending", report: reportFixture(1) });
    const harness = reportHarness();
    await settle();
    const oldExport = findButton(harness.render(), "Export evidence CSV").props.onClick;
    const held = deferred<PresentationReportEnvelope>();
    fixtures.apiFetch.mockReturnValueOnce(held.promise);
    await vi.advanceTimersByTimeAsync(1_000);
    harness.unmount();
    const { createObjectURL } = spyOnExport();
    oldExport();
    expect(createObjectURL).not.toHaveBeenCalled();
    held.resolve({ reportStatus: "pending", report: reportFixture(1) });
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
  });

  it.each(["user", "workspace", "role", "loading", "feature", "entitlement", "route"])(
    "fences an earlier view and export during a canonical %s change before effects, including a later return to the old value",
    async (change) => {
      fixtures.apiFetch.mockResolvedValue({ reportStatus: "ready", report: reportFixture(1) });
      const harness = reportHarness();
      await settle();
      const oldExport = findButton(harness.render(), "Export evidence CSV").props.onClick;
      const originalCreator = fixtures.creator;
      if (change === "user") fixtures.creator = { ...fixtures.creator, userId: "creator-two" };
      if (change === "workspace")
        fixtures.creator = { ...fixtures.creator, workspaceId: "workspace-two" };
      if (change === "role") fixtures.creator = { ...fixtures.creator, role: "viewer" };
      if (change === "loading") fixtures.accountLoading = true;
      if (change === "feature") fixtures.presentations = false;
      if (change === "entitlement") fixtures.csvExport = false;
      if (change === "route") fixtures.id = "22222222-2222-4222-8222-222222222222";
      const markup = renderToStaticMarkup(harness.render(false));
      expect(markup).not.toContain("Which approach should we discuss?");
      const { createObjectURL } = spyOnExport();
      oldExport();
      expect(createObjectURL).not.toHaveBeenCalled();
      harness.flushEffects();
      fixtures.creator = originalCreator;
      fixtures.accountLoading = false;
      fixtures.presentations = true;
      fixtures.csvExport = true;
      fixtures.id = "11111111-1111-4111-8111-111111111111";
      harness.render();
      await settle();
      harness.render();
      oldExport();
      expect(createObjectURL).not.toHaveBeenCalled();
    },
  );
});

describe("Presentation Quick Check report compatibility", () => {
  it("shows slide and participant context without quiz claims for a content-only report", async () => {
    const report = PresentationReportSchema.parse({
      ...reportFixture(1),
      responseCount: 0,
      evidence: [
        {
          blockId: "44444444-4444-4444-8444-444444444444",
          blockIndex: 0,
          kind: "content",
          title: "Project overview",
          assessmentStatus: "not_assessed",
        },
        {
          blockId: "66666666-6666-4666-8666-666666666666",
          blockIndex: 1,
          kind: "content",
          title: "Next steps",
          assessmentStatus: "not_assessed",
        },
      ],
      // A prior API may have kept join-order rows even though no question was asked.
      leaderboard: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          nickname: "Attendee",
          score: 0,
          rank: 1,
        },
      ],
      evidenceNote: "The report records participation and the facilitation timeline.",
    });
    fixtures.apiFetch.mockResolvedValue({ reportStatus: "ready", report });
    const harness = reportHarness();
    await settle();
    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain("Project overview");
    expect(markup).toContain("Next steps");
    expect(markup).toContain("Participants");
    expect(markup).toContain("Total blocks");
    expect(markup).toContain("Facilitation timeline");
    expect(markup).not.toContain("Responses");
    expect(markup).not.toContain("Accuracy");
    expect(markup).not.toContain("Leaderboard");
    expect(markup).not.toContain("0 points");
    expect(markup).not.toContain("learning evidence");
    expect(markup).not.toContain("Not assessed.");
  });

  it("preserves response and content-assessment distinctions in a mixed deck", async () => {
    const report = PresentationReportSchema.parse({
      ...reportFixture(1),
      evidence: [
        {
          blockId: "66666666-6666-4666-8666-666666666666",
          blockIndex: 0,
          kind: "content",
          title: "Context for discussion",
          assessmentStatus: "not_assessed",
        },
        ...reportFixture(1).evidence,
      ],
    });
    fixtures.apiFetch.mockResolvedValue({ reportStatus: "ready", report });
    const harness = reportHarness();
    await settle();
    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain("Responses");
    expect(markup).toContain("Accuracy");
    expect(markup).toContain("Not assessed.");
    expect(markup).toContain("Presentation exposure is not treated as learning evidence.");
    expect(markup).not.toContain("Total blocks");
  });

  it("offers sharing only when report generation is ready, even if a pending envelope contains evidence", async () => {
    vi.useFakeTimers();
    try {
      fixtures.apiFetch.mockResolvedValue({ reportStatus: "pending", report: reportFixture(1) });
      const harness = reportHarness();
      await settle();
      expect(renderToStaticMarkup(harness.render())).not.toContain("Share summary");
      expect(renderToStaticMarkup(harness.render())).not.toContain("Session insights");
      fixtures.apiFetch.mockResolvedValue({ reportStatus: "ready", report: reportFixture(1) });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(renderToStaticMarkup(harness.render())).toContain("Share summary");
      expect(renderToStaticMarkup(harness.render())).toContain("Session insights");
      expect(fixtures.insightsSource).toHaveBeenCalledWith({
        sessionId: reportFixture(1).sessionId,
        presentationId: reportFixture(1).presentationId,
        presentationVersionId: reportFixture(1).presentationVersionId,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([1, 2, 3] as const)(
    "opts into Quick Checks and renders V%s evidence with attribution only when marked",
    async (schemaVersion) => {
      fixtures.apiFetch.mockResolvedValue({
        reportStatus: "ready",
        report: reportFixture(schemaVersion),
        sessionContext: { timeMode: "flex" },
      });
      const harness = reportHarness();
      await settle();
      expect(fixtures.apiFetch.mock.calls[0]?.[0]).toBe(
        "/v1/presentation-sessions/11111111-1111-4111-8111-111111111111/report?includeSessionContext=true&includeQuickChecks=true&includeOpinionResults=true&includeTextResults=true&includeNavigation=true&includeInteractions=true",
      );
      const markup = renderToStaticMarkup(harness.render());
      expect(markup).toContain("Which approach should we discuss?");
      expect(markup).toContain("Flex — facilitator closes responses");
      expect(markup.includes("Session-only Quick Check · unscored")).toBe(schemaVersion === 3);
      expect(markup).not.toContain("Recovery evidence");
    },
  );

  it.each(["open_text", "word_cloud"] as const)(
    "renders approved V5 %s evidence as escaped unscored results",
    async (type) => {
      const legacy = reportFixture(1);
      const question = legacy.evidence[0]!;
      if (question.kind !== "question") throw new Error("Question fixture required");
      const report = PresentationReportSchema.parse({
        ...legacy,
        schemaVersion: 5,
        participantCount: 5,
        responseCount: 9,
        timeline: [
          {
            sequence: 1,
            type: "question.revealed",
            blockIndex: 0,
            blockId: question.blockId,
            occurredAt: "2026-10-08T12:01:00.000Z",
          },
        ],
        evidence: [
          {
            ...question,
            questionType: type,
            questionTypeLabel: type,
            respondents: 5,
            textResults:
              type === "open_text"
                ? {
                    kind: type,
                    respondents: 5,
                    entries: ["<script>approved</script>", "Two", "Three", "Four", "Five"].map(
                      (value) => ({ value }),
                    ),
                  }
                : {
                    kind: type,
                    respondents: 5,
                    buckets: [
                      {
                        value: "<script>approved</script>",
                        label: "<script>approved</script>",
                        count: 5,
                        percent: 100,
                      },
                    ],
                  },
          },
          {
            ...question,
            blockId: "66666666-6666-4666-8666-666666666666",
            blockIndex: 1,
            questionType: type,
            questionTypeLabel: type,
            prompt: "Suppressed question",
            respondents: 4,
          },
        ],
      });
      fixtures.apiFetch.mockResolvedValue({ reportStatus: "ready", report });
      const harness = reportHarness();
      await settle();
      const markup = renderToStaticMarkup(harness.render());
      expect(markup).toContain("&lt;script&gt;approved&lt;/script&gt;");
      expect(markup).not.toContain("<script>approved</script>");
      expect(markup).toContain("Unscored opinion");
      expect(markup).toContain("Text results require reveal and at least five approved responses");
      expect(markup).not.toContain("Leaderboard");
      expect(markup).not.toContain("Recovery evidence");
      expect(markup).toContain("Export evidence CSV");
    },
  );

  it("renders a legacy API response that ignores opt-in queries and omits session context", async () => {
    const legacy: PresentationReportEnvelope = {
      reportStatus: "ready",
      report: reportFixture(1),
    };
    fixtures.apiFetch.mockResolvedValue(legacy);
    const harness = reportHarness();
    await settle();
    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain("Which approach should we discuss?");
    expect(markup).toContain("Timed");
    expect(markup).not.toContain("Session-only Quick Check");
  });

  it("labels V6 skipped activities separately from presented evidence and names restored navigation", async () => {
    const legacy = reportFixture(1);
    const question = legacy.evidence[0]!;
    if (question.kind !== "question") throw new Error("Question fixture required");
    const skippedId = "66666666-6666-4666-8666-666666666666";
    const report = PresentationReportSchema.parse({
      ...legacy,
      schemaVersion: 6,
      evidence: [
        question,
        {
          ...question,
          blockId: skippedId,
          blockIndex: 1,
          prompt: "Never presented question",
          respondents: 0,
        },
      ],
      navigation: {
        jumpCount: 1,
        returnCount: 1,
        blocks: [
          {
            blockId: question.blockId,
            sectionId: "77777777-7777-4777-8777-777777777777",
            sectionTitle: "Review section",
            status: "presented",
            phase: "question_reveal",
          },
          {
            blockId: skippedId,
            sectionId: null,
            sectionTitle: null,
            status: "skipped",
            phase: null,
          },
        ],
      },
      timeline: [
        {
          sequence: 1,
          type: "navigation.returned",
          blockIndex: 0,
          blockId: question.blockId,
          occurredAt: "2026-10-08T12:01:00.000Z",
          navigation: {
            fromBlockId: skippedId,
            toBlockId: question.blockId,
            returnBlockId: null,
            restored: true,
          },
        },
      ],
    });
    fixtures.apiFetch.mockResolvedValue({ reportStatus: "ready", report });
    const harness = reportHarness();
    await settle();
    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain("1 jumps · 1 returns to path");
    expect(markup).toContain("Review section");
    expect(markup).toContain("Skipped · not presented");
    expect(markup).toContain("No response or assessment evidence was collected.");
    expect(markup).toContain("Restored saved state");
    const skipped = markup.split("Never presented question")[1]!.split("</article>")[0]!;
    expect(skipped).not.toContain("Respondents");
    expect(skipped).not.toContain("Accuracy");
  });
});
