import {
  PRESENTATION_READING_REPORT_MINIMUM,
  PresentationReadingReportSchema,
} from "@openround/contracts";
import type { PresentationAssignmentRecord, PresentationReadingReportRecord } from "@openround/db";

export function assignmentMetadata(record: PresentationAssignmentRecord) {
  return {
    id: record.id,
    mode: "reading" as const,
    versionId: record.versionId,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}

/** Counts only: do not project attempt identities, credentials or individual activity times. */
export function projectPresentationReadingReport(value: PresentationReadingReportRecord) {
  const minimum = PRESENTATION_READING_REPORT_MINIMUM;
  const enough = value.started >= minimum;
  const visiblePair = (count: number) =>
    enough &&
    (count === 0 || count >= minimum) &&
    (value.started - count === 0 || value.started - count >= minimum);
  const completionVisible = visiblePair(value.completed);
  return PresentationReadingReportSchema.parse({
    schemaVersion: 1,
    assignment: assignmentMetadata(value.assignment),
    generatedAt: value.generatedAt.toISOString(),
    minimumAttempts: minimum,
    startedAttempts: enough ? value.started : null,
    completedAttempts: completionVisible ? value.completed : null,
    inProgressAttempts: completionVisible ? value.started - value.completed : null,
    pages: value.blockIds.map((blockId, index) => {
      const read = value.readCounts[blockId] ?? 0;
      // Completed attempts are a known subset of each read group. Their difference
      // must not expose a small group of in-progress readers either.
      const inProgressRead = read - value.completed;
      const visible =
        visiblePair(read) &&
        (!completionVisible || inProgressRead === 0 || inProgressRead >= minimum);
      return { blockId, pageNumber: index + 1, readAttempts: visible ? read : null };
    }),
  });
}
