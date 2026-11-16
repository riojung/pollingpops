import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCreatorSessionAuthority,
  idleSessionPhase,
  isWorkspaceSessionPath,
  parseIdleSession,
  sessionClock,
  sessionNow,
  sessionReturnPath,
  sessionSecondsRemaining,
  type IdleSession,
} from "./idle-session";

const start = Date.parse("2026-11-15T12:00:00.000Z");
const iso = (elapsed: number) => new Date(start + elapsed).toISOString();
const session: IdleSession = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  serverNow: iso(0),
  lastActivityAt: iso(0),
  warningAt: iso(300_000),
  expiresAt: iso(360_000),
  absoluteExpiresAt: iso(30 * 86400_000),
  policy: { idleTimeoutMinutes: 5, warningDurationSeconds: 60 },
};
afterEach(() => vi.unstubAllGlobals());

describe("creator idle session deadlines", () => {
  it("warns at five minutes with the full countdown and expires at six", () => {
    expect(idleSessionPhase(session, start + 299_999)).toBe("active");
    expect(idleSessionPhase(session, start + 300_000)).toBe("warning");
    expect(sessionSecondsRemaining(session, start + 300_000)).toBe(60);
    expect(sessionSecondsRemaining(session, start + 359_001)).toBe(1);
    expect(idleSessionPhase(session, start + 360_000)).toBe("expired");
    expect(sessionSecondsRemaining(session, start + 600_000)).toBe(0);
  });
  it("uses server time despite client skew, catches suspended clocks and rejects backwards time", () => {
    const clock = sessionClock(session, 9_000_000, 10_000);
    expect(sessionNow(clock, 9_300_000, 310_000)).toBe(start + 300_000);
    expect(sessionNow(clock, 9_360_000, 10_001)).toBe(start + 360_000);
    expect(sessionNow(clock, 8_000_000, 370_000)).toBe(start + 360_000);
    expect(sessionNow(clock, 8_000_000, 5_000)).toBe(start);
  });
  it("caps access at absolute expiry even when the idle deadline is later", () => {
    const capped = { ...session, absoluteExpiresAt: iso(330_000) };
    expect(idleSessionPhase(capped, start + 330_000)).toBe("expired");
    expect(sessionSecondsRemaining(capped, start + 300_000)).toBe(30);
  });
  it("validates authoritative policy/deadline metadata, including identity-only accounts", () => {
    expect(parseIdleSession(session)).toEqual(session);
    expect(parseIdleSession({ ...session, workspaceId: null })).not.toBeNull();
    for (const invalid of [
      null,
      {},
      { ...session, sessionId: "" },
      { ...session, serverNow: "invalid" },
      { ...session, warningAt: iso(400_000) },
      { ...session, policy: { idleTimeoutMinutes: 0, warningDurationSeconds: 60 } },
      { ...session, policy: { idleTimeoutMinutes: 241, warningDurationSeconds: 60 } },
      { ...session, policy: { idleTimeoutMinutes: 5, warningDurationSeconds: 30 } },
    ])
      expect(parseIdleSession(invalid)).toBeNull();
  });
});

describe("private session boundary", () => {
  it.each([
    "/home",
    "/account",
    "/account/setup",
    "/organization",
    "/quiz/id",
    "/presentation/id",
    "/presentation-session/id/host",
    "/practice/id",
    "/future-private-page",
  ])("protects %s by default", (path) => {
    expect(isWorkspaceSessionPath(path)).toBe(true);
  });
  it.each([
    "/",
    "/signin",
    "/join",
    "/board/id",
    "/play/id",
    "/present/id",
    "/embed/present/id/key",
    "/followup/id",
    "/survey/id",
    "/presentation-assignment/id",
    "/presentation-practice/id",
    "/presentation-review/id",
    "/summary/id",
    "/canvas/invitations/id",
    "/organization/invite",
    "/presentation/join",
    "/presentation-session/id/play",
    "/presentation-session/id/stage",
    "/presentation-session/id/companion",
  ])("preserves independent public route %s", (path) => {
    expect(isWorkspaceSessionPath(path)).toBe(false);
  });
  it("retains only a safe local return destination", () => {
    expect(
      sessionReturnPath({ pathname: "/quiz/id", search: "?tab=edit", hash: "#question" }),
    ).toBe("/quiz/id?tab=edit#question");
    for (const pathname of [
      "//outside.example",
      "/\\outside",
      "/bad\npath",
      `/${"a".repeat(501)}`,
    ]) {
      expect(sessionReturnPath({ pathname, search: "", hash: "" })).toBe("/home");
    }
  });
  it("purges creator control while retaining participant, stage, companion and guest passes", () => {
    const values = new Map([
      ["openround:host:round", "owner-control"],
      ["openround:presentation-host:session", "owner-control"],
      ["openround_lti_link_token", "identity-link"],
      ["openround:participant:round", "audience"],
      ["openround:presentation-stage:session", "display"],
      ["openround:presentation-companion:session", "notes"],
      ["pollingpops:idea-board:guest", "guest"],
    ]);
    vi.stubGlobal("window", {
      sessionStorage: {
        get length() {
          return values.size;
        },
        key: (index: number) => [...values.keys()][index] ?? null,
        removeItem: (key: string) => values.delete(key),
      },
    });
    clearCreatorSessionAuthority();
    expect([...values.keys()]).toEqual([
      "openround:participant:round",
      "openround:presentation-stage:session",
      "openround:presentation-companion:session",
      "pollingpops:idea-board:guest",
    ]);
  });
});
