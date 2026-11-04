import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  elapsedPresentationTime,
  formatPresentationElapsedTime,
  PresenterTimer,
  presenterTimerStorageKey,
  readPresenterTimer,
  transitionPresenterTimer,
  writePresenterTimer,
} from "./presenter-timer";

type Effect = { deps?: readonly unknown[]; run: () => void | (() => void); cleanup?: () => void };
type TimerHooks = {
  cursor: number;
  states: unknown[];
  effects: Map<number, Effect>;
  pending: Effect[];
};
const fixture = vi.hoisted(() => ({ hooks: null as TimerHooks | null }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useId: () => (fixture.hooks ? "presenter-timer" : react.useId()),
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.states)) {
        hooks.states[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [hooks.states[index] as T, (next: T) => (hooks.states[index] = next)];
    },
    useEffect: (run: Effect["run"], deps?: readonly unknown[]) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useEffect(run, deps);
      const index = hooks.cursor++;
      const previous = hooks.effects.get(index);
      if (
        previous &&
        deps?.every((value, position) => Object.is(value, previous.deps?.[position]))
      ) {
        return;
      }
      previous?.cleanup?.();
      const effect = { run, deps };
      hooks.effects.set(index, effect);
      hooks.pending.push(effect);
    },
  };
});

afterEach(() => {
  fixture.hooks = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function timerHarness(sessionId: string) {
  const hooks: TimerHooks = { cursor: 0, states: [], effects: new Map(), pending: [] };
  function render() {
    fixture.hooks = hooks;
    hooks.cursor = 0;
    try {
      const wrapper = PresenterTimer({ sessionId });
      const child = wrapper.props.children as ReactElement<{ sessionId: string }>;
      return (child.type as (props: { sessionId: string }) => ReactNode)(child.props);
    } finally {
      fixture.hooks = null;
      for (const effect of hooks.pending.splice(0)) effect.cleanup = effect.run() ?? undefined;
    }
  }
  const harness = {
    markup: () => renderToStaticMarkup(render()),
    click(name: string) {
      const button = elements(render()).find(
        (element) => element.type === "button" && element.props.children === name,
      );
      if (!button || button.props.disabled) throw new Error(`Expected enabled ${name} button`);
      (button.props.onClick as () => void)();
      render();
    },
    unmount: () => hooks.effects.forEach((effect) => effect.cleanup?.()),
    replayMountEffects: () => {
      hooks.effects.forEach((effect) => {
        effect.cleanup?.();
        effect.cleanup = effect.run() ?? undefined;
      });
    },
  };
  render();
  return harness;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

const empty = { elapsedMs: 0, startedAt: null };

describe("Local presentation timer", () => {
  it("wires explicit controls, visibility catch-up and refresh restoration without restarting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const storage = memoryStorage();
    const browserDocument = new EventTarget();
    vi.stubGlobal("window", { sessionStorage: storage, setInterval, clearInterval });
    vi.stubGlobal("document", browserDocument);
    const timer = timerHarness("session-a");
    timer.replayMountEffects();
    expect(storage.values.size).toBe(0);
    timer.click("Start");
    expect(storage.values.size).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(timer.markup()).toContain("00:01");
    vi.setSystemTime(3_610_000);
    browserDocument.dispatchEvent(new Event("visibilitychange"));
    expect(timer.markup()).toContain("1:00:00");
    timer.unmount();
    expect(vi.getTimerCount()).toBe(0);

    const refreshed = timerHarness("session-a");
    expect(refreshed.markup()).toContain("1:00:00");
    refreshed.click("Pause");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5_000);
    expect(refreshed.markup()).toContain("1:00:00");
    refreshed.unmount();

    const pausedRefresh = timerHarness("session-a");
    expect(pausedRefresh.markup()).toContain("Paused");
    expect(pausedRefresh.markup()).toContain("1:00:00");
    pausedRefresh.click("Reset");
    expect(pausedRefresh.markup()).toContain("00:00");
    expect(readPresenterTimer(storage, "session-a")).toEqual(empty);
    pausedRefresh.unmount();

    const otherSession = timerHarness("session-b");
    expect(otherSession.markup()).toContain("00:00");
    expect(otherSession.markup()).toContain("Ready");
    otherSession.unmount();
  });

  it("requires an explicit start, measures wall-clock elapsed time and resumes from pause", () => {
    expect(elapsedPresentationTime(empty, 10_000)).toBe(0);
    const running = transitionPresenterTimer(empty, "start", 10_000);
    expect(running).toEqual({ elapsedMs: 0, startedAt: 10_000 });
    expect(transitionPresenterTimer(running, "start", 11_000)).toBe(running);
    // No interval ticks are needed while the tab is hidden.
    expect(elapsedPresentationTime(running, 3_610_000)).toBe(3_600_000);
    const paused = transitionPresenterTimer(running, "pause", 3_610_000);
    expect(elapsedPresentationTime(paused, 9_000_000)).toBe(3_600_000);
    expect(transitionPresenterTimer(paused, "pause", 9_000_000)).toBe(paused);
    const resumed = transitionPresenterTimer(paused, "start", 9_000_000);
    expect(elapsedPresentationTime(resumed, 9_002_500)).toBe(3_602_500);
  });

  it("retains running and paused timers across refresh independently for each session", () => {
    const storage = memoryStorage();
    const running = transitionPresenterTimer(empty, "start", 10_000);
    writePresenterTimer(storage, "session-a", running);
    expect(elapsedPresentationTime(readPresenterTimer(storage, "session-a"), 20_000)).toBe(10_000);
    expect(readPresenterTimer(storage, "session-b")).toEqual(empty);
    const paused = transitionPresenterTimer(running, "pause", 20_000);
    writePresenterTimer(storage, "session-b", paused);
    expect(elapsedPresentationTime(readPresenterTimer(storage, "session-b"), 99_000)).toBe(10_000);
    expect(readPresenterTimer(storage, "session-a")).toEqual(running);
  });

  it("resets only its own timer and stays stopped until started again", () => {
    const storage = memoryStorage();
    const running = transitionPresenterTimer(empty, "start", 10_000);
    writePresenterTimer(storage, "session-a", running);
    writePresenterTimer(storage, "session-b", running);
    storage.setItem("session-revision", "42");
    const reset = transitionPresenterTimer(running, "reset", 20_000);
    writePresenterTimer(storage, "session-a", reset);
    expect(elapsedPresentationTime(readPresenterTimer(storage, "session-a"), 99_000)).toBe(0);
    expect(readPresenterTimer(storage, "session-b")).toEqual(running);
    expect(storage.getItem("session-revision")).toBe("42");
  });

  it.each([
    "not-json",
    "null",
    "[]",
    '{"version":2,"elapsedMs":0,"startedAt":null}',
    '{"version":1,"elapsedMs":-1,"startedAt":null}',
    '{"version":1,"elapsedMs":"1000","startedAt":null}',
    '{"version":1,"elapsedMs":1.5,"startedAt":null}',
    '{"version":1,"elapsedMs":1e100,"startedAt":null}',
    '{"version":1,"elapsedMs":0,"startedAt":-1}',
    '{"version":1,"elapsedMs":0,"startedAt":"now"}',
    '{"version":1,"elapsedMs":0}',
  ])("falls back to a stopped timer for corrupt saved data %s", (saved) => {
    const storage = memoryStorage();
    storage.setItem(presenterTimerStorageKey("session"), saved);
    expect(readPresenterTimer(storage, "session")).toEqual(empty);
  });

  it("tolerates absent and blocked storage without losing in-memory timer behaviour", () => {
    const blocked = {
      getItem: () => {
        throw new Error("Storage denied");
      },
      setItem: () => {
        throw new Error("Storage full");
      },
    };
    for (const storage of [null, blocked]) {
      const timer = readPresenterTimer(storage, "session");
      const running = transitionPresenterTimer(timer, "start", 10_000);
      expect(() => writePresenterTimer(storage, "session", running)).not.toThrow();
      expect(elapsedPresentationTime(running, 20_000)).toBe(10_000);
    }
  });

  it("does not count negative elapsed time after a system clock adjustment", () => {
    expect(elapsedPresentationTime({ elapsedMs: 4_000, startedAt: 10_000 }, 9_000)).toBe(4_000);
  });

  it.each([
    [0, "00:00"],
    [999, "00:00"],
    [1_000, "00:01"],
    [65_000, "01:05"],
    [3_599_000, "59:59"],
    [3_600_000, "1:00:00"],
    [90_061_000, "25:01:01"],
  ])("formats elapsed %i ms as %s", (elapsedMs, expected) => {
    expect(formatPresentationElapsedTime(elapsedMs)).toBe(expected);
  });

  it("renders labelled elapsed time, quiet ticks and explicit local timer controls", () => {
    const markup = renderToStaticMarkup(
      <PresenterTimer sessionId="session" className="placement" />,
    );
    expect(markup).toContain('aria-label="Presentation timer"');
    expect(markup).toContain('lang="en-CA"');
    expect(markup).toContain("placement");
    expect(markup).toContain('role="timer" aria-live="off" aria-label="Elapsed presentation time"');
    expect(markup).toContain("00:00");
    expect(markup).toContain(">Start</button>");
    expect(markup).toContain(">Pause</button>");
    expect(markup).toContain(">Reset</button>");
    expect(markup).toContain("Private to this tab. Reset affects only this timer.");
  });
});
