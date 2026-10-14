import { randomUUID } from "node:crypto";
import {
  OpenRoundCheckpointSetExportSchema,
  QuestionDraftSchema,
  QuizContentSchema,
  QuizDraftSchema,
  requiresExtendedRoundResponses,
  hasRankingQuestions,
  hasTextOpinionQuestions,
  questionPurpose,
  type ImportValidationReport,
  type QuestionDraft,
  type QuizDraft,
} from "@openround/contracts";

type ImportFormat = Exclude<ImportValidationReport["format"], "qti3">;
type ImportIssue = ImportValidationReport["errors"][number];

export type CheckpointSetImportResult = {
  draft: QuizDraft | null;
  validation: ImportValidationReport;
};

const csvHeaders = [
  "source_id",
  "linked_recheck_source_id",
  "type",
  "prompt",
  "purpose",
  "confidence",
  "delivery",
  "concept_keys_json",
  "choices_json",
  "correct_value",
  "tolerance",
  "unit",
  "rating_min",
  "rating_max",
  "rating_min_label",
  "rating_max_label",
  "time_limit_seconds",
  "base_points",
  "explanation",
  "max_selections",
  "rank_count",
] as const;

function issue(
  severity: ImportIssue["severity"],
  code: string,
  message: string,
  details: Pick<ImportIssue, "row" | "field"> = {},
): ImportIssue {
  return { severity, code, message, ...details };
}

function validation(
  format: ImportFormat,
  importedCheckpoints: number,
  issues: ImportIssue[],
): ImportValidationReport {
  return {
    format,
    importedCheckpoints,
    errors: issues.filter((candidate) => candidate.severity === "error"),
    warnings: issues.filter((candidate) => candidate.severity === "warning"),
  };
}

export function csvFormulaEscapingRequired(value: string) {
  return /^(?:\s*[=+@-]|[\t\r\n])/.test(value);
}

function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const protectedValue = csvFormulaEscapingRequired(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(protectedValue)
    ? `"${protectedValue.replaceAll('"', '""')}"`
    : protectedValue;
}

function portableDraft(draft: QuizDraft, issues: ImportIssue[]) {
  const cloned = structuredClone(draft);
  for (const [index, checkpoint] of cloned.questions.entries()) {
    if (checkpoint.mediaId) {
      issues.push(
        issue(
          "warning",
          "MEDIA_REFERENCE_REMOVED",
          "Private media is not embedded in this format; attach the image again after import.",
          { row: index + 1, field: "mediaId" },
        ),
      );
      checkpoint.mediaId = null;
      checkpoint.mediaAlt = null;
    }
  }
  return cloned;
}

function regenerateIds(draft: QuizDraft) {
  const questionIds = new Map(draft.questions.map((question) => [question.id, randomUUID()]));
  return {
    ...draft,
    ...(draft.recoveryPackInsertions
      ? {
          recoveryPackInsertions: draft.recoveryPackInsertions.map((insertion) => ({
            ...insertion,
            id: randomUUID(),
            diagnosticQuestionId: questionIds.get(insertion.diagnosticQuestionId) ?? randomUUID(),
            recheckQuestionId: questionIds.get(insertion.recheckQuestionId) ?? randomUUID(),
          })),
        }
      : {}),
    questions: draft.questions.map((question) => ({
      ...question,
      id: questionIds.get(question.id)!,
      linkedRecheckQuestionId: question.linkedRecheckQuestionId
        ? (questionIds.get(question.linkedRecheckQuestionId) ?? null)
        : null,
      ...("choices" in question
        ? {
            choices: question.choices.map((choice) => ({ ...choice, id: randomUUID() })),
          }
        : {}),
    })) as QuestionDraft[],
  } satisfies QuizDraft;
}

function incompleteWarnings(draft: QuizDraft, issues: ImportIssue[]) {
  const result = QuizContentSchema.safeParse(draft);
  if (result.success) return;
  for (const problem of result.error.issues.slice(0, 50)) {
    const row =
      problem.path[0] === "questions" && typeof problem.path[1] === "number"
        ? problem.path[1] + 1
        : undefined;
    issues.push(
      issue("warning", "DRAFT_INCOMPLETE", problem.message, {
        ...(row ? { row } : {}),
        field: problem.path.map(String).join("."),
      }),
    );
  }
}

