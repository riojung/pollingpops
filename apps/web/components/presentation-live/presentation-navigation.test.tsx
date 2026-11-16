import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PresentationNavigationSnapshot } from "@openround/contracts";
import { PresentationNavigationDialog } from "./presentation-navigation";

const navigation: PresentationNavigationSnapshot = {
  entries: [
    {
      blockId: "current",
      title: "Current activity",
      kind: "question",
      sectionId: "a",
      sectionTitle: "Opening",
      status: "current",
      phase: "question_open",
      canJump: false,
      blockedReason: "Already current.",
    },
    {
      blockId: "review",
      title: "<Saved activity>",
      kind: "question",
      sectionId: "a",
      sectionTitle: "Opening",
      status: "visited",
      phase: "question_reveal",
      canJump: false,
      blockedReason: "Close the current question first.",
    },
    {
      blockId: "future",
      title: "Closing slide",
      kind: "content",
      sectionId: "b",
      sectionTitle: "Next steps",
      status: "not_visited",
      phase: null,
      canJump: false,
      blockedReason: "Close the current question first.",
    },
  ],
  returnTarget: { blockId: "anchor", title: "Original path" },
  canReturn: false,
  blockedReason: "Close the current question first.",
};

describe("Staff presentation navigation", () => {
  it("renders authoritative status and phase guards with an explicit return target", () => {
    const markup = renderToStaticMarkup(
      <PresentationNavigationDialog
        navigation={navigation}
        disabled={false}
        onJump={() => undefined}
        onReturn={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(markup).toContain('aria-label="Presentation navigation"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain("Activity · Visited · Review");
    expect(markup).toContain("Slide · Not visited");
    expect(markup).not.toContain("Skipped");
    expect(markup).toContain("&lt;Saved activity&gt;");
    expect(markup).toContain("Return target:");
    expect(markup).toContain("Return to path:");
    expect(markup).toContain("Close navigation");
    expect(markup.match(/disabled=""/g)).toHaveLength(4);
    expect(markup.match(/>Opening</g)).toHaveLength(1);
  });
});
