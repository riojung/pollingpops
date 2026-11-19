import { describe, expect, it } from "vitest";
import {
  analyzeSurveyBranchingFinalizedResponses,
  surveyBranchingSuppressedResults,
  SurveyBranchingSuppressedResultsSchema,
} from "../src/survey-branching-results";
import { SurveyBranchingContentSchema, type SurveyBranchingDraft } from "../src/survey-branching";
import type { SurveyResponses } from "../src/surveys";
import { branchingId as id, surveyBranchingFixture } from "./support/survey-branching-fixture";

type Submission = { finalized: true; responses: SurveyResponses };
const choice = (question: number, yes: boolean) => ({
  kind: "poll" as const,
  choiceIds: [id(question * 100 + (yes ? 1 : 2))],
});
const rating = (value = 4) => ({ kind: "rating" as const, value });
const repeat = (count: number, build: () => Submission) => Array.from({ length: count }, build);

function nestedSubmission(
  path: "closed" | "parent" | "nested",
  optionalAnswer = false,
): Submission {
  return {
    finalized: true,
    responses: {
      [id(1)]: choice(1, path !== "closed"),
      ...(path !== "closed" ? { [id(2)]: choice(2, path === "nested") } : {}),
      ...(path === "nested" ? { [id(3)]: rating() } : {}),
      ...(optionalAnswer ? { [id(4)]: rating(2) } : {}),
    },
  };
}

function internalQuestion(
  analysis: ReturnType<typeof analyzeSurveyBranchingFinalizedResponses>,
  question: number,
) {
  const result = analysis.questions.find((value) => value.id === id(question));
  expect(result).toBeDefined();
  return result!;
}

function expectPublicWithholding(
  content: SurveyBranchingDraft,
  submissions: Submission[],
  closed = false,
) {
  const result = surveyBranchingSuppressedResults(content, submissions, closed);
  expect(SurveyBranchingSuppressedResultsSchema.safeParse(result).success).toBe(true);
  expect(result).toMatchObject({
    schemaVersion: 3,
    sourceSchemaVersion: 4,
    submittedCount: null,
    suppressed: true,
    resultsStatus: closed ? "privacy_review_required" : "collecting",
  });
  for (const question of result.questions) {
    expect(question).toMatchObject({
      eligibleCount: null,
      answeredCount: null,
      unansweredCount: null,
      skippedLogicCount: null,
      distribution: [],
      suppressed: true,
    });
  }
  return result;
}

function independentControllersFixture() {
  const source = surveyBranchingFixture();
  return SurveyBranchingContentSchema.parse({
    ...source,
    items: source.items.map((item) => ({ ...item, required: true })),
    pages: [
      { ...source.pages[0], questionIds: [id(1), id(2)] },
      {
        ...source.pages[2],
        visibleWhen: { kind: "choice_equals", questionId: id(1), choiceId: id(101) },
      },
      {
        ...source.pages[3],
        visibleWhen: { kind: "choice_equals", questionId: id(2), choiceId: id(201) },
      },
    ],
  });
}

function independentSubmission(first: boolean, second: boolean): Submission {
  return {
    finalized: true,
    responses: {
      [id(1)]: choice(1, first),
      [id(2)]: choice(2, second),
      ...(first ? { [id(3)]: rating() } : {}),
      ...(second ? { [id(4)]: rating() } : {}),
    },
  };
}

