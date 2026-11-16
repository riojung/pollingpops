import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { templateGuideCopy, templateGuideCopyKeys } from "./template-guide-copy";

describe("template guide display copy", () => {
  it.each(supportedLocales)(
    "covers guide, questionnaire and visual-style labels in %s",
    (locale) => {
      const copy = templateGuideCopy(locale);
      for (const key of templateGuideCopyKeys) {
        expect(copy(key).trim(), key).not.toBe("");
        expect(copy(key).match(/\{\w+\}/g) ?? [], key).toEqual(key.match(/\{\w+\}/g) ?? []);
      }
      expect(copy("About {minutes} min", { minutes: 15 })).toContain("15");
      expect(copy("About {minutes} min", { minutes: 15 })).not.toContain("{minutes}");
      if (locale !== "en-CA") {
        for (const key of [
          "Template guide",
          "Before you start",
          "Run the activity",
          "Use the responses",
          "Presenter guide",
          "Template notes explain how to adapt and present this example.",
          "Survey introduction",
          "Preview questionnaire",
          "Visual style",
          "All styles",
        ] as const)
          expect(copy(key), key).not.toBe(key);
      }
    },
  );

  it("exposes the visual-style filter and all three native visual families", () => {
    expect(templateGuideCopyKeys).toEqual(
      expect.arrayContaining(["Visual style", "All styles", "Editorial", "Briefing", "Workshop"]),
    );
    expect(templateGuideCopy("ko-KR")("Editorial")).toBe("에디토리얼");
    expect(templateGuideCopy("zh-TW")("Briefing")).toBe("簡報");
    expect(templateGuideCopy("fr-FR")("Workshop")).toBe("Atelier");
  });

  it("defaults and falls back to Canadian English", () => {
    for (const key of templateGuideCopyKeys) {
      expect(templateGuideCopy()(key)).toBe(key);
      expect(templateGuideCopy("en-CA")(key)).toBe(key);
      expect(templateGuideCopy("unknown" as SupportedLocale)(key)).toBe(key);
    }
  });

  it("interpolates values literally and preserves unprovided placeholders", () => {
    const copy = templateGuideCopy("ko-KR");
    expect(copy("About {minutes} min")).toBe("약 {minutes}분");
    expect(copy("About {minutes} min", { minutes: 0 })).toBe("약 0분");
    expect(copy("About {minutes} min", { minutes: "$& <원문> {extra}", extra: "changed" })).toBe(
      "약 $& <원문> {extra}분",
    );
  });
});
