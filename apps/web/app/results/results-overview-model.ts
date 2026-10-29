import type { FollowupSummary, ReportSummary } from "../../components/workspace/workspace-types";
import type { SurveySessionSummary } from "../../lib/session-controls";

export interface PresentationResultSummary {
  id: string;
  presentationId: string;
  title: string;
  status: "active" | "finished";
  phase: string;
  participantCount: number;
  responseCount: number;
  blockCount: number;
  createdAt: string;
  finishedAt?: string | null;
}

/** Zero opportunities means no rate evidence, rather than a measured zero percent. */
export function evidencePercent(completed: number, total: number): number | null {
  return total > 0 ? Math.max(0, Math.min(100, (completed / total) * 100)) : null;
}

export function roundOverview(
  items: readonly Pick<ReportSummary, "status" | "recovery" | "followupId">[],
) {
  const ready = items.filter((item) => item.status === "ready");
  const recovered = ready.reduce((sum, item) => sum + item.recovery.recovered, 0);
  const eligible = ready.reduce((sum, item) => sum + item.recovery.eligible, 0);
  return {
    count: items.length,
    ready: ready.length,
    pending: items.filter((item) => item.status === "pending").length,
    failed: items.filter((item) => item.status === "failed").length,
    recovered,
    eligible,
    recoveryPercent: evidencePercent(recovered, eligible),
    followups: ready.filter((item) => item.followupId !== null).length,
  };
}

export function practiceOverview(
  items: readonly Pick<FollowupSummary, "status" | "attemptCount" | "completedAttemptCount">[],
) {
  const attempts = items.reduce((sum, item) => sum + item.attemptCount, 0);
  const completed = items.reduce((sum, item) => sum + item.completedAttemptCount, 0);
  return {
    count: items.length,
    attempts,
    completed,
    percent: evidencePercent(completed, attempts),
    open: items.filter((item) => item.status === "open").length,
    scheduled: items.filter((item) => item.status === "scheduled").length,
    closed: items.filter((item) => item.status === "closed").length,
    expired: items.filter((item) => item.status === "expired").length,
  };
}

export function presentationOverview(
  items: readonly Pick<PresentationResultSummary, "status" | "responseCount">[],
) {
  return {
    count: items.length,
    responses: items.reduce((sum, item) => sum + item.responseCount, 0),
    finished: items.filter((item) => item.status === "finished").length,
    active: items.filter((item) => item.status === "active").length,
  };
}

export function surveyOverview(items: readonly Pick<SurveySessionSummary, "surveyId">[]) {
  return { count: items.length, sources: new Set(items.map((item) => item.surveyId)).size };
}
