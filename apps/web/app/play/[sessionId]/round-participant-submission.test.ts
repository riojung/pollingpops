import type { SessionSnapshot } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { participantResponseFooterVisible } from "./round-participant-submission";

const snapshot = {
  phase: "question_open",
  uxBeta: true,
  roundKind: "main",
  settings: { resultVisibility: "leaderboard" },
  question: { type: "single_select", confidence: "off" },
} as SessionSnapshot;
const idle = {
  saved: false,
  pending: false,
  retryable: false,
  failed: false,
  error: "",
  hasDraft: false,
};

describe("participant response footer", () => {
  it("keeps the immediate-answer instruction in one place before selection", () => {
    expect(participantResponseFooterVisible(snapshot, idle)).toBe(false);
    expect(participantResponseFooterVisible(snapshot, { ...idle, hasDraft: true })).toBe(false);
    expect(
      participantResponseFooterVisible(
        {
          ...snapshot,
          uxBeta: false,
          settings: { ...snapshot.settings, resultVisibility: "private" },
        },
        idle,
      ),
    ).toBe(false);
  });

  it("shows pending acknowledgements and every recovery state for automatic answers", () => {
    for (const state of [
      { pending: true },
      { retryable: true },
      { failed: true },
      { error: "Connection interrupted" },
    ]) {
      expect(participantResponseFooterVisible(snapshot, { ...idle, ...state })).toBe(true);
    }
  });

  it("keeps explicit submit controls for private choices and complex responses", () => {
    const privateSnapshot = {
      ...snapshot,
      settings: { ...snapshot.settings, resultVisibility: "private" as const },
    };
    expect(participantResponseFooterVisible(privateSnapshot, idle)).toBe(true);
    for (const type of [
      "multi_select",
      "poll",
      "numeric",
      "rating",
      "ranking",
      "open_text",
      "word_cloud",
    ] as const) {
      for (const uxBeta of [true, false]) {
        const state = {
          ...snapshot,
          uxBeta,
          question: { ...snapshot.question!, type, maxSelections: 2 },
        };
        expect(participantResponseFooterVisible(state, idle)).toBe(true);
      }
    }
  });

  it("leaves accepted and closed receipts to their dedicated server-backed states", () => {
    expect(participantResponseFooterVisible(snapshot, { ...idle, saved: true })).toBe(false);
    for (const phase of ["question_locked", "question_reveal", "finished"] as const) {
      expect(
        participantResponseFooterVisible({ ...snapshot, phase }, { ...idle, pending: true }),
      ).toBe(false);
    }
    expect(participantResponseFooterVisible(null, idle)).toBe(false);
  });
});
