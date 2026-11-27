import type {
  FollowupHistoryAnalytics,
  PresentationResultSummary,
  ReportHistoryAnalytics,
  SurveyResultSummary,
} from "@openround/contracts";
import type { FollowupSummary, ReportSummary } from "../../components/workspace/workspace-types";

export type { PresentationResultSummary } from "@openround/contracts";

export type ResultsActivityGrouping = "month" | "quarter";

export interface ResultsActivityPeriod {
  start: Date;
  end: Date;
  count: number;
}

/** History analytics groups creation dates by UTC calendar periods. */
export function utcHistoryActivity(
  activity: ReportHistoryAnalytics["activity"],
  grouping: ResultsActivityGrouping,
): ResultsActivityPeriod[] {
  const monthsPerPeriod = grouping === "month" ? 1 : 3;
  return activity[grouping].map((bucket) => {
    const start = new Date(`${bucket.start}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(start.getUTCMonth() + monthsPerPeriod, 0);
    return { start, end, count: bucket.count };
  });
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
  const totals = {
    open: 0,
    scheduled: 0,
    closed: 0,
    expired: 0,
    attemptCount: 0,
    completedAttemptCount: 0,
  };
  for (const item of items) {
    totals[item.status] += 1;
    totals.attemptCount += item.attemptCount;
    totals.completedAttemptCount += item.completedAttemptCount;
  }
  return practiceTotalsOverview(totals);
}

export function practiceTotalsOverview({
  attemptCount: attempts,
  completedAttemptCount: completed,
  open,
  scheduled,
  closed,
  expired,
}: Omit<FollowupHistoryAnalytics, "activity">) {
  return {
    count: open + scheduled + closed + expired,
    attempts,
    completed,
    percent: evidencePercent(completed, attempts),
    open,
    scheduled,
    closed,
    expired,
  };
}

export function presentationOverview(
  items: readonly Pick<PresentationResultSummary, "status" | "participantCount">[],
) {
  return {
    count: items.length,
    joins: items.reduce((sum, item) => sum + item.participantCount, 0),
    finished: items.filter((item) => item.status === "finished").length,
    active: items.filter((item) => item.status === "active").length,
  };
}

export function surveyOverview(items: readonly Pick<SurveyResultSummary, "surveyId">[]) {
  return { count: items.length, sources: new Set(items.map((item) => item.surveyId)).size };
}