describe("conditional Survey C1 adversarial privacy qualification", () => {
  it("withholds a direct small branch despite an adequately sized finalized run", () => {
    const content = surveyBranchingFixture();
    const submissions = [
      ...repeat(4, () => nestedSubmission("nested")),
      ...repeat(5, () => nestedSubmission("closed")),
    ];
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, submissions);
    expect(analysis.submittedCount).toBe(9);
    expect(internalQuestion(analysis, 3).answeredCount).toBe(4);
    expect(analysis.submittedCount >= 5).toBe(true);
    expectPublicWithholding(content, submissions, true);
  });

  it("withholds a large branch whose complement is one finalized submission", () => {
    const content = surveyBranchingFixture();
    const submissions = [
      ...repeat(8, () => nestedSubmission("parent")),
      nestedSubmission("closed"),
    ];
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, submissions);
    const parent = internalQuestion(analysis, 2);
    // A check of only the visible branch's sample would pass and miss its small complement.
    expect(parent.eligibleCount >= 5 && parent.answeredCount >= 5).toBe(true);
    expect(analysis.submittedCount - parent.eligibleCount).toBe(1);
    expect(parent.skippedLogicCount).toBe(1);
    expect(JSON.stringify(expectPublicWithholding(content, submissions, true))).toBe(
      JSON.stringify(expectPublicWithholding(content, [], true)),
    );
  });

  it("does not release a nested count whose ancestor difference is one despite passing whole-run checks", () => {
    const content = surveyBranchingFixture();
    const submissions = [
      ...repeat(9, () => nestedSubmission("nested")),
      nestedSubmission("parent"),
      ...repeat(5, () => nestedSubmission("closed")),
    ];
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, submissions);
    const parent = internalQuestion(analysis, 2);
    const descendant = internalQuestion(analysis, 3);
    expect([analysis.submittedCount, parent.eligibleCount, descendant.eligibleCount]).toEqual([
      15, 10, 9,
    ]);
    expect(
      [
        parent.answeredCount,
        descendant.answeredCount,
        analysis.submittedCount - parent.eligibleCount,
        analysis.submittedCount - descendant.eligibleCount,
      ].every((count) => count >= 5),
    ).toBe(true);
    // Whole-run complements are 5 and 6, but the known ancestor subset differs by 1.
    expect(parent.eligibleCount - descendant.eligibleCount).toBe(1);
    expectPublicWithholding(content, submissions, true);
  });

  it("does not mistake safe marginal counts for qualification of independently controlled overlaps", () => {
    const content = independentControllersFixture();
    const smallJointCells = [
      ...repeat(9, () => independentSubmission(true, true)),
      independentSubmission(true, false),
      independentSubmission(false, true),
      ...repeat(4, () => independentSubmission(false, false)),
    ];
    const largerJointCells = [
      ...repeat(5, () => independentSubmission(true, true)),
      ...repeat(5, () => independentSubmission(true, false)),
      ...repeat(5, () => independentSubmission(false, true)),
    ];
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, smallJointCells);
    expect(analysis.submittedCount).toBe(15);
    for (const question of [3, 4]) {
      const branch = internalQuestion(analysis, question);
      expect([branch.eligibleCount, analysis.submittedCount - branch.eligibleCount]).toEqual([
        10, 5,
      ]);
    }
    // The small cohort has A-only/B-only cells of 1 and a neither cell of 4. Marginals
    // alone do not identify those cells; they also do not qualify release alongside
    // future joint/subset evidence. C1 exposes neither the marginals nor branch traces.
    expect(analyzeSurveyBranchingFinalizedResponses(content, largerJointCells)).toEqual(analysis);
    const projected = expectPublicWithholding(content, smallJointCells, true);
    expect(projected).toEqual(expectPublicWithholding(content, largerJointCells, true));
    const serialized = JSON.stringify({ analysis, projected });
    for (const field of [
      "submissions",
      "responses",
      "attempts",
      "respondentIds",
      "visiblePageIds",
      "eligibleQuestionIds",
      "questionStates",
      "branchTrace",
    ]) {
      expect(serialized).not.toContain(`"${field}":`);
    }
  });

  it.each([
    { closed: false, status: "collecting" },
    { closed: true, status: "privacy_review_required" },
  ])(
    "keeps public JSON identical across valid cohorts and sample boundaries while $status",
    ({ closed, status }) => {
      const content = surveyBranchingFixture();
      const cohorts = [
        [],
        repeat(4, () => nestedSubmission("closed")),
        repeat(5, () => nestedSubmission("nested", true)),
        repeat(15, () => nestedSubmission("parent")),
      ];
      const baseline = JSON.stringify(expectPublicWithholding(content, cohorts[0]!, closed));
      for (const submissions of cohorts) {
        const result = expectPublicWithholding(content, submissions, closed);
        expect(result.resultsStatus).toBe(status);
        expect(JSON.stringify(result)).toBe(baseline);
      }
      if (!closed)
        expect(surveyBranchingSuppressedResults(content, cohorts[2])).toEqual(
          surveyBranchingSuppressedResults(content, cohorts[2], false),
        );
    },
  );

  it("changes only the withheld status at closure without revealing a previously hidden sample", () => {
    const content = surveyBranchingFixture();
    const submissions = repeat(5, () => nestedSubmission("nested", true));
    const { resultsStatus: collecting, ...open } = expectPublicWithholding(content, submissions);
    const { resultsStatus: review, ...closed } = expectPublicWithholding(
      content,
      submissions,
      true,
    );
    expect(collecting).toBe("collecting");
    expect(review).toBe("privacy_review_required");
    expect(closed).toEqual(open);
  });

  it("rejects injected internal evidence and traces instead of stripping or publishing them", () => {
    const content = surveyBranchingFixture();
    const submissions = repeat(5, () => nestedSubmission("nested"));
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, submissions);
    const result = expectPublicWithholding(content, submissions, true);
    const injected = [
      { ...result, submittedCount: analysis.submittedCount },
      { ...result, internalAnalysis: analysis },
      { ...result, submissions },
      ...["eligibleCount", "answeredCount", "unansweredCount", "skippedLogicCount"].map(
        (field) => ({
          ...result,
          questions: result.questions.map((question, index) =>
            index === 0 ? { ...question, [field]: 5 } : question,
          ),
        }),
      ),
      ...[
        { distribution: [{ label: "Synthetic evidence", count: 5 }] },
        { branchTrace: [{ visiblePageIds: [id(11), id(12)] }] },
        { responses: submissions[0]!.responses },
        { respondentIds: [id(999)] },
      ].map((evidence) => ({
        ...result,
        questions: result.questions.map((question, index) =>
          index === 0 ? { ...question, ...evidence } : question,
        ),
      })),
    ];
    for (const value of injected)
      expect(SurveyBranchingSuppressedResultsSchema.safeParse(value).success).toBe(false);
  });
});
