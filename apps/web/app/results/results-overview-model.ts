import type { PresentationReportStatus, ReportHistoryAnalytics } from "@openround/contracts";
import type { FollowupSummary, ReportSummary } from "../../components/workspace/workspace-types";
import type { SurveySessionSummary } from "../../lib/session-controls";

export interface PresentationResultSummary {
  id: string;
  presentationId: string;
  title: string;
  status: "active" | "finished";
  reportStatus?: PresentationReportStatus | null;
  phase: string;
  participantCount: number;
  responseCount: number;
  blockCount: number;
  createdAt: string;
  finishedAt?: string | null;
}

export type ResultsActivityGrouping = "month" | "quarter";

export interface ResultsActivityPeriod {
  start: Date;
  end: Date;
  count: number;
}

/** The report analytics endpoint groups creation dates by UTC calendar periods. */
export function roundReportActivity(
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

/** Returns the most recent represented periods using inclusive local calendar days. */
export function resultsActivity(dates: readonly string[], grouping: ResultsActivityGrouping) {
  const monthsPerPeriod = grouping === "month" ? 1 : 3;
  const buckets = new Map<number, ResultsActivityPeriod>();
  for (const value of dates) {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = new Date(dateOnly ? `${value}T00:00:00` : value);
    if (
      !Number.isFinite(date.getTime()) ||
      (dateOnly && date.getDate() !== Number(value.slice(-2)))
    )
      continue;

    const year = date.getFullYear();
    const month = Math.floor(date.getMonth() / monthsPerPeriod) * monthsPerPeriod;
    const key = year * 12 + month;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
    } else {
      const start = new Date(date);
      start.setFullYear(year, month, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setFullYear(year, month + monthsPerPeriod, 0);
      end.setHours(0, 0, 0, 0);
      buckets.set(key, { start, end, count: 1 });
    }
  }

  return [...buckets.values()]
    .sort((left, right) => left.start.getTime() - right.start.getTime())
    .slice(-6);
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
  items: readonly Pick<PresentationResultSummary, "status" | "participantCount">[],
) {
  return {
    count: items.length,
    joins: items.reduce((sum, item) => sum + item.participantCount, 0),
    finished: items.filter((item) => item.status === "finished").length,
    active: items.filter((item) => item.status === "active").length,
  };
}

export function surveyOverview(items: readonly Pick<SurveySessionSummary, "surveyId">[]) {
  return { count: items.length, sources: new Set(items.map((item) => item.surveyId)).size };
}
