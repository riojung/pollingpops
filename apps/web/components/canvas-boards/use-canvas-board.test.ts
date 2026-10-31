import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { canvasBoard, canvasId, canvasObject } from "./canvas-test-fixtures";
import { useCanvasBoard } from "./use-canvas-board";
import type * as Client from "./canvas-client";
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  read: vi.fn(),
  write: vi.fn(),
  watch: vi.fn(),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T>(initial: T | (() => T)) => {
      const hooks = mocked.hooks!;
      const index = hooks.cursor++;
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
      const hooks = mocked.hooks!;
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useCallback: <T>(callback: T) => callback,
    useEffect: (effect: ReactModule.EffectCallback) => mocked.hooks!.effects.push(effect),
  };
});
vi.mock("./canvas-client", async (original) => ({
  ...(await original<typeof Client>()),
  readCanvas: mocked.read,
  writeCanvas: mocked.write,
  watchCanvas: mocked.watch,
}));
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const cleanup: Array<() => void> = [];
  return {
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      try {
        return useCanvasBoard(canvasId);
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
      cleanup.forEach((value) => value());
    },
  };
}
async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
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
  mocked.watch.mockImplementation(() => new Promise(() => undefined));
});
afterEach(() => {
  mocked.hooks = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("canvas async state", () => {
  it("opens a fresh stream after EOF and keeps recovery visible across successful polling reads", async () => {
    mocked.read.mockResolvedValue(canvasBoard);
    mocked.watch
      .mockRejectedValueOnce(new Error("Canvas live updates interrupted"))
      .mockImplementation(() => new Promise(() => undefined));
    const view = harness();
    view.render();
    view.mount();
    await settle();
    expect(view.render().connection).toBe("reconnecting");
    await view.render().refresh();
    expect(view.render().connection).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(999);
    expect(mocked.watch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocked.watch).toHaveBeenCalledTimes(2);
    (mocked.watch.mock.calls[1]![2] as () => void)();
    expect(view.render().connection).toBe("saved");
    view.unmount();
  });
  it("bounds retry backoff after transient failures and cancels it on unmount", async () => {
    mocked.read.mockResolvedValue(canvasBoard);
    mocked.watch.mockRejectedValue(new TypeError("Connection lost"));
    const view = harness();
    view.render();
    view.mount();
    await settle();
    const delays = [1000, 2000, 4000, 8000, 15000, 15000];
    for (let index = 0; index < delays.length; index++) {
      await vi.advanceTimersByTimeAsync(delays[index]! - 1);
      expect(mocked.watch).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mocked.watch).toHaveBeenCalledTimes(index + 2);
    }
    const attempts = mocked.watch.mock.calls.length;
    view.unmount();
    await vi.advanceTimersByTimeAsync(60000);
    expect(mocked.watch).toHaveBeenCalledTimes(attempts);
    expect((mocked.watch.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
  });
  it("keeps authorized polling distinct from a live connection while the stream capability is paused", async () => {
    mocked.read.mockResolvedValue(canvasBoard);
    mocked.watch.mockRejectedValue(new ApiClientError("Paused", "UNAVAILABLE", 404));
    const view = harness();
    view.render();
    view.mount();
    await settle();
    expect(view.render().board?.id).toBe(canvasId);
    expect(view.render().connection).toBe("polling");
    await vi.advanceTimersByTimeAsync(5000);
    expect(view.render().connection).toBe("polling");
    expect(mocked.watch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(25000);
    expect(mocked.watch).toHaveBeenCalledTimes(2);
    view.unmount();
  });
  it("reauthorizes a live-policy revocation before restoring a still-permitted polling snapshot", async () => {
    mocked.read.mockResolvedValue(canvasBoard);
    let revoke!: () => void;
    mocked.watch
      .mockImplementationOnce(
        (_id, _signal, _change, revoked) =>
          new Promise<void>((resolve) => {
            revoke = () => {
              revoked();
              resolve();
            };
          }),
      )
      .mockRejectedValue(new ApiClientError("Paused", "UNAVAILABLE", 404));
    const view = harness();
    view.render();
    view.mount();
    await settle();
    expect(view.render().board?.id).toBe(canvasId);
    revoke();
    expect(view.render().board).toBeNull();
    await settle();
    expect(mocked.read).toHaveBeenCalledTimes(2);
    expect(view.render().board?.id).toBe(canvasId);
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.render().connection).toBe("polling");
    expect((mocked.watch.mock.calls[0]![1] as AbortSignal).aborted).toBe(false);
    view.unmount();
  });
  it("coalesces notifications and follows up when the final event arrives during a snapshot read", async () => {
    let finish!: (value: typeof canvasBoard) => void;
    mocked.read
      .mockResolvedValueOnce(canvasBoard)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ ...canvasBoard, canvasSeq: 3 });
    const view = harness();
    view.render();
    view.mount();
    await settle();
    const notify = mocked.watch.mock.calls[0]![2] as () => void;
    notify();
    notify();
    notify();
    await vi.advanceTimersByTimeAsync(349);
    expect(mocked.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocked.read).toHaveBeenCalledTimes(2);
    notify();
    notify();
    await vi.advanceTimersByTimeAsync(350);
    expect(mocked.read).toHaveBeenCalledTimes(2);
    finish({ ...canvasBoard, canvasSeq: 2 });
    await settle();
    expect(mocked.read).toHaveBeenCalledTimes(3);
    expect(view.render().board?.canvasSeq).toBe(3);
    view.unmount();
  });
  it("bounds a continuing notification burst by the first event instead of postponing it", async () => {
    mocked.read
      .mockResolvedValueOnce(canvasBoard)
      .mockResolvedValue({ ...canvasBoard, canvasSeq: 2 });
    const view = harness();
    view.render();
    view.mount();
    await settle();
    const notify = mocked.watch.mock.calls[0]![2] as () => void;
    notify();
    await vi.advanceTimersByTimeAsync(150);
    notify();
    await vi.advanceTimersByTimeAsync(199);
    expect(mocked.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocked.read).toHaveBeenCalledTimes(2);
    expect(view.render().board?.canvasSeq).toBe(2);
    view.unmount();
  });
  it("cancels a queued notification refresh on unmount and ignores later stream callbacks", async () => {
    mocked.read.mockResolvedValue(canvasBoard);
    const view = harness();
    view.render();
    view.mount();
    await settle();
    const notify = mocked.watch.mock.calls[0]![2] as () => void;
    notify();
    await vi.advanceTimersByTimeAsync(349);
    view.unmount();
    notify();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocked.read).toHaveBeenCalledOnce();
  });
  it("retries an uncertain write with the original operation identity and keeps a stale draft until review", async () => {
    mocked.read.mockResolvedValue(canvasBoard);
    mocked.write
      .mockRejectedValueOnce(new TypeError("Offline"))
      .mockImplementationOnce(async (_id, operation) => ({
        board: { ...canvasBoard, canvasSeq: 2 },
        receipt: { operationId: operation.operationId, type: "batch", canvasSeq: 2 },
      }));
    const view = harness();
    view.render();
    view.mount();
    await settle();
    await view.render().execute({
      type: "batch",
      operations: [
        {
          type: "update",
          id: canvasObject.id,
          expectedVersion: 1,
          patch: { text: "Retained local text" },
        },
      ],
    });
    expect(view.render().failure?.operation.command).toMatchObject({
      operations: [{ patch: { text: "Retained local text" } }],
    });
    await view.render().execute();
    expect(mocked.write.mock.calls[0]![1]).toEqual(mocked.write.mock.calls[1]![1]);
    expect(view.render().failure).toBeNull();
    mocked.write.mockRejectedValueOnce(new ApiClientError("Stale", "CONFLICT", 409));
    await view.render().execute({
      type: "batch",
      operations: [
        {
          type: "update",
          id: canvasObject.id,
          expectedVersion: 1,
          patch: { text: "Second draft" },
        },
      ],
    });
    expect(view.render().failure?.conflict).toBe(true);
    expect(view.render().failure?.operation.command).toMatchObject({
      operations: [{ expectedVersion: 1, patch: { text: "Second draft" } }],
    });
    view.unmount();
  });
  it("clears content and stops polling on revocation, and ignores the older in-flight read", async () => {
    let finish!: (value: typeof canvasBoard) => void;
    mocked.read
      .mockRejectedValue(new ApiClientError("Revoked", "NOT_FOUND", 404))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    let revoke!: () => void;
    mocked.watch.mockImplementationOnce(
      (_id, _signal, _change, revoked) =>
        new Promise<void>((resolve) => {
          revoke = () => {
            revoked();
            resolve();
          };
        }),
    );
    const view = harness();
    view.render();
    view.mount();
    revoke();
    finish(canvasBoard);
    await settle();
    await vi.advanceTimersByTimeAsync(6000);
    expect(view.render().board).toBeNull();
    expect(mocked.read).toHaveBeenCalledTimes(2);
    expect(mocked.watch).toHaveBeenCalledOnce();
    expect((mocked.watch.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
    view.unmount();
  });
  it("hides the current snapshot immediately when authentication changes", async () => {
    mocked.read.mockResolvedValue(canvasBoard);
    const view = harness();
    view.render();
    view.mount();
    await settle();
    expect(view.render().board).not.toBeNull();
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(view.render().board).toBeNull();
    expect((mocked.watch.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
    view.unmount();
  });
});
