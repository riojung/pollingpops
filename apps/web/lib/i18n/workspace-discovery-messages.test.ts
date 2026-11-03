import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { workspaceDiscoveryCopy } from "./workspace-discovery-messages";

describe("workspace discovery language", () => {
  it("provides all Home and creation labels in every supported locale", () => {
    const english = workspaceDiscoveryCopy("en-CA");
    expect(Object.keys(english)).toHaveLength(35);
    for (const locale of supportedLocales) {
      const copy = workspaceDiscoveryCopy(locale);
      expect(Object.keys(copy)).toEqual(Object.keys(english));
      expect(Object.values(copy).every((label) => label.trim().length > 0)).toBe(true);
      if (locale !== "en-CA") expect(copy.homeHeadline).not.toBe(english.homeHeadline);
      for (const key of [
        "questionCount",
        "ideaCount",
        "objectCount",
        "questionCountOne",
        "ideaCountOne",
        "objectCountOne",
      ] as const)
        expect(copy[key].match(/\{count\}/g)).toHaveLength(1);
    }
  });
  it("keeps the creation labels generic and falls back for unknown locales", () => {
    expect(workspaceDiscoveryCopy("en-CA").create).toBe("Create");
    expect(workspaceDiscoveryCopy("unknown" as SupportedLocale)).toEqual(
      workspaceDiscoveryCopy("en-CA"),
    );
  });
});
