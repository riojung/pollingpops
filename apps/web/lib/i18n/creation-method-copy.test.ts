import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { localeOptions } from "./config";
import {
  creationMethodCopy,
  creationMethodCopyEntries,
  creationMethodKeys,
} from "./creation-method-copy";

describe("creation method explanations", () => {
  it.each(supportedLocales)("provides complete localized explanations in %s", (locale) => {
    const english = creationMethodCopyEntries();
    const entries = creationMethodCopyEntries(locale);
    const copy = creationMethodCopy(locale);
    expect(Object.keys(copy.methods)).toEqual([...creationMethodKeys]);
    expect(Object.keys(entries).sort()).toEqual(Object.keys(english).sort());
    expect(Object.keys(entries)).toHaveLength(54);
    for (const [key, value] of Object.entries(entries)) {
      expect(value.trim(), key).not.toBe("");
      expect(value.match(/\{\w+\}/g) ?? [], key).toEqual(english[key]!.match(/\{\w+\}/g) ?? []);
      // Technical quantities retain their values; grammar may change their order.
      if (key.startsWith("methods."))
        expect((value.match(/\d+/g) ?? []).sort(), key).toEqual(
          (english[key]!.match(/\d+/g) ?? []).sort(),
        );
      if (locale !== "en-CA" && (key.startsWith("methods.") || key === "survey.description"))
        expect(value, key).not.toBe(english[key]);
    }
    if (locale !== "en-CA")
      expect(localeOptions.find((option) => option.value === locale)?.previewLabel).toBeTruthy();
  });

  it("describes source proposals and structured import review before explicit creation", () => {
    const { methods } = creationMethodCopy();
    for (const method of [methods.roundSource, methods.presentationSource]) {
      expect(method.input).toMatch(/PDF.*DOCX.*PPTX.*6 MB/);
      expect(method.assistance).toMatch(/AI.*source scanning.*allowance/);
      expect(method.assistance).toContain("source references");
      expect(method.nextStep).toMatch(/Review.*proposals.*explicitly create a private/);
    }
    expect(methods.presentationSource.input).toContain("Original slide layouts are not preserved");
    expect(methods.roundImport.input).toBe(
      "Polling Pops JSON, CSV or bulk text up to 2 MB; QTI 3 ZIP up to 6 MB.",
    );
    expect(methods.roundImport.assistance).toBe("No AI is used.");
    expect(methods.roundImport.nextStep).toMatch(
      /Preview the import.*review questions and warnings/,
    );
    expect(methods.roundImport.nextStep).toContain(
      "Then choose Create draft to create a private editable Round draft",
    );
  });

  it("explains explicit template copies and draft-first outline assistance", () => {
    const { methods } = creationMethodCopy();
    for (const key of [
      "roundTemplate",
      "presentationTemplate",
      "presentationDesign",
      "surveyTemplate",
    ] as const) {
      expect(methods[key].assistance).toBe("No AI is used.");
      expect(methods[key].nextStep).toMatch(/Use.*independent editable/);
    }
    const outline = methods.presentationOutline;
    expect(outline.input).toContain("outline in the editor after the draft opens");
    expect(outline.assistance).toMatch(
      /Creating the draft uses no AI.*optional AI.*3–8.*allowance/,
    );
    expect(outline.nextStep).toMatch(
      /saved private draft first.*generate, review, select and insert/,
    );
    expect(methods.presentationBlank.input).toMatch(/Start empty.*title.*in the editor/);
    expect(methods.surveyBlank.input).toMatch(/Start empty.*title.*in the editor/);
  });

  it("keeps visual import in the saved editor and explains fidelity review", () => {
    const { methods } = creationMethodCopy();
    expect(methods.presentationBlank.note).toMatch(/first open a saved Presentation in the editor/);
    expect(methods.presentationBlank.note).toContain(
      "PDF up to 6 MB or PNG/JPEG/WebP up to 10 MiB each, 20 MB per set, and 40 pages/images",
    );
    expect(methods.presentationBlank.note).toContain(
      "flattened slide visuals with an editable reading version",
    );
    expect(methods.presentationBlank.note).toMatch(
      /Review reading order and losses.*before insertion/,
    );
    expect(Object.values(methods).filter((method) => method.note)).toHaveLength(1);
  });

  it("states Survey question support, privacy thresholds and credential limits", () => {
    const { survey } = creationMethodCopy();
    expect(survey.description).toMatch(
      /choice polls and rating questions.*these two question types/,
    );
    expect(survey.privacy).toMatch(
      /cannot see who submitted which answers or link answers across questions/,
    );
    expect(survey.privacy).toMatch(/only after closing.*at least 5 responses per question/);
    expect(survey.privacy).toContain("per access credential, not per verified person");
    expect(survey.unavailable).not.toMatch(/FEATURE_|ALLOWLIST|operator/);
  });

  it("returns independent display objects and a safe default for unsupported runtime locales", () => {
    expect(creationMethodCopy()).toEqual(creationMethodCopy("en-CA"));
    for (const locale of ["invalid", "toString", "__proto__"])
      expect(creationMethodCopy(locale as SupportedLocale)).toEqual(creationMethodCopy());
    const first = creationMethodCopy("ko-KR");
    const second = creationMethodCopy("ko-KR");
    first.methods.roundBlank.input = "Consumer edit";
    first.survey.title = "Consumer edit";
    expect(creationMethodCopy("ko-KR")).toEqual(second);
  });
});
