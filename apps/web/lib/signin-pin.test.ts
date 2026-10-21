import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIN_RESUME_STORAGE_KEY,
  clearPinEntry,
  readPinEntry,
  savePinEntry,
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
