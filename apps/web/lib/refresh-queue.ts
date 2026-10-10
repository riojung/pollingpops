/** One active read and, when requested, one trailing read per credential context. */
export function createInFlightRefreshCoalescer<T>() {
  type TrailingRefresh = {
    promise: Promise<T>;
    refresh: () => Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
  type Entry = { active: Promise<T> | null; trailing: TrailingRefresh | null };
  const entries = new Map<string, Entry>();

  const launch = (key: string, entry: Entry, refresh: () => Promise<T>) => {
    let promise: Promise<T>;
    try {
      promise = refresh();
    } catch (error) {
      promise = Promise.reject(error);
    }
    entry.active = promise;
    const finish = () => {
      if (entry.active !== promise) return;
      entry.active = null;
      const trailing = entry.trailing;
      if (!trailing) {
        entries.delete(key);
        return;
      }
      entry.trailing = null;
      const trailingPromise = launch(key, entry, trailing.refresh);
      void trailingPromise.then(trailing.resolve, trailing.reject);
    };
    void promise.then(finish, finish);
    return promise;
  };

  return {
    run(key: string, refresh: () => Promise<T>, forceTrailing = false) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { active: null, trailing: null };
        entries.set(key, entry);
      }
      if (!entry.active) return launch(key, entry, refresh);
      if (!forceTrailing) return entry.active;
      if (entry.trailing) {
        entry.trailing.refresh = refresh;
        return entry.trailing.promise;
      }
      let resolve!: TrailingRefresh["resolve"];
      let reject!: TrailingRefresh["reject"];
      const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      entry.trailing = { promise, refresh, resolve, reject };
      return promise;
    },
    isActive(key: string) {
      return Boolean(entries.get(key)?.active);
    },
  };
}

/** Cancellable retries: 1, 2, 4, 8, 16, then at most one every 30 seconds. */
export function createReadRetryScheduler() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  const clearPending = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    clearPending,
    reset() {
      clearPending();
      failures = 0;
    },
    schedule(retry: () => void) {
      clearPending();
      const delay = Math.min(1_000 * 2 ** failures, 30_000);
      failures = Math.min(failures + 1, 5);
      timer = setTimeout(() => {
        timer = null;
        retry();
      }, delay);
    },
  };
}
