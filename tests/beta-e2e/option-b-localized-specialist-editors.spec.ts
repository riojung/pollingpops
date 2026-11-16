import { expect, test } from "@playwright/test";
import type { PresentationScene } from "../../packages/contracts/src/index.ts";
import { nativeEditorCopy } from "../../apps/web/components/presentation/native-editor-copy";
import { nativeTextVideoCopy } from "../../apps/web/components/presentation/native-text-video-copy";
import { nativeDataCopy } from "../../apps/web/components/presentation/native-data-copy";
import { createE01Deck, e01ApiUrl, e01Slide, readE01Record } from "./presentation-e01-support";
import { signInBeta } from "./sign-in";
import {
  specialistInspector,
  specialistLocale,
  specialistQuality,
  specialistTextSelection,
} from "./option-b-specialist-support";

for (const suffix of ["desktop", "@mobile"]) {
  test(`Option B Korean specialist editors retain raw text, staged data, video links and viewer grants ${suffix}`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (suffix === "@mobile") await page.setViewportSize({ width: 320, height: 844 });
    const shell = nativeEditorCopy("ko-KR"),
      textCopy = nativeTextVideoCopy("ko-KR"),
      dataCopy = nativeDataCopy("ko-KR");
    expect(textCopy("Bold")).toBe("굵게");
    const slide = e01Slide("Original specialist slide");
    const title = slide.scene!.nodes[0]!;
    const originalText = "Texto original para revisar.\nDecisión compartida";
    slide.scene = {
      schemaVersion: 7,
      aspectRatio: "16:9",
      nodes: [
        title,
        {
          id: "rich-body",
          type: "text",
          role: "body",
          lang: "es",
          text: originalText,
          richText: {
            paragraphs: [
              { kind: "paragraph", runs: [{ text: "Texto original para revisar." }] },
              { kind: "bullet", runs: [{ text: "Decisión compartida", italic: true }] },
            ],
          },
          frame: { x: 7, y: 23, width: 86, height: 18 },
        },
        {
          id: "raw-table",
          type: "table",
          caption: "Original evidence table",
          headers: ["Région", "Valeur"],
          rows: [
            ["East", "10"],
            ["West", "20"],
          ],
          frame: { x: 7, y: 44, width: 40, height: 45 },
        },
        {
          id: "raw-chart",
          type: "chart",
          chartType: "bar",
          title: "Original attendance chart",
          summary: "Original chart explanation",
          categories: ["East", "West"],
          series: [{ name: "Original attendees", values: [10, 20] }],
          frame: { x: 53, y: 44, width: 40, height: 45 },
        },
      ],
      readingOrder: [title.id, "rich-body", "raw-table", "raw-chart"],
    };
    const record = await createE01Deck(page, [slide], 16);
    const saved = async (): Promise<PresentationScene> => {
      const block = (await readE01Record(page, record.id)).draft.blocks[0];
      if (block?.kind !== "content" || !block.scene)
        throw new Error("Expected a native specialist scene");
      return block.scene;
    };
    const node = async (id: string) => (await saved()).nodes.find((node) => node.id === id);
    const writes: string[] = [],
      external: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === `/v1/presentations/${record.id}/draft`
      )
        writes.push(request.postData() ?? "");
      if (new URL(request.url()).hostname === "example.com") external.push(request.url());
    });
    await page.route(/^https?:\/\/example\.com\//, (route) => route.abort());
    try {
      await specialistLocale(page, "ko-KR");
      await page.goto(`/presentation/${record.id}`);
      const inspector = await specialistInspector(page);
      const picker = inspector.getByRole("combobox", {
        name: shell("Selected object"),
        exact: true,
      });
      await picker.selectOption("rich-body");
      const text = inspector.getByRole("textbox", { name: shell("Node text"), exact: true });
      await expect(text).toHaveAttribute("lang", "es");
      await expect(text).toHaveValue(originalText);
      expect(writes).toHaveLength(0);
      await specialistTextSelection(text, 0, 5);
      await inspector.getByRole("button", { name: textCopy("Bold"), exact: true }).click();
      await expect
        .poll(async () => JSON.stringify(await node("rich-body")))
        .toContain('"bold":true');
      const beforeBadLink = await saved(),
        beforeBadLinkWrites = writes.length;
      const link = inspector.getByRole("textbox", { name: textCopy("Link address"), exact: true });
      await link.fill("javascript:alert(1)");
      await inspector.getByRole("button", { name: textCopy("Apply link"), exact: true }).click();
      await expect(inspector.getByRole("alert")).toHaveAttribute("lang", "ko-KR");
      await expect(inspector.getByRole("alert")).toContainText(/[가-힣]/);
      expect(await saved()).toEqual(beforeBadLink);
      expect(writes.length).toBe(beforeBadLinkWrites);
      const href = "https://example.com/decisiones";
      await link.fill(href);
      await specialistTextSelection(text, 0, 5);
      await inspector.getByRole("button", { name: textCopy("Apply link"), exact: true }).click();
      await expect.poll(async () => JSON.stringify(await node("rich-body"))).toContain(href);
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(async () => JSON.stringify(await node("rich-body"))).not.toContain(href);
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect.poll(async () => JSON.stringify(await node("rich-body"))).toContain(href);
      await expect.poll(() => node("rich-body")).toMatchObject({ text: originalText, lang: "es" });
      await specialistQuality(page);
      await inspector.screenshot({ path: info.outputPath("korean-rich-text.png") });

      await picker.selectOption("raw-table");
      const table = inspector.getByRole("group", {
        name: dataCopy("Table data editor"),
        exact: true,
      });
      await expect(table).toHaveAttribute("lang", "ko-KR");
      const paste = table.getByRole("textbox", {
        name: dataCopy("Paste CSV or TSV data"),
        exact: true,
      });
      const rowValue = table.getByRole("textbox", {
        name: dataCopy("Row {row}, column {column}", { row: 1, column: 2 }),
        exact: true,
      });
      const beforePaste = await saved(),
        beforePasteWrites = writes.length;
      await paste.fill('Région,Valeur\n"Unfinished,18');
      await table
        .getByRole("button", { name: dataCopy("Preview pasted data"), exact: true })
        .click();
      await expect(table.getByRole("alert")).toHaveAttribute("lang", "ko-KR");
      await expect(table.getByRole("alert")).toContainText(/[가-힣]/);
      await expect(rowValue).toHaveValue("10");
      expect(await saved()).toEqual(beforePaste);
      expect(writes.length).toBe(beforePasteWrites);
      const rawCsv = 'Région,Valeur\r\n"Nord, ouest",18\r\nSud,22';
      await paste.fill(rawCsv);
      await table
        .getByRole("button", { name: dataCopy("Preview pasted data"), exact: true })
        .click();
      await expect(rowValue).toHaveValue("18");
      expect(await saved()).toEqual(beforePaste);
      await table
        .getByRole("button", { name: dataCopy("Apply table changes"), exact: true })
        .click();
      await expect
        .poll(() => node("raw-table"))
        .toMatchObject({
          caption: "Original evidence table",
          headers: ["Région", "Valeur"],
          rows: [
            ["Nord, ouest", "18"],
            ["Sud", "22"],
          ],
        });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect(rowValue).toHaveValue("10");
      await expect
        .poll(() => node("raw-table"))
        .toMatchObject({
          rows: [
            ["East", "10"],
            ["West", "20"],
          ],
        });
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect(rowValue).toHaveValue("18");
      await expect
        .poll(() => node("raw-table"))
        .toMatchObject({
          rows: [
            ["Nord, ouest", "18"],
            ["Sud", "22"],
          ],
        });

      await picker.selectOption("raw-chart");
      const chart = inspector.getByRole("group", {
        name: dataCopy("Chart data editor"),
        exact: true,
      });
      const chartValue = chart.getByRole("textbox", {
        name: dataCopy("Category {row}, series {series} value", { row: 1, series: 1 }),
        exact: true,
      });
      const beforeFormula = await saved(),
        beforeFormulaWrites = writes.length;
      await chartValue.fill("=6+6");
      await chart
        .getByRole("button", { name: dataCopy("Apply chart changes"), exact: true })
        .click();
      await expect(chart.getByRole("alert")).toHaveAttribute("lang", "ko-KR");
      await expect(chart.getByRole("alert")).toContainText(/[가-힣]/);
      expect(await saved()).toEqual(beforeFormula);
      expect(writes.length).toBe(beforeFormulaWrites);
      await chartValue.fill("12");
      await chart
        .getByRole("combobox", { name: dataCopy("Chart type"), exact: true })
        .selectOption("line");
      await chart
        .getByRole("button", { name: dataCopy("Apply chart changes"), exact: true })
        .click();
      await expect
        .poll(() => node("raw-chart"))
        .toMatchObject({
          chartType: "line",
          title: "Original attendance chart",
          summary: "Original chart explanation",
          categories: ["East", "West"],
          series: [{ name: "Original attendees", values: [12, 20] }],
        });
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect
        .poll(() => node("raw-chart"))
        .toMatchObject({ chartType: "bar", series: [{ values: [10, 20] }] });
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect
        .poll(() => node("raw-chart"))
        .toMatchObject({ chartType: "line", series: [{ values: [12, 20] }] });
      const beforeDiscard = await saved(),
        beforeDiscardWrites = writes.length;
      await chart
        .getByRole("textbox", { name: dataCopy("Chart title"), exact: true })
        .fill("Unsaved original title");
      await chart
        .getByRole("button", { name: dataCopy("Discard staged changes"), exact: true })
        .click();
      await expect(
        chart.getByRole("textbox", { name: dataCopy("Chart title"), exact: true }),
      ).toHaveValue("Original attendance chart");
      expect(await saved()).toEqual(beforeDiscard);
      expect(writes.length).toBe(beforeDiscardWrites);
      await specialistQuality(page);
      await inspector.screenshot({ path: info.outputPath("korean-chart-editor.png") });

      await specialistInspector(page, "media");
      const video = inspector.getByRole("group", { name: textCopy("External video"), exact: true });
      await video
        .getByRole("textbox", { name: textCopy("Video title"), exact: true })
        .fill("Original video choice");
      const videoUrl = video.getByRole("textbox", {
        name: textCopy("Video HTTPS link"),
        exact: true,
      });
      await videoUrl.fill("http://example.com/watch");
      await video
        .getByRole("textbox", { name: textCopy("Captions or transcript HTTPS link"), exact: true })
        .fill("https://example.com/transcript");
      const beforeVideo = await saved(),
        beforeVideoWrites = writes.length;
      await video
        .getByRole("button", { name: textCopy("Add external video link"), exact: true })
        .click();
      await expect(video.getByRole("alert")).toHaveAttribute("lang", "ko-KR");
      await expect(video.getByRole("alert")).toContainText(/[가-힣]/);
      expect(await saved()).toEqual(beforeVideo);
      expect(writes.length).toBe(beforeVideoWrites);
      await videoUrl.fill("https://example.com/watch");
      await video
        .getByRole("button", { name: textCopy("Add external video link"), exact: true })
        .click();
      await expect.poll(async () => (await saved()).nodes.length).toBe(5);
      const addedVideo = (await saved()).nodes.at(-1)!;
      expect(JSON.stringify(addedVideo)).toContain("Original video choice");
      expect(JSON.stringify(addedVideo)).toContain("https://example.com/watch");
      expect(JSON.stringify(addedVideo)).toContain("https://example.com/transcript");
      await page.getByRole("button", { name: "실행 취소", exact: true }).click();
      await expect.poll(saved).toEqual(beforeVideo);
      await page.getByRole("button", { name: "다시 실행", exact: true }).click();
      await expect.poll(async () => (await saved()).nodes.at(-1)).toEqual(addedVideo);
      await specialistQuality(page);
      expect(external).toHaveLength(0);

      const finalScene = await saved(),
        beforeLocale = writes.length;
      await specialistLocale(page, "de-DE");
      await page.reload();
      await specialistInspector(page);
      const german = nativeEditorCopy("de-DE");
      await inspector
        .getByRole("combobox", { name: german("Selected object"), exact: true })
        .selectOption("raw-table");
      await expect(
        inspector.getByRole("group", {
          name: nativeDataCopy("de-DE")("Table data editor"),
          exact: true,
        }),
      ).toHaveAttribute("lang", "de-DE");
      await specialistQuality(page);
      expect(await saved()).toEqual(finalScene);
      expect(writes.length).toBe(beforeLocale);

      await specialistLocale(page, "ko-KR");
      await page.route(`${e01ApiUrl}/v1/auth/me`, async (route) => {
        const response = await route.fetch(),
          account = await response.json();
        account.creator.role = "viewer";
        await route.fulfill({ response, json: account });
      });
      await page.reload();
      await specialistInspector(page);
      const beforeInspection = writes.length;
      await expect(picker).toBeEnabled();
      await picker.selectOption("rich-body");
      await expect(text).toHaveValue(originalText);
      await expect(text).toHaveAttribute("lang", "es");
      await expect(text).toBeDisabled();
      await expect(
        inspector.getByRole("button", { name: textCopy("Bold"), exact: true }),
      ).toBeDisabled();
      await picker.selectOption("raw-table");
      await expect(paste).toBeDisabled();
      await expect(
        table.getByRole("button", { name: dataCopy("Apply table changes"), exact: true }),
      ).toBeDisabled();
      await specialistQuality(page);
      await specialistInspector(page, "media");
      await expect(videoUrl).toBeDisabled();
      await specialistQuality(page);
      expect(await saved()).toEqual(finalScene);
      expect(writes.length).toBe(beforeInspection);
    } finally {
      await page.unroute(`${e01ApiUrl}/v1/auth/me`);
      await specialistLocale(page, "en-CA");
    }
  });
}
