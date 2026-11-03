import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IDEA_BOARD_MAX_ROUNDS, type IdeaBoardView } from "@openround/contracts";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { boardFixture, boardIdeaId } from "../../test-utils/idea-board";
import { WorkshopLifecycleControls, WorkshopRoundHistory } from "./workshop-lifecycle";

vi.mock("next/navigation", () => ({ usePathname: () => "/boards/example" }));

describe("workshop lifecycle", () => {
  it("offers a guarded reopen only to authorized facilitators of a closed round", () => {
    for (const status of ["collecting", "voting", "closed"] as const) {
      for (const canReopen of [false, true]) {
        const html = renderToStaticMarkup(
          withEnglishLocale(
            <WorkshopLifecycleControls
              board={{ ...boardFixture, status }}
              canReopen={canReopen}
              onReopen={async () => true}
            />,
          ),
        );
        expect(html.includes("Reopen collection")).toBe(canReopen && status === "closed");
        expect(html).not.toContain("<dialog");
      }
    }
  });
  it("explains the round cap rather than offering an unusable reopen", () => {
    const html = renderToStaticMarkup(
      withEnglishLocale(
        <WorkshopLifecycleControls
          board={{ ...boardFixture, status: "closed", roundNumber: IDEA_BOARD_MAX_ROUNDS }}
          canReopen
          onReopen={async () => true}
        />,
      ),
    );
    expect(html.match(/<button[^>]*>Reopen collection<\/button>/)?.[0]).toContain('disabled=""');
    expect(html).toContain("This workshop has reached its round limit.");
  });
  it("renders aggregate history through the deduplicated redacted idea map", () => {
    const board: IdeaBoardView = {
      ...boardFixture,
      roundNumber: 3,
      ideas: [
        { ...boardFixture.ideas[0]!, status: "pending", body: "Private intake must stay private" },
      ],
      roundHistory: [
        {
          roundNumber: 1,
          closedAt: "2026-11-03T12:00:00.000Z",
          ballotCount: 1,
          results: [{ ideaId: boardIdeaId, voteCount: 1 }],
        },
        {
          roundNumber: 2,
          closedAt: null,
          ballotCount: 2,
          results: [{ ideaId: "00000000-0000-4000-8000-000000000099", voteCount: 2 }],
        },
      ],
      roundHistoryIdeas: [
        { ideaId: boardIdeaId, body: "Previously approved idea" },
        { ideaId: "00000000-0000-4000-8000-000000000099", body: null },
      ],
    };
    const html = renderToStaticMarkup(withEnglishLocale(<WorkshopRoundHistory board={board} />));
    expect(html).toContain("Previous workshop rounds");
    expect(html).toContain("Previously approved idea");
    expect(html).toContain("Removed");
    expect(html).toContain("1 ballot");
    expect(html).toContain("1 vote");
    expect(html).toContain("2 ballots");
    expect(html).toContain("2 votes");
    expect(html).not.toContain("Private intake must stay private");
    expect(html.indexOf("Round 2")).toBeLessThan(html.indexOf("Round 1"));
  });
});
