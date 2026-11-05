import { afterEach, describe, expect, it, vi } from "vitest";
import { useNativeTextOverflow } from "./use-native-text-overflow";
const state = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useRef: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.slots)) state.slots[index] = { current: initial };
    return state.slots[index];
  },
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.slots)) state.slots[index] = initial;
    return [
      state.slots[index],
      (next: unknown) => {
        state.slots[index] = next;
      },
    ];
  },
  useEffect: (callback: () => void | (() => void), deps: unknown[]) => {
    const index = state.cursor++,
      previous = state.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
    if (previous && deps.every((value, i) => value === previous.deps[i])) return;
    state.effects.push(() => {
      previous?.cleanup?.();
      state.slots[index] = { deps, cleanup: callback() };
    });
  },
}));
afterEach(() => vi.unstubAllGlobals());
function harness() {
  state.cursor = 0;
  state.slots = [];
  state.effects = [];
  let notify: () => void = () => {};
  const disconnect = vi.fn(),
    observe = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const fontListeners = new Map<string, () => void>(),
    windowListeners = new Map<string, () => void>();
  let fontsReady!: () => void;
  const target = {
    clientWidth: 200,
    clientHeight: 40,
    scrollWidth: 200,
    scrollHeight: 40,
    ownerDocument: {
      defaultView: {
        addEventListener: (name: string, callback: () => void) =>
          windowListeners.set(name, callback),
        removeEventListener: (name: string) => windowListeners.delete(name),
      },
      fonts: {
        addEventListener: (name: string, callback: () => void) => fontListeners.set(name, callback),
        removeEventListener: (name: string) => fontListeners.delete(name),
        ready: new Promise<void>((resolve) => {
          fontsReady = resolve;
        }),
      },
    },
  };
  function render(key = "Title and body") {
    state.cursor = 0;
    const result = useNativeTextOverflow(key);
    result.ref(target as unknown as HTMLElement);
    state.effects.splice(0).forEach((effect) => effect());
    return result;
  }
  function unmount() {
    for (const slot of state.slots) (slot as { cleanup?: () => void } | null)?.cleanup?.();
  }
  return {
    target,
    render,
    resize: () => notify(),
    font: () => fontListeners.get("loadingdone")?.(),
    fontsReady,
    disconnect,
    observe,
    fontListeners,
    windowListeners,
    unmount,
  };
}
describe("native authored text keyboard overflow", () => {
  it("adds a keyboard stop only for actual overflow and follows resize and text/layout changes", () => {
    const h = harness();
    expect(h.render().tabIndex).toBeUndefined();
    h.target.scrollHeight = 41;
    h.resize();
    expect(h.render().tabIndex).toBe(0);
    h.target.clientHeight = 80;
    h.resize();
    expect(h.render().tabIndex).toBeUndefined();
    h.target.scrollWidth = 240;
    h.render("Longer title / narrower frame");
    expect(h.render("Longer title / narrower frame").tabIndex).toBe(0);
    h.target.scrollWidth = 200;
    h.target.scrollHeight = 40;
    h.render("Short title / expanded frame");
    expect(h.render("Short title / expanded frame").tabIndex).toBeUndefined();
    h.unmount();
  });
  it("contains native scroll keys without cancelling browser scrolling or trapping Tab", () => {
    const h = harness();
    h.target.scrollHeight = 120;
    h.render();
    const result = h.render();
    for (const key of [
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "PageDown",
      "PageUp",
      "Home",
      "End",
      " ",
    ]) {
      const event = { key, stopPropagation: vi.fn(), preventDefault: vi.fn() };
      result.onKeyDown(event as never);
      expect(event.stopPropagation).toHaveBeenCalledOnce();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    for (const key of ["Tab", "Enter", "Escape"]) {
      const event = { key, stopPropagation: vi.fn() };
      result.onKeyDown(event as never);
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    h.unmount();
  });
  it("remeasures loaded fonts and cleans up observers/listeners without adding hidden text stops", async () => {
    const h = harness();
    h.render();
    h.target.scrollHeight = 100;
    h.font();
    expect(h.render().tabIndex).toBe(0);
    h.target.clientWidth = 0;
    h.resize();
    expect(h.render().tabIndex).toBeUndefined();
    h.unmount();
    expect(h.disconnect).toHaveBeenCalled();
    expect(h.fontListeners.size).toBe(0);
    expect(h.windowListeners.size).toBe(0);
    h.target.clientWidth = 200;
    h.fontsReady();
    await Promise.resolve();
    expect(h.render().tabIndex).toBeUndefined();
  });
});
