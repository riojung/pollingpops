import type * as ReactModule from "react";
import type * as ClientModule from "./client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { createCanvasArtifactIntent } from "./client";
import { useCanvasArtifactLinks } from "./use-links";
import { flushPromises, hookHarness } from "./test-support";
const api = vi.hoisted(() => ({ list: vi.fn(), write: vi.fn() }));
vi.mock("react", async (original) => {
  const { hookReact } = await import("./test-support");
  return hookReact(await original<typeof ReactModule>());
});
vi.mock("./client", async (original) => ({
  ...(await original<typeof ClientModule>()),
  listCanvasArtifactLinks: api.list,
  writeCanvasArtifactLink: api.write,
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target = { kind: "round" as const, targetId: id(1) };
const empty = { schemaVersion: 1 as const, canCreate: true, links: [] };
const intent = () => createCanvasArtifactIntent(id(2), id(3), id(4), id(5));
const mounted: Array<{ unmount: () => void }> = [];
function mount() {
  const view = hookHarness(() => useCanvasArtifactLinks(target));
  mounted.push(view);
  view.render();
  return view;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  api.list.mockResolvedValue(empty);
  api.write.mockResolvedValue({});
});
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("canvas link operation lifetime", () => {
  it("loads once and retains the original intent for uncertain retries despite a replacement argument", async () => {
    const view = mount();
    await flushPromises();
    expect(view.render().list).toEqual(empty);
    api.write.mockRejectedValueOnce(new TypeError("lost acknowledgement"));
    const original = intent();
    expect(await view.render().execute(original)).toBe(false);
    expect(view.render().failure).toEqual({ conflict: false, retryable: true });
    expect(view.render().pending).toBe(original);
    expect(
      await view.render().execute(createCanvasArtifactIntent(id(2), id(3), id(8), id(9))),
    ).toBe(true);
    expect(api.write.mock.calls.map((call) => call[1])).toEqual([original, original]);
    expect(view.render().pending).toBeNull();
    expect(view.render().failure).toBeNull();
  });
  it("requires explicit discard/review for conflicts and never automatically writes after polls", async () => {
    const view = mount();
    await flushPromises();
    api.write.mockRejectedValueOnce(new ApiClientError("stale", "STALE_DRAFT", 409));
    const original = intent();
    await view.render().execute(original);
    expect(view.render().failure).toEqual({ conflict: true, retryable: false });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(view.render().pending).toBe(original);
    view.render().discard();
    expect(view.render().pending).toBeNull();
    expect(view.render().failure).toBeNull();
  });
  it("clears access state on a denied poll and aborts all old work on identity/workspace change", async () => {
    const view = mount();
    await flushPromises();
    const firstEpoch = view.render().accessEpoch;
    const oldSignal = api.list.mock.calls[0]![1] as AbortSignal;
    api.list.mockRejectedValueOnce(new ApiClientError("gone", "FORBIDDEN", 403));
    await vi.advanceTimersByTimeAsync(5000);
    expect(view.render()).toMatchObject({ list: null, error: true });
    expect(view.render().accessEpoch).toBeGreaterThan(firstEpoch);
    api.write.mockRejectedValueOnce(new TypeError("lost acknowledgement"));
    await view.render().execute(intent());
    expect(view.render().pending).not.toBeNull();
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    const next = view.render();
    expect(oldSignal.aborted).toBe(true);
    expect(next.pending).toBeNull();
    expect(next.list).toBeNull();
    expect(next.failure).toBeNull();
    await flushPromises();
    expect(view.render().list).toEqual(empty);
  });
  it("never lets a pre-write list replace the current post-write view", async () => {
    let resolveOld!: (value: typeof empty) => void;
    api.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const view = mount();
    const execution = view.render().execute(intent());
    await flushPromises();
    resolveOld({ ...empty, canCreate: false });
    await execution;
    await flushPromises();
    expect(view.render().list).toEqual(empty);
    expect(api.list).toHaveBeenCalledTimes(2);
  });
  it("aborts reads and ignores a write acknowledgement delivered after unmount", async () => {
    let acknowledge!: () => void;
    api.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const view = mount();
    await flushPromises();
    const execution = view.render().execute(intent());
    const signal = api.write.mock.calls[0]![2] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    acknowledge();
    await expect(execution).resolves.toBe(false);
    expect(api.list).toHaveBeenCalledTimes(1);
  });
});
