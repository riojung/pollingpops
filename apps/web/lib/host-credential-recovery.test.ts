import { describe, expect, it } from "vitest";

import {
  createHostCredentialRecovery,
  hostCredentialStorageKey,
  cohostCredentialStorageKey,
  readHostCredential,
  saveCreatorHostCredential,
  scopedCohostCredential,
  roundHostSessionId,
} from "./host-credential-recovery.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("host credential recovery", () => {
  const cohost = "synthetic_cohost_capability_1234567890";
  const owner = "synthetic_creator_capability_123456789";

  it("consumes an explicit cohost fragment into separate tab storage and preserves its mode after fragment removal/reload", () => {
    const storage = memoryStorage({ [hostCredentialStorageKey("session-a")]: owner });
    let hash = `#cohost=${cohost}`;
    const clear = () => {
      hash = "";
    };
    expect(readHostCredential(storage, "session-a", hash, clear)).toEqual({
      kind: "cohost",
      token: cohost,
    });
    expect(hash).toBe("");
    expect(storage.getItem(cohostCredentialStorageKey("session-a"))).toBe(cohost);
    expect(storage.getItem(hostCredentialStorageKey("session-a"))).toBeNull();
    expect(readHostCredential(storage, "session-a", hash, clear)).toEqual({
      kind: "cohost",
      token: cohost,
    });
    expect(scopedCohostCredential(storage, "session-b", "")).toBeNull();
  });

  it("requires creator auth for owner-key-only storage", () => {
    const storage = memoryStorage({ [hostCredentialStorageKey("session-a")]: owner });
    expect(scopedCohostCredential(storage, "session-a", "")).toBeNull();
    expect(readHostCredential(storage, "session-a", "", () => {})).toEqual({
      kind: "creator",
      token: owner,
    });
    expect(storage.getItem(cohostCredentialStorageKey("session-a"))).toBeNull();
  });

  it("migrates a legacy cohost when the original fragment matches its old shared storage key", () => {
    const storage = memoryStorage({ [hostCredentialStorageKey("session-a")]: cohost });
    expect(scopedCohostCredential(storage, "session-a", "")).toBeNull();
    let cleared = false;
    expect(
      readHostCredential(storage, "session-a", `#cohost=${cohost}`, () => {
        cleared = true;
      }),
    ).toEqual({ kind: "cohost", token: cohost });
    expect(cleared).toBe(true);
    expect(storage.getItem(hostCredentialStorageKey("session-a"))).toBeNull();
    expect(storage.getItem(cohostCredentialStorageKey("session-a"))).toBe(cohost);
    expect(scopedCohostCredential(storage, "session-a", "")).toBe(cohost);
  });

  it.each([
    "#cohost=",
    "#cohost=short",
    "#cohost=bad%20capability%20value",
    `#cohost=${cohost}&cohost=${owner}`,
  ])("rejects and strips an ambiguous or malformed fragment %s before private fallback", (hash) => {
    const storage = memoryStorage();
    let cleared = false;
    expect(
      readHostCredential(storage, "session-a", hash, () => {
        cleared = true;
      }),
    ).toEqual({ kind: "creator", token: null });
    expect(cleared).toBe(true);
  });

  it("clears only the selected session's cohost mode when an owner starts or resumes hosting", () => {
    const storage = memoryStorage({
      [cohostCredentialStorageKey("session-a")]: cohost,
      [cohostCredentialStorageKey("session-b")]: cohost,
    });
    saveCreatorHostCredential(storage, "session-a", owner);
    expect(scopedCohostCredential(storage, "session-a", "")).toBeNull();
    expect(storage.getItem(hostCredentialStorageKey("session-a"))).toBe(owner);
    expect(storage.getItem(cohostCredentialStorageKey("session-b"))).toBe(cohost);
    expect(roundHostSessionId("/host/session-a")).toBe("session-a");
    expect(roundHostSessionId("/host/setup/quiz")).toBeNull();
  });

  it("clears only the rejected session credential and grants one recovery attempt", () => {
    const sessionKey = hostCredentialStorageKey("session-a");
    const otherSessionKey = hostCredentialStorageKey("session-b");
    const storage = memoryStorage({
      [sessionKey]: "stale-token",
      [otherSessionKey]: "other-token",
    });
    const recovery = createHostCredentialRecovery(storage, "session-a");

    expect(recovery.claim("UNAUTHORIZED", "stale-token")).toBe(true);
    expect(storage.getItem(sessionKey)).toBeNull();
    expect(storage.getItem(otherSessionKey)).toBe("other-token");

    recovery.save("replacement-token");
    expect(recovery.claim("UNAUTHORIZED", "replacement-token")).toBe(false);
    expect(storage.getItem(sessionKey)).toBeNull();
  });

  it("allows one command-time recovery after an earlier authenticated sync succeeds", () => {
    const key = hostCredentialStorageKey("session-a");
    const storage = memoryStorage({ [key]: "initial-token" });
    const recovery = createHostCredentialRecovery(storage, "session-a");

    expect(recovery.claim("UNAUTHORIZED", "initial-token")).toBe(true);
    recovery.save("authenticated-token");
    recovery.succeeded();

    expect(recovery.claim("UNAUTHORIZED", "authenticated-token")).toBe(true);
    expect(storage.getItem(key)).toBeNull();
    expect(recovery.claim("UNAUTHORIZED", "authenticated-token")).toBe(false);
  });

  it("does not clear or consume recovery for a non-authentication failure", () => {
    const key = hostCredentialStorageKey("session-a");
    const storage = memoryStorage({ [key]: "host-token" });
    const recovery = createHostCredentialRecovery(storage, "session-a");

    expect(recovery.claim("RATE_LIMITED", "host-token")).toBe(false);
    expect(storage.getItem(key)).toBe("host-token");
    expect(recovery.claim("UNAUTHORIZED", "host-token")).toBe(true);
  });

  it("does not erase a newer credential when an older sync response arrives late", () => {
    const key = hostCredentialStorageKey("session-a");
    const storage = memoryStorage({ [key]: "newer-token" });
    const recovery = createHostCredentialRecovery(storage, "session-a");

    expect(recovery.claim("UNAUTHORIZED", "older-token")).toBe(true);
    expect(storage.getItem(key)).toBe("newer-token");
  });
});
