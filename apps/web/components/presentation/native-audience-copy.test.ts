import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  nativeAudienceCopy,
  nativeAudienceCopyKeys,
  nativeAudienceInteractionKindKeys,
} from "./native-audience-copy";
import { nativeControlsCopy } from "./native-controls-copy";

const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];

describe("native audience system copy", () => {
  it.each(supportedLocales)("covers every system key and retains placeholders in %s", (locale) => {
    const copy = nativeAudienceCopy(locale);
    for (const key of nativeAudienceCopyKeys) {
      expect(copy(key).trim(), key).not.toBe("");
      expect(placeholders(copy(key)), key).toEqual(placeholders(key));
      if (locale === "en-CA") expect(copy(key), key).toBe(key);
    }
    for (const key of [
      "Show on this screen",
      "Close details",
      "Show accessible outline",
      "Chart legend",
    ] as const)
      if (locale !== "en-CA") expect(copy(key), key).not.toBe(key);
    for (const key of Object.values(nativeAudienceInteractionKindKeys))
      expect(copy(key)).toBe(nativeControlsCopy(locale)(key));
    const title = "Reveal panel {title} <original title>";
    expect(copy("{title} native slide", { title })).toContain(title);
  });

  it("has unique keys and defaults unknown or omitted locales to English", () => {
    expect(new Set(nativeAudienceCopyKeys).size).toBe(nativeAudienceCopyKeys.length);
    for (const key of nativeAudienceCopyKeys) {
      expect(nativeAudienceCopy()(key)).toBe(key);
      expect(nativeAudienceCopy("zz-ZZ" as SupportedLocale)(key)).toBe(key);
    }
  });
});
