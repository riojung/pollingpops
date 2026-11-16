import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  assistanceCopy,
  assistanceCopyKeys,
  assistanceFeedbackKeys,
  localizeAssistanceFeedback,
} from "./assistance-copy";
import { presentationCommandCopy } from "./presentation-command-copy";

const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];

describe("outline and shared assistance copy", () => {
  it.each(supportedLocales)("covers every key and placeholder in %s", (locale) => {
    const copy = assistanceCopy(locale);
    for (const key of assistanceCopyKeys) {
      const text = copy(key);
      expect(text.trim(), key).not.toBe("");
      expect(placeholders(text), key).toEqual(placeholders(key));
      const values = Object.fromEntries(
        placeholders(key).map((token) => [token.slice(1, -1), `Original ${token} <author value>`]),
      );
      for (const value of Object.values(values)) expect(copy(key, values), key).toContain(value);
      if (locale === "en-CA") expect(text, key).toBe(key);
      else expect(text, key).not.toBe(key);
    }
    expect(copy("Outline to slides")).toBe(presentationCommandCopy(locale).outlineToSlides);
  });

  it("has unique inventories and defaults to Canadian English", () => {
    expect(new Set(assistanceCopyKeys).size).toBe(assistanceCopyKeys.length);
    expect(new Set(assistanceFeedbackKeys).size).toBe(assistanceFeedbackKeys.length);
    for (const key of assistanceCopyKeys) expect(assistanceCopy()(key)).toBe(key);
  });

  it.each(supportedLocales)("only adapts explicitly known system feedback in %s", (locale) => {
    for (const key of assistanceFeedbackKeys)
      expect(localizeAssistanceFeedback(locale, key)).toEqual({
        text: assistanceCopy(locale)(key),
        lang: locale,
      });
    for (const diagnostic of [
      "Review proposed slides", // A UI label is not automatically a diagnostic.
      "Network receipt {raw}: https://example.test?x=1&y=2",
      " Proposal ready. Review the text and exact excerpts before inserting.",
      "The inserted text could not be verified. Provider diagnostic follows.",
    ])
      expect(localizeAssistanceFeedback(locale, diagnostic)).toEqual({
        text: diagnostic,
        lang: "en-CA",
      });
  });

  it("has concrete Korean recovery and permission copy", () => {
    const copy = assistanceCopy("ko-KR");
    expect(copy("Review proposed slides")).toBe("제안된 슬라이드 검토");
    expect(copy("Retry exact insertion")).toBe("동일한 삽입 다시 시도");
    expect(copy("Editor permission is required to generate or insert slides.")).toBe(
      "슬라이드를 생성하거나 삽입하려면 편집 권한이 필요합니다.",
    );
    expect(copy("Insert {count} reviewed slides", { count: 2 })).toBe("검토한 슬라이드 2개 삽입");
  });
});
