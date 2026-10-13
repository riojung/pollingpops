import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  ApiClientError,
  AUTH_CHANGE_EVENT,
  LOGOUT_REVOCATION_WARNING,
  LOGOUT_WARNING_STORAGE_KEY,
  readLogoutWarning,
  dismissLogoutWarning,
} from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("API request credentials", () => {
  it("retains authenticated defaults while honoring explicit credential isolation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    await apiFetch("/v1/auth/me");
    await apiFetch("/v1/presentation-sessions/session/companion", {
      credentials: "omit",
      headers: { authorization: "Bearer scoped-pass" },
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      credentials: "omit",
      headers: { authorization: "Bearer scoped-pass" },
    });
  });
});

describe("product logout and admin session revocation", () => {
  function memoryStorage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
  }

  function authChangeListener() {
    const browser = new EventTarget();
    const listener = vi.fn();
    browser.addEventListener(AUTH_CHANGE_EVENT, listener);
    vi.stubGlobal("window", browser);
    return listener;
  }

  it("surfaces uncertain admin revocation while notifying cleared-cookie navigation", async () => {
    const listener = authChangeListener();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, operatorSessionRevoked: false })),
    );
    const failure: unknown = await apiFetch("/v1/auth/logout", { method: "POST" }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApiClientError);
    expect(failure).toMatchObject({
      code: "OPERATOR_SESSION_REVOCATION_UNCONFIRMED",
      status: 200,
      message:
        "Product sign-out completed, but admin session revocation could not be confirmed. Check the management service before leaving this device.",
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("preserves normal logout responses without competing with the caller's redirect", async () => {
    for (const body of [{ ok: true }, { ok: true, operatorSessionRevoked: true }]) {
      const listener = authChangeListener();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(body)),
      );
      expect(await apiFetch("/v1/auth/logout", { method: "POST" })).toEqual(body);
      expect(listener).not.toHaveBeenCalled();
    }
  });

  it("does not interpret unrelated payloads or reads as logout results", async () => {
    const listener = authChangeListener();
    const body = { ok: true, operatorSessionRevoked: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body)),
    );
    expect(await apiFetch("/v1/account", { method: "POST" })).toEqual(body);
    expect(await apiFetch("/v1/auth/logout")).toEqual(body);
    expect(listener).not.toHaveBeenCalled();
  });

  it("retains 204 handling without triggering an auth refresh on confirmed logout", async () => {
    const listener = authChangeListener();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    expect(await apiFetch("/v1/account", { method: "POST" })).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    expect(await apiFetch("/v1/auth/logout", { method: "post" })).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    listener.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { message: "Unavailable" } }, { status: 503 })),
    );
    await expect(apiFetch("/v1/auth/logout", { method: "POST" })).rejects.toMatchObject({
      status: 503,
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("supports logout without a browser environment", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true })),
    );
    expect(await apiFetch("/v1/auth/logout", { method: "POST" })).toEqual({ ok: true });
    expect(readLogoutWarning()).toBeNull();
    expect(() => dismissLogoutWarning()).not.toThrow();
  });

  it("refreshes cleared-cookie navigation when a successful HTTP logout has an unreadable result", async () => {
    const listener = authChangeListener();
    const parseFailure = new SyntaxError("Unreadable logout response");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw parseFailure;
        },
      })),
    );
    await expect(apiFetch("/v1/auth/logout", { method: "POST" })).rejects.toBe(parseFailure);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("persists the bounded warning before notification and retains it across page navigation", async () => {
    const storage = memoryStorage();
    const browser = Object.assign(new EventTarget(), { sessionStorage: storage });
    const observedWarning = vi.fn(() => readLogoutWarning());
    browser.addEventListener(AUTH_CHANGE_EVENT, observedWarning);
    vi.stubGlobal("window", browser);
    expect(readLogoutWarning()).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, operatorSessionRevoked: false })),
    );
    await expect(apiFetch("/v1/auth/logout", { method: "POST" })).rejects.toBeInstanceOf(
      ApiClientError,
    );
    expect(observedWarning.mock.results[0]?.value).toBe(LOGOUT_REVOCATION_WARNING);
    vi.stubGlobal("window", Object.assign(new EventTarget(), { sessionStorage: storage }));
    expect(readLogoutWarning()).toBe(LOGOUT_REVOCATION_WARNING);
    dismissLogoutWarning();
    expect(readLogoutWarning()).toBeNull();
    expect(storage.getItem(LOGOUT_WARNING_STORAGE_KEY)).toBeNull();
  });

  it("clears a prior warning on confirmed logout and accepts only the bounded stored message", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", Object.assign(new EventTarget(), { sessionStorage: storage }));
    storage.setItem(LOGOUT_WARNING_STORAGE_KEY, "Untrusted account-specific warning");
    expect(readLogoutWarning()).toBeNull();
    storage.setItem(LOGOUT_WARNING_STORAGE_KEY, LOGOUT_REVOCATION_WARNING);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, operatorSessionRevoked: true })),
    );
    await apiFetch("/v1/auth/logout", { method: "POST" });
    expect(readLogoutWarning()).toBeNull();
  });

  it("still reports uncertain logout when browser storage is blocked", async () => {
    const browser = new EventTarget();
    Object.defineProperty(browser, "sessionStorage", {
      get: () => {
        throw new Error("Storage unavailable");
      },
    });
    const listener = vi.fn();
    browser.addEventListener(AUTH_CHANGE_EVENT, listener);
    vi.stubGlobal("window", browser);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, operatorSessionRevoked: false })),
    );
    await expect(apiFetch("/v1/auth/logout", { method: "POST" })).rejects.toMatchObject({
      code: "OPERATOR_SESSION_REVOCATION_UNCONFIRMED",
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(readLogoutWarning()).toBeNull();
    expect(() => dismissLogoutWarning()).not.toThrow();
  });
});
