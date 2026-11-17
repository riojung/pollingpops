import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { assignmentSetupCopy, assignmentSetupCopyKeys } from "./assignment-setup-copy";

describe("assignment setup and receipt copy", () => {
  it.each(supportedLocales)("translates all interface phrases in %s", (locale) => {
    const copy = assignmentSetupCopy(locale);
    for (const key of assignmentSetupCopyKeys) {
      const translated = copy(key);
      expect(translated).toBeTruthy();
      expect(translated.match(/\{\w+\}/g) ?? []).toEqual(key.match(/\{\w+\}/g) ?? []);
      if (locale !== "en-CA") expect(translated).not.toBe(key);
    }
  });
  it("preserves authored labels and exact timezone values during interpolation", () => {
    for (const locale of supportedLocales) {
      expect(
        assignmentSetupCopy(locale)("Copy link for {label}", { label: "Copy $& <name>" }),
      ).toContain("Copy $& <name>");
      expect(
        assignmentSetupCopy(locale)("Times shown in {timezone}.", { timezone: "America/Edmonton" }),
      ).toContain("America/Edmonton");
    }
  });
});
