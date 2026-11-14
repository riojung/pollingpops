import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { presentationDesignApplicationCopy } from "./presentation-design-application-copy";

describe("presentation design application copy", () => {
  it.each(supportedLocales)(
    "provides complete application and base-theme guidance in %s",
    (locale) => {
      const copy = presentationDesignApplicationCopy(locale);
      const english = presentationDesignApplicationCopy();
      expect(Object.keys(copy).sort()).toEqual(Object.keys(english).sort());
      for (const key of Object.keys(english) as Array<keyof typeof english>) {
        expect(copy[key].trim(), `${locale}:${key}`).not.toBe("");
        expect(copy[key].match(/\{\w+\}/g) ?? [], `${locale}:${key}`).toEqual(
          english[key].match(/\{\w+\}/g) ?? [],
        );
      }
      expect(copy.fullDesign).not.toBe(copy.colorsAndFonts);
      expect(copy.applyDesign).not.toBe(copy.applyStyle);
    },
  );
});
