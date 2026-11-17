import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { learnerCopy, learnerCopyKeys } from "./learner-copy";

describe("learner workflow copy", () => {
  it.each(supportedLocales)("covers every control and interpolation in %s", (locale) => {
    const copy = learnerCopy(locale);
    for (const key of learnerCopyKeys) {
      const translated = copy(key);
      expect(translated.trim()).not.toBe("");
      expect(translated.match(/\{\w+\}/g)?.sort() ?? []).toEqual(
        key.match(/\{\w+\}/g)?.sort() ?? [],
      );
      if (locale !== "en-CA" && key !== "Incorrect") expect(translated).not.toBe(key);
    }
    expect(
      copy("{completed} of {total} questions completed", { completed: 2, total: 4 }),
    ).not.toMatch(/\{\w+\}/);
  });
});
