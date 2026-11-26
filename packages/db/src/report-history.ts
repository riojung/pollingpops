import {
  REPORT_HISTORY_ACTIVITY_BUCKET_LIMIT,
  type Report,
  type ReportHistoryAnalytics,
} from "@openround/contracts";

function countActivityBucket(buckets: ReportHistoryAnalytics["activity"]["month"], start: string) {
  const index = buckets.findIndex((bucket) => bucket.start >= start);
  const bucket = buckets[index];
  if (bucket?.start === start) {
    bucket.count += 1;
    return;
  }
  buckets.splice(index === -1 ? buckets.length : index, 0, { start, count: 1 });
  if (buckets.length > REPORT_HISTORY_ACTIVITY_BUCKET_LIMIT) buckets.shift();
}

export function countHistoryActivity(
  activity: ReportHistoryAnalytics["activity"],
  createdAt: Date,
) {
  const month = createdAt.toISOString().slice(0, 7);
  const quarterMonth = Math.floor(createdAt.getUTCMonth() / 3) * 3 + 1;
  const quarter = `${month.slice(0, 4)}-${String(quarterMonth).padStart(2, "0")}`;
  countActivityBucket(activity.month, `${month}-01`);
  countActivityBucket(activity.quarter, `${quarter}-01`);
}

/** Historical report schemas store zero even when no assessed response was collected. */
export function reportHistoryInitialAccuracyPercent(report: Report): number | null {
  if ("initialAccuracy" in report) {
    return report.initialAccuracy.responses > 0 ? report.initialAccuracy.percent : null;
  }
  // V1 has no assessed-response denominator; preserve its existing answered-report semantics.
  return report.metrics.answerCount > 0 ? report.metrics.accuracyPercent : null;
}
