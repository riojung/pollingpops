import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_EXPIRED_EVENT,
  SESSION_POLICY_UPDATED_EVENT,
  clearPendingSessionLogout,
  readPendingSessionLogout,
  savePendingSessionLogout,
  PENDING_SESSION_LOGOUT_KEY,
  type IdleSession,
} from "../lib/idle-session";

interface Hooks {
  cursor: number;
  slots: unknown[];
  dependencies: Map<number, readonly unknown[] | undefined>;
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
  cleanups: Map<number, void | (() => void)>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  apiFetch: vi.fn(),
  router: { replace: vi.fn() },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useRef: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
  useState: <T,>(initial: T) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: T | ((current: T) => T)) => {
        hooks.slots[index] =
          typeof next === "function" ? (next as (current: T) => T)(hooks.slots[index] as T) : next;
      },
    ];
  },
  useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
    const hooks = mocked.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.dependencies.get(index);
    if (
      !hooks.dependencies.has(index) ||
      !dependencies ||
      dependencies.some((value, dependency) => value !== previous?.[dependency])
    )
      hooks.effects.push({ index, effect });
    hooks.dependencies.set(index, dependencies);
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => mocked.router,
}));
vi.mock("./locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
vi.mock("../lib/api", () => ({
  apiFetch: mocked.apiFetch,
  AUTH_CHANGE_EVENT: "pollingpops:auth-change",
}));

import { IdleSessionProvider } from "./idle-session-provider";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
const mounted = new Set<{ unmount: () => void }>();
function harness() {
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  const root = IdleSessionProvider({ children: <input data-private-test="sensitive-draft" /> });
  const component = root.type as (props: typeof root.props) => ReactNode;
  const boundary = { hidden: false, inert: false };
  const modal = { showModal: vi.fn(), close: vi.fn() };
  const view = {
    boundary,
    gateControl: {
      click: () => {
        const retry = view
          .render()
          .find(
            (node) =>
              node.type === "button" &&
              (node.props.children === "Try again" || node.props.children === "Retry sign-out"),
          );
        (retry?.props.onClick as (() => void) | undefined)?.();
      },
    },
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      let tree: ReactNode;
      try {
        tree = component(root.props);
      } finally {
        mocked.hooks = null;
      }
      const nodes = elements(tree);
      const privateNode = nodes.find((node) => node.type === "div" && node.props.ref);
      if (privateNode) (privateNode.props.ref as ReactModule.RefObject<unknown>).current = boundary;
      const gate = nodes.find((node) => node.props["data-testid"] === "idle-session-gate");
      if (gate)
        (gate.props.ref as ReactModule.RefObject<unknown>).current = {
          querySelectorAll: () => [view.gateControl],
        };
      for (const node of nodes) {
        if (node.type === "dialog")
          (node.props.ref as ReactModule.RefObject<unknown>).current = modal;
        if (node.type === "button" && node.props.ref)
          (node.props.ref as ReactModule.RefObject<unknown>).current = { focus() {} };
      }
      for (const { index, effect } of hooks.effects) {
        hooks.cleanups.get(index)?.();
        hooks.cleanups.set(index, effect());
      }
      return nodes;
    },
    isPrivate: () =>
      view.render().some((node) => node.props["data-private-test"] === "sensitive-draft"),
    isGated: () => view.render().some((node) => node.props["data-testid"] === "idle-session-gate"),
    unmount() {
      for (const cleanup of hooks.cleanups.values()) cleanup?.();
      mounted.delete(view);
    },
  };
  mounted.add(view);
  view.render();
  return view;
}

const session: IdleSession = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  serverNow: "2026-11-15T12:00:00.000Z",
  lastActivityAt: "2026-11-15T12:00:00.000Z",
  warningAt: "2026-11-15T12:05:00.000Z",
  expiresAt: "2026-11-15T12:06:00.000Z",
  absoluteExpiresAt: "2026-12-15T12:00:00.000Z",
  policy: { idleTimeoutMinutes: 5, warningDurationSeconds: 60 },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settled() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}
