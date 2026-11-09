import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api";
import type * as Client from "../../lib/presentation-practice-client";
import {
  practiceAnswer,
  practiceAttempt,
  practiceIds as ids,
  practicePreview,
  practiceReader,
  practiceToken,
} from "../../test-utils/presentation-practice";
import { usePracticeReader } from "./use-practice-reader";
interface Hooks {
  cursor: number;
  slots: unknown[];
  dependencies: Map<number, readonly unknown[] | undefined>;
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
  cleanups: Map<number, void | (() => void)>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  preview: vi.fn(),
  access: vi.fn(),
  snapshot: vi.fn(),
  start: vi.fn(),
  progress: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useRef: <T>(initial: T) => {
    const h = mocked.hooks!,
      i = h.cursor++;
    h.slots[i] ??= { current: initial };
    return h.slots[i];
  },
  useState: <T>(initial: T) => {
    const h = mocked.hooks!,
      i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = initial;
    return [
      h.slots[i],
      (next: T | ((value: T) => T)) => {
        h.slots[i] = typeof next === "function" ? (next as (value: T) => T)(h.slots[i] as T) : next;
      },
    ];
  },
  useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
    const h = mocked.hooks!,
      i = h.cursor++,
      previous = h.dependencies.get(i);
    if (!h.dependencies.has(i) || !dependencies || dependencies.some((v, n) => v !== previous?.[n]))
      h.effects.push({ index: i, effect });
    h.dependencies.set(i, dependencies);
  },
}));
vi.mock("../../lib/presentation-practice-client", async (original) => ({
  ...(await original<typeof Client>()),
  fetchPracticePreview: mocked.preview,
  fetchPracticeAccess: mocked.access,
  fetchPracticeAttempt: mocked.snapshot,
  startPracticeAttempt: mocked.start,
  recordPracticeProgress: mocked.progress,
}));
const mounted = new Set<{ close: () => void }>();
function mount() {
  const h: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  const page = {
    render() {
      h.cursor = 0;
      h.effects = [];
      mocked.hooks = h;
      let result: ReturnType<typeof usePracticeReader>;
      try {
        result = usePracticeReader(ids.assignment);
      } finally {
        mocked.hooks = null;
      }
      for (const { index, effect } of h.effects) {
        h.cleanups.get(index)?.();
        h.cleanups.set(index, effect());
      }
      return result;
    },
    close() {
      for (const cleanup of h.cleanups.values()) cleanup?.();
      h.cleanups.clear();
      mounted.delete(page);
    },
  };
  mounted.add(page);
  page.render();
  return page;
}
function setup(personal = false) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-08T12:00:00.000Z"));
  const location = {
    origin: "https://example.test",
    href: `https://example.test/presentation-practice/${ids.assignment}#token=${practiceToken}${personal ? `&attempt=${ids.attempt.toUpperCase()}&resume=${practiceReader.token}` : ""}`,
  };
  const storage = {
    getItem: vi.fn(() => {
      throw new Error("No storage");
    }),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("window", {
    location,
    history: {
      state: null,
      replaceState: (_state: unknown, _unused: string, path: string) => {
        location.href = new URL(path, location.href).href;
      },
    },
    addEventListener: (name: string, listener: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener: (name: string, listener: () => void) =>
      listeners.get(name)?.delete(listener),
  });
  mocked.preview.mockReset().mockResolvedValue(practicePreview());
  mocked.access.mockReset().mockResolvedValue({
    versionId: ids.version,
    expiresAt: practicePreview().assignment.expiresAt,
  });
  mocked.snapshot.mockReset().mockResolvedValue({
    ...practicePreview(),
    attempt: practiceAttempt(1, [ids.first], ids.attempt, [practiceAnswer()]),
  });
  mocked.start.mockReset().mockImplementation(async (_id, _token, request) => ({
    attempt: practiceAttempt(0, [], request.attemptId),
    replayed: false,
  }));
  mocked.progress.mockReset().mockImplementation(async (_id, reader, request) => ({
    attempt: practiceAttempt(
      request.expectedRevision + 1,
      [ids.first],
      reader.attemptId,
      request.kind === "answer" ? [practiceAnswer()] : [],
    ),
    replayed: false,
  }));
  return {
    location,
    storage,
    dispatch: (name: string) => {
      for (const listener of [...(listeners.get(name) ?? [])]) listener();
    },
  };
}
async function settle(page: ReturnType<typeof mount>) {
  await vi.advanceTimersByTimeAsync(0);
  return page.render();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  for (const page of mounted) page.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("private practice recipient acknowledgements", () => {
  it("previews without starting or discovering a reader; scrubs fragments and stores no recipient secrets", async () => {
    const env = setup();
    const page = mount();
    let state = await settle(page);
    expect(state.preview?.review.title).toBe("Private practice");
    expect(state.attempt).toBeNull();
    expect(mocked.start).not.toHaveBeenCalled();
    expect(mocked.snapshot).not.toHaveBeenCalled();
    expect(env.location.href).not.toContain("#");
    await state.start(true);
    state = await settle(page);
    expect(state.attempt?.answers).toEqual([]);
    expect(state.resumeUrl).toContain("#token=");
    for (const fn of Object.values(env.storage)) expect(fn).not.toHaveBeenCalled();
    page.close();
    const reloaded = mount();
    state = await settle(reloaded);
    expect(state.attempt).toBeNull();
    expect(state.preview).toBeNull();
  });
  it("requires explicit resume, retains private accepted feedback, and uses canonical reader IDs", async () => {
    setup(true);
    const page = mount();
    let state = await settle(page);
    expect(state.hasResume).toBe(true);
    expect(state.attempt).toBeNull();
    expect(mocked.snapshot).not.toHaveBeenCalled();
    await state.resume();
    state = await settle(page);
    expect(mocked.snapshot).toHaveBeenCalledWith(
      ids.assignment,
      practiceReader,
      expect.any(AbortSignal),
    );
    expect(state.attempt?.answers[0]?.feedback.explanation).toBe("Accepted personal explanation");
    expect(state.preview).not.toHaveProperty("attempt");
    state.resetReader();
    state = page.render();
    expect(state.attempt).toBeNull();
    expect(state.resumeUrl).toBe("");
    expect(state.hasResume).toBe(false);
  });
  it("preserves a saved unconfirmed start for explicit same-attempt retry only after checking assignment access", async () => {
    setup(true);
    mocked.snapshot.mockRejectedValueOnce(
      new ApiClientError("Not found", "PRESENTATION_PRACTICE_UNAVAILABLE", 404),
    );
    const page = mount();
    let state = await settle(page);
    await state.resume();
    state = await settle(page);
    expect(mocked.access).toHaveBeenCalledTimes(1);
    expect(state.pending).toBe("start");
    expect(state.resumeUrl).toContain(practiceReader.token);
    expect(mocked.start).not.toHaveBeenCalled();
    await state.start(false);
    state = await settle(page);
    expect(mocked.start).toHaveBeenCalledWith(
      ids.assignment,
      practiceToken,
      practiceReader,
      expect.any(AbortSignal),
    );
    expect(state.attempt?.id).toBe(ids.attempt);
  });
  it("fetches current progress after a replayed original start receipt", async () => {
    setup();
    mocked.start.mockImplementation(async (_id, _token, request) => ({
      attempt: practiceAttempt(0, [], request.attemptId),
      replayed: true,
    }));
    mocked.snapshot.mockImplementation(async (_id, reader) => ({
      ...practicePreview(),
      attempt: practiceAttempt(2, [ids.first], reader.attemptId, [practiceAnswer()]),
    }));
    const page = mount();
    let state = await settle(page);
    await state.start(true);
    state = await settle(page);
    expect(mocked.snapshot).toHaveBeenCalledTimes(1);
    expect(state.attempt?.revision).toBe(2);
    expect(state.attempt?.answers).toHaveLength(1);
  });
  it("retains the exact ambiguous answer and never shows feedback or read progress before acceptance", async () => {
    setup();
    mocked.progress.mockRejectedValueOnce(new TypeError("Lost ACK"));
    const page = mount();
    let state = await settle(page);
    await state.start(true);
    state = await settle(page);
    await state.progress("answer", ids.first, ids.choice);
    state = await settle(page);
    const command = mocked.progress.mock.calls[0]![2];
    expect(state.attempt?.answers).toEqual([]);
    expect(state.attempt?.readBlockIds).toEqual([]);
    expect(state.pending).toBe("progress");
    await state.changePage(1);
    expect(mocked.access).not.toHaveBeenCalled();
    await state.progress();
    state = await settle(page);
    expect(mocked.progress.mock.calls[1]![2]).toBe(command);
    expect(state.pending).toBeNull();
    expect(state.attempt?.answers).toHaveLength(1);
    expect(state.attempt?.readBlockIds).toEqual([ids.first]);
  });
  it("refreshes a stale revision conflict before accepting another explicit action", async () => {
    setup(true);
    const page = mount();
    let state = await settle(page);
    await state.resume();
    state = await settle(page);
    mocked.progress.mockRejectedValue(
      new ApiClientError("Conflict", "PRESENTATION_PRACTICE_REVISION_CONFLICT", 409),
    );
    mocked.snapshot.mockResolvedValue({
      ...practicePreview(),
      attempt: practiceAttempt(2, [ids.first, ids.second], ids.attempt, [
        practiceAnswer(),
        practiceAnswer(ids.second),
      ]),
    });
    await state.progress("answer", ids.second, ids.choice);
    state = await settle(page);
    expect(state.pending).toBeNull();
    expect(state.attempt?.revision).toBe(2);
    expect(state.error).toContain("progress changed");
  });
  it("does not roll back current personal answers on a stale replay", async () => {
    setup(true);
    const page = mount();
    let state = await settle(page);
    await state.resume();
    state = await settle(page);
    mocked.progress.mockResolvedValue({ attempt: practiceAttempt(0), replayed: true });
    mocked.snapshot.mockResolvedValue({
      ...practicePreview(),
      attempt: practiceAttempt(2, [ids.first, ids.second], ids.attempt, [
        practiceAnswer(),
        practiceAnswer(ids.second),
      ]),
    });
    await state.progress("answer", ids.second, ids.choice);
    state = await settle(page);
    expect(state.attempt?.revision).toBe(2);
    expect(state.attempt?.answers).toHaveLength(2);
  });
  it("fences late accepted feedback when the reader is cleared during an in-flight answer", async () => {
    setup(true);
    const page = mount();
    let state = await settle(page);
    await state.resume();
    state = await settle(page);
    const pending = deferred<{ attempt: ReturnType<typeof practiceAttempt>; replayed: boolean }>();
    mocked.progress.mockReturnValue(pending.promise);
    const action = state.progress("answer", ids.second, ids.choice);
    state = page.render();
    expect(state.busy).toBe(true);
    state.resetReader();
    pending.resolve({
      attempt: practiceAttempt(2, [ids.first, ids.second], ids.attempt, [
        practiceAnswer(),
        practiceAnswer(ids.second),
      ]),
      replayed: false,
    });
    await action;
    state = await settle(page);
    expect(state.attempt).toBeNull();
    expect(state.resumeUrl).toBe("");
    expect(state.pending).toBeNull();
  });
  it("erases loaded answers and private links after revoked access or the deadline", async () => {
    const env = setup(true);
    const page = mount();
    let state = await settle(page);
    await state.resume();
    state = await settle(page);
    mocked.access.mockRejectedValue(
      new ApiClientError("Gone", "PRESENTATION_PRACTICE_UNAVAILABLE", 404),
    );
    await state.changePage(1);
    state = await settle(page);
    expect(state.attempt).toBeNull();
    expect(state.preview).toBeNull();
    expect(state.token).toBeNull();
    env.location.href = `https://example.test/presentation-practice/${ids.assignment}#token=${practiceToken}`;
    env.dispatch("hashchange");
    await settle(page);
    await vi.advanceTimersByTimeAsync(86_400_000);
    state = page.render();
    expect(state.preview).toBeNull();
    expect(state.token).toBeNull();
  });
});
