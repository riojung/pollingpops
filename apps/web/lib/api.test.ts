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

  it("accepts only the bounded stored warning", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", Object.assign(new EventTarget(), { sessionStorage: storage }));
    storage.setItem(LOGOUT_WARNING_STORAGE_KEY, "Untrusted account-specific warning");
    expect(readLogoutWarning()).toBeNull();
    storage.setItem(LOGOUT_WARNING_STORAGE_KEY, LOGOUT_REVOCATION_WARNING);
    expect(readLogoutWarning()).toBe(LOGOUT_REVOCATION_WARNING);
  });

  it("retains an unresolved warning through cookie-free logout retries until explicit dismissal", async () => {
    const storage = memoryStorage();
    const browser = Object.assign(new EventTarget(), { sessionStorage: storage });
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
    expect(readLogoutWarning()).toBe(LOGOUT_REVOCATION_WARNING);
    expect(listener).toHaveBeenCalledOnce();

    // These responses cannot identify or revoke the original now-cookie-free session.
    for (const response of [
      Response.json({ ok: true }),
      new Response(null, { status: 204 }),
      Response.json({ ok: true, operatorSessionRevoked: true }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      await apiFetch("/v1/auth/logout", { method: "POST" });
      expect(readLogoutWarning()).toBe(LOGOUT_REVOCATION_WARNING);
      expect(listener).toHaveBeenCalledOnce();
    }
    dismissLogoutWarning();
    expect(readLogoutWarning()).toBeNull();
    expect(storage.getItem(LOGOUT_WARNING_STORAGE_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
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

describe("API retry timing", () => {
  it("retains structured server timing on throttled requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "Wait before trying again",
              retryAfterSeconds: 85,
            },
          },
          { status: 429, headers: { "Retry-After": "85" } },
        ),
      ),
    );
    await expect(
      apiFetch("/v1/auth/pin/request", { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      retryAfterSeconds: 85,
    });
  });

  it("reads Retry-After when a structured delay is absent or invalid", async () => {
    for (const retryAfterSeconds of [undefined, -10, "malformed"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { error: { message: "Wait", retryAfterSeconds } },
            { status: 429, headers: { "Retry-After": "90" } },
          ),
        ),
      );
      await expect(apiFetch("/v1/auth/pin/request")).rejects.toMatchObject({
        retryAfterSeconds: 90,
      });
    }
  });

  it("handles HTTP-date retry timing and ignores malformed values", async () => {
    const now = Date.now();
    const date = new Date(now + 60_000).toUTCString();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Unavailable", {
            status: 503,
            headers: { "Retry-After": date },
          }),
      ),
    );
    const failure = (await apiFetch("/v1/features").catch(
      (error: unknown) => error,
    )) as ApiClientError;
    expect(failure.retryAfterSeconds).toBeGreaterThanOrEqual(59);
    expect(failure.retryAfterSeconds).toBeLessThanOrEqual(60);
    for (const header of ["", "soon", "-1", "NaN"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { error: { message: "Wait" } },
            {
              status: 429,
              headers: { "Retry-After": header },
            },
          ),
        ),
      );
      await expect(apiFetch("/v1/auth/pin/request")).rejects.toMatchObject({
        retryAfterSeconds: undefined,
      });
    }
  });
});
