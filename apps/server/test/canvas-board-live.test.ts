import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasBoardLive, type CanvasStreamAccess } from "../src/canvas-board-live.js";
import { MemorySessionCache } from "../src/cache.js";

const relays: CanvasBoardLive[] = [];
afterEach(() => {
  for (const relay of relays.splice(0)) relay.close();
  vi.useRealTimers();
});

function response() {
  const raw = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    writeHead: vi.fn(),
    write: vi.fn((_chunk: string) => true),
    destroy: vi.fn(function (this: { destroyed: boolean }) {
      this.destroyed = true;
    }),
    end: vi.fn(function (this: { writableEnded: boolean }) {
      this.writableEnded = true;
    }),
  });
  const reply = {
    raw,
    header: vi.fn().mockReturnThis(),
    hijack: vi.fn(),
    getHeaders: () => ({}),
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
  const request = {
    raw: Object.assign(new EventEmitter(), { aborted: false }),
  } as unknown as FastifyRequest;
  return {
    raw,
    request,
    reply,
    events: () => raw.write.mock.calls.map((call) => JSON.parse(String(call[0]))),
  };
}

function fixture() {
  const metadata: CanvasStreamAccess = {
    boardId: randomUUID(),
    workspaceId: randomUUID(),
    canvasSeq: 1,
    sourceRevision: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  let revoked = false;
  const authorize = vi.fn(async () => {
    if (revoked) throw Object.assign(new Error("Removed grant"), { code: "FORBIDDEN" });
    return { ...metadata };
  });
  const outbox = {
    listOutbox: vi.fn(async (after: number) => ({
      events:
        metadata.canvasSeq > after
          ? [
              {
                eventId: randomUUID(),
                boardId: metadata.boardId,
                canvasSeq: metadata.canvasSeq,
                type: "canvas.changed" as const,
                createdAt: new Date().toISOString(),
                cursor: metadata.canvasSeq,
              },
            ]
          : [],
      cursor: metadata.canvasSeq,
    })),
  };
  const relay = new CanvasBoardLive(outbox, 1_000_000, 0);
  relays.push(relay);
  return {
    metadata,
    authorize,
    outbox,
    relay,
    revoke: () => {
      revoked = true;
    },
  };
}

describe("canvas metadata fetch streams", () => {
  it("each node independently observes metadata while documents remain on authorized HTTP reads", async () => {
    const f = fixture();
    const other = new CanvasBoardLive(f.outbox, 1_000_000, 0);
    relays.push(other);
    const first = response(),
      second = response();
    await f.relay.connect(first.request, first.reply, "same-user", f.authorize);
    await other.connect(second.request, second.reply, "same-user", f.authorize);
    await f.relay.tick();
    await other.tick();
    f.metadata.canvasSeq = 2;
    await f.relay.tick();
    await other.tick();
    expect(first.events().at(-1)).toMatchObject({ type: "canvas.changed", canvasSeq: 2 });
    expect(second.events().at(-1)).toMatchObject({ type: "canvas.changed", canvasSeq: 2 });
    expect(f.outbox.listOutbox.mock.calls.filter(([cursor]) => cursor === 0)).toHaveLength(2);
    expect(Object.keys(first.events().at(-1))).toEqual([
      "type",
      "boardId",
      "canvasSeq",
      "sourceRevision",
    ]);
  });

  it("revokes idle subscriptions without waiting for another operation", async () => {
    const f = fixture(),
      client = response();
    await f.relay.connect(client.request, client.reply, "user", f.authorize);
    f.revoke();
    await f.relay.tick();
    expect(client.events().at(-1)).toEqual({ type: "access.revoked" });
    expect(client.raw.end).toHaveBeenCalledOnce();
  });

  it("notifies source changes without treating legacy revision as the canvas sequence", async () => {
    const f = fixture(),
      client = response();
    await f.relay.connect(client.request, client.reply, "guest", f.authorize);
    f.metadata.sourceRevision = 4;
    await f.relay.tick();
    expect(client.events().at(-1)).toMatchObject({
      type: "canvas.changed",
      canvasSeq: 1,
      sourceRevision: 4,
    });
  });

  it("rechecks expiry after an authorization wait and never emits a stale invalidation", async () => {
    const f = fixture(),
      client = response();
    await f.relay.connect(client.request, client.reply, "user", f.authorize);
    f.metadata.canvasSeq = 2;
    f.metadata.expiresAt = new Date(Date.now() - 1).toISOString();
    await f.relay.tick();
    expect(client.events().at(-1)).toEqual({ type: "access.revoked" });
    expect(client.events().some((event) => event.type === "canvas.changed")).toBe(false);
  });

  it("bounds slow clients and closes on metadata outages", async () => {
    const f = fixture(),
      slow = response();
    slow.raw.write.mockReturnValue(false);
    await f.relay.connect(slow.request, slow.reply, "slow", f.authorize);
    expect(slow.raw.destroy).toHaveBeenCalledOnce();
    const client = response();
    await f.relay.connect(client.request, client.reply, "normal", f.authorize);
    f.outbox.listOutbox.mockRejectedValueOnce(new Error("Database unavailable"));
    await f.relay.tick();
    expect(client.events().at(-1)).toEqual({ type: "reconnect" });
    expect(client.raw.end).toHaveBeenCalledOnce();
  });

  it("disconnects when current authorization cannot be established promptly", async () => {
    vi.useFakeTimers();
    const f = fixture(),
      client = response();
    await f.relay.connect(client.request, client.reply, "user", f.authorize);
    f.authorize.mockImplementationOnce(async () => new Promise<CanvasStreamAccess>(() => {}));
    const checking = f.relay.tick();
    await vi.advanceTimersByTimeAsync(2_001);
    await checking;
    expect(client.events().at(-1)).toEqual({ type: "reconnect" });
    expect(client.raw.end).toHaveBeenCalledOnce();
  });
});

describe("ephemeral named canvas presence", () => {
  it("expires cursors independently from durable documents and supports opt out", async () => {
    vi.useFakeTimers();
    const cache = new MemorySessionCache();
    const boardId = randomUUID(),
      userId = randomUUID();
    await cache.setCanvasPresence(boardId, {
      userId,
      name: "Member",
      cursor: { x: 1, y: 2 },
      expiresAt: Date.now() + 10_000,
    });
    expect(await cache.listCanvasPresence(boardId)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await cache.listCanvasPresence(boardId)).toEqual([]);
    await cache.setCanvasPresence(boardId, {
      userId,
      name: "Member",
      cursor: null,
      expiresAt: Date.now() + 10_000,
    });
    await cache.removeCanvasPresence(boardId, userId);
    expect(await cache.listCanvasPresence(boardId)).toEqual([]);
    await cache.close();
  });
});
