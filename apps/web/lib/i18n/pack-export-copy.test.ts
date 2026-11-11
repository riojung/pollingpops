import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  packExportCopy,
  packExportCopyKeys,
  packExportFeedback,
  packExportDisposition,
  packExportFindingReason,
  packExportCanonicalFindings,
} from "./pack-export-copy";

describe("Pack portability display copy", () => {
  it.each(supportedLocales)(
    "covers controls, canonical findings and interpolation in %s",
    (locale) => {
      const copy = packExportCopy(locale);
      for (const key of packExportCopyKeys) {
        const text = copy(key, { exported: 2, total: 3, count: 7, format: "QTI 3" });
        expect(text.trim()).not.toBe("");
        expect(text).not.toMatch(/\{\w+\}/);
      }
      for (const key of [
        "Checkpoint portability",
        "Review export losses",
        "Download export report JSON",
      ] as const)
        if (locale !== "en-CA") expect(copy(key)).not.toBe(key);
      expect(
        copy("{exported} of {total} checkpoints exportable", { exported: 2, total: 3 }),
      ).toMatch(/2/);
      expect(packExportDisposition(locale, "extension_only")).toBe(copy("extension only"));
      expect(packExportCanonicalFindings.length).toBeGreaterThan(20);
      for (const finding of packExportCanonicalFindings) {
        const translated = packExportFindingReason(locale, finding);
        expect(translated.lang).toBe(locale);
        expect(translated.known).toBe(true);
        expect(translated.text.length).toBeGreaterThan(10);
        if (locale === "en-CA") expect(translated.text).toBe(finding.reason);
        else expect(translated.text).not.toBe(finding.reason);
      }
    },
  );

  it("requires both canonical finding code and exact reason and preserves unknown English diagnostics", () => {
    const finding = packExportCanonicalFindings[0]!;
    for (const unknown of [
      { ...finding, code: "FUTURE_CODE" },
      { ...finding, code: "toString" },
      { ...finding, reason: `${finding.reason} Ref: private-ID` },
      { ...finding, reason: "Download export report JSON" },
    ])
      expect(packExportFindingReason("ko-KR", unknown)).toEqual({
        text: unknown.reason,
        lang: "en-CA",
        known: false,
      });
    const raw =
      "The export report does not match this frozen Pack version and format. Review again.";
    expect(packExportFeedback("de-DE", raw)).toEqual({
      text: packExportCopy("de-DE")(raw),
      lang: "de-DE",
      known: true,
    });
    for (const unknown of ["Checkpoint portability", "toString", "__proto__", `${raw} extra`, ""])
      expect(packExportFeedback("de-DE", unknown)).toEqual({
        text: unknown,
        lang: "en-CA",
        known: false,
      });
    expect(packExportCopy()("Checkpoint portability")).toBe("Checkpoint portability");
  });
});
