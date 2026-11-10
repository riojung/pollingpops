import type {
  ReportV2,
  ReportV3,
  ReportV4,
  ReportV5,
  ReportV6,
  ReportV7,
} from "@openround/contracts";

export function deriveRecoverySummary(
  report: ReportV2 | ReportV3 | ReportV4 | ReportV5 | ReportV6 | ReportV7,
) {
  const recovered = report.recovery.reduce((total, item) => total + item.recovered, 0);
  const denominator = report.recovery.reduce(
    (total, item) => total + item.initiallyIncorrectWithBoth,
    0,
  );
  const unresolved = [...report.unresolvedConcepts]
    .filter((concept) => concept.unresolved > 0)
    .sort(
      (left, right) =>
        right.unresolved - left.unresolved || left.conceptKey.localeCompare(right.conceptKey),
    );
  const highConfidenceWrong =
    report.confidenceMatrix.find((row) => row.confidence === 3)?.incorrect ?? 0;
  const correctButUnsure =
    report.confidenceMatrix.find((row) => row.confidence === 1)?.correct ?? 0;
  const evidenceTypes = [...new Set(report.recovery.map((item) => item.evidenceType))];
  const smallSample =
    report.recovery.length > 0 && report.recovery.some((item) => item.smallSample);
  // Concept rows describe observed initially incorrect responses, not all authored
  // concepts. An absent row set cannot establish a measured zero.
  const conceptEvidenceCount = report.unresolvedConcepts.length;
  const initialSmallSample =
    report.initialAccuracy.responses > 0 && report.initialAccuracy.responses < 5;
  const initialAccuracyPercent =
    report.initialAccuracy.responses > 0 ? report.initialAccuracy.percent : null;

  return {
    recovered,
    denominator,
    recoveryPercent: denominator === 0 ? null : Math.round((recovered / denominator) * 1_000) / 10,
    unresolved,
    topUnresolved: unresolved[0] ?? null,
    highConfidenceWrong,
    correctButUnsure,
    evidenceTypes,
    smallSample,
    initialSmallSample,
    initialAccuracyPercent,
    conceptEvidenceCount,
    nextAction:
      unresolved.length > 0
        ? "Create focused practice for the unresolved concepts."
        : denominator > 0
          ? "Review the recovery evidence, then plan a later retention check."
          : "Add a linked recheck next time to collect recovery evidence.",
  };
}
