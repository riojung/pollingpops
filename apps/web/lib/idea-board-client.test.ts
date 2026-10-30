import { afterEach, describe, expect, it, vi } from "vitest";
import { boardFixture, boardGuestFixture, boardId, boardIdeaId } from "../test-utils/idea-board";
import { IdeaBoardPublicInfoSchema } from "@openround/contracts";
import {
  commandIdeaBoard,
  fetchGuestIdeaBoard,
  fetchPublicIdeaBoard,
  fetchIdeaBoardImage,
  ideaBoardCommandIntent,
  ideaBoardCredential,
  ideaBoardPath,
  joinIdeaBoard,
  submitBoardIdea,
  submitBoardVotes,
  uploadIdeaBoardImage,
} from "./idea-board-client";

afterEach(() => vi.unstubAllGlobals());

describe("idea board browser boundaries", () => {
  it("uses board-scoped canvas authorization for shared creator images while preserving cookie-omitted guest reads", async () => {
    const mock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        }),
    );
    vi.stubGlobal("fetch", mock);
    const canvasId = "00000000-0000-4000-8000-000000000008";
    await fetchIdeaBoardImage(boardId, boardIdeaId, undefined, undefined, canvasId);
    expect(mock.mock.calls[0]![0]).toContain(`/canvas-boards/${canvasId}/media/${boardIdeaId}`);
    expect(mock.mock.calls[0]![1]).toMatchObject({ credentials: "include", cache: "no-store" });
    const token = "ab".repeat(32);
    await fetchIdeaBoardImage(boardId, boardIdeaId, token, undefined, canvasId);
    expect(mock.mock.calls[1]![0]).toContain(
      `/idea-boards/${boardId}/media/${boardIdeaId}/content`,
    );
    expect(mock.mock.calls[1]![1]).toMatchObject({
      credentials: "omit",
      headers: { authorization: `Bearer ${token}` },
    });
    await expect(
      fetchIdeaBoardImage(boardId, boardIdeaId, undefined, undefined, "../other"),
    ).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("uses an independent persisted 32-byte credential for each board and works without randomUUID", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    expect(ideaBoardCredential(boardId)).toBeNull();
    const token = ideaBoardCredential(boardId, true);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(ideaBoardCredential(boardId, true)).toBe(token);
    expect(ideaBoardCredential(boardIdeaId, true)).not.toBe(token);
    expect([...values.keys()]).toEqual([
      `pollingpops:idea-board:${boardId}`,
      `pollingpops:idea-board:${boardIdeaId}`,
    ]);
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    const intent = ideaBoardCommandIntent(5, { type: "collect" });
    expect(intent.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(intent.expectedRevision).toBe(5);
  });

  it("omits creator cookies and referrers on every admission, participant read and write", async () => {
    const publicKeys: string[] = IdeaBoardPublicInfoSchema.keyof().options;
    const info = Object.fromEntries(
      Object.entries(boardFixture).filter(([key]) => publicKeys.includes(key)),
    );
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ board: info }))
      .mockImplementation(async () => Response.json(boardGuestFixture));
    vi.stubGlobal("fetch", mock);
    const token = "ab".repeat(32);
    await fetchPublicIdeaBoard(boardId);
    await joinIdeaBoard(boardId, token);
    await fetchGuestIdeaBoard(boardId, token);
    await submitBoardIdea(boardId, token, {
      schemaVersion: 1,
      idempotencyKey: boardIdeaId,
      body: "Synthetic idea",
    });
    await submitBoardVotes(boardId, token, {
      schemaVersion: 1,
      idempotencyKey: boardIdeaId,
      expectedRevision: 0,
      ideaIds: [boardIdeaId],
    });
    for (const [url, init] of mock.mock.calls as Array<[string, RequestInit]>) {
      expect(url).not.toContain(token);
      expect(url).not.toContain("?");
      expect(init).toMatchObject({
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    }
    expect(mock.mock.calls[1]![1].body).toBe("{}");
    expect(mock.mock.calls[1]![1].headers.authorization).toBe(`Bearer ${token}`);
    expect(mock.mock.calls.at(-1)![1].method).toBe("PUT");
  });

  it("binds returned boards to the requested source and rejects private unexpected fields", async () => {
    expect(() => ideaBoardPath("not-an-id")).toThrow();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ...boardGuestFixture,
          board: { ...boardGuestFixture.board, id: boardIdeaId },
        }),
      )
      .mockResolvedValueOnce(Response.json({ ...boardGuestFixture, tokenHash: "private" }));
    vi.stubGlobal("fetch", mock);
    await expect(fetchGuestIdeaBoard(boardId, "ab".repeat(32))).rejects.toThrow("Mismatched board");
    await expect(fetchGuestIdeaBoard(boardId, "ab".repeat(32))).rejects.toThrow();
  });

  it("retries an uncertain host command with the same body and expected revision", async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Connection interrupted"))
      .mockResolvedValueOnce(Response.json({ board: boardFixture }));
    vi.stubGlobal("fetch", mock);
    const intent = ideaBoardCommandIntent(1, { type: "visibility", visible: true });
    await expect(commandIdeaBoard(boardId, intent)).rejects.toThrow();
    await commandIdeaBoard(boardId, intent);
    expect(mock.mock.calls[0]![1].body).toEqual(mock.mock.calls[1]![1].body);
  });

  it("uploads and scans board images without sending a board credential to storage", async () => {
    const token = "ab".repeat(32);
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "diagram.png", {
      type: "image/png",
    });
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          mediaId: boardIdeaId,
          uploadUrl: "https://storage.example.test/quarantine/diagram.png?signature=synthetic",
          expiresInSeconds: 600,
          scanStatus: "pending",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          media: { id: boardIdeaId, scanStatus: "clean", altText: "A blue square" },
        }),
      );
    vi.stubGlobal("fetch", mock);
    await expect(uploadIdeaBoardImage(boardId, token, file, "A blue square")).resolves.toEqual({
      mediaId: boardIdeaId,
      scanStatus: "clean",
      altText: "A blue square",
    });
    const calls = mock.mock.calls as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toContain(`/idea-boards/${boardId}/media`);
    expect(calls[0]![1].headers).toMatchObject({ authorization: `Bearer ${token}` });
    expect(calls[1]![1]).toMatchObject({ method: "PUT", body: file });
    expect(calls[1]![1].headers).not.toHaveProperty("authorization");
    expect(calls[2]![0]).toContain(`/idea-boards/${boardId}/media/${boardIdeaId}/complete`);
    expect(calls[2]![1].headers).toMatchObject({ authorization: `Bearer ${token}` });
    for (const [url, init] of calls) {
      expect(url).not.toContain(token);
      expect(init).toMatchObject({
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
    }
  });

  it("rejects unsupported images and missing descriptions before reserving an upload", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(
      uploadIdeaBoardImage(
        boardId,
        "ab".repeat(32),
        new File(["<svg/>"], "unsafe.svg", { type: "image/svg+xml" }),
        "A sketch",
      ),
    ).rejects.toThrow();
    await expect(
      uploadIdeaBoardImage(
        boardId,
        "ab".repeat(32),
        new File(["image"], "image.png", { type: "image/png" }),
        "  ",
      ),
    ).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });

  it.each(["rejected", "pending"])(
    "never accepts a %s scan result as an attachment",
    async (scanStatus) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            Response.json({
              mediaId: boardIdeaId,
              uploadUrl: "https://storage.example.test/image",
              expiresInSeconds: 600,
              scanStatus: "pending",
            }),
          )
          .mockResolvedValueOnce(new Response(null))
          .mockResolvedValueOnce(
            Response.json({ media: { id: boardIdeaId, scanStatus, altText: "A square" } }),
          ),
      );
      await expect(
        uploadIdeaBoardImage(
          boardId,
          "ab".repeat(32),
          new File(["image"], "image.png", { type: "image/png" }),
          "A square",
        ),
      ).rejects.toThrow("approved");
    },
  );

  it("fetches image bytes with audience credentials outside URLs and preserves creator authentication", async () => {
    const mock = vi.fn().mockImplementation(
      async () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png", "cache-control": "private, no-store" },
        }),
    );
    vi.stubGlobal("fetch", mock);
    const token = "ab".repeat(32);
    expect((await fetchIdeaBoardImage(boardId, boardIdeaId, token)).type).toBe("image/png");
    await fetchIdeaBoardImage(boardId, boardIdeaId);
    expect(mock.mock.calls[0]![0]).toContain(
      `/idea-boards/${boardId}/media/${boardIdeaId}/content`,
    );
    expect(mock.mock.calls[0]![0]).not.toContain(token);
    expect(mock.mock.calls[0]![0]).not.toContain("?");
    expect(mock.mock.calls[0]![1]).toMatchObject({
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mock.mock.calls[1]![1].credentials).toBe("include");
    expect(mock.mock.calls[1]![1].headers).toBeUndefined();
  });

  it("does not turn denied or non-image responses into displayable blobs", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ error: "not an image" }));
    vi.stubGlobal("fetch", mock);
    await expect(fetchIdeaBoardImage(boardId, boardIdeaId, "ab".repeat(32))).rejects.toMatchObject({
      status: 401,
    });
    await expect(fetchIdeaBoardImage(boardId, boardIdeaId, "ab".repeat(32))).rejects.toThrow(
      "Invalid board image",
    );
  });

  it("preserves image throttling delays so reads do not retry ahead of the server budget", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { code: "RATE_LIMITED", retryAfterSeconds: 60 } }, { status: 429 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { "retry-after": "30" } }));
    vi.stubGlobal("fetch", mock);
    await expect(fetchIdeaBoardImage(boardId, boardIdeaId)).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 60,
    });
    await expect(fetchIdeaBoardImage(boardId, boardIdeaId)).rejects.toMatchObject({
      status: 503,
      retryAfterSeconds: 30,
    });
  });

  it("preserves the exact rich submission through an uncertain retry", async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Interrupted"))
      .mockResolvedValueOnce(Response.json(boardGuestFixture));
    vi.stubGlobal("fetch", mock);
    const input = {
      schemaVersion: 1 as const,
      idempotencyKey: boardIdeaId,
      body: "A diagram and reference",
      attachments: [{ mediaId: boardIdeaId, alt: "A square" }],
      links: [
        { url: "https://example.test/reference", label: "Reference", imageMediaId: boardIdeaId },
      ],
      sketch: {
        schemaVersion: 1 as const,
        width: 1000 as const,
        height: 600 as const,
        elements: [
          {
            id: boardIdeaId,
            type: "rect" as const,
            x: 10,
            y: 20,
            width: 100,
            height: 60,
            color: "blue" as const,
            strokeWidth: 2 as const,
          },
        ],
      },
    };
    await expect(submitBoardIdea(boardId, "ab".repeat(32), input)).rejects.toThrow("Interrupted");
    await submitBoardIdea(boardId, "ab".repeat(32), input);
    expect(mock.mock.calls[0]![1].body).toBe(mock.mock.calls[1]![1].body);
    expect(JSON.parse(mock.mock.calls[1]![1].body)).toEqual(input);
  });
});
