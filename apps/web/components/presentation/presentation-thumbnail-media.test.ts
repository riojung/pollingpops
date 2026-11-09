import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import type * as ApiModule from "../../lib/api";
import {
  readPresentationThumbnailMedia,
  type PresentationThumbnailMediaScope,
  type ThumbnailMediaSnapshot,
} from "./presentation-thumbnail-media";

const fixture = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: fixture.request,
}));
const subscriptions: ReturnType<typeof readPresentationThumbnailMedia>[] = [];
let actor = 0;
let scope: PresentationThumbnailMediaScope;
let listeners: Map<string, Set<() => void>>;
const settle = async () => {
  for (let index = 0; index < 16; index++) await Promise.resolve();
};
function read(mediaId = "image", context = scope) {
  const snapshots: ThumbnailMediaSnapshot[] = [];
  const subscription = readPresentationThumbnailMedia(context, mediaId, (snapshot) =>
    snapshots.push(snapshot),
  );
  subscriptions.push(subscription);
  return { ...subscription, snapshots, current: () => snapshots.at(-1) };
}
function dispatch(name: string) {
  [...(listeners.get(name) ?? [])].forEach((listener) => listener());
}
beforeEach(() => {
  scope = { actorKey: `actor-${++actor}:workspace`, presentationId: "deck" };
  listeners = new Map();
  vi.stubGlobal("window", {
    addEventListener(name: string, listener: () => void) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
    },
    removeEventListener(name: string, listener: () => void) {
      listeners.get(name)?.delete(listener);
    },
  });
  fixture.request.mockReset();
});
afterEach(async () => {
  subscriptions.splice(0).forEach((subscription) => subscription.release());
  await settle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("authorized filmstrip media readers", () => {
  it("coalesces mounted readers but isolates actor and deck contexts and discards the last signed URL", async () => {
    fixture.request.mockResolvedValue({
      downloadUrl: "https://storage.example/private?signature=one",
    });
    const first = read(),
      duplicate = read();
    read("image", { ...scope, presentationId: "another-deck" });
    read("image", { ...scope, actorKey: "another-actor:workspace" });
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(3);
    expect(fixture.request.mock.calls[0]).toEqual([
      "/v1/media/image",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    ]);
    expect(first.current()).toEqual({
      status: "ready",
      source: "https://storage.example/private?signature=one",
    });
    expect(duplicate.current()).toEqual(first.current());
    first.release();
    duplicate.release();
    read();
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(4);
  });

  it("bounds concurrent authorization and cancels offscreen queued reads without starting them", async () => {
    const complete: (() => void)[] = [];
    fixture.request.mockImplementation(
      (_path: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          complete.push(() => resolve({ downloadUrl: "https://storage.example/image" }));
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Canceled", "AbortError")),
          );
        }),
    );
    const rows = Array.from({ length: 8 }, (_, index) => read(`image-${index}`));
    expect(fixture.request).toHaveBeenCalledTimes(3);
    rows.slice(3).forEach((row) => row.release());
    complete[0]!();
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(3);
    expect(rows[0]!.current()?.status).toBe("ready");
    expect(fixture.request.mock.calls.map(([path]) => path)).toEqual([
      "/v1/media/image-0",
      "/v1/media/image-1",
      "/v1/media/image-2",
    ]);
  });

  it("ignores a late authorization after the final consumer releases and removes event listeners", async () => {
    let finish!: (value: { downloadUrl: string }) => void;
    fixture.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const current = read();
    const signal = fixture.request.mock.calls[0]![1].signal as AbortSignal;
    current.release();
    expect(signal.aborted).toBe(true);
    finish({ downloadUrl: "https://storage.example/late-private-image" });
    await settle();
    expect(current.snapshots.some((snapshot) => snapshot.status === "ready")).toBe(false);
    expect(listeners.get(AUTH_CHANGE_EVENT)?.size).toBe(0);
  });

  it("refreshes only mounted images before URL expiry and clears a revoked image on refresh", async () => {
    vi.useFakeTimers();
    fixture.request
      .mockResolvedValueOnce({ downloadUrl: "https://storage.example/image?signature=old" })
      .mockResolvedValueOnce({ downloadUrl: "https://storage.example/image?signature=new" })
      .mockRejectedValueOnce({ status: 404 });
    const current = read();
    await settle();
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(current.current()).toEqual({
      status: "ready",
      source: "https://storage.example/image?signature=new",
    });
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(current.current()).toEqual({ status: "unavailable" });
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(fixture.request).toHaveBeenCalledTimes(3);
    current.release();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors an earlier signed URL deadline and refuses expired or malformed signatures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
    const short = "https://storage.example/image?X-Amz-Date=20261109T120000Z&X-Amz-Expires=90";
    fixture.request
      .mockResolvedValueOnce({ downloadUrl: short })
      .mockResolvedValueOnce({ downloadUrl: "https://storage.example/fresh" });
    const current = read();
    await settle();
    expect(current.current()).toEqual({ status: "ready", source: short });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fixture.request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(current.current()).toEqual({ status: "ready", source: "https://storage.example/fresh" });
    fixture.request.mockResolvedValueOnce({ downloadUrl: short }).mockResolvedValueOnce({
      downloadUrl: "https://storage.example/image?X-Amz-Date=bad&X-Amz-Expires=300",
    });
    const expiring = read("expired"),
      malformed = read("malformed");
    await settle();
    expect(expiring.current()).toEqual({ status: "unavailable" });
    expect(malformed.current()).toEqual({ status: "unavailable" });
  });

  it("treats denied and failed signed images as terminal while mounted, with a fresh read after remount", async () => {
    vi.useFakeTimers();
    fixture.request
      .mockRejectedValueOnce({ status: 403 })
      .mockResolvedValue({ downloadUrl: "https://storage.example/current" });
    const denied = read();
    await settle();
    expect(denied.current()).toEqual({ status: "unavailable" });
    const duplicate = read();
    await settle();
    expect(fixture.request).toHaveBeenCalledOnce();
    denied.release();
    duplicate.release();
    const image = read();
    await settle();
    image.imageFailed("https://storage.example/old");
    expect(image.current()?.status).toBe("ready");
    image.imageFailed("https://storage.example/current");
    expect(image.current()).toEqual({ status: "unavailable" });
    read();
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears loaded and pending sources on auth changes and reauthorizes a fresh same-actor mount", async () => {
    let finish!: (value: { downloadUrl: string }) => void;
    fixture.request
      .mockResolvedValueOnce({ downloadUrl: "https://storage.example/old-actor" })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ downloadUrl: "https://storage.example/new-actor" });
    const loaded = read("loaded"),
      pending = read("pending");
    await settle();
    expect(loaded.current()?.status).toBe("ready");
    dispatch(AUTH_CHANGE_EVENT);
    expect(loaded.current()).toEqual({ status: "unavailable" });
    expect(pending.current()).toEqual({ status: "unavailable" });
    expect((fixture.request.mock.calls[1]![1].signal as AbortSignal).aborted).toBe(true);
    finish({ downloadUrl: "https://storage.example/stale" });
    await settle();
    expect(pending.current()).toEqual({ status: "unavailable" });
    expect(fixture.request).toHaveBeenCalledTimes(2);
    const next = read("loaded");
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(3);
    expect(next.current()).toEqual({
      status: "ready",
      source: "https://storage.example/new-actor",
    });
    // Existing invalidated subscribers cannot borrow the freshly authorized mount's URL.
    expect(loaded.current()).toEqual({ status: "unavailable" });
    expect(pending.current()).toEqual({ status: "unavailable" });
  });

  it("reauthorizes after a workspace invalidation and never retains a failed URL", async () => {
    fixture.request
      .mockResolvedValueOnce({ downloadUrl: "https://storage.example/before-workspace-change" })
      .mockRejectedValueOnce({ status: 404 });
    const current = read();
    await settle();
    dispatch("polling-pops:workspace-updated");
    expect(current.current()).toEqual({ status: "unavailable" });
    const fresh = read();
    await settle();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(fresh.current()).toEqual({ status: "unavailable" });
  });
});
