import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as yauzl from "yauzl";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { SummaryLocaleSchema, type AggregateSessionSummary } from "@openround/contracts";
import { renderSessionSummary } from "../src/session-summary-renderer.js";
import { createSessionSummaryExportService } from "../src/session-summary-export.js";
import { summaryExportCopy } from "../src/session-summary-export-copy.js";
import {
  MAX_SUMMARY_INPUT_BYTES,
  MAX_SUMMARY_OUTPUT_BYTES,
  SUMMARY_PNG_WIDTH,
  SUMMARY_PNG_HEIGHT,
} from "../src/session-summary-export-types.js";

import { summaryFixture } from "./fixtures/session-summary.js";

async function pdfContents(bytes: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    verbosity: 0,
  });
  const document = await task.promise;
  try {
    const pages = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      pages.push({
        text: (await page.getTextContent()).items
          .flatMap((item) => ("str" in item ? [item.str] : []))
          .join(" "),
        structure: await page.getStructTree(),
      });
    }
    return { pageCount: document.numPages, pages };
  } finally {
    await task.destroy();
  }
}
async function unzip(bytes: Buffer) {
  const archive = await yauzl.fromBufferPromise(bytes, { lazyEntries: true });
  const output = new Map<string, string>();
  try {
    for await (const entry of archive.eachEntry()) {
      const chunks: Buffer[] = [];
      for await (const chunk of await archive.openReadStreamPromise(entry))
        chunks.push(Buffer.from(chunk));
      output.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
    }
  } finally {
    if (archive.isOpen) archive.close();
  }
  return output;
}

