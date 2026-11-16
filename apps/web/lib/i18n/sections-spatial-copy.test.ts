import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  sectionsSpatialCopy,
  sectionsSpatialKeys,
  localizeSectionsSpatialMessage,
} from "./sections-spatial-copy";

describe("Sections and spatial system copy", () => {
  it.each(supportedLocales)(
    "covers every UI phrase and keeps interpolation contracts in %s",
    (locale) => {
      const copy = sectionsSpatialCopy(locale);
      for (const key of sectionsSpatialKeys) {
        expect(copy(key).trim()).not.toBe("");
        expect(
          copy(key)
            .match(/\{\w+\}/g)
            ?.sort() ?? [],
        ).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
      }
      expect(copy("Delete section {title}", { title: "Author 原名" })).toContain("Author 原名");
      expect(copy("Page {current} of {total}", { current: 2, total: 3 })).not.toMatch(/\{\w+\}/);
      if (locale !== "en-CA")
        expect(copy("Enable spatial layout")).not.toBe("Enable spatial layout");
    },
  );
  it("translates only exact known navigation denials and attributes unknown diagnostics", () => {
    expect(
      localizeSectionsSpatialMessage("ko-KR", "Complete the linked recheck before navigating."),
    ).toEqual({
      text: "탐색하기 전에 연결된 재확인을 완료하세요.",
      language: "ko-KR",
      known: true,
    });
    const diagnostic = "Complete the linked recheck before navigating. Ref: private-diagnostic";
    expect(localizeSectionsSpatialMessage("ko-KR", diagnostic)).toEqual({
      text: diagnostic,
      language: "en-CA",
      known: false,
    });
  });
});
