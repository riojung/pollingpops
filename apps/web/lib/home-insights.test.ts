import { describe, expect, it } from "vitest";
import type { HomeSummary, HomeWork } from "../app/home/home-model";
import { deriveHomeInsights } from "./home-insights";

const generatedAt = "2026-11-12T12:00:00Z";

function summary(): HomeSummary {
  return {
    generatedAt,
    recentArtifacts: [],
    sessions: [],
    assignments: [],
    resultHighlights: [],
    groupSchedule: [],
    totals: {
      artifacts: 0,
      activeSessions: 0,
      activeAssignments: 0,
      upcomingGroupItems: 0,
    },
  };
}

function round(overrides: Partial<HomeSummary["recentArtifacts"][number]> = {}) {
  return {
    id: "round",
    artifactType: "round" as const,
    title: "A draft round",
    description: "",
    status: "draft" as const,
    itemCount: 1,
    updatedAt: generatedAt,
    editHref: "/quiz/round",
    actionHref: "/host/setup/round",
    actionLabel: "Host Round",
    ...overrides,
  };
}

function assignment(overrides: Partial<HomeSummary["assignments"][number]> = {}) {
  return {
    id: "assignment",
    quizId: "round",
    title: "Closing assignment",
    status: "open" as const,
    checkpointCount: 1,
    attemptCount: 0,
    completedAttemptCount: 0,
    opensAt: "2026-11-11T12:00:00Z",
    closesAt: "2026-11-13T12:00:00Z",
    href: "/practice/assignment",
    ...overrides,
  };
}

function result(overrides: Partial<HomeSummary["resultHighlights"][number]> = {}) {
  return {
    id: "result",
    artifactType: "round" as const,
    title: "A ready report",
    status: "ready" as const,
    participantCount: 2,
    accuracyPercent: null,
    recoveryPercent: null,
    createdAt: generatedAt,
    href: "/report/result",
    ...overrides,
  };
}

function liveSession(overrides: Partial<HomeSummary["sessions"][number]> = {}) {
  return {
    id: "session",
    artifactType: "presentation" as const,
    artifactId: "presentation",
    title: "A live presentation",
    status: "active" as const,
    phase: "lobby",
    code: "123456",
    participantCount: 2,
    progressLabel: "Lobby",
    createdAt: generatedAt,
    href: "/presentation-session/session/host",
    ...overrides,
  };
}

