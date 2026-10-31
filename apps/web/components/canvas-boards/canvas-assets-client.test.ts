import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";
import { fetchCanvasImage, uploadCanvasImage } from "./canvas-assets-client";
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  API_URL: "https://api.example.test",
  apiFetch: api.fetch,
}));
const board = "00000000-0000-4000-8000-000000000001";
const media = "00000000-0000-4000-8000-000000000002";
const source = "00000000-0000-4000-8000-000000000003";
const version = "00000000-0000-4000-8000-000000000004";
const token = "a".repeat(64);
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe("canvas image transport", () => {
  it.each(["round", "presentation"] as const)(
    "uses only the authorized %s snapshot-link media proxy",
    async (kind) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(new Blob(["image"]), { headers: { "content-type": "image/png" } }),
        );
      vi.stubGlobal("fetch", fetch);
      const context = { kind, targetId: source, linkId: version };
      await fetchCanvasImage(board, media, undefined, undefined, version, context);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        `https://api.example.test/v1/${kind === "round" ? "quizzes" : "presentations"}/${source}/canvas-snapshot-links/${version}/media/${media}`,
        expect.objectContaining({
          credentials: "include",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        }),
      );
      expect(fetch.mock.calls[0]![1]).not.toHaveProperty("headers");
    },
  );
  it("never falls back to source or creator media for invalid or guest link contexts", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchCanvasImage(board, media, undefined, { sourceBoardId: source, token }, undefined, {
        kind: "round",
        targetId: source,
        linkId: version,
      }),
    ).rejects.toThrow("team access");
    for (const context of [
      { kind: "round", targetId: "../../private", linkId: version },
      { kind: "presentation", targetId: source, linkId: "" },
      { kind: "other", targetId: source, linkId: version },
      null,
    ]) {
      await expect(
        fetchCanvasImage(
          board,
          media,
          undefined,
          undefined,
          version,
          context as Parameters<typeof fetchCanvasImage>[5],
        ),
      ).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reads a saved version through its board/version/media route with creator credentials and no caching", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(new Blob(["saved image"]), { headers: { "content-type": "image/png" } }),
      );
    vi.stubGlobal("fetch", fetch);
    const abort = new AbortController();
    await expect(
      fetchCanvasImage(board, media, abort.signal, undefined, version),
    ).resolves.toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `https://api.example.test/v1/canvas-boards/${board}/versions/${version}/media/${media}`,
      {
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: abort.signal,
      },
    );
    expect(api.fetch).not.toHaveBeenCalled();
  });
  it.each([version, ""])(
    "rejects a guest saved-version request before any network access %#",
    async (versionId) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(
        fetchCanvasImage(board, media, undefined, { sourceBoardId: source, token }, versionId),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      expect(api.fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    { boardId: "../another-board", mediaId: media, versionId: version },
    { boardId: board, mediaId: "../another-image", versionId: version },
    { boardId: board, mediaId: media, versionId: "../another-version" },
    { boardId: board, mediaId: media, versionId: `${version}/media` },
    { boardId: board, mediaId: media, versionId: "" },
  ])(
    "rejects invalid saved-image path segments before network access %#",
    async ({ boardId, mediaId, versionId }) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(
        fetchCanvasImage(boardId, mediaId, undefined, undefined, versionId),
      ).rejects.toThrow("Invalid canvas");
      expect(fetch).not.toHaveBeenCalled();
      expect(api.fetch).not.toHaveBeenCalled();
    },
  );
  it("uploads without creator cookies to storage and finalizes only in the same board", async () => {
    api.fetch
      .mockResolvedValueOnce({
        mediaId: media,
        uploadUrl: "https://storage.example.test/upload",
        expiresInSeconds: 600,
        scanStatus: "pending",
      })
      .mockResolvedValueOnce({ media: { id: media, scanStatus: "clean", altText: "A diagram" } });
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      uploadCanvasImage(
        board,
        new File(["image"], "diagram.png", { type: "image/png" }),
        " A diagram ",
      ),
    ).resolves.toEqual({ mediaId: media, altText: "A diagram" });
    expect(api.fetch.mock.calls[0]![0]).toBe(`/v1/canvas-boards/${board}/media`);
    expect(api.fetch.mock.calls[1]![0]).toBe(`/v1/canvas-boards/${board}/media/${media}/complete`);
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "content-type": "image/png" },
    });
    expect(fetch.mock.calls[0]![1].headers).not.toHaveProperty("authorization");
  });
  it("rejects mismatched or rejected finalization instead of inserting an unapproved image", async () => {
    api.fetch
      .mockResolvedValueOnce({
        mediaId: media,
        uploadUrl: "https://storage.example.test/upload",
        expiresInSeconds: 600,
        scanStatus: "pending",
      })
      .mockResolvedValueOnce({
        media: { id: media, scanStatus: "rejected", altText: "A diagram" },
      });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(
      uploadCanvasImage(
        board,
        new File(["image"], "diagram.png", { type: "image/png" }),
        "A diagram",
      ),
    ).rejects.toMatchObject({ code: "MEDIA_REJECTED" });
  });
  it("omits cookies on guest reads even when the browser also has a creator session", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(new Blob(["image"]), { headers: { "content-type": "image/png" } }),
      );
    vi.stubGlobal("fetch", fetch);
    await fetchCanvasImage(board, media, undefined, { sourceBoardId: source, token });
    expect(fetch.mock.calls[0]![0]).toBe(
      `https://api.example.test/v1/canvas-boards/workshop/${source}/guest/media/${media}`,
    );
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { authorization: `Bearer ${token}` },
    });
  });
  it("keeps creator reads board-scoped and rejects active content or foreign path segments", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("script", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchCanvasImage(board, media)).rejects.toThrow("Invalid canvas image response");
    expect(fetch.mock.calls[0]![0]).toBe(
      `https://api.example.test/v1/canvas-boards/${board}/media/${media}`,
    );
    expect(fetch.mock.calls[0]![1].credentials).toBe("include");
    await expect(fetchCanvasImage(board, "../../private")).rejects.toThrow("Invalid canvas");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
