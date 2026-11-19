import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CURRENT_SURVEY_SCHEMA_VERSION,
  MAX_SUPPORTED_SURVEY_SCHEMA_VERSION,
  MAX_SURVEY_PAGES,
  SurveyContentSchema,
  SurveyDraftSchema,
  surveyAggregate,
  surveyPageViews,
  surveyResumePageIndex,
  upgradeSurveyDraft,
  validateSurveyPageResponses,
  validateSurveyResponses,
  type SurveyResponses,
} from "../src/surveys";

function paged() {
  const items = Array.from({ length: 3 }, (_, index) => ({
    required: index !== 1,
    question: {
      id: randomUUID(),
      type: "rating",
      prompt: `How useful was step ${index + 1}?`,
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      min: 1,
      max: 5,
      minLabel: "Not useful",
      maxLabel: "Very useful",
      timeLimitSeconds: 30,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    },
  }));
  const value = SurveyContentSchema.parse({
    schemaVersion: 3,
    title: "Workshop feedback",
    items,
    pages: [
      {
        id: randomUUID(),
        title: "Experience",
        description: "Review the workshop.",
        questionIds: items.slice(0, 2).map((item) => item.question.id),
      },
      { id: randomUUID(), title: "Next steps", questionIds: [items[2]!.question.id] },
    ],
  });
  if (value.schemaVersion !== 3) throw new Error("Expected the page fixture");
  return value;
}

