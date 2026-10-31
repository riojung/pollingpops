import type * as ReactModule from "react";
interface EffectSlot {
  effect: true;
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}
interface Hooks {
  cursor: number;
  slots: unknown[];
  pending: Array<() => void>;
  dirty: boolean;
}
let current: Hooks | null = null;
const differs = (left?: readonly unknown[], right?: readonly unknown[]) =>
  !left ||
  !right ||
  left.length !== right.length ||
  left.some((value, i) => !Object.is(value, right[i]));
export function hookReact(react: typeof ReactModule) {
  return {
    ...react,
    useState: <T>(initial: T | (() => T)) => {
      if (!current) return react.useState(initial);
      const hooks = current,
        index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = {
          value: typeof initial === "function" ? (initial as () => T)() : initial,
        };
      const slot = hooks.slots[index] as { value: T };
      return [
        slot.value,
        (value: T | ((previous: T) => T)) => {
          const next =
            typeof value === "function" ? (value as (previous: T) => T)(slot.value) : value;
          if (!Object.is(slot.value, next)) {
            slot.value = next;
            hooks.dirty = true;
          }
        },
      ];
    },
    useRef: <T>(initial: T) => {
      if (!current) return react.useRef(initial);
      const hooks = current,
        index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useCallback: <T extends (...args: never[]) => unknown>(
      callback: T,
      dependencies: readonly unknown[],
    ) => {
      if (!current) return react.useCallback(callback, dependencies);
      const hooks = current,
        index = hooks.cursor++;
      const slot = hooks.slots[index] as
        { callback: T; dependencies: readonly unknown[] } | undefined;
      if (!slot || differs(dependencies, slot.dependencies))
        hooks.slots[index] = { callback, dependencies: [...dependencies] };
      return (hooks.slots[index] as { callback: T }).callback;
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (!current) return react.useEffect(effect, dependencies);
      const hooks = current,
        index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      if (!previous || differs(dependencies, previous.dependencies))
        hooks.pending.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();
          hooks.slots[index] = {
            effect: true,
            dependencies: dependencies ? [...dependencies] : undefined,
            cleanup: typeof cleanup === "function" ? cleanup : undefined,
          } satisfies EffectSlot;
        });
    },
  };
}
export function hookHarness<T>(read: () => T) {
  const hooks: Hooks = { cursor: 0, slots: [], pending: [], dirty: false };
  return {
    render() {
      let result!: T,
        passes = 0;
      do {
        hooks.cursor = 0;
        hooks.pending = [];
        hooks.dirty = false;
        current = hooks;
        try {
          result = read();
        } finally {
          current = null;
        }
        for (const effect of hooks.pending) effect();
        if (++passes > 30) throw new Error("Hook effects did not settle");
      } while (hooks.dirty);
      return result;
    },
    unmount() {
      for (const slot of hooks.slots)
        if (slot && typeof slot === "object" && "effect" in slot) (slot as EffectSlot).cleanup?.();
      hooks.slots = [];
      hooks.pending = [];
    },
  };
}
export async function flushPromises() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
