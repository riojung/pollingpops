import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { nativeEditorCopy } from "./native-editor-copy";
import { nativeDataCopy, nativeDataCopyKeys, nativeDataFeedback } from "./native-data-copy";

const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];
const recovery = " Edit the staged data or discard your changes, then try again.";

describe("native table and chart editor copy", () => {
  it.each(supportedLocales)("covers every source key and interpolation in %s", (locale) => {
    const copy = nativeDataCopy(locale);
    for (const key of nativeDataCopyKeys) {
      const message = copy(key);
      expect(message.trim(), key).not.toBe("");
      expect(placeholders(message), key).toEqual(placeholders(key));
      const values = Object.fromEntries(
        placeholders(key).map((token) => [token.slice(1, -1), `Original ${token} <author value>`]),
      );
      for (const value of Object.values(values)) expect(copy(key, values), key).toContain(value);
      if (locale === "en-CA") expect(message, key).toBe(key);
      else expect(message, key).not.toBe(key);
    }
  });

  it("keeps a unique inventory and reuses the common chart option names", () => {
    expect(nativeDataCopyKeys).toHaveLength(67);
    expect(new Set(nativeDataCopyKeys).size).toBe(nativeDataCopyKeys.length);
    for (const locale of supportedLocales.filter((item) => item !== "en-CA")) {
      const copy = nativeDataCopy(locale);
      const shared = nativeEditorCopy(locale);
      expect(copy("Bar")).toBe(shared("bar"));
      expect(copy("Line")).toBe(shared("line"));
      expect(copy("Pie")).toBe(shared("pie"));
    }
  });

  it("provides concrete Korean controls and keeps unresolved placeholders", () => {
    const copy = nativeDataCopy("ko-KR");
    expect(copy("Table data editor")).toBe("표 데이터 편집기");
    expect(copy("Chart data editor")).toBe("차트 데이터 편집기");
    expect(copy("Table caption")).toBe("표 캡션");
    expect(copy("Chart title")).toBe("차트 제목");
    expect(copy("Chart description")).toBe("차트 설명");
    expect(copy("Chart type")).toBe("차트 유형");
    expect(copy("Paste CSV or TSV data")).toBe("CSV 또는 TSV 데이터 붙여넣기");
    expect(copy("Preview pasted data")).toBe("붙여넣은 데이터 미리 보기");
    expect(copy("Apply chart changes")).toBe("차트 변경 사항 적용");
    expect(copy("Apply table changes")).toBe("표 변경 사항 적용");
    expect(copy("Discard staged changes")).toBe("적용 대기 중인 변경 사항 취소");
    expect(copy("Row {row}, column {column}", { row: 3, column: 6 })).toBe("행 3, 열 6");
    expect(copy("Series {series} name")).toBe("계열 {series} 이름");
  });

  it.each(supportedLocales)("localizes exact and bounded source diagnostics in %s", (locale) => {
    const copy = nativeDataCopy(locale);
    const finite = "A quoted cell is unfinished. Close its quote, then preview again.";
    expect(nativeDataFeedback(locale, finite)).toEqual({ text: copy(finite), language: locale });
    const numeric =
      "Row 20, series 4: use a finite number between −1 trillion and 1 trillion. Formulas and blank values are unsupported.";
    expect(nativeDataFeedback(locale, numeric)).toEqual({
      text: copy(
        "Row {row}, series {series}: use a finite number between −1 trillion and 1 trillion. Formulas and blank values are unsupported.",
        { row: 20, series: 4 },
      ),
      language: locale,
    });
    for (const source of [
      "Pie charts require one nonnegative series with a positive total",
      "Use plain text without control characters",
      "Every table row must match the header count",
      "Each chart series must match the category count",
      "The scene exceeds its 128 KiB UTF-8 JSON budget",
      "This data exceeds the slide’s limits.",
    ] as const) {
      expect(nativeDataFeedback(locale, source + recovery)).toEqual({
        text: `${copy(source)} ${copy("Edit the staged data or discard your changes, then try again.")}`,
        language: locale,
      });
    }
    for (const limit of [80, 120, 160, 300, 800]) {
      expect(
        nativeDataFeedback(
          locale,
          `Too big: expected string to have <=${limit} characters${recovery}`,
        ),
      ).toEqual({
        text: `${copy("Too big: expected string to have <={limit} characters", { limit })} ${copy("Edit the staged data or discard your changes, then try again.")}`,
        language: locale,
      });
    }
    for (const limit of [4, 6, 20]) {
      expect(
        nativeDataFeedback(locale, `Too big: expected array to have <=${limit} items`),
      ).toEqual({
        text: copy("Too big: expected array to have <={limit} items", { limit }),
        language: locale,
      });
    }
    expect(nativeDataFeedback(locale, "Too small: expected array to have >=1 items")).toEqual({
      text: copy("Too small: expected array to have >={limit} items", { limit: 1 }),
      language: locale,
    });
  });

  it("leaves unknown or altered diagnostics byte-for-byte English without substituting authored text", () => {
    for (const source of [
      "Unknown source problem <author value> {row}",
      "Chart title",
      "Use plain text without control characters: Original author label",
      `Original author label${recovery}`,
      "Too big: expected string to have <=999 characters",
      "Too big: expected string to have <=080 characters",
      "Too big: expected array to have <=50 items",
      "Too small: expected array to have >=0 items",
      "Row 21, series 1: use a finite number between −1 trillion and 1 trillion. Formulas and blank values are unsupported.",
      "Row 1, series 5: use a finite number between −1 trillion and 1 trillion. Formulas and blank values are unsupported.",
      "Row <author>, series 1: use a finite number between −1 trillion and 1 trillion. Formulas and blank values are unsupported.",
    ]) {
      expect(nativeDataFeedback("ko-KR", source)).toEqual({ text: source, language: "en-CA" });
    }
  });

  it("defaults to the existing English labels for missing or unsupported locale", () => {
    expect(nativeDataCopy()("Bar")).toBe("Bar");
    expect(nativeDataCopy()("Apply table changes")).toBe("Apply table changes");
    expect(nativeDataCopy("xx-XX" as SupportedLocale)("Apply table changes")).toBe(
      "Apply table changes",
    );
    expect(nativeDataCopy("xx-XX" as SupportedLocale)("Bar")).toBe("Bar");
  });
});
