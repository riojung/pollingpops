import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_ASSISTANCE_REVIEW_WARNING,
  type PresentationAssistanceProposal,
} from "@openround/contracts";
import { AssistanceProposalReview, PresentationAssistance } from "./presentation-assistance";

const proposal: PresentationAssistanceProposal = {
  schemaVersion: 1,
  sourceName: "Customer interview outline",
  sourceDigest: "a".repeat(64),
  slides: [1, 2, 3].map((n) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    title: `Customer finding ${n}`,
    body: `Review finding ${n} with the team.`,
    citations: [
      { locator: `outline line ${n}`, excerpt: `Exact original evidence ${n}.` },
      {
        locator: "outline line 4",
        excerpt: "A second complete excerpt, including the limitation.",
      },
    ],
  })),
  generatedAt: "2026-11-05T12:00:00.000Z",
  provider: "approved-fixture",
  model: "bounded-text",
  reviewWarning: PRESENTATION_ASSISTANCE_REVIEW_WARNING,
};

describe("Outline assistance review", () => {
  it("shows all exact source excerpts alongside unverified slide text and explicit review controls", () => {
    const markup = renderToStaticMarkup(
      <AssistanceProposalReview
        proposal={proposal}
        selectedSlideIds={[proposal.slides[0]!.id]}
        reviewed={false}
        disabled={false}
        onSelect={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Review proposed slides"');
    expect(markup).toContain(PRESENTATION_ASSISTANCE_REVIEW_WARNING);
    expect(markup).toContain("citations do not verify the generated claims");
    for (const slide of proposal.slides) {
      expect(markup).toContain(slide.title);
      expect(markup).toContain(slide.body);
      for (const citation of slide.citations) {
        expect(markup).toContain(citation.locator);
        expect(markup).toContain(citation.excerpt);
      }
    }
    expect(markup.match(/checked=""/g)).toHaveLength(1);
    expect(markup).toContain(
      "I reviewed the selected slide text and exact excerpts, including any unsupported claims.",
    );
    expect(markup).toContain("Only selected slides will be inserted");
    expect(markup).not.toContain("Publish");
  });

  it("locks all review choices while recovering an uncertain insertion", () => {
    const markup = renderToStaticMarkup(
      <AssistanceProposalReview
        proposal={proposal}
        selectedSlideIds={proposal.slides.map((slide) => slide.id)}
        reviewed={true}
        disabled
        onSelect={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup.match(/checked=""/g)).toHaveLength(4);
  });

  it("exposes a named dialog, availability-first form and manual-editor explanation without requesting data during render", () => {
    const markup = renderToStaticMarkup(
      <PresentationAssistance
        presentationId="00000000-0000-4000-8000-000000000010"
        actorKey="actor:workspace"
        canEdit
        open
        expectedRevision={4}
        afterBlockId={null}
        onInserted={vi.fn()}
        onReloadDraft={vi.fn()}
        onClose={vi.fn()}
        onResumeRequired={vi.fn()}
        onPendingChange={vi.fn()}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-labelledby="presentation-assistance-title"');
    expect(markup).toContain("Checking AI availability and allowance");
    expect(markup).toMatch(/<fieldset disabled=""/);
    expect(markup).toContain('minLength="50"');
    expect(markup).toContain('maxLength="12000"');
    expect(markup).toContain("Ordinary slide creation and editing remain available without AI");
  });

  it("explains revoked editor permission and leaves generation disabled", () => {
    const markup = renderToStaticMarkup(
      <PresentationAssistance
        presentationId="00000000-0000-4000-8000-000000000010"
        actorKey="actor:workspace"
        canEdit={false}
        open
        expectedRevision={4}
        afterBlockId={null}
        onInserted={vi.fn()}
        onReloadDraft={vi.fn()}
        onClose={vi.fn()}
        onResumeRequired={vi.fn()}
        onPendingChange={vi.fn()}
      />,
    );
    expect(markup).toContain("Editor permission is required");
    expect(markup).toMatch(/<fieldset disabled=""/);
  });
});
