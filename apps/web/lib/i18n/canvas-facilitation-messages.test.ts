import { describe, expect, it } from "vitest";
import { supportedLocales } from "@openround/contracts";
import {
  canvasFacilitationCopy,
  canvasFacilitationEnglishMessages,
  canvasFacilitationMessages,
} from "./canvas-facilitation-messages";
describe("facilitation messages", () => {
  it.each(supportedLocales)("has complete localized text in %s", (locale) => {
    const messages = canvasFacilitationMessages(locale);
    expect(Object.keys(messages)).toEqual(Object.keys(canvasFacilitationEnglishMessages));
    for (const text of Object.values(canvasFacilitationCopy(locale))) expect(text).toBeTruthy();
    for (const text of Object.values(messages)) expect(text).toBeTruthy();
  });
});
