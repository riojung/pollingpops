import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeSummary } from "./home-model";

interface EffectSlot {
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}
interface Hooks {
  cursor: number;
  slots: unknown[];
  pending: Array<() => void>;
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null, apiFetch: vi.fn() }));
vi.mock("../../lib/api", () => ({
  apiFetch: mocked.apiFetch,
  humanError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T>(initial: T | (() => T)) => {
      if (!mocked.hooks) return react.useState(initial);
      const hooks = mocked.hooks;
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index],
        (next: T | ((value: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (!mocked.hooks) return react.useEffect(effect, dependencies);
      const hooks = mocked.hooks;
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      if (
        previous &&
        dependencies?.length === previous.dependencies?.length &&
        dependencies?.every((value, i) => Object.is(value, previous.dependencies?.[i]))
      )
        return;
      const slot: EffectSlot = { dependencies };
      hooks.slots[index] = slot;
      hooks.pending.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        if (typeof cleanup === "function") slot.cleanup = cleanup;
      });
    },
  };
});

import { useHomeSummary } from "./home-summary";

function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], pending: [] };
  function commit() {
    hooks.pending.splice(0).forEach((effect) => effect());
  }
  return {
    render(contextKey: string | null, commitEffects = true) {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      let state: ReturnType<typeof useHomeSummary>;
      try {
        state = useHomeSummary(contextKey);
      } finally {
        mocked.hooks = null;
      }
      if (commitEffects) commit();
      return state;
    },
    commit,
    unmount() {
      for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function summary(name: string): HomeSummary {
  return {
    generatedAt: name,
    recentArtifacts: [],
    sessions: [],
    assignments: [],
    resultHighlights: [],
    groupSchedule: [],
    totals: { artifacts: 1, activeSessions: 0, activeAssignments: 0, upcomingGroupItems: 0 },
  };
}
beforeEach(() => {
  mocked.apiFetch.mockReset();
});
afterEach(() => {
  mocked.hooks = null;
});

describe("Home summary context isolation", () => {
  it("hides the previous workspace synchronously and aborts its request on a context change", async () => {
    const first = deferred<HomeSummary>();
    const second = deferred<HomeSummary>();
    mocked.apiFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = harness();
    view.render("user-a:workspace-a");
    const firstSignal = mocked.apiFetch.mock.calls[0]![1].signal as AbortSignal;
    expect(mocked.apiFetch.mock.calls[0]![1].cache).toBe("no-store");
    first.resolve(summary("workspace-a"));
    await first.promise;
    expect(view.render("user-a:workspace-a").summary?.generatedAt).toBe("workspace-a");
    const switching = view.render("user-a:workspace-b", false);
    expect(switching.summary).toBeNull();
    expect(switching.error).toBe("");
    expect(switching.loading).toBe(true);
    view.commit();
    expect(firstSignal.aborted).toBe(true);
    second.resolve(summary("workspace-b"));
    await second.promise;
    expect(view.render("user-a:workspace-b").summary?.generatedAt).toBe("workspace-b");
    view.unmount();
  });

  it("ignores a late result from the previous account even when its fetch ignores abort", async () => {
    const first = deferred<HomeSummary>();
    const second = deferred<HomeSummary>();
    mocked.apiFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = harness();
    view.render("account-a");
    view.render("account-b");
    second.resolve(summary("account-b"));
    await second.promise;
    first.resolve(summary("account-a-private"));
    await first.promise;
    const state = view.render("account-b");
    expect(state.summary?.generatedAt).toBe("account-b");
    expect(state.loading).toBe(false);
    expect(state.error).toBe("");
    view.unmount();
  });

  it("suppresses stale errors and clears data when there is no authorized context", async () => {
    const first = deferred<HomeSummary>();
    const second = deferred<HomeSummary>();
    mocked.apiFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = harness();
    view.render("account-a");
    view.render("account-b");
    second.resolve(summary("account-b"));
    await second.promise;
    first.reject(new Error("Account A private failure"));
    await first.promise.catch(() => undefined);
    expect(view.render("account-b").error).toBe("");
    const unauthorized = view.render(null, false);
    expect(unauthorized.summary).toBeNull();
    expect(unauthorized.loading).toBe(false);
    view.commit();
    expect((mocked.apiFetch.mock.calls[1]![1].signal as AbortSignal).aborted).toBe(true);
    expect(mocked.apiFetch).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("aborts an earlier refresh and ignores responses after unmount", async () => {
    const first = deferred<HomeSummary>();
    const retry = deferred<HomeSummary>();
    mocked.apiFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const view = harness();
    view.render("account-a").refresh();
    view.render("account-a");
    expect((mocked.apiFetch.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(true);
    view.unmount();
    expect((mocked.apiFetch.mock.calls[1]![1].signal as AbortSignal).aborted).toBe(true);
    retry.resolve(summary("unmounted"));
    first.resolve(summary("stale"));
    await Promise.all([retry.promise, first.promise]);
    expect(view.render("account-a").summary).toBeNull();
  });
});
