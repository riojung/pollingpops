import { describe, expect, it } from "vitest";
import {
  surveyBranchingDisclosureResults,
  SurveyBranchingDisclosureResultsSchema,
} from "../src/survey-branching-results";
import { branchingId as id, surveyBranchingFixture } from "./support/survey-branching-fixture";

function availableReport() {
  const result = surveyBranchingDisclosureResults(
    surveyBranchingFixture(),
    Array.from({ length: 5 }, () => ({
      finalized: true,
      responses: {
        [id(1)]: { kind: "poll", choiceIds: [id(101)] },
        [id(2)]: { kind: "poll", choiceIds: [id(201)] },
        [id(3)]: { kind: "rating", value: 4 },
      },
    })),
    true,
  );
  if (result.resultsStatus !== "available") throw new Error("Expected qualified synthetic data");
  return result;
}

// Schema-only numeric boundary fixtures: not authoritative submissions or policy certificates.
function hugeReport() {
  const result = availableReport();
  const n = Number.MAX_SAFE_INTEGER - 1;
  const scale = (count: number) => (count === 0 ? 0 : n);
  return {
    ...result,
    submittedCount: n,
    questions: result.questions.map((question) => ({
      ...question,
      eligibleCount: scale(question.eligibleCount),
      answeredCount: scale(question.answeredCount),
      unansweredCount: scale(question.unansweredCount),
      skippedLogicCount: scale(question.skippedLogicCount),
      distribution: question.distribution.map((bucket) => ({
        ...bucket,
        count: scale(bucket.count),
      })),
    })),
  };
}

describe("conditional Survey disclosure DTO arithmetic boundaries", () => {
  it("accepts safe individual counts when a valid selection sum exceeds safe Number precision", () => {
    const result = hugeReport();
    const poll = result.questions[0]!;
    if (poll.type !== "poll") throw new Error("Expected poll fixture");
    poll.maxSelections = 2;
    poll.distribution = [
      { label: "First", count: result.submittedCount - 6 },
      { label: "Second", count: result.submittedCount - 6 },
      { label: "Third", count: 12 },
    ];
    expect(BigInt(result.submittedCount) * 2n > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(SurveyBranchingDisclosureResultsSchema.safeParse(result).success).toBe(true);
  });

  it("rejects an overflowing selection sum that ordinary floating-point arithmetic rounds to the allowed bound", () => {
    const result = hugeReport();
    const poll = result.questions[0]!;
    if (poll.type !== "poll") throw new Error("Expected poll fixture");
    poll.maxSelections = 2;
    poll.distribution = [
      { label: "First", count: result.submittedCount - 6 },
      { label: "Second", count: result.submittedCount - 6 },
      { label: "Third", count: 13 },
    ];
    const rounded = poll.distribution.reduce((sum, bucket) => sum + bucket.count, 0);
    const exact = poll.distribution.reduce((sum, bucket) => sum + BigInt(bucket.count), 0n);
    expect(rounded).toBe(result.submittedCount * 2);
    expect(exact).toBe(BigInt(result.submittedCount) * 2n + 1n);
    expect(SurveyBranchingDisclosureResultsSchema.safeParse(result).success).toBe(false);
  });

  it("rejects unsafe/nonfinite counts without throwing from integer conversion", () => {
    for (const invalid of [Number.MAX_SAFE_INTEGER + 1, 5.5, NaN, Infinity, -Infinity]) {
      const total = availableReport();
      total.submittedCount = invalid;
      expect(SurveyBranchingDisclosureResultsSchema.safeParse(total).success).toBe(false);
      const bucket = availableReport();
      bucket.questions[0]!.distribution[0]!.count = invalid;
      expect(SurveyBranchingDisclosureResultsSchema.safeParse(bucket).success).toBe(false);
    }
  });
});
