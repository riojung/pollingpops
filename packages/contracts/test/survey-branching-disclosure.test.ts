import { describe, expect, it } from "vitest";
import {
  SURVEY_BRANCHING_DISCLOSURE_AGGREGATE_SCHEMA_VERSION,
  SURVEY_BRANCHING_DISCLOSURE_PRIVACY_POLICY,
  SurveyBranchingDisclosureResultsSchema,
  SurveyBranchingResultsInputError,
  analyzeSurveyBranchingFinalizedResponses,
  surveyBranchingDisclosureResults,
  surveyBranchingSuppressedResults,
} from "../src/survey-branching-results";
import { branchingId as id, surveyBranchingFixture } from "./support/survey-branching-fixture";

const poll = (...choices: number[]) => ({ kind: "poll", choiceIds: choices.map(id) });
const rating = (value: number) => ({ kind: "rating", value });
const finalized = (responses: unknown) => ({ finalized: true, responses });
const repeat = (count: number, responses: unknown) =>
  Array.from({ length: count }, () => finalized(structuredClone(responses)));
const rootOnly = () => ({ [id(1)]: poll(102) });
const parentOnly = () => ({ [id(1)]: poll(101), [id(2)]: poll(202) });
const nested = () => ({ [id(1)]: poll(101), [id(2)]: poll(201), [id(3)]: rating(4) });
const safePopulation = () => [
  ...repeat(5, rootOnly()),
  ...repeat(5, parentOnly()),
  ...repeat(5, nested()),
];

function multiSelectFixture(sameLabels = false) {
  const content = surveyBranchingFixture();
  const source = content.items[0]!.question;
  if (source.type !== "poll") throw new Error("Expected fixture poll");
  content.items[3]!.question = {
    ...source,
    id: id(4),
    prompt: "Choose up to two",
    maxSelections: 2,
    choices: [401, 402, 403].map((value) => ({
      id: id(value),
      label: sameLabels ? "Same label" : `Choice ${value}`,
      isCorrect: false,
    })),
  };
  return content;
}

function availableResult() {
  const result = surveyBranchingDisclosureResults(surveyBranchingFixture(), safePopulation(), true);
  if (result.resultsStatus !== "available") throw new Error("Expected qualified fixture");
  return result;
}

function expectWithheld(
  result: ReturnType<typeof surveyBranchingDisclosureResults>,
  status = "privacy_withheld",
) {
  expect(result.resultsStatus).toBe(status);
  expect(result).toMatchObject({ submittedCount: null, suppressed: true });
  for (const question of result.questions)
    expect(question).toMatchObject({
      eligibleCount: null,
      answeredCount: null,
      unansweredCount: null,
      skippedLogicCount: null,
      distribution: [],
      suppressed: true,
    });
  expect(SurveyBranchingDisclosureResultsSchema.safeParse(result).success).toBe(true);
}

