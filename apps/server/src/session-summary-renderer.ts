import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import PDFDocument from "pdfkit";
import * as fontkit from "fontkit";
import * as yazl from "yazl";
import {
  type AggregateSessionSummary,
  type SummaryLocale,
  type SummaryQuestion,
} from "@openround/contracts";
import {
  validateSessionSummaryExport,
  assertValidSummaryText as assertValidText,
} from "./session-summary-export-validation.js";
import { summaryExportCopy, type SummaryExportCopy } from "./session-summary-export-copy.js";
import {
  assertSummaryOutputSize,
  MAX_SUMMARY_PDF_PAGES,
  SUMMARY_PNG_WIDTH,
  SUMMARY_PNG_HEIGHT,
  SessionSummaryExportError,
  type SessionSummaryRenderOptions,
  type SessionSummaryExportResult,
} from "./session-summary-export-types.js";

type Block = { role: "title" | "heading" | "body" | "muted"; text: string; bar?: number };
type FontRun = { text: string; family: "SummaryCJK" | "SummaryEmoji"; font: fontkit.Font };
const segmenters = new Map<string, Intl.Segmenter>();
const measuredWidths = new Map<string, number>();
function segmenter(locale: SummaryLocale, granularity: "word" | "grapheme") {
  const key = `${locale}:${granularity}`;
  let value = segmenters.get(key);
  if (!value) {
    value = new Intl.Segmenter(locale, { granularity });
    segmenters.set(key, value);
  }
  return value;
}
const fontDirectory = new URL("../assets/summary-fonts/", import.meta.url);
const cjkPath = fileURLToPath(new URL("NotoSansCJKjp-Regular.otf", fontDirectory));
const emojiPath = fileURLToPath(new URL("NotoEmoji.ttf", fontDirectory));
let fontCache: { cjk: fontkit.Font; emoji: fontkit.Font } | undefined;

function fonts() {
  if (!fontCache) {
    fontCache = {
      cjk: fontkit.create(readFileSync(cjkPath)) as fontkit.Font,
      emoji: fontkit.create(readFileSync(emojiPath)) as fontkit.Font,
    };
  }
  return fontCache;
}

const languageTags: Partial<Record<SummaryLocale, string>> = {
  "ja-JP": "JAN ",
  "ko-KR": "KOR ",
  "zh-CN": "ZHS ",
  "zh-TW": "ZHT ",
};

