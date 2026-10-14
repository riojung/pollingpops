import { describe, expect, it } from "vitest";
import {
  participantProgressStage,
  participantRevealState,
  participantResponseControlsDisabled,
  participantResponseView,
  multipleSelectionPoll,
  togglePollSelection,
  legacyResponseRequiresSubmit,
} from "./participant-response";
import type { SessionSnapshot } from "@openround/contracts";

describe("participantResponseView", () => {
  it("restores the exact ordered ranking from a receipt and the authoritative snapshot", () => {
    const response = { kind: "ranking" as const, choiceIds: ["choice-c", "choice-a"] };
    expect(
      participantResponseView(
        null,
        null,
        { accepted: true, duplicate: false },
        { response, confidence: null },
      ),
    ).toMatchObject({
      saved: true,
      rankingChoiceIds: ["choice-c", "choice-a"],
      choiceIds: [],
      confidence: null,
    });
    expect(participantResponseView(response, null, null)).toMatchObject({
      rankingChoiceIds: ["choice-c", "choice-a"],
    });
    expect(legacyResponseRequiresSubmit({ type: "ranking", confidence: "off" })).toBe(true);
  });
  it("restores every saved poll selection after acknowledgement and reconnect", () => {
    const response = { kind: "poll" as const, choiceIds: ["choice-a", "choice-c"] };
    expect(
      participantResponseView(
        null,
        null,
        { accepted: true, duplicate: false },
        { response, confidence: null },
      ),
    ).toMatchObject({ saved: true, choiceIds: response.choiceIds, confidence: null });
    expect(participantResponseView(response, null, null)).toMatchObject({
      saved: true,
      choiceIds: response.choiceIds,
      confidence: null,
    });
  });
  it("rehydrates a durable choice receipt after reconnect", () => {
    expect(participantResponseView({ kind: "choice", choiceIds: ["choice-b"] }, 3, null)).toEqual({
      saved: true,
      choiceIds: ["choice-b"],
      rankingChoiceIds: [],
      numericValue: "",
      ratingValue: null,
      confidence: 3,
    });
  });

  it("uses an accepted acknowledgement until a snapshot arrives", () => {
    const view = participantResponseView(
      null,
      null,
      {
        accepted: true,
        duplicate: false,
      },
      {
        response: { kind: "numeric", value: "42", unit: "kg" },
        confidence: 3,
      },
    );
    expect(view).toMatchObject({ saved: true, numericValue: "42", confidence: 3 });
  });

  it("prefers the durable server response over the local acknowledgement receipt", () => {
    const view = participantResponseView(
      { kind: "rating", value: 4 },
      null,
      { accepted: true, duplicate: false },
      { response: { kind: "rating", value: 2 }, confidence: 3 },
    );
    expect(view).toMatchObject({ ratingValue: 4, confidence: null });
  });

  it("does not treat a rejected acknowledgement as saved", () => {
    const view = participantResponseView(
      undefined,
      undefined,
      {
        accepted: false,
        duplicate: false,
        code: "ANSWER_LATE",
      },
      { response: { kind: "rating", value: 5 }, confidence: null },
    );
    expect(view).toMatchObject({ saved: false, ratingValue: null });
  });

  it("locks every response control while a submission is pending", () => {
    expect(
      participantResponseControlsDisabled({
        questionOpen: true,
        saved: false,
        submitting: true,
      }),
    ).toBe(true);
    expect(
      participantResponseControlsDisabled({
        questionOpen: true,
        saved: false,
        submitting: false,
      }),
    ).toBe(false);
  });

  it("keeps response controls locked after a durable response is rehydrated", () => {
    expect(
      participantResponseControlsDisabled({
        questionOpen: true,
        saved: true,
        submitting: false,
      }),
    ).toBe(true);
  });
});

describe("live opinion poll selections", () => {
  it("requires explicit submission for multiple polls in the legacy player", () => {
    expect(
      legacyResponseRequiresSubmit({ type: "poll", maxSelections: 2, confidence: "off" }),
    ).toBe(true);
    expect(
      legacyResponseRequiresSubmit({ type: "poll", maxSelections: 1, confidence: "off" }),
    ).toBe(false);
    expect(legacyResponseRequiresSubmit({ type: "poll" })).toBe(false);
    expect(legacyResponseRequiresSubmit({ type: "multi_select", confidence: "off" })).toBe(true);
  });
  it("enforces the selection ceiling while allowing a selected option to be removed", () => {
    expect(togglePollSelection(["a", "b"], "c", 2)).toEqual(["a", "b"]);
    expect(togglePollSelection(["a", "b"], "a", 2)).toEqual(["b"]);
    expect(togglePollSelection(["b"], "c", 2)).toEqual(["b", "c"]);
  });

  it("keeps legacy single-choice polls separate from multiple-selection opinion polls", () => {
    expect(multipleSelectionPoll({ type: "poll" })).toBe(false);
    expect(multipleSelectionPoll({ type: "poll", maxSelections: 1 })).toBe(false);
    expect(multipleSelectionPoll({ type: "poll", maxSelections: 2 })).toBe(true);
    expect(multipleSelectionPoll({ type: "multi_select" })).toBe(false);
  });
});

describe("participantRevealState", () => {
  it("keeps post-reveal intervention feedback visible without an answer key", () => {
    expect(participantRevealState({ answerRevealed: true, myCorrect: false }, true)).toEqual({
      revealed: true,
      selectedCorrect: false,
      selectedIncorrect: true,
    });
  });

  it("does not expose a result during a pre-reveal intervention", () => {
    expect(participantRevealState({ answerRevealed: false, myCorrect: undefined }, true)).toEqual({
      revealed: false,
      selectedCorrect: false,
      selectedIncorrect: false,
    });
  });

  it("marks only the learner's selected response from their own correct result", () => {
    expect(participantRevealState({ answerRevealed: true, myCorrect: true }, true)).toMatchObject({
      selectedCorrect: true,
      selectedIncorrect: false,
    });
    expect(participantRevealState({ answerRevealed: true, myCorrect: true }, false)).toMatchObject({
      selectedCorrect: false,
      selectedIncorrect: false,
    });
  });
});

describe("participantProgressStage", () => {
  const stage = (
    phase: SessionSnapshot["phase"],
    roundKind: SessionSnapshot["roundKind"] = "main",
    saved = false,
  ) => participantProgressStage({ phase, roundKind } as SessionSnapshot, saved);

  it("maps the live recovery journey to compact participant stages", () => {
    expect(stage("lobby")).toBe("waiting");
    expect(stage("question_open")).toBe("answering");
    expect(stage("question_open", "main", true)).toBe("saved");
    expect(stage("intervention")).toBe("discussing");
    expect(stage("question_reveal")).toBe("reviewing");
    expect(stage("question_open", "linked_recheck")).toBe("rechecking");
    expect(stage("finished")).toBe("complete");
  });
});
