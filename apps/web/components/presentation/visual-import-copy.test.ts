import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { nativeControlsCopy } from "./native-controls-copy";
import { presentationCommandCopy } from "./presentation-command-copy";
import {
  visualImportCopy,
  visualImportCopyKeys,
  visualImportFeedback,
  visualImportFeedbackKeys,
} from "./visual-import-copy";

const placeholders = (source: string) => source.match(/\{\w+\}/g)?.sort() ?? [];

describe("visual import display copy", () => {
  it.each(supportedLocales)(
    "covers the complete catalog and preserves raw interpolation in %s",
    (locale) => {
      const copy = visualImportCopy(locale);
      for (const key of visualImportCopyKeys) {
        expect(copy(key).trim(), key).not.toBe("");
        expect(placeholders(copy(key)), key).toEqual(placeholders(key));
        const values = Object.fromEntries(
          placeholders(key).map((token) => [token.slice(1, -1), `Original <value> ${token}`]),
        );
        for (const value of Object.values(values)) expect(copy(key, values), key).toContain(value);
        if (locale === "en-CA") expect(copy(key)).toBe(key);
        else if (!(
          locale === "fr-FR" && ["Page {page}", "Page {page} · position {position}"].includes(key)
        ))
          expect(copy(key), key).not.toBe(key);
      }
      expect(copy("Slide title")).toBe(nativeControlsCopy(locale)("Slide title"));
      expect(copy("Import visual slides")).toBe(presentationCommandCopy(locale).importVisual);
    },
  );

  it("defaults to English with a unique inventory", () => {
    expect(visualImportCopyKeys.length).toBeGreaterThan(120);
    expect(new Set(visualImportCopyKeys).size).toBe(visualImportCopyKeys.length);
    for (const key of visualImportCopyKeys) {
      expect(visualImportCopy()(key)).toBe(key);
      expect(visualImportCopy("unknown" as SupportedLocale)(key)).toBe(key);
    }
  });

  it.each(supportedLocales)(
    "translates only allowlisted feedback and exact bounded templates in %s",
    (locale) => {
      for (const key of visualImportFeedbackKeys)
        expect(visualImportFeedback(locale, key)).toEqual({
          text: visualImportCopy(locale)(key),
          lang: locale,
        });
      expect(visualImportFeedback(locale, "Choose a PDF no larger than 6.291456 MB.")).toEqual({
        text: visualImportCopy(locale)("Choose a PDF no larger than {max} MB.", {
          max: "6.291456",
        }),
        lang: locale,
      });
      expect(
        visualImportFeedback(
          locale,
          "Page 2: extracted text was limited to 6000 characters; review and complete it.",
        ),
      ).toEqual({
        text: visualImportCopy(locale)(
          "Page {page}: extracted text was limited to {max} characters; review and complete it.",
          { page: "2", max: "6000" },
        ),
        lang: locale,
      });
      for (const raw of [
        "Import visual slides",
        "Slide title",
        "Review.pdf",
        "Unbekannter Fehler <content>",
        "Choose at most 40 images. More diagnostics",
        "Before Page 2: extracted text was limited to 6000 characters; review and complete it.",
        "",
      ])
        expect(visualImportFeedback(locale, raw)).toEqual({ text: raw, lang: "en-CA" });
    },
  );

  it("provides concrete Korean review and German recovery copy", () => {
    expect(visualImportCopy("ko-KR")("Import visual slides")).toBe("시각적 슬라이드 가져오기");
    expect(visualImportCopy("ko-KR")("Image description")).toBe("이미지 설명");
    expect(visualImportCopy("de-DE")("Retry same insertion")).toBe(
      "Dieselbe Einfügung erneut versuchen",
    );
  });
});
