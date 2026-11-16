import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supportedLocales } from "@openround/contracts";
import {
  readSignupContinuation,
  saveSignupContinuation,
  SIGNUP_CONTINUATION_KEY,
} from "./signup-continuation";
import { signupJourneyCopy } from "./signup-journey-copy";

const storage = new Map<string, string>();
const context = { apiUrl: "https://api.example.com", returnTo: "/create" };
const entry = {
  email: "creator@example.com",
  accountType: "personal" as const,
  segment: "workplace" as const,
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Signup convenience context", () => {
  it("keeps bounded context without authentication authority", () => {
    saveSignupContinuation(context, entry, 1000);
    expect(readSignupContinuation(context, 2000)).toEqual(entry);
    const stored = JSON.parse(storage.get(SIGNUP_CONTINUATION_KEY)!);
    expect(Object.keys(stored).sort()).toEqual([
      "accountType",
      "context",
      "email",
      "expiresAt",
      "segment",
      "version",
    ]);
    expect(readSignupContinuation(context, 901000)).toBeNull();
    expect(storage.has(SIGNUP_CONTINUATION_KEY)).toBe(false);
  });

  it.each([
    { ...context, apiUrl: "https://other.example.com" },
    { ...context, returnTo: "/account" },
    { ...context, workspaceId: "other-workspace" },
  ])("does not carry email across another context", (other) => {
    saveSignupContinuation(context, entry, 1000);
    expect(readSignupContinuation(other, 2000)).toBeNull();
  });

  it("ignores corrupt, oversized and unavailable storage", () => {
    storage.set(SIGNUP_CONTINUATION_KEY, "not-json");
    expect(readSignupContinuation(context)).toBeNull();
    storage.set(SIGNUP_CONTINUATION_KEY, "x".repeat(2049));
    expect(readSignupContinuation(context)).toBeNull();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => saveSignupContinuation(context, entry)).not.toThrow();
    expect(readSignupContinuation(context)).toBeNull();
  });

  it("provides the same nonempty signup guidance keys in every supported locale", () => {
    const english = signupJourneyCopy();
    for (const locale of supportedLocales) {
      const copy = signupJourneyCopy(locale);
      expect(Object.keys(copy)).toEqual(Object.keys(english));
      expect(
        Object.values(copy).every((value) => typeof value === "string" && value.trim().length > 0),
      ).toBe(true);
    }
  });
});
