import { describe, expect, it } from "vitest";
import {
  PROPOSED_SURVEY_BRANCHING_SCHEMA_VERSION,
  SurveyBranchingContentSchema,
  SurveyBranchingDraftSchema,
  reconcileSurveyBranchingResponses,
  surveyBranchingEligibility,
  surveyBranchingPageNavigation,
  surveyBranchingQuestionStates,
  surveyBranchingResumePageId,
  validateSurveyBranchingPageResponses,
  validateSurveyBranchingResponses,
} from "../src/survey-branching";
import {
  CURRENT_SURVEY_SCHEMA_VERSION,
  MAX_SUPPORTED_SURVEY_SCHEMA_VERSION,
  SurveyContentSchema,
  SurveyDraftSchema,
  SurveyResponsesSchema,
  upgradeSurveyDraft,
} from "../src/surveys";
import { branchingId as id, surveyBranchingFixture } from "./support/survey-branching-fixture";

const poll = (choice: number) => ({ kind: "poll", choiceIds: [id(choice)] });
const rating = (value = 4) => ({ kind: "rating", value });
const openResponses = () => ({ [id(1)]: poll(101), [id(2)]: poll(201) });

describe("isolated proposed Survey branching contract", () => {
  it("normalizes through the established v3 draft parser without mutating or aliasing its input", () => {
    const input = surveyBranchingFixture();
    input.title = "  Feedback  ";
    input.description = "  Introduction  ";
    input.pages[0]!.title = "  Before answering  ";
    input.pages[0]!.description = "  First line\n  Next line  ";
    const before = structuredClone(input);
    const parsed = SurveyBranchingDraftSchema.parse(input);
    expect(input).toEqual(before);
    expect(parsed).toMatchObject({
      schemaVersion: 4,
      title: "Feedback",
      description: "Introduction",
      pages: [{ title: "Before answering", description: "First line\n  Next line" }, {}, {}, {}],
    });
    expect(parsed.items).toEqual(input.items);
    expect(parsed.pages.flatMap((page) => page.questionIds)).toEqual(
      input.items.map((item) => item.question.id),
    );
    parsed.pages[0]!.questionIds.push(id(999));
    parsed.items[0]!.question.prompt = "Changed result";
    expect(input).toEqual(before);
  });

  it("keeps runtime v1-v3 parsing, upgrade targets and future-version rejection unchanged", () => {
    const proposed = surveyBranchingFixture();
    expect(PROPOSED_SURVEY_BRANCHING_SCHEMA_VERSION).toBe(4);
    expect(CURRENT_SURVEY_SCHEMA_VERSION).toBe(2);
    expect(MAX_SUPPORTED_SURVEY_SCHEMA_VERSION).toBe(3);
    expect(SurveyDraftSchema.safeParse(proposed).success).toBe(false);
    expect(SurveyContentSchema.safeParse(proposed).success).toBe(false);
    expect(() => upgradeSurveyDraft(proposed)).toThrow();
    for (const schemaVersion of [1, 2, 3]) {
      const legacy = {
        schemaVersion,
        title: proposed.title,
        description: proposed.description,
        category: proposed.category,
        experiencePreset: proposed.experiencePreset,
        items: proposed.items,
        ...(schemaVersion === 3
          ? { pages: proposed.pages.map(({ visibleWhen: _condition, ...page }) => page) }
          : {}),
      };
      const before = JSON.stringify(legacy);
      expect(JSON.stringify(SurveyDraftSchema.parse(legacy))).toBe(before);
      expect(JSON.stringify(upgradeSurveyDraft(legacy))).toBe(
        JSON.stringify({ ...legacy, schemaVersion: schemaVersion === 1 ? 2 : schemaVersion }),
      );
      expect(JSON.stringify(legacy)).toBe(before);
      expect(SurveyBranchingDraftSchema.safeParse(legacy).success).toBe(false);
    }
    expect(SurveyBranchingDraftSchema.safeParse({ ...proposed, schemaVersion: 5 }).success).toBe(
      false,
    );
  });

  it.each([
    { kind: "choice_equals", questionId: id(1), choiceId: id(101), nextPageId: id(14) },
    { kind: "choice_equals", questionId: id(1), choiceId: id(101), operator: "not" },
    { kind: "expression", expression: "answer != null" },
    { kind: "all", conditions: [] },
    { kind: "choice_equals", questionId: id(1), choiceId: id(101), any: [] },
    { kind: "choice_equals", questionId: "unknown", choiceId: id(101) },
    null,
    [],
  ])("rejects unsupported condition structures: %j", (visibleWhen) => {
    const draft = surveyBranchingFixture();
    expect(
      SurveyBranchingDraftSchema.safeParse({
        ...draft,
        pages: draft.pages.map((page, index) => (index === 1 ? { ...page, visibleWhen } : page)),
      }).success,
    ).toBe(false);
  });

  it("rejects first-page conditions, missing controllers, foreign choices, same-page and forward references", () => {
    const draft = surveyBranchingFixture();
    for (const [index, questionId, choiceId] of [
      [0, id(1), id(101)],
      [1, id(999), id(101)],
      [1, id(1), id(201)],
      [1, id(2), id(201)],
      [1, id(3), id(301)],
    ] as const)
      expect(
        SurveyBranchingDraftSchema.safeParse({
          ...draft,
          pages: draft.pages.map((page, offset) =>
            offset === index
              ? { ...page, visibleWhen: { kind: "choice_equals", questionId, choiceId } }
              : page,
          ),
        }).success,
      ).toBe(false);
    const cycle = structuredClone(draft);
    const controller = cycle.items[1]!.question;
    if (controller.type !== "poll") throw new Error("Expected poll");
    cycle.items[2]!.question = {
      ...controller,
      id: id(3),
      choices: controller.choices.map((choice, index) => ({ ...choice, id: id(301 + index) })),
    };
    cycle.pages[1]!.visibleWhen = { kind: "choice_equals", questionId: id(3), choiceId: id(301) };
    expect(SurveyBranchingDraftSchema.safeParse(cycle).success).toBe(false);
  });

  it("requires a single-choice poll controller and rejects answer conditions on ratings", () => {
    const multiple = surveyBranchingFixture();
    const gate = multiple.items[0]!.question;
    if (gate.type !== "poll") throw new Error("Expected poll");
    gate.maxSelections = 2;
    expect(SurveyBranchingDraftSchema.safeParse(multiple).success).toBe(false);
    const ratingController = surveyBranchingFixture();
    ratingController.pages[3]!.visibleWhen = {
      kind: "choice_equals",
      questionId: id(3),
      choiceId: id(301),
    };
    expect(SurveyBranchingDraftSchema.safeParse(ratingController).success).toBe(false);
  });

  it("inherits strict metadata, IDs, exact partitions and established page/question limits", () => {
    const draft = surveyBranchingFixture();
    for (const input of [
      { ...draft, branchTargets: [] },
      { ...draft, title: "x".repeat(161) },
      { ...draft, pages: [] },
      {
        ...draft,
        pages: Array.from({ length: 21 }, (_, index) => ({
          id: id(index + 1000),
          questionIds: index ? [] : draft.items.map((item) => item.question.id),
        })),
      },
      { ...draft, pages: draft.pages.map((page) => ({ ...page, privateNotes: "unsupported" })) },
      { ...draft, pages: draft.pages.map((page) => ({ ...page, description: "x".repeat(1001) })) },
      { ...draft, pages: draft.pages.map((page) => ({ ...page, id: id(999) })) },
      {
        ...draft,
        pages: draft.pages.map((page, index) =>
          index === 1 ? { ...page, questionIds: [id(1)] } : page,
        ),
      },
      {
        ...draft,
        pages: draft.pages.map((page, index) =>
          index === 1 ? { ...page, questionIds: [] } : page,
        ),
      },
      {
        ...draft,
        pages: draft.pages.map((page, index) =>
          index === 0 ? { ...page, questionIds: [id(999)] } : page,
        ),
      },
      { ...draft, items: [...draft.items].reverse() },
      {
        ...draft,
        items: Array.from({ length: 101 }, (_, index) => ({
          ...draft.items[2]!,
          question: { ...draft.items[2]!.question, id: id(index + 1000) },
        })),
      },
    ])
      expect(SurveyBranchingDraftSchema.safeParse(input).success).toBe(false);
    const empty = {
      schemaVersion: 4,
      title: "Draft",
      items: [],
      pages: [{ id: id(11), questionIds: [] }],
    };
    expect(SurveyBranchingDraftSchema.safeParse(empty).success).toBe(true);
    expect(SurveyBranchingContentSchema.safeParse(empty).success).toBe(false);
    const temporaryPage = { ...draft, pages: [...draft.pages, { id: id(15), questionIds: [] }] };
    expect(SurveyBranchingDraftSchema.safeParse(temporaryPage).success).toBe(true);
    expect(SurveyBranchingContentSchema.safeParse(temporaryPage).success).toBe(false);
  });
  it("accepts the existing maximum of 100 questions across 20 nonempty pages", () => {
    const draft = surveyBranchingFixture();
    const items = Array.from({ length: 100 }, (_, index) => ({
      ...draft.items[2]!,
      question: { ...draft.items[2]!.question, id: id(index + 1000) },
    }));
    const pages = Array.from({ length: 20 }, (_, index) => ({
      id: id(index + 2000),
      questionIds: items.slice(index * 5, index * 5 + 5).map((item) => item.question.id),
    }));
    const maximum = SurveyBranchingContentSchema.parse({ ...draft, items, pages });
    const responses = Object.fromEntries(items.map((item) => [item.question.id, rating()]));
    expect(surveyBranchingEligibility(maximum, responses).eligibleQuestionIds).toHaveLength(100);
    expect(validateSurveyBranchingResponses(maximum, responses, true)).toEqual([]);
    expect(
      SurveyBranchingDraftSchema.safeParse({
        ...maximum,
        items: [...items, { ...items[0]!, question: { ...items[0]!.question, id: id(9999) } }],
      }).success,
    ).toBe(false);
  });
});

