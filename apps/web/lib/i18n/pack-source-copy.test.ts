import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { loadMessages } from "./catalog";
import { confidenceControlCopy } from "./confidence-control-copy";
import {
  packSourceCopy,
  packSourceCopyKeys,
  packSourceFeedback,
  packSourceQuestionType,
  packSourcePurpose,
  packSourceDelivery,
  packSourceConfidence,
} from "./pack-source-copy";

describe("source Pack display copy", () => {
  it.each(supportedLocales)("covers every control and placeholder in %s", async (locale) => {
    const copy = packSourceCopy(locale);
    for (const key of packSourceCopyKeys) {
      const text = copy(key, {
        points: 100,
        label: "Original",
        number: 2,
        source: "Source <原文>",
        revision: 7,
      });
      expect(text.trim()).not.toBe("");
      expect(text).not.toMatch(/\{\w+\}/);
    }
    for (const key of [
      "Review Pack source proposal",
      "Approve saved content and citations",
      "Source content and citation review",
      "Global Pack citations",
    ] as const) {
      if (locale !== "en-CA") expect(copy(key)).not.toBe(key);
    }
    expect(copy("Pack source proposal: {source}", { source: "Source <原文>" })).toContain(
      "Source <原文>",
    );
    const messages = await loadMessages(locale);
    for (const type of ["single_select", "multi_select", "true_false", "numeric"] as const)
      expect(packSourceQuestionType(locale, type)).toBe(messages[`questionType.${type}.label`]);
    expect(packSourceConfidence(locale, "optional")).toBe(confidenceControlCopy[locale].on);
    expect(packSourceConfidence(locale, "off")).toBe(confidenceControlCopy[locale].off);
    expect(packSourceConfidence(locale, "required")).toBe(copy("Required"));
    expect(packSourcePurpose(locale, "practice")).toBe(copy("Practice"));
    expect(packSourcePurpose(locale, undefined)).toBe(copy("Diagnostic"));
    expect(packSourceDelivery(locale, "recheck")).toBe(copy("Linked recheck"));
  });

  it("defaults to English and only translates allowlisted system feedback", () => {
    expect(packSourceCopy()("Create source Pack draft")).toBe("Create source Pack draft");
    const raw = "The Pack citations do not match the reviewed source. Reload the source proposal.";
    expect(packSourceFeedback("ko-KR", raw)).toEqual({
      text: packSourceCopy("ko-KR")(raw),
      lang: "ko-KR",
      known: true,
    });
    for (const diagnostic of [
      "Create source Pack draft",
      "__proto__",
      "toString",
      "",
      `${raw} private-ID`,
      ` ${raw}`,
    ])
      expect(packSourceFeedback("ko-KR", diagnostic)).toEqual({
        text: diagnostic,
        lang: "en-CA",
        known: false,
      });
  });
});
