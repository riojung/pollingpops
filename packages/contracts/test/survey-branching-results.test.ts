import { describe, expect, it } from "vitest";
import {
  PROPOSED_SURVEY_BRANCHING_AGGREGATE_SCHEMA_VERSION,
  SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS,
  SURVEY_BRANCHING_RESULTS_SOURCE_SCHEMA_VERSION,
  SurveyBranchingResultsInputError,
  SurveyBranchingSuppressedQuestionSchema,
  SurveyBranchingSuppressedResultsSchema,
  analyzeSurveyBranchingFinalizedResponses,
  surveyBranchingSuppressedResults,
  type SurveyBranchingResultsInputErrorCode,
} from "../src/survey-branching-results";
import { branchingId as id, surveyBranchingFixture } from "./support/survey-branching-fixture";

const poll = (...choices: number[]) => ({ kind: "poll", choiceIds: choices.map(id) });
const rating = (value: number) => ({ kind: "rating", value });
const finalized = (responses: unknown) => ({ finalized: true, responses });

function submissions() {
  return [
    finalized({ [id(1)]: poll(101), [id(2)]: poll(201), [id(3)]: rating(4), [id(4)]: rating(2) }),
    finalized({ [id(1)]: poll(101), [id(2)]: poll(202) }),
    finalized({ [id(1)]: poll(102), [id(4)]: rating(5) }),
  ];
}

function expectInputError(run: () => unknown, code: SurveyBranchingResultsInputErrorCode) {
  try {
    run();
    expect.fail("Expected the input to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(SurveyBranchingResultsInputError);
    expect(error).toMatchObject({ code, name: "SurveyBranchingResultsInputError" });
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toHaveProperty("issues");
    expect(error).not.toHaveProperty("responses");
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE|questionId|pageId|rowIndex|attemptId/);
    expect(String(error)).not.toContain("PRIVATE");
  }
}

