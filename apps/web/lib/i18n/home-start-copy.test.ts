import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { homeStartCopy } from "./home-start-copy";

describe("Home starting-point copy", () => {
  it.each(supportedLocales)("covers the starting workflow in %s", (locale) => {
    const english = homeStartCopy();
    const copy = homeStartCopy(locale);
    expect(Object.keys(copy)).toEqual(Object.keys(english));
    for (const key of Object.keys(english) as Array<keyof typeof english>) {
      expect(copy[key].trim(), `${locale}:${key}`).not.toBe("");
      if (locale !== "en-CA") expect(copy[key], `${locale}:${key}`).not.toBe(english[key]);
    }
  });

  it("defaults safely for an unsupported runtime locale", () => {
    for (const locale of ["unknown", "toString", "__proto__"])
      expect(homeStartCopy(locale as SupportedLocale)).toEqual(homeStartCopy());
  });
});
