import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { appearanceEnglishMessages, appearanceMessages } from "./appearance-messages";

describe("appearance gallery translations", () => {
  it.each(supportedLocales)(
    "supplies every label, theme description and scope explanation in %s",
    (locale) => {
      const copy = appearanceMessages(locale);
      expect(Object.keys(copy).sort()).toEqual(Object.keys(appearanceEnglishMessages).sort());
      for (const [key, value] of Object.entries(copy)) {
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
      }
      if (locale !== "en-CA") {
        for (const key of [
          "personalHelp",
          "brandHelp",
          "previewHelp",
          "brandModeHelp",
          "readOnly",
          "brandSaveUnavailable",
          "brandSavePlanLimit",
          "brandSaveOperatorPolicy",
          "brandCheckSaveAccess",
          "brandCheckingSaveAccess",
          "brandSaveAccessRestored",
          "legacyHelp",
          "contrastHelp",
        ] as const) {
          expect(copy[key], `${locale}:${key}`).not.toBe(appearanceEnglishMessages[key]);
        }
      }
    },
  );
});
