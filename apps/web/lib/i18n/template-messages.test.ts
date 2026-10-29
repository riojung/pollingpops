import { describe, expect, it } from "vitest";
import { SupportedLocaleSchema } from "@openround/contracts";
import { templateMessages } from "./template-messages";

describe("template library translations", () => {
  it("covers every interface key and preserves interpolation in all ten locales", () => {
    const english = templateMessages("en-CA");
    for (const locale of SupportedLocaleSchema.options) {
      const messages = templateMessages(locale);
      expect(Object.keys(messages)).toEqual(Object.keys(english));
      for (const [key, value] of Object.entries(messages)) {
        expect(typeof value, `${locale}: ${key}`).toBe("string");
        expect(value.trim().length, `${locale}: ${key}`).toBeGreaterThan(0);
      }
      expect(messages["templateLibrary.count"]).toContain("{count}");
      expect(messages["templateLibrary.blockCount"]).toContain("{count}");
    }
  });
});
