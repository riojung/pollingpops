import { afterEach, describe, expect, it, vi } from "vitest";
import { boardFixture, boardId } from "../../test-utils/idea-board";
import { readGuestWorkshopCanvas, watchGuestWorkshopCanvas } from "./workshop-canvas-client";

afterEach(() => vi.unstubAllGlobals());

function guestCanvas() {
  return {
    schemaVersion: 1,
    id: "00000000-0000-4000-8000-000000000008",
    sourceBoardId: boardId,
    canvasSeq: 2,
    status: "active",
    objects: [],
    sourceBoard: boardFixture,
  };
}

describe("guided canvas browser boundaries", () => {
  it("keeps board credentials out of URLs and omits creator cookies on snapshots and live streams", async () => {
    const token = "ab".repeat(32);
    const change = vi.fn();
    const encoder = new TextEncoder();
    const fetch = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json({ board: guestCanvas() }))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({ type: "canvas.ready", sourceBoardId: boardId }) + "\n",
                ),
              );
              controller.close();
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await readGuestWorkshopCanvas(boardId, token);
    await expect(
      watchGuestWorkshopCanvas(boardId, token, new AbortController().signal, change, vi.fn()),
    ).rejects.toThrow("interrupted");
    expect(change).toHaveBeenCalledOnce();
    for (const [url, init] of fetch.mock.calls) {
      expect(url).not.toContain(token);
      expect(url).not.toContain("?");
      expect(init).toMatchObject({
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { authorization: `Bearer ${token}` },
      });
    }
  });

  it("rejects mismatched sources and unexpected private projection fields", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          board: { ...guestCanvas(), sourceBoardId: "00000000-0000-4000-8000-000000000009" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          board: {
            ...guestCanvas(),
            sourceBoard: { ...boardFixture, guests: [{ tokenHash: "private" }] },
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(readGuestWorkshopCanvas(boardId, "ab".repeat(32))).rejects.toThrow("Mismatched");
    await expect(readGuestWorkshopCanvas(boardId, "ab".repeat(32))).rejects.toThrow();
  });

  it("clears the guest canvas on a revoked-access event without applying a stale change", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode('{"type":"access.revoked"}\n{"type":"canvas.changed"}\n'),
                );
                controller.close();
              },
            }),
          ),
      ),
    );
    const changed = vi.fn();
    const revoked = vi.fn();
    await watchGuestWorkshopCanvas(
      boardId,
      "ab".repeat(32),
      new AbortController().signal,
      changed,
      revoked,
    );
    expect(revoked).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
  });
});
