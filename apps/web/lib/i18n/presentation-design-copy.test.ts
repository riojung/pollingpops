import {
  PresentationContentSchema,
  preparePresentationPublication,
  supportedLocales,
} from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { DESIGN_LAYOUTS, PRESENTATION_DESIGNS, createDesignDraft } from "../presentation-designs";
import { PRESENTATION_DESIGN_CATEGORIES } from "../presentation-design-categories";
import {
  presentationDesignCopy,
  presentationDesignDraftCopy,
  presentationDesignSampleCopy,
} from "./presentation-design-copy";

describe("Presentation design copy", () => {
  it("includes 30 original collections and 2,400 localized layout examples", () => {
    expect(PRESENTATION_DESIGNS).toHaveLength(30);
    expect(PRESENTATION_DESIGNS.length * supportedLocales.length * DESIGN_LAYOUTS.length).toBe(
      2400,
    );
  });

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
        const familyCopy = presentationDesignDraftCopy(design.id, locale);
        expect(copy.purposes[design.id]).toBeTruthy();
        const draft = createDesignDraft(design.id, familyCopy);
        expect(
          PresentationContentSchema.safeParse(preparePresentationPublication(draft)).success,
        ).toBe(true);
        expect(draft.blocks).toHaveLength(DESIGN_LAYOUTS.length);
        for (const layout of DESIGN_LAYOUTS) {
          expect(copy.layoutLabels[layout]).toBeTruthy();
          expect(familyCopy.slides[layout].title).toBeTruthy();
          expect(familyCopy.slides[layout].title).not.toBe(copy.sampleDraft.slides[layout].title);
          expect(familyCopy.slides[layout].eyebrow).toBe(copy.purposes[design.id]);
          expect(familyCopy.slides[layout].body).toBeTruthy();
        }
        expect(familyCopy.slides.split.leftTitle).toBeTruthy();
        expect(familyCopy.slides.split.leftBody).toBeTruthy();
        expect(familyCopy.slides.split.rightTitle).toBeTruthy();
        expect(familyCopy.slides.split.rightBody).toBeTruthy();
        expect(familyCopy.slides.image_left.imageLabel).toBeTruthy();
        expect(familyCopy.slides.image_right.imageLabel).toBeTruthy();
        expect(familyCopy.slides.data.dataCaption).toBeTruthy();
        expect(familyCopy.slides.data.dataHeaders).toHaveLength(2);
        expect(familyCopy.slides.data.dataRows).toHaveLength(3);
      }
      const families = PRESENTATION_DESIGNS.map((design) =>
        presentationDesignDraftCopy(design.id, locale),
      );
      expect(new Set(families.map((family) => family.title)).size).toBe(
        PRESENTATION_DESIGNS.length,
      );
      expect(new Set(families.map((family) => family.slides.cover.body)).size).toBe(
        PRESENTATION_DESIGNS.length,
      );
      expect(new Set(Object.values(copy.purposes)).size).toBe(PRESENTATION_DESIGNS.length);
      expect(new Set(Object.values(copy.descriptions)).size).toBe(PRESENTATION_DESIGNS.length);
      for (const layout of DESIGN_LAYOUTS)
        expect(
          new Set(families.map((family) => family.slides[layout].title)).size,
          `${locale}:${layout}`,
        ).toBe(PRESENTATION_DESIGNS.length);
      expect(copy.sampleDraft).toEqual(presentationDesignSampleCopy(locale));
      if (locale !== "en-CA") {
        expect(copy.description).not.toBe(english.description);
        expect(copy.sampleDraft.title).not.toBe(english.sampleDraft.title);
        for (const design of PRESENTATION_DESIGNS) {
          expect(copy.descriptions[design.id]).not.toBe(english.descriptions[design.id]);
          expect(copy.purposes[design.id]).not.toBe(english.purposes[design.id]);
          const localized = presentationDesignDraftCopy(design.id, locale);
          const englishFamily = presentationDesignDraftCopy(design.id);
          expect(localized.slides.cover.body).not.toBe(englishFamily.slides.cover.body);
          for (const layout of DESIGN_LAYOUTS)
            expect(localized.slides[layout].title, `${locale}:${design.id}:${layout}`).not.toBe(
              englishFamily.slides[layout].title,
            );
        }
      }
    },
  );
  it.each(supportedLocales)(
    "localizes the explicit new-creation action and preserves its placeholder contract in %s",
    (locale) => {
      const copy = presentationDesignCopy(locale);
      const english = presentationDesignCopy();
      for (const key of ["startAnother", "startAnotherHint", "showMoreDesigns"] as const) {
        expect(copy[key].trim(), `${locale}:${key}`).not.toBe("");
        expect(copy[key].match(/\{\w+\}/g) ?? [], `${locale}:${key}`).toEqual([]);
        if (locale !== "en-CA") expect(copy[key], `${locale}:${key}`).not.toBe(english[key]);
      }
    },
  );

  it.each(supportedLocales)("localizes the progressive gallery count in %s", (locale) => {
    const copy = presentationDesignCopy(locale);
    expect(copy.showingDesigns.match(/\{\w+\}/g)?.sort()).toEqual(["{count}", "{visible}"]);
    if (locale !== "en-CA")
      expect(copy.showingDesigns).not.toBe(presentationDesignCopy().showingDesigns);
  });

  it.each(supportedLocales)("provides all ten discovery category labels in %s", (locale) => {
    const copy = presentationDesignCopy(locale);
    expect(Object.keys(copy.categories)).toEqual([...PRESENTATION_DESIGN_CATEGORIES]);
    for (const category of PRESENTATION_DESIGN_CATEGORIES)
      expect(copy.categories[category].trim(), `${locale}:${category}`).not.toBe("");
    expect(copy.categories.minimal).toBe(copy.minimal);
    expect(copy.categories.editorial).toBe(copy.editorial);
    expect(copy.categories.bold).toBe(copy.bold);
    expect(copy.categories.technical).toBe(copy.technical);
    expect(copy.categoryLabel.trim()).not.toBe("");
    if (locale !== "en-CA")
      expect(copy.categoryLabel).not.toBe(presentationDesignCopy().categoryLabel);
  });

  it("clearly distinguishes starting another presentation from removing an existing draft", () => {
    expect(presentationDesignCopy().startAnother).toBe("Start another");
    expect(presentationDesignCopy().startAnotherHint).toBe(
      "Start a new presentation with this design. Any existing draft is kept.",
    );
  });
});
