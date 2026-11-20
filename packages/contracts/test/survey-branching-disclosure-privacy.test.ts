import { describe, expect, it } from "vitest";
import {
  analyzeSurveyBranchingFinalizedResponses,
  surveyBranchingDisclosureResults,
  SurveyBranchingDisclosureResultsSchema,
} from "../src/survey-branching-results";
import { SurveyBranchingContentSchema, type SurveyBranchingDraft } from "../src/survey-branching";
import type { SurveyResponses } from "../src/surveys";
import { branchingId as id, surveyBranchingFixture } from "./support/survey-branching-fixture";

type Submission = { finalized: true; responses: SurveyResponses };
const poll = (question: number, ...choices: number[]) => ({
  kind: "poll" as const,
  choiceIds: choices.map((choice) => id(question * 100 + choice)),
});
const rating = (value = 4) => ({ kind: "rating" as const, value });
const finalized = (responses: SurveyResponses): Submission => ({ finalized: true, responses });
const repeat = (count: number, build: () => Submission) => Array.from({ length: count }, build);

function nested(path: "closed" | "parent" | "nested"): Submission {
  return finalized({
    [id(1)]: poll(1, path === "closed" ? 2 : 1),
    ...(path !== "closed" ? { [id(2)]: poll(2, path === "nested" ? 1 : 2) } : {}),
    ...(path === "nested" ? { [id(3)]: rating() } : {}),
  });
}

