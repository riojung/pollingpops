import { describe, expect, it, vi } from "vitest";
import {
  capturePresentationStagePass,
  presentationStageLaunchUrl,
  presentationStagePassKey,
  rejectPresentationStagePass,
} from "./presentation-stage-pass";

const launchPass = "stage-read-only-pass-".repeat(3);
const otherPass = "other-stage-read-only-pass-".repeat(3);

function tabStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

function browserLocation(href: string) {
  const location = { href };
  const history = {
    state: { retained: "history-state" },
    replaceState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => {
      if (url !== undefined && url !== null) location.href = new URL(url, location.href).href;
    }),
  };
  return { location, history };
}

function stageLocation(pass?: string, sessionId = "session-a") {
  return browserLocation(
    pass === undefined
      ? `https://example.test/presentation-session/${sessionId}/stage`
      : presentationStageLaunchUrl("https://example.test", sessionId, pass),
  );
}

describe("Read-only audience stage launch pass", () => {
  it("scrubs the entire secret fragment before storage access or a subsequent stage request", () => {
    const browser = browserLocation(
      `https://example.test/presentation-session/session-a/stage?display=wide#pass=${launchPass}&extra=private`,
    );
    const order: string[] = [];
    const storage = tabStorage();
    const replaceState = browser.history.replaceState;
    browser.history.replaceState = vi.fn((state, unused, url) => {
      order.push("scrub");
      replaceState(state, unused, url);
    });
    const captureStorage = {
      ...storage,
      setItem: (key: string, value: string) => {
        expect(new URL(browser.location.href).hash).toBe("");
        order.push("store");
        storage.setItem(key, value);
      },
    };
    const captured = capturePresentationStagePass({
      sessionId: "session-a",
      ...browser,
      storage: captureStorage,
    });
    const stageRequest = vi.fn((pass: string | null) => {
      expect(new URL(browser.location.href).hash).toBe("");
      expect(pass).toBe(launchPass);
      order.push("request");
    });
    stageRequest(captured);
    expect(order).toEqual(["scrub", "store", "request"]);
    expect(browser.history.replaceState).toHaveBeenCalledWith(
      browser.history.state,
      "",
      "/presentation-session/session-a/stage?display=wide",
    );
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.getItem(presentationStagePassKey("session-a"))).toBe(launchPass);
  });

  it("restores this session's pass on refresh and keeps other sessions and host access isolated", () => {
    const storage = tabStorage({ "openround:presentation-host:session-a": "host-secret" });
    const firstBrowser = stageLocation(launchPass);
    expect(capturePresentationStagePass({ sessionId: "session-a", ...firstBrowser, storage })).toBe(
      launchPass,
    );
    expect(capturePresentationStagePass({ sessionId: "session-a", ...firstBrowser, storage })).toBe(
      launchPass,
    );
    expect(firstBrowser.history.replaceState).toHaveBeenCalledOnce();
    expect(
      capturePresentationStagePass({
        sessionId: "session-b",
        ...stageLocation(undefined, "session-b"),
        storage,
      }),
    ).toBeNull();
    expect(
      capturePresentationStagePass({
        sessionId: "session-b",
        ...stageLocation(otherPass, "session-b"),
        storage,
      }),
    ).toBe(otherPass);
    expect(storage.getItem(presentationStagePassKey("session-a"))).toBe(launchPass);
    expect(storage.getItem("openround:presentation-host:session-a")).toBe("host-secret");
  });

  it.each(
    ["", "short", "p".repeat(31), "p".repeat(1_001)].map(
      (candidate) => [candidate.length, candidate] as const,
    ),
  )(
    "scrubs a malformed launch pass of length %i and clears the prior session pass",
    (_length, candidate) => {
      const key = presentationStagePassKey("session-a");
      const otherKey = presentationStagePassKey("session-b");
      const storage = tabStorage({ [key]: launchPass, [otherKey]: otherPass });
      const browser = stageLocation(candidate);
      expect(
        capturePresentationStagePass({ sessionId: "session-a", ...browser, storage }),
      ).toBeNull();
      expect(new URL(browser.location.href).hash).toBe("");
      expect(storage.getItem(key)).toBeNull();
      expect(storage.getItem(otherKey)).toBe(otherPass);
      expect(storage.removeItem).toHaveBeenCalledWith(key);
    },
  );

  it.each([32, 1_000])("accepts the pass length boundary of %i characters", (length) => {
    const candidate = "p".repeat(length);
    const storage = tabStorage();
    expect(
      capturePresentationStagePass({
        sessionId: "session-a",
        ...stageLocation(candidate),
        storage,
      }),
    ).toBe(candidate);
    expect(storage.getItem(presentationStagePassKey("session-a"))).toBe(candidate);
  });

  it("does not resurrect an older pass when the first launch parameter is malformed", () => {
    const storage = tabStorage({ [presentationStagePassKey("session-a")]: launchPass });
    const browser = browserLocation(
      `https://example.test/presentation-session/session-a/stage#pass=bad&pass=${otherPass}`,
    );
    expect(
      capturePresentationStagePass({ sessionId: "session-a", ...browser, storage }),
    ).toBeNull();
    expect(storage.getItem(presentationStagePassKey("session-a"))).toBeNull();
    expect(new URL(browser.location.href).hash).toBe("");
  });

  it("still clears the fragment and returns the new launch pass when persistence is blocked", () => {
    const browser = stageLocation(launchPass);
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("Storage read denied");
      }),
      setItem: vi.fn(() => {
        expect(new URL(browser.location.href).hash).toBe("");
        throw new Error("Storage write denied");
      }),
      removeItem: vi.fn(() => {
        throw new Error("Storage removal denied");
      }),
    };
    expect(capturePresentationStagePass({ sessionId: "session-a", ...browser, storage })).toBe(
      launchPass,
    );
    expect(browser.history.replaceState).toHaveBeenCalledOnce();
    expect(new URL(browser.location.href).hash).toBe("");
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(
      capturePresentationStagePass({ sessionId: "session-a", ...stageLocation(), storage }),
    ).toBeNull();
    const malformedBrowser = stageLocation("short");
    expect(
      capturePresentationStagePass({ sessionId: "session-a", ...malformedBrowser, storage }),
    ).toBeNull();
    expect(new URL(malformedBrowser.location.href).hash).toBe("");
    expect(storage.removeItem).toHaveBeenCalledWith(presentationStagePassKey("session-a"));
  });

  it("fails before storing or returning a launch secret if browser history cannot scrub it", () => {
    const storage = tabStorage();
    const browser = stageLocation(launchPass);
    browser.history.replaceState.mockImplementation(() => {
      throw new Error("History unavailable");
    });
    expect(() =>
      capturePresentationStagePass({ sessionId: "session-a", ...browser, storage }),
    ).toThrow("History unavailable");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("does not remove a newer launch pass after an older request is rejected", () => {
    const key = presentationStagePassKey("session-a");
    const otherKey = presentationStagePassKey("session-b");
    const storage = tabStorage({ [key]: otherPass, [otherKey]: launchPass });
    expect(rejectPresentationStagePass(storage, "session-a", launchPass)).toBe(false);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.getItem(key)).toBe(otherPass);
    expect(rejectPresentationStagePass(storage, "session-a", otherPass)).toBe(true);
    expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem(otherKey)).toBe(launchPass);
  });

  it("permits in-memory rejection even when tab storage cannot be read or cleared", () => {
    const storage = tabStorage({ [presentationStagePassKey("session-a")]: launchPass });
    storage.removeItem.mockImplementation(() => {
      throw new Error("Removal denied");
    });
    expect(rejectPresentationStagePass(storage, "session-a", launchPass)).toBe(true);
    storage.getItem.mockImplementation(() => {
      throw new Error("Read denied");
    });
    expect(rejectPresentationStagePass(storage, "session-a", launchPass)).toBe(true);
  });

  it("encodes the session as one path segment and keeps all launch authority in the fragment", () => {
    const sessionId = "session/with ?query=#fragment&unicode=é";
    const pass = "stage+secret/&?#= %é".repeat(3);
    const url = new URL(
      presentationStageLaunchUrl("https://example.test/base?old=1", sessionId, pass),
    );
    expect(url.origin).toBe("https://example.test");
    expect(url.pathname).toBe(`/presentation-session/${encodeURIComponent(sessionId)}/stage`);
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("pass")).toBe(pass);
    expect(url.href.split("#")[0]).not.toContain("secret");
    const browser = browserLocation(url.href);
    expect(capturePresentationStagePass({ sessionId, ...browser, storage: tabStorage() })).toBe(
      pass,
    );
    expect(new URL(browser.location.href).hash).toBe("");
  });
});
