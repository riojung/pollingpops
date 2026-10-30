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
const token = "a".repeat(64);
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe("canvas image transport", () => {
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
