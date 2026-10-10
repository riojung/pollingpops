import { afterEach, describe, expect, it, vi } from "vitest";
import { createInFlightRefreshCoalescer, createReadRetryScheduler } from "./refresh-queue";
import { ApiClientError, isRetryableReadError } from "./api";

afterEach(() => vi.useRealTimers());
describe("recoverable serialized reads", () => {
  it("retries network, rate-limit and server failures but not revoked access or invalid schemas", () => {
    expect(isRetryableReadError(new TypeError("Failed to fetch"))).toBe(true);
    for (const status of [429, 500, 502, 503])
      expect(isRetryableReadError(new ApiClientError("Temporary", "RETRY", status))).toBe(true);
    for (const status of [400, 401, 403, 404, 409])
      expect(isRetryableReadError(new ApiClientError("Permanent", "STOP", status))).toBe(false);
    expect(isRetryableReadError(new Error("Unsupported schema version"))).toBe(false);
  });
  it("keeps successful slow reads and queues only one trailing refresh under continuous polling", async () => {
    vi.useFakeTimers();
    const queue = createInFlightRefreshCoalescer<void>();
    const values: number[] = [];
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    const read = async () => {
      const value = ++started;
      maximumActive = Math.max(maximumActive, ++active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
      active -= 1;
      values.push(value);
    };
    const initial = queue.run("credential", read, true);
    const requests: Promise<void>[] = [initial];
    const poll = setInterval(() => {
      requests.push(queue.run("credential", read, true));
    }, 3_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(values).toEqual([1, 2, 3, 4]);
    expect(maximumActive).toBe(1);
    clearInterval(poll);
    await vi.runAllTimersAsync();
    await Promise.all(requests);
    expect(queue.isActive("credential")).toBe(false);
  });

  it("runs the latest coalesced intent and still advances after failure", async () => {
    const queue = createInFlightRefreshCoalescer<string>();
    let reject!: (error: Error) => void;
    const active = queue.run(
      "credential",
      () =>
        new Promise<string>((_resolve, onReject) => {
          reject = onReject;
        }),
    );
    const oldTrailing = vi.fn(async () => "older intent");
    const trailing = queue.run("credential", oldTrailing, true);
    const latest = queue.run("credential", async () => "latest intent", true);
    expect(trailing).toBe(latest);
    const failed = expect(active).rejects.toThrow("Temporary read failure");
    reject(new Error("Temporary read failure"));
    await failed;
    await expect(latest).resolves.toBe("latest intent");
    expect(oldTrailing).not.toHaveBeenCalled();
  });

  it("isolates old and new credential contexts", async () => {
    const queue = createInFlightRefreshCoalescer<string>();
    let resolve!: (value: string) => void;
    const old = queue.run(
      "old credential",
      () =>
        new Promise<string>((onResolve) => {
          resolve = onResolve;
        }),
    );
    await expect(queue.run("new credential", async () => "new authorized state")).resolves.toBe(
      "new authorized state",
    );
    resolve("old state");
    await expect(old).resolves.toBe("old state");
  });

  it("retries with capped backoff and resets after synchronization succeeds", async () => {
    vi.useFakeTimers();
    const retry = createReadRetryScheduler();
    const sync = vi.fn();
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      retry.schedule(sync);
      const before = sync.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sync).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(sync).toHaveBeenCalledTimes(before + 1);
    }
    retry.reset();
    retry.schedule(sync);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync).toHaveBeenCalledTimes(8);
    retry.reset();
  });

  it("cancels scheduled work on unmount, credential change, or a newer manual read", async () => {
    vi.useFakeTimers();
    const retry = createReadRetryScheduler();
    const stale = vi.fn();
    retry.schedule(stale);
    retry.clearPending();
    await vi.runAllTimersAsync();
    expect(stale).not.toHaveBeenCalled();
    retry.schedule(stale);
    retry.reset();
    await vi.runAllTimersAsync();
    expect(stale).not.toHaveBeenCalled();
  });
});
