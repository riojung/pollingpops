import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { roundToolsCopy, roundToolsCopyKeys } from "./round-tools-copy";

describe("Round question tools copy", () => {
  it.each(supportedLocales)("covers each tool label, guide, and placeholder in %s", (locale) => {
    const copy = roundToolsCopy(locale);
    for (const key of roundToolsCopyKeys) {
      const message = copy(key, { number: 3, count: 6, limit: 80 });
      expect(message.trim()).not.toBe("");
      expect(message).not.toMatch(/\{\w+\}/);
    }
    expect(copy("Question {number}", { number: 3 })).toContain("3");
    if (locale !== "en-CA") {
      for (const key of [
        "Question tools",
        "Choose one correct answer.",
        "Timing and scoring",
        "Alternative text",
      ] as const) {
        expect(copy(key)).not.toBe(key);
      }
    }
  });

  it("defaults to English and substitutes literal values without interpreting their contents", () => {
    expect(roundToolsCopy()("Question tools")).toBe("Question tools");
    expect(roundToolsCopy("ko-KR")("Question {number}", { number: "<원문> {count} $&" })).toBe(
      "질문 <원문> {count} $&",
    );
  });
});
