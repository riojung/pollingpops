import type * as ReactModule from "react";
import { isValidElement, type InputHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperiencePreferences } from "./experience-preferences";

type Effect = {
  callback: ReactModule.EffectCallback;
  dependencies?: ReactModule.DependencyList;
  cleanup?: () => void;
};
type Hooks = { cursor: number; slots: unknown[]; pending: Effect[]; effects: Effect[] };
const fixture = vi.hoisted(() => ({ hooks: null as Hooks | null }));

vi.mock("./locale-provider", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("../lib/sound", () => ({ unlockSoundCues: vi.fn().mockResolvedValue(undefined) }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useRef: <T,>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useState: <T,>(initial: T) => {
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
      hooks.pending.push(effect);
      hooks.effects.push(effect);
    },
  };
});

afterEach(() => {
  fixture.hooks = null;
  vi.unstubAllGlobals();
});

const storageKey = "openround:experience-preferences";

function browser(saved: string | null) {
  const values = new Map(saved === null ? [] : [[storageKey, saved]]);
  const dataset = {
    openroundContrast: "high",
    openroundMotion: "reduced",
    openroundMuted: "false",
  };
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => values.set(key, value));
  const storage = { getItem, setItem };
  const window = Object.assign(new EventTarget(), { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", { documentElement: { dataset } });
  return {
    values,
    dataset,
    getItem,
    setItem,
    setInOtherTab(preferences: unknown) {
      values.set(storageKey, JSON.stringify(preferences));
      window.dispatchEvent(
        Object.assign(new Event("storage"), { key: storageKey, storageArea: storage }),
      );
    },
  };
}

function inputs(node: ReactNode): ReactElement<InputHTMLAttributes<HTMLInputElement>>[] {
  if (Array.isArray(node)) return node.flatMap(inputs);
  if (!isValidElement(node)) return [];
  if (node.type === "input") return [node as ReactElement<InputHTMLAttributes<HTMLInputElement>>];
  return inputs((node.props as { children?: ReactNode }).children);
}

function preferences() {
  const hooks: Hooks = { cursor: 0, slots: [], pending: [], effects: [] };
  function render() {
    hooks.cursor = 0;
    fixture.hooks = hooks;
    try {
      return ExperiencePreferences();
    } finally {
      fixture.hooks = null;
    }
  }
  function commit() {
    const effects = hooks.pending.splice(0);
    for (const effect of effects) effect.cleanup = effect.callback() ?? undefined;
    return effects;
  }
  return {
    render,
    commit,
    replayMountEffects(effects: Effect[]) {
      for (const effect of effects) effect.cleanup?.();
      for (const effect of effects) effect.cleanup = effect.callback() ?? undefined;
    },
    toggle(index: number, checked: boolean) {
      const input = inputs(render())[index]!;
      input.props.onChange?.({ target: { checked } } as ReactModule.ChangeEvent<HTMLInputElement>);
      render();
      commit();
    },
  };
}

describe("experience preference persistence", () => {
  it("updates from another tab without writing the change back", () => {
    const environment = browser(null);
    const view = preferences();
    view.render();
    view.commit();
    view.render();
    view.commit();

    environment.setInOtherTab({ highContrast: false, reducedMotion: true, muted: false });
    expect(inputs(view.render()).map((input) => input.props.checked)).toEqual([false, true, false]);
    view.commit();
    expect(environment.dataset.openroundMotion).toBe("reduced");

    environment.setInOtherTab({ highContrast: true, reducedMotion: false, muted: true });
    expect(inputs(view.render()).map((input) => input.props.checked)).toEqual([true, false, true]);
    view.commit();
    expect(environment.dataset.openroundMotion).toBe("theme");
    expect(environment.setItem).not.toHaveBeenCalled();
  });

  it("retains saved accessibility choices when Strict Mode replays the initial mount effects", () => {
    const saved = { highContrast: true, reducedMotion: true, muted: false };
    const environment = browser(JSON.stringify(saved));
    const view = preferences();
    view.render();
    const mountEffects = view.commit();
    // Strict Mode sets up, cleans up and sets up the initial effects again
    // before committing the state updates queued by the saved-preference read.
    view.replayMountEffects(mountEffects);
    expect(environment.setItem).not.toHaveBeenCalled();
    expect(environment.dataset).toEqual({
      openroundContrast: "high",
      openroundMotion: "reduced",
      openroundMuted: "false",
    });
    const loaded = view.render();
    view.commit();
    expect(inputs(loaded).map((input) => input.props.checked)).toEqual([true, true, false]);
    expect(JSON.parse(environment.values.get(storageKey)!)).toEqual(saved);
    expect(environment.dataset).toEqual({
      openroundContrast: "high",
      openroundMotion: "reduced",
      openroundMuted: "false",
    });
    view.toggle(1, false);
    expect(environment.dataset.openroundMotion).toBe("theme");
    expect(JSON.parse(environment.values.get(storageKey)!)).toEqual({
      ...saved,
      reducedMotion: false,
    });
  });

  it("applies and updates DOM accessibility choices even when storage writes fail", () => {
    const environment = browser(
      JSON.stringify({ highContrast: true, reducedMotion: true, muted: false }),
    );
    environment.setItem.mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const view = preferences();
    view.render();
    view.commit();
    view.render();
    expect(() => view.commit()).not.toThrow();
    expect(environment.dataset).toEqual({
      openroundContrast: "high",
      openroundMotion: "reduced",
      openroundMuted: "false",
    });
    expect(() => {
      view.toggle(0, false);
      view.toggle(1, false);
      view.toggle(2, true);
    }).not.toThrow();
    expect(environment.dataset).toEqual({
      openroundContrast: "theme",
      openroundMotion: "theme",
      openroundMuted: "true",
    });
  });

  it("loads defaults after unreadable storage without changing DOM choices before the load commits", () => {
    const environment = browser("not JSON");
    const view = preferences();
    view.render();
    view.commit();
    expect(environment.dataset.openroundMotion).toBe("reduced");
    expect(environment.setItem).not.toHaveBeenCalled();
    const loaded = view.render();
    view.commit();
    expect(inputs(loaded).map((input) => input.props.checked)).toEqual([false, false, true]);
    expect(environment.dataset).toEqual({
      openroundContrast: "theme",
      openroundMotion: "theme",
      openroundMuted: "true",
    });
  });
});
