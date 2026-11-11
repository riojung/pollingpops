import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { assistanceCopy, assistanceCopyKeys, assistanceFeedbackKeys } from "./assistance-copy";
import { nativeEditorCopy } from "./native-editor-copy";
import {
  textAssistanceCopy,
  textAssistanceCopyKeys,
  textAssistanceFeedback,
  textAssistanceFeedbackKeys,
} from "./text-assistance-copy";

const placeholders = (source: string) => source.match(/\{\w+\}/g)?.sort() ?? [];

describe("selected text assistance copy", () => {
  it.each(supportedLocales)("covers every key and interpolates raw values in %s", (locale) => {
    const copy = textAssistanceCopy(locale);
    for (const key of textAssistanceCopyKeys) {
      expect(copy(key).trim(), key).not.toBe("");
      expect(placeholders(copy(key)), key).toEqual(placeholders(key));
      const values = Object.fromEntries(
        placeholders(key).map((token) => [token.slice(1, -1), `Original ${token} <author value>`]),
      );
      for (const value of Object.values(values)) expect(copy(key, values), key).toContain(value);
      if (locale === "en-CA") expect(copy(key), key).toBe(key);
      else expect(copy(key), key).not.toBe(key);
    }
  });

  it("defaults to English with a unique inventory and reuses existing catalogs", () => {
    expect(textAssistanceCopyKeys).toHaveLength(93);
    expect(new Set(textAssistanceCopyKeys).size).toBe(textAssistanceCopyKeys.length);
    const shared = textAssistanceCopyKeys.filter((key) =>
      (assistanceCopyKeys as readonly string[]).includes(key),
    );
    expect(shared).toHaveLength(16);
    for (const key of textAssistanceCopyKeys) {
      expect(textAssistanceCopy()(key)).toBe(key);
      expect(textAssistanceCopy("unknown" as SupportedLocale)(key)).toBe(key);
    }
    for (const locale of supportedLocales) {
      for (const key of shared)
        expect(textAssistanceCopy(locale)(key)).toBe(
          assistanceCopy(locale)(key as (typeof assistanceCopyKeys)[number]),
        );
      for (const key of ["Rewrite text", "Shorten text", "Translate text"] as const)
        expect(textAssistanceCopy(locale)(key)).toBe(nativeEditorCopy(locale)(key));
    }
  });

  it.each(supportedLocales)("localizes only explicitly known system feedback in %s", (locale) => {
    for (const key of textAssistanceFeedbackKeys)
      expect(textAssistanceFeedback(locale, key)).toEqual({
        text: textAssistanceCopy(locale)(key),
        lang: locale,
      });
    for (const key of assistanceFeedbackKeys)
      expect(textAssistanceFeedback(locale, key).lang).toBe(locale);
    expect(
      textAssistanceFeedback(
        locale,
        "Your sign-in changed. Reload the editor before using text assistance.",
      ),
    ).toEqual({
      text: textAssistanceCopy(locale)(
        "Your sign-in changed. Reload the editor before using AI assistance.",
      ),
      lang: locale,
    });
    for (const raw of [
      "Original text",
      "Target language",
      "Unknown provider problem <author value> {language}",
      "The exact target is unavailable. Extra diagnostic",
      "",
    ])
      expect(textAssistanceFeedback(locale, raw)).toEqual({ text: raw, lang: "en-CA" });
  });

  it("provides concrete Korean review, recovery and attribution copy", () => {
    const copy = textAssistanceCopy("ko-KR");
    expect(copy("Review proposed text")).toBe("제안된 텍스트 검토");
    expect(copy("Apply reviewed translation")).toBe("검토한 번역 적용");
    expect(copy("Resume text assistance")).toBe("텍스트 지원 계속");
    expect(copy("The exact target is unavailable.")).toBe("정확한 대상을 사용할 수 없습니다.");
    expect(copy("Translated to {language}", { language: "Original language value" })).toBe(
      "Original language value(으)로 번역됨",
    );
  });
});