describe("conditional Survey whole-report contribution-atom policy", () => {
  it("releases complete closed evidence when every full contribution pattern meets five", () => {
    const content = surveyBranchingFixture();
    const rows = safePopulation();
    const result = surveyBranchingDisclosureResults(content, rows, true);
    expect(result).toMatchObject({
      schemaVersion: 4,
      sourceSchemaVersion: 4,
      privacyPolicy: "joint_contribution_atoms_v1",
      minimumRespondents: 5,
      submittedCount: 15,
      suppressed: false,
      resultsStatus: "available",
    });
    expect(SURVEY_BRANCHING_DISCLOSURE_AGGREGATE_SCHEMA_VERSION).toBe(4);
    expect(SURVEY_BRANCHING_DISCLOSURE_PRIVACY_POLICY).toBe("joint_contribution_atoms_v1");
    expect(result.questions).toEqual(
      analyzeSurveyBranchingFinalizedResponses(content, rows).questions.map((question) => ({
        ...question,
        suppressed: false,
      })),
    );
    expect(result.questions[2]).toMatchObject({
      eligibleCount: 5,
      answeredCount: 5,
      unansweredCount: 0,
      skippedLogicCount: 10,
    });
    expect(result.questions[3]).toMatchObject({
      eligibleCount: 15,
      answeredCount: 0,
      unansweredCount: 15,
      skippedLogicCount: 0,
    });
    expect(surveyBranchingSuppressedResults(content, rows, true)).toMatchObject({
      schemaVersion: 3,
      submittedCount: null,
      resultsStatus: "privacy_review_required",
      suppressed: true,
    });
  });

  it.each([0, 1, 4])(
    "withholds an entire closed population of %s without revealing sample size",
    (size) => {
      expectWithheld(
        surveyBranchingDisclosureResults(surveyBranchingFixture(), repeat(size, rootOnly()), true),
      );
    },
  );

  it("releases exactly five identical valid contributions without deduplicating answers", () => {
    const result = surveyBranchingDisclosureResults(
      surveyBranchingFixture(),
      repeat(5, rootOnly()),
      true,
    );
    expect(result).toMatchObject({ resultsStatus: "available", submittedCount: 5 });
    expect(result.questions[0]).toMatchObject({
      answeredCount: 5,
      distribution: [
        { label: "Yes", count: 0 },
        { label: "No", count: 5 },
      ],
    });
  });

  it("withholds while collecting even when all atoms meet the minimum", () => {
    const content = surveyBranchingFixture();
    expectWithheld(surveyBranchingDisclosureResults(content, safePopulation()), "collecting");
    expect(surveyBranchingDisclosureResults(content, safePopulation())).toEqual(
      surveyBranchingDisclosureResults(content, [], false),
    );
    expectWithheld(
      surveyBranchingDisclosureResults(content, safePopulation(), {
        privacyApproved: true,
      } as unknown as boolean),
      "collecting",
    );
  });

  it("uses one generic withheld outcome for a rare bucket, a small branch, and a small total", () => {
    const content = surveyBranchingFixture();
    const rareBucket = [
      ...repeat(5, { ...rootOnly(), [id(4)]: rating(1) }),
      ...repeat(4, { ...rootOnly(), [id(4)]: rating(5) }),
    ];
    const smallBranch = [...repeat(5, rootOnly()), ...repeat(4, nested())];
    const baseline = surveyBranchingDisclosureResults(content, [], true);
    for (const rows of [rareBucket, smallBranch, repeat(4, rootOnly())]) {
      const result = surveyBranchingDisclosureResults(content, rows, true);
      expectWithheld(result);
      expect(result).toEqual(baseline);
    }
  });

  it("checks complete optional-answer patterns rather than only question sample sizes", () => {
    const content = surveyBranchingFixture();
    const rows = [...repeat(5, { ...rootOnly(), [id(4)]: rating(3) }), ...repeat(4, rootOnly())];
    expect(analyzeSurveyBranchingFinalizedResponses(content, rows).questions[3]).toMatchObject({
      eligibleCount: 9,
      answeredCount: 5,
      unansweredCount: 4,
    });
    expectWithheld(surveyBranchingDisclosureResults(content, rows, true));
    expect(
      surveyBranchingDisclosureResults(content, [...rows, finalized(rootOnly())], true),
    ).toMatchObject({ resultsStatus: "available", submittedCount: 10 });
  });

  it("keeps full multi-selection sets separate even with duplicate authored labels", () => {
    const content = multiSelectFixture(true);
    const rows = [
      ...repeat(4, { ...rootOnly(), [id(4)]: poll(401, 402) }),
      ...repeat(4, { ...rootOnly(), [id(4)]: poll(401, 403) }),
      ...repeat(4, { ...rootOnly(), [id(4)]: poll(402, 403) }),
    ];
    expect(
      analyzeSurveyBranchingFinalizedResponses(content, rows).questions[3]!.distribution.map(
        (bucket) => bucket.count,
      ),
    ).toEqual([8, 8, 8]);
    expectWithheld(surveyBranchingDisclosureResults(content, rows, true));
  });

  it("releases multi-selection counts using answered respondents and eligible coverage", () => {
    const content = multiSelectFixture();
    const rows = [
      ...repeat(5, { ...rootOnly(), [id(4)]: poll(402, 401) }),
      ...repeat(5, { ...rootOnly(), [id(4)]: poll(402, 403) }),
      ...repeat(5, rootOnly()),
    ];
    const result = surveyBranchingDisclosureResults(content, rows, true);
    expect(result.resultsStatus).toBe("available");
    expect(result.questions[3]).toMatchObject({
      eligibleCount: 15,
      answeredCount: 10,
      unansweredCount: 5,
      maxSelections: 2,
      distributionPercentBasis: "answered_respondents",
      responseCoverageBasis: "eligible_submissions",
      distribution: [
        { label: "Choice 401", count: 5 },
        { label: "Choice 402", count: 10 },
        { label: "Choice 403", count: 5 },
      ],
    });
  });

  it("releases exact zero cohorts only in a qualified closed report without inventing percentages", () => {
    const result = surveyBranchingDisclosureResults(
      surveyBranchingFixture(),
      repeat(5, rootOnly()),
      true,
    );
    expect(result.resultsStatus).toBe("available");
    expect(result.questions[1]).toMatchObject({
      eligibleCount: 0,
      answeredCount: 0,
      unansweredCount: 0,
      skippedLogicCount: 5,
      distribution: [
        { label: "Yes", count: 0 },
        { label: "No", count: 0 },
      ],
    });
    expect(result.questions[3]).toMatchObject({
      eligibleCount: 5,
      answeredCount: 0,
      unansweredCount: 5,
      skippedLogicCount: 0,
    });
    for (const question of result.questions) {
      expect(question).not.toHaveProperty("coveragePercent");
      expect(question).not.toHaveProperty("distributionPercent");
    }
  });

  it("does not mistake a net arithmetic difference for the cardinality of a cohort", () => {
    const result = surveyBranchingDisclosureResults(
      surveyBranchingFixture(),
      [...repeat(6, rootOnly()), ...repeat(5, parentOnly())],
      true,
    );
    expect(result).toMatchObject({ resultsStatus: "available", submittedCount: 11 });
    expect(result.questions[0]!.distribution.map((bucket) => bucket.count)).toEqual([5, 6]);
  });

  it("is deterministic under input/selection permutations and does not mutate or alias input", () => {
    const content = multiSelectFixture();
    const rows = repeat(5, { ...rootOnly(), [id(4)]: poll(402, 401) });
    const before = structuredClone({ content, rows });
    const result = surveyBranchingDisclosureResults(content, rows, true);
    const reordered = repeat(5, { [id(4)]: poll(401, 402), ...rootOnly() });
    expect(surveyBranchingDisclosureResults(content, reordered.reverse(), true)).toEqual(result);
    result.questions[0]!.prompt = "Changed result";
    expect({ content, rows }).toEqual(before);
    expect(surveyBranchingDisclosureResults(content, rows, true).questions[0]!.prompt).toBe(
      before.content.items[0]!.question.prompt,
    );
  });

  it("normalizes every raw map once and uses that exact stable population for atoms and counts", () => {
    let reads = 0;
    const rows = Array.from({ length: 5 }, () => {
      let rowReads = 0;
      return finalized({
        get [id(1)]() {
          reads++;
          return ++rowReads === 1 ? poll(102) : poll(101);
        },
      });
    });
    const result = surveyBranchingDisclosureResults(surveyBranchingFixture(), rows, true);
    expect(reads).toBe(5);
    expect(result).toMatchObject({ resultsStatus: "available", submittedCount: 5 });
    expect(result.questions[1]).toMatchObject({
      eligibleCount: 0,
      answeredCount: 0,
      skippedLogicCount: 5,
    });
  });

  it("retains typed payload-free errors and rejects invalid batches even while collecting", () => {
    for (const rows of [
      [{ finalized: false, responses: rootOnly() }],
      [{ finalized: true, responses: rootOnly(), alias: "PRIVATE_ALIAS" }],
      [finalized({ ...rootOnly(), [id(3)]: rating(4) })],
      [finalized({ [id(1)]: poll(101) })],
      [finalized({ ...rootOnly(), [id(999)]: { secret: "PRIVATE_UNKNOWN" } })],
      [finalized({ ...rootOnly(), [id(4)]: rating(99) })],
    ]) {
      for (const closed of [false, true]) {
        try {
          surveyBranchingDisclosureResults(surveyBranchingFixture(), rows, closed);
          expect.fail("Expected invalid submissions to fail");
        } catch (error) {
          expect(error).toBeInstanceOf(SurveyBranchingResultsInputError);
          expect(error).toMatchObject({ code: "INVALID_SURVEY_BRANCHING_SUBMISSIONS" });
          expect(error).not.toHaveProperty("cause");
          expect(String(error)).not.toContain("PRIVATE");
          expect(JSON.stringify(error)).not.toMatch(/PRIVATE|rowIndex|questionId|responses/);
        }
      }
    }
    expect(() =>
      surveyBranchingDisclosureResults({ ...surveyBranchingFixture(), schemaVersion: 5 }, [], true),
    ).toThrow(SurveyBranchingResultsInputError);
  });
});

