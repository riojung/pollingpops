import { describe, expect, it } from "vitest";
import type {
  PresentationParticipantQuestionBlock,
  PresentationOpinionResultSummary,
} from "@openround/contracts";
import {
  initialPresentationChoiceIds,
  presentationChoiceResponse,
  presentationOpinionSummaryFor,
  togglePresentationChoice,
  validPresentationChoiceSelection,
} from "./presentation-opinion-response";

const question: PresentationParticipantQuestionBlock["question"] = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "ranking",
  prompt: "Prioritize",
  confidence: "off",
  basePoints: 0,
  timeLimitSeconds: 20,
  mediaId: null,
  mediaAlt: null,
  choices: ["a", "b", "c"].map((id) => ({ id, label: id })),
};

describe("Presentation opinion response controls", () => {
  it("starts a full ranking in authored order, but never pretends a restored saved answer has that order", () => {
    expect(initialPresentationChoiceIds(question)).toEqual(["a", "b", "c"]);
    expect(initialPresentationChoiceIds(question, true)).toEqual([]);
    expect(initialPresentationChoiceIds({ ...question, rankCount: 2 })).toEqual([]);
  });
  it("requires the complete configured ranking with unique valid choices", () => {
    const partial = { ...question, rankCount: 2 };
    expect(validPresentationChoiceSelection(partial, ["c", "a"])).toBe(true);
    for (const ids of [[], ["a"], ["a", "a"], ["a", "b", "c"], ["a", "unknown"]])
      expect(validPresentationChoiceSelection(partial, ids)).toBe(false);
  });
  it("bounds a multiple poll while allowing deselection and replacement", () => {
    const poll = { ...question, type: "poll" as const, maxSelections: 2 };
    expect(togglePresentationChoice(poll, ["a", "b"], "c")).toEqual(["a", "b"]);
    expect(togglePresentationChoice(poll, ["a", "b"], "a")).toEqual(["b"]);
    expect(togglePresentationChoice(poll, ["b"], "c")).toEqual(["b", "c"]);
    expect(validPresentationChoiceSelection(poll, ["a"])).toBe(true);
  });
  it("preserves single-choice replacement and diagnostic multi-select semantics", () => {
    expect(togglePresentationChoice({ ...question, type: "poll" }, ["a"], "b")).toEqual(["b"]);
    expect(
      togglePresentationChoice({ ...question, type: "multi_select" }, ["a", "b"], "c"),
    ).toEqual(["a", "b", "c"]);
  });
  it("copies ranking order into its explicit payload without changing choice-set payloads", () => {
    const selected = ["c", "a"];
    expect(presentationChoiceResponse(question, selected)).toEqual({
      orderedChoiceIds: ["c", "a"],
    });
    expect(presentationChoiceResponse({ ...question, type: "poll" }, selected)).toEqual({
      choiceIds: ["c", "a"],
    });
    const response = presentationChoiceResponse(question, selected);
    selected.reverse();
    expect(response.orderedChoiceIds).toEqual(["c", "a"]);
  });
  it("reveals only a summary belonging to the current closed opinion block", () => {
    const summary: PresentationOpinionResultSummary = {
      kind: "poll",
      blockId: "block",
      responseCount: 0,
      maxSelections: 2,
      totalSelections: 0,
      choices: [],
    };
    const snapshot = {
      phase: "question_reveal",
      acceptingResponses: false,
      currentBlock: { id: "block", kind: "question", question: { type: "poll" } },
      opinionSummary: summary,
    };
    expect(presentationOpinionSummaryFor(snapshot)).toBe(summary);
    expect(presentationOpinionSummaryFor(null)).toBeUndefined();
    for (const patch of [
      { phase: "question_open" },
      { acceptingResponses: true },
      { currentBlock: null },
      { currentBlock: { ...snapshot.currentBlock, id: "old" } },
      { currentBlock: { ...snapshot.currentBlock, question: { type: "ranking" } } },
    ])
      expect(presentationOpinionSummaryFor({ ...snapshot, ...patch })).toBeUndefined();
  });
});
