import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { starterPreviewCopy } from "./starter-preview-copy";

describe("starter preview copy", () => {
  it.each(supportedLocales)("provides the complete preview and recovery flow in %s", (locale) => {
    const copy = starterPreviewCopy(locale);
    const english = starterPreviewCopy("en-CA");
    expect(Object.keys(copy).sort()).toEqual(Object.keys(english).sort());
    for (const key of Object.keys(english) as Array<keyof typeof copy>) {
      expect(copy[key].trim()).not.toBe("");
      if (locale !== "en-CA") expect(copy[key]).not.toBe(english[key]);
    }
  });
});
