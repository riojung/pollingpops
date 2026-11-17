import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPETITION_CELEBRATION_MS,
  useCompetitionCelebration,
} from "./use-competition-celebration";

type Effect = {
  dependencies?: ReactModule.DependencyList;
  callback: ReactModule.EffectCallback;
  cleanup?: () => void;
};
type Hooks = { cursor: number; slots: unknown[]; pending: Effect[]; effects: Effect[] };
const fixture = vi.hoisted(() => ({ hooks: null as Hooks | null }));

vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useRef: <T>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useState: <T>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (next: T | ((previous: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (previous: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useEffect: (
      callback: ReactModule.EffectCallback,
      dependencies?: ReactModule.DependencyList,
    ) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useEffect(callback, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as Effect | undefined;
      if (
        previous &&
        dependencies?.every((value, position) =>
          Object.is(value, previous.dependencies?.[position]),
        )
      )
        return;
      const effect: Effect = { callback, dependencies };
      hooks.slots[index] = effect;
      hooks.pending.push({
        callback: () => {
          previous?.cleanup?.();
          effect.cleanup = callback() ?? undefined;
        },
      });
      hooks.effects.push(effect);
    },
  };
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  fixture.hooks = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function browser() {
  vi.useFakeTimers();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = Object.assign(new EventTarget(), { innerHeight: 800 });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  const observers: Array<{
    notify: (visible: boolean) => void;
    anchor: (visible: boolean) => void;
    intersect: (index: number, visibleHeight: number) => void;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      disconnect = vi.fn();
      targets: Element[] = [];
      observe(target: Element) {
        this.targets.push(target);
      }
      constructor(callback: IntersectionObserverCallback) {
        const entry = (target: Element, visibleHeight: number) =>
          ({
            target,
            isIntersecting: visibleHeight > 0,
            intersectionRect: { height: visibleHeight },
            boundingClientRect: target.getBoundingClientRect(),
          }) as IntersectionObserverEntry;
        observers.push({
          disconnect: this.disconnect,
          anchor: (visible) =>
            callback(
              [entry(this.targets[0]!, visible ? 80 : 0)],
              this as unknown as IntersectionObserver,
            ),
          intersect: (index, visibleHeight) =>
            callback(
              [entry(this.targets[index]!, visibleHeight)],
              this as unknown as IntersectionObserver,
            ),
          notify: (visible) =>
            callback(
              this.targets.map((target) => entry(target, visible ? 80 : 0)),
              this as unknown as IntersectionObserver,
            ),
        });
      }
    },
  );
  return { doc, win, observers };
}

function dashboard({ anchorHeight = 80, dashboardHeight = 80 } = {}) {
  const hooks: Hooks = { cursor: 0, slots: [], pending: [], effects: [] };
  let props = { eligible: true, enabled: true, releaseKey: "final:4" };
  const anchor = {
    getBoundingClientRect: () => ({
      width: 600,
      height: anchorHeight,
      top: 30,
      bottom: 30 + anchorHeight,
    }),
  };
  const root = {
    querySelector: () => anchor,
    getBoundingClientRect: () => ({
      width: 600,
      height: dashboardHeight,
      top: 30,
      bottom: 30 + dashboardHeight,
    }),
  } as unknown as HTMLElement;
  function render() {
    hooks.cursor = 0;
    fixture.hooks = hooks;
    try {
      return useCompetitionCelebration(props);
    } finally {
      fixture.hooks = null;
    }
  }
  function commit() {
    for (const effect of hooks.pending.splice(0)) effect.callback();
  }
  const api = {
    render,
    update(update: Partial<typeof props>) {
      props = { ...props, ...update };
      render();
      commit();
      return render();
    },
    unmount() {
      hooks.effects.forEach((effect) => effect.cleanup?.());
    },
  };
  render().ref.current = root;
  commit();
  cleanups.push(api.unmount);
  return api;
}

describe("viewed final-standings celebration", () => {
  it("waits for visible results and an active page, then plays once until explicitly replayed", () => {
    const { doc, observers } = browser();
    const view = dashboard();
    expect(view.render()).toMatchObject({ run: 0, playing: false });
    observers[0]!.notify(false);
    doc.hidden = true;
    observers[0]!.notify(true);
    expect(view.render().run).toBe(0);
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(view.render()).toMatchObject({ run: 1, playing: true });
    expect(view.update({})).toMatchObject({ run: 1, playing: true });
    vi.advanceTimersByTime(COMPETITION_CELEBRATION_MS);
    expect(view.render().playing).toBe(false);
    observers[0]!.notify(false);
    observers[0]!.notify(true);
    expect(view.render()).toMatchObject({ run: 1, playing: false });
    view.render().replay();
    expect(view.render()).toMatchObject({ run: 2, playing: true });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(observers[0]!.disconnect).toHaveBeenCalled();
  });

  it("resumes an interrupted finale on return instead of spending it in a hidden tab", () => {
    const { doc, observers } = browser();
    const view = dashboard();
    observers[0]!.notify(true);
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(view.render().playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(view.render()).toMatchObject({ run: 2, playing: true });
    observers[0]!.notify(false);
    expect(view.render().playing).toBe(false);
    observers[0]!.notify(true);
    expect(view.render()).toMatchObject({ run: 3, playing: true });
  });

  it("keeps playing while scrolling within the visible dashboard and allows explicit replay", () => {
    const { observers } = browser();
    const view = dashboard();
    observers[0]!.notify(true);
    observers[0]!.anchor(false);
    expect(view.render()).toMatchObject({ run: 1, playing: true });
    vi.advanceTimersByTime(COMPETITION_CELEBRATION_MS);
    view.render().replay();
    expect(view.render()).toMatchObject({ run: 2, playing: true });
  });

  it("starts when a tall stage enters the inset viewport without reaching 10% visibility", () => {
    const { observers } = browser();
    const view = dashboard({ anchorHeight: 12_000, dashboardHeight: 12_000 });
    // Intersection rectangles are relative to the observer's inset viewport.
    // Both targets can enter by one pixel while remaining far below a 10% ratio.
    observers[0]!.intersect(1, 1);
    observers[0]!.intersect(0, 0);
    expect(view.render()).toMatchObject({ run: 0, playing: false });
    observers[0]!.intersect(0, 1);
    expect(view.render()).toMatchObject({ run: 1, playing: true });
    vi.advanceTimersByTime(COMPETITION_CELEBRATION_MS);
    observers[0]!.intersect(0, 80);
    expect(view.render()).toMatchObject({ run: 1, playing: false });
  });

  it("cancels effects immediately for accessibility or ineligible results and cleans old releases", () => {
    const { observers } = browser();
    const view = dashboard();
    observers[0]!.notify(true);
    expect(view.update({ enabled: false }).playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    view.render().replay();
    expect(view.render().run).toBe(1);
    view.update({ enabled: true });
    observers[1]!.notify(true);
    expect(view.render()).toMatchObject({ run: 2, playing: true });
    view.update({ releaseKey: "final:5" });
    expect(view.render().playing).toBe(false);
    observers[2]!.notify(true);
    expect(view.render()).toMatchObject({ run: 3, playing: true });
    expect(view.update({ eligible: false }).playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses measured viewport visibility in browsers without IntersectionObserver", () => {
    const { win } = browser();
    vi.stubGlobal("IntersectionObserver", undefined);
    win.innerHeight = 0;
    const view = dashboard();
    expect(view.render().playing).toBe(false);
    win.innerHeight = 800;
    win.dispatchEvent(new Event("resize"));
    expect(view.render()).toMatchObject({ run: 1, playing: true });
    vi.advanceTimersByTime(COMPETITION_CELEBRATION_MS);
    win.dispatchEvent(new Event("scroll"));
    expect(view.render()).toMatchObject({ run: 1, playing: false });
  });
});
