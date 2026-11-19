import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { localeOptions } from "./config";
import { surveyPagesCopy, surveyPagesCopyEntries } from "./survey-pages-copy";

describe("ordered Survey pages copy", () => {
  it.each(supportedLocales)(
    "provides the complete page reader and recovery states in %s",
    (locale) => {
      const english = surveyPagesCopyEntries();
      const entries = surveyPagesCopyEntries(locale);
      expect(entries).toEqual(surveyPagesCopy(locale));
      expect(Object.keys(entries).sort()).toEqual(Object.keys(english).sort());
      expect(Object.keys(entries)).toHaveLength(23);
      for (const [key, value] of Object.entries(entries)) {
        expect(value.trim(), key).not.toBe("");
        expect((value.match(/\{\w+\}/g) ?? []).sort(), key).toEqual(
          (english[key]!.match(/\{\w+\}/g) ?? []).sort(),
        );
        if (locale !== "en-CA" && !(locale === "fr-FR" && key === "untitledPage"))
          expect(value, key).not.toBe(english[key]);
      }
      if (locale !== "en-CA")
        expect(localeOptions.find((option) => option.value === locale)?.previewLabel).toBeTruthy();
    },
  );

  it("distinguishes current-page validation, confirmed saves and final submission", () => {
    const copy = surveyPagesCopy();
    expect(copy.requiredError).toContain("on this page");
    expect(copy.saveError).toMatch(/Retry the same save.*before continuing/);
    expect(copy.resumeHint).toMatch(/first page with an unanswered question.*optional questions/);
    expect(copy.readOnlyNotice).toMatch(
      /Page authoring is not available.*review the saved content/,
    );
    expect(copy.reviewOnly).toContain("not sent or saved");
    expect(copy.closed).toContain("cannot change or submit");
  });

  it("returns independent mutable objects and a safe runtime locale fallback", () => {
    expect(surveyPagesCopy()).toEqual(surveyPagesCopy("en-CA"));
    for (const locale of ["invalid", "toString", "__proto__"])
      expect(surveyPagesCopy(locale as SupportedLocale)).toEqual(surveyPagesCopy());
    const first = surveyPagesCopy("ko-KR");
    const second = surveyPagesCopy("ko-KR");
    first.next = "Consumer edit";
    expect(surveyPagesCopy("ko-KR")).toEqual(second);
    const entries = surveyPagesCopyEntries("ko-KR");
    entries.next = "Consumer edit";
    expect(surveyPagesCopyEntries("ko-KR")).toEqual(second);
  });
});
