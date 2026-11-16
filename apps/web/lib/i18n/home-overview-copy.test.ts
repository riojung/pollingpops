import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { formatHomeOverviewText, homeOverviewCopy } from "./home-overview-copy";

describe("Home overview copy", () => {
  it.each(supportedLocales)(
    "provides complete localized copy and matching placeholders in %s",
    (locale) => {
      const english = homeOverviewCopy("en-CA");
      const translated = homeOverviewCopy(locale);

      expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
      for (const key of Object.keys(english) as Array<keyof typeof english>) {
        expect(translated[key].trim(), `${locale}:${key}`).not.toBe("");
        expect((translated[key].match(/\{\w+\}/g) ?? []).sort(), `${locale}:${key}`).toEqual(
          (english[key].match(/\{\w+\}/g) ?? []).sort(),
        );
        if (locale !== "en-CA") expect(translated[key], `${locale}:${key}`).not.toBe(english[key]);
      }
    },
  );

  it("uses English by default and for unsupported runtime locales", () => {
    const english = homeOverviewCopy("en-CA");
    expect(homeOverviewCopy()).toEqual(english);
    for (const locale of ["unknown", "toString", "__proto__"])
      expect(homeOverviewCopy(locale as SupportedLocale)).toEqual(english);
    expect(english.scope).toBe("Work and activity you can access");
    expect(english.recentAssignmentsNote).toBe("From recent assignments");
    expect(english.reportsDescription).toBe("{ready} of {total} recent results");
    expect(english.viewBoards).toBe("View Boards");
  });

  it("interpolates UI placeholders once and preserves supplied values literally", () => {
    const authoredDate = "$& $` $' {completed} 한국어";
    for (const locale of supportedLocales) {
      const copy = homeOverviewCopy(locale);
      expect(formatHomeOverviewText(copy.updated, { date: authoredDate })).toContain(authoredDate);
      expect(
        formatHomeOverviewText(copy.attemptsComplete, { completed: 0, total: 12 }),
      ).not.toMatch(/\{(?:completed|total)\}/);
    }
    expect(formatHomeOverviewText("{completed} of {total}", { completed: 0 })).toBe("0 of {total}");
  });
});
