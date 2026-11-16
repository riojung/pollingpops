import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../test-utils/english-locale";
import { RecoveryStorySummary, type RecoveryStoryModel } from "./recovery-story";

vi.mock("next/navigation", () => ({
  usePathname: () => "/report/example",
}));

const model: RecoveryStoryModel = {
  recovered: 2,
  denominator: 3,
  recoveryPercent: 66.7,
  initialAccuracyPercent: 50,
  evidenceLabel: "vérification liée",
  unresolvedCount: 1,
  unresolvedNarrative: "Une notion reste à revoir.",
  interventions: [{ id: "one", label: "Discussion entre pairs" }],
  nextActionLabel: "Réviser",
  nextAction: "Reprendre la notion demain.",
  highConfidenceWrong: 0,
  correctButUnsure: 0,
  smallSample: false,
  evidenceNote: "Preuve de séance uniquement.",
};

describe("RecoveryStorySummary", () => {
  it("does not portray absent concept evidence as a measured zero and qualifies small initial samples", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <RecoveryStorySummary
          model={{
            ...model,
            unresolvedCount: 0,
            conceptEvidenceCount: 0,
            unresolvedNarrative: "No concept-level recovery evidence was recorded.",
            denominator: 0,
            recovered: 0,
            recoveryPercent: null,
            initialResponses: 1,
            initialCorrect: 0,
            initialAccuracyPercent: 0,
            initialSmallSample: true,
          }}
        />,
      ),
    );
    expect(markup).toContain("What remains unresolved</span><strong>Not measured</strong>");
    expect(markup).toContain("Fewer than five assessed responses");
    expect(markup).toContain("0/1 · 0%");
    expect(markup).not.toContain("0/0");
    expect(markup).toContain('class="recovery-story-evidence-note"');
  });
  it("shows retained Pack version/card references without depending on the mutable source Pack", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <RecoveryStorySummary
          model={{
            ...model,
            interventions: [
              {
                id: "pack",
                label: "example",
                sourceReference: "Recovery Pack v2 · card source-card",
              },
            ],
          }}
        />,
      ),
    );
    expect(markup).toContain("Recovery Pack v2 · card source-card");
    expect(markup).toContain('lang="en-CA"');
  });
  it("preserves the declared language of generated narrative content", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<RecoveryStorySummary contentLanguage="fr-FR" model={model} />),
    );

    expect(markup).toContain('lang="fr-FR">Une notion reste à revoir.</p>');
    expect(markup).toContain('lang="fr-FR">Réviser</strong>');
    expect(markup).toContain('lang="fr-FR">Preuve de séance uniquement.</p>');
  });
});
