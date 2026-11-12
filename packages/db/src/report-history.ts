import type { Report } from "@openround/contracts";

/** Historical report schemas store zero even when no assessed response was collected. */
export function reportHistoryInitialAccuracyPercent(report: Report): number | null {
  if ("initialAccuracy" in report) {
    return report.initialAccuracy.responses > 0 ? report.initialAccuracy.percent : null;
  }
  // V1 has no assessed-response denominator; preserve its existing answered-report semantics.
  return report.metrics.answerCount > 0 ? report.metrics.accuracyPercent : null;
}
