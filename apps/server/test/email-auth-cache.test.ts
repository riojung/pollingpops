import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { MemorySessionCache, RedisSessionCache } from "../src/cache.js";

describe("fixed-window request budgets", () => {
  it("reports the remaining window across boolean and budget calls without extending denied requests", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const cache = new MemorySessionCache();
    const key = "email-auth:request-ip:boundary";
    try {
      expect(await cache.consumeRateLimit(key, 2, 900_000)).toBe(true);
      expect(await cache.consumeRateLimitBudget(key, 2, 900_000)).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
      clock.mockReturnValue(900_000);
      expect(await cache.consumeRateLimitBudget(key, 2, 900_000)).toEqual({
        allowed: false,
        retryAfterSeconds: 1,
      });
      clock.mockReturnValue(900_999);
      expect(await cache.consumeRateLimit(key, 2, 900_000)).toBe(false);
      expect(await cache.consumeRateLimitBudget(key, 2, 900_000)).toEqual({
        allowed: false,
        retryAfterSeconds: 1,
      });
      clock.mockReturnValue(901_000);
      expect(await cache.consumeRateLimitBudget(key, 2, 900_000)).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
      expect(await cache.consumeRateLimit(key, 2, 900_000)).toBe(true);
      expect(await cache.consumeRateLimitBudget(key, 2, 900_000)).toEqual({
        allowed: false,
        retryAfterSeconds: 900,
      });
    } finally {
      clock.mockRestore();
      await cache.close();
    }
  });

  it.skipIf(!process.env.TEST_REDIS_URL)(
    "shares the existing Redis counter and its remaining TTL across clients and resets at expiry",
    async () => {
      const url = process.env.TEST_REDIS_URL!;
      const clients = [new RedisSessionCache(url), new RedisSessionCache(url)];
      const inspection = new Redis(url);
      const key = `test-email-auth-ip:${randomUUID()}`;
      const storageKey = `openround:rate-limit:${key}`;
      await Promise.all(clients.map((client) => client.connect()));
      try {
        expect(await clients[0]!.consumeRateLimit(key, 2, 900_000)).toBe(true);
        expect(await clients[1]!.consumeRateLimitBudget(key, 2, 900_000)).toEqual({
          allowed: true,
          retryAfterSeconds: 0,
        });
        expect(await inspection.get(storageKey)).toBe("2");
        // Move only this test's fixed window near expiry without waiting fifteen minutes.
        await inspection.pexpire(storageKey, 5_000);
        const beforeTtl = await inspection.pttl(storageKey);
        const rejected = await Promise.all(
          Array.from({ length: 12 }, (_, index) =>
            clients[index % 2]!.consumeRateLimitBudget(key, 2, 900_000),
          ),
        );
        expect(await clients[0]!.consumeRateLimit(key, 2, 900_000)).toBe(false);
        const afterTtl = await inspection.pttl(storageKey);
        expect(afterTtl).toBeGreaterThan(0);
        expect(afterTtl).toBeLessThanOrEqual(beforeTtl);
        for (const result of rejected) {
          expect(result.allowed).toBe(false);
          expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(Math.ceil(afterTtl / 1000));
          expect(result.retryAfterSeconds).toBeLessThanOrEqual(Math.ceil(beforeTtl / 1000));
        }
        expect(await inspection.get(storageKey)).toBe("15");
        await inspection.pexpire(storageKey, 1);
        await vi.waitFor(async () => expect(await inspection.pttl(storageKey)).toBe(-2));
        expect(await clients[1]!.consumeRateLimitBudget(key, 2, 900_000)).toEqual({
          allowed: true,
          retryAfterSeconds: 0,
        });
        expect(await inspection.get(storageKey)).toBe("1");
        expect(await inspection.pttl(storageKey)).toBeGreaterThan(890_000);
      } finally {
        await inspection.del(storageKey);
        await Promise.all(clients.map((client) => client.close()));
        await inspection.quit();
      }
    },
  );
});

