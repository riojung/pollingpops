import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIN_RESUME_STORAGE_KEY,
  SIGNIN_INTENT_STORAGE_KEY,
  clearPinEntry,
  readPinEntry,
  savePinEntry,
  clearSignInIntent,
  readSignInIntent,
  saveSignInIntent,
  type PinEntry,
} from "./signin-pin";

const context = { apiUrl: "http://127.0.0.1:4100", returnTo: "/account" };
let values: Map<string, string>;
const now = new Date("2026-10-20T12:00:00Z").getTime();

function entry(): PinEntry {
  return {
    email: "creator@example.com",
    context,
    challenge: { challengeId: "A".repeat(43), expiresAt: now + 600_000 },
    delivery: "requested",
    resendAt: now + 60_000,
  };
}

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});

describe("bounded sign-in presentation intent", () => {
  it("keeps verification guidance independent from an accepted challenge", () => {
    saveSignInIntent({ step: "verified", context }, now);
    expect(readSignInIntent(context, now)).toEqual({ step: "verified", context });
    expect(readPinEntry(context, now)).toBeNull();
    expect(readSignInIntent(context, now + 900_001)).toBeNull();
  });

  it("restores a no-handle recovery countdown without storing a PIN, challenge, or session credential", () => {
    const pending = {
      ...entry(),
      step: "pin" as const,
      challenge: { challengeId: "secret-handle" },
      delivery: "requesting" as const,
      pin: "012345",
      debugPin: "654321",
      cookie: "secret-cookie",
    };
    saveSignInIntent(pending, now);
    const raw = values.get(SIGNIN_INTENT_STORAGE_KEY)!;
    expect(raw).not.toMatch(/012345|654321|secret-handle|secret-cookie|challenge|cookie|debugPin/);
    expect(readSignInIntent(context, now + 30_000)).toEqual({
      step: "pin",
      email: pending.email,
      context,
      delivery: "uncertain",
      resendAt: now + 60_000,
    });
    expect(readPinEntry(context, now)).toBeNull();
  });

  it("binds presentation intent to the API, safe return path and invitation workspace", () => {
    for (const other of [
      { ...context, apiUrl: "http://127.0.0.1:4200" },
      { ...context, returnTo: "/account/setup?type=organization" },
      { ...context, workspaceId: "00000000-0000-4000-8000-000000000002" },
    ]) {
      saveSignInIntent({ step: "verified", context }, now);
      expect(readSignInIntent(other, now)).toBeNull();
      expect(values.has(SIGNIN_INTENT_STORAGE_KEY)).toBe(false);
    }
    const unsafe = { ...context, returnTo: "//outside.example" };
    saveSignInIntent({ step: "verified", context: unsafe }, now);
    expect(readSignInIntent(unsafe, now)).toBeNull();
  });

  it("rejects malformed, expired and unbounded UI metadata", () => {
    saveSignInIntent({ step: "pin", ...entry() }, now);
    const original = JSON.parse(values.get(SIGNIN_INTENT_STORAGE_KEY)!);
    for (const value of [
      { ...original, expiresAt: now + 900_001 },
      { ...original, expiresAt: now },
      { ...original, resendAt: now + 900_001 },
      { ...original, delivery: "invented" },
      { ...original, email: "invalid" },
    ]) {
      values.set(SIGNIN_INTENT_STORAGE_KEY, JSON.stringify(value));
      expect(readSignInIntent(context, now)).toBeNull();
    }
    values.set(SIGNIN_INTENT_STORAGE_KEY, "invalid-json");
    expect(readSignInIntent(context, now)).toBeNull();
  });

  it("clears on explicit reset and tolerates unavailable session storage", () => {
    saveSignInIntent({ step: "verified", context }, now);
    clearSignInIntent();
    expect(readSignInIntent(context, now)).toBeNull();
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("Blocked");
      },
    });
    expect(() => saveSignInIntent({ step: "verified", context }, now)).not.toThrow();
    expect(() => clearSignInIntent()).not.toThrow();
    expect(readSignInIntent(context, now)).toBeNull();
    vi.stubGlobal("window", undefined);
    expect(readSignInIntent(context, now)).toBeNull();
    expect(() => saveSignInIntent({ step: "verified", context }, now)).not.toThrow();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("browser PIN request recovery", () => {
  it("does not persist an unaccepted request without a server handle", () => {
    savePinEntry({ ...entry(), challenge: null, delivery: "requesting" });
    expect(values.has(PIN_RESUME_STORAGE_KEY)).toBe(false);
    expect(readPinEntry(context, now)).toBeNull();
  });

  it("whitelists only a bounded request context and never persists PINs or debug/session credentials", () => {
    const pending = { ...entry(), pin: "012345", debugPin: "654321", cookie: "sensitive-session" };
    savePinEntry(pending);
    const raw = values.get(PIN_RESUME_STORAGE_KEY)!;
    expect(raw).not.toMatch(/012345|654321|sensitive-session|debugPin|cookie/);
    expect(readPinEntry(context, now)).toEqual(entryContaining(pending));
  });

  it("restores an interrupted delivery as uncertain without making a request", () => {
    const pending = { ...entry(), delivery: "requesting" as const };
    savePinEntry(pending);
    expect(readPinEntry(context, now)).toMatchObject({
      delivery: "uncertain",
      challenge: pending.challenge,
    });
  });

  it("does not reuse a challenge for another API, return path, or invitation workspace", () => {
    for (const other of [
      { ...context, apiUrl: "http://127.0.0.1:4200" },
      { ...context, returnTo: "/dashboard" },
      { ...context, workspaceId: "00000000-0000-4000-8000-000000000002" },
    ]) {
      savePinEntry(entry());
      expect(readPinEntry(other, now)).toBeNull();
      expect(values.has(PIN_RESUME_STORAGE_KEY)).toBe(false);
    }
  });

  it("discards expired, malformed, and unbounded resume data", () => {
    const original = entry();
    const malformed = [
      "not-json",
      JSON.stringify({
        ...original,
        version: 1,
        challenge: { challengeId: "guessable", expiresAt: now + 600_000 },
        resendAt: 0,
      }),
      JSON.stringify({ ...original, version: 1, resendAt: now + 900_001 }),
      JSON.stringify({
        ...original,
        version: 1,
        challenge: { ...original.challenge, expiresAt: now + 600_001 },
        resendAt: 0,
      }),
    ];
    for (const raw of malformed) {
      values.set(PIN_RESUME_STORAGE_KEY, raw);
      expect(readPinEntry(context, now)).toBeNull();
    }
    savePinEntry(original);
    expect(readPinEntry(context, now + 600_001)).toBeNull();
  });

  it("remains usable when session storage is blocked or no browser exists", () => {
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("Blocked");
      },
    });
    expect(() => savePinEntry(entry())).not.toThrow();
    expect(readPinEntry(context, now)).toBeNull();
    expect(() => clearPinEntry()).not.toThrow();
    vi.stubGlobal("window", undefined);
    expect(readPinEntry(context, now)).toBeNull();
    expect(() => savePinEntry(entry())).not.toThrow();
  });
});

function entryContaining(value: PinEntry) {
  return {
    email: value.email,
    context: value.context,
    challenge: value.challenge,
    delivery: value.delivery,
    resendAt: value.resendAt,
  };
}
