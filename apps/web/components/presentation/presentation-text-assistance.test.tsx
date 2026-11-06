import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  presentationTextAssistanceSourceDigest,
  type PresentationTextAssistanceProposal,
} from "@openround/contracts";
import {
  PresentationTextAssistance,
  TextAssistanceProposalReview,
} from "./presentation-text-assistance";
const originalText = "  Complete original wording\nwith evidence and a limitation.  ";
const text = "Shorter wording with a limitation.";
const proposal: PresentationTextAssistanceProposal = {
  schemaVersion: 1,
  blockId: "00000000-0000-4000-8000-000000000001",
  nodeId: "Imported NODE title",
  role: "body",
  operation: "shorten",
  originalText,
  text,
  sourceDigest: presentationTextAssistanceSourceDigest(originalText),
  outputDigest: presentationTextAssistanceSourceDigest(text),
  provider: "approved-provider",
  model: "bounded-model",
  generatedAt: "2026-11-06T12:00:00.000Z",
  reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
};
const props = {
  presentationId: "00000000-0000-4000-8000-000000000002",
  actorKey: "actor:workspace",
  canEdit: true,
  open: true,
  target: {
    blockId: proposal.blockId,
    nodeId: proposal.nodeId,
    role: proposal.role,
    operation: proposal.operation,
    text: originalText,
    expectedRevision: 4,
  },
  citations: [],
  onApplied: vi.fn(),
  onReloadTarget: vi.fn(),
  onClose: vi.fn(),
  onPendingChange: vi.fn(),
  onRecoveryChange: vi.fn(),
};
describe("selected text assistance review", () => {
  it("shows complete original/proposed text and labels prior citations as unverified context", () => {
    const markup = renderToStaticMarkup(
      <TextAssistanceProposalReview
        proposal={proposal}
        citations={[{ locator: "outline line 2", excerpt: "Earlier source excerpt" }]}
        reviewed={false}
        disabled={false}
        onReview={vi.fn()}
      />,
    );
    expect(markup).toContain(originalText);
    expect(markup).toContain(text);
    expect(markup).toContain(PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING);
    expect(markup).toContain("Earlier source excerpt");
    expect(markup).toContain("They do not verify this proposed wording");
    expect(markup).toContain("approved-provider / bounded-model");
    expect(markup).toContain('type="checkbox"');
    expect(markup).not.toContain('checked=""');
    expect(markup).toContain("I reviewed the complete original and proposed wording");
  });
  it("disables review while an application acknowledgement is outstanding", () => {
    const markup = renderToStaticMarkup(
      <TextAssistanceProposalReview
        proposal={proposal}
        citations={[]}
        reviewed
        disabled
        onReview={vi.fn()}
      />,
    );
    expect(markup).toMatch(/<input[^>]*disabled=""[^>]*checked=""/);
  });
  it("opens an accessible availability-first review without automatically generating", () => {
    const markup = renderToStaticMarkup(<PresentationTextAssistance {...props} />);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="text-assistance-title"');
    expect(markup).toContain("Shorten text");
    expect(markup).toContain(originalText);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Generate shorter text proposal/);
    expect(markup).toContain("Speaker notes, other objects and citation excerpts are not sent");
    expect(props.onApplied).not.toHaveBeenCalled();
  });
  it("hides private text and prevents generation after editor permission is revoked", () => {
    const markup = renderToStaticMarkup(<PresentationTextAssistance {...props} canEdit={false} />);
    expect(markup).toContain("Editor permission is required");
    expect(markup).not.toContain(originalText);
    expect(markup).not.toContain("Generate shorter text proposal");
  });
});
