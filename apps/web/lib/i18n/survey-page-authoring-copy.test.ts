import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  surveyPageAuthoringCopy,
  surveyPageAuthoringCopyEntries,
} from "./survey-page-authoring-copy";

describe("Survey page authoring copy", () => {
  it.each(supportedLocales)(
    "covers authoring, confirmation and permission states in %s",
    (locale) => {
      const english = surveyPageAuthoringCopyEntries();
      const entries = surveyPageAuthoringCopyEntries(locale);
      expect(Object.keys(entries).sort()).toEqual(Object.keys(english).sort());
      expect(entries).toEqual(surveyPageAuthoringCopy(locale));
      expect(Object.keys(entries)).toHaveLength(34);
      for (const [key, value] of Object.entries(entries)) {
        expect(value.trim(), key).not.toBe("");
        expect((value.match(/\{\w+\}/g) ?? []).sort(), key).toEqual(
          (english[key]!.match(/\{\w+\}/g) ?? []).sort(),
        );
        if (locale !== "en-CA" && !(locale === "fr-FR" && key === "questionLabel"))
          expect(value, key).not.toBe(english[key]);
      }
    },
  );

  it("explains preserved publications, page merge and empty-page publishing", () => {
    const copy = surveyPageAuthoringCopy();
    expect(copy.convertConfirm).toContain("first page");
    expect(copy.convertConfirm).toContain("Published links stay unchanged");
    expect(copy.removePageConfirm).toContain("move its questions to {destination}");
    expect(copy.removePageConfirm).toContain("title and instructions will be removed");
    expect(copy.publishEmptyPageError).toContain("at least one question");
    expect(copy.pausedNotice).toContain("existing sharing links keep working");
  });

  it("returns independent copies and handles unknown runtime locales safely", () => {
    for (const locale of ["unknown", "toString", "__proto__"])
      expect(surveyPageAuthoringCopy(locale as SupportedLocale)).toEqual(surveyPageAuthoringCopy());
    const copy = surveyPageAuthoringCopy("ko-KR");
    const original = surveyPageAuthoringCopyEntries("ko-KR");
    copy.addPage = "Consumer edit";
    original.addPage = "Packet edit";
    expect(surveyPageAuthoringCopy("ko-KR").addPage).toBe("페이지 추가");
  });
});
