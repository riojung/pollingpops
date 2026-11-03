import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { canvasChromeCopy } from "./canvas-chrome-messages";

describe("canvas chrome localization", () => {
  it.each(supportedLocales)(
    "provides complete inspector, board and action labels in %s",
    (locale) => {
      const english = canvasChromeCopy("en-CA");
      const copy = canvasChromeCopy(locale);
      expect(Object.keys(copy)).toEqual(Object.keys(english));
      for (const key of Object.keys(copy) as (keyof typeof copy)[]) {
        expect(copy[key].trim(), key).toBeTruthy();
        expect(copy[key].match(/\{\w+\}/g) ?? []).toEqual(english[key].match(/\{\w+\}/g) ?? []);
      }
      if (locale !== "en-CA") {
        for (const key of [
          "properties",
          "closeInspector",
          "insert",
          "more",
          "details",
          "quickActions",
          "position",
          "appearance",
          "unsaved",
        ] as const) {
          expect(copy[key], key).not.toBe(english[key]);
        }
      }
    },
  );

  it("keeps board details and inspector controls distinct", () => {
    for (const locale of supportedLocales) {
      const copy = canvasChromeCopy(locale);
      expect(copy.details).not.toBe(copy.more);
      expect(copy.inspector).not.toBe(copy.closeInspector);
      expect(copy.objects).not.toBe(copy.properties);
    }
  });

  it("falls back to English for an unsupported locale", () => {
    expect(canvasChromeCopy("xx-XX" as SupportedLocale)).toEqual(canvasChromeCopy("en-CA"));
  });
});
