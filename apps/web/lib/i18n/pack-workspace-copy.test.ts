import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  packWorkspaceCopy,
  packWorkspaceCopyKeys,
  packWorkspaceFeedback,
} from "./pack-workspace-copy";

describe("Pack workspace interface copy", () => {
  it.each(supportedLocales)("covers the complete interface and interpolation in %s", (locale) => {
    const copy = packWorkspaceCopy(locale);
    for (const key of packWorkspaceCopyKeys) {
      expect(copy(key).trim()).not.toBe("");
      const placeholders = (value: string) => value.match(/\{\w+\}/g)?.sort() ?? [];
      expect(placeholders(copy(key))).toEqual(placeholders(key));
    }
    expect(copy("Card {number} facilitator guidance", { number: 3 })).toContain("3");
    expect(
      copy("Accepted value: {value} · tolerance {tolerance}", {
        value: "001.25",
        tolerance: "0.005",
      }),
    ).toContain("001.25");
    if (locale !== "en-CA") {
      expect(copy("Save draft")).not.toBe("Save draft");
      expect(copy("Your workspace role can view Packs but cannot modify them.")).not.toBe(
        "Your workspace role can view Packs but cannot modify them.",
      );
    }
  });

  it("defaults to the exact English interface and never interprets interpolation values", () => {
    expect(packWorkspaceCopy()("Save draft")).toBe("Save draft");
    expect(packWorkspaceCopy("ko-KR")("{label} prompt", { label: "{number} <b>raw</b>" })).toBe(
      "{number} <b>raw</b> 질문",
    );
  });

  it("translates only recognized feedback and the explicit history-count message", () => {
    expect(
      packWorkspaceFeedback("ko-KR", "Draft saved. Published versions are unchanged."),
    ).toEqual({
      text: "초안이 저장되었습니다. 게시 버전은 변경되지 않았습니다.",
      lang: "ko-KR",
    });
    expect(packWorkspaceFeedback("de-DE", "Loaded 12 draft revisions.")).toEqual({
      text: "12 Entwurfsrevisionen geladen.",
      lang: "de-DE",
    });
    for (const diagnostic of [
      "Draft saved. Published versions are unchanged. Incident abc-123",
      "Loaded 12 draft revisions. upstream detail",
      "diagnostic.prompt: Unknown schema value 123",
      "Save draft",
      "Le contenu saisi reste intact",
    ]) {
      expect(packWorkspaceFeedback("ko-KR", diagnostic)).toEqual({
        text: diagnostic,
        lang: "en-CA",
      });
    }
  });
});