/** Public parsed-font API permits localized shaping without four copies of the CJK font. */
function localizedFont(font: fontkit.Font, locale: SummaryLocale): fontkit.Font {
  return new Proxy(font, {
    get(target, property) {
      if (property === "layout") {
        return (text: string, features?: string[] | Record<string, boolean>) =>
          target.layout(text, features, undefined, languageTags[locale]);
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function fontRuns(text: string, locale: SummaryLocale): FontRun[] {
  const available = fonts();
  const runs: FontRun[] = [];
  for (const { segment } of segmenter(locale, "grapheme").segment(text)) {
    const emoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment);
    const candidates = emoji ? [available.emoji, available.cjk] : [available.cjk, available.emoji];
    const font = candidates.find((candidate) =>
      [...segment].every((character) => {
        const code = character.codePointAt(0)!;
        return (
          code === 0x200d ||
          code === 0xfe0e ||
          code === 0xfe0f ||
          (code >= 0xe0020 && code <= 0xe007f) ||
          candidate.hasGlyphForCodePoint(code)
        );
      }),
    );
    if (!font) {
      throw new SessionSummaryExportError(
        "EXPORT_INVALID",
        "This summary contains characters not supported by the bundled export fonts. Download the spreadsheet to preserve the text.",
      );
    }
    const family = font === available.cjk ? "SummaryCJK" : "SummaryEmoji";
    const previous = runs.at(-1);
    if (previous?.family === family) previous.text += segment;
    else runs.push({ text: segment, family, font });
  }
  return runs;
}

function textWidth(text: string, size: number, locale: SummaryLocale) {
  const key = `${locale}:${size}:${text}`;
  const cached = measuredWidths.get(key);
  if (cached !== undefined) return cached;
  const width = fontRuns(text, locale).reduce(
    (total, run) =>
      total +
      (run.font.layout(run.text, undefined, undefined, languageTags[locale]).advanceWidth * size) /
        run.font.unitsPerEm,
    0,
  );
  if (measuredWidths.size >= 8192) measuredWidths.clear();
  measuredWidths.set(key, width);
  return width;
}

function wrapText(text: string, size: number, width: number, locale: SummaryLocale): string[] {
  const output: string[] = [];
  for (const paragraph of text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\t", "    ")
    .split("\n")) {
    let line = "";
    for (const { segment } of segmenter(locale, "word").segment(paragraph)) {
      if (textWidth(line + segment, size, locale) <= width) {
        line += segment;
        continue;
      }
      if (line) {
        output.push(line.trimEnd());
        line = "";
      }
      if (textWidth(segment, size, locale) <= width) {
        line = segment.trimStart();
        continue;
      }
      for (const { segment: grapheme } of segmenter(locale, "grapheme").segment(segment)) {
        if (line && textWidth(line + grapheme, size, locale) > width) {
          output.push(line);
          line = "";
        }
        line += grapheme;
      }
    }
    output.push(line.trimEnd());
  }
  return output;
}

function number(value: number, locale: SummaryLocale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}
function percent(value: number, locale: SummaryLocale) {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(
    value / 100,
  );
}
function measureLabel(question: SummaryQuestion, copy: SummaryExportCopy) {
  return {
    respondents: copy.respondentsMeasure,
    selections: copy.selections,
    weighted_points: copy.weightedPoints,
  }[question.measure];
}
function suppressionLabel(question: SummaryQuestion, copy: SummaryExportCopy) {
  return {
    none: copy.unavailable,
    insufficient_sample: copy.insufficientSample,
    participant_text: copy.participantText,
    unavailable: copy.unavailable,
  }[question.suppression];
}
function noteTexts(summary: AggregateSessionSummary, copy: SummaryExportCopy) {
  const notes = {
    aggregate_only: copy.aggregateNote,
    insufficient_sample: copy.sampleNote,
    participant_text_excluded: copy.textNote,
    paired_evidence: copy.pairedNote,
    no_scored_evidence: copy.noScoreNote,
  };
  return summary.noteCodes.map((code) => notes[code]);
}
function selectedQuestions(summary: AggregateSessionSummary, options: SessionSummaryRenderOptions) {
  return options.format !== "png" || options.questionIndex === undefined
    ? summary.questions
    : summary.questions.filter((question) => question.index === options.questionIndex);
}
function introBlocks(summary: AggregateSessionSummary, locale: SummaryLocale): Block[] {
  const copy = summaryExportCopy(locale);
  const finished = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(summary.finishedAt));
  return [
    { role: "muted", text: copy.summary },
    { role: "title", text: summary.title },
    { role: "muted", text: `${copy.finished}: ${finished} UTC` },
    {
      role: "body",
      text: `${copy.participants}: ${number(summary.participantCount, locale)} · ${copy.responses}: ${number(summary.responseCount, locale)} · ${copy.checkpoints}: ${number(summary.questionCount, locale)}`,
    },
    ...(summary.initialAccuracy
      ? [
          {
            role: "body" as const,
            text: `${copy.accuracy}: ${percent(summary.initialAccuracy.percent, locale)} (${number(summary.initialAccuracy.correct, locale)}/${number(summary.initialAccuracy.responses, locale)} ${copy.correct})`,
          },
        ]
      : []),
    ...noteTexts(summary, copy).map((text) => ({ role: "muted" as const, text })),
    ...(summary.nextSteps
      ? [
          { role: "heading" as const, text: copy.nextSteps },
          { role: "body" as const, text: summary.nextSteps },
        ]
      : []),
  ];
}
function questionBlocks(question: SummaryQuestion, locale: SummaryLocale): Block[] {
  const copy = summaryExportCopy(locale);
  const purpose = { assessed: copy.assessed, opinion: copy.opinion, content: copy.content }[
    question.purpose
  ];
  const maximum = Math.max(1, ...question.results.map((result) => result.value));
  return [
    {
      role: "heading",
      text: `${copy.question} ${number(question.index + 1, locale)} · ${purpose}`,
    },
    { role: "body", text: question.prompt },
    ...(question.respondents === null
      ? []
      : [
          {
            role: "muted" as const,
            text: `${copy.respondents}: ${number(question.respondents, locale)}`,
          },
        ]),
    ...(question.accuracy
      ? [
          {
            role: "body" as const,
            text: `${copy.accuracy}: ${percent(question.accuracy.percent, locale)} (${number(question.accuracy.correct, locale)}/${number(question.accuracy.responses, locale)} ${copy.correct})`,
          },
        ]
      : []),
    ...(question.results.length
      ? [
          { role: "muted" as const, text: `${copy.results} · ${measureLabel(question, copy)}` },
          ...question.results.map((result) => ({
            role: "body" as const,
            text: `${result.label}: ${number(result.value, locale)}`,
            bar: result.value / maximum,
          })),
          ...((question.maxSelections ?? 1) > 1
            ? [{ role: "muted" as const, text: copy.multiSelection }]
            : []),
        ]
      : !question.accuracy && question.purpose !== "content"
        ? [{ role: "muted" as const, text: suppressionLabel(question, copy) }]
        : []),
  ];
}
function allBlocks(
  summary: AggregateSessionSummary,
  options: SessionSummaryRenderOptions,
): Block[] {
  const copy = summaryExportCopy(options.locale);
  return [
    ...introBlocks(summary, options.locale),
    ...selectedQuestions(summary, options).flatMap((question) =>
      questionBlocks(question, options.locale),
    ),
    ...(summary.recovery.length
      ? [
          { role: "heading" as const, text: copy.recovery },
          ...summary.recovery.map((recovery) => ({
            role: "body" as const,
            text: `${recovery.label} · ${copy[recovery.kind]}: ${percent(recovery.percent, options.locale)} (${number(recovery.recovered, options.locale)}/${number(recovery.eligible, options.locale)})`,
          })),
        ]
      : []),
  ];
}

async function renderPdf(summary: AggregateSessionSummary, options: SessionSummaryRenderOptions) {
  const copy = summaryExportCopy(options.locale);
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: "LETTER",
    margin: 48,
    tagged: true,
    lang: options.locale,
    displayTitle: true,
    pdfVersion: "1.7",
    fontLayoutCache: true,
    info: { Title: summary.title, Creator: "Polling Pops", Producer: "Polling Pops" },
  });
  // PDFKit 0.20 accepts parsed fontkit fonts; @types/pdfkit 0.17 has not added that overload.
  const register = doc.registerFont.bind(doc) as unknown as (
    name: string,
    font: fontkit.Font,
  ) => void;
  register("SummaryCJK", localizedFont(fonts().cjk, options.locale));
  register("SummaryEmoji", fonts().emoji);
  const chunks: Buffer[] = [];
  let outputSize = 0;
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => {
      outputSize += chunk.length;
      try {
        assertSummaryOutputSize(outputSize);
        chunks.push(chunk);
      } catch (error) {
        doc.destroy();
        reject(error);
      }
    });
    doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(chunks)));
  });
  // Attach rejection before rendering so synchronous size/layout failures can destroy safely.
  void completed.catch(() => undefined);
  const structure = doc.struct("Document", { lang: options.locale });
  doc.addStructure(structure);
  let pageCount = 0;
  let y = 0;
  const page = () => {
    if (++pageCount > MAX_SUMMARY_PDF_PAGES) {
      throw new SessionSummaryExportError(
        "EXPORT_TOO_LARGE",
        "The summary exceeds the PDF page limit",
      );
    }
    doc.addPage();
    doc.markContent("Artifact", { type: "Pagination" });
    doc
      .font("SummaryCJK")
      .fontSize(9)
      .fillColor("#56606e")
      .text("Polling Pops", 48, 24, { lineBreak: false });
    doc.text(`${copy.page} ${number(pageCount, options.locale)}`, 48, 758, { lineBreak: false });
    doc.endMarkedContent();
    y = 56;
  };
  try {
    page();
    for (const block of allBlocks(summary, options)) {
      const size = { title: 24, heading: 15, body: 11, muted: 9 }[block.role];
      const lineHeight = size * 1.65;
      const lines = wrapText(block.text, size, 516, options.locale);
      if (block.role === "heading" && y + lineHeight * 3 > 728) page();
      const element = doc.struct(
        block.role === "title" ? "H1" : block.role === "heading" ? "H2" : "P",
        { actual: block.text },
      );
      structure.add(element);
      for (const line of lines) {
        if (y + lineHeight > 728) page();
        element.add(doc.markStructureContent("Span"));
        let x = 48;
        for (const run of fontRuns(line, options.locale)) {
          doc
            .font(run.family)
            .fontSize(size)
            .fillColor(block.role === "muted" ? "#56606e" : "#17253c")
            .text(run.text, x, y, { lineBreak: false });
          x += textWidth(run.text, size, options.locale);
        }
        doc.endMarkedContent();
        y += lineHeight;
      }
      element.end();
      if (block.bar !== undefined) {
        if (y + 10 > 728) page();
        doc.markContent("Artifact", { type: "Layout" });
        doc.roundedRect(48, y, 516, 3, 1).fill("#e8edf4");
        if (block.bar > 0) doc.roundedRect(48, y, 516 * block.bar, 3, 1).fill("#2869d5");
        doc.endMarkedContent();
        y += 9;
      }
      y += block.role === "heading" ? 9 : 6;
    }
    structure.end();
    doc.end();
    return await completed;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

async function renderPng(summary: AggregateSessionSummary, options: SessionSummaryRenderOptions) {
  const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");
  if (!GlobalFonts.has("SummaryCJK") && !GlobalFonts.registerFromPath(cjkPath, "SummaryCJK"))
    throw new Error("CJK export font unavailable");
  if (!GlobalFonts.has("SummaryEmoji") && !GlobalFonts.registerFromPath(emojiPath, "SummaryEmoji"))
    throw new Error("Emoji export font unavailable");
  const canvas = createCanvas(SUMMARY_PNG_WIDTH, SUMMARY_PNG_HEIGHT);
  const ctx = canvas.getContext("2d");
  const copy = summaryExportCopy(options.locale);
  ctx.lang = options.locale;
  ctx.fillStyle = "#f4f7fb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(64, 64, canvas.width - 128, canvas.height - 128);
  ctx.textBaseline = "top";
  let y = 106;
  const width = 1344;
  const drawLine = (text: string, size: number, color: string) => {
    let x = 128;
    for (const run of fontRuns(text, options.locale)) {
      ctx.font = `${size}px ${run.family}`;
      ctx.fillStyle = color;
      ctx.fillText(run.text, x, y);
      x += textWidth(run.text, size, options.locale);
    }
  };
  drawLine(
    `Polling Pops · ${options.questionIndex === undefined ? copy.overview : copy.selectedResult}`,
    25,
    "#56606e",
  );
  y += 54;
  let omitted = false;
  const blocks = [
    ...introBlocks(summary, options.locale),
    ...selectedQuestions(summary, options).flatMap((question) =>
      questionBlocks(question, options.locale),
    ),
  ];
  outer: for (const block of blocks) {
    const size = { title: 56, heading: 35, body: 29, muted: 23 }[block.role];
    const lines = wrapText(block.text, size, width, options.locale);
    const limit = block.role === "title" ? 3 : block.role === "body" ? 5 : 3;
    const visible = lines.slice(0, limit);
    for (let index = 0; index < visible.length; index++) {
      if (y + size * 1.55 > 1718) {
        omitted = true;
        break outer;
      }
      let line = visible[index]!;
      if (index === visible.length - 1 && lines.length > limit) {
        omitted = true;
        while (line && textWidth(`${line}…`, size, options.locale) > width) {
          line = [...new Intl.Segmenter(options.locale, { granularity: "grapheme" }).segment(line)]
            .slice(0, -1)
            .map((part) => part.segment)
            .join("");
        }
        line += "…";
      }
      drawLine(line, size, block.role === "muted" ? "#56606e" : "#17253c");
      y += size * 1.55;
    }
    if (block.bar !== undefined) {
      if (y + 16 > 1718) {
        omitted = true;
        break;
      }
      ctx.fillStyle = "#e8edf4";
      ctx.fillRect(128, y, width, 6);
      ctx.fillStyle = "#2869d5";
      ctx.fillRect(128, y, width * block.bar, 6);
      y += 16;
    }
    y += 12;
  }
  y = 1770;
  for (const line of wrapText(
    omitted || options.questionIndex === undefined ? copy.subset : copy.aggregateNote,
    22,
    width,
    options.locale,
  ).slice(0, 3)) {
    drawLine(line, 22, "#56606e");
    y += 34;
  }
  return await canvas.encode("png");
}

function xml(text: string) {
  assertValidText(text);
  // Escape OOXML's literal escape syntax before ordinary XML escaping.
  return (
    text
      .replace(/_x[0-9a-f]{4}_/gi, (match) => `_x005F_${match.slice(1)}`)
      // ST_Xstring requires CR escaping; raw CR is normalized by XML readers.
      .replaceAll("\r", "_x000D_")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;")
  );
}
type Cell = string | number | null;
function column(index: number) {
  return String.fromCharCode(65 + index);
}
function sheetXml(rows: Cell[][]) {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="65" customWidth="1"/><col min="3" max="12" width="22" customWidth="1"/></cols><sheetData>${rows
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row
          .map((value, cellIndex) => {
            if (value === null) return "";
            const reference = `${column(cellIndex)}${index + 1}`;
            return typeof value === "number"
              ? `<c r="${reference}" s="${index === 0 ? 1 : 0}"><v>${value}</v></c>`
              : `<c r="${reference}" s="${index === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join(
      "",
    )}</sheetData><autoFilter ref="A1:${column((rows[0]?.length ?? 1) - 1)}${rows.length}"/></worksheet>`;
}
async function renderXlsx(summary: AggregateSessionSummary, options: SessionSummaryRenderOptions) {
  const copy = summaryExportCopy(options.locale);
  const questions = selectedQuestions(summary, options);
  const rows: Cell[][] = [
    [copy.label, copy.value],
    [copy.summary, summary.title],
    [copy.finished, summary.finishedAt],
    [copy.participants, summary.participantCount],
    [copy.responses, summary.responseCount],
    [copy.checkpoints, summary.questionCount],
    [`${copy.accuracy} (%)`, summary.initialAccuracy?.percent ?? null],
    [copy.correct, summary.initialAccuracy?.correct ?? null],
    [copy.respondents, summary.initialAccuracy?.responses ?? null],
    [copy.nextSteps, summary.nextSteps],
    ...noteTexts(summary, copy).map((text): Cell[] => [copy.summary, text]),
  ];
  const sheets: Array<{ name: string; rows: Cell[][] }> = [
    { name: "Summary", rows },
    {
      name: "Questions",
      rows: [
        [
          copy.question,
          copy.label,
          copy.purpose,
          copy.respondents,
          copy.correct,
          `${copy.accuracy} (%)`,
          copy.results,
        ],
        ...questions.map((question): Cell[] => [
          question.index + 1,
          question.prompt,
          copy[question.purpose],
          question.accuracy?.responses ?? question.respondents,
          question.accuracy?.correct ?? null,
          question.accuracy?.percent ?? null,
          question.results.length ? measureLabel(question, copy) : suppressionLabel(question, copy),
        ]),
      ],
    },
    {
      name: "Distributions",
      rows: [
        [copy.question, copy.label, copy.value, copy.results],
        ...questions.flatMap((question) =>
          question.results.map((result): Cell[] => [
            question.index + 1,
            result.label,
            result.value,
            measureLabel(question, copy),
          ]),
        ),
      ],
    },
    {
      name: "Recovery",
      rows: [
        [
          copy.label,
          copy.evidenceType,
          copy.eligiblePairedRespondents,
          copy.recovered,
          `${copy.recovery} (%)`,
        ],
        ...summary.recovery.map((recovery): Cell[] => [
          recovery.label,
          copy[recovery.kind],
          recovery.eligible,
          recovery.recovered,
          recovery.percent,
        ]),
      ],
    },
  ];
  const archive = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  let size = 0;
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      try {
        assertSummaryOutputSize(size);
        chunks.push(chunk);
      } catch (error) {
        (archive.outputStream as Readable).destroy();
        reject(error);
      }
    });
    archive.outputStream.once("error", reject);
    archive.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
  const add = (path: string, content: string) =>
    archive.addBuffer(Buffer.from(content, "utf8"), path, {
      mtime: new Date("1980-01-01T00:00:00.000Z"),
      mode: 0o100644,
    });
  add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  add(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  add(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Noto Sans CJK JP"/></font><font><b/><sz val="11"/><name val="Noto Sans CJK JP"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  sheets.forEach((sheet, index) =>
    add(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet.rows)),
  );
  archive.end();
  return await completed;
}

/** The renderer accepts the aggregate allowlist only; it never reads raw reports or source rows. */
export async function renderSessionSummary(
  summary: AggregateSessionSummary,
  options: SessionSummaryRenderOptions,
): Promise<SessionSummaryExportResult> {
  const checked = validateSessionSummaryExport(summary, options);
  measuredWidths.clear();
  const bytes =
    options.format === "pdf"
      ? await renderPdf(checked, options)
      : options.format === "png"
        ? await renderPng(checked, options)
        : await renderXlsx(checked, options);
  assertSummaryOutputSize(bytes.length);
  return {
    bytes,
    extension: options.format,
    contentType: {
      pdf: "application/pdf",
      png: "image/png",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }[options.format],
  };
}
