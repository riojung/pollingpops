import {
  PresentationSessionInsightsSchema,
  type PresentationInsightsPurpose,
  type PresentationSessionInsights,
} from "@openround/contracts";
import type {
  PresentationInsightsCopyKey,
  PresentationInsightsTranslator,
} from "./i18n/presentation-insights-copy";

export interface PresentationInsightsTable {
  title: string;
  /** UI language boundaries; downloadable copies use the canonical title and rows. */
  titleParts?: Array<{ text: string; authored: boolean }>;
  columns: string[];
  rows: string[][];
  authoredCells?: boolean[][];
  note?: string;
}
export interface PresentationInsightsView {
  title: string;
  facts: Array<[string, string]>;
  tables: PresentationInsightsTable[];
  qna: Array<[string, string]>;
  qnaNote: string;
  notes: string[];
}
const purposes: Record<PresentationInsightsPurpose, PresentationInsightsCopyKey> = {
  content: "Content",
  assessment: "Assessed activities",
  opinion: "Opinion activities",
  text: "Moderated text activities",
  quick_check: "Session-only Quick Checks",
  unknown: "Other activities",
};

const originalCopy: PresentationInsightsTranslator = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));

/** Translate constructed UI labels only. Downloads retain the original default labels. */
export function presentationInsightsView(
  input: PresentationSessionInsights,
  locale = "en-CA",
  copy: PresentationInsightsTranslator = originalCopy,
): PresentationInsightsView {
  const value = PresentationSessionInsightsSchema.parse(input);
  const number = (count: number) => count.toLocaleString(locale);
  const percent = (count: number | null) =>
    count === null
      ? copy("Not recorded")
      : `${count.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
  const date = (instant: string) => new Date(instant).toLocaleString(locale);
  const blocks = new Map(
    value.delivery.blocks.map((block) => [block.blockId.toLowerCase(), block]),
  );
  const blockTitle = (blockId: string) => {
    const block = blocks.get(blockId.toLowerCase());
    return block
      ? `${number(block.blockIndex + 1)}. ${block.title || copy("Untitled block")}`
      : copy("Not recorded");
  };
  const hasAuthoredBlockTitle = (blockId: string) =>
    Boolean(blocks.get(blockId.toLowerCase())?.title);
  const sectionTitles = new Map(
    value.delivery.sections.map((section) => [
      section.sectionId?.toLowerCase(),
      section.title ?? copy("Unsectioned"),
    ]),
  );
  const authoredSections = new Set(
    value.delivery.sections
      .filter((section) => section.title !== null)
      .map((section) => section.sectionId?.toLowerCase()),
  );
  const totals = value.delivery.totals;
  const facts: Array<[string, string]> = [
    [
      copy("Published version"),
      value.publishedVersion === null
        ? copy("Not recorded")
        : copy("Version {version}", { version: number(value.publishedVersion) }),
    ],
    [copy("Content"), copy("Frozen session content; session additions are marked below.")],
    [
      value.freshness.finishedAtBasis === "legacy_updated_at"
        ? copy("Finished (legacy transition timestamp)")
        : copy("Session finished"),
      date(value.freshness.finishedAt),
    ],
    [copy("Report generated"), date(value.freshness.reportGeneratedAt)],
    [copy("Insights calculated"), date(value.freshness.calculatedAt)],
    [copy("Retention ends"), date(value.freshness.retentionExpiresAt)],
    [
      copy("Recorded start"),
      value.delivery.startedAt === null ? copy("Not recorded") : date(value.delivery.startedAt),
    ],
    [
      copy("Elapsed wall-clock time"),
      value.delivery.wallClockElapsedSeconds === null
        ? copy("Not recorded")
        : copy("{seconds} seconds", { seconds: number(value.delivery.wallClockElapsedSeconds) }),
    ],
    [copy("Participant identities joined"), number(value.participation.joinedParticipantCount)],
    [copy("Accepted response records"), number(value.participation.acceptedResponseCount)],
    [
      copy("Blocks presented"),
      copy("{presented} of {total}", {
        presented: number(totals.presentedBlocks),
        total: number(totals.totalBlocks),
      }),
    ],
    [copy("Blocks skipped"), number(totals.skippedBlocks)],
    [copy("Blocks with delivery not recorded"), number(totals.unknownBlocks)],
    [copy("Delivery coverage"), percent(totals.coveragePercent)],
  ];
  const tables: PresentationInsightsTable[] = [
    {
      title: copy("Section delivery"),
      columns: [
        copy("Section"),
        copy("Presented"),
        copy("Skipped"),
        copy("Not recorded"),
        copy("Total blocks"),
        copy("Delivery coverage"),
      ],
      rows: value.delivery.sections.map((section) => [
        section.title ?? copy("Unsectioned"),
        number(section.presentedBlocks),
        number(section.skippedBlocks),
        number(section.unknownBlocks),
        number(section.totalBlocks),
        percent(section.coveragePercent),
      ]),
      authoredCells: value.delivery.sections.map((section) => [section.title !== null]),
      note: copy(
        "Coverage records what the facilitator presented. It does not measure learner completion or understanding.",
      ),
    },
    {
      title: copy("Block delivery"),
      columns: [copy("Block"), copy("Type"), copy("Section"), copy("Delivery"), copy("Source")],
      rows: value.delivery.blocks.map((block) => [
        blockTitle(block.blockId),
        copy(purposes[block.purpose]),
        block.sectionId
          ? (sectionTitles.get(block.sectionId.toLowerCase()) ?? copy("Not recorded"))
          : copy("Unsectioned"),
        block.status === "unknown"
          ? copy("Not recorded")
          : block.status === "presented"
            ? copy("Presented")
            : copy("Skipped"),
        block.isSessionAddition === null
          ? copy("Source not recorded")
          : block.isSessionAddition
            ? copy("Added during this session")
            : copy("Published content"),
      ]),
      authoredCells: value.delivery.blocks.map((block) => [
        hasAuthoredBlockTitle(block.blockId),
        false,
        Boolean(block.sectionId && authoredSections.has(block.sectionId.toLowerCase())),
      ]),
      note:
        value.delivery.basis === "navigation"
          ? copy(
              "Based on recorded session navigation. Revisits do not add another delivered block.",
            )
          : copy(
              "Based on recorded facilitation events. Missing historical delivery stays not recorded.",
            ),
    },
  ];
  for (const purpose of [
    "assessment",
    "opinion",
    "text",
    "quick_check",
    "unknown",
    "content",
  ] as const) {
    const questions = value.participation.questions.filter(
      (question) => question.purpose === purpose,
    );
    if (!questions.length) continue;
    const rows = questions.map((question) => {
      const hidden = question.status === "suppressed";
      const unavailable = question.status === "unavailable";
      const skipped = question.status === "skipped";
      const empty = hidden
        ? copy("Hidden")
        : unavailable
          ? copy("Not available")
          : skipped
            ? copy("Not collected")
            : copy("Not recorded");
      const count = (amount: number | null) => (amount === null ? empty : number(amount));
      const denominator =
        question.denominatorStatus === "recorded"
          ? copy("Recorded")
          : question.denominatorStatus === "legacy_unavailable"
            ? copy("Not recorded for this older activity")
            : question.denominatorStatus === "not_revealed"
              ? copy("Responses were not revealed")
              : question.denominatorStatus === "suppressed"
                ? copy("Hidden")
                : copy("Not available");
      const availability = hidden
        ? copy("Hidden · fewer than {minimum} responses", {
            minimum: number(value.minimumRespondents),
          })
        : unavailable
          ? copy("Not available")
          : skipped
            ? copy("Skipped · not presented")
            : copy("Available");
      const row = [
        blockTitle(question.blockId),
        availability,
        skipped ? copy("Not collected") : count(question.acceptedRespondents),
        count(question.joinedByRevealCount),
        count(question.notRespondedByRevealCount),
        question.responseRatePercent === null
          ? question.denominatorStatus === "recorded" && question.joinedByRevealCount === 0
            ? copy("Not applicable · zero joined by reveal")
            : empty
          : percent(question.responseRatePercent),
        denominator,
      ];
      return row;
    });
    tables.push({
      title: copy("Response coverage · {purpose}", { purpose: copy(purposes[purpose]) }),
      columns: [
        copy("Activity"),
        copy("Availability"),
        copy("Accepted responses"),
        copy("Participants joined by reveal"),
        copy("Not responded by reveal"),
        copy("Response rate"),
        copy("Denominator history"),
      ],
      rows,
      authoredCells: questions.map((question) => [hasAuthoredBlockTitle(question.blockId)]),
      note:
        purpose === "text"
          ? copy(
              "Text bodies are excluded from these insights. Existing approved text evidence remains in the detailed report.",
            )
          : purpose === "assessment"
            ? copy(
                "Assessment accuracy remains in the detailed report with its original denominator. Skipped activities are not wrong answers.",
              )
            : purpose === "unknown" || purpose === "content"
              ? copy(
                  "The activity purpose is not recorded. Assessment details remain in the original report.",
                )
              : copy(
                  "These activities are unscored; their response coverage is separate from assessed evidence.",
                ),
    });
    if (purpose === "opinion" || purpose === "quick_check") {
      for (const question of questions) {
        const template =
          purpose === "quick_check"
            ? "Quick Check distribution · {block}"
            : "Opinion distribution · {block}";
        const block = blockTitle(question.blockId);
        const title = copy(template, { block });
        // Split a construction-time placeholder, never authored text or completed cells.
        // This preserves translated word order while keeping the authored title's language.
        const titleParts = copy(template, { block: "\u0000" })
          .split("\u0000")
          .flatMap((part, index) => [
            ...(index ? [{ text: block, authored: hasAuthoredBlockTitle(question.blockId) }] : []),
            { text: part, authored: false },
          ]);
        if (question.distributionStatus !== "available") {
          tables.push({
            title,
            titleParts,
            columns: [copy("Distribution availability")],
            rows: [
              [
                question.distributionStatus === "suppressed"
                  ? copy("Hidden · fewer than five responses")
                  : question.distributionStatus === "not_applicable"
                    ? copy("Not applicable")
                    : copy("Unavailable"),
              ],
            ],
            note:
              question.distributionStatus === "unavailable"
                ? copy("Opinion distribution is unavailable for this activity.")
                : question.distributionStatus === "suppressed"
                  ? copy(
                      "Opinion distribution is hidden because the response sample is below five.",
                    )
                  : copy("Opinion distribution does not apply to this activity."),
          });
          continue;
        }
        tables.push({
          title,
          titleParts,
          columns: [
            copy("Option"),
            question.measure === "weighted_points"
              ? copy("Weighted rank points")
              : copy("Respondents selecting option"),
          ],
          rows: question.results.map((result) => [result.label, number(result.value)]),
          authoredCells: question.results.map(() => [true]),
          note:
            question.measure === "weighted_points"
              ? copy(
                  "Distribution available. Ranking points are separate from response coverage and assessment accuracy.",
                )
              : (question.maxSelections ?? 1) > 1
                ? copy(
                    "Distribution available. Participants may choose several options. Option counts do not represent distinct people across options.",
                  )
                : purpose === "quick_check"
                  ? copy(
                      "Distribution available. Option counts use accepted Quick Check responses.",
                    )
                  : copy("Distribution available. Option counts use accepted opinion responses."),
        });
      }
    }
  }
  if (value.recovery.length)
    tables.push({
      title: copy("Recovery evidence"),
      columns: [
        copy("Initial activity"),
        copy("Recheck"),
        copy("Availability"),
        copy("Initially incorrect with accepted recheck"),
        copy("Recovered"),
        copy("Recovery rate"),
      ],
      rows: value.recovery.map((item) => {
        const hidden = item.status === "suppressed";
        const empty = hidden ? copy("Hidden") : copy("Not available");
        return [
          blockTitle(item.sourceBlockId),
          item.recheckBlockId ? blockTitle(item.recheckBlockId) : copy("Not recorded"),
          item.status === "available"
            ? copy("Available")
            : hidden
              ? copy("Hidden · fewer than five paired responses")
              : copy("Not available"),
          item.initiallyIncorrectWithAcceptedRecheck === null
            ? empty
            : number(item.initiallyIncorrectWithAcceptedRecheck),
          item.recovered === null ? empty : number(item.recovered),
          item.recoveryPercent === null
            ? item.status === "available" && item.initiallyIncorrectWithAcceptedRecheck === 0
              ? copy("Not applicable · zero paired responses")
              : empty
            : percent(item.recoveryPercent),
        ];
      }),
      authoredCells: value.recovery.map((item) => [
        hasAuthoredBlockTitle(item.sourceBlockId),
        Boolean(item.recheckBlockId && hasAuthoredBlockTitle(item.recheckBlockId)),
      ]),
      note: copy(
        "The denominator includes an incorrect initial answer and an accepted recheck. It is not everyone who initially answered incorrectly.",
      ),
    });
  const qna = value.qna;
  return {
    title: value.title,
    facts,
    tables,
    qna:
      qna.status === "available"
        ? [
            [copy("Public questions"), number(qna.publicQuestionCount!)],
            [copy("Marked answered"), number(qna.answeredQuestionCount!)],
            [copy("Not marked answered"), number(qna.unansweredQuestionCount!)],
            [copy("Upvotes"), number(qna.upvoteCount!)],
            [copy("Q&A data as of"), date(qna.asOf!)],
          ]
        : [],
    qnaNote:
      qna.status === "available"
        ? copy(
            "Current public moderation counts, separate from the frozen report. Question text and private moderation counts are excluded.",
          )
        : qna.status === "suppressed"
          ? copy("Q&A totals are hidden because there are fewer than five public questions.")
          : qna.status === "not_enabled"
            ? copy("Q&A is not enabled for this session.")
            : copy("Q&A outcomes are not available for this session."),
    notes: [
      copy(
        "Participant identities are session entries, not verified unique people or devices. Accepted response records are not unique respondents.",
      ),
      copy(
        "Response rates use participants joined by reveal from the recorded roster. They do not measure attendance or eligibility; missing rosters are never replaced by the final joined count.",
      ),
      copy(
        "Positive activity samples below five responses are hidden. A recorded zero remains zero.",
      ),
      copy(
        "Elapsed time is wall-clock session time, not page dwell time or evidence of understanding. Report generation and insights calculation are separate from when this page was opened.",
      ),
      copy(
        "Private review-link views are not tracked. Self-paced assignments and learner completion are not included.",
      ),
      copy("Downloaded copies cannot be revoked. Keep them within the intended audience."),
    ],
  };
}

function csvCell(value: string) {
  // eslint-disable-next-line no-control-regex -- Spreadsheet formulas may hide behind control whitespace.
  const formulaPrefix = /^[\s\u0000-\u001f\u007f]*[=+@-]/u;
  const literal = formulaPrefix.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${literal.replaceAll('"', '""')}"`;
}
export function presentationInsightsCsv(input: PresentationSessionInsights, locale = "en-CA") {
  const view = presentationInsightsView(input, locale);
  const rows: string[][] = [["Session insights", view.title], ...view.facts];
  for (const table of view.tables) {
    rows.push([], [table.title], table.columns, ...table.rows);
    if (table.note) rows.push(["Note", table.note]);
  }
  rows.push(
    [],
    ["Q&A outcomes"],
    ...view.qna,
    ["Note", view.qnaNote],
    ...view.notes.map((note) => ["Note", note]),
  );
  return `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function presentationInsightsHtml(input: PresentationSessionInsights, locale = "en-CA") {
  const view = presentationInsightsView(input, locale);
  const facts = (rows: Array<[string, string]>) =>
    `<dl>${rows.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>`;
  const mobileRecords = (table: PresentationInsightsTable) =>
    `<div class="mobile-records">${table.rows.map((row) => `<dl class="mobile-record">${table.columns.map((column, index) => `<div><dt>${escape(column)}</dt><dd>${escape(row[index] ?? "")}</dd></div>`).join("")}</dl>`).join("")}</div>`;
  return `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(view.title)} · Session insights</title><style>body{font:18px/1.6 system-ui,sans-serif;max-width:1100px;margin:auto;padding:24px;color:#172b4d;background:#fff}h1,h2{line-height:1.25}dt,th{font-weight:bold}dd{margin:0 0 12px}table{border-collapse:collapse;width:100%}th,td{min-width:110px;border:1px solid #a6b0ba;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th:first-child,td:first-child{min-width:180px}p,li,dd{overflow-wrap:anywhere;white-space:pre-wrap}.table{overflow:auto}.table:focus-visible{outline:3px solid #174d8c;outline-offset:3px}caption{text-align:left;font-weight:bold;padding:12px 0}.mobile-records{display:none}.mobile-record{border:1px solid #a6b0ba;border-radius:8px;padding:12px;margin:12px 0}.mobile-record>div+div{margin-top:10px}.mobile-record dd{margin:4px 0 0}@media screen and (max-width:640px){.table table{display:none}.mobile-records{display:block}}@media print{body{max-width:none;width:auto;margin:0;padding:0}section{break-inside:avoid}.table{overflow:visible}table{width:100%;table-layout:fixed}th,td,th:first-child,td:first-child{min-width:0}.mobile-records{display:none}}</style></head><body><main><h1>${escape(view.title)}</h1><h2>Session insights</h2>${facts(view.facts)}${view.tables.map((table) => `<section><h2>${escape(table.title)}</h2><div class="table" tabindex="0" role="region" aria-label="${escape(table.title)}"><table><caption>${escape(table.title)}</caption><thead><tr>${table.columns.map((column) => `<th scope="col">${escape(column)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell, index) => (index === 0 ? `<th scope="row">${escape(cell)}</th>` : `<td>${escape(cell)}</td>`)).join("")}</tr>`).join("")}</tbody></table>${mobileRecords(table)}</div>${table.note ? `<p>${escape(table.note)}</p>` : ""}</section>`).join("")}<section><h2>Q&amp;A outcomes</h2>${facts(view.qna)}<p>${escape(view.qnaNote)}</p></section><section><h2>Reading these insights</h2><ul>${view.notes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul></section></main></body></html>`;
}
