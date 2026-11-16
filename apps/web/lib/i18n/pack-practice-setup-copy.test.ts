import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { packPracticeCopy, packPracticeFeedbackKeys } from "./pack-practice-copy";
import { followupCopy } from "./followup-copy";
import { formatNumber } from "./format";
import {
  packPracticeSetupCopy,
  packPracticeSetupCopyKeys,
  packPracticeSetupFeedback,
  packPracticeSetupFeedbackKeys,
} from "./pack-practice-setup-copy";

const placeholders = (value: string) =>
  [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("Pack practice setup copy", () => {
  it.each(supportedLocales)("covers setup and exact feedback in %s", (locale) => {
    const copy = packPracticeSetupCopy(locale);
    for (const key of packPracticeSetupCopyKeys) {
      const value = copy(key);
      expect(value.trim()).not.toBe("");
      expect(placeholders(value)).toEqual(placeholders(key));
      if (locale === "en-CA") expect(value).toBe(key);
      else expect(value).not.toBe(key);
      expect(
        copy(key, {
          version: "SOURCE",
          date: "DATE",
          days: "DAYS",
          count: "COUNT",
          limit: "LIMIT",
        }),
      ).not.toMatch(/\{\w+\}/);
    }
    for (const key of packPracticeSetupFeedbackKeys)
      expect(packPracticeSetupFeedback(locale, key)).toEqual({ text: copy(key), lang: locale });
    for (const key of packPracticeFeedbackKeys)
      expect(packPracticeSetupFeedback(locale, key)).toEqual({
        text: packPracticeCopy(locale)(key),
        lang: locale,
      });
    for (const key of [
      "Choose a future close time after the open time",
      "Something went wrong. Try again.",
    ] as const)
      expect(packPracticeSetupFeedback(locale, key)).toEqual({
        text: followupCopy(locale)(key),
        lang: locale,
      });
  });

  it("defaults to English and preserves missing substitutions", () => {
    expect(new Set(packPracticeSetupCopyKeys).size).toBe(packPracticeSetupCopyKeys.length);
    for (const key of packPracticeSetupCopyKeys) {
      expect(packPracticeSetupCopy()(key)).toBe(key);
      expect(packPracticeSetupCopy("unknown" as SupportedLocale)(key)).toBe(key);
    }
    expect(packPracticeSetupCopy()("Published {date}.")).toBe("Published {date}.");
  });

  it.each(supportedLocales)("only matches exact contextual numeric validation in %s", (locale) => {
    const copy = packPracticeSetupCopy(locale);
    for (const labelLimit of [0, 1, 2, 250]) {
      const raw = `Add no more than ${labelLimit} personal link label${labelLimit === 1 ? "" : "s"}.`;
      expect(packPracticeSetupFeedback(locale, raw, { labelLimit })).toEqual({
        text:
          locale === "en-CA"
            ? raw
            : copy("Add no more than {limit} personal link labels.", {
                limit: formatNumber(locale, labelLimit),
              }),
        lang: locale,
      });
      expect(
        packPracticeSetupFeedback(
          locale,
          `This plan supports up to ${labelLimit} personal practice links`,
          { labelLimit },
        ),
      ).toEqual({
        text: copy("This plan supports up to {limit} personal practice links", {
          limit: formatNumber(locale, labelLimit),
        }),
        lang: locale,
      });
    }
    expect(
      packPracticeSetupFeedback(
        locale,
        "The practice assignment must close within the 30-day retention window",
        { retentionDays: 30 },
      ),
    ).toEqual({
      text: copy("The practice assignment must close within the {days}-day retention window", {
        days: formatNumber(locale, 30),
      }),
      lang: locale,
    });
  });

  it("leaves unknown details, UI-key collisions and known-message suffixes intact", () => {
    for (const raw of [
      "Practice settings",
      "Creating…",
      "Published {date}.",
      "Full-sequence Pack practice",
      "Unknown service detail {source}",
      "",
      "Network connection interrupted",
      ...packPracticeSetupFeedbackKeys.map((key) => `${key} Extra service detail`),
      ...packPracticeFeedbackKeys.map((key) => `${key} Extra service detail`),
      "Add no more than 3 personal link labels.",
      "This plan supports up to 3 personal practice links",
      "The practice assignment must close within the 7-day retention window",
      "This plan supports up to 2 personal practice links Additional detail",
      "The practice assignment must close within the 30-day retention window Additional detail",
    ])
      expect(packPracticeSetupFeedback("ko-KR", raw, { labelLimit: 2, retentionDays: 30 })).toEqual(
        { text: raw, lang: "en-CA" },
      );
  });
});
