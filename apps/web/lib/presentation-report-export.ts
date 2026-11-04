import { PresentationReportSchema, type PresentationReport } from "@openround/contracts";

/** Quote every cell and keep authored spreadsheet formulas literal, including hidden prefixes. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // eslint-disable-next-line no-control-regex -- Control bytes can hide a spreadsheet formula prefix.
  if (/^[\s\u0000-\u001f\u007f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function presentationReportCsv(input: PresentationReport): string {
  const report = PresentationReportSchema.parse(input);
  const rows: unknown[][] = [
    [
      "block_number",
      "block_id",
      "kind",
      "title_or_prompt",
      "question_type",
      "respondents",
      "correct_responses",
      "accuracy_percent",
      "participant_score_total",
      "choice_id",
      "choice_label",
      "max_selections",
      "total_selections",
      "selection_count",
      "percent_of_respondents",
      "rank_count",
      "total_rankings",
      "ranked_respondents",
      "weighted_rank_points",
      "average_rank",
      ...Array.from({ length: 6 }, (_, index) => `rank_${index + 1}_count`),
    ],
  ];
  for (const block of report.evidence) {
    const base =
      block.kind === "content"
        ? [block.blockIndex + 1, block.blockId, block.kind, block.title, "", "", "", "", ""]
        : [
            block.blockIndex + 1,
            block.blockId,
            block.kind,
            block.prompt,
            block.questionType,
            block.respondents,
            block.correct,
            block.accuracyPercent,
            block.totalScore,
          ];
    const summary =
      block.kind === "question" && "opinionSummary" in block ? block.opinionSummary : undefined;
    if (!summary) {
      rows.push([...base, ...Array(17).fill("")]);
      continue;
    }
    for (const choice of summary.choices) {
      if (summary.kind === "poll" && "count" in choice)
        rows.push([
          ...base,
          choice.choiceId,
          choice.label,
          summary.maxSelections,
          summary.totalSelections,
          choice.count,
          choice.percentOfRespondents,
          "",
          "",
          "",
          "",
          "",
          ...Array(6).fill(""),
        ]);
      else if (summary.kind === "ranking" && "weightedScore" in choice)
        rows.push([
          ...base,
          choice.choiceId,
          choice.label,
          "",
          "",
          "",
          "",
          summary.rankCount,
          summary.totalRankings,
          choice.rankedRespondents,
          choice.weightedScore,
          choice.averageRank,
          ...Array.from({ length: 6 }, (_, index) => choice.rankCounts[index] ?? ""),
        ]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
