import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type { RoundLiveWordCloudResults } from "@openround/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Hooks {
  cursor: number;
  slots: unknown[];
  dependencies: Map<number, readonly unknown[] | undefined>;
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
  cleanups: Map<number, void | (() => void)>;
}

const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null, apiFetch: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useRef: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
  useState: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: T | ((previous: T) => T)) => {
        hooks.slots[index] =
          typeof next === "function" ? (next as (previous: T) => T)(hooks.slots[index] as T) : next;
      },
    ];
  },
  useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.dependencies.get(index);
    if (
      !hooks.dependencies.has(index) ||
      !dependencies ||
      dependencies.some((value, dependency) => value !== previous?.[dependency])
    )
      hooks.effects.push({ index, effect });
    hooks.dependencies.set(index, dependencies);
  },
}));
vi.mock("../lib/api", () => ({
  apiFetch: mocked.apiFetch,
  humanError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
}));
vi.mock("./locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));

import { LiveWordCloudResults } from "./live-word-cloud-results";
import { WordCloudVisual } from "./word-cloud-visual";

type Props = Parameters<typeof LiveWordCloudResults>[0];
const initialProps: Props = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  roundId: "00000000-0000-4000-8000-000000000002",
  credential: "synthetic-participant-capability",
  role: "participant",
  version: 1,
  phase: "question_open",
};

