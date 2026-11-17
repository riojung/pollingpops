import { RoundCategorySchema, supportedLocales } from "@openround/contracts";
import { experiencePresets } from "@openround/experience";
import { describe, expect, it } from "vitest";
import { loadLiveDeliveryMessages, liveDeliveryEnglishMessages } from "./domains/live-delivery";
import {
  experienceCatalogEnglishMessages,
  experienceCatalogMessages,
} from "./experience-catalog-messages";

describe("Round experience catalog translations", () => {
  it.each(supportedLocales)(
    "provides category labels, descriptions and launch scope in %s",
    async (locale) => {
      const copy = experienceCatalogMessages(locale);
      const catalog = await loadLiveDeliveryMessages(locale);
      expect(Object.keys(copy).sort()).toEqual(
        Object.keys(experienceCatalogEnglishMessages).sort(),
      );
      for (const [key, value] of Object.entries(copy)) {
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
        const english =
          experienceCatalogEnglishMessages[key as keyof typeof experienceCatalogEnglishMessages];
        expect(value.match(/\{\w+\}/g) ?? [], `${locale}:${key}`).toEqual(
          english.match(/\{\w+\}/g) ?? [],
        );
        expect(catalog[key as keyof typeof catalog]).toBe(value);
      }
      for (const category of RoundCategorySchema.options) {
        expect(catalog[`live.experience.category.${category}`]).toBeTruthy();
      }
      for (const { preset } of experiencePresets) {
        expect(catalog[`live.experience.preset.${preset.id}.name`]).toBeTruthy();
        expect(catalog[`live.experience.preset.${preset.id}.description`]).toBeTruthy();
      }
      if (locale !== "en-CA") {
        for (const key of [
          "live.experience.galleryHelp",
          "live.experience.categoryHelp",
          "live.experience.launchOverride",
          "live.experience.previewHelp",
        ] as const) {
          expect(copy[key]).not.toBe(liveDeliveryEnglishMessages[key]);
        }
      }
    },
  );
});
