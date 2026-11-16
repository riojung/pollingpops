import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { loadLiveDeliveryMessages } from ".";
import { companionEnglishMessages } from "./companion-en-CA";
import {
  companionCopy,
  companionCopySources,
  companionMessages,
  localizeCompanionError,
} from "./companion-translations";

describe("Companion delivery translations", () => {
  it.each(supportedLocales)(
    "loads all scoped keys and preserves exact tokens in %s",
    async (locale) => {
      const messages = companionMessages(locale);
      const catalog = await loadLiveDeliveryMessages(locale);
      expect(Object.keys(messages)).toHaveLength(94);
      for (const [key, value] of Object.entries(messages)) {
        const source = companionEnglishMessages[key as keyof typeof companionEnglishMessages];
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
        expect(catalog[key as keyof typeof catalog]).toBe(value);
        expect(value.match(/\{\w+\}/g) ?? []).toEqual(source.match(/\{\w+\}/g) ?? []);
        if (locale === "en-CA") expect(value).toBe(source);
      }
      for (const source of companionCopySources) {
        const translated = companionCopy(locale)(source);
        expect(translated.trim()).not.toBe("");
        expect(translated.match(/\{\w+\}/g) ?? []).toEqual(source.match(/\{\w+\}/g) ?? []);
      }
    },
  );

  it("translates only recognized app recovery messages and retains unknown diagnostics", () => {
    expect(
      localizeCompanionError(
        "ko-KR",
        "The server did not confirm that action. Retry its acknowledgement.",
      ),
    ).toEqual({
      text: "서버가 작업을 확인하지 않았습니다. 확인 응답을 재시도하세요.",
      language: "ko-KR",
      known: true,
    });
    expect(localizeCompanionError("ko-KR", "Synthetic backend detail: command-123")).toEqual({
      text: "Synthetic backend detail: command-123",
      language: "en-CA",
      known: false,
    });
    expect(localizeCompanionError("ko-KR", "toString").known).toBe(false);
    expect(localizeCompanionError("ko-KR", "Request failed (503)").text).toBe("요청 실패 (503)");
    expect(companionCopy("ko-KR")("Choice {number}", { number: 3 })).toBe("선택지 3");
  });
});
