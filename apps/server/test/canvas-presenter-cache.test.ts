import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { MemorySessionCache, RedisSessionCache } from "../src/cache.js";
import {
  CANVAS_PRESENTER_TTL_MS,
  type CanvasPresenterRecord,
} from "../src/canvas-presenter-state.js";

type PresenterCache = Pick<
  MemorySessionCache,
  "getCanvasPresenter" | "setCanvasPresenter" | "clearCanvasPresenter"
>;
type Mode = "memory" | "redis";
const redisUrl = process.env.TEST_REDIS_URL;
function record(patch: Partial<CanvasPresenterRecord> = {}): CanvasPresenterRecord {
  const userId = randomUUID();
  return {
    userId,
    sessionId: randomUUID(),
    revision: 1,
    active: true,
    audience: "team",
    frameId: null,
    viewport: { x: 10, y: 20, width: 600, height: 400 },
    expiresAt: Date.now() + CANVAS_PRESENTER_TTL_MS,
    operationId: randomUUID(),
    operationActorId: userId,
    hash: "a".repeat(64),
    ...patch,
  };
}
const storageKey = (id: string) => `openround:canvas-presenter:${id}`;
async function backend(
  mode: Mode,
  run: (
    clients: [PresenterCache, PresenterCache],
    boardId: string,
    inspection?: Redis,
  ) => Promise<void>,
) {
  const boardId = randomUUID();
  if (mode === "memory") {
    const cache = new MemorySessionCache();
    try {
      await run([cache, cache], boardId);
    } finally {
      await cache.close();
    }
    return;
  }
  const clients = [new RedisSessionCache(redisUrl!), new RedisSessionCache(redisUrl!)] as const;
  const inspection = new Redis(redisUrl!);
  await Promise.all(clients.map((client) => client.connect()));
  try {
    await run([...clients], boardId, inspection);
  } finally {
    await inspection.del(storageKey(boardId));
    await Promise.all(clients.map((client) => client.close()));
    await inspection.quit();
  }
}