export function openRoundJson(draft: QuizDraft) {
  return JSON.stringify(
    OpenRoundCheckpointSetExportSchema.parse({
      format: "openround.checkpoint-set",
      version: hasTextOpinionQuestions(draft)
        ? 7
        : hasRankingQuestions(draft)
          ? 6
          : requiresExtendedRoundResponses(draft)
            ? 5
            : draft.recoveryPackInsertions?.some((insertion) => insertion.updateBaseline)
              ? 4
              : draft.recoveryPackInsertions?.length ||
                  draft.questions.some((question) => question.recoveryPackSource)
                ? 3
                : 2,
      exportedAt: new Date().toISOString(),
      checkpointSet: draft,
    }),
    null,
    2,
  );
}

export function checkpointSetCsv(draft: QuizDraft) {
  const rows: unknown[][] = [csvHeaders.slice()];
  for (const checkpoint of draft.questions) {
    rows.push([
      checkpoint.id,
      checkpoint.linkedRecheckQuestionId ?? "",
      checkpoint.type,
      checkpoint.prompt,
      questionPurpose(checkpoint),
      checkpoint.confidence ?? "off",
      checkpoint.delivery ?? "main",
      JSON.stringify(checkpoint.conceptKeys ?? []),
      "choices" in checkpoint
        ? JSON.stringify(
            checkpoint.choices.map(({ label, isCorrect, feedback, misconceptionKey }) => ({
              label,
              isCorrect,
              ...(feedback ? { feedback } : {}),
              ...(misconceptionKey ? { misconceptionKey } : {}),
            })),
          )
        : "",
      checkpoint.type === "numeric" ? checkpoint.correctValue : "",
      checkpoint.type === "numeric" ? checkpoint.tolerance : "",
      checkpoint.type === "numeric" ? (checkpoint.unit ?? "") : "",
      checkpoint.type === "rating" ? checkpoint.min : "",
      checkpoint.type === "rating" ? checkpoint.max : "",
      checkpoint.type === "rating" ? checkpoint.minLabel : "",
      checkpoint.type === "rating" ? checkpoint.maxLabel : "",
      checkpoint.timeLimitSeconds,
      checkpoint.basePoints,
      checkpoint.explanation,
      checkpoint.type === "poll" ? (checkpoint.maxSelections ?? 1) : "",
      checkpoint.type === "ranking" ? (checkpoint.rankCount ?? checkpoint.choices.length) : "",
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function parseCsv(data: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = data.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (rows.length > 201) throw new Error("CSV supports at most 200 checkpoints");
  return rows;
}

function importedCell(value: string) {
  return value.startsWith("'") && csvFormulaEscapingRequired(value.slice(1))
    ? value.slice(1)
    : value;
}

function integer(value: string, fallback: number) {
  return value.trim() ? Number.parseInt(value, 10) : fallback;
}

function importJson(data: string, title?: string): CheckpointSetImportResult {
  const issues: ImportIssue[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return {
      draft: null,
      validation: validation("openround_json", 0, [
        issue("error", "INVALID_JSON", "The Polling Pops JSON file is not valid JSON."),
      ]),
    };
  }
  const parsed = OpenRoundCheckpointSetExportSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      draft: null,
      validation: validation(
        "openround_json",
        0,
        parsed.error.issues.map((problem) =>
          issue("error", "INVALID_OPENROUND_JSON", problem.message, {
            field: problem.path.map(String).join("."),
          }),
        ),
      ),
    };
  }
  const checkpointSet =
    parsed.data.version === 1
      ? {
          ...parsed.data.checkpointSet,
          category: "general" as const,
          experiencePreset: { id: "focus" as const, version: 1 as const },
        }
      : parsed.data.checkpointSet;
  if (parsed.data.version === 1) {
    issues.push(
      issue(
        "warning",
        "PRESENTATION_DEFAULTED",
        "This version 1 file had no experience preset; Focus was selected.",
      ),
    );
  }
  const draft = regenerateIds(portableDraft(checkpointSet, issues));
  if (title) draft.title = title;
  else if (!draft.title.trim()) {
    draft.title = "Imported checkpoint set";
    issues.push(
      issue(
        "warning",
        "TITLE_DEFAULTED",
        "The source had no title, so a default title was assigned.",
        { field: "title" },
      ),
    );
  }
  incompleteWarnings(draft, issues);
  return { draft, validation: validation("openround_json", draft.questions.length, issues) };
}

function importCsv(data: string, title?: string): CheckpointSetImportResult {
  const issues: ImportIssue[] = [
    issue(
      "warning",
      "PRESENTATION_DEFAULTED",
      "CSV does not carry presentation metadata; General with the Focus preset was selected.",
    ),
  ];
  let rows: string[][];
  try {
    rows = parseCsv(data);
  } catch (error) {
    return {
      draft: null,
      validation: validation("csv", 0, [
        issue("error", "INVALID_CSV", error instanceof Error ? error.message : "Invalid CSV"),
      ]),
    };
  }
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  // Older CSV files predate opinion-poll selection limits and retain a limit of one.
  const missingHeaders = csvHeaders.filter(
    (header) => !["max_selections", "rank_count"].includes(header) && !headers.includes(header),
  );
  if (duplicateHeaders.length || missingHeaders.length) {
    if (duplicateHeaders.length) {
      issues.push(
        issue(
          "error",
          "DUPLICATE_HEADERS",
          `Duplicate CSV columns: ${duplicateHeaders.join(", ")}`,
        ),
      );
    }
    if (missingHeaders.length) {
      issues.push(
        issue("error", "MISSING_HEADERS", `Missing CSV columns: ${missingHeaders.join(", ")}`),
      );
    }
    return { draft: null, validation: validation("csv", 0, issues) };
  }
  const indexes = new Map(headers.map((header, index) => [header, index]));
  const value = (row: string[], header: (typeof csvHeaders)[number]) =>
    importedCell(row[indexes.get(header)!] ?? "");
  const ids = new Map<string, string>();
  for (const [index, row] of rows.entries()) {
    const sourceId = value(row, "source_id") || `row-${index + 2}`;
    if (ids.has(sourceId)) {
      issues.push(
        issue("error", "DUPLICATE_SOURCE_ID", `Duplicate source_id ${sourceId}.`, {
          row: index + 2,
          field: "source_id",
        }),
      );
    } else ids.set(sourceId, randomUUID());
  }

  const checkpoints: QuestionDraft[] = [];
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    try {
      const sourceId = value(row, "source_id") || `row-${rowNumber}`;
      const type = value(row, "type");
      const selectionLimit = value(row, "max_selections");
      if (selectionLimit && (type !== "poll" || !/^[1-6]$/.test(selectionLimit))) {
        throw new Error("max_selections must be a whole number from one to six for a poll");
      }
      const rankCount = value(row, "rank_count");
      if (rankCount && (type !== "ranking" || !/^[1-6]$/.test(rankCount))) {
        throw new Error("rank_count must be a whole number from one to six for a ranking question");
      }
      if (
        ![
          "single_select",
          "true_false",
          "multi_select",
          "numeric",
          "rating",
          "poll",
          "ranking",
          "open_text",
          "word_cloud",
        ].includes(type)
      ) {
        throw new Error(`Unsupported checkpoint type: ${type || "blank"}`);
      }
      const linkedSourceId = value(row, "linked_recheck_source_id");
      if (linkedSourceId && !ids.has(linkedSourceId)) {
        throw new Error(`Linked recheck source_id ${linkedSourceId} does not exist`);
      }
      const common = {
        id: ids.get(sourceId)!,
        type,
        prompt: value(row, "prompt"),
        purpose:
          value(row, "purpose") ||
          (["poll", "rating", "ranking", "open_text", "word_cloud"].includes(type)
            ? "opinion"
            : "diagnostic"),
        confidence: value(row, "confidence") || "off",
        delivery: value(row, "delivery") || "main",
        conceptKeys: JSON.parse(value(row, "concept_keys_json") || "[]") as unknown,
        linkedRecheckQuestionId: linkedSourceId ? (ids.get(linkedSourceId) ?? null) : null,
        timeLimitSeconds: integer(value(row, "time_limit_seconds"), 20),
        basePoints: integer(
          value(row, "base_points"),
          ["poll", "rating", "ranking", "open_text", "word_cloud"].includes(type) ? 0 : 1_000,
        ),
        explanation: value(row, "explanation"),
        mediaId: null,
        mediaAlt: null,
      };
      let checkpoint: unknown;
      if (["single_select", "true_false", "multi_select", "poll", "ranking"].includes(type)) {
        const choices = JSON.parse(value(row, "choices_json") || "[]") as Array<
          Record<string, unknown>
        >;
        checkpoint = {
          ...common,
          choices: choices.map((choice) => ({ ...choice, id: randomUUID() })),
          ...(type === "poll" && selectionLimit ? { maxSelections: Number(selectionLimit) } : {}),
          ...(type === "ranking" && rankCount ? { rankCount: Number(rankCount) } : {}),
        };
      } else if (type === "numeric") {
        checkpoint = {
          ...common,
          correctValue: value(row, "correct_value"),
          tolerance: value(row, "tolerance"),
          unit: value(row, "unit") || null,
        };
      } else if (type === "rating") {
        checkpoint = {
          ...common,
          min: integer(value(row, "rating_min"), 1),
          max: integer(value(row, "rating_max"), 5),
          minLabel: value(row, "rating_min_label"),
          maxLabel: value(row, "rating_max_label"),
        };
      } else {
        checkpoint = common;
      }
      const parsed = QuestionDraftSchema.safeParse(checkpoint);
      if (!parsed.success) {
        for (const problem of parsed.error.issues) {
          issues.push(
            issue("error", "INVALID_CHECKPOINT", problem.message, {
              row: rowNumber,
              field: problem.path.map(String).join("."),
            }),
          );
        }
      } else checkpoints.push(parsed.data);
    } catch (error) {
      issues.push(
        issue(
          "error",
          "INVALID_CHECKPOINT",
          error instanceof Error ? error.message : "Invalid checkpoint row",
          { row: rowNumber },
        ),
      );
    }
  }
  if (issues.some((candidate) => candidate.severity === "error")) {
    return { draft: null, validation: validation("csv", checkpoints.length, issues) };
  }
  const draft = QuizDraftSchema.parse({
    title: title ?? "Imported checkpoint set",
    description: "Imported from CSV",
    questions: checkpoints,
  });
  incompleteWarnings(draft, issues);
  return { draft, validation: validation("csv", draft.questions.length, issues) };
}

function importBulk(data: string, title?: string): CheckpointSetImportResult {
  const issues: ImportIssue[] = [
    issue(
      "warning",
      "PRESENTATION_DEFAULTED",
      "Bulk paste does not carry presentation metadata; General with the Focus preset was selected.",
    ),
  ];
  const blocks = data
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((block) => block.length > 0);
  if (blocks.length > 200) {
    return {
      draft: null,
      validation: validation("bulk", 0, [
        issue("error", "TOO_MANY_CHECKPOINTS", "Bulk paste supports at most 200 checkpoints."),
      ]),
    };
  }
  const questions: QuestionDraft[] = [];
  for (const [index, lines] of blocks.entries()) {
    const prompt = lines[0] ?? "";
    const answerLines = lines.slice(1);
    const unsupported = answerLines.find((line) => !/^[*-]\s+/.test(line));
    const correct = answerLines.filter((line) => line.startsWith("* "));
    if (!prompt || answerLines.length < 2 || correct.length !== 1 || unsupported) {
      issues.push(
        issue(
          "error",
          "INVALID_BULK_BLOCK",
          "Use a prompt followed by at least two choices; prefix exactly one correct choice with '* ' and others with '- '.",
          { row: index + 1 },
        ),
      );
      continue;
    }
    questions.push({
      id: randomUUID(),
      type: "single_select",
      prompt,
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      choices: answerLines.map((line) => ({
        id: randomUUID(),
        label: line.slice(2).trim(),
        isCorrect: line.startsWith("* "),
      })),
      timeLimitSeconds: 20,
      basePoints: 1_000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    });
  }
  if (issues.some((candidate) => candidate.severity === "error")) {
    return { draft: null, validation: validation("bulk", questions.length, issues) };
  }
  const parsed = QuizDraftSchema.safeParse({
    title: title ?? "Imported checkpoint set",
    description: "Imported from bulk paste",
    questions,
  });
  if (!parsed.success) {
    for (const problem of parsed.error.issues) {
      issues.push(
        issue("error", "INVALID_BULK_CONTENT", problem.message, {
          field: problem.path.map(String).join("."),
        }),
      );
    }
    return { draft: null, validation: validation("bulk", questions.length, issues) };
  }
  incompleteWarnings(parsed.data, issues);
  return {
    draft: parsed.data,
    validation: validation("bulk", parsed.data.questions.length, issues),
  };
}

export function importCheckpointSet(
  format: ImportFormat,
  data: string,
  title?: string,
): CheckpointSetImportResult {
  if (format === "openround_json") return importJson(data, title);
  if (format === "csv") return importCsv(data, title);
  return importBulk(data, title);
}
