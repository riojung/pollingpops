import { describe, expect, it } from "vitest";
import type { SupportedLocale } from "@openround/contracts";
import {
  canvasProductivityEnglishMessages,
  canvasProductivityMessages,
} from "./canvas-productivity-messages";
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
describe("canvas productivity localization", () => {
  it.each(locales)("has complete labels and placeholders in %s", (locale) => {
    const messages = canvasProductivityMessages(locale);
    for (const key of Object.keys(
      canvasProductivityEnglishMessages,
    ) as (keyof typeof canvasProductivityEnglishMessages)[]) {
      expect(messages[key], key).toBeTruthy();
      expect(messages[key].match(/\{\w+\}/g) ?? []).toEqual(
        canvasProductivityEnglishMessages[key].match(/\{\w+\}/g) ?? [],
      );
    }
  });
});