function callsTo(path: string) {
  return mocked.apiFetch.mock.calls.filter(([actual]) => actual === path);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(session.serverNow));
  mocked.apiFetch.mockReset().mockResolvedValue({ session });
  mocked.router.replace.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
      location: { pathname: "/dashboard", search: "", hash: "" },
      localStorage: { setItem: vi.fn() },
      sessionStorage: {
        get length() {
          return values.size;
        },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    }),
  );
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      visibilityState: "visible",
      hasFocus: () => true,
      activeElement: null,
    }),
  );
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      addEventListener() {}
      postMessage() {}
      close() {}
    },
  );
});
afterEach(() => {
  for (const view of mounted) view.unmount();
  clearPendingSessionLogout();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("late expiration responses across fresh sign-in", () => {
  it("reconciles a policy update while retaining the same private boundary", async () => {
    const view = harness();
    await settled();
    const scope = view.render().find((node) => node.type === "div" && node.props.ref)?.key;
    window.dispatchEvent(new Event(SESSION_POLICY_UPDATED_EVENT));
    await settled();
    expect(callsTo("/v1/auth/session")).toHaveLength(2);
    expect(view.isPrivate()).toBe(true);
    expect(view.render().find((node) => node.type === "div" && node.props.ref)?.key).toBe(scope);
    expect(callsTo("/v1/auth/logout")).toHaveLength(0);
  });
  it("synchronously gates a stale 401 hint, verifies the current cookie, and preserves its live session without logout", async () => {
    const view = harness();
    await settled();
    expect(view.isPrivate()).toBe(true);
    const verification = deferred<{ session: IdleSession }>();
    mocked.apiFetch.mockImplementationOnce(() => verification.promise);
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    expect(view.boundary).toMatchObject({ hidden: true, inert: true });
    expect(view.isGated()).toBe(true);
    expect(view.isPrivate()).toBe(true);
    const retainedScope = view.render().find((node) => node.type === "div" && node.props.ref)?.key;
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.isGated()).toBe(true);
    expect(view.isPrivate()).toBe(true);
    expect(callsTo("/v1/auth/session")).toHaveLength(2);
    verification.resolve({ session: { ...session, serverNow: "2026-11-15T12:00:01.000Z" } });
    await settled();
    expect(view.isPrivate()).toBe(true);
    expect(view.render().find((node) => node.type === "div" && node.props.ref)?.key).toBe(
      retainedScope,
    );
    expect(callsTo("/v1/auth/logout")).toHaveLength(0);
    expect(mocked.router.replace).not.toHaveBeenCalled();
  });

  it.each(["Enter", " "])(
    "retains the hidden draft, blocks global/private shortcuts and permits Retry using %s",
    async (activationKey) => {
      const view = harness();
      await settled();
      const scope = view.render().find((node) => node.type === "div" && node.props.ref)?.key;
      mocked.apiFetch.mockRejectedValueOnce({ status: 503 });
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      await settled();
      expect(view.isGated()).toBe(true);
      expect(view.isPrivate()).toBe(true);
      const retained = view.render().find((node) => node.type === "div" && node.props.ref)!;
      expect(retained.key).toBe(scope);
      expect(retained.props).toMatchObject({ hidden: true, inert: true });
      const hostShortcut = vi.fn();
      window.addEventListener("keydown", hostShortcut);
      for (const origin of [{}, view.boundary, view.gateControl]) {
        for (const key of ["PageDown", "Tab"]) {
          const event = new Event("keydown", { cancelable: true });
          Object.assign(event, { key, composedPath: () => [origin, window] });
          window.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(key !== "Tab");
        }
      }
      expect(hostShortcut).not.toHaveBeenCalled();
      for (const origin of [view.gateControl, view.boundary]) {
        const pointer = new Event("pointerdown", { cancelable: true });
        Object.assign(pointer, { composedPath: () => [origin, window] });
        window.dispatchEvent(pointer);
        expect(pointer.defaultPrevented).toBe(origin === view.boundary);
      }
      const activation = new Event("keydown", { cancelable: true });
      Object.assign(activation, {
        key: activationKey,
        composedPath: () => [view.gateControl, window],
      });
      window.dispatchEvent(activation);
      expect(activation.defaultPrevented).toBe(true);
      await settled();
      expect(view.isGated()).toBe(false);
      expect(view.isPrivate()).toBe(true);
      expect(view.render().find((node) => node.type === "div" && node.props.ref)?.key).toBe(scope);
      expect(callsTo("/v1/auth/logout")).toHaveLength(0);
    },
  );

  it("ignores an aborted response from before the verification epoch", async () => {
    const view = harness();
    await settled();
    expect(view.isPrivate()).toBe(true);
    const oldRead = deferred<{ session: IdleSession }>();
    mocked.apiFetch.mockImplementationOnce(() => oldRead.promise);
    await vi.advanceTimersByTimeAsync(15_000);
    const oldSignal = mocked.apiFetch.mock.calls.at(-1)?.[1].signal as AbortSignal;
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    await settled();
    expect(oldSignal.aborted).toBe(true);
    oldRead.resolve({ session: { ...session, sessionId: "00000000-0000-4000-8000-000000000099" } });
    await settled();
    expect(view.isPrivate()).toBe(true);
    expect(callsTo("/v1/auth/logout")).toHaveLength(0);
    expect(mocked.router.replace).not.toHaveBeenCalled();
  });

  it.each(["expired", "expired-payload", "different-login"])(
    "ends the old private scope after %s verification without revoking the browser's cookie",
    async (result) => {
      const view = harness();
      await settled();
      expect(view.isPrivate()).toBe(true);
      const verification = deferred<{ session: IdleSession }>();
      mocked.apiFetch.mockImplementationOnce(() => verification.promise);
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      if (result === "expired") {
        // apiFetch reports the verifying request's own 401 before rejecting it.
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        verification.reject({ status: 401, code: "SESSION_EXPIRED" });
      } else if (result === "expired-payload") {
        verification.resolve({ session: { ...session, serverNow: session.expiresAt } });
      } else
        verification.resolve({
          session: { ...session, sessionId: "00000000-0000-4000-8000-000000000099" },
        });
      await settled();
      expect(view.isGated()).toBe(true);
      expect(view.isPrivate()).toBe(false);
      expect(mocked.router.replace).toHaveBeenCalledOnce();
      expect(callsTo("/v1/auth/session")).toHaveLength(2);
      expect(callsTo("/v1/auth/logout")).toHaveLength(0);
    },
  );
});

describe("explicit session-scoped sign-out", () => {
  function button(view: ReturnType<typeof harness>, label: string) {
    const node = view
      .render()
      .find((element) => element.type === "button" && element.props.children === label);
    expect(node).toBeDefined();
    (node!.props.onClick as () => void)();
  }
  const warning = { ...session, serverNow: session.warningAt };

  it("locks immediately, retains a failed intent across remount, and retries only on explicit request until revocation succeeds", async () => {
    let failure: unknown = { status: 503 };
    mocked.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/auth/logout") {
        if (failure) throw failure;
        return { ok: true };
      }
      return { session: warning };
    });
    const view = harness();
    await settled();
    expect(view.isPrivate()).toBe(true);
    button(view, "Sign out now");
    expect(view.boundary).toMatchObject({ hidden: true, inert: true });
    await settled();
    expect(view.isPrivate()).toBe(false);
    expect(view.isGated()).toBe(true);
    expect(readPendingSessionLogout()).toEqual({
      sessionId: session.sessionId,
      returnTo: "/dashboard",
    });
    expect(JSON.parse(window.sessionStorage.getItem(PENDING_SESSION_LOGOUT_KEY)!)).toEqual(
      readPendingSessionLogout(),
    );
    expect(mocked.router.replace).not.toHaveBeenCalled();
    expect(callsTo("/v1/auth/logout")).toHaveLength(1);
    view.unmount();
    const restored = harness();
    await settled();
    expect(restored.isPrivate()).toBe(false);
    expect(callsTo("/v1/auth/logout")).toHaveLength(1);
    failure = new TypeError("Network unavailable");
    button(restored, "Retry sign-out");
    await settled();
    expect(restored.isPrivate()).toBe(false);
    expect(mocked.router.replace).not.toHaveBeenCalled();
    failure = null;
    button(restored, "Retry sign-out");
    await settled();
    expect(callsTo("/v1/auth/logout")).toHaveLength(3);
    expect(callsTo("/v1/auth/logout").at(-1)?.[1]).toMatchObject({
      body: JSON.stringify({ expectedSessionId: session.sessionId }),
    });
    expect(mocked.router.replace).toHaveBeenCalledOnce();
    expect(readPendingSessionLogout()).toBeNull();
  });

  it("times out a non-returning guarded request and keeps a keyboard-retryable lock", async () => {
    mocked.apiFetch.mockImplementation((path: string, init: RequestInit) =>
      path === "/v1/auth/logout"
        ? new Promise((_resolve, reject) =>
            init.signal!.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          )
        : Promise.resolve({ session: warning }),
    );
    const view = harness();
    await settled();
    button(view, "Sign out now");
    await settled();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(view.isPrivate()).toBe(false);
    expect(view.render().some((node) => node.props.role === "alert")).toBe(true);
    expect(
      view
        .render()
        .some((node) => node.type === "button" && node.props.children === "Retry sign-out"),
    ).toBe(true);
    expect(readPendingSessionLogout()?.sessionId).toBe(session.sessionId);
    expect(mocked.router.replace).not.toHaveBeenCalled();
  });

  it("drops a stale S0 intent for a newly verified S1 without sending any logout", async () => {
    savePendingSessionLogout({ sessionId: session.sessionId, returnTo: "/dashboard" });
    const fresh = { ...session, sessionId: "00000000-0000-4000-8000-000000000099" };
    mocked.apiFetch.mockResolvedValue({ session: fresh });
    const view = harness();
    await settled();
    expect(view.isPrivate()).toBe(true);
    expect(readPendingSessionLogout()).toBeNull();
    expect(callsTo("/v1/auth/logout")).toHaveLength(0);
    expect(mocked.router.replace).not.toHaveBeenCalled();
  });

  it("ignores a disposed S0 guarded success after fresh S1 is already mounted", async () => {
    const held = deferred<unknown>();
    mocked.apiFetch.mockImplementation((path: string) =>
      path === "/v1/auth/logout" ? held.promise : Promise.resolve({ session: warning }),
    );
    const old = harness();
    await settled();
    button(old, "Sign out now");
    await settled();
    old.unmount();
    mocked.apiFetch.mockResolvedValue({
      session: { ...session, sessionId: "00000000-0000-4000-8000-000000000099" },
    });
    const fresh = harness();
    await settled();
    expect(fresh.isPrivate()).toBe(true);
    held.resolve({ ok: true });
    await settled();
    expect(fresh.isPrivate()).toBe(true);
    expect(readPendingSessionLogout()).toBeNull();
    expect(mocked.router.replace).not.toHaveBeenCalled();
  });

  it("reconciles a guarded conflict to S1 without retrying against the new cookie", async () => {
    const fresh = { ...session, sessionId: "00000000-0000-4000-8000-000000000099" };
    let state = warning;
    mocked.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/auth/logout") {
        state = fresh;
        throw { status: 409, code: "CONFLICT" };
      }
      return { session: state };
    });
    const view = harness();
    await settled();
    button(view, "Sign out now");
    await settled();
    expect(view.isPrivate()).toBe(true);
    expect(readPendingSessionLogout()).toBeNull();
    expect(callsTo("/v1/auth/logout")).toHaveLength(1);
    expect(mocked.router.replace).not.toHaveBeenCalled();
  });
});
