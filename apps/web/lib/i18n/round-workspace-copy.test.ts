import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { roundWorkspaceCopy, roundWorkspaceCopyKeys } from "./round-workspace-copy";
describe("Round workspace copy", () => {
  it.each(supportedLocales)("provides complete copy and placeholders in %s", (locale) => {
    for (const key of roundWorkspaceCopyKeys) {
      const value = roundWorkspaceCopy(locale)(key);
      expect(value.trim()).not.toBe("");
      expect(value.match(/\{\w+\}/g) ?? []).toEqual(key.match(/\{\w+\}/g) ?? []);
      if (locale !== "en-CA") expect(value).not.toBe(key);
    }
    expect(
      roundWorkspaceCopy(locale)("Question {current} of {total}", {
        current: "$&",
        total: "{authored}",
      }),
    ).toContain("$&");
  });
});