describe("proposed Survey page eligibility and response cleanup", () => {
  it.each([undefined, null])(
    "treats an eligible own %j value as invalid instead of missing or answered",
    (value) => {
      const draft = surveyBranchingFixture();
      const responses = { ...openResponses(), [id(3)]: value };
      expect(validateSurveyBranchingResponses(draft, responses, true)).toEqual([
        { code: "invalid_response", questionId: id(3) },
      ]);
      expect(
        surveyBranchingQuestionStates(draft, responses).find((item) => item.questionId === id(3))
          ?.state,
      ).toBe("invalid");
      const cleaned = reconcileSurveyBranchingResponses(draft, responses);
      expect(Object.hasOwn(cleaned.responses, id(3))).toBe(true);
      expect(cleaned.responses[id(3)]).toBe(value);
    },
  );
  it("reveals pages in order and cascades hidden eligibility despite stale controller answers", () => {
    const draft = surveyBranchingFixture();
    expect(surveyBranchingEligibility(draft, {})).toEqual({
      visiblePageIds: [id(11), id(14)],
      eligibleQuestionIds: [id(1), id(4)],
    });
    expect(surveyBranchingEligibility(draft, { [id(1)]: poll(101) })).toEqual({
      visiblePageIds: [id(11), id(12), id(14)],
      eligibleQuestionIds: [id(1), id(2), id(4)],
    });
    expect(surveyBranchingEligibility(draft, openResponses())).toEqual({
      visiblePageIds: [id(11), id(12), id(13), id(14)],
      eligibleQuestionIds: [id(1), id(2), id(3), id(4)],
    });
    expect(
      surveyBranchingEligibility(draft, {
        [id(1)]: poll(102),
        [id(2)]: poll(201),
        [id(3)]: rating(),
      }),
    ).toEqual({ visiblePageIds: [id(11), id(14)], eligibleQuestionIds: [id(1), id(4)] });
    expect(surveyBranchingEligibility(draft, { [id(2)]: poll(201) }).visiblePageIds).toEqual([
      id(11),
      id(14),
    ]);
  });

  it.each([
    null,
    {},
    rating(),
    poll(999),
    { kind: "poll", choiceIds: [] },
    { kind: "poll", choiceIds: [id(101), id(102)] },
    { ...poll(101), privateExtra: true },
  ])("does not reveal branches for an invalid controller: %j", (value) => {
    const draft = surveyBranchingFixture();
    expect(surveyBranchingEligibility(draft, { [id(1)]: value }).visiblePageIds).toEqual([
      id(11),
      id(14),
    ]);
    expect(validateSurveyBranchingResponses(draft, { [id(1)]: value }, false)).toEqual([
      { code: "invalid_response", questionId: id(1) },
    ]);
  });

  it("clears hidden malformed answers without inspecting their payloads, and does not restore them on reopening", () => {
    const draft = surveyBranchingFixture();
    const hidden = () => {
      throw new Error("A hidden payload must not be inspected or cloned");
    };
    const raw = {
      [id(1)]: poll(102),
      [id(2)]: hidden,
      [id(3)]: { malformed: "PRIVATE_HIDDEN_VALUE" },
      [id(4)]: rating(),
    };
    const cleaned = reconcileSurveyBranchingResponses(draft, raw);
    expect(cleaned.responses).toEqual({ [id(1)]: poll(102), [id(4)]: rating() });
    expect(cleaned.clearedQuestionIds).toEqual([id(2), id(3)]);
    expect(raw[id(2)]).toBe(hidden);
    expect(validateSurveyBranchingResponses(draft, raw, true)).toEqual([
      { code: "ineligible_response", questionId: id(2) },
      { code: "ineligible_response", questionId: id(3) },
    ]);
    expect(validateSurveyBranchingResponses(draft, cleaned.responses, true)).toEqual([]);
    expect(SurveyResponsesSchema.parse(cleaned.responses)).toEqual(cleaned.responses);
    const reopened = reconcileSurveyBranchingResponses(draft, {
      ...cleaned.responses,
      [id(1)]: poll(101),
    });
    expect(reopened.responses).not.toHaveProperty(id(2));
    expect(reopened.responses).not.toHaveProperty(id(3));
    expect(reopened.visiblePageIds).toEqual([id(11), id(12), id(14)]);
    expect(validateSurveyBranchingResponses(draft, reopened.responses, true)).toEqual([
      { code: "required", questionId: id(2) },
    ]);
  });

  it("keeps unknown and eligible malformed values for explicit validation rather than approving cleaned input", () => {
    const draft = surveyBranchingFixture();
    const raw = {
      ...openResponses(),
      [id(3)]: { kind: "rating", value: 99, privateExtra: "PRIVATE_BAD_VALUE" },
      [id(999)]: { secret: "PRIVATE_UNKNOWN_VALUE" },
    };
    const before = structuredClone(raw);
    const cleaned = reconcileSurveyBranchingResponses(draft, raw);
    expect(cleaned.responses).toEqual(raw);
    expect(cleaned.clearedQuestionIds).toEqual([]);
    const issues = validateSurveyBranchingResponses(draft, cleaned.responses, true);
    expect(issues).toEqual([
      { code: "invalid_response", questionId: id(3) },
      { code: "unknown_question", questionId: id(999) },
    ]);
    expect(JSON.stringify(issues)).not.toMatch(/PRIVATE|secret|value|responseValue|answers/);
    expect(raw).toEqual(before);
    const changed = cleaned.responses[id(3)] as { value: number };
    changed.value = 3;
    expect(raw).toEqual(before);
    cleaned.visiblePageIds.pop();
    cleaned.eligibleQuestionIds.pop();
    expect(surveyBranchingEligibility(draft, raw).visiblePageIds).toHaveLength(4);
  });

  it("requires only eligible questions and distinguishes skipped, unanswered, invalid and answered without exposing values", () => {
    const draft = surveyBranchingFixture();
    expect(validateSurveyBranchingResponses(draft, {}, true)).toEqual([
      { code: "required", questionId: id(1) },
    ]);
    expect(validateSurveyBranchingResponses(draft, { [id(1)]: poll(102) }, true)).toEqual([]);
    expect(surveyBranchingQuestionStates(draft, { [id(1)]: poll(102), [id(3)]: rating() })).toEqual(
      [
        { questionId: id(1), state: "answered" },
        { questionId: id(2), state: "skipped_logic" },
        { questionId: id(3), state: "skipped_logic" },
        { questionId: id(4), state: "unanswered" },
      ],
    );
    expect(
      surveyBranchingQuestionStates(draft, {
        ...openResponses(),
        [id(3)]: rating(99),
        [id(4)]: rating(),
      }),
    ).toEqual([
      { questionId: id(1), state: "answered" },
      { questionId: id(2), state: "answered" },
      { questionId: id(3), state: "invalid" },
      { questionId: id(4), state: "answered" },
    ]);
    expect(
      validateSurveyBranchingResponses(draft, { ...openResponses(), [id(3)]: rating(99) }, true),
    ).toEqual([{ code: "invalid_response", questionId: id(3) }]);
  });

  it.each([
    null,
    [],
    "not a response map",
    { notUuid: rating() },
    Object.fromEntries(Array.from({ length: 101 }, (_, index) => [id(index + 1000), rating()])),
  ])("bounds response maps and rejects malformed root/key structure", (input) => {
    const draft = surveyBranchingFixture();
    expect(validateSurveyBranchingResponses(draft, input, false)).toEqual([
      { code: "invalid_response_map" },
    ]);
    expect(() => reconcileSurveyBranchingResponses(draft, input)).toThrow();
    expect(() => surveyBranchingEligibility(draft, input)).toThrow();
  });

  it("validates only visible-page requirements while rejecting ineligible or unknown cursors", () => {
    const draft = surveyBranchingFixture();
    expect(validateSurveyBranchingPageResponses(draft, {}, id(11))).toEqual([
      { code: "required", questionId: id(1) },
    ]);
    expect(validateSurveyBranchingPageResponses(draft, { [id(1)]: poll(101) }, id(11))).toEqual([]);
    expect(validateSurveyBranchingPageResponses(draft, { [id(1)]: poll(101) }, id(12))).toEqual([
      { code: "required", questionId: id(2) },
    ]);
    expect(validateSurveyBranchingPageResponses(draft, {}, id(12))).toEqual([
      { code: "ineligible_page", pageId: id(12) },
    ]);
    expect(validateSurveyBranchingPageResponses(draft, {}, id(999))).toEqual([
      { code: "unknown_page", pageId: id(999) },
    ]);
    expect(
      validateSurveyBranchingPageResponses(
        draft,
        { [id(1)]: poll(102), [id(2)]: poll(201) },
        id(14),
      ),
    ).toEqual([{ code: "ineligible_response", questionId: id(2) }]);
  });

  it("resumes only visible unanswered/invalid pages and recovers a cursor hidden by a branch change", () => {
    const draft = surveyBranchingFixture();
    const before = structuredClone(draft);
    expect(surveyBranchingResumePageId(draft, {})).toBe(id(11));
    expect(surveyBranchingResumePageId(draft, { [id(1)]: poll(101) })).toBe(id(12));
    expect(surveyBranchingResumePageId(draft, openResponses())).toBe(id(13));
    expect(surveyBranchingResumePageId(draft, { ...openResponses(), [id(3)]: rating() })).toBe(
      id(14),
    );
    expect(
      surveyBranchingResumePageId(draft, {
        ...openResponses(),
        [id(3)]: rating(99),
        [id(4)]: rating(),
      }),
    ).toBe(id(13));
    const shut = { [id(1)]: poll(102), [id(2)]: poll(201), [id(3)]: rating() };
    expect(surveyBranchingResumePageId(draft, shut)).toBe(id(14));
    expect(surveyBranchingPageNavigation(draft, shut, id(13))).toEqual({
      currentPageId: id(14),
      previousPageId: id(11),
      nextPageId: null,
    });
    expect(surveyBranchingPageNavigation(draft, shut, id(11))).toEqual({
      currentPageId: id(11),
      previousPageId: null,
      nextPageId: id(14),
    });
    expect(surveyBranchingPageNavigation(draft, {}, id(999))).toEqual({
      currentPageId: id(11),
      previousPageId: null,
      nextPageId: id(14),
    });
    expect(draft).toEqual(before);
  });
});
