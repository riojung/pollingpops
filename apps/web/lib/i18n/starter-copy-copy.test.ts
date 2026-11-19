import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { localeOptions } from "./config";
import { starterCopyCopy, starterCopyCopyEntries } from "./starter-copy-copy";

describe("durable Round starter-copy recovery copy", () => {
  it.each(supportedLocales)(
    "provides every recovery and explicit restart state in %s",
    (locale) => {
      const english = starterCopyCopyEntries();
      const entries = starterCopyCopyEntries(locale);
      expect(entries).toEqual(starterCopyCopy(locale));
      expect(Object.keys(entries).sort()).toEqual(Object.keys(english).sort());
      expect(Object.keys(entries)).toHaveLength(13);
      for (const [key, value] of Object.entries(entries)) {
        expect(value.trim(), key).not.toBe("");
        expect(value.match(/\{\w+\}/g) ?? [], key).toEqual(english[key]!.match(/\{\w+\}/g) ?? []);
        if (locale !== "en-CA") expect(value, key).not.toBe(english[key]);
      }
      if (locale !== "en-CA")
        expect(localeOptions.find((option) => option.value === locale)?.previewLabel).toBeTruthy();
    },
  );

  it("distinguishes uncertain recovery, known creation and explicit new copies", () => {
    const copy = starterCopyCopy();
    expect(copy.pendingCopy).toMatch(/may already exist.*same copy.*tab open/);
    expect(copy.requestError).toMatch(/same copy.*avoid creating a duplicate/);
    expect(copy.recoveryError).toMatch(/Allow tab storage.*before creating a copy/);
    expect(copy.openError).toContain("The copy was created");
    expect(copy.cleanupError).toMatch(/copy was created.*retry recovery.*opening/);
    expect(copy.restartNotice).toContain("Create another copy");
    expect(copy.conflict).toMatch(/earlier copy.*Library/);
  });

  it("returns independent mutable objects and a safe runtime locale fallback", () => {
    expect(starterCopyCopy()).toEqual(starterCopyCopy("en-CA"));
    for (const locale of ["invalid", "toString", "__proto__"])
      expect(starterCopyCopy(locale as SupportedLocale)).toEqual(starterCopyCopy());
    const first = starterCopyCopy("ko-KR");
    const second = starterCopyCopy("ko-KR");
    first.retryCopy = "Consumer edit";
    expect(starterCopyCopy("ko-KR")).toEqual(second);
    const entries = starterCopyCopyEntries("ko-KR");
    entries.retryCopy = "Consumer edit";
    expect(starterCopyCopyEntries("ko-KR")).toEqual(second);
  });
});
