import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemorySessionCache } from "../src/cache.js";

describe("session event cache", () => {
  it("charges concurrent intents once, preserves admitted retries at capacity, and resets the fixed window", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const cache = new MemorySessionCache();
      const attempts = await Promise.all(
        Array.from({ length: 20 }, () =>
          cache.consumeIdempotentRateLimit("feedback:user", "workspace:key", 5, 60_000),
        ),
      );
      expect(attempts.every(Boolean)).toBe(true);
      for (let index = 0; index < 4; index++)
        expect(
          await cache.consumeIdempotentRateLimit("feedback:user", `workspace:${index}`, 5, 60_000),
        ).toBe(true);
      expect(
        await cache.consumeIdempotentRateLimit("feedback:user", "workspace:extra", 5, 60_000),
      ).toBe(false);
      expect(
        await cache.consumeIdempotentRateLimit("feedback:user", "workspace:key", 5, 60_000),
      ).toBe(true);
      expect(
        await cache.consumeIdempotentRateLimit("feedback:user", "other-workspace:key", 5, 60_000),
      ).toBe(false);
      expect(
        await cache.consumeIdempotentRateLimit("feedback:other-user", "workspace:key", 5, 60_000),
      ).toBe(true);
      clock.mockReturnValue(61_001);
      expect(
        await cache.consumeIdempotentRateLimit("feedback:user", "workspace:extra", 5, 60_000),
      ).toBe(true);
      await cache.close();
    } finally {
      clock.mockRestore();
    }
  });
  it("returns ordered events after the requested sequence and reports bounded history", async () => {
    const cache = new MemorySessionCache();
    const sessionId = randomUUID();
    for (let seq = 1; seq <= 1_005; seq += 1) {
      await cache.appendEvent(sessionId, seq, "session.snapshot", { version: seq });
    }

    const recent = await cache.readEvents(sessionId, 1_000, 3);
    expect(recent.map(({ seq }) => seq)).toEqual([1_001, 1_002, 1_003]);
    expect(recent[0]?.payload).toEqual({ version: 1_001 });
    expect((await cache.readEvents(sessionId, 0, 2)).map(({ seq }) => seq)).toEqual([6, 7]);
    await cache.delete(sessionId);
    expect(await cache.readEvents(sessionId, 0)).toEqual([]);
  });

  it("fences mutation lease renewal and release by owner", async () => {
    const cache = new MemorySessionCache();
    const sessionId = randomUUID();
    const firstOwner = randomUUID();
    const secondOwner = randomUUID();

    expect(await cache.acquireMutationLease(sessionId, firstOwner, 1_000)).toBe(true);
    expect(await cache.acquireMutationLease(sessionId, secondOwner, 1_000)).toBe(false);
    expect(await cache.renewMutationLease(sessionId, secondOwner, 1_000)).toBe(false);
    expect(await cache.renewMutationLease(sessionId, firstOwner, 1_000)).toBe(true);
    await cache.releaseMutationLease(sessionId, secondOwner);
    expect(await cache.acquireMutationLease(sessionId, secondOwner, 1_000)).toBe(false);
    await cache.releaseMutationLease(sessionId, firstOwner);
    expect(await cache.acquireMutationLease(sessionId, secondOwner, 1_000)).toBe(true);
  });

  it("reserves session codes once and releases them only for their owner", async () => {
    const cache = new MemorySessionCache();
    const code = "1234567";
    const firstOwner = randomUUID();
    const secondOwner = randomUUID();

    expect(await cache.reserveSessionCode(code, firstOwner, 1_000)).toBe(true);
    expect(await cache.reserveSessionCode(code, secondOwner, 1_000)).toBe(false);
    await cache.releaseSessionCode(code, secondOwner);
    expect(await cache.reserveSessionCode(code, secondOwner, 1_000)).toBe(false);
    await cache.releaseSessionCode(code, firstOwner);
    expect(await cache.reserveSessionCode(code, secondOwner, 1_000)).toBe(true);
  });

  it("shares bounded fixed-window admission counters by semantic key", async () => {
    const cache = new MemorySessionCache();
    expect(await cache.consumeRateLimit("presentation:join:room:1234567", 2, 60_000)).toBe(true);
    expect(await cache.consumeRateLimit("presentation:join:room:1234567", 2, 60_000)).toBe(true);
    expect(await cache.consumeRateLimit("presentation:join:room:1234567", 2, 60_000)).toBe(false);
    expect(await cache.consumeRateLimit("presentation:join:room:7654321", 2, 60_000)).toBe(true);
  });
});
