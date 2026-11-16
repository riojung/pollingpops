import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  packPracticeCopy,
  packPracticeCopyKeys,
  packPracticeFeedback,
  packPracticeFeedbackKeys,
} from "./pack-practice-copy";

describe("Pack practice entry copy", () => {
  it.each(supportedLocales)("covers both practice modes in %s", (locale) => {
    for (const key of packPracticeCopyKeys) {
      const copy = packPracticeCopy(locale)(key);
      expect(copy.trim()).not.toBe("");
      if (locale === "en-CA") expect(copy).toBe(key);
      else expect(copy).not.toBe(key);
    }
    for (const key of packPracticeFeedbackKeys)
      expect(packPracticeFeedback(locale, key)).toEqual({
        text: packPracticeCopy(locale)(key),
        lang: locale,
      });
  });
  it("defaults to English and leaves unrecognized diagnostics intact", () => {
    expect(new Set(packPracticeCopyKeys).size).toBe(packPracticeCopyKeys.length);
    for (const key of packPracticeCopyKeys) {
      expect(packPracticeCopy()(key)).toBe(key);
      expect(packPracticeCopy("unknown" as SupportedLocale)(key)).toBe(key);
    }
    for (const raw of [
      "Full-sequence Pack practice",
      "Unknown service detail {source}",
      "An owner or editor must create the practice assignment. More detail",
      "",
    ])
      expect(packPracticeFeedback("ko-KR", raw)).toEqual({ text: raw, lang: "en-CA" });
  });
});
