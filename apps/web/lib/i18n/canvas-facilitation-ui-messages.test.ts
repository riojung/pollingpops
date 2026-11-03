import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { canvasFacilitationUiCopy } from "./canvas-facilitation-ui-messages";

describe("canvas facilitation UI localization", () => {
  it("provides the timer controls and empty-state copy", () => {
    expect(canvasFacilitationUiCopy("en-CA")).toEqual({
      quickTimer: "Quick timer",
      closeTimer: "Close timer",
      timerControls: "Timer controls",
      decreaseDuration: "Decrease duration",
      increaseDuration: "Increase duration",
      quickDurations: "Quick durations",
      presetMinutes: "{minutes} min",
      floatTimer: "Float timer",
      showInPanel: "Show timer in panel",
      ready: "Ready when you are",
      commentsEmpty: "Start a conversation",
      versionsEmpty: "Keep a checkpoint",
      timerProgress: "Timer progress",
    });
  });

  it.each(supportedLocales)("keeps labels complete and placeholders intact in %s", (locale) => {
    const english = canvasFacilitationUiCopy("en-CA");
    const copy = canvasFacilitationUiCopy(locale);
    expect(Object.keys(copy)).toEqual(Object.keys(english));
    for (const key of Object.keys(copy) as (keyof typeof copy)[]) {
      expect(copy[key].trim(), key).toBeTruthy();
      expect(copy[key].match(/\{\w+\}/g) ?? [], key).toEqual(english[key].match(/\{\w+\}/g) ?? []);
      if (locale !== "en-CA" && key !== "presetMinutes") {
        expect(copy[key], key).not.toBe(english[key]);
      }
    }
    expect(copy.presetMinutes.match(/\{minutes\}/g)).toEqual(["{minutes}"]);
    expect(copy.decreaseDuration).not.toBe(copy.increaseDuration);
    expect(copy.floatTimer).not.toBe(copy.showInPanel);
    expect(copy.commentsEmpty).not.toBe(copy.versionsEmpty);
  });

  it("falls back to English for an unsupported locale", () => {
    expect(canvasFacilitationUiCopy("xx-XX" as SupportedLocale)).toEqual(
      canvasFacilitationUiCopy("en-CA"),
    );
  });
});
