import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PresentationReviewQuestion,
  presentationReviewBlockTitle,
  PresentationReviewImageFallback,
} from "./review-page";
import { PresentationShareButton } from "./share-dialog";
describe("private Presentation review surfaces", () => {
  it("offers an explicit image retry for transient failures after bounded automatic attempts", () => {
    expect(
      renderToStaticMarkup(
        <PresentationReviewImageFallback failed retryable onRetry={() => undefined} />,
      ),
    ).toContain("Retry image");
    expect(
      renderToStaticMarkup(
        <PresentationReviewImageFallback failed retryable={false} onRetry={() => undefined} />,
      ),
    ).not.toContain("Retry image");
    expect(
      renderToStaticMarkup(
        <PresentationReviewImageFallback failed={false} retryable onRetry={() => undefined} />,
      ),
    ).toContain("Loading image…");
  });
  it("shows question content without answer inputs or submission controls", () => {
    const block = {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "question" as const,
      question: {
        type: "poll" as const,
        prompt: "Which signal?",
        mediaId: null,
        mediaAlt: null,
        choices: [
          { id: "a", label: "Evidence" },
          { id: "b", label: "Volume" },
        ],
      },
    };
    const markup = renderToStaticMarkup(<PresentationReviewQuestion block={block} />);
    expect(markup).toContain("Evidence");
    expect(markup).toContain("Responses are not collected");
    expect(markup).not.toMatch(/<input|<textarea|<form|Submit|correctValue/);
    expect(presentationReviewBlockTitle(block, 0)).toBe("Which signal?");
  });
  it("requires a published version and edit authority before offering link creation", () => {
    expect(
      renderToStaticMarkup(<PresentationShareButton presentationId="one" versionId={null} />),
    ).toContain('disabled=""');
    expect(
      renderToStaticMarkup(
        <PresentationShareButton presentationId="one" versionId="version" disabled />,
      ),
    ).toContain('disabled=""');
    expect(
      renderToStaticMarkup(<PresentationShareButton presentationId="one" versionId="version" />),
    ).not.toContain("disabled");
  });
});