function pairedRatings(first: number, second?: number): Submission {
  return finalized({
    ...nested("nested").responses,
    [id(3)]: rating(first),
    ...(second === undefined ? {} : { [id(4)]: rating(second) }),
  });
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

function independent(first: boolean, second: boolean): Submission {
  return finalized({
    [id(1)]: poll(1, first ? 1 : 2),
    [id(2)]: poll(2, second ? 1 : 2),
    ...(first ? { [id(3)]: rating() } : {}),
    ...(second ? { [id(4)]: rating() } : {}),
  });
}

// Fixed authored-order reference: root poll contributions, then conditional rating
// contributions. Each question contributes E/A/U/S followed by each authored bucket.
// This does not call or reproduce the implementation's private signature helper.
const rootVector = (yes: boolean) => [1, 1, 0, 0, Number(yes), Number(!yes)];
const conditionalVector = (eligible: boolean) => [
  Number(eligible),
  Number(eligible),
  0,
  Number(!eligible),
  0,
  0,
  0,
  Number(eligible),
  0,
];
const independentPatterns = [
  [false, false],
  [false, true],
  [true, false],
  [true, true],
] as const;
const referenceVectors = independentPatterns.map(([first, second]) => [
  1,
  ...rootVector(first),
  ...rootVector(second),
  ...conditionalVector(first),
  ...conditionalVector(second),
]);

function fromIndependentHistogram(counts: readonly number[]) {
  return independentPatterns.flatMap(([first, second], index) =>
    repeat(counts[index]!, () => independent(first, second)),
  );
}

function expectWithheld(content: SurveyBranchingDraft, submissions: Submission[], closed = true) {
  const result = surveyBranchingDisclosureResults(content, submissions, closed);
  expect(result.resultsStatus).toBe(closed ? "privacy_withheld" : "collecting");
  expect(result.submittedCount).toBeNull();
  expect(result.suppressed).toBe(true);
  for (const question of result.questions)
    expect(question).toMatchObject({
      eligibleCount: null,
      answeredCount: null,
      unansweredCount: null,
      skippedLogicCount: null,
      distribution: [],
      suppressed: true,
    });
  return result;
}

function expectAvailable(content: SurveyBranchingDraft, submissions: Submission[]) {
  const result = surveyBranchingDisclosureResults(content, submissions, true);
  expect(result.resultsStatus).toBe("available");
  expect(result.submittedCount).toBe(submissions.length);
  expect(result.suppressed).toBe(false);
  expect(SurveyBranchingDisclosureResultsSchema.safeParse(result).success).toBe(true);
  return result;
}

describe("conditional Survey C2 joint-contribution privacy qualification", () => {
  it("withholds nested 15/10/9 cohorts despite adequate direct and whole-run samples", () => {
    const content = surveyBranchingFixture();
    const submissions = [
      ...repeat(9, () => nested("nested")),
      nested("parent"),
      ...repeat(5, () => nested("closed")),
    ];
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, submissions);
    const parent = analysis.questions[1]!;
    const child = analysis.questions[2]!;
    expect([analysis.submittedCount, parent.eligibleCount, child.eligibleCount]).toEqual([
      15, 10, 9,
    ]);
    expect(
      [
        parent.answeredCount,
        child.answeredCount,
        parent.skippedLogicCount,
        child.skippedLogicCount,
      ].every((count) => count >= 5),
    ).toBe(true);
    expect(parent.eligibleCount - child.eligibleCount).toBe(1);
    expectWithheld(content, submissions);
  });

  it("distinguishes unsafe and qualified joint cohorts with identical complete marginal analyses", () => {
    const content = independentControllersFixture();
    // Order is 00/01/10/11. The marginal counts match, but the joint cells differ.
    const unsafe = fromIndependentHistogram([4, 1, 1, 9]);
    const qualified = fromIndependentHistogram([0, 5, 5, 5]);
    expect(analyzeSurveyBranchingFinalizedResponses(content, unsafe)).toEqual(
      analyzeSurveyBranchingFinalizedResponses(content, qualified),
    );
    expectWithheld(content, unsafe);
    const released = expectAvailable(content, qualified);
    // The exact same count DTO is arithmetically plausible for the unsafe cohort.
    // Parsing a DTO cannot replace qualification from its authoritative submissions.
    expect(SurveyBranchingDisclosureResultsSchema.safeParse(released).success).toBe(true);
  });

  it("includes rare optional-answer patterns even when every marginal sample is adequate", () => {
    const content = surveyBranchingFixture();
    const submissions = [
      ...repeat(9, () => pairedRatings(4, 4)),
      pairedRatings(4),
      pairedRatings(5, 4),
      ...repeat(4, () => pairedRatings(5)),
    ];
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, submissions);
    expect(analysis.questions[2]!.distribution.map((bucket) => bucket.count)).toEqual([
      0, 0, 0, 10, 5,
    ]);
    expect(analysis.questions[3]).toMatchObject({
      eligibleCount: 15,
      answeredCount: 10,
      unansweredCount: 5,
      skippedLogicCount: 0,
    });
    expectWithheld(content, submissions);
  });

  it("includes complete rating patterns rather than accepting adequate per-bucket marginals", () => {
    const content = surveyBranchingFixture();
    const submissions = [
      ...repeat(9, () => pairedRatings(4, 4)),
      pairedRatings(4, 5),
      pairedRatings(5, 4),
      ...repeat(4, () => pairedRatings(5, 5)),
    ];
    const analysis = analyzeSurveyBranchingFinalizedResponses(content, submissions);
    for (const question of analysis.questions.slice(2)) {
      expect(question.answeredCount).toBe(15);
      expect(question.distribution.map((bucket) => bucket.count)).toEqual([0, 0, 0, 10, 5]);
    }
    expectWithheld(content, submissions);
  });

  it("includes exact multi-selection sets even when every option and complement reaches five", () => {
    const content = surveyBranchingFixture();
    const sourcePoll = content.items[0]!.question;
    if (sourcePoll.type !== "poll") throw new Error("Expected the synthetic poll");
    content.items[3] = {
      required: true,
      question: {
        ...sourcePoll,
        id: id(4),
        prompt: "Choose up to two synthetic options",
        maxSelections: 2,
        choices: [1, 2, 3].map((value) => ({
          id: id(400 + value),
          label: `Option ${value}`,
          isCorrect: false,
        })),
      },
    };
    const answer = (...choices: number[]) =>
      finalized({ ...nested("nested").responses, [id(4)]: poll(4, ...choices) });
    const submissions = [
      ...repeat(9, () => answer(1, 2)),
      answer(1, 3),
      answer(2, 3),
      ...repeat(4, () => answer(3)),
    ];
    const question = analyzeSurveyBranchingFinalizedResponses(content, submissions).questions[3]!;
    expect(question).toMatchObject({ eligibleCount: 15, answeredCount: 15, unansweredCount: 0 });
    expect(question.distribution.map((bucket) => bucket.count)).toEqual([10, 10, 6]);
    for (const bucket of question.distribution)
      expect(bucket.count >= 5 && 15 - bucket.count >= 5).toBe(true);
    expectWithheld(content, submissions);
  });

  it("exhaustively checks small independent histograms and every Boolean union of their full contribution vectors", () => {
    const content = independentControllersFixture();
    expect(new Set(referenceVectors.map((vector) => JSON.stringify(vector))).size).toBe(4);
    const domain = [0, 1, 4, 5, 6];
    let qualifiedCount = 0;
    for (const zeroZero of domain)
      for (const zeroOne of domain)
        for (const oneZero of domain)
          for (const oneOne of domain) {
            const counts = [zeroZero, zeroOne, oneZero, oneOne];
            const total = counts.reduce((sum, count) => sum + count, 0);
            const qualified = total >= 5 && counts.every((count) => count === 0 || count >= 5);
            const result = surveyBranchingDisclosureResults(
              content,
              fromIndependentHistogram(counts),
              true,
            );
            expect(result.resultsStatus).toBe(qualified ? "available" : "privacy_withheld");
            if (!qualified) continue;
            qualifiedCount++;
            // Every Boolean function on these four distinct full vectors selects a
            // union of whole atoms. Enumerate all 16, including empty/full cohorts.
            for (let mask = 0; mask < 1 << referenceVectors.length; mask++) {
              const cohortSize = referenceVectors.reduce(
                (sum, _vector, index) => sum + (mask & (1 << index) ? counts[index]! : 0),
                0,
              );
              expect(cohortSize === 0 || cohortSize >= 5).toBe(true);
            }
          }
    expect(qualifiedCount).toBe(80);
  });

  it("permits a signed difference of one when cancellation does not describe a small Boolean cohort", () => {
    const content = surveyBranchingFixture();
    const submissions = [
      ...repeat(5, () => nested("closed")),
      ...repeat(6, () => nested("parent")),
    ];
    const result = expectAvailable(content, submissions);
    const counts = result.questions[0]!.distribution.map((bucket) => bucket.count);
    expect(counts).toEqual([6, 5]);
    expect(counts[0]! - counts[1]!).toBe(1);
    expect([0, 5, 6, 11].includes(1)).toBe(false);
    // The two actual atoms have sizes 5 and 6. Their Boolean unions have sizes
    // 0/5/6/11; assigning opposite signs is not selecting a one-submission subset.
  });

  it("documents the known-answer/duplicate-credential status oracle limitation instead of claiming differential privacy", () => {
    const content = surveyBranchingFixture();
    const knownFour = repeat(4, () => nested("closed"));
    const matchingTarget = [...knownFour, nested("closed")];
    const differentTarget = [...knownFour, nested("parent")];
    expectAvailable(content, matchingTarget);
    expectWithheld(content, differentTarget);
    // Both cohorts contain five finalized submissions. Someone who knows or creates
    // the other four can learn from release status. Atom thresholds neither verify
    // distinct people nor protect against arbitrary auxiliary/known-answer knowledge.
  });

  it("documents that two individually qualified calls can reveal a one-submission snapshot difference", () => {
    const content = surveyBranchingFixture();
    const first = [...repeat(5, () => nested("closed")), ...repeat(5, () => nested("parent"))];
    const second = [...first, nested("parent")];
    const before = expectAvailable(content, first);
    const after = expectAvailable(content, second);
    expect(
      after.questions[0]!.distribution[0]!.count - before.questions[0]!.distribution[0]!.count,
    ).toBe(1);
    // The pure policy has no release history. Frozen outcomes and withdrawal without
    // recomputation belong to the later runtime/erasure protocol, not this guarantee.
  });

  it("keeps qualifying evidence withheld while collecting and never exposes atom diagnostics", () => {
    const content = independentControllersFixture();
    const submissions = fromIndependentHistogram([0, 5, 5, 5]);
    const collecting = expectWithheld(content, submissions, false);
    const available = expectAvailable(content, submissions);
    for (const result of [collecting, available]) {
      const serialized = JSON.stringify(result);
      for (const key of [
        "atoms",
        "atomVectors",
        "atomSizes",
        "minimumAtomSize",
        "signatures",
        "responses",
        "submissions",
        "branchTrace",
      ])
        expect(serialized).not.toContain(`"${key}":`);
      expect(
        SurveyBranchingDisclosureResultsSchema.safeParse({ ...result, atomSizes: [5, 5, 5] })
          .success,
      ).toBe(false);
    }
  });
});
