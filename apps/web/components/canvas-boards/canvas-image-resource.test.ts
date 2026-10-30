import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api";
import { readCanvasImage } from "./canvas-image-resource";
const fixture = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./canvas-assets-client", () => ({ fetchCanvasImage: fixture.fetch }));
const subscriptions: ReturnType<typeof readCanvasImage>[] = [];
const settle = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};
function read(media = "one", token?: string) {
  const result = readCanvasImage(
    "board",
    media,
    token ? { sourceBoardId: "source", token } : undefined,
  );
  subscriptions.push(result);
  void result.promise.catch(() => {});
  return result;
}
afterEach(async () => {
  subscriptions.splice(0).forEach((read) => read.release());
  await settle();
  vi.useRealTimers();
  vi.resetAllMocks();
});
describe("canvas image queue", () => {
  it("coalesces mounted duplicates, limits concurrency, and isolates guest credentials", async () => {
    const pending: Array<(blob: Blob) => void> = [];
    fixture.fetch.mockImplementation(
      (_board: string, _media: string, signal: AbortSignal) =>
        new Promise<Blob>((resolve, reject) => {
          pending.push(resolve);
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const first = read(),
      duplicate = read();
    read("two");
    read("three");
    read("four");
    expect(first.promise).toBe(duplicate.promise);
    expect(fixture.fetch).toHaveBeenCalledTimes(3);
    pending[0]!(new Blob(["one"]));
    await settle();
    expect(fixture.fetch).toHaveBeenCalledTimes(4);
    read("one", "different-token");
    pending[1]!(new Blob(["two"]));
    await settle();
    expect(fixture.fetch).toHaveBeenCalledTimes(5);
    expect(fixture.fetch.mock.calls[4]![3]).toMatchObject({ token: "different-token" });
  });
  it("honors retry-after and cancels the last consumer's pending retry", async () => {
    vi.useFakeTimers();
    fixture.fetch.mockRejectedValue(new ApiClientError("Limited", "RATE_LIMITED", 429, 3));
    const first = read(),
      duplicate = read();
    await settle();
    await vi.advanceTimersByTimeAsync(2999);
    expect(fixture.fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    const signal = fixture.fetch.mock.calls[0]![2] as AbortSignal;
    first.release();
    expect(signal.aborted).toBe(false);
    duplicate.release();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });
  it("does not retry authorization failures and discards released blobs", async () => {
    fixture.fetch
      .mockRejectedValueOnce(new ApiClientError("Denied", "NOT_FOUND", 404))
      .mockResolvedValue(new Blob(["new"]));
    const denied = read();
    await expect(denied.promise).rejects.toMatchObject({ status: 404 });
    denied.release();
    const fresh = read();
    await expect(fresh.promise).resolves.toBeInstanceOf(Blob);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });
});
