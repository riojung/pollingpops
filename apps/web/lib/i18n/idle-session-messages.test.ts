import { describe, expect, it } from "vitest";
import { supportedLocales } from "@openround/contracts";
import { idleSessionCopy } from "./idle-session-messages";

describe("idle session localization", () => {
  it("provides complete countdown, warning and settings copy in every supported locale", () => {
    const english = idleSessionCopy("en-CA");
    for (const locale of supportedLocales) {
      const copy = idleSessionCopy(locale);
      expect(Object.keys(copy)).toEqual(Object.keys(english));
      for (const value of Object.values(copy)) expect(value?.trim().length).toBeGreaterThan(0);
      expect(copy.countdown.match(/\{seconds\}/g)).toHaveLength(1);
      expect(copy.rangeHelp).toContain("240");
      if (locale !== "en-CA") expect(copy.warningTitle).not.toBe(english.warningTitle);
    }
  });
});
