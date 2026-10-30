import Redis from "ioredis";
import type { GameState } from "@openround/game-engine";
import {
  CanvasPresenterRecordSchema,
  CANVAS_PRESENTER_TTL_MS,
  type CanvasPresenterRecord,
} from "./canvas-presenter-state.js";

function sameCanvasPresenter(
  current: CanvasPresenterRecord | null,
  expected: CanvasPresenterRecord | null,
) {
  return current === null || expected === null
    ? current === expected
    : current.sessionId === expected.sessionId &&
        current.revision === expected.revision &&
        current.userId === expected.userId &&
        current.operationId === expected.operationId;
}

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

/** Ephemeral named presence is separate from durable board content and audience identities. */
export interface CanvasPresenceRecord {
  userId: string;
  name: string;
  cursor: { x: number; y: number } | null;
  expiresAt: number;
}

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
  setCanvasPresence?(boardId: string, presence: CanvasPresenceRecord): Promise<void>;
  listCanvasPresence?(boardId: string): Promise<CanvasPresenceRecord[]>;
  removeCanvasPresence?(boardId: string, userId: string): Promise<void>;
  clearCanvasPresence?(boardId: string): Promise<void>;
  getCanvasPresenter?(boardId: string): Promise<CanvasPresenterRecord | null>;
  setCanvasPresenter?(
    boardId: string,
    record: CanvasPresenterRecord,
    expected: CanvasPresenterRecord | null,
  ): Promise<boolean>;
  clearCanvasPresenter?(boardId: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

export class MemorySessionCache implements SessionCache {
  private readonly canvasPresenters = new Map<string, CanvasPresenterRecord>();
  private presenterTimer: ReturnType<typeof setInterval> | undefined;
  private readonly canvasPresence = new Map<string, Map<string, CanvasPresenceRecord>>();
  private presenceTimer: ReturnType<typeof setInterval> | undefined;
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

  async setCanvasPresence(boardId: string, presence: CanvasPresenceRecord) {
    if (!this.presenceTimer) {
      this.presenceTimer = setInterval(() => {
        for (const [id, entries] of this.canvasPresence) {
          for (const [userId, entry] of entries)
            if (entry.expiresAt <= Date.now()) entries.delete(userId);
          if (!entries.size) this.canvasPresence.delete(id);
        }
      }, 1_000);
      this.presenceTimer.unref();
    }
    if (!this.canvasPresence.has(boardId) && this.canvasPresence.size >= 1_000) {
      for (const [id, entries] of this.canvasPresence) {
        for (const [userId, entry] of entries)
          if (entry.expiresAt <= Date.now()) entries.delete(userId);
        if (!entries.size) this.canvasPresence.delete(id);
      }
      if (this.canvasPresence.size >= 1_000) return;
    }
    const members = this.canvasPresence.get(boardId) ?? new Map<string, CanvasPresenceRecord>();
    if (!members.has(presence.userId) && members.size >= 100) {
      for (const [id, entry] of members) if (entry.expiresAt <= Date.now()) members.delete(id);
      if (members.size >= 100) return;
    }
    members.set(presence.userId, structuredClone(presence));
    this.canvasPresence.set(boardId, members);
  }

  async listCanvasPresence(boardId: string) {
    const members = this.canvasPresence.get(boardId);
    if (!members) return [];
    for (const [id, presence] of members) {
      if (presence.expiresAt <= Date.now()) members.delete(id);
    }
    if (!members.size) this.canvasPresence.delete(boardId);
    return [...members.values()].map((presence) => structuredClone(presence));
  }

  async removeCanvasPresence(boardId: string, userId: string) {
    const members = this.canvasPresence.get(boardId);
    members?.delete(userId);
    if (!members?.size) this.canvasPresence.delete(boardId);
  }

  async clearCanvasPresence(boardId: string) {
    this.canvasPresence.delete(boardId);
  }

  async getCanvasPresenter(boardId: string) {
    const record = this.canvasPresenters.get(boardId);
    if (!record || record.expiresAt <= Date.now()) {
      this.canvasPresenters.delete(boardId);
      return null;
    }
    return structuredClone(record);
  }

  async setCanvasPresenter(
    boardId: string,
    value: CanvasPresenterRecord,
    expected: CanvasPresenterRecord | null,
  ) {
    const record = CanvasPresenterRecordSchema.parse(value);
    record.expiresAt = Math.min(record.expiresAt, Date.now() + CANVAS_PRESENTER_TTL_MS);
    const stored = this.canvasPresenters.get(boardId);
    const current = stored && stored.expiresAt > Date.now() ? stored : null;
    if (!sameCanvasPresenter(current, expected)) return false;
    if (!this.presenterTimer) {
      this.presenterTimer = setInterval(() => {
        for (const [id, entry] of this.canvasPresenters)
          if (entry.expiresAt <= Date.now()) this.canvasPresenters.delete(id);
      }, 1_000);
      this.presenterTimer.unref();
    }
    if (!this.canvasPresenters.has(boardId) && this.canvasPresenters.size >= 1_000) {
      for (const [id, entry] of this.canvasPresenters)
        if (entry.expiresAt <= Date.now()) this.canvasPresenters.delete(id);
      if (this.canvasPresenters.size >= 1_000) throw new Error("Presentation capacity reached");
    }
    this.canvasPresenters.set(boardId, structuredClone(record));
    return true;
  }

  async clearCanvasPresenter(boardId: string) {
    this.canvasPresenters.delete(boardId);
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
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    if (this.presenterTimer) clearInterval(this.presenterTimer);
    this.canvasPresenters.clear();
    this.canvasPresence.clear();
    this.codeReservations.clear();
    this.leases.clear();
    this.rateLimits.clear();
    this.idempotentLimits.clear();
  }
}

export class RedisSessionCache implements SessionCache {
  private readonly redis: Redis;

  async getCanvasPresenter(boardId: string) {
    const key = `openround:canvas-presenter:${boardId}`;
    const serialized = await this.redis.get(key);
    if (!serialized) return null;
    try {
      const parsed = CanvasPresenterRecordSchema.safeParse(JSON.parse(serialized));
      if (parsed.success && parsed.data.expiresAt > Date.now()) return parsed.data;
    } catch {
      // Corrupt ephemeral data never becomes an authorization or presentation decision.
    }
    return null;
  }

  async setCanvasPresenter(
    boardId: string,
    record: CanvasPresenterRecord,
    expected: CanvasPresenterRecord | null,
  ) {
    CanvasPresenterRecordSchema.parse(record);
    const accepted = await this.redis.eval(
      `local raw = redis.call('GET', KEYS[1])
       local current = nil
       if raw then
         local ok, decoded = pcall(cjson.decode, raw)
         if ok and type(decoded) == 'table' and (tonumber(decoded.expiresAt) or 0) > tonumber(ARGV[4]) then current = decoded end
       end
       if ARGV[1] == '' then
         if current then return 0 end
       else
         local expected = cjson.decode(ARGV[1])
         if not current or current.sessionId ~= expected.sessionId or current.revision ~= expected.revision
           or current.userId ~= expected.userId or current.operationId ~= expected.operationId then return 0 end
       end
       redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
       return 1`,
      1,
      `openround:canvas-presenter:${boardId}`,
      expected ? JSON.stringify(expected) : "",
      JSON.stringify(record),
      Math.max(1, Math.min(CANVAS_PRESENTER_TTL_MS, record.expiresAt - Date.now())),
      Date.now(),
    );
    return accepted === 1;
  }

  async clearCanvasPresenter(boardId: string) {
    await this.redis.del(`openround:canvas-presenter:${boardId}`);
  }

  constructor(url: string) {
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }

  async connect() {
    await this.redis.connect();
  }

  async setCanvasPresence(boardId: string, presence: CanvasPresenceRecord) {
    const key = `openround:canvas-presence:${boardId}`;
    const results = await this.redis
      .multi()
      .set(
        `${key}:${presence.userId}`,
        JSON.stringify(presence),
        "PX",
        Math.max(1, Math.min(10_000, presence.expiresAt - Date.now())),
      )
      .zadd(key, presence.expiresAt, presence.userId)
      .pexpire(key, 30_000)
      .exec();
    const failure = results?.find(([error]) => error);
    if (!results || failure?.[0]) throw failure?.[0] ?? new Error("Presence write failed");
  }

  async listCanvasPresence(boardId: string) {
    const key = `openround:canvas-presence:${boardId}`;
    const now = Date.now();
    const [users] = await Promise.all([
      this.redis.zrangebyscore(key, now + 1, "+inf", "LIMIT", 0, 100),
      this.redis.zremrangebyscore(key, "-inf", now),
    ]);
    if (!users.length) return [];
    const records = await this.redis.mget(...users.map((userId) => `${key}:${userId}`));
    const live: CanvasPresenceRecord[] = [];
    for (const [index, serialized] of records.entries()) {
      if (!serialized) continue;
      try {
        const presence = JSON.parse(serialized) as CanvasPresenceRecord;
        if (presence.userId === users[index] && presence.expiresAt > Date.now())
          live.push(presence);
      } catch {
        /* An invalid ephemeral record is ignored, never returned to clients. */
      }
    }
    return live;
  }

  async removeCanvasPresence(boardId: string, userId: string) {
    const key = `openround:canvas-presence:${boardId}`;
    await this.redis.multi().del(`${key}:${userId}`).zrem(key, userId).exec();
  }

  async clearCanvasPresence(boardId: string) {
    const key = `openround:canvas-presence:${boardId}`;
    const users = await this.redis.zrange(key, "0", "-1");
    await this.redis.del(key, ...users.map((userId) => `${key}:${userId}`));
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
