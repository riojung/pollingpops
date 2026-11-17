import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  assignmentsDirectoryCopy,
  assignmentsDirectoryCopyKeys,
} from "./assignments-directory-copy";

describe("assignments directory copy", () => {
  it.each(supportedLocales)(
    "provides every directory and chooser string in %s with the same placeholders",
    (locale) => {
      const copy = assignmentsDirectoryCopy(locale);
      for (const key of assignmentsDirectoryCopyKeys) {
        const translated = copy(key);
        expect(translated.trim()).not.toBe("");
        if (locale === "en-CA") expect(translated).toBe(key);
        else expect(translated).not.toBe(key);
        const placeholders = (value: string) =>
          [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
        expect(placeholders(translated)).toEqual(placeholders(key));
      }
      expect(copy("Showing {count}", { count: 25 })).toContain("25");
      const activity = copy("{completed} of {attempts} attempts completed", {
        completed: 3,
        attempts: 5,
      });
      expect(activity).toContain("3");
      expect(activity).toContain("5");
      expect(activity).not.toContain("{");
    },
  );
  it("substitutes literal values once and uses English for unknown locales", () => {
    expect(assignmentsDirectoryCopy("unknown" as SupportedLocale)("Create assignment")).toBe(
      "Create assignment",
    );
    for (const locale of supportedLocales) {
      const copy = assignmentsDirectoryCopy(locale);
      expect(copy("Showing {count}", { count: "$& {authored}" })).toContain("$& {authored}");
      expect(
        copy("{completed} of {attempts} attempts completed", { completed: 0, attempts: 0 }),
      ).not.toContain("{");
      expect(copy("Showing {count}")).toContain("{count}");
    }
  });
});
