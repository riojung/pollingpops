import type { SummaryExportFormat, SummaryLocale } from "@openround/contracts";

export const MAX_SUMMARY_INPUT_BYTES = 1_048_576;
export const MAX_SUMMARY_OUTPUT_BYTES = 16_777_216;
export const MAX_SUMMARY_PDF_PAGES = 256;
export const SUMMARY_PNG_WIDTH = 1600;
export const SUMMARY_PNG_HEIGHT = 2000;

export interface SessionSummaryRenderOptions {
  format: SummaryExportFormat;
  locale: SummaryLocale;
  questionIndex?: number;
}
export interface SessionSummaryExportResult {
  bytes: Buffer;
  contentType: string;
  extension: SummaryExportFormat;
}
export type SessionSummaryExportErrorCode =
  | "EXPORT_BUSY"
  | "EXPORT_TIMEOUT"
  | "EXPORT_TOO_LARGE"
  | "EXPORT_INVALID"
  | "EXPORT_CLOSED"
  | "EXPORT_FAILED"
  | "EXPORT_ABORTED";

export class SessionSummaryExportError extends Error {
  readonly statusCode: number;
  constructor(
    readonly code: SessionSummaryExportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionSummaryExportError";
    this.statusCode = {
      EXPORT_BUSY: 503,
      EXPORT_TIMEOUT: 504,
      EXPORT_TOO_LARGE: 413,
      EXPORT_INVALID: 400,
      EXPORT_CLOSED: 503,
      EXPORT_FAILED: 500,
      EXPORT_ABORTED: 499,
    }[code];
  }
}

export function assertSummaryOutputSize(size: number) {
  if (size > MAX_SUMMARY_OUTPUT_BYTES) {
    throw new SessionSummaryExportError(
      "EXPORT_TOO_LARGE",
      "The summary export exceeds the file size limit",
    );
  }
}