describe("ordered Survey page contracts", () => {
  it("expands readers while preserving ordinary writer defaults and legacy JSON order", () => {
    expect(CURRENT_SURVEY_SCHEMA_VERSION).toBe(2);
    expect(MAX_SUPPORTED_SURVEY_SCHEMA_VERSION).toBe(3);
    const base = SurveyDraftSchema.parse({
      schemaVersion: 2,
      title: "Feedback",
      items: paged().items,
    });
    for (const version of [1, 2] as const) {
      const input = { ...base, schemaVersion: version };
      const parsed = SurveyDraftSchema.parse(input);
      expect(Object.keys(parsed)).toEqual([
        "schemaVersion",
        "title",
        "description",
        "category",
        "experiencePreset",
        "items",
      ]);
      expect(parsed).not.toHaveProperty("pages");
      expect(upgradeSurveyDraft(input)).toEqual({ ...parsed, schemaVersion: 2 });
      expect(surveyPageViews(parsed)).toEqual([
        { id: null, title: "", description: "", items: parsed.items },
      ]);
      expect(input.schemaVersion).toBe(version);
    }
  });

  it("preserves v3 and published page metadata without mutating its input", () => {
    const input = paged(),
      before = structuredClone(input);
    expect(upgradeSurveyDraft(input)).toEqual(input);
    expect(SurveyContentSchema.parse(input)).toEqual(input);
    expect(
      surveyPageViews(input).map((page) => ({
        id: page.id,
        title: page.title,
        questionIds: page.items.map((item) => item.question.id),
      })),
    ).toEqual(
      input.pages.map((page) => ({
        id: page.id,
        title: page.title,
        questionIds: page.questionIds,
      })),
    );
    expect(input).toEqual(before);
  });

  it("requires pages only for v3 and rejects unimplemented branching and future versions", () => {
    const input = paged();
    const { pages, ...base } = input;
    for (const schemaVersion of [1, 2]) {
      expect(SurveyDraftSchema.safeParse({ ...base, schemaVersion, pages }).success).toBe(false);
      expect(
        SurveyDraftSchema.safeParse({ ...base, schemaVersion, pages: undefined }).success,
      ).toBe(false);
    }
    expect(SurveyDraftSchema.safeParse(base).success).toBe(false);
    expect(SurveyDraftSchema.safeParse({ ...input, schemaVersion: 4 }).success).toBe(false);
    expect(
      SurveyDraftSchema.safeParse({
        ...input,
        pages: [{ ...pages[0], condition: { questionId: input.items[0]!.question.id } }, pages[1]],
      }).success,
    ).toBe(false);
    expect(SurveyDraftSchema.safeParse({ ...input, branches: [] }).success).toBe(false);
  });

  it("rejects omitted, duplicated, dangling and reordered page references", () => {
    const input = paged();
    const ids = input.items.map((item) => item.question.id);
    for (const questionIds of [
      ids.slice(0, 2),
      [...ids, ids[0]!],
      [ids[0]!, ids[0]!, ids[2]!],
      [randomUUID(), ids[1]!, ids[2]!],
      [...ids].reverse(),
    ]) {
      expect(
        SurveyDraftSchema.safeParse({ ...input, pages: [{ ...input.pages[0], questionIds }] })
          .success,
      ).toBe(false);
    }
  });

  it("bounds page counts and metadata and requires unique stable page IDs", () => {
    const input = paged();
    expect(SurveyDraftSchema.safeParse({ ...input, pages: [] }).success).toBe(false);
    const many = [
      ...input.pages,
      ...Array.from({ length: MAX_SURVEY_PAGES - 2 }, () => ({
        id: randomUUID(),
        title: "",
        description: "",
        questionIds: [],
      })),
    ];
    expect(SurveyDraftSchema.safeParse({ ...input, pages: many }).success).toBe(true);
    expect(
      SurveyDraftSchema.safeParse({
        ...input,
        pages: [...many, { ...many[0], id: randomUUID(), questionIds: [] }],
      }).success,
    ).toBe(false);
    expect(
      SurveyDraftSchema.safeParse({
        ...input,
        pages: [input.pages[0], { ...input.pages[1], id: input.pages[0]!.id.toUpperCase() }],
      }).success,
    ).toBe(false);
    for (const change of [
      { title: "x".repeat(161) },
      { description: "x".repeat(1001) },
      { id: "unstable-page" },
    ])
      expect(
        SurveyDraftSchema.safeParse({
          ...input,
          pages: [{ ...input.pages[0], ...change }, input.pages[1]],
        }).success,
      ).toBe(false);
  });

  it("allows temporary empty authoring pages but rejects them at publication", () => {
    const input = paged();
    const empty = { ...input, pages: [...input.pages, { id: randomUUID(), questionIds: [] }] };
    expect(SurveyDraftSchema.safeParse(empty).success).toBe(true);
    expect(SurveyContentSchema.safeParse(empty).success).toBe(false);
    expect(
      SurveyDraftSchema.safeParse({
        ...input,
        items: [],
        pages: [{ id: randomUUID(), questionIds: [] }],
      }).success,
    ).toBe(true);
  });

  it("does not expand Survey response kinds or admit learning metadata", () => {
    const input = paged();
    for (const change of [
      { basePoints: 100 },
      { purpose: "diagnostic" },
      { confidence: "on" },
      { mediaId: randomUUID(), mediaAlt: "Private reference" },
      { conceptKeys: ["concept"] },
    ])
      expect(
        SurveyDraftSchema.safeParse({
          ...input,
          items: [
            { ...input.items[0], question: { ...input.items[0]!.question, ...change } },
            ...input.items.slice(1),
          ],
        }).success,
      ).toBe(false);
  });

  it("validates only the current page's required fields before Next and every page on Submit", () => {
    const input = paged();
    const ids = input.items.map((item) => item.question.id);
    const responses: SurveyResponses = { [ids[0]!]: { kind: "rating", value: 4 } };
    expect(validateSurveyPageResponses(input, responses, input.pages[0]!.id)).toEqual([]);
    expect(validateSurveyPageResponses(input, responses, input.pages[1]!.id)).toEqual([
      "Question 3: a response is required",
    ]);
    expect(validateSurveyResponses(input, responses, true)).toEqual([
      "Question 3: a response is required",
    ]);
    expect(validateSurveyPageResponses(input, responses, randomUUID())).toEqual([
      "Choose a valid Survey page",
    ]);
    const invalid: SurveyResponses = { ...responses, [ids[2]!]: { kind: "rating", value: 9 } };
    expect(validateSurveyPageResponses(input, invalid, input.pages[0]!.id)).toContain(
      "Question 3: select a valid response",
    );
    expect(
      validateSurveyResponses(
        input,
        { ...responses, [ids[2]!]: { kind: "rating", value: 2 } },
        true,
      ),
    ).toEqual([]);
  });

  it("derives resume from unanswered items, including optional items, without changing responses", () => {
    const input = paged();
    const responses: SurveyResponses = {};
    expect(surveyResumePageIndex(input, responses)).toBe(0);
    for (const item of [input.items[0]!, input.items[2]!])
      responses[item.question.id] = { kind: "rating", value: 4 };
    const before = JSON.stringify(responses);
    expect(surveyResumePageIndex(input, responses)).toBe(0);
    expect(JSON.stringify(responses)).toBe(before);
    responses[input.items[1]!.question.id] = { kind: "rating", value: 3 };
    expect(surveyResumePageIndex(input, responses)).toBe(1);
  });

  it("preserves aggregate-v2 question order, respondent denominators and suppression", () => {
    const input = paged();
    const flat = SurveyContentSchema.parse({
      schemaVersion: 2,
      title: input.title,
      items: input.items,
    });
    const responses = Array.from({ length: 5 }, () =>
      Object.fromEntries(
        input.items.map((item) => [item.question.id, { kind: "rating" as const, value: 4 }]),
      ),
    );
    for (const [rows, closed] of [
      [responses, false],
      [responses.slice(0, 4), true],
      [responses, true],
    ] as const) {
      const result = surveyAggregate(input, [...rows], closed);
      expect(result).toEqual(surveyAggregate(flat, [...rows], closed));
      expect(result.schemaVersion).toBe(2);
      expect(result).not.toHaveProperty("pages");
      expect(result.questions.map((question) => question.id)).toEqual(
        input.items.map((item) => item.question.id),
      );
    }
  });
});