describe("Home summary insights", () => {
  it("keeps absent evidence distinct from measured zero without inventing workspace totals", () => {
    const data = summary();
    data.totals.artifacts = 1_000;
    data.totals.activeAssignments = 100;
    const empty = deriveHomeInsights(data, true);
    expect(empty.recentDrafts).toEqual([]);
    expect(empty.readyResults).toEqual([]);
    expect(empty.latestReadyResult).toBeNull();
    expect(empty.assignmentProgress).toEqual({
      assignmentCount: 0,
      attempts: 0,
      completedAttempts: 0,
      completionPercent: null,
    });
    expect(empty.actions).toEqual([]);

    data.assignments = [assignment({ attemptCount: 3 })];
    expect(deriveHomeInsights(data, true).assignmentProgress).toMatchObject({
      assignmentCount: 1,
      attempts: 3,
      completionPercent: 0,
    });
    data.assignments.push(
      assignment({
        id: "scheduled",
        status: "scheduled",
        attemptCount: 2,
        completedAttemptCount: 2,
      }),
    );
    expect(deriveHomeInsights(data, true).assignmentProgress).toEqual({
      assignmentCount: 2,
      attempts: 5,
      completedAttempts: 2,
      completionPercent: 40,
    });
  });

  it("prioritizes canonical next steps and caps them at three", () => {
    const data = summary();
    data.sessions = [liveSession()];
    data.assignments = [assignment()];
    data.recentArtifacts = [round()];
    data.resultHighlights = [result()];
    expect(deriveHomeInsights(data, true).actions).toEqual([
      {
        kind: "liveSession",
        href: "/presentation-session/session/host",
        title: "A live presentation",
      },
      {
        kind: "assignmentClosing",
        href: "/practice/assignment",
        title: "Closing assignment",
        closesAt: "2026-11-13T12:00:00Z",
      },
      { kind: "draft", href: "/quiz/round", title: "A draft round" },
    ]);
    expect(data.recentArtifacts[0]!.actionHref).toBe("/host/setup/round");
    data.assignments = [];
    expect(deriveHomeInsights(data, true).actions.at(-1)).toEqual({
      kind: "readyResult",
      href: "/report/result",
      title: "A ready report",
    });
  });

  it("supports live totals outside the recent sample and marks the server cap as a lower bound", () => {
    const data = summary();
    data.totals.activeSessions = 1;
    expect(deriveHomeInsights(data, true)).toMatchObject({
      activeSessionsLowerBound: false,
      actions: [{ kind: "liveSession", href: "/sessions", title: null }],
    });
    data.totals.activeSessions = 249;
    expect(deriveHomeInsights(data, true).activeSessionsLowerBound).toBe(false);
    data.totals.activeSessions = 250;
    expect(deriveHomeInsights(data, true).activeSessionsLowerBound).toBe(true);
    data.totals.activeSessions = 251;
    expect(deriveHomeInsights(data, true).activeSessionsLowerBound).toBe(true);
  });

  it("keeps viewer suggestions read-only and respects each board's edit permission", () => {
    const data = summary();
    data.sessions = [liveSession()];
    data.recentArtifacts = [round()];
    data.recentBoards = [
      {
        id: "shared",
        artifactType: "canvas",
        boardType: "team",
        title: "Shared draft",
        description: "",
        status: "draft",
        itemCount: null,
        updatedAt: "2026-11-13T12:00:00Z",
        editHref: "/canvas/shared",
        actionHref: "/canvas/shared",
        actionLabel: "Open Board",
        canEdit: false,
        role: "viewer",
      },
    ];
    expect(deriveHomeInsights(data, true).recentDrafts.map((draft) => draft.id)).toEqual(["round"]);
    expect(deriveHomeInsights(data, false)).toMatchObject({
      recentDrafts: [],
      actions: [{ kind: "liveSession", href: "/sessions", title: null }],
    });
  });

  it("uses all returned work samples, real recency and only ready reports without mutating the response", () => {
    const data = summary();
    data.recentArtifacts = Array.from({ length: 6 }, (_, index) =>
      round({ id: `published-${index}`, status: "published" }),
    );
    data.recentSurveys = [
      {
        id: "legacy",
        artifactType: "survey",
        title: "Legacy draft",
        description: "",
        status: "draft",
        itemCount: 1,
        updatedAt: null,
        editHref: "/surveys/legacy",
        actionHref: "/surveys/legacy",
        actionLabel: "Open Survey",
      },
      {
        id: "recent",
        artifactType: "survey",
        title: "Recent draft",
        description: "",
        status: "draft",
        itemCount: 1,
        updatedAt: "2026-11-11T12:00:00Z",
        editHref: "/surveys/recent",
        actionHref: "/surveys/recent",
        actionLabel: "Open Survey",
      },
    ];
    data.resultHighlights = [
      result({ id: "pending", status: "pending", createdAt: "2026-11-15T12:00:00Z" }),
      result({ id: "older", createdAt: "2026-11-10T12:00:00Z", accuracyPercent: 0 }),
      result({ id: "failed", status: "failed", createdAt: "2026-11-14T12:00:00Z" }),
      result({ id: "newer", createdAt: "2026-11-11T12:00:00Z" }),
    ];
    const before = structuredClone(data);
    const insights = deriveHomeInsights(data, true);
    expect(insights.recentDrafts.map((draft: HomeWork) => draft.id)).toEqual(["recent", "legacy"]);
    expect(insights.readyResults.map((report) => report.id)).toEqual(["newer", "older"]);
    expect(insights.latestReadyResult).toMatchObject({ id: "newer", accuracyPercent: null });
    expect(insights.readyResults[1]!.accuracyPercent).toBe(0);
    expect(data).toEqual(before);
  });

  it("uses the summary timestamp and chooses the earliest open closing deadline within 48 hours", () => {
    const data = summary();
    data.assignments = [
      assignment({ id: "later", closesAt: "2026-11-14T12:00:00Z" }),
      assignment({ id: "earlier", closesAt: "2026-11-12T13:00:00Z", href: "/practice/earlier" }),
      assignment({ id: "past", closesAt: generatedAt }),
      assignment({ id: "distant", closesAt: "2026-11-14T12:00:01Z" }),
      assignment({
        id: "scheduled",
        status: "scheduled",
        opensAt: "2026-11-12T12:30:00Z",
        closesAt: "2026-11-12T12:45:00Z",
      }),
      assignment({
        id: "future-open",
        opensAt: "2026-11-12T12:01:00Z",
        closesAt: "2026-11-12T12:02:00Z",
      }),
      assignment({ id: "unknown-open", opensAt: "unknown", closesAt: "2026-11-12T12:02:00Z" }),
      assignment({ id: "unknown-close", closesAt: "unknown" }),
    ];
    expect(deriveHomeInsights(data, true).actions).toEqual([
      {
        kind: "assignmentClosing",
        href: "/practice/earlier",
        title: "Closing assignment",
        closesAt: "2026-11-12T13:00:00Z",
      },
    ]);
    data.assignments = [assignment({ closesAt: "2026-11-14T12:00:00Z" })];
    expect(deriveHomeInsights(data, true).actions).toHaveLength(1);
    data.generatedAt = "unknown";
    expect(deriveHomeInsights(data, true).actions).toEqual([]);
  });
});
