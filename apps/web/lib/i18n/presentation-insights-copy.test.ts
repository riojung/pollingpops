import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  presentationInsightsCopy,
  presentationInsightsCopyKeys,
  type PresentationInsightsCopyKey,
} from "./presentation-insights-copy";

const sharedSpelling: Partial<Record<SupportedLocale, readonly PresentationInsightsCopyKey[]>> = {
  "fr-FR": ["Version {version}", "Section", "Type", "Source", "Option"],
  "de-DE": ["Version {version}", "Block", "Option"],
};

describe("Presentation insights copy", () => {
  it.each(supportedLocales)(
    "provides complete localized UI copy with matching placeholders in %s",
    (locale) => {
      const copy = presentationInsightsCopy(locale);
      for (const key of presentationInsightsCopyKeys) {
        const translated = copy(key);
        expect(translated.trim(), `${locale}:${key}`).not.toBe("");
        expect((translated.match(/\{\w+\}/g) ?? []).sort(), `${locale}:${key}`).toEqual(
          (key.match(/\{\w+\}/g) ?? []).sort(),
        );
        if (locale === "en-CA") expect(translated).toBe(key);
        else if (!sharedSpelling[locale]?.includes(key))
          expect(translated, `${locale}:${key}`).not.toBe(key);
      }
    },
  );

  it("uses English by default and for unsupported runtime locales", () => {
    for (const key of presentationInsightsCopyKeys) {
      expect(presentationInsightsCopy()(key)).toBe(key);
      for (const locale of ["unknown", "toString", "__proto__"])
        expect(presentationInsightsCopy(locale as SupportedLocale)(key)).toBe(key);
    }
  });

  it("covers the localized templates used to construct counts and mixed authored headings", () => {
    expect(presentationInsightsCopyKeys.filter((key) => /\{\w+\}/.test(key)).sort()).toEqual(
      [
        "Version {version}",
        "{seconds} seconds",
        "{presented} of {total}",
        "Hidden · fewer than {minimum} responses",
        "Response coverage · {purpose}",
        "Quick Check distribution · {block}",
        "Opinion distribution · {block}",
      ].sort(),
    );
    expect(presentationInsightsCopy("ko-KR")("Session insights")).toBe("세션 분석");
    expect(presentationInsightsCopy("de-DE")("Published version")).toBe("Veröffentlichte Version");
    expect(
      presentationInsightsCopy("fr-FR")(
        "This summary exceeds the 1 MiB download limit. No file was downloaded.",
      ),
    ).toContain("Aucun fichier n’a été téléchargé.");
  });

  it("interpolates every template once and preserves supplied authored values literally", () => {
    const literalValue = "$& $` $' $$ {block} {total} 한국어";
    for (const locale of supportedLocales) {
      const copy = presentationInsightsCopy(locale);
      for (const key of presentationInsightsCopyKeys) {
        const names = [...key.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
        if (!names.length) continue;
        const values = Object.fromEntries(names.map((name) => [name, `${name}: ${literalValue}`]));
        const translated = copy(key, values);
        for (const name of names) expect(translated).toContain(values[name]);
      }
    }
    const english = presentationInsightsCopy();
    expect(english("Opinion distribution · {block}", { block: literalValue })).toBe(
      `Opinion distribution · ${literalValue}`,
    );
    expect(english("{presented} of {total}", { presented: 0, total: 12 })).toBe("0 of 12");
    expect(english("{presented} of {total}", { presented: 0 })).toBe("0 of {total}");
    expect(english("Opinion distribution · {block}", { block: "" })).toBe(
      "Opinion distribution · ",
    );
  });
});
