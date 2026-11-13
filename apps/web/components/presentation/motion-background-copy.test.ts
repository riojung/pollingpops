import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { motionBackgroundCopy, motionBackgroundCopyKeys } from "./motion-background-copy";

describe("motion background copy", () => {
  it.each(supportedLocales)("translates every fixed UI key in %s", (locale) => {
    const copy = motionBackgroundCopy(locale);
    for (const key of motionBackgroundCopyKeys) {
      expect(copy(key).trim(), key).not.toBe("");
      expect(copy(key).match(/\{\w+\}/g) ?? [], key).toEqual([]);
      if (locale === "en-CA") expect(copy(key), key).toBe(key);
      else expect(copy(key), key).not.toBe(key);
    }
  });

  it("uses unique fixed keys and defaults omitted or unknown locales to English", () => {
    expect(new Set(motionBackgroundCopyKeys).size).toBe(motionBackgroundCopyKeys.length);
    for (const key of motionBackgroundCopyKeys) {
      expect(motionBackgroundCopy()(key)).toBe(key);
      expect(motionBackgroundCopy("zz-ZZ" as SupportedLocale)(key)).toBe(key);
    }
  });

  it("keeps scene content and persisted preset values outside its UI vocabulary", () => {
    const keys = new Set<string>(motionBackgroundCopyKeys);
    for (const authored of ["aurora", "waves", "タイトル {title}", "Mon contenu original"]) {
      expect(keys.has(authored)).toBe(false);
    }
  });
});
