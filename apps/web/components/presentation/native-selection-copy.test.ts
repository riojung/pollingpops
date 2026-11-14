import { describe, expect, it } from "vitest";
import { supportedLocales } from "@openround/contracts";
import { nativeSelectionCopy, nativeSelectionCopyKeys } from "./native-selection-copy";

describe("native selection chrome copy", () => {
  it.each(supportedLocales)("covers compact labels and shortcuts in %s", (locale) => {
    const copy = nativeSelectionCopy(locale);
    for (const key of nativeSelectionCopyKeys) {
      const message = copy(key);
      expect(message.trim(), key).not.toBe("");
      expect(message.match(/\{\w+\}/g)?.sort() ?? [], key).toEqual(
        key.match(/\{\w+\}/g)?.sort() ?? [],
      );
      if (locale !== "en-CA") expect(message, key).not.toBe(key);
      const formatted = copy(key, { number: 2, count: 3 });
      expect(formatted).not.toMatch(/\{\w+\}/);
    }
    expect(copy("Group {number} · {count}", { number: 2, count: 3 })).toContain("2");
    expect(copy("Group {number}, {count} objects", { number: 2, count: 3 })).toContain("3");
  });
});