describe("aggregate session summary downloads", () => {
  it("pins fonts with their original licenses and checksums", () => {
    const directory = new URL("../assets/summary-fonts/", import.meta.url);
    for (const [file, hash] of [
      [
        "NotoSansCJKjp-Regular.otf",
        "68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5",
      ],
      ["NotoEmoji.ttf", "de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551"],
    ]) {
      expect(
        createHash("sha256")
          .update(readFileSync(fileURLToPath(new URL(file!, directory))))
          .digest("hex"),
      ).toBe(hash);
    }
    for (const license of ["NotoSansCJK-OFL.txt", "NotoEmoji-OFL.txt"]) {
      expect(readFileSync(new URL(license, directory), "utf8")).toContain("SIL OPEN FONT LICENSE");
    }
  });

  it("downloads a tagged vector PDF whose CJK, accented and emoji text extracts correctly", async () => {
    const result = await renderSessionSummary(summaryFixture(), { format: "pdf", locale: "ja-JP" });
    expect(result.contentType).toBe("application/pdf");
    expect(result.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const contents = await pdfContents(result.bytes);
    const text = contents.pages.map((page) => page.text).join(" ");
    for (const value of [
      "Français",
      "Português",
      "日本語",
      "한국어",
      "简体中文",
      "繁體中文",
      "🧠",
      "👩‍💻",
      "<script>",
      "_x0041_",
    ])
      expect(text).toContain(value);
    expect(text).not.toMatch(/[⽇⽂]/u);
    expect(contents.pages[0]?.structure).toBeTruthy();
    expect(result.bytes.toString("latin1")).toContain("/StructTreeRoot");
    expect(result.bytes.toString("latin1")).not.toMatch(/\/Subtype \/Image|\/JavaScript|\/URI/);
  }, 20_000);

  it("provides complete export copy in all ten locales and uses each PDF language", async () => {
    for (const locale of SummaryLocaleSchema.options) {
      const copy = summaryExportCopy(locale);
      expect(Object.values(copy).every((text) => text.length > 0)).toBe(true);
      const result = await renderSessionSummary(
        { ...summaryFixture(), questions: [], questionCount: 0, recovery: [] },
        { format: "pdf", locale },
      );
      const contents = await pdfContents(result.bytes);
      expect(contents.pages.map((page) => page.text).join(" ")).toContain(copy.summary);
      expect(result.bytes.toString("latin1")).toContain(`/Lang (${locale})`);
    }
  }, 30_000);

  it("wraps long unbroken and CJK authored text across bounded pages without losing the last result", async () => {
    const fixture = summaryFixture();
    fixture.questions = Array.from({ length: 20 }, (_, index) => ({
      ...fixture.questions[0]!,
      index,
      prompt: index % 2 ? "日本語한국어繁體中文简体中文".repeat(50) : "unbroken".repeat(200),
      results: [{ label: `LAST_RESULT_${index}`, value: 5 }],
    }));
    fixture.questionCount = 20;
    const result = await renderSessionSummary(fixture, { format: "pdf", locale: "ko-KR" });
    const contents = await pdfContents(result.bytes);
    expect(contents.pageCount).toBeGreaterThan(2);
    expect(contents.pageCount).toBeLessThanOrEqual(256);
    expect(contents.pages.at(-1)?.text).toContain("LAST_RESULT_19");
    expect(result.bytes.length).toBeLessThan(MAX_SUMMARY_OUTPUT_BYTES);
  }, 30_000);

  it("returns fixed-size overview and selected-result PNGs", async () => {
    const fixture = summaryFixture();
    for (const kind of ["round", "presentation", "survey"] as const) {
      const result = await renderSessionSummary(
        { ...fixture, kind },
        { format: "png", locale: "zh-TW" },
      );
      expect(result.contentType).toBe("image/png");
      expect(result.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(result.bytes.readUInt32BE(16)).toBe(SUMMARY_PNG_WIDTH);
      expect(result.bytes.readUInt32BE(20)).toBe(SUMMARY_PNG_HEIGHT);
    }
    const overview = await renderSessionSummary(fixture, { format: "png", locale: "zh-TW" });
    const selected = await renderSessionSummary(fixture, {
      format: "png",
      locale: "zh-TW",
      questionIndex: 1,
    });
    expect(selected.bytes.equals(overview.bytes)).toBe(false);
  }, 30_000);

  it("renders 200 long checkpoints within the production worker deadline", async () => {
    const fixture = summaryFixture();
    fixture.questions = Array.from({ length: 200 }, (_, index) => ({
      ...fixture.questions[0]!,
      index,
      prompt: `${index + 1}: ${"unbroken".repeat(200)}`,
      results: [{ label: `LAST_RESULT_${index}`, value: 5 }],
    }));
    fixture.questionCount = 200;
    const service = createSessionSummaryExportService();
    try {
      const result = await service.render(fixture, { format: "pdf", locale: "ko-KR" });
      const contents = await pdfContents(result.bytes);
      expect(contents.pageCount).toBeLessThanOrEqual(256);
      expect(contents.pages.map((page) => page.text).join(" ")).toContain("LAST_RESULT_199");
      expect(result.bytes.length).toBeLessThan(MAX_SUMMARY_OUTPUT_BYTES);
    } finally {
      await service.close();
    }
  }, 30_000);

  it("rejects pathological newline pagination at the PDF page cap", async () => {
    const fixture = summaryFixture();
    fixture.questions = Array.from({ length: 5 }, (_, index) => ({
      ...fixture.questions[0]!,
      index,
      prompt: "\n".repeat(2000),
      results: [],
    }));
    fixture.questionCount = 5;
    await expect(
      renderSessionSummary(fixture, { format: "pdf", locale: "en-CA" }),
    ).rejects.toMatchObject({ code: "EXPORT_TOO_LARGE" });
  }, 10_000);

  it("writes a valid minimal XLSX with explicit string cells, safe literal text and no external/formula parts", async () => {
    const result = await renderSessionSummary(summaryFixture(), {
      format: "xlsx",
      locale: "fr-FR",
    });
    expect(result.extension).toBe("xlsx");
    const files = await unzip(result.bytes);
    expect([...files.keys()].sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/workbook.xml",
        ...[1, 2, 3, 4].map((index) => `xl/worksheets/sheet${index}.xml`),
      ].sort(),
    );
    for (const text of files.values()) {
      expect(XMLValidator.validate(text)).toBe(true);
      expect(text).not.toMatch(
        /<f[ >]|TargetMode="External"|<hyperlink|<script>|vbaProject|PRIVATE_IDENTITY/,
      );
    }
    const summary = files.get("xl/worksheets/sheet1.xml")!;
    expect(summary).toContain("&lt;script&gt; &amp; _x005F_x0041_");
    expect(summary).toContain("=HYPERLINK(&quot;https://invalid.example&quot;)");
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
    const parsed = parser.parse(summary) as {
      worksheet: {
        sheetData: {
          row: Array<{
            c: Array<{ "@_t"?: string; is?: { t: string | { "#text": string } }; v?: string }>;
          }>;
        };
      };
    };
    expect(
      parsed.worksheet.sheetData.row.some((row) =>
        row.c.some(
          (cell) =>
            cell["@_t"] === "inlineStr" &&
            (typeof cell.is?.t === "object" ? cell.is.t["#text"] : cell.is?.t)?.includes("日本語"),
        ),
      ),
    ).toBe(true);
    expect(
      parsed.worksheet.sheetData.row.some((row) =>
        row.c.some((cell) => cell.v === "12" && !cell["@_t"]),
      ),
    ).toBe(true);
  });

  it("rejects checkpoint selection for complete PDF and spreadsheet exports", async () => {
    for (const format of ["pdf", "xlsx"] as const) {
      await expect(
        renderSessionSummary(summaryFixture(), {
          format,
          locale: "en-CA",
          questionIndex: 1,
        }),
      ).rejects.toMatchObject({ code: "EXPORT_INVALID" });
    }
  });

  it("preserves assessed numerators, denominators, purposes and distinct same-label recovery evidence types", async () => {
    const fixture = summaryFixture();
    fixture.questions[0] = {
      ...fixture.questions[0]!,
      type: "single_choice",
      purpose: "assessed",
      respondents: 8,
      accuracy: { correct: 5, responses: 8, percent: 62.5 },
      maxSelections: null,
      results: [],
    };
    fixture.questions.push({
      ...fixture.questions[1]!,
      index: 2,
      prompt: "Content slide",
      purpose: "content",
      type: "content",
      suppression: "unavailable",
    });
    fixture.questionCount = 3;
    fixture.recovery = [
      { kind: "linked", label: "Same source prompt", eligible: 5, recovered: 3, percent: 60 },
      { kind: "revote", label: "Same source prompt", eligible: 6, recovered: 4, percent: 66.7 },
    ];
    const result = await renderSessionSummary(fixture, { format: "xlsx", locale: "en-CA" });
    const files = await unzip(result.bytes);
    const questions = files.get("xl/worksheets/sheet2.xml")!;
    expect(questions).toContain('<c r="D2" s="0"><v>8</v></c>');
    expect(questions).toContain('<c r="E2" s="0"><v>5</v></c>');
    expect(questions).toContain('<c r="F2" s="0"><v>62.5</v></c>');
    expect(questions).toContain(
      '<c r="C2" s="0" t="inlineStr"><is><t xml:space="preserve">Assessed</t></is></c>',
    );
    expect(questions).toContain(
      '<c r="C3" s="0" t="inlineStr"><is><t xml:space="preserve">Opinion</t></is></c>',
    );
    expect(questions).toContain(
      '<c r="C4" s="0" t="inlineStr"><is><t xml:space="preserve">Content</t></is></c>',
    );
    expect(questions).not.toMatch(/<c r="E[34]"/);
    const recovery = files.get("xl/worksheets/sheet4.xml")!;
    expect(recovery).toContain(">Evidence type</t>");
    expect(recovery).toContain(
      '<c r="B2" s="0" t="inlineStr"><is><t xml:space="preserve">linked recheck</t></is></c>',
    );
    expect(recovery).toContain(
      '<c r="B3" s="0" t="inlineStr"><is><t xml:space="preserve">revote</t></is></c>',
    );
    expect(recovery).toContain('<c r="C2" s="0"><v>5</v></c>');
    expect(recovery).toContain('<c r="D2" s="0"><v>3</v></c>');
    expect(recovery).toContain('<c r="C3" s="0"><v>6</v></c>');
    expect(recovery).toContain('<c r="D3" s="0"><v>4</v></c>');
    const pdf = await renderSessionSummary(fixture, { format: "pdf", locale: "en-CA" });
    const contents = await pdfContents(pdf.bytes);
    const text = contents.pages.map((page) => page.text).join(" ");
    expect(text).toContain("linked recheck");
    expect(text).toContain("revote");
    expect(text).toContain("5/8");
  }, 20_000);

  it("preserves carriage returns without double-escaping literal OOXML tokens or escaping text tabs/newlines", async () => {
    const fixture = summaryFixture();
    fixture.nextSteps = "Literal _x000D_\r\nKeep\ttabs\nEnd";
    const result = await renderSessionSummary(fixture, { format: "xlsx", locale: "en-CA" });
    const files = await unzip(result.bytes);
    const text = files.get("xl/worksheets/sheet1.xml")!;
    expect(text).toContain("Literal _x005F_x000D__x000D_\nKeep\ttabs\nEnd");
    expect(text).not.toContain("\r");
    expect(text).not.toContain("_x000A_");
    expect(text).not.toContain("_x0009_");
    expect(XMLValidator.validate(text)).toBe(true);
  });

  it("labels percentage units and paired recovery denominators explicitly in every spreadsheet locale", async () => {
    for (const locale of SummaryLocaleSchema.options) {
      const copy = summaryExportCopy(locale);
      const result = await renderSessionSummary(summaryFixture(), { format: "xlsx", locale });
      const files = await unzip(result.bytes);
      expect(files.get("xl/worksheets/sheet1.xml")).toContain(`${copy.accuracy} (%)`);
      expect(files.get("xl/worksheets/sheet1.xml")).toContain("<v>80</v>");
      expect(files.get("xl/worksheets/sheet4.xml")).toContain(copy.eligiblePairedRespondents);
      expect(files.get("xl/worksheets/sheet4.xml")).toContain(copy.recovered);
      expect(files.get("xl/worksheets/sheet4.xml")).toContain("<v>5</v>");
      expect(files.get("xl/worksheets/sheet4.xml")).toContain("<v>4</v>");
    }
  });

  it("rejects unknown fields, invalid text, absent selections and oversized input before producing an artifact", async () => {
    const options = { format: "xlsx" as const, locale: "en-CA" as const };
    await expect(
      renderSessionSummary(
        {
          ...summaryFixture(),
          participants: [{ nickname: "PRIVATE_IDENTITY" }],
        } as AggregateSessionSummary,
        options,
      ),
    ).rejects.toMatchObject({ code: "EXPORT_INVALID" });
    await expect(
      renderSessionSummary({ ...summaryFixture(), title: "bad\u0000text" }, options),
    ).rejects.toMatchObject({ code: "EXPORT_INVALID" });
    await expect(
      renderSessionSummary({ ...summaryFixture(), title: "bad\ud800text" }, options),
    ).rejects.toMatchObject({ code: "EXPORT_INVALID" });
    await expect(
      renderSessionSummary(summaryFixture(), { ...options, questionIndex: 42 }),
    ).rejects.toMatchObject({ code: "EXPORT_INVALID" });
    await expect(
      renderSessionSummary(
        { ...summaryFixture(), nextSteps: "x".repeat(MAX_SUMMARY_INPUT_BYTES) },
        options,
      ),
    ).rejects.toMatchObject({ code: "EXPORT_TOO_LARGE" });
  });

  it("serializes the worker queue, rejects overload and cancels queued and active work before accepting another job", async () => {
    const service = createSessionSummaryExportService({ maxQueued: 1 });
    try {
      const active = new AbortController();
      const queued = new AbortController();
      const first = service.render(summaryFixture(), {
        format: "pdf",
        locale: "en-CA",
        signal: active.signal,
      });
      const firstRejected = expect(first).rejects.toMatchObject({ code: "EXPORT_ABORTED" });
      const second = service.render(summaryFixture(), {
        format: "xlsx",
        locale: "en-CA",
        signal: queued.signal,
      });
      const secondRejected = expect(second).rejects.toMatchObject({ code: "EXPORT_ABORTED" });
      await expect(
        service.render(summaryFixture(), { format: "xlsx", locale: "en-CA" }),
      ).rejects.toMatchObject({ code: "EXPORT_BUSY", statusCode: 503 });
      queued.abort();
      active.abort();
      await Promise.all([firstRejected, secondRejected]);
      const completed = await service.render(summaryFixture(), { format: "xlsx", locale: "en-CA" });
      expect(completed.bytes.subarray(0, 2).toString()).toBe("PK");
    } finally {
      await service.close();
    }
    await expect(
      service.render(summaryFixture(), { format: "xlsx", locale: "en-CA" }),
    ).rejects.toMatchObject({ code: "EXPORT_CLOSED" });
  }, 20_000);

  it("terminates timed-out workers and closes queued requests without leaving promises pending", async () => {
    const service = createSessionSummaryExportService({ timeoutMs: 1 });
    await expect(
      service.render(summaryFixture(), { format: "pdf", locale: "en-CA" }),
    ).rejects.toMatchObject({ code: "EXPORT_TIMEOUT" });
    await service.close();
    const other = createSessionSummaryExportService();
    const first = other.render(summaryFixture(), { format: "pdf", locale: "en-CA" });
    const second = other.render(summaryFixture(), { format: "xlsx", locale: "en-CA" });
    const expectations = [
      expect(first).rejects.toMatchObject({ code: "EXPORT_CLOSED" }),
      expect(second).rejects.toMatchObject({ code: "EXPORT_CLOSED" }),
    ];
    await other.close();
    await Promise.all(expectations);
  }, 20_000);
});
