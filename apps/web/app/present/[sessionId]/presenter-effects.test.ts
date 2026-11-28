import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@openround/contracts";
import { presenterCueFor } from "./presenter-effects";

function snapshot(phase: SessionSnapshot["phase"], seq: number, roundId: string | null = "first") {
  return { sessionId: "round-session", phase, seq, roundId };
}

describe("presenter lifecycle cues", () => {
  it("recognizes real openings and locks, reveals, and the finish", () => {
    const lobby = snapshot("lobby", 1, null);
    const open = snapshot("question_open", 2);
    const locked = snapshot("question_locked", 4);
    const reveal = snapshot("question_reveal", 5);
    const final = snapshot("finished", 6);

    expect(presenterCueFor(lobby, open, "question.open")).toBe("open");
    expect(presenterCueFor(open, locked, "question.locked")).toBe("lock");
    expect(presenterCueFor(snapshot("paused", 3), locked, "question.locked")).toBe("lock");
    expect(presenterCueFor(locked, reveal, "question.reveal")).toBe("reveal");
    expect(presenterCueFor(reveal, final, "game.finished")).toBe("finish");
  });

  it("plays one opening for a recheck or revote that broadcasts both opening events", () => {
    const reveal = snapshot("question_reveal", 5);
    const recheck = snapshot("question_open", 7, "recheck");
    expect(presenterCueFor(reveal, recheck, "recheck.open")).toBe("open");
    expect(presenterCueFor(recheck, recheck, "question.open")).toBeUndefined();
  });

  it("skips duplicates, background snapshots, and a lock already seen on reconnect", () => {
    const open = snapshot("question_open", 2);
    const locked = snapshot("question_locked", 4);
    expect(presenterCueFor(null, locked, "question.locked")).toBeUndefined();
    expect(presenterCueFor(open, locked, "checkpoint.insight")).toBeUndefined();
    expect(presenterCueFor(open, locked, "session.snapshot")).toBeUndefined();
    expect(presenterCueFor(locked, locked, "question.locked")).toBeUndefined();
    expect(
      presenterCueFor(locked, snapshot("question_locked", 5), "question.locked"),
    ).toBeUndefined();
    expect(
      presenterCueFor(snapshot("question_reveal", 6), locked, "question.locked"),
    ).toBeUndefined();
    expect(
      presenterCueFor(snapshot("question_open", 3, "other"), locked, "question.locked"),
    ).toBeUndefined();
  });
});
