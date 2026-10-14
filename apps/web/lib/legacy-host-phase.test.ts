import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@openround/contracts";
import { getLegacyPhaseActions, getLegacyRecoveryActions } from "./legacy-host-phase";

function snapshot(patch: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    phase: "lobby",
    roundKind: "main",
    questionIndex: 0,
    questionPosition: null,
    questionCount: 2,
    question: null,
    ...patch,
  } as SessionSnapshot;
}

describe("legacy host phase controls", () => {
  it("keeps the original primary phase action sequence", () => {
    expect(getLegacyPhaseActions(snapshot({ phase: "question_locked" }))).toEqual([
      expect.objectContaining({ action: "reveal", label: "Reveal answer" }),
    ]);
    expect(
      getLegacyPhaseActions(
        snapshot({ phase: "question_reveal", questionIndex: 1, questionPosition: null }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "show_leaderboard", label: "Show standings" }),
        expect.objectContaining({ action: "next", label: "Finish round" }),
      ]),
    );
  });

  it("keeps revote and linked recheck available immediately after lock", () => {
    const actions = getLegacyRecoveryActions(
      snapshot({
        phase: "question_locked",
        intervention: null,
        question: { linkedRecheckAvailable: true } as SessionSnapshot["question"],
      }),
    );

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "intervention.start",
          interventionType: "peer_discussion",
        }),
        expect.objectContaining({ action: "recheck.open", recheckMode: "revote" }),
        expect.objectContaining({ action: "recheck.open", recheckMode: "linked" }),
      ]),
    );
  });

  it("keeps both interventions and rechecks available immediately after reveal", () => {
    const actions = getLegacyRecoveryActions(
      snapshot({
        phase: "question_reveal",
        intervention: null,
        question: { linkedRecheckAvailable: true } as SessionSnapshot["question"],
      }),
    );

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ interventionType: "explain", label: "Record explanation" }),
        expect.objectContaining({ interventionType: "example", label: "Work an example" }),
        expect.objectContaining({
          action: "recheck.open",
          label: "Recheck by revote",
          recheckMode: "revote",
        }),
        expect.objectContaining({
          action: "recheck.open",
          className: "button",
          recheckMode: "linked",
        }),
      ]),
    );
  });

  it("does not add recovery controls while already running a recheck", () => {
    expect(
      getLegacyRecoveryActions(snapshot({ phase: "question_reveal", roundKind: "revote" })),
    ).toEqual([]);
  });

  for (const type of ["open_text", "word_cloud"] as const) {
    it.each(["question_locked", "question_reveal"] as const)(
      `retains legal ${type} interventions without exposing rechecks during %s`,
      (phase) => {
        for (const finished of [false, true]) {
          const actions = getLegacyRecoveryActions(
            snapshot({
              phase,
              question: { type, linkedRecheckAvailable: true } as SessionSnapshot["question"],
              intervention: finished
                ? {
                    id: "00000000-0000-4000-8000-000000000003",
                    type: phase === "question_locked" ? "peer_discussion" : "example",
                    sourceRoundId: "00000000-0000-4000-8000-000000000002",
                    startedAt: "2026-01-01T00:00:00.000Z",
                    finishedAt: "2026-01-01T00:01:00.000Z",
                  }
                : null,
            }),
          );
          expect(actions.map((command) => command.interventionType)).toEqual(
            phase === "question_locked" ? ["peer_discussion"] : ["explain", "example"],
          );
          expect(actions.every((command) => command.action === "intervention.start")).toBe(true);
        }
      },
    );

    it.each([false, true])(
      `keeps the primary continue action for ${type} after intervention (final checkpoint: %s)`,
      (lastQuestion) => {
        const actions = getLegacyPhaseActions(
          snapshot({
            phase: "question_reveal",
            questionIndex: 2,
            questionPosition: 1,
            questionCount: lastQuestion ? 2 : 3,
            question: { type, linkedRecheckAvailable: false } as SessionSnapshot["question"],
            intervention: {
              id: "00000000-0000-4000-8000-000000000003",
              type: "example",
              sourceRoundId: "00000000-0000-4000-8000-000000000002",
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:01:00.000Z",
            },
          }),
        );
        expect(actions.find((command) => command.className === "button")).toMatchObject({
          action: "next",
          label: lastQuestion ? "Finish round" : "Next checkpoint",
        });
      },
    );
  }
});
