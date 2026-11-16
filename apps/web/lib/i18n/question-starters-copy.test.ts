import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { canvasFacilitationCopy } from "./canvas-facilitation-messages";
import {
  questionStartersCopy,
  questionStartersCopyKeys,
  questionStartersFeedback,
} from "./question-starters-copy";

const knownFeedback = [
  "Choose a visible native slide with a nonblank title and body text.",
  "Resolve the slide's invalid content before using question starters.",
  "Use at most eight body text objects and 4,000 body characters for question starters.",
  "Resolve the slide's invalid source text before using question starters.",
  "This slide has no question starters available.",
  "This question could not be inserted. Resolve outstanding draft changes or review the current slide, then try again.",
  "The question could not be inserted. Your presentation is retained.",
  "The source or starter changed. Open question starters again to review the current wording.",
  "A presentation supports at most 200 slides and activities.",
  "Prepare a distinct identity for each answer choice.",
  "This question identity is already in use. Open question starters again.",
  "The question or its complete source context exceeds the existing question limits.",
  "This insertion would exceed the presentation's existing content or activity limits.",
] as const;

describe("question starter system copy", () => {
  it.each(supportedLocales)("covers chrome and exact system feedback in %s", (locale) => {
    const copy = questionStartersCopy(locale);
    for (const key of questionStartersCopyKeys) {
      const text = copy(key, { number: 3 });
      expect(text.trim()).not.toBe("");
      expect(text).not.toMatch(/\{\w+\}/);
    }
    expect(copy("Body text {number}", { number: 3 })).toContain("3");
    expect(copy("Close")).toBe(canvasFacilitationCopy(locale).close);
    expect(copy("Cancel")).toBe(canvasFacilitationCopy(locale).cancel);
    for (const raw of knownFeedback) {
      const result = questionStartersFeedback(locale, raw);
      expect(result).toEqual({ text: copy(raw), lang: locale, known: true });
      if (locale !== "en-CA") expect(result.text).not.toBe(raw);
    }
    if (locale !== "en-CA") {
      for (const key of [
        "Question starters",
        "Private source context",
        "Question preview",
        "Insert reviewed question",
        "Invite questions and comments about the authored slide title.",
        "Ask for a subjective clarity rating, not a scored understanding check.",
        "Use every authored body point as an option for what to discuss next.",
      ] as const)
        expect(copy(key)).not.toBe(key);
    }
  });

  it("defaults to Canadian English and preserves interpolation literally", () => {
    expect(questionStartersCopy()("Question starters")).toBe("Question starters");
    expect(questionStartersCopy("ko-KR")("Body text {number}", { number: "<Author 原名>" })).toBe(
      "본문 <Author 原名>",
    );
  });

  it.each(supportedLocales)("keeps unknown and UI-label diagnostics raw in %s", (locale) => {
    for (const raw of [
      "Question preview",
      "Close",
      "Discussion",
      "toString",
      "__proto__",
      "",
      `${knownFeedback[0]} Ref: private-diagnostic`,
      ` ${knownFeedback[0]}`,
      `SOURCE: ${knownFeedback[0]}`,
      "Private <authored> text 原文",
    ]) {
      expect(questionStartersFeedback(locale, raw)).toEqual({
        text: raw,
        lang: "en-CA",
        known: false,
      });
    }
  });
});
