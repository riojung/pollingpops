import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  roundNavigationCopy,
  roundNavigationMessages,
  type RoundNavigationMessage,
} from "./round-navigation-copy";

const keys = Object.keys(roundNavigationMessages) as RoundNavigationMessage[];
describe("Round navigation copy", () => {
  it.each(supportedLocales)("covers every label and preserves interpolation in %s", (locale) => {
    const copy = roundNavigationCopy(locale);
    for (const key of keys) {
      expect(copy(key).trim(), key).toBeTruthy();
      expect((copy(key).match(/\{\w+\}/g) ?? []).sort(), key).toEqual(
        (key.match(/\{\w+\}/g) ?? []).sort(),
      );
    }
    if (locale !== "en-CA") {
      for (const key of [
        "Question outline",
        "Choose a question type",
        "Test knowledge",
        "Collect opinions",
        "More actions",
      ] as const)
        expect(copy(key)).not.toBe(key);
    }
    expect(copy("{shown} of {total}", { shown: 2, total: 10 })).toContain("2");
    expect(copy("{shown} of {total}", { shown: 2, total: 10 })).not.toContain("{");
  });

  it("inserts literal values without translating authored material", () => {
    expect(
      roundNavigationCopy("ko-KR")("Question {number} actions", { number: "$& <raw> {number}" }),
    ).toBe("질문 $& <raw> {number} 작업");
    expect(roundNavigationCopy("unknown" as SupportedLocale)("Question outline")).toBe(
      "Question outline",
    );
    expect(roundNavigationCopy()("{shown} of {total}", { shown: 0 })).toBe("0 of {total}");
  });
});