describe("email request admission", () => {
  it("waits for the longer cooldown when the address quota is about to reset", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const cache = new MemorySessionCache();
    try {
      expect((await cache.consumeEmailAuthBudget("pin:boundary")).allowed).toBe(true);
      clock.mockReturnValue(61_000);
      expect((await cache.consumeEmailAuthBudget("pin:boundary")).allowed).toBe(true);
      clock.mockReturnValue(899_000);
      expect((await cache.consumeEmailAuthBudget("pin:boundary")).allowed).toBe(true);
      expect(await cache.consumeEmailAuthBudget("pin:boundary")).toEqual({
        allowed: false,
        retryAfterSeconds: 60,
      });
      clock.mockReturnValue(900_000);
      expect(await cache.consumeEmailAuthBudget("pin:boundary")).toEqual({
        allowed: false,
        retryAfterSeconds: 59,
      });
      clock.mockReturnValue(959_000);
      expect((await cache.consumeEmailAuthBudget("pin:boundary")).allowed).toBe(true);
    } finally {
      clock.mockRestore();
      await cache.close();
    }
  });

  it("admits a concurrent burst once and preserves the remaining quota after rejected retries", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const cache = new MemorySessionCache();
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, () => cache.consumeEmailAuthBudget("pin:account")),
      );
      expect(results.filter((result) => result.allowed)).toHaveLength(1);
      expect(results.filter((result) => !result.allowed)).toEqual(
        Array(19).fill({ allowed: false, retryAfterSeconds: 60 }),
      );
      clock.mockReturnValue(61_000);
      expect((await cache.consumeEmailAuthBudget("pin:account")).allowed).toBe(true);
      clock.mockReturnValue(121_000);
      expect((await cache.consumeEmailAuthBudget("pin:account")).allowed).toBe(true);
      clock.mockReturnValue(181_000);
      expect(await cache.consumeEmailAuthBudget("pin:account")).toEqual({
        allowed: false,
        retryAfterSeconds: 720,
      });
      expect((await cache.consumeEmailAuthBudget("verification:account")).allowed).toBe(true);
      clock.mockReturnValue(901_000);
      expect((await cache.consumeEmailAuthBudget("pin:account")).allowed).toBe(true);
    } finally {
      clock.mockRestore();
      await cache.close();
    }
  });

  it.skipIf(!process.env.TEST_REDIS_URL)(
    "retains the full cooldown when the Redis address quota resets first",
    async () => {
      const url = process.env.TEST_REDIS_URL!;
      const cache = new RedisSessionCache(url);
      const inspection = new Redis(url);
      const key = `test-email-auth-boundary:${randomUUID()}`;
      const addressKey = `openround:rate-limit:email-auth:v2:${key}:address`;
      const cooldownKey = `openround:rate-limit:email-auth:v2:${key}:cooldown`;
      await cache.connect();
      try {
        // Model the third send just before its 15-minute quota window expires.
        await inspection.set(addressKey, "3", "PX", 1000);
        await inspection.set(cooldownKey, "1", "PX", 60_000);
        const rejected = await cache.consumeEmailAuthBudget(key);
        expect(rejected.allowed).toBe(false);
        expect(rejected.retryAfterSeconds).toBeGreaterThanOrEqual(
          Math.ceil((await inspection.pttl(cooldownKey)) / 1000),
        );
        expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(60);
        expect(await inspection.get(addressKey)).toBe("3");
        await inspection.del(addressKey);
        expect((await cache.consumeEmailAuthBudget(key)).allowed).toBe(false);
        expect(await inspection.get(addressKey)).toBeNull();
        await inspection.del(cooldownKey);
        expect((await cache.consumeEmailAuthBudget(key)).allowed).toBe(true);
        expect(await inspection.get(addressKey)).toBe("1");
      } finally {
        await inspection.del(addressKey, cooldownKey);
        await cache.close();
        await inspection.quit();
      }
    },
  );

  it.skipIf(!process.env.TEST_REDIS_URL)(
    "shares atomic admission and retry timing across Redis clients",
    async () => {
      const url = process.env.TEST_REDIS_URL!;
      const clients = [new RedisSessionCache(url), new RedisSessionCache(url)];
      const inspection = new Redis(url);
      const key = `test-email-auth:${randomUUID()}`;
      const addressKey = `openround:rate-limit:email-auth:v2:${key}:address`;
      const cooldownKey = `openround:rate-limit:email-auth:v2:${key}:cooldown`;
      await Promise.all(clients.map((client) => client.connect()));
      try {
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, index) => clients[index % 2]!.consumeEmailAuthBudget(key)),
        );
        expect(results.filter((result) => result.allowed)).toHaveLength(1);
        expect(results.filter((result) => !result.allowed)).toHaveLength(19);
        expect(
          results.every((result) => result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 60),
        ).toBe(true);
        expect(await inspection.get(addressKey)).toBe("1");
        // Expire only this test's cooldown to model two later delivery requests without a real minute wait.
        for (let request = 0; request < 2; request++) {
          await inspection.del(cooldownKey);
          expect((await clients[request]!.consumeEmailAuthBudget(key)).allowed).toBe(true);
        }
        expect(await inspection.get(addressKey)).toBe("3");
        const rejected = await clients[0]!.consumeEmailAuthBudget(key);
        expect(rejected.allowed).toBe(false);
        expect(rejected.retryAfterSeconds).toBeGreaterThan(60);
        expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(900);
        expect(await inspection.get(addressKey)).toBe("3");
        await inspection.del(addressKey, cooldownKey);
        expect((await clients[1]!.consumeEmailAuthBudget(key)).allowed).toBe(true);
      } finally {
        await inspection.del(addressKey, cooldownKey);
        await Promise.all(clients.map((client) => client.close()));
        await inspection.quit();
      }
    },
  );
});
