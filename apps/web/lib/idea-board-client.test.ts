import { afterEach, describe, expect, it, vi } from "vitest";
import { boardFixture, boardGuestFixture, boardId, boardIdeaId } from "../test-utils/idea-board";
import { IdeaBoardPublicInfoSchema } from "@openround/contracts";
import {
  commandIdeaBoard,
  fetchGuestIdeaBoard,
  fetchPublicIdeaBoard,
  ideaBoardCommandIntent,
  ideaBoardCredential,
  ideaBoardPath,
  joinIdeaBoard,
  submitBoardIdea,
  submitBoardVotes,
} from "./idea-board-client";

afterEach(() => vi.unstubAllGlobals());

describe("idea board browser boundaries", () => {
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
});
