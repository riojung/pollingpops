import Redis from "ioredis";
import type { GameState } from "@openround/game-engine";

export interface CachedSessionEvent {
  seq: number;
  type: string;
  payload: unknown;
  serverTime: string;
}

export interface RateLimitBudget {
  allowed: boolean;
  retryAfterSeconds: number;
}

export type EmailAuthBudget = RateLimitBudget;

export interface SessionCache {
  get(sessionId: string): Promise<GameState | null>;
  set(state: GameState, ttlSeconds: number): Promise<void>;
  appendEvent(sessionId: string, seq: number, type: string, payload: unknown): Promise<void>;
  appendEvents(
    sessionId: string,
    events: Array<{ seq: number; type: string; payload: unknown }>,
  ): Promise<void>;
  readEvents(sessionId: string, afterSeq: number, limit?: number): Promise<CachedSessionEvent[]>;
  reserveSessionCode(code: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseSessionCode(code: string, owner: string): Promise<void>;
  acquireMutationLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean>;
  renewMutationLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseMutationLease(sessionId: string, owner: string): Promise<void>;
  /** Atomic fixed-window admission counter shared by HTTP and Socket.IO paths. */
  consumeRateLimit(key: string, maximum: number, windowMs: number): Promise<boolean>;
  /** The same counter, with the remaining fixed-window wait when denied. */
  consumeRateLimitBudget(key: string, maximum: number, windowMs: number): Promise<RateLimitBudget>;
  /** Atomically reserve an email request; rejected cooldown retries do not spend its quota. */
  consumeEmailAuthBudget(key: string): Promise<EmailAuthBudget>;
  /** Charge each scoped intent once, including concurrent retries on different processes. */
  consumeIdempotentRateLimit(
    key: string,
    intent: string,
    maximum: number,
    windowMs: number,
  ): Promise<boolean>;
  delete(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

export class MemorySessionCache implements SessionCache {
  private readonly states = new Map<string, GameState>();
  private readonly events = new Map<string, CachedSessionEvent[]>();
  private readonly codeReservations = new Map<string, { owner: string; expiresAt: number }>();
  private readonly leases = new Map<string, { owner: string; expiresAt: number }>();
  private readonly rateLimits = new Map<string, { count: number; expiresAt: number }>();
  private readonly idempotentLimits = new Map<
    string,
    { intents: Set<string>; expiresAt: number }
  >();

  async get(sessionId: string) {
    const state = this.states.get(sessionId);
    return state ? structuredClone(state) : null;
  }

  async set(state: GameState, _ttlSeconds: number) {
    this.states.set(state.sessionId, structuredClone(state));
  }

  async appendEvent(sessionId: string, seq: number, type: string, payload: unknown) {
    await this.appendEvents(sessionId, [{ seq, type, payload }]);
  }

  async appendEvents(
    sessionId: string,
    additions: Array<{ seq: number; type: string; payload: unknown }>,
  ) {
    const events = this.events.get(sessionId) ?? [];
    for (const { seq, type, payload } of additions) {
      events.push({
        seq,
        type,
        payload: structuredClone(payload),
        serverTime: new Date().toISOString(),
      });
    }
    this.events.set(sessionId, events.slice(-1_000));
  }

  async readEvents(sessionId: string, afterSeq: number, limit = 100) {
    return (this.events.get(sessionId) ?? [])
      .filter((event) => event.seq > afterSeq)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async reserveSessionCode(code: string, owner: string, ttlMs: number) {
    const current = this.codeReservations.get(code);
    if (current && current.expiresAt > Date.now()) return false;
    this.codeReservations.set(code, { owner, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async releaseSessionCode(code: string, owner: string) {
    if (this.codeReservations.get(code)?.owner === owner) this.codeReservations.delete(code);
  }

  async acquireMutationLease(sessionId: string, owner: string, ttlMs: number) {
    const current = this.leases.get(sessionId);
    if (current && current.expiresAt > Date.now() && current.owner !== owner) return false;
    this.leases.set(sessionId, { owner, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async renewMutationLease(sessionId: string, owner: string, ttlMs: number) {
    const current = this.leases.get(sessionId);
    if (!current || current.owner !== owner || current.expiresAt <= Date.now()) return false;
    current.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async releaseMutationLease(sessionId: string, owner: string) {
    if (this.leases.get(sessionId)?.owner === owner) this.leases.delete(sessionId);
  }

  async consumeRateLimit(key: string, maximum: number, windowMs: number) {
    return (await this.consumeRateLimitBudget(key, maximum, windowMs)).allowed;
  }

  async consumeRateLimitBudget(
    key: string,
    maximum: number,
    windowMs: number,
  ): Promise<RateLimitBudget> {
    const now = Date.now();
    const current = this.rateLimits.get(key);
    if (!current || current.expiresAt <= now) {
      this.rateLimits.set(key, { count: 1, expiresAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    current.count += 1;
    if (this.rateLimits.size > 10_000) {
      for (const [candidate, bucket] of this.rateLimits) {
        if (bucket.expiresAt <= now) this.rateLimits.delete(candidate);
      }
    }
    const allowed = current.count <= maximum;
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((current.expiresAt - now) / 1000)),
    };
  }

  async consumeEmailAuthBudget(key: string): Promise<EmailAuthBudget> {
    const now = Date.now();
    const addressKey = `email-auth:v2:${key}:address`;
    const cooldownKey = `email-auth:v2:${key}:cooldown`;
    const address = this.rateLimits.get(addressKey);
    const cooldown = this.rateLimits.get(cooldownKey);
    if (address && address.expiresAt > now && address.count >= 3)
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(
          (Math.max(address.expiresAt, cooldown?.expiresAt ?? now) - now) / 1000,
        ),
      };
    if (cooldown && cooldown.expiresAt > now)
      return { allowed: false, retryAfterSeconds: Math.ceil((cooldown.expiresAt - now) / 1000) };
    this.rateLimits.set(addressKey, {
      count: address && address.expiresAt > now ? address.count + 1 : 1,
      expiresAt: address && address.expiresAt > now ? address.expiresAt : now + 15 * 60_000,
    });
    this.rateLimits.set(cooldownKey, { count: 1, expiresAt: now + 60_000 });
    return { allowed: true, retryAfterSeconds: 60 };
  }

  async delete(sessionId: string) {
    this.states.delete(sessionId);
    this.events.delete(sessionId);
  }

  async consumeIdempotentRateLimit(key: string, intent: string, maximum: number, windowMs: number) {
    const now = Date.now();
    if (this.idempotentLimits.size > 10_000) {
      for (const [candidate, bucket] of this.idempotentLimits)
        if (bucket.expiresAt <= now) this.idempotentLimits.delete(candidate);
    }
    let bucket = this.idempotentLimits.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      bucket = { intents: new Set(), expiresAt: now + windowMs };
      this.idempotentLimits.set(key, bucket);
    }
    if (bucket.intents.has(intent)) return true;
    if (bucket.intents.size >= maximum) return false;
    bucket.intents.add(intent);
    return true;
  }

  async close() {
    this.codeReservations.clear();
    this.leases.clear();
    this.rateLimits.clear();
    this.idempotentLimits.clear();
  }
}

export class RedisSessionCache implements SessionCache {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }

  async connect() {
    await this.redis.connect();
  }

  async get(sessionId: string) {
    const value = await this.redis.get(`openround:session:${sessionId}`);
    return value ? (JSON.parse(value) as GameState) : null;
  }

  async set(state: GameState, ttlSeconds: number) {
    await this.redis.set(
      `openround:session:${state.sessionId}`,
      JSON.stringify(state),
      "EX",
      ttlSeconds,
    );
  }

  async appendEvent(sessionId: string, seq: number, type: string, payload: unknown) {
    await this.appendEvents(sessionId, [{ seq, type, payload }]);
  }

  async appendEvents(
    sessionId: string,
    events: Array<{ seq: number; type: string; payload: unknown }>,
  ) {
    if (events.length === 0) return;
    const key = `openround:events:${sessionId}`;
    const pipeline = this.redis.pipeline();
    for (const { seq, type, payload } of events) {
      pipeline.xadd(
        key,
        "MAXLEN",
        "~",
        "1000",
        "*",
        "seq",
        String(seq),
        "type",
        type,
        "payload",
        JSON.stringify(payload),
        "serverTime",
        new Date().toISOString(),
      );
    }
    pipeline.expire(key, 86_400);
    const results = await pipeline.exec();
    const failure = results?.find(([error]) => error);
    if (!results || failure?.[0]) throw failure?.[0] ?? new Error("Redis event pipeline failed");
  }

  async readEvents(sessionId: string, afterSeq: number, limit = 100) {
    const entries = await this.redis.xrange(
      `openround:events:${sessionId}`,
      "-",
      "+",
      "COUNT",
      1_000,
    );
    return entries
      .map(([, fields]) => {
        const values = new Map<string, string>();
        for (let index = 0; index < fields.length; index += 2) {
          values.set(fields[index]!, fields[index + 1]!);
        }
        const seq = Number(values.get("seq"));
        if (!Number.isSafeInteger(seq)) return null;
        const payload: unknown = (() => {
          try {
            return JSON.parse(values.get("payload") ?? "null") as unknown;
          } catch {
            return null;
          }
        })();
        return {
          seq,
          type: values.get("type") ?? "session.snapshot",
          payload,
          serverTime: values.get("serverTime") ?? new Date().toISOString(),
        } satisfies CachedSessionEvent;
      })
      .filter((event): event is CachedSessionEvent => event !== null && event.seq > afterSeq)
      .sort((left, right) => left.seq - right.seq)
      .slice(0, limit);
  }

  async reserveSessionCode(code: string, owner: string, ttlMs: number) {
    return (await this.redis.set(`openround:code:${code}`, owner, "PX", ttlMs, "NX")) === "OK";
  }

  async releaseSessionCode(code: string, owner: string) {
    await this.redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then
         return redis.call('del', KEYS[1])
       end
       return 0`,
      1,
      `openround:code:${code}`,
      owner,
    );
  }

  async acquireMutationLease(sessionId: string, owner: string, ttlMs: number) {
    return (
      (await this.redis.set(`openround:mutation:${sessionId}`, owner, "PX", ttlMs, "NX")) === "OK"
    );
  }

  async renewMutationLease(sessionId: string, owner: string, ttlMs: number) {
    const renewed = await this.redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then
         return redis.call('pexpire', KEYS[1], ARGV[2])
       end
       return 0`,
      1,
      `openround:mutation:${sessionId}`,
      owner,
      String(ttlMs),
    );
    return Number(renewed) === 1;
  }

  async releaseMutationLease(sessionId: string, owner: string) {
    await this.redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then
         return redis.call('del', KEYS[1])
       end
       return 0`,
      1,
      `openround:mutation:${sessionId}`,
      owner,
    );
  }

  async consumeRateLimit(key: string, maximum: number, windowMs: number) {
    return (await this.consumeRateLimitBudget(key, maximum, windowMs)).allowed;
  }

  async consumeRateLimitBudget(
    key: string,
    maximum: number,
    windowMs: number,
  ): Promise<RateLimitBudget> {
    const result = (await this.redis.eval(
      `local count = redis.call('incr', KEYS[1])
       if count == 1 then
         redis.call('pexpire', KEYS[1], ARGV[1])
       end
       if count <= tonumber(ARGV[2]) then return {1, 0} end
       return {0, math.max(1, math.ceil(redis.call('pttl', KEYS[1]) / 1000))}`,
      1,
      `openround:rate-limit:${key}`,
      String(windowMs),
      String(maximum),
    )) as [number, number];
    return { allowed: Number(result[0]) === 1, retryAfterSeconds: Number(result[1]) };
  }

  async consumeEmailAuthBudget(key: string): Promise<EmailAuthBudget> {
    const result = (await this.redis.eval(
      `local count = tonumber(redis.call('get', KEYS[1]) or '0')
       local addressTtl = redis.call('pttl', KEYS[1])
       local cooldownTtl = redis.call('pttl', KEYS[2])
       if count >= 3 and addressTtl > 0 then
         return {0, math.ceil(math.max(addressTtl, cooldownTtl) / 1000)}
       end
       if cooldownTtl > 0 then return {0, math.ceil(cooldownTtl / 1000)} end
       if addressTtl <= 0 then
         redis.call('set', KEYS[1], '1', 'PX', 900000)
       else
         redis.call('incr', KEYS[1])
       end
       redis.call('set', KEYS[2], '1', 'PX', 60000)
       return {1, 60}`,
      2,
      `openround:rate-limit:email-auth:v2:${key}:address`,
      `openround:rate-limit:email-auth:v2:${key}:cooldown`,
    )) as [number, number];
    return { allowed: Number(result[0]) === 1, retryAfterSeconds: Number(result[1]) };
  }

  async delete(sessionId: string) {
    await this.redis.del(`openround:session:${sessionId}`, `openround:events:${sessionId}`);
  }

  async consumeIdempotentRateLimit(key: string, intent: string, maximum: number, windowMs: number) {
    const result = await this.redis.eval(
      `if redis.call('hexists', KEYS[1], ARGV[1]) == 1 then return 1 end
       local count = tonumber(redis.call('hget', KEYS[1], '__count') or '0')
       if count >= tonumber(ARGV[2]) then return 0 end
       redis.call('hset', KEYS[1], ARGV[1], '1')
       redis.call('hincrby', KEYS[1], '__count', 1)
       if count == 0 then redis.call('pexpire', KEYS[1], ARGV[3]) end
       return 1`,
      1,
      `openround:idempotent-rate-limit:${key}`,
      `intent:${intent}`,
      String(maximum),
      String(windowMs),
    );
    return Number(result) === 1;
  }

  async close() {
    await this.redis.quit();
  }
}
