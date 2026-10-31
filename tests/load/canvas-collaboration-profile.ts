import { AsyncLocalStorage } from "node:async_hooks";

const methods = [
  "command",
  "get",
  "authorize",
  "getFacilitation",
  "facilitate",
  "getVersion",
  "authorizeVersionMedia",
  "authorizeMedia",
  "getGuest",
  "authorizeGuest",
  "getGuestFacilitation",
  "listOutbox",
] as const;
type Method = (typeof methods)[number];
type Node = 0 | 1;
type Kind = "operation" | "query" | "pool";
type Category =
  | "transaction"
  | "commit"
  | "context"
  | "identityLock"
  | "outboxLock"
  | "advisoryLock"
  | "workspaceLock"
  | "boardLock"
  | "objects"
  | "grants"
  | "invitations"
  | "receipts"
  | "comments"
  | "timer"
  | "versions"
  | "media"
  | "source"
  | "platform"
  | "metadata"
  | "other";
export interface CanvasProfileConfig {
  enabled: boolean;
  maxSamples: number;
}
export function parseCanvasProfileConfig(env: Record<string, string | undefined>) {
  const enabled = env.CANVAS_COLLAB_PROFILE ?? "false";
  const maximum = env.CANVAS_COLLAB_PROFILE_MAX_SAMPLES ?? "20000";
  if (!["true", "false"].includes(enabled))
    throw new Error("CANVAS_COLLAB_PROFILE must be true or false");
  const maxSamples = Number(maximum);
  if (!maximum.trim() || !Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 100000)
    throw new Error("CANVAS_COLLAB_PROFILE_MAX_SAMPLES must be 1–100000");
  return { enabled: enabled === "true", maxSamples };
}
interface Pressure {
  total: number;
  idle: number;
  waiting: number;
}
interface Sample {
  kind: Kind;
  node: Node;
  method: Method;
  operation: number;
  parent: number | null;
  ms: number;
  ok: boolean;
  category?: Category;
  rows?: number | null;
  queryCount?: number;
  queryMs?: number;
  poolWaitMs?: number;
  pressureBefore?: Pressure;
  pressureAfter?: Pressure;
}
interface Window {
  open: boolean;
  started: number;
  durationMs: number | null;
  nextOperation: number;
  samples: Sample[];
  observed: Record<Kind, number>;
  dropped: Record<Kind, number>;
  inFlight: Record<Kind, number>;
  unsupportedQueryReturns: number;
  pressure: Pressure;
}
interface Context {
  window: Window | undefined;
  node: Node;
  method: Method;
  operation: number;
  parent: number | null;
  queryCount: number;
  queryMs: number;
  poolWaitMs: number;
}
const counts = (): Record<Kind, number> => ({ operation: 0, query: 0, pool: 0 });
const pressure = (): Pressure => ({ total: 0, idle: 0, waiting: 0 });
function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function poolPressure(pool: object): Pressure {
  const value = pool as { totalCount?: number; idleCount?: number; waitingCount?: number };
  return {
    total: numeric(value.totalCount),
    idle: numeric(value.idleCount),
    waiting: numeric(value.waitingCount),
  };
}
const tableCategories = (
  [
    ["canvas_board_objects", "objects"],
    ["canvas_board_grants", "grants"],
    ["canvas_board_invitations", "invitations"],
    ["canvas_board_receipts", "receipts"],
    ["canvas_board_comment_threads", "comments"],
    ["canvas_board_comment_messages", "comments"],
    ["canvas_board_timers", "timer"],
    ["canvas_board_versions", "versions"],
    ["media_assets", "media"],
    ["media_references", "media"],
    ["idea_boards", "source"],
    ["platform_records", "platform"],
    ["organization_members", "platform"],
    ["organizations", "platform"],
    ["workspace_members", "platform"],
    ["users", "platform"],
    ["workspaces", "platform"],
    ["canvas_boards", "metadata"],
  ] as const
).map(([table, name]) => [new RegExp(`\\b${table}\\b`, "i"), name] as const);
/** Text is inspected only to choose a fixed category. It is never retained or emitted. */
function category(input: unknown): Category {
  const text =
    typeof input === "string"
      ? input
      : input && typeof input === "object" && "text" in input && typeof input.text === "string"
        ? input.text
        : "";
  if (/^\s*COMMIT\b/i.test(text)) return "commit";
  if (/^\s*(?:BEGIN|ROLLBACK)\b/i.test(text)) return "transaction";
  if (/set_config\(/i.test(text)) return "context";
  if (/pg_advisory.*'identity'/i.test(text)) return "identityLock";
  if (/pg_advisory.*'canvas-outbox'/i.test(text)) return "outboxLock";
  if (/pg_advisory/i.test(text)) return "advisoryLock";
  if (/\bworkspaces\b.*FOR (?:SHARE|UPDATE)/i.test(text)) return "workspaceLock";
  if (/\bcanvas_boards\b.*FOR (?:SHARE|UPDATE)/i.test(text)) return "boardLock";
  for (const [pattern, name] of tableCategories) if (pattern.test(text)) return name;
  return "other";
}
function rows(value: unknown): number | null {
  if (Array.isArray(value)) {
    const counts = value.map(rows);
    return counts.every((count) => count === null)
      ? null
      : counts.reduce<number>((total, count) => total + (count ?? 0), 0);
  }
  if (value && typeof value === "object" && "rowCount" in value)
    return typeof value.rowCount === "number" && Number.isFinite(value.rowCount)
      ? Math.max(0, value.rowCount)
      : null;
  return null;
}
function observePromise(value: unknown, success: (result: unknown) => void, failure: () => void) {
  if (value instanceof Promise) {
    // Attach observation without replacing the caller's Promise or swallowing its rejection.
    void value.then(success, failure);
    return true;
  }
  return false;
}
function distribution(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const quantile = (fraction: number) =>
    ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? null;
  return {
    count: ordered.length,
    p50: quantile(0.5),
    p95: quantile(0.95),
    p99: quantile(0.99),
    max: ordered.at(-1) ?? null,
    total: ordered.reduce((sum, value) => sum + value, 0),
  };
}

/** Harness-only observation. Disabled mode does not wrap methods or allocate async contexts. */
export class CanvasCollaborationProfiler {
  private readonly storage = new AsyncLocalStorage<Context | undefined>();
  private readonly restoreMethods: Array<() => void> = [];
  private readonly clients = new WeakSet<object>();
  private window: Window | undefined;
  constructor(
    readonly config: CanvasProfileConfig,
    private readonly now = () => performance.now(),
  ) {
    if (!Number.isInteger(config.maxSamples) || config.maxSamples < 1 || config.maxSamples > 100000)
      throw new Error("Use a profile sample limit of 1–100000");
  }
  start() {
    if (!this.config.enabled) return;
    if (this.window) throw new Error("Profiling permits one measured window per fixture");
    this.window = {
      open: true,
      started: this.now(),
      durationMs: null,
      nextOperation: 1,
      samples: [],
      observed: counts(),
      dropped: counts(),
      inFlight: counts(),
      unsupportedQueryReturns: 0,
      pressure: pressure(),
    };
  }
  stop() {
    if (!this.window?.open) return;
    this.window.durationMs = Math.max(0, this.now() - this.window.started);
    this.window.open = false;
  }
  private replace(
    target: object,
    name: string,
    invoke: (receiver: unknown, args: unknown[]) => unknown,
  ) {
    const wrapper = function (this: unknown, ...args: unknown[]) {
      return invoke(this, args);
    };
    const own = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, {
      value: wrapper,
      configurable: true,
      writable: true,
      enumerable: own?.enumerable ?? false,
    });
    this.restoreMethods.push(() => {
      if (Reflect.get(target, name) !== wrapper) return;
      if (own) Object.defineProperty(target, name, own);
      else Reflect.deleteProperty(target, name);
    });
  }
  private capture(node: Node) {
    const ctx = this.storage.getStore();
    return ctx?.node === node && ctx.window?.open ? ctx : undefined;
  }
  private retain(ctx: Context, sample: Sample) {
    const window = ctx.window;
    if (!window?.open) return;
    window.observed[sample.kind]++;
    if (window.samples.length < this.config.maxSamples) window.samples.push(sample);
    else window.dropped[sample.kind]++;
  }
  private sample(ctx: Context, kind: Kind, started: number, ok: boolean): Sample {
    return {
      kind,
      node: ctx.node,
      method: ctx.method,
      operation: ctx.operation,
      parent: ctx.parent,
      ms: Math.max(0, this.now() - started),
      ok,
    };
  }
  wrapRepository(repository: object, node: Node) {
    if (!this.config.enabled) return;
    for (const method of methods) {
      const original = Reflect.get(repository, method);
      if (typeof original !== "function") continue;
      this.replace(repository, method, (receiver, args) => {
        const parent = this.storage.getStore();
        // An operation started before the window keeps its excluded context across awaits.
        const window = parent ? parent.window : this.window;
        const measured = window?.open ? window : undefined;
        const ctx: Context = {
          window: measured,
          node,
          method,
          operation: measured ? measured.nextOperation++ : 0,
          parent: parent?.operation || null,
          queryCount: 0,
          queryMs: 0,
          poolWaitMs: 0,
        };
        const started = measured ? this.now() : 0;
        if (measured) measured.inFlight.operation++;
        const finish = (ok: boolean) => {
          if (!ctx.window?.open) return;
          ctx.window.inFlight.operation--;
          this.retain(ctx, {
            ...this.sample(ctx, "operation", started, ok),
            queryCount: ctx.queryCount,
            queryMs: ctx.queryMs,
            poolWaitMs: ctx.poolWaitMs,
          });
        };
        return this.storage.run(ctx, () => {
          try {
            const result = Reflect.apply(original, receiver, args);
            if (
              measured &&
              !observePromise(
                result,
                () => finish(true),
                () => finish(false),
              )
            )
              finish(true);
            return result;
          } catch (error) {
            finish(false);
            throw error;
          }
        });
      });
    }
  }
  private wrapClient(client: unknown, node: Node) {
    if (!client || typeof client !== "object" || this.clients.has(client)) return;
    const original = Reflect.get(client, "query");
    if (typeof original !== "function") return;
    this.clients.add(client);
    this.replace(client, "query", (receiver, args) => {
      const ctx = this.capture(node);
      if (!ctx) return Reflect.apply(original, receiver, args);
      const started = this.now();
      const sqlCategory = category(args[0]);
      ctx.window!.inFlight.query++;
      let finished = false;
      const finish = (ok: boolean, result?: unknown) => {
        if (finished || !ctx.window?.open) return;
        finished = true;
        ctx.window.inFlight.query--;
        const sample = this.sample(ctx, "query", started, ok);
        ctx.queryCount++;
        ctx.queryMs += sample.ms;
        this.retain(ctx, { ...sample, category: sqlCategory, rows: rows(result) });
      };
      const callback = args.at(-1);
      const invokeCallback = (callbackThis: unknown, values: unknown[]) => {
        finish(!values[0], values[1]);
        return this.storage.run(ctx, () =>
          Reflect.apply(callback as (...args: unknown[]) => unknown, callbackThis, values),
        );
      };
      const forwarded =
        typeof callback === "function"
          ? [
              ...args.slice(0, -1),
              function (this: unknown, ...values: unknown[]) {
                return invokeCallback(this, values);
              },
            ]
          : args;
      try {
        const result = Reflect.apply(original, receiver, forwarded);
        if (
          typeof callback !== "function" &&
          !observePromise(
            result,
            (value) => finish(true, value),
            () => finish(false),
          )
        ) {
          // Evented Query objects remain untouched: adding an error listener changes semantics.
          ctx.window!.inFlight.query--;
          ctx.window!.unsupportedQueryReturns++;
        }
        return result;
      } catch (error) {
        finish(false);
        throw error;
      }
    });
  }
  wrapPool(pool: object, node: Node) {
    if (!this.config.enabled) return;
    const original = Reflect.get(pool, "connect");
    if (typeof original !== "function") throw new Error("Profile pool needs connect()");
    this.replace(pool, "connect", (receiver, args) => {
      const store = this.storage.getStore();
      const ctx = this.capture(node);
      const started = ctx ? this.now() : 0;
      const before = ctx ? poolPressure(pool) : undefined;
      if (ctx) ctx.window!.inFlight.pool++;
      let finished = false;
      const finish = (ok: boolean, client?: unknown) => {
        this.wrapClient(client, node);
        if (!ctx?.window?.open || finished) return;
        finished = true;
        ctx.window.inFlight.pool--;
        const after = poolPressure(pool);
        for (const key of ["total", "idle", "waiting"] as const)
          ctx.window.pressure[key] = Math.max(ctx.window.pressure[key], before![key], after[key]);
        const sample = this.sample(ctx, "pool", started, ok);
        ctx.poolWaitMs += sample.ms;
        this.retain(ctx, { ...sample, pressureBefore: before, pressureAfter: after });
      };
      const callback = args.at(-1);
      const invokeCallback = (callbackThis: unknown, values: unknown[]) => {
        finish(!values[0], values[1]);
        return this.storage.run(store, () =>
          Reflect.apply(callback as (...args: unknown[]) => unknown, callbackThis, values),
        );
      };
      const forwarded =
        typeof callback === "function"
          ? [
              ...args.slice(0, -1),
              function (this: unknown, ...values: unknown[]) {
                return invokeCallback(this, values);
              },
            ]
          : args;
      try {
        const result = Reflect.apply(original, receiver, forwarded);
        if (typeof callback !== "function")
          observePromise(
            result,
            (client) => finish(true, client),
            () => finish(false),
          );
        return result;
      } catch (error) {
        finish(false);
        throw error;
      }
    });
  }
  report() {
    const window = this.window;
    const samples = window?.samples.map((sample) => ({ ...sample })) ?? [];
    const groups = new Map<string, Sample[]>();
    for (const sample of samples) {
      const key = `${sample.node}:${sample.method}:${sample.kind}:${sample.category ?? "none"}`;
      const group = groups.get(key) ?? [];
      group.push(sample);
      groups.set(key, group);
    }
    return {
      schemaVersion: 1,
      enabled: this.config.enabled,
      window: "measured-concurrent-http-writes-and-peer-paint",
      durationMs: window?.durationMs ?? null,
      complete: Boolean(window && !window.open),
      maxSamples: this.config.maxSamples,
      observed: { ...(window?.observed ?? counts()) },
      dropped: { ...(window?.dropped ?? counts()) },
      inFlightAtStop: { ...(window?.inFlight ?? counts()) },
      unsupportedQueryReturns: window?.unsupportedQueryReturns ?? 0,
      sampledPoolHighWater: { ...(window?.pressure ?? pressure()) },
      samples,
      distributions: [...groups.values()].map((group) => ({
        node: group[0]!.node,
        method: group[0]!.method,
        kind: group[0]!.kind,
        category: group[0]!.category ?? null,
        failures: group.filter((sample) => !sample.ok).length,
        rows: group.reduce((sum, sample) => sum + (sample.rows ?? 0), 0),
        milliseconds: distribution(group.map((sample) => sample.ms)),
      })),
      limitations: [
        "Opt-in observer overhead; compare equally instrumented variants and confirm the end-to-end result with profiling disabled",
        "Only SQL/pool work inside wrapped Canvas repository methods is attributed; HTTP credential/policy work outside those methods is excluded",
        "Client-observed SQL elapsed time includes driver/network/lock waits and is not database CPU or an exact server COMMIT timestamp",
        "Rows are driver rowCount totals, including writes; row contents and byte sizes are never inspected",
        "Samples retain the first maxSamples completions across all kinds; dropped counts disclose truncation and retained quantiles can be biased",
        "Operations that cross the window end are censored; inFlightAtStop counts these incomplete observations",
        "Nested method wall durations overlap; direct SQL belongs to its innermost method and durations must not be added across nested spans",
        "Pool pressure is sampled at acquisition boundaries; reported maxima are across individual node pools, not their sum or a continuous high-water measurement",
      ],
    };
  }
  restore() {
    this.stop();
    for (const restore of this.restoreMethods.splice(0).reverse()) restore();
  }
}