describe("conditional Survey disclosure DTO structural constraints", () => {
  it("rejects mixtures, unknown evidence/diagnostics, versions, policies, and duplicate question IDs", () => {
    const available = availableResult();
    const withheld = surveyBranchingDisclosureResults(surveyBranchingFixture(), [], true);
    for (const change of [
      { schemaVersion: 3 },
      { sourceSchemaVersion: 3 },
      { privacyPolicy: "joint_contribution_atoms_v2" },
      { minimumRespondents: 4 },
      { privacyApproved: true },
      { atomCount: 3 },
      { atomSignatures: [] },
      { responses: [] },
      { suppressed: true },
      { submittedCount: null },
      { questions: [] },
      { questions: [...available.questions, available.questions[0]] },
      { questions: [withheld.questions[0], ...available.questions.slice(1)] },
    ])
      expect(
        SurveyBranchingDisclosureResultsSchema.safeParse({ ...available, ...change }).success,
      ).toBe(false);
    for (const change of [
      { submittedCount: 0 },
      { suppressed: false },
      { resultsStatus: "available" },
      { resultsStatus: "insufficient_sample" },
      { questions: [available.questions[0], ...withheld.questions.slice(1)] },
      { failedCohort: "PRIVATE_COHORT" },
    ])
      expect(
        SurveyBranchingDisclosureResultsSchema.safeParse({ ...withheld, ...change }).success,
      ).toBe(false);
  });

  it("enforces nonzero minimums, count partitions, single-response sums, and bucket bounds", () => {
    const available = availableResult();
    const first = available.questions[0]!;
    for (const change of [
      { eligibleCount: 4 },
      { answeredCount: 4 },
      { unansweredCount: 4 },
      { skippedLogicCount: 4 },
      { answeredCount: 10 },
      { eligibleCount: 10 },
      { skippedLogicCount: 5 },
      { suppressed: true },
      { answeredCount: Number.MAX_SAFE_INTEGER + 1 },
      { eligibleCount: 15.5 },
      {
        distribution: [
          { label: "Yes", count: 10 },
          { label: "No", count: 10 },
        ],
      },
      {
        distribution: [
          { label: "Yes", count: 20 },
          { label: "No", count: 0 },
        ],
      },
      {
        distribution: [
          { label: "Yes", count: 11 },
          { label: "No", count: 4 },
        ],
      },
      { distribution: [] },
      { maxSelections: 3 },
      { responseCoverageBasis: "all_submissions" },
      { distributionPercentBasis: "selections" },
      { coveragePercent: 100 },
      { branchTrace: [] },
    ])
      expect(
        SurveyBranchingDisclosureResultsSchema.safeParse({
          ...available,
          questions: [{ ...first, ...change }, ...available.questions.slice(1)],
        }).success,
      ).toBe(false);
    const ratingQuestion = available.questions[2]!;
    expect(
      SurveyBranchingDisclosureResultsSchema.safeParse({
        ...available,
        questions: [
          available.questions[0],
          available.questions[1],
          {
            ...ratingQuestion,
            distribution: ratingQuestion.distribution.map((bucket, index) => ({
              ...bucket,
              count: index === 0 ? 5 : bucket.count,
            })),
          },
          available.questions[3],
        ],
      }).success,
    ).toBe(false);
  });

  it("enforces multi-selection mass within the answered sample and selection limit", () => {
    const content = multiSelectFixture();
    const result = surveyBranchingDisclosureResults(
      content,
      [
        ...repeat(5, { ...rootOnly(), [id(4)]: poll(401, 402) }),
        ...repeat(5, { ...rootOnly(), [id(4)]: poll(402, 403) }),
      ],
      true,
    );
    if (result.resultsStatus !== "available") throw new Error("Expected qualified fixture");
    const question = result.questions[3]!;
    for (const counts of [
      [5, 0, 0],
      [10, 10, 5],
    ])
      expect(
        SurveyBranchingDisclosureResultsSchema.safeParse({
          ...result,
          questions: [
            ...result.questions.slice(0, 3),
            {
              ...question,
              distribution: question.distribution.map((bucket, index) => ({
                ...bucket,
                count: counts[index],
              })),
            },
          ],
        }).success,
      ).toBe(false);
  });
});
