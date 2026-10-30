import { describe, expect, it } from "vitest";
import { supportedLocales } from "@openround/contracts";
import { canvasTemplateEnglishMessages, canvasTemplateMessages } from "./canvas-template-messages";

describe("canvas starter picker translations", () => {
  it.each(supportedLocales)(
    "translates every control and explicitly identifies English content in %s",
    (locale) => {
      const copy = canvasTemplateMessages(locale);
      expect(Object.keys(copy)).toEqual(Object.keys(canvasTemplateEnglishMessages));
      for (const [key, message] of Object.entries(copy)) expect(message, key).toBeTruthy();
      expect(copy.english).toMatch(/English|anglais|Englisch|inglés|inglese|inglês|英語|영어|英语/);
      if (locale !== "en-CA") expect(copy.choose).not.toBe(canvasTemplateEnglishMessages.choose);
    },
  );
});
