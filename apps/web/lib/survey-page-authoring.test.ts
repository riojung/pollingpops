import { describe, expect, it } from "vitest";
import { SurveyContentSchema, SurveyDraftSchema } from "@openround/contracts/surveys";
import {
  addSurveyPage,
  addSurveyPageQuestion,
  convertSurveyToPages,
  moveSurveyPage,
  moveSurveyPageQuestion,
  removeSurveyPage,
  removeSurveyPageQuestion,
  surveyPageRemovalTarget,
  updateSurveyPage,
  updateSurveyPageQuestion,
  type PagedSurveyDraft,
} from "./survey-page-authoring";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const item = (value: number) => ({
  required: value % 2 === 0,
  question: {
    id: id(value),
    type: "rating" as const,
    prompt: `Question ${value}`,
    purpose: "opinion" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    basePoints: 0,
    timeLimitSeconds: 30,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
    min: 1,
    max: 5,
    minLabel: "Low",
    maxLabel: "High",
  },
});
const legacy = () =>
  SurveyDraftSchema.parse({
    schemaVersion: 2,
    title: "Feedback",
    items: [item(1), item(2), item(3)],
  });
function fixture() {
  let draft = convertSurveyToPages(legacy(), id(10));
  draft = addSurveyPage(draft, id(11));
  draft = addSurveyPage(draft, id(12));
  draft = moveSurveyPageQuestion(draft, id(2), id(11));
  return moveSurveyPageQuestion(draft, id(3), id(12));
}
function valid(draft: PagedSurveyDraft) {
  expect(SurveyDraftSchema.safeParse(draft).success).toBe(true);
  expect(draft.pages.flatMap((page) => page.questionIds)).toEqual(
    draft.items.map((row) => row.question.id),
  );
}

describe("Survey page authoring layout", () => {
  it("converts only explicitly, preserving all question content and stable IDs", () => {
    const source = legacy();
    const before = structuredClone(source);
    const draft = convertSurveyToPages(source, id(10));
    expect(source).toEqual(before);
    expect(source.schemaVersion).toBe(2);
    expect(draft).toMatchObject({
      schemaVersion: 3,
      items: source.items,
      pages: [{ id: id(10), title: "", description: "", questionIds: [id(1), id(2), id(3)] }],
    });
    expect(convertSurveyToPages(draft, id(99))).toBe(draft);
    valid(draft);
  });
  it("reorders pages and their flat items together without changing responses' question identities", () => {
    const before = fixture();
    const draft = moveSurveyPage(before, id(12), -1);
    expect(draft.pages.map((page) => page.id)).toEqual([id(10), id(12), id(11)]);
    expect(draft.items).toEqual([item(1), item(3), item(2)]);
    expect(before.items).toEqual([item(1), item(2), item(3)]);
    valid(draft);
  });
  it("merges a deleted first/middle/last page into its adjacent page and preserves every question", () => {
    for (const pageId of [id(10), id(11), id(12)]) {
      const before = fixture();
      const target = surveyPageRemovalTarget(before, pageId)!;
      const next = removeSurveyPage(before, pageId);
      expect(next.pages).toHaveLength(2);
      expect(next.pages.find((page) => page.id === target.id)!.questionIds).toHaveLength(2);
      expect(next.items).toEqual(before.items);
      expect(next.pages.some((page) => page.id === pageId)).toBe(false);
      valid(next);
    }
    const single = convertSurveyToPages(legacy(), id(10));
    expect(removeSurveyPage(single, id(10))).toBe(single);
    expect(surveyPageRemovalTarget(single, id(10))).toBeNull();
  });
  it("moves questions across and within pages, with explicit deletion as the only content removal", () => {
    let draft = fixture();
    draft = moveSurveyPageQuestion(draft, id(3), id(10));
    draft = moveSurveyPageQuestion(draft, id(3), id(10), 0);
    expect(draft.pages[0]!.questionIds).toEqual([id(3), id(1)]);
    expect(draft.pages[2]!.questionIds).toEqual([]);
    expect(draft.items).toEqual([item(3), item(1), item(2)]);
    valid(draft);
    draft = removeSurveyPageQuestion(draft, id(1));
    expect(draft.items).toEqual([item(3), item(2)]);
    valid(draft);
  });
  it("keeps raw title/instruction input and required edits without remapping question IDs", () => {
    let draft = fixture();
    draft = updateSurveyPage(draft, id(10), {
      title: "  Draft title  ",
      description: "First line\n  next line  ",
    });
    draft = updateSurveyPageQuestion(draft, id(1), { ...draft.items[0]!, required: true });
    expect(draft.pages[0]).toMatchObject({
      title: "  Draft title  ",
      description: "First line\n  next line  ",
    });
    expect(draft.items[0]!.required).toBe(true);
    expect(() => updateSurveyPageQuestion(draft, id(1), item(99))).toThrow("identity");
    valid(draft);
  });
  it("allows empty draft pages but never publishes them, and enforces page/question bounds", () => {
    let draft = convertSurveyToPages(legacy(), id(10));
    for (let value = 11; value < 30; value++) draft = addSurveyPage(draft, id(value));
    valid(draft);
    expect(SurveyContentSchema.safeParse(draft).success).toBe(false);
    expect(() => addSurveyPage(draft, id(30))).toThrow();
    let full = convertSurveyToPages(
      SurveyDraftSchema.parse({
        schemaVersion: 2,
        title: "Full",
        items: Array.from({ length: 100 }, (_, offset) => item(offset + 100)),
      }),
      id(10),
    );
    expect(() => addSurveyPageQuestion(full, id(10), item(999))).toThrow();
    full = removeSurveyPageQuestion(full, id(100));
    full = addSurveyPageQuestion(full, id(10), item(999));
    expect(full.items.at(-1)).toEqual(item(999));
    valid(full);
    expect(() => addSurveyPage(full, id(10))).toThrow();
  });
  it("preserves the partition through repeated layout moves and page deletions", () => {
    let draft = fixture();
    for (let turn = 0; turn < 30; turn++) {
      const questionId = draft.items[turn % draft.items.length]!.question.id;
      const destination = draft.pages[turn % draft.pages.length]!.id;
      draft = moveSurveyPageQuestion(draft, questionId, destination, turn % 2);
      draft = moveSurveyPage(draft, destination, turn % 2 ? -1 : 1);
      valid(draft);
      expect([...draft.items].sort((a, b) => a.question.id.localeCompare(b.question.id))).toEqual([
        item(1),
        item(2),
        item(3),
      ]);
    }
    while (draft.pages.length > 1) {
      draft = removeSurveyPage(draft, draft.pages[0]!.id);
      valid(draft);
    }
    expect(draft.items).toHaveLength(3);
  });
});