describe("conditional Survey finalized aggregate analysis", () => {
  it("derives aggregate-only counts from final eligibility with cascading branches", () => {
    const analysis = analyzeSurveyBranchingFinalizedResponses(
      surveyBranchingFixture(),
      submissions(),
    );
    expect(analysis.submittedCount).toBe(3);
    expect(analysis.questions.map((question) => question.id)).toEqual([id(1), id(2), id(3), id(4)]);
    expect(
      analysis.questions.map(
        ({ eligibleCount, answeredCount, unansweredCount, skippedLogicCount }) => ({
          eligibleCount,
          answeredCount,
          unansweredCount,
          skippedLogicCount,
        }),
      ),
    ).toEqual([
      { eligibleCount: 3, answeredCount: 3, unansweredCount: 0, skippedLogicCount: 0 },
      { eligibleCount: 2, answeredCount: 2, unansweredCount: 0, skippedLogicCount: 1 },
      { eligibleCount: 1, answeredCount: 1, unansweredCount: 0, skippedLogicCount: 2 },
      { eligibleCount: 3, answeredCount: 2, unansweredCount: 1, skippedLogicCount: 0 },
    ]);
    expect(analysis.questions[0]!.distribution).toEqual([
      { label: "Yes", count: 2 },
      { label: "No", count: 1 },
    ]);
    expect(analysis.questions[2]!.distribution).toEqual(
      [1, 2, 3, 4, 5].map((value) => ({ label: String(value), count: value === 4 ? 1 : 0 })),
    );
    for (const question of analysis.questions) {
      expect(question.eligibleCount).toBe(question.answeredCount + question.unansweredCount);
      expect(analysis.submittedCount).toBe(question.eligibleCount + question.skippedLogicCount);
      expect(question.distributionPercentBasis).toBe("answered_respondents");
      expect(question.responseCoverageBasis).toBe("eligible_submissions");
    }
    expect(Object.keys(analysis)).toEqual(["submittedCount", "questions"]);
    expect(JSON.stringify(analysis)).not.toMatch(
      /visiblePageIds|eligibleQuestionIds|responses|finalized|rowIndex|timestamp|alias|credential/,
    );
  });

  it("distinguishes optional eligible nonresponse from questions skipped by logic", () => {
    const content = surveyBranchingFixture();
    content.items[2]!.required = false;
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, [
      finalized({ [id(1)]: poll(101), [id(2)]: poll(201) }),
      finalized({ [id(1)]: poll(102) }),
    ]);
    expect(analysis.questions[2]).toMatchObject({
      eligibleCount: 1,
      answeredCount: 0,
      unansweredCount: 1,
      skippedLogicCount: 1,
    });
    expect(analysis.questions[3]).toMatchObject({
      eligibleCount: 2,
      answeredCount: 0,
      unansweredCount: 2,
      skippedLogicCount: 0,
    });
  });

  it("keeps multi-selection distributions respondent-based rather than selection-based", () => {
    const content = surveyBranchingFixture();
    const controller = content.items[0]!.question;
    if (controller.type !== "poll") throw new Error("Expected fixture poll");
    content.items[3]!.question = {
      ...controller,
      id: id(4),
      prompt: "Choose up to two",
      maxSelections: 2,
      choices: [401, 402, 403].map((value) => ({
        id: id(value),
        label: `Option ${value}`,
        isCorrect: false,
      })),
    };
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, [
      finalized({ [id(1)]: poll(102), [id(4)]: poll(402, 401) }),
      finalized({ [id(1)]: poll(102), [id(4)]: poll(403, 402) }),
      finalized({ [id(1)]: poll(102) }),
    ]);
    const question = analysis.questions[3]!;
    expect(question).toMatchObject({
      type: "poll",
      maxSelections: 2,
      eligibleCount: 3,
      answeredCount: 2,
      unansweredCount: 1,
      distributionPercentBasis: "answered_respondents",
      responseCoverageBasis: "eligible_submissions",
    });
    expect(question.distribution.map((bucket) => bucket.count)).toEqual([1, 2, 1]);
    expect(question.distribution.reduce((total, bucket) => total + bucket.count, 0)).toBe(4);
    expect(analysis.questions[0]).toHaveProperty("maxSelections", 1);
    expect(analysis.questions[2]).not.toHaveProperty("maxSelections");
  });

  it("preserves zero buckets and zero denominators for internal empty-population qualification", () => {
    const analysis = analyzeSurveyBranchingFinalizedResponses(surveyBranchingFixture(), []);
    expect(analysis.submittedCount).toBe(0);
    for (const question of analysis.questions) {
      expect(question).toMatchObject({
        eligibleCount: 0,
        answeredCount: 0,
        unansweredCount: 0,
        skippedLogicCount: 0,
      });
      expect(question.distribution.every((bucket) => bucket.count === 0)).toBe(true);
    }
    const noBranches = analyzeSurveyBranchingFinalizedResponses(surveyBranchingFixture(), [
      finalized({ [id(1)]: poll(102) }),
    ]);
    expect(noBranches.questions[1]).toMatchObject({
      eligibleCount: 0,
      answeredCount: 0,
      unansweredCount: 0,
      skippedLogicCount: 1,
    });
  });

  it("handles the established maximum of 100 questions across 20 pages", () => {
    const source = surveyBranchingFixture();
    const items = Array.from({ length: 100 }, (_, index) => ({
      required: false,
      question: { ...source.items[3]!.question, id: id(1000 + index) },
    }));
    const content = {
      ...source,
      items,
      pages: Array.from({ length: 20 }, (_, index) => ({
        id: id(2000 + index),
        questionIds: items.slice(index * 5, index * 5 + 5).map((item) => item.question.id),
      })),
    };
    const rows = [
      finalized(Object.fromEntries(items.map((item) => [item.question.id, rating(3)]))),
    ];
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, rows);
    expect(analysis.questions).toHaveLength(100);
    expect(
      analysis.questions.every(
        (question) =>
          question.eligibleCount === 1 &&
          question.answeredCount === 1 &&
          question.unansweredCount === 0 &&
          question.skippedLogicCount === 0,
      ),
    ).toBe(true);
    expect(surveyBranchingSuppressedResults(content, rows, true).questions).toHaveLength(100);
  });

  it("is deterministic, order-independent across submissions, and does not alias inputs or outputs", () => {
    const content = surveyBranchingFixture();
    const rows = submissions();
    const before = structuredClone({ content, rows });
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, rows);
    expect(analyzeSurveyBranchingFinalizedResponses(content, [...rows].reverse())).toEqual(
      analysis,
    );
    const projected = surveyBranchingSuppressedResults(content, rows, true);
    expect(JSON.stringify(surveyBranchingSuppressedResults(content, rows, true))).toBe(
      JSON.stringify(projected),
    );
    analysis.questions[0]!.distribution[0]!.count = 999;
    analysis.questions[0]!.prompt = "Changed output";
    projected.questions[0]!.prompt = "Changed transport";
    expect({ content, rows }).toEqual(before);
    expect(
      analyzeSurveyBranchingFinalizedResponses(content, rows).questions[0]!.distribution[0]!.count,
    ).toBe(2);
  });
});

