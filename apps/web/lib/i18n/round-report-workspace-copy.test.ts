import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  roundReportWorkspaceCopy,
  roundReportWorkspaceCopyKeys,
} from "./round-report-workspace-copy";

describe("Round report workspace copy", () => {
  it.each(supportedLocales)("provides complete localized chrome in %s", (locale) => {
    const english = roundReportWorkspaceCopy();
    const copy = roundReportWorkspaceCopy(locale);
    for (const key of roundReportWorkspaceCopyKeys) {
      expect(copy(key).trim(), `${locale}:${key}`).not.toBe("");
      expect((copy(key).match(/\{\w+\}/g) ?? []).sort(), `${locale}:${key}`).toEqual(
        (english(key).match(/\{\w+\}/g) ?? []).sort(),
      );
      if (locale !== "en-CA") expect(copy(key), `${locale}:${key}`).not.toBe(english(key));
    }
  });

  it("preserves literal authored replacements and zero values without recursive interpolation", () => {
    for (const locale of supportedLocales) {
      const copy = roundReportWorkspaceCopy(locale);
      expect(copy("responseCoverageDetail", { respondents: 0, participants: 12 })).toContain("0");
      expect(copy("retainedUntil", { date: "$& {date} 한국어" })).toContain("$& {date} 한국어");
    }
  });

  it("falls back safely for unsupported runtime locales", () => {
    for (const locale of ["unknown", "toString", "__proto__"]) {
      expect(roundReportWorkspaceCopy(locale as SupportedLocale)("overview")).toBe("Overview");
    }
  });
});
