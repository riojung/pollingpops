import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capturePresentationReviewToken,
  createPresentationShare,
  fetchPresentationReview,
  fetchPresentationReviewImage,
  fetchPresentationShareAccess,
  PresentationReviewImageError,
  loadPresentationShareIntent,
  presentationReviewTokenKey,
  presentationShareIntent,
  presentationShareIntentKey,
  savePresentationShareIntent,
  clearPresentationShareIntent,
  isExpiredPresentationShareRequest,
} from "./presentation-sharing-client";
import { ApiClientError } from "./api";
const id = "00000000-0000-4000-8000-000000000001",
  versionId = "00000000-0000-4000-8000-000000000002";
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("private Presentation sharing client", () => {
  it("recognizes only the authoritative expired-create response as safe to reset", () => {
    expect(
      isExpiredPresentationShareRequest(
        new ApiClientError("Expired", "PRESENTATION_SHARE_REQUEST_EXPIRED", 410),
      ),
    ).toBe(true);
    for (const error of [
      new TypeError("Lost acknowledgement"),
      new ApiClientError("Unavailable", "PRESENTATION_UNAVAILABLE", 404),
      new ApiClientError("Conflict", "PRESENTATION_UNAVAILABLE", 409),
      new ApiClientError("Expired", "PRESENTATION_UNAVAILABLE", 410),
      new ApiClientError("Unavailable", "PRESENTATION_SHARE_REQUEST_EXPIRED", 503),
      { code: "PRESENTATION_SHARE_REQUEST_EXPIRED", status: 410 },
    ])
      expect(isExpiredPresentationShareRequest(error)).toBe(false);
  });
  it("clears only the matching pending request while preserving a newer dialog's intent", () => {
    vi.stubGlobal("sessionStorage", storage());
    const old = presentationShareIntent(versionId, 1);
    savePresentationShareIntent(id, old);
    clearPresentationShareIntent(id, { ...old, token: randomBytes(32).toString("base64url") });
    expect(loadPresentationShareIntent(id)).toEqual(old);
    const newer = presentationShareIntent(versionId, 7);
    savePresentationShareIntent(id, newer);
    clearPresentationShareIntent(id, old);
    expect(loadPresentationShareIntent(id)).toEqual(newer);
    clearPresentationShareIntent(id, newer);
    expect(loadPresentationShareIntent(id)).toBeNull();
  });
  it("recovers busy images in at most three attempts with bounded Retry-After delays", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", { status: 503, headers: { "retry-after": "600" } }),
      )
      .mockResolvedValueOnce(new Response("busy", { status: 503, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchPresentationReviewImage(id, "token", id, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).size).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("ends automatic busy retries and exposes a retryable error after three attempts", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn(
      async () => new Response("busy", { status: 503, headers: { "retry-after": "1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchPresentationReviewImage(id, "token", id, new AbortController().signal);
    const checked = expect(pending).rejects.toMatchObject({ retryable: true });
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTimersAsync();
    await checked;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403, 404, 410])(
    "never retries an image authorization denial %s",
    async (status) => {
      const fetchMock = vi.fn(async () => new Response("unavailable", { status }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        fetchPresentationReviewImage(id, "token", id, new AbortController().signal),
      ).rejects.toMatchObject({ retryable: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("cancels a busy retry delay without issuing another request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () => new Response("busy", { status: 503, headers: { "retry-after": "1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController(),
      pending = fetchPresentationReviewImage(id, "token", id, controller.signal);
    const checked = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await checked;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("bounds reads to two and the FIFO to64, removing canceled waiting requests promptly", async () => {
    let active = 0,
      peak = 0;
    const fetchMock = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          active++;
          peak = Math.max(peak, active);
          init.signal!.addEventListener(
            "abort",
            () => {
              active--;
              reject(init.signal!.reason);
            },
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controllers = Array.from({ length: 66 }, () => new AbortController());
    const promises = controllers.map((controller) =>
        fetchPresentationReviewImage(id, "token", id, controller.signal),
      ),
      settled = Promise.allSettled(promises);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await expect(
      fetchPresentationReviewImage(id, "token", id, new AbortController().signal),
    ).rejects.toBeInstanceOf(PresentationReviewImageError);
    controllers[2]!.abort();
    await expect(promises[2]).rejects.toMatchObject({ name: "AbortError" });
    const replacement = new AbortController(),
      replacementRead = fetchPresentationReviewImage(id, "token", id, replacement.signal),
      replacementSettled = Promise.allSettled([replacementRead]);
    for (const controller of controllers) controller.abort();
    replacement.abort();
    await settled;
    await replacementSettled;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }),
      ),
    );
    expect(
      (await fetchPresentationReviewImage(id, "token", id, new AbortController().signal)).size,
    ).toBe(1);
  });
  it("scrubs fragment credentials before networking and retains only the current tab's exact token", () => {
    const token = randomBytes(32).toString("base64url"),
      tab = storage(),
      replaceState = vi.fn();
    const pass = capturePresentationReviewToken({
      shareId: id,
      location: { href: `https://example.test/presentation-review/${id}#token=${token}` },
      history: { state: null, replaceState },
      storage: tab,
    });
    expect(pass).toBe(token);
    expect(replaceState).toHaveBeenCalledWith(null, "", `/presentation-review/${id}`);
    expect(tab.getItem(presentationReviewTokenKey(id))).toBe(token);
    expect(
      capturePresentationReviewToken({
        shareId: id,
        location: { href: `https://example.test/presentation-review/${id}` },
        history: { state: null, replaceState },
        storage: tab,
      }),
    ).toBe(token);
  });
  it("rejects duplicate/query credentials and still opens valid fragments with unavailable tab storage", () => {
    const token = randomBytes(32).toString("base64url"),
      tab = storage(),
      replaceState = vi.fn();
    for (const suffix of [`#token=${token}&token=${token}`, `?token=${token}`, "#token=invalid"]) {
      expect(
        capturePresentationReviewToken({
          shareId: id,
          location: { href: `https://example.test/presentation-review/${id}${suffix}` },
          history: { state: null, replaceState },
          storage: tab,
        }),
      ).toBeNull();
      expect(tab.getItem(presentationReviewTokenKey(id))).toBeNull();
    }
    expect(
      capturePresentationReviewToken({
        shareId: id,
        location: { href: `https://example.test/presentation-review/${id}#token=${token}` },
        history: { state: null, replaceState },
        storage: {
          getItem: () => {
            throw Error();
          },
          setItem: () => {
            throw Error();
          },
          removeItem: () => {
            throw Error();
          },
        },
      }),
    ).toBe(token);
  });
  it("persists the exact secret, request ID, version and absolute expiry across lost ACK and reload", async () => {
    const tab = storage();
    vi.stubGlobal("sessionStorage", tab);
    const intent = presentationShareIntent(versionId, 7);
    expect(Buffer.from(intent.token, "base64url")).toHaveLength(32);
    savePresentationShareIntent(id, intent);
    expect(tab.values.has(presentationShareIntentKey(id))).toBe(true);
    const response = {
      share: {
        id,
        versionId,
        createdAt: new Date().toISOString(),
        expiresAt: intent.expiresAt,
        revokedAt: null,
      },
      url: `https://example.test/presentation-review/${id}#token=${intent.token}`,
      replayed: true,
    };
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Lost acknowledgement"))
      .mockResolvedValueOnce(new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createPresentationShare(id, intent)).rejects.toThrow();
    const recovered = loadPresentationShareIntent(id)!;
    expect(recovered).toEqual(intent);
    expect((await createPresentationShare(id, recovered)).url).toBe(response.url);
    expect(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).body)).toEqual([
      JSON.stringify(intent),
      JSON.stringify(intent),
    ]);
    savePresentationShareIntent(id, null);
    expect(loadPresentationShareIntent(id)).toBeNull();
  });
  it("omits cookies/referrers, never sends token in URLs and rejects authoring fields in a review response", async () => {
    const token = randomBytes(32).toString("base64url"),
      fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            versionId,
            version: 1,
            title: "Public",
            expiresAt: new Date(Date.now() + 1000).toISOString(),
            blocks: [
              {
                id,
                kind: "question",
                question: {
                  type: "numeric",
                  prompt: "Public",
                  mediaId: null,
                  mediaAlt: null,
                  correctValue: "private",
                },
              },
            ],
            sections: [],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPresentationReview(id, token, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetchMock.mock.calls[0]![0]).toBe(`/v1/shared-presentations/${id}`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { authorization: `Bearer ${token}` },
    });
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } }),
    );
    expect(
      (await fetchPresentationReviewImage(id, token, id, new AbortController().signal)).size,
    ).toBe(2);
    expect(fetchMock.mock.calls[1]![0]).not.toContain(token);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ versionId, expiresAt: new Date(Date.now() + 1000).toISOString() }),
      ),
    );
    await fetchPresentationShareAccess(id, token, new AbortController().signal);
    expect(fetchMock.mock.calls[2]![0]).toBe(`/v1/shared-presentations/${id}/access`);
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  });
});
