import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { formatLibraryDiscoveryText, libraryDiscoveryCopy } from "./library-discovery-copy";

describe("Library discovery copy", () => {
  it.each(supportedLocales)("has complete localized keys and placeholders in %s", (locale) => {
    const english = libraryDiscoveryCopy();
    const copy = libraryDiscoveryCopy(locale);
    expect(Object.keys(copy).sort()).toEqual(Object.keys(english).sort());
    for (const key of Object.keys(english) as Array<keyof typeof english>) {
      expect(copy[key].trim(), `${locale}:${key}`).not.toBe("");
      expect((copy[key].match(/\{\w+\}/g) ?? []).sort(), `${locale}:${key}`).toEqual(
        (english[key].match(/\{\w+\}/g) ?? []).sort(),
      );
      if (locale !== "en-CA") expect(copy[key], `${locale}:${key}`).not.toBe(english[key]);
    }
  });
  it("falls back safely and replaces placeholders without interpreting authored values", () => {
    for (const locale of ["unknown", "toString", "__proto__"])
      expect(libraryDiscoveryCopy(locale as SupportedLocale)).toEqual(libraryDiscoveryCopy());
    expect(formatLibraryDiscoveryText("{date}: {count}", { date: "$& {count}", count: 0 })).toBe(
      "$& {count}: 0",
    );
  });
});
