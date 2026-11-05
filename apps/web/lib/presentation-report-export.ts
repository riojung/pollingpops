import { PresentationReportSchema, type PresentationReport } from "@openround/contracts";

export function presentationReportUrl(sessionId: string) {
  return `/v1/presentation-sessions/${encodeURIComponent(sessionId)}/report?includeSessionContext=true&includeQuickChecks=true&includeOpinionResults=true&includeTextResults=true&includeNavigation=true&includeInteractions=true`;
}

export function presentationReportBlockNavigation(report: PresentationReport, blockId: string) {
  return report.schemaVersion === 6 || report.schemaVersion === 7
    ? (report.navigation.blocks.find(
        (block) => block.blockId.toLowerCase() === blockId.toLowerCase(),
      ) ?? null)
    : null;
}

export function presentationReportBlockTitle(report: PresentationReport, blockId: string) {
  const block = report.evidence.find(
    (entry) => entry.blockId.toLowerCase() === blockId.toLowerCase(),
  );
  return block?.kind === "content" ? block.title : (block?.prompt ?? blockId);
}

/** Quote every cell and keep authored spreadsheet formulas literal, including hidden prefixes. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // eslint-disable-next-line no-control-regex -- Control bytes can hide a spreadsheet formula prefix.
  if (/^[\s\u0000-\u001f\u007f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function presentationReportCsv(input: PresentationReport): string {
  const report = PresentationReportSchema.parse(input);
  const textColumns =
    report.schemaVersion === 5 || report.schemaVersion === 6 || report.schemaVersion === 7
      ? [
          "approved_text",
          "word_or_phrase",
          "term_count",
          "approved_respondents",
          "percent_of_approved_respondents",
        ]
      : [];
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
      ...textColumns,
    ],
  ];
  for (const block of report.evidence) {
    const navigation = presentationReportBlockNavigation(report, block.blockId);
    const base =
      block.kind === "content"
        ? [block.blockIndex + 1, block.blockId, block.kind, block.title, "", "", "", "", ""]
        : [
            block.blockIndex + 1,
            block.blockId,
            block.kind,
            block.prompt,
            block.questionType,
            navigation?.status === "skipped" ? "" : block.respondents,
            navigation?.status === "skipped" ? "" : block.correct,
            navigation?.status === "skipped" ? "" : block.accuracyPercent,
            navigation?.status === "skipped" ? "" : block.totalScore,
          ];
    const summary =
      block.kind === "question" && "opinionSummary" in block ? block.opinionSummary : undefined;
    const text =
      block.kind === "question" && "textResults" in block ? block.textResults : undefined;
    if (text) {
      if (text.kind === "open_text")
        for (const entry of text.entries)
          rows.push([...base, ...Array(17).fill(""), entry.value, "", "", text.respondents, ""]);
      else
        for (const term of text.buckets)
          rows.push([
            ...base,
            ...Array(17).fill(""),
            "",
            term.label,
            term.count,
            text.respondents,
            term.percent,
          ]);
      continue;
    }
    if (!summary) {
      rows.push([...base, ...Array(17 + textColumns.length).fill("")]);
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
          ...Array(textColumns.length).fill(""),
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
          ...Array(textColumns.length).fill(""),
        ]);
    }
  }
  if (report.schemaVersion === 6 || report.schemaVersion === 7) {
    rows[0]!.push(
      "section_id",
      "section_title",
      "presentation_status",
      "saved_phase",
      "navigation_jump_count",
      "navigation_return_count",
    );
    for (const row of rows.slice(1)) {
      const navigation = presentationReportBlockNavigation(report, String(row[1]));
      row.push(
        navigation?.sectionId,
        navigation?.sectionTitle,
        navigation?.status,
        navigation?.phase,
        report.navigation.jumpCount,
        report.navigation.returnCount,
      );
    }
  }
  if (report.schemaVersion === 7) {
    rows[0]!.push("broadcast_reveal_change_count", "answer_branch_count");
    for (const row of rows.slice(1))
      row.push(report.interactionSummary.revealChangeCount, report.interactionSummary.branchCount);
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
