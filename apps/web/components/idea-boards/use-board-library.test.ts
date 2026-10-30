import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";
import { canvasBoard } from "../canvas-boards/canvas-test-fixtures";
import { boardFixture } from "../../test-utils/idea-board";
import { useBoardLibrary } from "./use-board-library";
interface EffectSlot {
  dependencies: readonly unknown[] | undefined;
  cleanup?: () => void;
}
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null, api: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: mocked.api,
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
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      const hooks = mocked.hooks!;
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      if (
        !previous ||
        !dependencies ||
        !previous.dependencies ||
        dependencies.some((value, position) => !Object.is(value, previous.dependencies![position]))
      )
        hooks.effects.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();
          hooks.slots[index] = { dependencies, ...(cleanup ? { cleanup } : {}) };
        });
    },
  };
});
function id(index: number) {
  return "00000000-0000-4000-8000-" + String(index).padStart(12, "0");
}
const initial = {
  workspaceId: id(1),
  scope: "all" as const,
  search: "",
  refresh: 0,
  canvasEnabled: true,
};
function harness() {
  let options: Parameters<typeof useBoardLibrary>[0] = initial;
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  function render() {
    hooks.cursor = 0;
    hooks.effects = [];
    mocked.hooks = hooks;
    let result: ReturnType<typeof useBoardLibrary>;
    try {
      result = useBoardLibrary(options);
    } finally {
      mocked.hooks = null;
    }
    hooks.effects.forEach((effect) => effect());
    return result;
  }
  return {
    render,
    update(next: Partial<typeof options>) {
      options = { ...options, ...next };
      return render();
    },
    unmount() {
      for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let index = 0; index < 15; index++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
});
afterEach(() => {
  mocked.hooks = null;
  vi.useRealTimers();
});
describe("authoritative board library search", () => {
  it("finds later-page legacy and canvas titles with bounded server queries instead of downloading all pages", async () => {
    mocked.api.mockImplementation(async (path: string) => {
      const url = new URL(path, "http://local");
      const canvas = url.pathname.includes("canvas-boards");
      if (url.searchParams.get("search") === "NEEDLE")
        return {
          boards: [
            {
              ...(canvas ? canvasBoard : boardFixture),
              id: id(canvas ? 101 : 102),
              title: "A later Needle board",
            },
          ],
          nextCursor: null,
        };
      return {
        boards: Array.from({ length: 50 }, (_, index) => ({
          ...(canvas ? canvasBoard : boardFixture),
          id: id(index + 10),
          title: "Initial " + index,
        })),
        nextCursor: id(59),
      };
    });
    const view = harness();
    view.render();
    await settle();
    expect(view.render().data?.canvases).toHaveLength(50);
    view.update({ search: "  NEEDLE  " });
    expect(view.render().data).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(view.render().data?.canvases[0]!.id).toBe(id(101));
    expect(view.render().data?.boards[0]!.id).toBe(id(102));
    const searched = mocked.api.mock.calls.slice(2).map(([path]) => new URL(path, "http://local"));
    expect(searched).toHaveLength(2);
    expect(
      searched.every(
        (url) => url.searchParams.get("search") === "NEEDLE" && !url.searchParams.has("cursor"),
      ),
    ).toBe(true);
    view.unmount();
  });
  it("debounces typing and resets both pagination cursors when the query changes", async () => {
    mocked.api.mockImplementation(async (path: string) => {
      const url = new URL(path, "http://local"),
        canvas = url.pathname.includes("canvas-boards");
      return {
        boards: [
          {
            ...(canvas ? canvasBoard : boardFixture),
            title: url.searchParams.get("search") || "Initial",
          },
        ],
        nextCursor: url.searchParams.has("cursor") ? null : id(50),
      };
    });
    const view = harness();
    view.render();
    await settle();
    await view.render().more();
    expect(
      mocked.api.mock.calls
        .slice(2, 4)
        .every(([path]) => new URL(path, "http://local").searchParams.get("cursor") === id(50)),
    ).toBe(true);
    view.update({ search: "n" });
    await vi.advanceTimersByTimeAsync(100);
    view.update({ search: "ne" });
    await vi.advanceTimersByTimeAsync(100);
    view.update({ search: "needle" });
    expect(mocked.api).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    const requests = mocked.api.mock.calls.slice(4).map(([path]) => new URL(path, "http://local"));
    expect(requests).toHaveLength(2);
    expect(
      requests.every(
        (url) => url.searchParams.get("search") === "needle" && !url.searchParams.has("cursor"),
      ),
    ).toBe(true);
    view.unmount();
  });
  it("ignores stale query results and failures even when a transport does not honor abort", async () => {
    const old = deferred<{ boards: unknown[]; nextCursor: null }>();
    mocked.api.mockImplementation(async (path: string) => {
      const query = new URL(path, "http://local").searchParams.get("search");
      if (query === "old") return old.promise;
      return { boards: [{ ...canvasBoard, title: "Latest match" }], nextCursor: null };
    });
    const view = harness();
    view.update({ scope: "shared", search: "old" });
    await vi.advanceTimersByTimeAsync(300);
    const oldSignal = mocked.api.mock.calls[0]![1].signal as AbortSignal;
    view.update({ search: "latest" });
    expect(oldSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    old.resolve({ boards: [{ ...canvasBoard, title: "Stale secret" }], nextCursor: null });
    await settle();
    expect(view.render().data?.canvases.map((board) => board.title)).toEqual(["Latest match"]);
    expect(view.render().error).toBe(false);
    const pending = deferred<{ boards: unknown[]; nextCursor: null }>();
    mocked.api.mockImplementationOnce(() => pending.promise);
    view.update({ search: "slow" });
    await vi.advanceTimersByTimeAsync(300);
    view.update({ search: "latest" });
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    pending.reject(new Error("Old failure"));
    await settle();
    expect(view.render().error).toBe(false);
    expect(view.render().data?.canvases[0]!.title).toBe("Latest match");
    view.unmount();
  });
  it("clears rows and fences old workspace pagination, while preserving shared/archive filters", async () => {
    const pending = deferred<{ boards: unknown[]; nextCursor: null }>();
    mocked.api
      .mockResolvedValueOnce({ boards: [canvasBoard], nextCursor: id(50) })
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue({
        boards: [{ ...canvasBoard, title: "New workspace board" }],
        nextCursor: null,
      });
    const view = harness();
    view.update({ scope: "shared" });
    await settle();
    const oldMore = view.render().more();
    const oldSignal = mocked.api.mock.calls[1]![1].signal as AbortSignal;
    view.update({ workspaceId: id(2), scope: "archived" });
    expect(view.render().data).toBeNull();
    expect(oldSignal.aborted).toBe(true);
    await settle();
    pending.resolve({
      boards: [{ ...canvasBoard, title: "Old workspace board" }],
      nextCursor: null,
    });
    await oldMore;
    expect(view.render().data?.canvases.map((board) => board.title)).toEqual([
      "New workspace board",
    ]);
    expect(
      mocked.api.mock.calls.every(([path]) => String(path).startsWith("/v1/canvas-boards")),
    ).toBe(true);
    expect(mocked.api.mock.calls.at(-1)![0]).toBe("/v1/canvas-boards?scope=archived");
    view.unmount();
  });
});
