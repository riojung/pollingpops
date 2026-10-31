import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  CanvasCollaborationProfiler,
  parseCanvasProfileConfig,
} from "../load/canvas-collaboration-profile.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function profiler(maxSamples = 20000) {
  return new CanvasCollaborationProfiler({ enabled: true, maxSamples });
}
const result = (rowCount = 1) => ({ rowCount, rows: [{ body: "private result body" }] });

describe("opt-in Canvas repository profiling", () => {
  it("is disabled by default and does not replace methods or invoke the profiling clock", () => {
    expect(parseCanvasProfileConfig({})).toEqual({ enabled: false, maxSamples: 20000 });
    const profile = new CanvasCollaborationProfiler(parseCanvasProfileConfig({}), () => {
      throw new Error("Disabled profiling must not read its clock");
    });
    const pool = { connect: () => Promise.resolve({ query: () => Promise.resolve(result()) }) };
    const repository = { get: () => Promise.resolve(result()) };
    const connect = pool.connect,
      get = repository.get;
    profile.wrapPool(pool, 0);
    profile.wrapRepository(repository, 0);
    profile.start();
    profile.stop();
    profile.restore();
    expect(pool.connect).toBe(connect);
    expect(repository.get).toBe(get);
    expect(profile.report()).toMatchObject({ enabled: false, samples: [] });
    for (const env of [
      { CANVAS_COLLAB_PROFILE: "yes" },
      { CANVAS_COLLAB_PROFILE_MAX_SAMPLES: "0" },
      { CANVAS_COLLAB_PROFILE_MAX_SAMPLES: "100001" },
      { CANVAS_COLLAB_PROFILE_MAX_SAMPLES: "NaN" },
      { CANVAS_COLLAB_PROFILE_MAX_SAMPLES: "" },
    ])
      expect(() => parseCanvasProfileConfig(env)).toThrow();
  });

  it("attributes overlapping methods and node pools independently without changing Promise identity or inputs", async () => {
    const profile = profiler();
    const first = deferred<ReturnType<typeof result>>(),
      second = deferred<ReturnType<typeof result>>();
    const queryStarted = deferred<void>();
    let started = 0;
    const makePool = (pending: typeof first) => {
      const client = {
        query(this: unknown, text: string, values: unknown[]) {
          expect(this).toBe(client);
          expect(text).toContain("private SQL text");
          expect(values).toBe(input);
          if (++started === 2) queryStarted.resolve();
          return pending.promise;
        },
      };
      const pool = {
        totalCount: 4,
        idleCount: 1,
        waitingCount: 3,
        connect(this: unknown) {
          expect(this).toBe(pool);
          return Promise.resolve(client);
        },
      };
      return pool;
    };
    const input = [{ userId: "private principal", token: "private credential" }];
    const left = makePool(first),
      right = makePool(second);
    let originalPromise!: Promise<ReturnType<typeof result>>;
    const repository = {
      command(this: unknown, args: unknown[]) {
        expect(this).toBe(repository);
        expect(args).toBe(input);
        originalPromise = left
          .connect()
          .then((client) =>
            client.query("SELECT data FROM canvas_board_objects /* private SQL text */", input),
          );
        return originalPromise;
      },
    };
    profile.wrapPool(left, 0);
    profile.wrapPool(right, 1);
    profile.wrapRepository(repository, 0);
    // A separate instance is how the real harness represents the second serving node.
    const peer = {
      get() {
        return right
          .connect()
          .then((client) =>
            client.query("SELECT data FROM canvas_board_versions /* private SQL text */", input),
          );
      },
    };
    profile.wrapRepository(peer, 1);
    profile.start();
    const command = repository.command(input),
      get = peer.get();
    expect(command).toBe(originalPromise);
    await queryStarted.promise;
    second.resolve(result(7));
    await get;
    first.resolve(result(2));
    await command;
    profile.stop();
    const report = profile.report();
    expect(report.observed).toEqual({ operation: 2, query: 2, pool: 2 });
    expect(report.inFlightAtStop).toEqual({ operation: 0, query: 0, pool: 0 });
    expect(report.samples.filter((sample) => sample.kind === "query")).toEqual([
      expect.objectContaining({ node: 1, method: "get", category: "versions", rows: 7 }),
      expect.objectContaining({ node: 0, method: "command", category: "objects", rows: 2 }),
    ]);
    for (const query of report.samples.filter((sample) => sample.kind === "query"))
      expect(report.samples).toContainEqual(
        expect.objectContaining({
          kind: "operation",
          operation: query.operation,
          method: query.method,
          node: query.node,
          queryCount: 1,
        }),
      );
    expect(report.sampledPoolHighWater).toEqual({ total: 4, idle: 1, waiting: 3 });
    for (const secret of [
      "private SQL text",
      "private principal",
      "private credential",
      "private result body",
    ])
      expect(JSON.stringify(report)).not.toContain(secret);
    profile.restore();
  });

  it("preserves query/connect callback arguments, this, return values and async attribution", async () => {
    const profile = profiler();
    const connectReturn = Symbol("connect return"),
      queryReturn = Symbol("query return"),
      connectThis = {},
      queryThis = {},
      release = () => {};
    let completeConnect!: () => void;
    const client = {
      query(_config: object, callback: (this: unknown, error: null, value: object) => void) {
        queueMicrotask(() => callback.call(queryThis, null, result(3)));
        return queryReturn;
      },
    };
    const pool = {
      connect(
        callback: (this: unknown, error: null, value: typeof client, done: typeof release) => void,
      ) {
        completeConnect = () => callback.call(connectThis, null, client, release);
        return connectReturn;
      },
    };
    const config = {
      text: "SELECT data FROM canvas_board_receipts",
      values: ["private parameter"],
    };
    const repository = {
      get() {
        return new Promise<object>((resolve) => {
          expect(
            pool.connect(function (error, value, done) {
              expect(this).toBe(connectThis);
              expect(error).toBeNull();
              expect(value).toBe(client);
              expect(done).toBe(release);
              expect(
                value.query(config, function (queryError, body) {
                  expect(this).toBe(queryThis);
                  expect(queryError).toBeNull();
                  resolve(body);
                }),
              ).toBe(queryReturn);
            }),
          ).toBe(connectReturn);
        });
      },
    };
    const original = { connect: pool.connect, query: client.query, get: repository.get };
    profile.wrapPool(pool, 0);
    profile.wrapRepository(repository, 0);
    profile.start();
    const pending = repository.get();
    // Complete acquisition outside the repository's original async call stack.
    completeConnect();
    expect(await pending).toEqual(result(3));
    profile.stop();
    expect(profile.report().samples).toContainEqual(
      expect.objectContaining({ kind: "query", method: "get", category: "receipts", rows: 3 }),
    );
    expect(JSON.stringify(profile.report())).not.toContain("private parameter");
    profile.restore();
    expect(pool.connect).toBe(original.connect);
    expect(client.query).toBe(original.query);
    expect(repository.get).toBe(original.get);
  });

  it("preserves rejected Promises, synchronous throws and callback errors without retaining error text", async () => {
    const profile = profiler();
    const failure = new Error("private database error with credentials");
    let mode: "promise" | "throw" | "callback" = "promise";
    let originalPromise!: Promise<never>;
    const client = {
      query(...args: unknown[]) {
        if (mode === "throw") throw failure;
        if (mode === "callback") {
          const callback = args.at(-1) as (error: Error) => void;
          queueMicrotask(() => callback(failure));
          return undefined;
        }
        originalPromise = Promise.reject(failure);
        return originalPromise;
      },
    };
    const pool = { connect: () => Promise.resolve(client) };
    const repository = {
      async command() {
        const acquired = await pool.connect();
        const query = acquired.query("SELECT private FROM users", ["private token"]);
        if (mode === "promise") expect(query).toBe(originalPromise);
        return query;
      },
      async get() {
        const acquired = await pool.connect();
        return new Promise((resolve, reject) => {
          acquired.query("SELECT private FROM users", (error: Error) =>
            error ? reject(error) : resolve(null),
          );
        });
      },
    };
    profile.wrapPool(pool, 0);
    profile.wrapRepository(repository, 0);
    profile.start();
    await expect(repository.command()).rejects.toBe(failure);
    mode = "throw";
    await expect(repository.command()).rejects.toBe(failure);
    mode = "callback";
    await expect(repository.get()).rejects.toBe(failure);
    profile.stop();
    const report = profile.report();
    expect(report.samples.filter((sample) => sample.kind === "query")).toHaveLength(3);
    expect(report.samples.filter((sample) => sample.kind === "operation")).toHaveLength(3);
    expect(
      report.samples.filter((sample) => sample.kind !== "pool").every((sample) => !sample.ok),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain(failure.message);
    profile.restore();
  });

  it("excludes setup/warm-up even when it resumes inside the window and discloses censored/truncated samples", async () => {
    const profile = profiler(2);
    const warmup = deferred<void>(),
      lateQuery = deferred<ReturnType<typeof result>>(),
      lateStarted = deferred<void>();
    let late = false;
    const client = {
      query() {
        if (late) {
          lateStarted.resolve();
          return lateQuery.promise;
        }
        return Promise.resolve(result());
      },
    };
    const pool = { connect: () => Promise.resolve(client) };
    const repository = {
      async get(wait?: Promise<void>) {
        if (wait) await wait;
        const acquired = await pool.connect();
        return acquired.query();
      },
    };
    profile.wrapPool(pool, 0);
    profile.wrapRepository(repository, 0);
    const beforeWindow = repository.get(warmup.promise);
    profile.start();
    warmup.resolve();
    await beforeWindow;
    expect(profile.report().observed).toEqual({ operation: 0, query: 0, pool: 0 });
    await repository.get();
    late = true;
    const censored = repository.get();
    await lateStarted.promise;
    profile.stop();
    const report = profile.report();
    expect(report.samples).toHaveLength(2);
    expect(report.observed).toEqual({ operation: 1, query: 1, pool: 2 });
    expect(report.dropped).toEqual({ operation: 1, query: 0, pool: 1 });
    expect(report.inFlightAtStop).toEqual({ operation: 1, query: 1, pool: 0 });
    lateQuery.resolve(result());
    await censored;
    await repository.get();
    expect(profile.report()).toEqual(report);
    expect(() => profile.start()).toThrow("one measured window");
    profile.restore();
  });

  it("preserves pool acquisition failures in Promise, callback and synchronous forms", async () => {
    const profile = profiler();
    const failure = new Error("private pool credentials");
    let mode: "promise" | "callback" | "throw" = "promise";
    let originalPromise!: Promise<never>;
    const pool = {
      connect(callback?: (error: Error) => void) {
        if (mode === "throw") throw failure;
        if (callback) {
          queueMicrotask(() => callback(failure));
          return undefined;
        }
        originalPromise = Promise.reject(failure);
        return originalPromise;
      },
    };
    const repository = {
      command() {
        const pending = pool.connect();
        if (mode === "promise") expect(pending).toBe(originalPromise);
        return pending;
      },
      get() {
        return new Promise((resolve, reject) => {
          pool.connect((error) => (error ? reject(error) : resolve(null)));
        });
      },
    };
    profile.wrapPool(pool, 0);
    profile.wrapRepository(repository, 0);
    profile.start();
    await expect(repository.command()).rejects.toBe(failure);
    mode = "callback";
    await expect(repository.get()).rejects.toBe(failure);
    mode = "throw";
    expect(() => repository.command()).toThrow(failure);
    profile.stop();
    const report = profile.report();
    expect(report.observed).toEqual({ operation: 3, query: 0, pool: 3 });
    expect(report.inFlightAtStop).toEqual({ operation: 0, query: 0, pool: 0 });
    expect(report.samples.every((sample) => !sample.ok)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(failure.message);
    profile.restore();
  });

  it("leaves evented query objects untouched and does not read result rows or private metadata", async () => {
    const profile = profiler();
    const evented = new EventEmitter();
    const body = Object.defineProperty({ rowCount: 5 }, "rows", {
      get() {
        throw new Error("Profiling must not inspect row contents");
      },
    });
    let asEvent = false;
    const client = { query: () => (asEvent ? evented : Promise.resolve(body)) };
    const pool = { connect: () => Promise.resolve(client) };
    const repository = {
      async authorize() {
        const acquired = await pool.connect();
        return acquired.query();
      },
    };
    profile.wrapPool(pool, 1);
    profile.wrapRepository(repository, 1);
    profile.start();
    expect(await repository.authorize()).toBe(body);
    asEvent = true;
    expect(await repository.authorize()).toBe(evented);
    expect(evented.listenerCount("error")).toBe(0);
    profile.stop();
    expect(profile.report()).toMatchObject({ unsupportedQueryReturns: 1 });
    expect(profile.report().samples).toContainEqual(
      expect.objectContaining({ kind: "query", rows: 5, category: "other" }),
    );
    profile.restore();
  });
});
