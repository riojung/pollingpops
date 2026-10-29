import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  resultsOverviewEnglishMessages,
  resultsOverviewMessages,
} from "./results-overview-messages";

describe("Results overview localization", () => {
  it("provides complete localized copy and matching interpolation values in every supported locale", () => {
    for (const locale of supportedLocales) {
      const translated = resultsOverviewMessages(locale);
      expect(Object.keys(translated)).toEqual(Object.keys(resultsOverviewEnglishMessages));
      for (const key of Object.keys(translated) as Array<keyof typeof translated>) {
        expect(translated[key]?.trim(), `${locale}:${key}`).toBeTruthy();
        expect((translated[key].match(/\{\w+\}/g) ?? []).sort()).toEqual(
          (resultsOverviewEnglishMessages[key].match(/\{\w+\}/g) ?? []).sort(),
        );
      }
      if (locale !== "en-CA")
        expect(translated["resultsOverview.scope"]).not.toBe(
          resultsOverviewEnglishMessages["resultsOverview.scope"],
        );
    }
  });
});