describe("conditional Survey result input boundaries", () => {
  it.each([
    null,
    {},
    "PRIVATE_CONTENT",
    { ...surveyBranchingFixture(), schemaVersion: 3 },
    { ...surveyBranchingFixture(), schemaVersion: 5 },
    { ...surveyBranchingFixture(), title: "" },
    { ...surveyBranchingFixture(), privateMetadata: "PRIVATE_CONTENT" },
  ])(
    "rejects invalid, unpublished, legacy, and future content without parser payloads",
    (content) => {
      for (const project of [
        analyzeSurveyBranchingFinalizedResponses,
        surveyBranchingSuppressedResults,
      ])
        expectInputError(() => project(content, []), "INVALID_SURVEY_BRANCHING_CONTENT");
    },
  );

  it.each([
    null,
    {},
    "PRIVATE_SUBMISSIONS",
    [{ responses: {} }],
    [{ finalized: false, responses: {} }],
    [{ finalized: true }],
    [{ finalized: true, responses: {}, participantId: "PRIVATE_PERSON" }],
    [{ [id(1)]: poll(102) }],
    [finalized({ [id(1)]: poll(101) })],
    [finalized({ [id(1)]: poll(102), [id(2)]: poll(201) })],
    [finalized({ [id(1)]: poll(102), [id(3)]: { secret: "PRIVATE_HIDDEN" } })],
    [finalized({ [id(1)]: poll(102), [id(999)]: { secret: "PRIVATE_UNKNOWN" } })],
    [finalized({ [id(1)]: rating(3) })],
    [finalized({ [id(1)]: poll(999) })],
    [finalized({ [id(1)]: poll(101, 102) })],
    [finalized({ [id(1)]: poll(102), [id(4)]: rating(99) })],
    [finalized({ [id(1)]: poll(102), [id(4)]: null })],
    [finalized({ [id(1)]: poll(102), [id(4)]: undefined })],
    [finalized({ [id(1)]: { ...poll(102), privateMetadata: "PRIVATE_ANSWER" } })],
    [finalized({ [id(1)]: poll(102) }), finalized({ [id(1)]: poll(101) })],
  ])(
    "rejects an invalid finalized batch without pruning, filtering, or emitting row details",
    (rows) => {
      for (const project of [
        analyzeSurveyBranchingFinalizedResponses,
        surveyBranchingSuppressedResults,
      ])
        expectInputError(
          () => project(surveyBranchingFixture(), rows),
          "INVALID_SURVEY_BRANCHING_SUBMISSIONS",
        );
    },
  );

  it("rejects duplicate source questions before analyzing responses", () => {
    const content = surveyBranchingFixture();
    content.items[3]!.question.id = id(3);
    expectInputError(
      () => analyzeSurveyBranchingFinalizedResponses(content, []),
      "INVALID_SURVEY_BRANCHING_CONTENT",
    );
  });

  it("replaces exceptions thrown by unknown input objects with payload-free typed errors", () => {
    const content = {
      get schemaVersion() {
        throw new Error("PRIVATE_CONTENT_GETTER");
      },
    };
    expectInputError(
      () => analyzeSurveyBranchingFinalizedResponses(content, []),
      "INVALID_SURVEY_BRANCHING_CONTENT",
    );
    const rows = [
      {
        finalized: true,
        get responses() {
          throw new Error("PRIVATE_RESPONSE_GETTER");
        },
      },
    ];
    expectInputError(
      () => surveyBranchingSuppressedResults(surveyBranchingFixture(), rows),
      "INVALID_SURVEY_BRANCHING_SUBMISSIONS",
    );
  });

  it("reads unknown answers once, then validates and counts that exact normalized map", () => {
    for (const project of [
      analyzeSurveyBranchingFinalizedResponses,
      surveyBranchingSuppressedResults,
    ]) {
      let reads = 0;
      const responses = {
        get [id(1)]() {
          return ++reads === 1 ? poll(102) : poll(101);
        },
      };
      const result = project(surveyBranchingFixture(), [finalized(responses)]);
      expect(reads).toBe(1);
      expect(result.questions[1]!.eligibleCount).toBe(result.submittedCount === null ? null : 0);
      expect(result.questions[1]!.answeredCount).toBe(result.submittedCount === null ? null : 0);
    }
  });
});

