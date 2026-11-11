import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { packPracticeDetailCopy, packPracticeDetailCopyKeys } from "./pack-practice-detail-copy";

describe("Pack practice detail display copy", () => {
  it.each(supportedLocales)("covers preview, private receipt, and attribution in %s", (locale) => {
    const copy = packPracticeDetailCopy(locale);
    for (const key of packPracticeDetailCopyKeys) {
      const text = copy(key, { label: "{label}" });
      expect(text.trim(), key).not.toBe("");
      expect(text.match(/\{\w+\}/g) ?? []).toEqual(key.match(/\{\w+\}/g) ?? []);
      if (locale === "en-CA") expect(text).toBe(key);
    }
    if (locale !== "en-CA") {
      for (const key of [
        "Save your private links",
        "Frozen full-sequence preview",
        "Copy was blocked. Select and copy the link instead.",
        "Recovery Pack full sequence",
        "Recovery Pack delayed probe",
        "published version",
      ] as const)
        expect(copy(key)).not.toBe(key);
    }
  });

  it("keeps English defaults and unknown locale fallback deterministic", () => {
    expect(new Set(packPracticeDetailCopyKeys).size).toBe(packPracticeDetailCopyKeys.length);
    for (const key of packPracticeDetailCopyKeys) {
      expect(packPracticeDetailCopy()(key, { label: "{label}" })).toBe(key);
      expect(packPracticeDetailCopy("unknown" as SupportedLocale)(key, { label: "{label}" })).toBe(
        key,
      );
    }
  });

  it.each(supportedLocales)(
    "inserts personal labels literally in %s without retranslation",
    (locale) => {
      const label = "Generic link {label} $& <script>이름</script>";
      const template = packPracticeDetailCopy(locale)("{label} copied.", { label: "{label}" });
      const [before, after] = template.split("{label}");
      expect(packPracticeDetailCopy(locale)("{label} copied.", { label })).toBe(
        `${before}${label}${after}`,
      );
    },
  );
});
