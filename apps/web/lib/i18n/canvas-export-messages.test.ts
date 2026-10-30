import { describe, expect, it } from "vitest";
import type { SupportedLocale } from "@openround/contracts";
import { canvasExportEnglishMessages, canvasExportMessages } from "./canvas-export-messages";
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
describe("canvas export labels", () => {
  it.each(locales)("provides every nonempty label in %s", (locale) => {
    const messages = canvasExportMessages(locale);
    expect(Object.keys(messages)).toEqual(Object.keys(canvasExportEnglishMessages));
    for (const [key, value] of Object.entries(messages)) expect(value, key).toBeTruthy();
  });
});