describe.each(["memory", "redis"] as const)("%s presenter lease conformance", (mode) => {
  it.skipIf(mode === "redis" && !redisUrl)(
    "admits exactly one of twenty concurrent presentation starts",
    async () => {
      await backend(mode, async (clients, boardId) => {
        const attempts = Array.from({ length: 20 }, () => record());
        const results = await Promise.all(
          attempts.map((entry, index) =>
            clients[index % 2]!.setCanvasPresenter(boardId, entry, null),
          ),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        const winner = attempts[results.findIndex(Boolean)]!;
        expect(await clients[1].getCanvasPresenter(boardId)).toEqual(winner);
      });
    },
  );
  it.skipIf(mode === "redis" && !redisUrl)(
    "fences stale heartbeats and stops across revisions and replacement sessions",
    async () => {
      await backend(mode, async ([first, second], boardId) => {
        const original = record();
        expect(await first.setCanvasPresenter(boardId, original, null)).toBe(true);
        const heartbeat = record({ ...original, revision: 2, operationId: randomUUID() });
        expect(await second.setCanvasPresenter(boardId, heartbeat, original)).toBe(true);
        expect(
          await first.setCanvasPresenter(boardId, record({ ...heartbeat, revision: 3 }), original),
        ).toBe(false);
        expect(
          await first.setCanvasPresenter(
            boardId,
            record({ ...heartbeat, revision: 3, active: false }),
            original,
          ),
        ).toBe(false);
        // A different operation must not pass CAS merely because user/session/revision happen to match.
        expect(
          await first.setCanvasPresenter(boardId, record({ ...heartbeat, revision: 3 }), {
            ...heartbeat,
            operationId: original.operationId,
          }),
        ).toBe(false);
        const stopped = record({
          ...heartbeat,
          revision: 3,
          active: false,
          operationId: randomUUID(),
        });
        expect(await second.setCanvasPresenter(boardId, stopped, heartbeat)).toBe(true);
        const replacement = record();
        expect(await first.setCanvasPresenter(boardId, replacement, stopped)).toBe(true);
        expect(
          await second.setCanvasPresenter(
            boardId,
            record({ ...heartbeat, revision: 99 }),
            heartbeat,
          ),
        ).toBe(false);
        expect(
          await second.setCanvasPresenter(
            boardId,
            record({ ...heartbeat, revision: 99, active: false }),
            heartbeat,
          ),
        ).toBe(false);
        expect(await first.getCanvasPresenter(boardId)).toEqual(replacement);
      });
    },
  );
  it.skipIf(mode === "redis" && !redisUrl)(
    "returns isolated copies and rejects malformed writes without changing a valid lease",
    async () => {
      await backend(mode, async ([first, second], boardId) => {
        const input = record();
        expect(await first.setCanvasPresenter(boardId, input, null)).toBe(true);
        input.viewport!.x = 999;
        const read = (await second.getCanvasPresenter(boardId))!;
        expect(read.viewport?.x).toBe(10);
        read.viewport!.y = 888;
        read.hash = "b".repeat(64);
        const current = (await first.getCanvasPresenter(boardId))!;
        expect(current.viewport).toMatchObject({ x: 10, y: 20 });
        expect(current.hash).toBe("a".repeat(64));
        await expect(
          first.setCanvasPresenter(boardId, { ...current, hash: "bad" }, current),
        ).rejects.toThrow();
        await expect(
          first.setCanvasPresenter(
            boardId,
            { ...current, viewport: { x: Number.NaN, y: 0, width: 1, height: 1 } },
            current,
          ),
        ).rejects.toThrow();
        expect(await second.getCanvasPresenter(boardId)).toEqual(current);
        await first.clearCanvasPresenter(boardId);
        expect(await second.getCanvasPresenter(boardId)).toBeNull();
        await second.clearCanvasPresenter(boardId);
      });
    },
  );
});

describe("memory presenter bounds and lifetime", () => {
  it("caps lifetime at15seconds without mutating the caller and refuses renewal with an expired expected lease", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const cache = new MemorySessionCache();
    const boardId = randomUUID();
    try {
      const input = record({ expiresAt: 1_000_000 });
      expect(await cache.setCanvasPresenter(boardId, input, null)).toBe(true);
      const stored = (await cache.getCanvasPresenter(boardId))!;
      expect(stored.expiresAt).toBe(1000 + CANVAS_PRESENTER_TTL_MS);
      expect(input.expiresAt).toBe(1_000_000);
      clock.mockReturnValue(stored.expiresAt);
      expect(await cache.getCanvasPresenter(boardId)).toBeNull();
      expect(
        await cache.setCanvasPresenter(
          boardId,
          record({ ...stored, revision: 2, expiresAt: Date.now() + 5000 }),
          stored,
        ),
      ).toBe(false);
      expect(await cache.setCanvasPresenter(boardId, record(), null)).toBe(true);
    } finally {
      clock.mockRestore();
      await cache.close();
    }
  });
  it("bounds active boards at1000, reclaims expired entries and cleans its timer on close", async () => {
    vi.useFakeTimers();
    const cache = new MemorySessionCache();
    const ids = Array.from({ length: 1000 }, () => randomUUID());
    try {
      for (const boardId of ids)
        expect(await cache.setCanvasPresenter(boardId, record(), null)).toBe(true);
      const extra = randomUUID();
      await expect(cache.setCanvasPresenter(extra, record(), null)).rejects.toThrow(
        "Presentation capacity reached",
      );
      await vi.advanceTimersByTimeAsync(CANVAS_PRESENTER_TTL_MS + 1);
      expect(await cache.setCanvasPresenter(extra, record(), null)).toBe(true);
      expect(await cache.getCanvasPresenter(ids[0]!)).toBeNull();
      expect(vi.getTimerCount()).toBe(1);
      await cache.close();
      expect(await cache.getCanvasPresenter(extra)).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await cache.close();
      vi.useRealTimers();
    }
  });
});

describe.skipIf(!redisUrl)("Redis presenter expiry and corrupt records", () => {
  it("limits Redis TTL and refuses an old expected lease after Redis expiry", async () => {
    await backend("redis", async ([first, second], boardId, inspection) => {
      const initial = record({ expiresAt: Date.now() + 3_600_000 });
      expect(await first.setCanvasPresenter(boardId, initial, null)).toBe(true);
      const ttl = await inspection!.pttl(storageKey(boardId));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(CANVAS_PRESENTER_TTL_MS);
      await inspection!.pexpire(storageKey(boardId), 1);
      await vi.waitFor(async () => expect(await inspection!.pttl(storageKey(boardId))).toBe(-2));
      expect(await second.getCanvasPresenter(boardId)).toBeNull();
      expect(
        await second.setCanvasPresenter(boardId, record({ ...initial, revision: 2 }), initial),
      ).toBe(false);
      expect(await first.setCanvasPresenter(boardId, record(), null)).toBe(true);
    });
  });
  it("fails closed for malformed JSON, invalid records and stale record expiry", async () => {
    await backend("redis", async ([cache], boardId, inspection) => {
      for (const value of [
        "{broken",
        JSON.stringify({ expiresAt: Date.now() + 15000 }),
        JSON.stringify(record({ hash: "invalid" })),
        JSON.stringify(record({ expiresAt: Date.now() - 1 })),
      ]) {
        await inspection!.set(storageKey(boardId), value, "PX", CANVAS_PRESENTER_TTL_MS);
        expect(await cache.getCanvasPresenter(boardId)).toBeNull();
      }
      await cache.clearCanvasPresenter(boardId);
      expect(await cache.setCanvasPresenter(boardId, record(), null)).toBe(true);
    });
  });
});
