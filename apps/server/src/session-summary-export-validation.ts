import {
  AggregateSessionSummarySchema,
  SummaryLocaleSchema,
  SummaryExportFormatSchema,
  type AggregateSessionSummary,
} from "@openround/contracts";
import {
  MAX_SUMMARY_INPUT_BYTES,
  SessionSummaryExportError,
  type SessionSummaryRenderOptions,
} from "./session-summary-export-types.js";

export function assertValidSummaryText(text: string) {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (
      (code < 32 && ![9, 10, 13].includes(code)) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      throw new SessionSummaryExportError(
        "EXPORT_INVALID",
        "Summary text contains an invalid Unicode or control character",
      );
    }
  }
}

export function validateSessionSummaryExport(
  summary: AggregateSessionSummary,
  options: SessionSummaryRenderOptions,
) {
  let serialized: string;
  try {
    serialized = JSON.stringify(summary);
  } catch {
    throw new SessionSummaryExportError("EXPORT_INVALID", "The summary export request is invalid");
  }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_SUMMARY_INPUT_BYTES) {
    throw new SessionSummaryExportError(
      "EXPORT_TOO_LARGE",
      "The summary exceeds the export input limit",
    );
  }
  const parsed = AggregateSessionSummarySchema.safeParse(summary);
  if (
    !parsed.success ||
    !SummaryLocaleSchema.safeParse(options.locale).success ||
    !SummaryExportFormatSchema.safeParse(options.format).success
  ) {
    throw new SessionSummaryExportError("EXPORT_INVALID", "The summary export request is invalid");
  }
  if (options.questionIndex !== undefined && options.format !== "png") {
    throw new SessionSummaryExportError(
      "EXPORT_INVALID",
      "Checkpoint selection is available for PNG images only",
    );
  }
  if (
    options.questionIndex !== undefined &&
    (!Number.isInteger(options.questionIndex) ||
      !parsed.data.questions.some((question) => question.index === options.questionIndex))
  ) {
    throw new SessionSummaryExportError("EXPORT_INVALID", "The selected checkpoint is unavailable");
  }
  assertValidSummaryText(parsed.data.title);
  assertValidSummaryText(parsed.data.nextSteps);
  for (const question of parsed.data.questions) {
    assertValidSummaryText(question.prompt);
    for (const result of question.results) assertValidSummaryText(result.label);
  }
  for (const recovery of parsed.data.recovery) assertValidSummaryText(recovery.label);
  return parsed.data;
}
