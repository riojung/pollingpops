import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLibraryShareImage } from "./image-client";

const shareId = "00000000-0000-4000-8000-000000000001";
const mediaId = "00000000-0000-4000-8000-000000000002";
const controller = () => new AbortController();
const image = () =>
  new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("authenticated library image transport", () => {
  it("queues every image in a full Round and keeps login credentials out of bearer headers", async () => {
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return image();
    });
    vi.stubGlobal("fetch", fetchMock);
    const results = await Promise.all(
      Array.from({ length: 200 }, () =>
        fetchLibraryShareImage(shareId, mediaId, controller().signal),
      ),
    );
    expect(results).toHaveLength(200);
    expect(results.every((blob) => blob.size === 2)).toBe(true);
    expect(peak).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(200);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toContain(`/v1/library/shares/${shareId}/media/${mediaId}`);
      expect(options).toMatchObject({
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      expect(options.headers).toBeUndefined();
    }
  });

  it("retries temporary limits with bounded delays and stops after three attempts", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", { status: 503, headers: { "retry-after": "600" } }),
      )
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(image());
    vi.stubGlobal("fetch", fetchMock);
    const result = fetchLibraryShareImage(shareId, mediaId, controller().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).size).toBe(2);

    fetchMock.mockReset().mockImplementation(async () => new Response("busy", { status: 503 }));
    const exhausted = fetchLibraryShareImage(shareId, mediaId, controller().signal);
    const checked = expect(exhausted).rejects.toThrow("temporarily unavailable");
    await vi.runAllTimersAsync();
    await checked;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 404, 410])(
    "never retries unavailable or unauthorized images (%i)",
    async (status) => {
      const fetchMock = vi.fn(async () => new Response("unavailable", { status }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(fetchLibraryShareImage(shareId, mediaId, controller().signal)).rejects.toThrow(
        "Image unavailable",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("removes canceled waiting requests without fetching them or leaking queue capacity", async () => {
    const finish: Array<() => void> = [];
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => finish.push(() => resolve(image()))),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = fetchLibraryShareImage(shareId, mediaId, controller().signal);
    const second = fetchLibraryShareImage(shareId, mediaId, controller().signal);
    const canceled = controller();
    const third = fetchLibraryShareImage(shareId, mediaId, canceled.signal);
    const checked = expect(third).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    canceled.abort();
    await checked;
    finish.forEach((complete) => complete());
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation(async () => image());
    expect((await fetchLibraryShareImage(shareId, mediaId, controller().signal)).size).toBe(2);
  });

  it("cancels temporary-error backoff when the reader closes", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const active = controller();
    const pending = fetchLibraryShareImage(shareId, mediaId, active.signal);
    const checked = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    active.abort();
    await checked;
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(image());
    expect((await fetchLibraryShareImage(shareId, mediaId, controller().signal)).size).toBe(2);
  });

  it("rejects unsafe image responses and oversized blobs, and releases the read slot", async () => {
    const oversized = image();
    vi.spyOn(oversized, "blob").mockResolvedValue({ size: 10 * 1024 * 1024 + 1 } as Blob);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<svg />", { headers: { "content-type": "image/svg+xml" } }),
      )
      .mockResolvedValueOnce(oversized)
      .mockResolvedValueOnce(image());
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchLibraryShareImage(shareId, mediaId, controller().signal)).rejects.toThrow();
    await expect(fetchLibraryShareImage(shareId, mediaId, controller().signal)).rejects.toThrow();
    expect((await fetchLibraryShareImage(shareId, mediaId, controller().signal)).size).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
