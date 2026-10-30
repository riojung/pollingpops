import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { facilitationFixture as initial } from "./canvas-facilitation-test-fixtures";
import { useCanvasFacilitation } from "./use-canvas-facilitation";
import type * as Client from "./canvas-facilitation-client";
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null, read: vi.fn(), write: vi.fn() }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T>(initial: T | (() => T)) => {
      const hooks = mocked.hooks!,
        index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index],
        (value: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function" ? (value as (old: T) => T)(hooks.slots[index] as T) : value;
        },
      ];
    },
    useRef: <T>(initial: T) => {
      const hooks = mocked.hooks!,
        index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useCallback: <T>(callback: T) => callback,
    useEffect: (effect: ReactModule.EffectCallback) => mocked.hooks!.effects.push(effect),
  };
});
vi.mock("./canvas-facilitation-client", async (original) => ({
  ...(await original<typeof Client>()),
  readCanvasFacilitation: mocked.read,
  writeCanvasFacilitation: mocked.write,
}));
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let cleanup: Array<() => void> = [];
  return {
    render(id = initial.boardId, seq = 1) {
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      try {
        return useCanvasFacilitation(id, seq);
      } finally {
        mocked.hooks = null;
      }
    },
    mount() {
      for (const effect of hooks.effects) {
        const result = effect();
        if (result) cleanup.push(result);
      }
    },
    unmount() {
      cleanup.forEach((effect) => effect());
      cleanup = [];
    },
  };
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  const events = new EventTarget();
  vi.stubGlobal("window", {
    setInterval,
    clearInterval,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  });
  mocked.read.mockResolvedValue(initial);
});
afterEach(() => {
  mocked.hooks = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("facilitation async state", () => {
  it("preserves an uncertain operation and proposal on exact retry and fences a conflicting edit", async () => {
    const view = harness();
    view.render();
    view.mount();
    await settle();
    const command = {
      type: "comment_edit" as const,
      threadId: initial.threads[0]!.id,
      messageId: initial.threads[0]!.messages[0]!.id,
      expectedVersion: 1,
      text: "My retained draft",
    };
    mocked.write
      .mockRejectedValueOnce(new TypeError("Lost acknowledgement"))
      .mockImplementation(async (_id, operation) => ({
        facilitation: { ...initial, canvasSeq: 2 },
        receipt: { operationId: operation.operationId, canvasSeq: 2, type: command.type },
      }));
    expect(await view.render().execute(command)).toBe(false);
    expect(view.render().failure?.operation.command).toEqual(command);
    expect(await view.render().execute()).toBe(true);
    expect(mocked.write.mock.calls[0]![1]).toEqual(mocked.write.mock.calls[1]![1]);
    mocked.write.mockRejectedValueOnce(new ApiClientError("Changed", "STALE_DRAFT", 409));
    await view.render().execute(command);
    expect(view.render().failure).toMatchObject({ conflict: true, operation: { command } });
    view.render().discard();
    expect(view.render().failure).toBeNull();
    view.unmount();
  });
  it("reruns a refresh requested while an older snapshot is pending", async () => {
    let release!: (value: typeof initial) => void;
    mocked.read
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue({ ...initial, canvasSeq: 3 });
    const view = harness();
    view.render();
    view.mount();
    const refresh = view.render().refresh();
    release({ ...initial, canvasSeq: 2 });
    await refresh;
    await settle();
    expect(mocked.read).toHaveBeenCalledTimes(2);
    expect(view.render().view?.canvasSeq).toBe(3);
    view.unmount();
  });
  it("aborts old account/workspace reads and rejects their late data after navigation", async () => {
    let release!: (value: typeof initial) => void;
    mocked.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = harness();
    view.render();
    view.mount();
    const signal = mocked.read.mock.calls[0]![1] as AbortSignal;
    view.unmount();
    const otherId = initial.actorId;
    mocked.read.mockResolvedValue({ ...initial, boardId: otherId });
    view.render(otherId);
    view.mount();
    await settle();
    release(initial);
    await settle();
    expect(signal.aborted).toBe(true);
    expect(view.render(otherId).view?.boardId).toBe(otherId);
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(view.render(otherId).view).toBeNull();
    view.unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
