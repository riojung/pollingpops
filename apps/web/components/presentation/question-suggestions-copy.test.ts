import {
  supportedLocales,
  PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES,
  PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
} from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { assistanceCopy } from "./assistance-copy";
import { nativeControlsCopy } from "./native-controls-copy";
import {
  questionSuggestionsCopy,
  questionSuggestionsCopyKeys,
  questionSuggestionsFeedback,
  questionSuggestionsFeedbackKeys,
} from "./question-suggestions-copy";

const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];

describe("discussion suggestion display copy", () => {
  it.each(supportedLocales)("covers every key and placeholder in %s", (locale) => {
    const t = questionSuggestionsCopy(locale);
    for (const key of questionSuggestionsCopyKeys) {
      expect(t(key).trim(), key).not.toBe("");
      expect(placeholders(t(key)), key).toEqual(placeholders(key));
      if (locale === "en-CA") expect(t(key), key).toBe(key);
      else expect(t(key), key).not.toBe(key);
      const values = Object.fromEntries(
        placeholders(key).map((token) => [token.slice(1, -1), `Original ${token} <raw>`]),
      );
      for (const value of Object.values(values)) expect(t(key, values), key).toContain(value);
    }
    expect(t("Optional AI assistance")).toBe(assistanceCopy(locale)("Optional AI assistance"));
    expect(t("Slide title")).toBe(nativeControlsCopy(locale)("Slide title"));
  });

  it("defaults to Canadian English and has unique inventories", () => {
    expect(new Set(questionSuggestionsCopyKeys).size).toBe(questionSuggestionsCopyKeys.length);
    expect(new Set(questionSuggestionsFeedbackKeys).size).toBe(
      questionSuggestionsFeedbackKeys.length,
    );
    for (const key of questionSuggestionsCopyKeys) expect(questionSuggestionsCopy()(key)).toBe(key);
  });

  it.each(supportedLocales)("only translates explicit system feedback in %s", (locale) => {
    for (const key of questionSuggestionsFeedbackKeys)
      expect(questionSuggestionsFeedback(locale, key)).toEqual({
        text: questionSuggestionsCopy(locale)(key),
        lang: locale,
      });
    for (const diagnostic of [
      "Review both questions", // UI labels are not automatically diagnostics.
      " Both questions are ready. Review them and choose one to insert.",
      "The source slide or its author is no longer available. Provider detail: {raw}",
      "Network receipt: https://example.test?x=1&y=2",
    ])
      expect(questionSuggestionsFeedback(locale, diagnostic)).toEqual({
        text: diagnostic,
        lang: "en-CA",
      });
  });

  it("admits the exact contract warnings and static job errors", () => {
    expect(questionSuggestionsFeedbackKeys).toContain(
      PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
    );
    for (const message of Object.values(PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES))
      expect(questionSuggestionsFeedbackKeys).toContain(message);
  });

  it("has concrete Korean review and German recovery copy", () => {
    expect(questionSuggestionsCopy("ko-KR")("Review discussion suggestions")).toBe(
      "토론 제안 검토",
    );
    expect(questionSuggestionsCopy("de-DE")("Retry exact insertion")).toBe(
      "Exaktes Einfügen erneut versuchen",
    );
  });
});
