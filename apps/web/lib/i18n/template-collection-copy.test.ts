import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  templateCollectionCopy,
  templateCollectionCopyCatalog,
  templateCollectionCopyKeys,
} from "./template-collection-copy";

describe("template collection copy", () => {
  it.each(supportedLocales)("provides all labels with placeholder parity in %s", (locale) => {
    const english = templateCollectionCopy("en-CA");
    const copy = templateCollectionCopy(locale);
    expect(copy).toEqual(templateCollectionCopyCatalog[locale]);
    expect(Object.keys(copy).sort()).toEqual([...templateCollectionCopyKeys].sort());
    for (const key of templateCollectionCopyKeys) {
      expect(copy[key].trim(), key).not.toBe("");
      expect(copy[key].match(/\{\w+\}/g) ?? [], key).toEqual(english[key].match(/\{\w+\}/g) ?? []);
    }
    if (locale !== "en-CA")
      for (const key of [
        "title",
        "description",
        "allTemplates",
        "trainingOnboardingTitle",
        "trainingOnboardingDescription",
        "workshopsDescription",
      ] as const)
        expect(copy[key], key).not.toBe(english[key]);
  });

  it("exports every raw locale and key for bilingual review packets", () => {
    expect(Object.keys(templateCollectionCopyCatalog).sort()).toEqual([...supportedLocales].sort());
    expect(templateCollectionCopyKeys).toEqual([
      "label",
      "title",
      "description",
      "allTemplates",
      "chooseCollection",
      "trainingOnboardingTitle",
      "trainingOnboardingDescription",
      "workshopsTitle",
      "workshopsDescription",
    ]);
    for (const locale of supportedLocales)
      expect(Object.keys(templateCollectionCopyCatalog[locale]).sort()).toEqual(
        [...templateCollectionCopyKeys].sort(),
      );
  });

  it("describes independent alternatives without counts, popularity or review claims", () => {
    const copy = templateCollectionCopy();
    expect(copy.label).toBe("Collections");
    expect(copy.title).toBe("Team meetings");
    expect(copy.trainingOnboardingTitle).toBe("Training and onboarding");
    expect(copy.workshopsTitle).toBe("Workshops");
    expect(copy.allTemplates).toBe("All templates");
    expect(copy.chooseCollection).toBe("Collection");
    expect(copy.description).toContain(
      "a quick Round, a guided Presentation or a follow-up Survey",
    );
    expect(copy.description).toContain("Use each on its own when it fits");
    expect(Object.values(copy).join(" ")).not.toMatch(
      /\d|popular|used by|guarantee|native.reviewed|human.reviewed|first.*then/i,
    );
  });

  it("uses independent English copy by default and for unsupported runtime locales", () => {
    const english = templateCollectionCopy("en-CA");
    expect(templateCollectionCopy()).toEqual(english);
    for (const locale of ["unknown", "toString", "__proto__"])
      expect(templateCollectionCopy(locale as SupportedLocale)).toEqual(english);
    for (const locale of supportedLocales) {
      const first = templateCollectionCopy(locale);
      const second = templateCollectionCopy(locale);
      expect(first).not.toBe(second);
      first.title = "Changed by a consumer";
      expect(templateCollectionCopy(locale)).toEqual(second);
    }
  });
});
