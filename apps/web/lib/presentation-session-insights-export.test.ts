import { describe, expect, it } from "vitest";
import {
  presentationInsightsCsv,
  presentationInsightsHtml,
  presentationInsightsView,
} from "./presentation-session-insights-export";
import {
  insightsId,
  presentationInsightsFixture,
} from "./presentation-session-insights.test-fixtures";

describe("truthful Presentation insights projection", () => {
  it("localizes only constructed UI labels and records authored boundaries for colliding titles, sections and options", () => {
    const value = presentationInsightsFixture();
    value.title = "Content";
    value.delivery.blocks[0]!.title = "Content";
    value.delivery.blocks[2]!.title = "Presented {block} $&";
    value.delivery.sections[0]!.title = "Presented";
    value.participation.questions.find(
      (question) => question.purpose === "opinion",
    )!.results[0]!.label = "Not recorded";
    const before = structuredClone(value);
    const csv = presentationInsightsCsv(value, "de-DE");
    const html = presentationInsightsHtml(value, "de-DE");
    const copy: NonNullable<Parameters<typeof presentationInsightsView>[2]> = (key, values = {}) =>
      `UI ${key}`.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
    const view = presentationInsightsView(value, "de-DE", copy);
    expect(view.title).toBe("Content");
    expect(view.facts).toContainEqual([
      "UI Content",
      "UI Frozen session content; session additions are marked below.",
    ]);
    const sections = view.tables.find((table) => table.title === "UI Section delivery")!;
    expect(sections.rows[0]![0]).toBe("Presented");
    expect(sections.authoredCells![0]![0]).toBe(true);
    expect(sections.rows[2]![0]).toBe("UI Unsectioned");
    expect(sections.authoredCells![2]![0]).toBe(false);
    const blocks = view.tables.find((table) => table.title === "UI Block delivery")!;
    expect(blocks.rows[0]).toEqual([
      "1. Content",
      "UI Content",
      "Presented",
      "UI Presented",
      "UI Published content",
    ]);
    expect(blocks.authoredCells![0]).toEqual([true, false, true]);
    const distribution = view.tables.find((table) =>
      table.title.startsWith("UI Opinion distribution"),
    )!;
    expect(distribution.title).toBe("UI Opinion distribution · 3. Presented {block} $&");
    expect(distribution.titleParts?.filter((part) => part.authored)).toEqual([
      { text: "3. Presented {block} $&", authored: true },
    ]);
    expect(distribution.rows[0]).toEqual(["Not recorded", "3"]);
    expect(distribution.authoredCells![0]![0]).toBe(true);
    const skipped = view.tables.find((table) =>
      table.title.startsWith("UI Quick Check distribution"),
    )!;
    expect(skipped.rows[0]).toEqual(["UI Not applicable"]);
    expect(skipped.authoredCells?.[0]?.[0]).not.toBe(true);
    expect(value).toEqual(before);
    expect(presentationInsightsCsv(value, "de-DE")).toBe(csv);
    expect(presentationInsightsHtml(value, "de-DE")).toBe(html);
  });

  it("localizes generated block fallbacks while marking no authored language on missing titles", () => {
    const value = presentationInsightsFixture();
    value.delivery.blocks[0]!.title = "";
    value.delivery.blocks[2]!.title = "";
    const copy: NonNullable<Parameters<typeof presentationInsightsView>[2]> = (key, values = {}) =>
      `UI ${key}`.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
    const view = presentationInsightsView(value, "en-CA", copy);
    const blocks = view.tables.find((table) => table.title === "UI Block delivery")!;
    expect(blocks.rows[0]![0]).toBe("1. UI Untitled block");
    expect(blocks.authoredCells![0]![0]).toBe(false);
    const distribution = view.tables.find((table) =>
      table.title.startsWith("UI Opinion distribution"),
    )!;
    expect(distribution.titleParts?.some((part) => part.authored)).toBe(false);
    expect(distribution.title).toBe("UI Opinion distribution · 3. UI Untitled block");
  });

  it("uses recorded reveal rosters rather than the final joined count and keeps zero distinct from missing", () => {
    const view = presentationInsightsView(presentationInsightsFixture());
    const assessment = view.tables.find(
      (table) => table.title === "Response coverage · Assessed activities",
    )!;
    expect(assessment.rows[0]!.slice(2, 7)).toEqual(["10", "10", "0", "100%", "Recorded"]);
    expect(
      assessment.rows.find((row) => row[0]!.includes("Recorded zero roster"))!.slice(2, 7),
    ).toEqual(["0", "0", "0", "Not applicable · zero joined by reveal", "Recorded"]);
    expect(
      assessment.rows.find((row) => row[0]!.includes("Legacy no roster"))!.slice(2, 7),
    ).toEqual([
      "5",
      "Not recorded",
      "Not recorded",
      "Not recorded",
      "Not recorded for this older activity",
    ]);
    expect(assessment.columns).not.toContain("Accuracy");
    expect(assessment.note).toContain("original denominator");
    expect(view.facts).toContainEqual(["Participant identities joined", "12"]);
    expect(view.facts).toContainEqual(["Accepted response records", "28"]);
    expect(view.facts).toContainEqual(["Delivery coverage", "Not recorded"]);
  });
  it("separates suppressed text, opinion option counts, skipped Quick Checks and paired recovery", () => {
    const view = presentationInsightsView(presentationInsightsFixture());
    const text = view.tables.find((table) => table.title.includes("Moderated text activities"))!;
    expect(text.rows[0]!.slice(1, 6)).toEqual([
      "Hidden · fewer than 5 responses",
      "Hidden",
      "Hidden",
      "Hidden",
      "Hidden",
    ]);
    const skipped = view.tables.find((table) => table.title.includes("Session-only Quick Checks"))!;
    expect(skipped.rows[0]!.slice(1, 4)).toEqual([
      "Skipped · not presented",
      "Not collected",
      "Not collected",
    ]);
    const opinion = view.tables.find((table) => table.title.startsWith("Opinion distribution"))!;
    expect(opinion.rows).toEqual([
      ["Discuss", "3"],
      ["Continue", "2"],
    ]);
    expect(opinion.note).toContain("several options");
    const recovery = view.tables.find((table) => table.title === "Recovery evidence")!;
    expect(recovery.rows[0]!.slice(3)).toEqual(["5", "3", "60%"]);
    expect(recovery.note).toContain("incorrect initial answer and an accepted recheck");
  });
  it("labels frozen version, session additions, section counts and each freshness timestamp separately", () => {
    const value = presentationInsightsFixture();
    value.freshness.finishedAtBasis = "legacy_updated_at";
    value.delivery.startedAt = null;
    value.delivery.wallClockElapsedSeconds = null;
    const view = presentationInsightsView(value);
    expect(view.facts).toContainEqual(["Published version", "Version 2"]);
    expect(view.facts.some(([label]) => label === "Finished (legacy transition timestamp)")).toBe(
      true,
    );
    expect(view.facts.some(([label]) => label === "Report generated")).toBe(true);
    expect(view.facts.some(([label]) => label === "Insights calculated")).toBe(true);
    expect(view.facts).toContainEqual(["Elapsed wall-clock time", "Not recorded"]);
    expect(view.tables[0]!.rows).toContainEqual([
      "Unsectioned",
      "2",
      "1",
      "1",
      "4",
      "Not recorded",
    ]);
    const blocks = view.tables.find((table) => table.title === "Block delivery")!;
    expect(blocks.rows.find((row) => row[0]!.includes("Skipped Quick Check"))!.at(-1)).toBe(
      "Added during this session",
    );
    expect(blocks.rows.find((row) => row[0]!.includes("Legacy no roster"))!.at(-1)).toBe(
      "Source not recorded",
    );
    expect(view.qna).toContainEqual(["Public questions", "5"]);
    expect(view.qnaNote).toContain("Current public moderation counts");
  });
  it("keeps valid response coverage when only the opinion distribution is unavailable in both copies", () => {
    const value = presentationInsightsFixture();
    const opinion = value.participation.questions.find(
      (question) => question.blockId === insightsId(12),
    )!;
    opinion.distributionStatus = "unavailable";
    opinion.results = [];
    const view = presentationInsightsView(value);
    const coverage = view.tables.find(
      (table) => table.title === "Response coverage · Opinion activities",
    )!;
    expect(coverage.rows[0]!.slice(2, 7)).toEqual(["5", "10", "5", "50%", "Recorded"]);
    const distribution = view.tables.find((table) =>
      table.title.startsWith("Opinion distribution"),
    )!;
    expect(distribution.rows).toEqual([["Unavailable"]]);
    expect(distribution.note).toBe("Opinion distribution is unavailable for this activity.");
    for (const copy of [presentationInsightsCsv(value), presentationInsightsHtml(value)]) {
      expect(copy).toContain("Opinion distribution is unavailable for this activity.");
      expect(copy).toContain("Distribution availability");
      expect(copy).not.toContain("Respondents selecting option");
    }
  });
  it("distinguishes suppressed distributions from not-applicable skipped activity distributions", () => {
    const value = presentationInsightsFixture();
    const opinion = value.participation.questions.find(
      (question) => question.blockId === insightsId(12),
    )!;
    Object.assign(opinion, {
      status: "suppressed",
      unavailableReason: "insufficient_sample",
      acceptedRespondents: null,
      joinedByRevealCount: null,
      notRespondedByRevealCount: null,
      responseRatePercent: null,
      denominatorBasis: "unavailable",
      denominatorStatus: "suppressed",
      distributionStatus: "suppressed",
      results: [],
    });
    const view = presentationInsightsView(value);
    const distribution = view.tables.find((table) =>
      table.title.startsWith("Opinion distribution"),
    )!;
    expect(distribution.rows).toEqual([["Hidden · fewer than five responses"]]);
    expect(distribution.note).toContain("below five");
    const skipped = view.tables.find((table) =>
      table.title.startsWith("Quick Check distribution"),
    )!;
    expect(skipped.rows).toEqual([["Not applicable"]]);
    expect(skipped.note).toContain("does not apply");
    for (const copy of [presentationInsightsCsv(value), presentationInsightsHtml(value)]) {
      expect(copy).toContain("Hidden · fewer than five responses");
      expect(copy).toContain("Opinion distribution does not apply to this activity.");
    }
  });
  it("includes an unscored Quick Check histogram without adding assessment evidence", () => {
    const value = presentationInsightsFixture();
    const block = value.delivery.blocks.find((entry) => entry.blockId === insightsId(16))!;
    block.status = "presented";
    block.title = "Live Quick Check";
    value.delivery.totals.presentedBlocks += 1;
    value.delivery.totals.skippedBlocks -= 1;
    const section = value.delivery.sections.find((entry) => entry.sectionId === null)!;
    section.presentedBlocks += 1;
    section.skippedBlocks -= 1;
    const quickCheck = value.participation.questions.find(
      (question) => question.blockId === block.blockId,
    )!;
    Object.assign(quickCheck, {
      status: "available",
      acceptedRespondents: 5,
      joinedByRevealCount: 7,
      notRespondedByRevealCount: 2,
      responseRatePercent: 71.4,
      denominatorBasis: "joined_by_reveal",
      denominatorStatus: "recorded",
      distributionStatus: "available",
      maxSelections: 1,
      results: [
        { label: "Yes", value: 3 },
        { label: "No", value: 2 },
      ],
    });
    value.participation.acceptedResponseCount += 5;
    const distribution = presentationInsightsView(value).tables.find((table) =>
      table.title.startsWith("Quick Check distribution"),
    )!;
    expect(distribution.rows).toEqual([
      ["Yes", "3"],
      ["No", "2"],
    ]);
    expect(distribution.note).toContain("accepted Quick Check responses");
    for (const copy of [presentationInsightsCsv(value), presentationInsightsHtml(value)]) {
      expect(copy).toContain("Quick Check distribution");
      expect(copy).not.toMatch(/accuracy_percent|Correct among assessed responses/);
    }
  });
  it("retains the complete bounded rating histogram", () => {
    const value = presentationInsightsFixture();
    const opinion = value.participation.questions.find(
      (question) => question.blockId === insightsId(12),
    )!;
    opinion.results = Array.from({ length: 100 }, (_, index) => ({
      label: `Rating ${index + 1}`,
      value: index === 99 ? 5 : 0,
    }));
    opinion.maxSelections = 1;
    const distribution = presentationInsightsView(value).tables.find((table) =>
      table.title.startsWith("Opinion distribution"),
    )!;
    expect(distribution.rows).toHaveLength(100);
    expect(distribution.rows.at(-1)).toEqual(["Rating 100", "5"]);
    expect(presentationInsightsCsv(value)).toContain('"Rating 100","5"');
    expect(presentationInsightsHtml(value)).toContain('<th scope="row">Rating 100</th><td>5</td>');
  });
  it("retains known-zero coverage while suppressing an opinion histogram below the sample threshold", () => {
    const value = presentationInsightsFixture();
    const opinion = value.participation.questions.find(
      (question) => question.blockId === insightsId(12),
    )!;
    Object.assign(opinion, {
      acceptedRespondents: 0,
      joinedByRevealCount: 0,
      notRespondedByRevealCount: 0,
      responseRatePercent: null,
      distributionStatus: "suppressed",
      results: [],
    });
    const view = presentationInsightsView(value);
    const coverage = view.tables.find(
      (table) => table.title === "Response coverage · Opinion activities",
    )!;
    expect(coverage.rows[0]!.slice(2, 6)).toEqual([
      "0",
      "0",
      "0",
      "Not applicable · zero joined by reveal",
    ]);
    const distribution = view.tables.find((table) =>
      table.title.startsWith("Opinion distribution"),
    )!;
    expect(distribution.rows).toEqual([["Hidden · fewer than five responses"]]);
    expect(presentationInsightsCsv(value)).not.toContain('"Discuss"');
    expect(presentationInsightsHtml(value)).not.toContain("Respondents selecting option");
  });
  it.each(["suppressed", "not_enabled", "unavailable"] as const)(
    "keeps %s Q&A counts absent rather than showing zero",
    (status) => {
      const value = presentationInsightsFixture();
      value.qna = {
        status,
        asOf: null,
        audienceSeq: null,
        publicQuestionCount: null,
        answeredQuestionCount: null,
        unansweredQuestionCount: null,
        upvoteCount: null,
      };
      const view = presentationInsightsView(value);
      expect(view.qna).toEqual([]);
      expect(view.qnaNote).not.toBe("");
    },
  );
  it("escapes every authored CSV field that could become a spreadsheet formula", () => {
    const value = presentationInsightsFixture();
    value.title = "=TITLE()";
    value.delivery.blocks[1]!.title = 'A "quoted", question\nNext line';
    value.delivery.sections[0]!.title = "\t+SECTION()";
    value.participation.questions.find(
      (question) => question.blockId === insightsId(12),
    )!.results[0]!.label = " @CHOICE()";
    const csv = presentationInsightsCsv(value);
    expect(csv).toContain('"\'=TITLE()"');
    expect(csv).toContain('"\'\t+SECTION()"');
    expect(csv).toContain('"\' @CHOICE()"');
    expect(csv).toContain('A ""quoted"", question\nNext line');
    expect(csv).not.toContain("correct_responses");
  });
  it("produces a self-contained semantic HTML copy with escaped author strings and the same suppression", () => {
    const value = presentationInsightsFixture();
    value.title = '<script>alert("title")</script>';
    value.delivery.sections[0]!.title = '<img src="https://example.test/tracker" onerror="bad()">';
    const html = presentationInsightsHtml(value);
    expect(html).toContain("&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=&quot;https://example.test/tracker&quot;");
    expect(html).toContain('<th scope="col">Participants joined by reveal</th>');
    expect(html).toContain('<th scope="row">');
    expect(html).toContain("Not applicable · zero joined by reveal");
    expect(html).toContain("Hidden · fewer than 5 responses");
    expect(html).toContain("Downloaded copies cannot be revoked");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<(?:script|img|iframe|link)\b|<[^>]+\sonerror=|<form\b/i);
  });
  it("gives every exported scrollable table a focusable, correctly escaped named region", () => {
    const value = presentationInsightsFixture();
    value.delivery.blocks[2]!.title = 'Quoted "poll" & <context>';
    const html = presentationInsightsHtml(value);
    const entities: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
    };
    const decode = (encoded: string) =>
      encoded.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => entities[entity]!);
    const regions = [
      ...html.matchAll(/<section><h2>([^<]*)<\/h2><div\b([^>]*)>(<table>[\s\S]*?<\/table>)/g),
    ].map((match) => {
      const attributes = Object.fromEntries(
        [...match[2]!.matchAll(/([a-z-]+)="([^"]*)"/g)].map((attribute) => [
          attribute[1]!,
          decode(attribute[2]!),
        ]),
      );
      return {
        heading: decode(match[1]!),
        label: attributes["aria-label"],
        role: attributes.role,
        tabIndex: attributes.tabindex === undefined ? null : Number(attributes.tabindex),
        caption: decode(match[3]!.match(/<caption>([^<]*)<\/caption>/)![1]!),
      };
    });
    const titles = presentationInsightsView(value).tables.map((table) => table.title);
    expect(regions).toHaveLength(titles.length);
    expect(regions.length).toBeGreaterThan(0);
    for (const [index, region] of regions.entries())
      expect(region).toEqual({
        heading: titles[index],
        label: titles[index],
        role: "region",
        tabIndex: 0,
        caption: titles[index],
      });
    expect(regions.some((region) => region.label?.includes('Quoted "poll" & <context>'))).toBe(
      true,
    );
  });
  it("preserves every column and value once per mobile record, with the row identifier first", () => {
    const value = presentationInsightsFixture();
    value.delivery.blocks[2]!.title = '<img src="https://example.test/tracker"> & "quoted"';
    value.participation.questions.find(
      (question) => question.purpose === "opinion",
    )!.results[0]!.label = '<script>bad()</script> & "choice"';
    const html = presentationInsightsHtml(value);
    const entities: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
    };
    const decode = (encoded: string) =>
      encoded.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => entities[entity]!);
    const groups = [...html.matchAll(/<div class="mobile-records">([\s\S]*?)<\/div><\/div>/g)].map(
      (group) =>
        [...group[1]!.matchAll(/<dl class="mobile-record">([\s\S]*?)<\/dl>/g)].map((record) =>
          [...record[1]!.matchAll(/<div><dt>([^<]*)<\/dt><dd>([^<]*)<\/dd><\/div>/g)].map(
            (pair) => [decode(pair[1]!), decode(pair[2]!)],
          ),
        ),
    );
    const tables = presentationInsightsView(value).tables;
    expect(groups).toHaveLength(tables.length);
    for (const [index, table] of tables.entries()) {
      expect(groups[index]).toHaveLength(table.rows.length);
      expect(groups[index]).toEqual(
        table.rows.map((row) => table.columns.map((column, at) => [column, row[at] ?? ""])),
      );
      for (const [rowIndex, record] of groups[index]!.entries())
        expect(record[0]).toEqual([table.columns[0], table.rows[rowIndex]![0]]);
    }
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt; &amp; &quot;choice&quot;");
    expect(html).not.toMatch(/<(?:script|img|iframe)\b/);
  });
  it("uses records only for narrow screens and preserves native tables for desktop and print", () => {
    const html = presentationInsightsHtml(presentationInsightsFixture());
    const css = html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
    expect(css).toContain(".mobile-records{display:none}");
    const mobile = css.match(
      /@media screen and \(max-width:640px\)\{([\s\S]*?)\}@media print/,
    )![1]!;
    expect(mobile).toContain(".table table{display:none}");
    expect(mobile).toContain(".mobile-records{display:block}");
    const print = css.match(/@media print\{([\s\S]*)\}$/)![1]!;
    expect(print).toContain(".mobile-records{display:none}");
    expect(print).not.toContain(".table table{display:none}");
    expect(print).toContain("body{max-width:none;width:auto;margin:0;padding:0}");
    expect(print).toContain(".table{overflow:visible}");
    expect(print).toContain("table{width:100%;table-layout:fixed}");
    expect(print).toContain("th,td,th:first-child,td:first-child{min-width:0}");
    expect(css).not.toMatch(/display:(?:grid|flex|block)[^}]*\}[^@]*table/);
    expect(html.match(/<table>/g)).toHaveLength(
      presentationInsightsView(presentationInsightsFixture()).tables.length,
    );
    expect(html).not.toMatch(/<table[^>]+role=/);
  });
});
