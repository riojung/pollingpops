import {
  PresentationReportV7Schema,
  QuestionTypeSchema,
  supportedLocales,
  type SupportedLocale,
} from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  presentationReportCopy,
  presentationReportCopyKeys,
  type PresentationReportCopyKey,
} from "./presentation-report-copy";

describe("Presentation report copy", () => {
  it.each(supportedLocales)(
    "provides complete localized copy with matching placeholders in %s",
    (locale) => {
      const english = presentationReportCopy();
      const copy = presentationReportCopy(locale);

      for (const key of presentationReportCopyKeys) {
        const translated = copy(key);
        expect(translated.trim(), `${locale}:${key}`).not.toBe("");
        expect((translated.match(/\{\w+\}/g) ?? []).sort(), `${locale}:${key}`).toEqual(
          (english(key).match(/\{\w+\}/g) ?? []).sort(),
        );
        if (locale !== "en-CA" && !(locale === "fr-FR" && key === "sectionLabel"))
          expect(translated, `${locale}:${key}`).not.toBe(english(key));
      }
    },
  );

  it("covers every known report timeline event and question type", () => {
    expect(new Set(presentationReportCopyKeys).size).toBe(presentationReportCopyKeys.length);
    expect(presentationReportCopyKeys.filter((key) => key.startsWith("event.")).sort()).toEqual(
      PresentationReportV7Schema.shape.timeline.element.shape.type.options
        .map((type) => `event.${type}`)
        .sort(),
    );
    expect(
      presentationReportCopyKeys.filter((key) => key.startsWith("questionType.")).sort(),
    ).toEqual(QuestionTypeSchema.options.map((type) => `questionType.${type}`).sort());
  });

  it("uses English by default and for unsupported runtime locales", () => {
    const english = presentationReportCopy("en-CA");
    for (const key of presentationReportCopyKeys) {
      expect(presentationReportCopy()(key)).toBe(english(key));
      for (const locale of ["unknown", "toString", "__proto__"])
        expect(presentationReportCopy(locale as SupportedLocale)(key)).toBe(english(key));
    }
  });

  it("keeps the report evidence and retry explanations precise", () => {
    const english = presentationReportCopy();
    const expected = {
      exportEvidenceCsv: "Export evidence CSV",
      exportFailed: "This report could not be exported. Refresh the report and try again.",
      retryReport: "Try again",
      retryingReport: "Retrying report…",
      reportUnavailable: "The report could not be loaded. Try again.",
      serviceMessage: "Service message (original language)",
      skippedNotPresented: "Skipped · not presented",
      skippedEvidence:
        "This block was never presented. No response or assessment evidence was collected.",
      unscoredOpinion: "Unscored opinion",
      textResultsSuppressed:
        "Text results require reveal and at least five approved responses. Pending and removed responses are excluded.",
      navigationCounts: "{jumps} jumps · {returns} returns to path",
      interactionCounts: "{reveals} broadcast reveal changes · {branches} answer branches followed",
      answerBranchMatched: "Answer branch followed · {matched} of {total} responses matched",
      recoveryPackReference: "Recovery Pack v{version} · card {card}",
    } satisfies Partial<Record<PresentationReportCopyKey, string>>;
    for (const key of Object.keys(expected) as Array<keyof typeof expected>)
      expect(english(key)).toBe(expected[key]);
  });

  it("interpolates once and preserves replacement tokens and embedded placeholders literally", () => {
    const literalValue = "$& $` $' $$ {card} {version} 한국어";
    for (const locale of supportedLocales) {
      const copy = presentationReportCopy(locale);
      const reference = copy("recoveryPackReference", { version: literalValue, card: 0 });
      expect(reference).toContain(literalValue);
      expect(copy("navigationCounts", { jumps: 0, returns: 12 })).not.toMatch(/\{\w+\}/);
      expect(copy("interactionCounts", { reveals: 3, branches: 0 })).not.toMatch(/\{\w+\}/);
      expect(copy("answerBranchMatched", { matched: 0, total: 5 })).not.toMatch(/\{\w+\}/);
    }
    expect(
      presentationReportCopy()("recoveryPackReference", { version: literalValue, card: 0 }),
    ).toBe(`Recovery Pack v${literalValue} · card 0`);
    expect(presentationReportCopy()("navigationCounts", { jumps: 0 })).toBe(
      "0 jumps · {returns} returns to path",
    );
    expect(presentationReportCopy()("recoveryPackReference", { version: "", card: 2 })).toBe(
      "Recovery Pack v · card 2",
    );
  });
});
