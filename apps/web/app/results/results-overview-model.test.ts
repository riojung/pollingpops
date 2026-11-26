import { describe, expect, it } from "vitest";
import {
  evidencePercent,
  practiceOverview,
  presentationOverview,
  resultsActivity,
  roundOverview,
  surveyOverview,
  utcHistoryActivity,
} from "./results-overview-model";

describe("summaries of shown Results evidence", () => {
  it("pools recovery opportunities from ready reports without averaging percentages or including processing placeholders", () => {
    const result = roundOverview([
      {
        status: "ready",
        recovery: { recovered: 1, eligible: 1, percent: 100 },
        followupId: "followup",
      },
      { status: "ready", recovery: { recovered: 0, eligible: 9, percent: 0 }, followupId: null },
      {
        status: "pending",
        recovery: { recovered: 90, eligible: 100, percent: 90 },
        followupId: "pending",
      },
      {
        status: "failed",
        recovery: { recovered: 90, eligible: 100, percent: 90 },
        followupId: null,
      },
    ]);
    expect(result).toEqual({
      count: 4,
      ready: 2,
      pending: 1,
      failed: 1,
      recovered: 1,
      eligible: 10,
      recoveryPercent: 10,
      followups: 1,
    });
  });
  it("keeps absent evidence distinct from an observed zero", () => {
    expect(evidencePercent(0, 0)).toBeNull();
    expect(evidencePercent(0, 10)).toBe(0);
    expect(
      roundOverview([
        {
          status: "ready",
          recovery: { recovered: 0, eligible: 0, percent: null },
          followupId: null,
        },
      ]).recoveryPercent,
    ).toBeNull();
  });
  it("counts attempt completion with its actual denominator, including unfinished attempts", () => {
    expect(
      practiceOverview([
        { status: "closed", attemptCount: 9, completedAttemptCount: 9 },
        { status: "open", attemptCount: 1, completedAttemptCount: 0 },
      ]),
    ).toEqual({
      count: 2,
      attempts: 10,
      completed: 9,
      percent: 90,
      open: 1,
      scheduled: 0,
      closed: 1,
      expired: 0,
    });
    expect(practiceOverview([]).percent).toBeNull();
  });
  it("totals participant records as joins across the Presentation sessions shown", () => {
    expect(
      presentationOverview([
        { status: "active", participantCount: 12 },
        { status: "finished", participantCount: 18 },
      ]),
    ).toEqual({ count: 2, joins: 30, active: 1, finished: 1 });
  });
  it("uses only the supplied Survey run metadata, without inventing response counts", () => {
    expect(surveyOverview([{ surveyId: "a" }, { surveyId: "a" }, { surveyId: "b" }])).toEqual({
      count: 3,
      sources: 2,
    });
  });
});

describe("activity periods for shown Results", () => {
  it("groups records by their local month and skips months with no records", () => {
    const endOfJanuary = new Date(2026, 0, 31, 23, 59, 59).toISOString();
    expect(resultsActivity(["2026-03-01", "2026-01-01", endOfJanuary], "month")).toEqual([
      { start: new Date(2026, 0, 1), end: new Date(2026, 0, 31), count: 2 },
      { start: new Date(2026, 2, 1), end: new Date(2026, 2, 31), count: 1 },
    ]);
  });

  it("returns the latest six represented periods in chronological order", () => {
    const dates = ["12", "03", "07", "05", "01", "09", "08"].map((month) => `2026-${month}-14`);
    expect(resultsActivity(dates, "month").map(({ start }) => start.getMonth())).toEqual([
      2, 4, 6, 7, 8, 11,
    ]);
  });

  it("uses inclusive calendar quarter boundaries across a year change", () => {
    expect(
      resultsActivity(["2026-12-31", "2027-01-01", "2027-03-31", "2027-04-01"], "quarter"),
    ).toEqual([
      { start: new Date(2026, 9, 1), end: new Date(2026, 11, 31), count: 1 },
      { start: new Date(2027, 0, 1), end: new Date(2027, 2, 31), count: 2 },
      { start: new Date(2027, 3, 1), end: new Date(2027, 5, 30), count: 1 },
    ]);
  });

  it("ignores invalid dates and leaves activity empty when none are available", () => {
    expect(resultsActivity(["", "invalid", "2026-13-01", "2026-02-30"], "quarter")).toEqual([]);
    expect(resultsActivity([], "month")).toEqual([]);
    expect(resultsActivity(["invalid", "2024-02-29"], "month")).toEqual([
      { start: new Date(2024, 1, 1), end: new Date(2024, 1, 29), count: 1 },
    ]);
  });
});

it("keeps the server's Round counts and uses UTC month and quarter boundaries", () => {
  const activity = {
    month: [{ start: "2028-02-01", count: 9 }],
    quarter: [
      { start: "2027-10-01", count: 18 },
      { start: "2028-01-01", count: 13 },
    ],
  };
  expect(utcHistoryActivity(activity, "month")).toEqual([
    { start: new Date("2028-02-01T00:00:00Z"), end: new Date("2028-02-29T00:00:00Z"), count: 9 },
  ]);
  expect(utcHistoryActivity(activity, "quarter")).toEqual([
    { start: new Date("2027-10-01T00:00:00Z"), end: new Date("2027-12-31T00:00:00Z"), count: 18 },
    { start: new Date("2028-01-01T00:00:00Z"), end: new Date("2028-03-31T00:00:00Z"), count: 13 },
  ]);
  expect(utcHistoryActivity({ month: [], quarter: [] }, "quarter")).toEqual([]);
});
