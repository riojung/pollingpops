import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { localeOptions } from "./config";
import { importPreviewCopy, importPreviewCopyEntries } from "./import-preview-copy";

describe("structured import preview copy", () => {
  it.each(supportedLocales)("provides all preview and creation states in %s", (locale) => {
    const english = importPreviewCopyEntries();
    const entries = importPreviewCopyEntries(locale);
    expect(entries).toEqual(importPreviewCopy(locale));
    expect(Object.keys(entries).sort()).toEqual(Object.keys(english).sort());
    expect(Object.keys(entries)).toHaveLength(37);
    for (const [key, value] of Object.entries(entries)) {
      expect(value.trim(), key).not.toBe("");
      expect(value.match(/\{\w+\}/g) ?? [], key).toEqual(english[key]!.match(/\{\w+\}/g) ?? []);
      if (locale !== "en-CA") expect(value, key).not.toBe(english[key]);
    }
    if (locale !== "en-CA")
      expect(localeOptions.find((option) => option.value === locale)?.previewLabel).toBeTruthy();
  });

  it("explains preview, explicit creation and confirmation recovery separately", () => {
    const copy = importPreviewCopy();
    expect(copy.preview).toBe("Preview import");
    expect(copy.previewOnly).toContain("No draft has been created");
    expect(copy.create).toBe("Create draft");
    expect(copy.description).toMatch(/before creating a draft.*does not use AI/);
    expect(copy.created).toContain("Nothing has been published");
    expect(copy.creationError).toContain("Retry the same creation");
    expect(copy.openingError).toContain("The draft was created");
    expect(copy.pendingRecovery).toMatch(/same source and title.*same creation.*tab open/);
    expect(copy.recoveryError).toMatch(/Allow tab storage.*before creating a draft/);
  });

  it("returns independent objects and a safe runtime locale fallback", () => {
    expect(importPreviewCopy()).toEqual(importPreviewCopy("en-CA"));
    for (const locale of ["invalid", "toString", "__proto__"])
      expect(importPreviewCopy(locale as SupportedLocale)).toEqual(importPreviewCopy());
    const first = importPreviewCopy("ko-KR");
    const second = importPreviewCopy("ko-KR");
    first.preview = "Consumer edit";
    expect(importPreviewCopy("ko-KR")).toEqual(second);
    const entries = importPreviewCopyEntries("ko-KR");
    entries.preview = "Consumer edit";
    expect(importPreviewCopyEntries("ko-KR")).toEqual(second);
  });
});
