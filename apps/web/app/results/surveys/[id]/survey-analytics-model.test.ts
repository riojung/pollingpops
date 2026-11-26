import { describe, expect, it } from "vitest";
import {
  type SurveyAggregate,
  type SurveyAggregateQuestion,
  surveyAnalyticsOverview,
  surveyAverageRating,
} from "./survey-analytics-model";

function question(
  id: string,
  answeredCount: number | null,
  overrides: Partial<SurveyAggregateQuestion> = {},
): SurveyAggregateQuestion {
  return {
    id,
    prompt: `Prompt ${id}`,
    type: "poll",
    maxSelections: 2,
    percentBasis: "respondents",
    suppressed: false,
    answeredCount,
    distribution: [
      { label: "First choice", count: 6 },
      { label: "Second choice", count: 5 },
    ],
    ...overrides,
  };
}

function aggregate(overrides: Partial<SurveyAggregate> = {}): SurveyAggregate {
  return {
    schemaVersion: 2,
    title: "Staff feedback",
    resultsStatus: "available",
    submittedCount: 10,
    minimumRespondents: 5,
    suppressed: false,
    questions: [question("first", 6)],
    ...overrides,
  };
}

describe("surveyAnalyticsOverview", () => {
  it("measures coverage against finalized submissions and preserves authored order", () => {
    const results = aggregate({
      questions: [
        question("c", 6),
        question("b", 8, { suppressed: true }),
        question("a", 10),
        question("d", null),
      ],
    });

    expect(surveyAnalyticsOverview(results)).toEqual({
      totalQuestions: 4,
      questions: [
        { id: "c", prompt: "Prompt c", position: 1, answeredCount: 6, percent: 60 },
        { id: "a", prompt: "Prompt a", position: 3, answeredCount: 10, percent: 100 },
      ],
    });
  });

  it.each(["collecting", "insufficient_sample"] as const)(
    "withholds all overview metadata for %s results",
    (resultsStatus) => {
      expect(surveyAnalyticsOverview(aggregate({ resultsStatus }))).toBeNull();
    },
  );

  it("withholds the overview when the aggregate is suppressed", () => {
    expect(surveyAnalyticsOverview(aggregate({ suppressed: true }))).toBeNull();
  });

  it("requires the backend minimum and a valid count within the total", () => {
    const counts = [-1, 0, 6, 7, 7.5, 11, NaN];
    const results = aggregate({
      minimumRespondents: 7,
      questions: counts.map((count) => question(String(count), count)),
    });

    expect(surveyAnalyticsOverview(results)).toEqual({
      totalQuestions: counts.length,
      questions: [{ id: "7", prompt: "Prompt 7", position: 4, answeredCount: 7, percent: 70 }],
    });
  });

  it.each([0, 4, 8.5, Infinity, NaN])(
    "keeps coverage empty when the submission count is %s",
    (submittedCount) => {
      expect(surveyAnalyticsOverview(aggregate({ submittedCount }))).toEqual({
        totalQuestions: 1,
        questions: [],
      });
    },
  );
});

describe("surveyAverageRating", () => {
  const rating = question("rating", 8, {
    type: "rating",
    maxSelections: undefined,
    distribution: [
      { label: "4", count: 0 },
      { label: "5", count: 2 },
      { label: "6", count: 5 },
      { label: "7", count: 1 },
    ],
  });

  it("returns the weighted mean of the published rating histogram", () => {
    expect(surveyAverageRating(rating)).toBe(5.875);
  });

  it("requires a released rating question", () => {
    expect(surveyAverageRating({ ...rating, type: "poll" })).toBeNull();
    expect(surveyAverageRating({ ...rating, suppressed: true })).toBeNull();
  });

  it.each([null, 0, 7, 9, 8.5, NaN])("rejects a denominator of %s", (answeredCount) => {
    expect(surveyAverageRating({ ...rating, answeredCount })).toBeNull();
  });

  it.each([
    { label: "duplicate score", bucket: { label: "4", count: 2 } },
    { label: "missing score", bucket: { label: "8", count: 2 } },
    { label: "nonnumeric score", bucket: { label: "Good", count: 2 } },
    { label: "fractional count", bucket: { label: "5", count: 2.5 } },
    { label: "negative count", bucket: { label: "5", count: -2 } },
  ])("rejects a histogram with a $label", ({ bucket }) => {
    const distribution = [...rating.distribution];
    distribution[1] = bucket;
    expect(surveyAverageRating({ ...rating, distribution })).toBeNull();
  });
});
