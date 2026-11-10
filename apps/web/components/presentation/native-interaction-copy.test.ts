import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  nativeInteractionCopy,
  nativeInteractionCopyKeys,
  nativeInteractionIssueCopy,
  nativeInteractionKindKeys,
} from "./native-interaction-copy";
import { nativeControlsCopy } from "./native-controls-copy";

const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];

describe("native interaction authoring copy", () => {
  it.each(supportedLocales)(
    "covers every key and preserves author placeholders in %s",
    (locale) => {
      const copy = nativeInteractionCopy(locale);
      for (const key of nativeInteractionCopyKeys) {
        expect(copy(key).trim(), key).not.toBe("");
        expect(placeholders(copy(key)), key).toEqual(placeholders(key));
        const values = Object.fromEntries(
          placeholders(key).map((token) => [token.slice(1, -1), `Original ${token} <author text>`]),
        );
        const output = copy(key, values);
        for (const value of Object.values(values)) expect(output, key).toContain(value);
        if (locale === "en-CA") expect(copy(key), key).toBe(key);
      }
      if (locale !== "en-CA") {
        for (const key of [
          "Slide link editor",
          "Detail title",
          "Reveal audience",
          "Before you try it",
          "Ready to try on this slide.",
          "Preview this slide",
          "Interaction map",
          "Edit interaction",
        ] as const)
          expect(copy(key), key).not.toBe(key);
      }
      for (const key of ["Image", ...Object.values(nativeInteractionKindKeys)] as const)
        expect(copy(key)).toBe(nativeControlsCopy(locale)(key));
    },
  );

  it("keeps the key inventory unique and falls back to English at the pure API boundary", () => {
    expect(new Set(nativeInteractionCopyKeys).size).toBe(nativeInteractionCopyKeys.length);
    for (const key of nativeInteractionCopyKeys) expect(nativeInteractionCopy()(key)).toBe(key);
    expect(
      nativeInteractionCopy("zz-ZZ" as SupportedLocale)("Choose “{label}”.", {
        label: "Reveal panel {image}",
      }),
    ).toBe("Choose “Reveal panel {image}”.");
    expect(nativeInteractionCopy("ko-KR")("Go to “{title}”.")).toContain("{title}");
  });

  it("localizes only known library/preflight issues and explicitly retains unknown English diagnostics", () => {
    expect(
      nativeInteractionIssueCopy("ko-KR", "Choose an available target slide or activity."),
    ).toEqual({ text: "사용 가능한 대상 슬라이드 또는 활동을 선택하세요.", language: "ko-KR" });
    expect(
      nativeInteractionIssueCopy("ko-KR", "Finish the pending edit before previewing."),
    ).toEqual({ text: "미리보기 전에 진행 중인 편집을 완료하세요.", language: "ko-KR" });
    for (const issue of [
      "Unexpected geometry diagnostic",
      "Detail dialog",
      "Add a detail title. {authored}",
    ])
      expect(nativeInteractionIssueCopy("ko-KR", issue)).toEqual({
        text: issue,
        language: "en-CA",
      });
  });

  it("provides the critical Korean labels and recovery guidance", () => {
    const copy = nativeInteractionCopy("ko-KR");
    expect(copy("Interaction overview")).toBe("상호작용 개요");
    expect(copy("Interaction map")).toBe("상호작용 맵");
    expect(copy("Reveal audience")).toBe("공개 대상");
    expect(copy("Slide link label")).toBe("슬라이드 링크 레이블");
    expect(copy("Detail button label")).toBe("상세 버튼 레이블");
    expect(copy("Detail audience content")).toBe("참가자용 상세 콘텐츠");
    expect(copy("Link URL")).toBe("링크 URL");
    expect(copy("Preview this slide")).toBe("이 슬라이드 미리보기");
    expect(copy("Correct the unsaved link entries on this slide before previewing.")).toBe(
      "미리보기 전에 이 슬라이드에서 저장되지 않은 링크 입력을 수정하세요.",
    );
    expect(copy("{count} interactions", { count: 2 })).toBe("상호작용 2개");
  });
});
