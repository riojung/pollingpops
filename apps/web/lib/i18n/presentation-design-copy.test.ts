import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { DESIGN_LAYOUTS, PRESENTATION_DESIGNS, createDesignDraft } from "../presentation-designs";
import { presentationDesignCopy, presentationDesignSampleCopy } from "./presentation-design-copy";

describe("Presentation design copy", () => {
  it.each(supportedLocales)(
    "provides complete UI, descriptions and eight valid localized layouts in %s",
    (locale) => {
      const copy = presentationDesignCopy(locale);
      const english = presentationDesignCopy();
      expect(Object.keys(copy).sort()).toEqual(Object.keys(english).sort());
      for (const [key, value] of Object.entries(english)) {
        if (typeof value !== "string") continue;
        const localized = copy[key as keyof typeof copy];
        expect(typeof localized, `${locale}:${key}`).toBe("string");
        expect((localized as string).trim(), `${locale}:${key}`).not.toBe("");
        expect(((localized as string).match(/\{\w+\}/g) ?? []).sort(), `${locale}:${key}`).toEqual(
          (value.match(/\{\w+\}/g) ?? []).sort(),
        );
      }
      for (const design of PRESENTATION_DESIGNS) {
        expect(copy.descriptions[design.id]).toBeTruthy();
        const draft = createDesignDraft(design.id, copy.sampleDraft);
        expect(draft.blocks).toHaveLength(8);
        for (const layout of DESIGN_LAYOUTS) {
          expect(copy.layoutLabels[layout]).toBeTruthy();
          expect(copy.sampleDraft.slides[layout].title).toBeTruthy();
          expect(copy.sampleDraft.slides[layout].body).toBeTruthy();
        }
      }
      expect(copy.sampleDraft).toEqual(presentationDesignSampleCopy(locale));
      if (locale !== "en-CA") {
        expect(copy.description).not.toBe(english.description);
        expect(copy.sampleDraft.title).not.toBe(english.sampleDraft.title);
        for (const design of PRESENTATION_DESIGNS)
          expect(copy.descriptions[design.id]).not.toBe(english.descriptions[design.id]);
      }
    },
  );
  it.each(supportedLocales)(
    "localizes the explicit new-creation action and preserves its placeholder contract in %s",
    (locale) => {
      const copy = presentationDesignCopy(locale);
      const english = presentationDesignCopy();
      for (const key of ["startAnother", "startAnotherHint"] as const) {
        expect(copy[key].trim(), `${locale}:${key}`).not.toBe("");
        expect(copy[key].match(/\{\w+\}/g) ?? [], `${locale}:${key}`).toEqual([]);
        if (locale !== "en-CA") expect(copy[key], `${locale}:${key}`).not.toBe(english[key]);
      }
    },
  );

  it("clearly distinguishes starting another presentation from removing an existing draft", () => {
    expect(presentationDesignCopy().startAnother).toBe("Start another");
    expect(presentationDesignCopy().startAnotherHint).toBe(
      "Start a new presentation with this design. Any existing draft is kept.",
    );
  });
});
