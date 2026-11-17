import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { liveWordCloudCopies, liveWordCloudCopy } from "./live-word-cloud-copy";

describe("live word cloud copy", () => {
  it("localizes every control and resolves count placeholders in every supported locale", () => {
    expect(Object.keys(liveWordCloudCopies).sort()).toEqual([...supportedLocales].sort());
    for (const locale of supportedLocales) {
      expect(Object.keys(liveWordCloudCopies[locale])).toEqual(
        Object.keys(liveWordCloudCopies["en-CA"]),
      );
      expect(liveWordCloudCopy(locale, "responses", { count: 12 })).not.toMatch(/[{}]/);
      expect(liveWordCloudCopy(locale, "showing", { count: 40, total: 120 })).not.toMatch(/[{}]/);
      for (const value of Object.values(liveWordCloudCopies[locale]))
        expect(value.trim()).not.toBe("");
    }
  });
});
