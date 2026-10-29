import { describe, expect, it } from "vitest";
import {
  evidencePercent,
  practiceOverview,
  presentationOverview,
  roundOverview,
  surveyOverview,
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
  it("totals Presentation responses without inventing a unique participant or response-rate aggregate", () => {
    expect(
      presentationOverview([
        { status: "active", responseCount: 12 },
        { status: "finished", responseCount: 18 },
      ]),
    ).toEqual({ count: 2, responses: 30, active: 1, finished: 1 });
  });
  it("uses only the supplied Survey run metadata, without inventing response counts", () => {
    expect(surveyOverview([{ surveyId: "a" }, { surveyId: "a" }, { surveyId: "b" }])).toEqual({
      count: 3,
      sources: 2,
    });
  });
});
