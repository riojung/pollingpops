import { describe, expect, it } from "vitest";
import type { SupportedLocale } from "@openround/contracts";
import { canvasEnglishMessages, canvasMessages } from "./canvas-messages";
const locales: SupportedLocale[] = [
  "en-CA",
  "fr-FR",
  "de-DE",
  "es-ES",
  "it-IT",
  "pt-PT",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
];
describe("canvas messages", () => {
  it.each(locales)("provides every canvas label and the same placeholders in %s", (locale) => {
    const messages = canvasMessages(locale);
    expect(Object.keys(messages)).toEqual(Object.keys(canvasEnglishMessages));
    for (const key of Object.keys(
      canvasEnglishMessages,
    ) as (keyof typeof canvasEnglishMessages)[]) {
      expect(messages[key], key).toBeTruthy();
      expect(messages[key].match(/\{\w+\}/g) ?? [], key).toEqual(
        canvasEnglishMessages[key].match(/\{\w+\}/g) ?? [],
      );
    }
  });
});
