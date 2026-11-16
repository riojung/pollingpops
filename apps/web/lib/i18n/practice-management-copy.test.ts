import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { followupCopy } from "./followup-copy";
import { packPracticeFeedbackKeys } from "./pack-practice-copy";
import {
  practiceManagementCopy,
  practiceManagementCopyKeys,
  practiceManagementDiagnosticKeys,
  practiceManagementFeedback,
} from "./practice-management-copy";

describe("practice management copy", () => {
  it.each(supportedLocales)("provides complete management copy in %s", (locale) => {
    for (const key of practiceManagementCopyKeys) {
      const translated = practiceManagementCopy(locale)(key);
      expect(translated.trim()).not.toBe("");
      if (locale === "en-CA") expect(translated).toBe(key);
      else if (!["Status", "Action", "Copy", "Label", "Questions"].includes(key))
        expect(translated).not.toBe(key);
      expect([...translated.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()).toEqual(
        [...key.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort(),
      );
    }
    for (const raw of [
      ...practiceManagementDiagnosticKeys,
      ...packPracticeFeedbackKeys,
      "Follow-up not found",
      "Follow-up access pass not found",
      "This follow-up is closed",
      "Something went wrong. Try again.",
      "Request failed (503).",
      "This practice assignment supports up to 1000 personal links",
    ])
      expect(practiceManagementFeedback(locale, raw).lang).toBe(locale);
  });
  it("defaults to English, preserves interpolation literally, and reuses shared copy", () => {
    expect(new Set(practiceManagementCopyKeys).size).toBe(practiceManagementCopyKeys.length);
    for (const key of practiceManagementCopyKeys) {
      expect(practiceManagementCopy()(key)).toBe(key);
      expect(practiceManagementCopy("unknown" as SupportedLocale)(key)).toBe(key);
    }
    expect(practiceManagementCopy("ko-KR")("Opens {date}", { date: "$& {authored}" })).toContain(
      "$& {authored}",
    );
    expect(practiceManagementCopy("fr-FR")("Time allowance")).toBe(
      followupCopy("fr-FR")("Time allowance"),
    );
  });
  it("translates exact known diagnostics and attributes unknown text to English", () => {
    expect(
      practiceManagementFeedback(
        "de-DE",
        "This practice assignment supports up to 1000 personal links",
      ).text,
    ).toContain("1.000");
    for (const raw of [
      "Extended time",
      "Back to Practice",
      "Private authored 한국어",
      "Your workspace role does not allow this action. More detail",
      "Request failed (503). extra",
      "This practice assignment supports up to 10 personal links (extra)",
      "Unknown service message {private}",
      "",
    ])
      expect(practiceManagementFeedback("ko-KR", raw)).toEqual({ text: raw, lang: "en-CA" });
  });
});