function projection(
  props = initialProps,
  { label = "current concept", version = props.version } = {},
): RoundLiveWordCloudResults {
  return {
    sessionId: props.sessionId,
    roundId: props.roundId,
    version,
    mode: "live",
    respondents: 1,
    totalTerms: 1,
    truncated: false,
    terms: [{ value: label, label, count: 1 }],
  };
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

const mounted = new Set<{ unmount: () => void }>();
function harness(update: Partial<Props> = {}) {
  let props = { ...initialProps, ...update };
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  const view = {
    get props() {
      return props;
    },
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      let tree: ReactNode;
      try {
        tree = LiveWordCloudResults(props);
      } finally {
        mocked.hooks = null;
      }
      const nodes = elements(tree);
      for (const { index, effect } of hooks.effects) {
        hooks.cleanups.get(index)?.();
        hooks.cleanups.set(index, effect());
      }
      return nodes;
    },
    update(next: Partial<Props>) {
      props = { ...props, ...next };
      return view.render();
    },
    visibleTerms() {
      return view.render().find((node) => node.type === WordCloudVisual)?.props.terms;
    },
    visibleVersion() {
      return view.render().find((node) => node.props["data-testid"] === "live-word-cloud-results")
        ?.props["data-version"];
    },
    unmount() {
      for (const cleanup of hooks.cleanups.values()) cleanup?.();
      hooks.cleanups.clear();
      mounted.delete(view);
    },
  };
  mounted.add(view);
  view.render();
  return view;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settled() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

let doc: EventTarget & { hidden: boolean };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  mocked.apiFetch.mockReset().mockResolvedValue(projection());
  doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  for (const view of [...mounted]) view.unmount();
  mocked.hooks = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live word cloud request lifecycle", () => {
  it("refreshes during continuous version arrivals without postponing the first scheduled read", async () => {
    let newestVersion = 1;
    const requestTimes: number[] = [];
    mocked.apiFetch.mockImplementation(async () => {
      requestTimes.push(Date.now());
      return projection(initialProps, { version: newestVersion });
    });
    const view = harness();
    await settled();
    expect(mocked.apiFetch).toHaveBeenCalledOnce();
    const started = Date.now();
    for (let version = 2; version <= 21 && requestTimes.length < 2; version++) {
      newestVersion = version;
      view.update({ version });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(requestTimes).toHaveLength(2);
    expect(requestTimes[1]! - started).toBeLessThanOrEqual(80);
    expect(view.visibleVersion()).toBe(newestVersion);
    expect(view.visibleTerms()).toEqual(projection().terms);
  });

  it("coalesces versions while a request is in flight and never publishes an older projection", async () => {
    const slow = deferred<RoundLiveWordCloudResults>();
    mocked.apiFetch.mockReturnValueOnce(slow.promise);
    const view = harness();
    for (let version = 2; version <= 6; version++) {
      view.update({ version });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(mocked.apiFetch).toHaveBeenCalledOnce();
    mocked.apiFetch.mockResolvedValueOnce(projection(initialProps, { version: 6 }));
    slow.resolve(projection(initialProps, { version: 1, label: "stale concept" }));
    await settled();
    expect(view.visibleTerms()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(mocked.apiFetch).toHaveBeenCalledTimes(2);
    expect(view.visibleVersion()).toBe(6);
    expect(view.visibleTerms()).toEqual(projection().terms);
  });

  it.each([
    { name: "credential", next: { credential: "replacement-participant-capability" } },
    { name: "room", next: { sessionId: "00000000-0000-4000-8000-000000000003" } },
    { name: "round", next: { roundId: "00000000-0000-4000-8000-000000000004" } },
    { name: "role", next: { role: "presenter" as const } },
    { name: "moderation freshness", next: { freshness: 1 } },
  ])("fences prior data and ignores a late response after a $name change", async ({ next }) => {
    const view = harness();
    await settled();
    expect(view.visibleTerms()).toEqual(projection().terms);
    const oldRead = deferred<RoundLiveWordCloudResults>();
    mocked.apiFetch.mockReturnValueOnce(oldRead.promise);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocked.apiFetch).toHaveBeenCalledTimes(2);
    const oldSignal = mocked.apiFetch.mock.calls[1]![1].signal as AbortSignal;
    const newRead = deferred<RoundLiveWordCloudResults>();
    mocked.apiFetch.mockReturnValueOnce(newRead.promise);
    const fenced = view.update(next);
    expect(fenced.some((node) => node.type === WordCloudVisual)).toBe(false);
    expect(view.visibleTerms()).toBeUndefined();
    expect(oldSignal.aborted).toBe(true);
    expect(mocked.apiFetch).toHaveBeenCalledTimes(3);
    oldRead.resolve(projection(initialProps, { version: 999, label: "late concept" }));
    await settled();
    expect(view.visibleTerms()).toBeUndefined();
    const fresh = projection(view.props, { label: "replacement concept" });
    newRead.resolve(fresh);
    await settled();
    expect(view.visibleTerms()).toEqual(fresh.terms);
    expect(view.visibleVersion()).toBe(fresh.version);
    expect(mocked.apiFetch.mock.calls[2]![1].headers).toEqual({
      authorization: `Bearer ${view.props.credential}`,
    });
  });

  it("hides the projection and aborts the pending read when its credential is removed", async () => {
    const view = harness();
    await settled();
    const pending = deferred<RoundLiveWordCloudResults>();
    mocked.apiFetch.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(5_000);
    const signal = mocked.apiFetch.mock.calls[1]![1].signal as AbortSignal;
    view.update({ credential: "" });
    expect(view.visibleTerms()).toBeUndefined();
    expect(signal.aborted).toBe(true);
    pending.resolve(projection(initialProps, { version: 999 }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(view.visibleTerms()).toBeUndefined();
    expect(mocked.apiFetch).toHaveBeenCalledTimes(2);
  });

  it("pauses fallback polling while hidden and refreshes immediately on visible return", async () => {
    const view = harness();
    await settled();
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(mocked.apiFetch).toHaveBeenCalledOnce();
    view.update({ version: 2 });
    await vi.advanceTimersByTimeAsync(200);
    expect(mocked.apiFetch).toHaveBeenCalledOnce();
    mocked.apiFetch.mockResolvedValueOnce(projection(initialProps, { version: 2 }));
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    await settled();
    expect(mocked.apiFetch).toHaveBeenCalledTimes(2);
    expect(view.visibleVersion()).toBe(2);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(mocked.apiFetch).toHaveBeenCalledTimes(2);
    mocked.apiFetch.mockResolvedValueOnce(projection(initialProps, { version: 2 }));
    await vi.advanceTimersByTimeAsync(1);
    expect(mocked.apiFetch).toHaveBeenCalledTimes(3);
  });

  it("reads final results once, stops routine polling, and still wakes for a newer final version", async () => {
    const view = harness({ phase: "finished" });
    await settled();
    expect(view.visibleVersion()).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocked.apiFetch).toHaveBeenCalledOnce();
    mocked.apiFetch.mockResolvedValueOnce(projection(initialProps, { version: 2 }));
    view.update({ version: 2 });
    await vi.advanceTimersByTimeAsync(200);
    expect(mocked.apiFetch).toHaveBeenCalledTimes(2);
    expect(view.visibleVersion()).toBe(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocked.apiFetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts on unmount and leaves no polling or visibility listeners behind", async () => {
    const pending = deferred<RoundLiveWordCloudResults>();
    mocked.apiFetch.mockReturnValueOnce(pending.promise);
    const view = harness();
    const signal = mocked.apiFetch.mock.calls[0]![1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve(projection());
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocked.apiFetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
