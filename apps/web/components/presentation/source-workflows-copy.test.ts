import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { assistanceCopy } from "./assistance-copy";
import {
  sourceWorkflowsCopy,
  sourceWorkflowsCopyKeys,
  sourceWorkflowsFeedback,
} from "./source-workflows-copy";

describe("source workflow guidance", () => {
  it.each(supportedLocales)("covers all guidance in %s and reuses Close", (locale) => {
    const copy = sourceWorkflowsCopy(locale);
    for (const key of sourceWorkflowsCopyKeys) {
      expect(copy(key).trim()).not.toBe("");
      if (locale === "en-CA") expect(copy(key)).toBe(key);
      else expect(copy(key)).not.toBe(key);
    }
    expect(copy("Close")).toBe(assistanceCopy(locale)("Close"));
  });

  it("defaults to English without projecting arbitrary source values as system copy", () => {
    expect(new Set(sourceWorkflowsCopyKeys).size).toBe(sourceWorkflowsCopyKeys.length);
    for (const key of sourceWorkflowsCopyKeys) {
      expect(sourceWorkflowsCopy()(key)).toBe(key);
      expect(sourceWorkflowsCopy("unknown" as SupportedLocale)(key)).toBe(key);
    }
    const known = "Save this Presentation before inserting source proposals.";
    expect(sourceWorkflowsFeedback("ko-KR", known)).toEqual({
      text: sourceWorkflowsCopy("ko-KR")(known),
      lang: "ko-KR",
    });
    for (const raw of ["Insert from a trusted source", "Grounded source:", known + " detail", ""]) {
      expect(sourceWorkflowsFeedback("ko-KR", raw)).toEqual({ text: raw, lang: "en-CA" });
    }
  });
});
