import { describe, expect, it } from "vitest";
import {
  evidencePercent,
  practiceOverview,
  presentationOverview,
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
