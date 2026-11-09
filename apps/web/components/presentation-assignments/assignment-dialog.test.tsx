import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PresentationAssignmentButton, PresentationAssignmentDialog } from "./assignment-dialog";

describe("creator reading assignment controls", () => {
  it("requires a published version and creator edit authority", () => {
    expect(
      renderToStaticMarkup(
        <PresentationAssignmentButton
          actorKey="creator:workspace"
          presentationId="deck"
          versionId={null}
        />,
      ),
    ).toContain('disabled=""');
    expect(
      renderToStaticMarkup(
        <PresentationAssignmentButton
          actorKey="creator:workspace"
          presentationId="deck"
          versionId="version"
          disabled
        />,
      ),
    ).toContain('disabled=""');
    expect(
      renderToStaticMarkup(
        <PresentationAssignmentButton
          actorKey="creator:workspace"
          presentationId="deck"
          versionId="version"
        />,
      ),
    ).not.toContain("disabled");
  });
  it("explains the immutable published version, deadline, and reading-only evidence", () => {
    const markup = renderToStaticMarkup(
      <PresentationAssignmentDialog
        actorKey="creator:workspace"
        presentationId="deck"
        versionId="version"
        onClose={() => undefined}
      />,
    );
    expect(markup).toContain("Assign a reading assignment");
    expect(markup).toContain("Draft changes and speaker notes stay private");
    expect(markup).toContain("Reading deadline");
    expect(markup).toContain("self-reported reading completion");
    expect(markup).toContain("identity is not verified");
    expect(markup).toContain("Responses, scores and mastery are not");
  });
});
