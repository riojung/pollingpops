import type { HomeSummary, HomeWork } from "../app/home/home-model";

type HomeResult = HomeSummary["resultHighlights"][number];

export type HomeInsightAction =
  | { kind: "liveSession"; href: string; title: string | null }
  | { kind: "assignmentClosing"; href: string; title: string; closesAt: string }
  | { kind: "draft"; href: string; title: string }
  | { kind: "readyResult"; href: string; title: string };

export interface HomeInsights {
  recentDrafts: HomeWork[];
  readyResults: HomeResult[];
  latestReadyResult: HomeResult | null;
  assignmentProgress: {
    assignmentCount: number;
    attempts: number;
    completedAttempts: number;
    completionPercent: number | null;
  };
  activeSessionsLowerBound: boolean;
  actions: HomeInsightAction[];
}

const CLOSING_SOON_MS = 48 * 60 * 60 * 1_000;

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function newestFirst(left: string | null, right: string | null) {
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  return leftTime === rightTime ? 0 : leftTime > rightTime ? -1 : 1;
}

/**
 * Derive evidence and next steps from the authorized, bounded Home response only.
 * Drafts, results and assignment progress describe returned samples, not workspace
 * totals, personal ownership or unique participants. Missing attempt evidence is
 * represented by a null completion percentage, rather than a measured zero.
 */
export function deriveHomeInsights(summary: HomeSummary, canEdit: boolean): HomeInsights {
  const recentDrafts = [
    ...summary.recentArtifacts,
    ...(summary.recentSurveys ?? []),
    ...(summary.recentBoards ?? []),
  ]
    .filter((work) => canEdit && work.status === "draft" && (!("canEdit" in work) || work.canEdit))
    .sort((left, right) => newestFirst(left.updatedAt, right.updatedAt));
  const readyResults = summary.resultHighlights
    .filter((result) => result.status === "ready")
    .sort((left, right) => newestFirst(left.createdAt, right.createdAt));
  const latestReadyResult = readyResults[0] ?? null;
  const attempts = summary.assignments.reduce((total, item) => total + item.attemptCount, 0);
  const completedAttempts = summary.assignments.reduce(
    (total, item) => total + item.completedAttemptCount,
    0,
  );
  const assignmentProgress = {
    assignmentCount: summary.assignments.length,
    attempts,
    completedAttempts,
    completionPercent: attempts > 0 ? Math.round((completedAttempts / attempts) * 100) : null,
  };

  const actions: HomeInsightAction[] = [];
  const liveSession = summary.sessions.find((session) => session.status === "active");
  if (liveSession || summary.totals.activeSessions > 0) {
    // A presentation's supplied destination is a host route. Viewers can inspect
    // the Sessions list without gaining a new host affordance from Home.
    actions.push({
      kind: "liveSession",
      href: canEdit && liveSession ? liveSession.href : "/sessions",
      title: canEdit && liveSession ? liveSession.title : null,
    });
  }

  const generatedAt = timestamp(summary.generatedAt);
  const closingAssignment = Number.isFinite(generatedAt)
    ? summary.assignments
        .filter((assignment) => {
          const opensAt = timestamp(assignment.opensAt);
          const closesAt = timestamp(assignment.closesAt);
          return (
            assignment.status === "open" &&
            Number.isFinite(opensAt) &&
            opensAt <= generatedAt &&
            closesAt > generatedAt &&
            closesAt <= generatedAt + CLOSING_SOON_MS
          );
        })
        .sort((left, right) => timestamp(left.closesAt) - timestamp(right.closesAt))[0]
    : undefined;
  if (closingAssignment) {
    actions.push({
      kind: "assignmentClosing",
      href: closingAssignment.href,
      title: closingAssignment.title,
      closesAt: closingAssignment.closesAt,
    });
  }
  const draft = recentDrafts[0];
  if (draft) {
    // A draft may retain a published version with a Host action. This suggestion
    // is explicitly about editing, so keep its canonical authoring destination.
    actions.push({ kind: "draft", href: draft.editHref, title: draft.title });
  }
  if (latestReadyResult) {
    actions.push({
      kind: "readyResult",
      href: latestReadyResult.href,
      title: latestReadyResult.title,
    });
  }

  return {
    recentDrafts,
    readyResults,
    latestReadyResult,
    assignmentProgress,
    // The server caps the active Round query at 250 and omits its hasMore flag.
    // At or beyond that boundary the combined tally is safely only a lower bound.
    activeSessionsLowerBound: summary.totals.activeSessions >= 250,
    actions: actions.slice(0, 3),
  };
}
