import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CanvasPresenterViewSchema,
  type CanvasPresenterView,
  type CanvasPresenterMutation,
} from "@openround/contracts";
import type * as Api from "../../lib/api";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { useCanvasPresenter } from "./use-canvas-presenter";
import { canvasBoard, canvasObject } from "./canvas-test-fixtures";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null, api: vi.fn(), fetch: vi.fn() }));
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
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof Api>()),
  apiFetch: mocked.api,
  API_URL: "http://127.0.0.1:4400",
}));

const sessionA = "00000000-0000-4000-8000-000000000011";
const sessionB = "00000000-0000-4000-8000-000000000012";
const guest = { sourceBoardId: canvasObject.id, token: "a".repeat(64) };
function presenter(patch: Partial<CanvasPresenterView> = {}) {
  return CanvasPresenterViewSchema.parse({
    schemaVersion: 1,
    boardId: canvasBoard.id,
    serverNow: "2026-11-01T12:00:00.000Z",
    revision: 1,
    active: true,
    sessionId: sessionA,
    presenterId: canvasBoard.ownerUserId,
    audience: "team",
    frameId: null,
    viewport: { x: 10, y: 20, width: 400, height: 300 },
    expiresAt: "2026-11-01T12:00:15.000Z",
    ...patch,
  });
}
function guestView(patch: Partial<CanvasPresenterView> = {}) {
  const { presenterId, ...safe } = presenter({ audience: "published", viewport: null, ...patch });
  void presenterId;
  return safe;
}
function start(): CanvasPresenterMutation {
  return {
    schemaVersion: 1,
    operationId: sessionB,
    expectedRevision: 0,
    sessionId: sessionB,
    command: {
      type: "start",
      audience: "team",
      frameId: null,
      viewport: { x: 0, y: 0, width: 500, height: 300 },
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function aborted(signal: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    const stop = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}
function harness(initialId = canvasBoard.id, initialGuest?: typeof guest) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let id = initialId,
    credentials = initialGuest,
    cleanup: Array<() => void> = [];
  return {
    render(nextId = id, nextGuest = credentials) {
      id = nextId;
      credentials = nextGuest;
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      try {
        return useCanvasPresenter(id, credentials);
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
  for (let index = 0; index < 20; index++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  const events = new EventTarget();
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  });
  vi.stubGlobal("fetch", mocked.fetch);
  mocked.api.mockResolvedValue({ presenter: presenter() });
});
afterEach(() => {
  mocked.hooks = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("presenter attention state boundaries", () => {
  it("keeps guest reads bearer-only, strictly published and unable to issue commands", async () => {
    const { presenterId, ...safe } = presenter({
      audience: "published",
      frameId: canvasObject.id,
      viewport: null,
    });
    void presenterId;
    mocked.fetch.mockResolvedValue({ ok: true, json: async () => ({ presenter: safe }) });
    const view = harness(canvasBoard.id, guest);
    view.render();
    view.mount();
    await settle();
    expect(view.render().view).toEqual(safe);
    expect(mocked.fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:4400/v1/canvas-boards/workshop/${guest.sourceBoardId}/guest/presenter`,
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        headers: { authorization: `Bearer ${guest.token}` },
      }),
    );
    expect(await view.render().command(start())).toBe(false);
    expect(mocked.api).not.toHaveBeenCalled();
    view.unmount();
  });
  it.each([
    { sourceBoardId: "", token: "" },
    { sourceBoardId: canvasObject.id, token: "not-a-guest-token" },
    { sourceBoardId: "../another-workspace", token: "a".repeat(64) },
  ])(
    "never falls back to creator cookies for malformed guest credentials %#",
    async (credentials) => {
      const view = harness(canvasBoard.id, credentials);
      view.render();
      view.mount();
      await settle();
      expect(view.render().view).toBeNull();
      expect(view.render().error).toBe(true);
      expect(mocked.api).not.toHaveBeenCalled();
      expect(mocked.fetch).not.toHaveBeenCalled();
      view.unmount();
    },
  );
  it.each([
    guestView({ boardId: canvasObject.id }),
    guestView({ audience: "team" }),
    { ...guestView(), presenterId: canvasBoard.ownerUserId },
    guestView({ viewport: { x: 0, y: 0, width: 800, height: 600 } }),
  ])("rejects foreign boards or non-guest presentation shapes %#", async (unsafe) => {
    mocked.fetch.mockResolvedValue({ ok: true, json: async () => ({ presenter: unsafe }) });
    const view = harness(canvasBoard.id, guest);
    view.render();
    view.mount();
    await settle();
    expect(view.render().view).toBeNull();
    expect(view.render().error).toBe(true);
    view.unmount();
  });
  it("expires attention by server-relative monotonic time even with a skewed local wall clock", async () => {
    mocked.api
      .mockResolvedValueOnce({ presenter: presenter({ expiresAt: "2026-11-01T12:00:01.500Z" }) })
      .mockImplementation((_path, init) => aborted(init.signal));
    const view = harness();
    view.render();
    view.mount();
    await settle();
    expect(view.render().view?.active).toBe(true);
    vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.render().view?.active).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.render().view).toBeNull();
    view.unmount();
    await settle();
  });
  it("never overlaps polling reads and aborts a stalled read after eight seconds", async () => {
    mocked.api.mockImplementation((_path, init) => aborted(init.signal));
    const view = harness();
    view.render();
    view.mount();
    const first = mocked.api.mock.calls[0]![1].signal as AbortSignal;
    await vi.advanceTimersByTimeAsync(7000);
    expect(mocked.api).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocked.api).toHaveBeenCalledTimes(2);
    view.unmount();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects stale cross-session poll data after a newer command acknowledgement", async () => {
    const old = deferred<{ presenter: CanvasPresenterView }>();
    mocked.api.mockImplementation((_path, init) =>
      init.method === "POST"
        ? Promise.resolve({
            presenter: presenter({
              sessionId: sessionB,
              revision: 1,
              serverNow: "2026-11-01T12:00:01.000Z",
              expiresAt: "2026-11-01T12:00:16.000Z",
            }),
          })
        : old.promise,
    );
    const view = harness();
    view.render();
    view.mount();
    expect(await view.render().command(start())).toBe(true);
    expect(view.render().view?.sessionId).toBe(sessionB);
    old.resolve({ presenter: presenter({ sessionId: sessionA, revision: 9 }) });
    await settle();
    expect(view.render().view?.sessionId).toBe(sessionB);
    view.unmount();
  });
  it("serializes commands, clears identity state on auth changes and ignores an old acknowledgement after remount", async () => {
    const old = deferred<{ presenter: CanvasPresenterView }>();
    mocked.api.mockImplementation((_path, init) =>
      init.method === "POST" ? old.promise : Promise.resolve({ presenter: presenter() }),
    );
    const view = harness();
    view.render();
    view.mount();
    await settle();
    const write = view.render().command(start());
    expect(view.render().working).toBe(true);
    expect(await view.render().command(start())).toBe(false);
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(view.render().view).toBeNull();
    view.unmount();
    view.render();
    view.mount();
    await settle();
    expect(view.render().working).toBe(false);
    const next = deferred<{ presenter: CanvasPresenterView }>();
    mocked.api.mockImplementation((_path, init) =>
      init.method === "POST" ? next.promise : Promise.resolve({ presenter: presenter() }),
    );
    const newWrite = view
      .render()
      .command({ ...start(), sessionId: sessionA, expectedRevision: 1, command: { type: "stop" } });
    old.resolve({ presenter: presenter({ sessionId: sessionB, revision: 2 }) });
    expect(await write).toBe(false);
    expect(view.render().view?.sessionId).toBe(sessionA);
    expect(view.render().working).toBe(true);
    next.resolve({ presenter: presenter({ revision: 2, active: false, expiresAt: null }) });
    expect(await newWrite).toBe(true);
    expect(view.render().working).toBe(false);
    view.unmount();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pauses polling during a command and resumes after its acknowledgement", async () => {
    const pending = deferred<{ presenter: CanvasPresenterView }>();
    mocked.api.mockImplementation((_path, init) =>
      init.method === "POST" ? pending.promise : Promise.resolve({ presenter: presenter() }),
    );
    const view = harness();
    view.render();
    view.mount();
    await settle();
    const command = view.render().command(start());
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocked.api.mock.calls.filter((call) => call[1].method !== "POST")).toHaveLength(1);
    pending.resolve({ presenter: presenter({ sessionId: sessionB, revision: 1 }) });
    await command;
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocked.api.mock.calls.filter((call) => call[1].method !== "POST")).toHaveLength(2);
    view.unmount();
  });
  it("ignores a late read after moving to a different board", async () => {
    const old = deferred<{ presenter: CanvasPresenterView }>();
    mocked.api.mockReturnValueOnce(old.promise);
    const view = harness();
    view.render();
    view.mount();
    view.unmount();
    mocked.api.mockResolvedValue({ presenter: presenter({ boardId: canvasObject.id }) });
    view.render(canvasObject.id);
    view.mount();
    await settle();
    old.resolve({ presenter: presenter() });
    await settle();
    expect(view.render().view?.boardId).toBe(canvasObject.id);
    view.unmount();
  });
  it("clears authorization-denied state and stops sending further reads", async () => {
    mocked.api.mockRejectedValue(new ApiClientError("Denied", "FORBIDDEN", 403));
    const view = harness();
    view.render();
    view.mount();
    await settle();
    expect(view.render().view).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocked.api).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
