import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  practiceAnswer,
  practiceIds as ids,
  practicePreview,
} from "../../test-utils/presentation-practice";
import { PracticeQuestion } from "./practice-page";
import { PresentationPracticeButton, PresentationPracticeDialog } from "./practice-dialog";
import { PracticeInsightCounts } from "./practice-insights";

describe("practice controls and personal feedback", () => {
  it("shows no correctness or authored feedback before the accepted answer and renders authored feedback as text", () => {
    const block = practicePreview().review.blocks[0]!;
    if (block.kind !== "question") throw new Error("Question fixture required");
    const preview = renderToStaticMarkup(
      <PracticeQuestion
        block={block}
        answer={undefined}
        active={false}
        disabled={false}
        onSubmit={() => undefined}
      />,
    );
    expect(preview).toContain("Preview only");
    expect(preview).not.toContain("Correct answer:");
    expect(preview).not.toContain("Submit answer");
    const active = renderToStaticMarkup(
      <PracticeQuestion
        block={block}
        answer={undefined}
        active
        disabled={false}
        onSubmit={() => undefined}
      />,
    );
    expect(active).toContain("Submit answer");
    expect(active).toContain("Your submitted answer is final");
    expect(active).not.toContain("Correct answer:");
    const answer = practiceAnswer();
    answer.feedback.explanation = '<img src="https://untrusted.test">';
    const accepted = renderToStaticMarkup(
      <PracticeQuestion
        block={block}
        answer={answer}
        active
        disabled={false}
        onSubmit={() => undefined}
      />,
    );
    expect(accepted).toContain("Correct answer: Correct public choice");
    expect(accepted).toContain("Selected personal feedback");
    expect(accepted).toContain("&lt;img");
    expect(accepted).not.toContain('<img src="https://untrusted');
    expect(accepted).not.toContain("Submit answer");
  });
  it("requires a publication and edit authority; explains supported checks and immutable submissions", () => {
    const props = {
      actorKey: "actor:workspace",
      presentationId: ids.presentation,
      versionId: ids.version,
    };
    expect(
      renderToStaticMarkup(<PresentationPracticeButton {...props} versionId={null} />),
    ).toContain('disabled=""');
    expect(renderToStaticMarkup(<PresentationPracticeButton {...props} disabled />)).toContain(
      'disabled=""',
    );
    const dialog = renderToStaticMarkup(
      <PresentationPracticeDialog {...props} onClose={() => undefined} />,
    );
    expect(dialog).toContain("Assign self-paced practice");
    expect(dialog).toContain("Draft changes and speaker notes stay private");
    expect(dialog).toContain("1–50 visible pages");
    expect(dialog).toContain("1–25 ordinary single-choice");
    expect(dialog).toContain("identity is not verified");
    expect(dialog).toContain("Practice deadline");
  });
  it("preserves suppressed counts in creator presentation without inventing grades", () => {
    const markup = renderToStaticMarkup(
      <PracticeInsightCounts
        report={{
          schemaVersion: 1,
          assignment: practicePreview().assignment,
          generatedAt: new Date().toISOString(),
          minimumAttempts: 5,
          startedAttempts: null,
          completedAttempts: null,
          inProgressAttempts: null,
        }}
      />,
    );
    expect(markup.match(/Suppressed/g)).toHaveLength(3);
    expect(markup).not.toContain("correct");
    expect(markup).not.toContain("<dd>0</dd>");
  });
});
