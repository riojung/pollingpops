import {
  PresentationReadingReportSchema,
  type PresentationReadingReport,
} from "@openround/contracts";
import { apiFetch } from "./api";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ReadingInsightsSource {
  presentationId: string;
  assignmentId: string;
  versionId: string;
}

function identifier(value: string) {
  if (!uuid.test(value)) throw new Error("The reading insights source could not be verified.");
  return value.toLowerCase();
}

export function verifyReadingInsights(input: unknown, source: ReadingInsightsSource) {
  identifier(source.presentationId);
  const assignmentId = identifier(source.assignmentId),
    versionId = identifier(source.versionId);
  const parsed = PresentationReadingReportSchema.safeParse(input);
  if (
    !parsed.success ||
    identifier(parsed.data.assignment.id) !== assignmentId ||
    identifier(parsed.data.assignment.versionId) !== versionId
  )
    throw new Error(
      "These reading insights could not be verified for this assignment and published version. Try loading again.",
    );
  return parsed.data;
}

export async function fetchReadingInsights(source: ReadingInsightsSource, signal: AbortSignal) {
  const presentationId = identifier(source.presentationId),
    assignmentId = identifier(source.assignmentId);
  identifier(source.versionId);
  signal.throwIfAborted();
  const value = await apiFetch<unknown>(
    `/v1/presentations/${presentationId}/assignments/${assignmentId}/insights`,
    {
      signal,
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { accept: "application/json" },
    },
  );
  signal.throwIfAborted();
  return verifyReadingInsights(value, source);
}

export function readingInsightCount(value: number | null) {
  return value === null ? "Suppressed" : String(value);
}

function csvCell(value: string) {
  let literal = value;
  // eslint-disable-next-line no-control-regex -- Hidden prefixes must not become spreadsheet formulas.
  if (/^[\s\u0000-\u001f\u007f]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value))
    literal = `'${value}`;
  return `"${literal.replaceAll('"', '""')}"`;
}

/** Export only this validated aggregate snapshot; never refetch or serialize arbitrary fields. */
export function readingInsightsCsv(
  input: PresentationReadingReport,
  source: ReadingInsightsSource,
) {
  const report = verifyReadingInsights(input, source);
  const rows: string[][] = [
    ["section", "label", "value", "page_block_id"],
    ["metadata", "Assignment ID", identifier(report.assignment.id), ""],
    ["metadata", "Published version ID", identifier(report.assignment.versionId), ""],
    ["metadata", "Observed at (UTC)", report.generatedAt, ""],
    ["metadata", "Minimum attempts", String(report.minimumAttempts), ""],
    ["note", "Measure", "Anonymous attempts, not people. Preview opens are not counted.", ""],
    [
      "note",
      "Completion",
      "Self-reported reading; no verified identity, assessment, mastery or time spent.",
      "",
    ],
    [
      "note",
      "Suppressed",
      "Hidden to protect small groups; never interpret as zero. Related counts may also be suppressed.",
      "",
    ],
    ["attempts", "Started attempts", readingInsightCount(report.startedAttempts), ""],
    ["attempts", "Completed attempts", readingInsightCount(report.completedAttempts), ""],
    ["attempts", "In-progress attempts", readingInsightCount(report.inProgressAttempts), ""],
    ...report.pages.map((page) => [
      "page",
      `Page ${page.pageNumber}`,
      readingInsightCount(page.readAttempts),
      identifier(page.blockId),
    ]),
  ];
  return `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function downloadReadingInsightsCsv(contents: string) {
  if (new TextEncoder().encode(contents).byteLength > 256 * 1024)
    throw new Error("The reading insights CSV exceeds the download limit.");
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  let released = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (released) return;
    released = true;
    if (timer !== undefined) clearTimeout(timer);
    URL.revokeObjectURL(url);
  };
  try {
    anchor.href = url;
    anchor.download = "polling-pops-reading-insights.csv";
    document.body.append(anchor);
    anchor.click();
    timer = setTimeout(release, 0);
  } catch (error) {
    release();
    throw error;
  } finally {
    anchor.remove();
  }
  return release;
}