describe("proposed conditional Survey suppressed result contract", () => {
  it("uses independent aggregate/source versions and withholds every population-dependent field", () => {
    expect(PROPOSED_SURVEY_BRANCHING_AGGREGATE_SCHEMA_VERSION).toBe(3);
    expect(SURVEY_BRANCHING_RESULTS_SOURCE_SCHEMA_VERSION).toBe(4);
    expect(SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS).toBe(5);
    const content = surveyBranchingFixture();
    const collecting = surveyBranchingSuppressedResults(content, submissions());
    const closed = surveyBranchingSuppressedResults(content, submissions(), true);
    expect(collecting).toMatchObject({
      schemaVersion: 3,
      sourceSchemaVersion: 4,
      title: content.title,
      resultsStatus: "collecting",
      minimumRespondents: 5,
      submittedCount: null,
      suppressed: true,
    });
    expect(closed).toEqual({ ...collecting, resultsStatus: "privacy_review_required" });
    for (const question of closed.questions)
      expect(question).toMatchObject({
        eligibleCount: null,
        answeredCount: null,
        unansweredCount: null,
        skippedLogicCount: null,
        distribution: [],
        suppressed: true,
      });
    expect(SurveyBranchingSuppressedResultsSchema.parse(closed)).toEqual(closed);
    expect(JSON.stringify(closed)).not.toMatch(
      /visibleWhen|choiceId|questionIds|pages|responses|receipt|finalized/,
    );
  });

  it("rejects injected evidence, released status, unknown fields, and duplicate question IDs", () => {
    const valid = surveyBranchingSuppressedResults(surveyBranchingFixture(), [], true);
    for (const change of [
      { submittedCount: 0 },
      { submittedCount: 5 },
      { suppressed: false },
      { schemaVersion: 2 },
      { sourceSchemaVersion: 3 },
      { minimumRespondents: 4 },
      { resultsStatus: "available" },
      { privacyApproved: true },
      { participantIds: [] },
      { questions: [] },
      { questions: [...valid.questions, valid.questions[0]] },
    ])
      expect(
        SurveyBranchingSuppressedResultsSchema.safeParse({ ...valid, ...change }).success,
      ).toBe(false);
    const first = valid.questions[0]!;
    for (const change of [
      { eligibleCount: 0 },
      { answeredCount: 5 },
      { unansweredCount: 0 },
      { skippedLogicCount: 0 },
      { suppressed: false },
      { distribution: [{ label: "Yes", count: 5 }] },
      { distributionPercentBasis: "selections" },
      { responseCoverageBasis: "all_submissions" },
      { responseRows: [] },
      { maxSelections: 7 },
    ]) {
      expect(
        SurveyBranchingSuppressedQuestionSchema.safeParse({ ...first, ...change }).success,
      ).toBe(false);
      expect(
        SurveyBranchingSuppressedResultsSchema.safeParse({
          ...valid,
          questions: [{ ...first, ...change }, ...valid.questions.slice(1)],
        }).success,
      ).toBe(false);
    }
    expect(
      SurveyBranchingSuppressedQuestionSchema.safeParse({ ...valid.questions[2], maxSelections: 1 })
        .success,
    ).toBe(false);
  });
});
