import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { boardFixture } from "../../test-utils/idea-board";
import { BoardAnalytics } from "./board-analytics";

vi.mock("next/navigation", () => ({ usePathname: () => "/boards/example" }));

describe("Board analytics", () => {
  it.each([
    ["voting", true, "Vote totals are available after this round closes."],
    ["closed", false, "Vote totals are unavailable for this round."],
  ] as const)(
    "shows no chart or metrics when the current round is %s",
    (status, countsVisible, notice) => {
      const board = {
        ...boardFixture,
        status,
        countsVisible,
        ideas: [{ ...boardFixture.ideas[0]!, voteCount: 2 }],
      };
      const html = renderToStaticMarkup(withEnglishLocale(<BoardAnalytics board={board} />));
      expect(html).toContain(notice);
      expect(html).not.toContain("Votes cast");
      expect(html).not.toContain(board.ideas[0]!.body);
      expect(html).not.toContain("<table");
    },
  );

  it("renders released counts and labelled vote shares without aliases", () => {
    const first = { ...boardFixture.ideas[0]!, alias: "First private alias", voteCount: 1 };
    const second = {
      ...first,
      id: `${first.id.slice(0, -1)}8`,
      body: "Top priority",
      voteCount: 3,
    };
    const board = {
      ...boardFixture,
      status: "closed" as const,
      countsVisible: true,
      ideas: [first, second],
    };
    const html = renderToStaticMarkup(withEnglishLocale(<BoardAnalytics board={board} />));
    expect(html).toContain("Votes cast</dt><dd>4</dd>");
    expect(html).toContain("Ideas with votes</dt><dd>2</dd>");
    expect(html).toContain("Shares use all votes cast in this round.");
    expect(html).toContain("width:75%");
    expect(html).toContain("width:25%");
    expect(html.indexOf("Top priority")).toBeLessThan(html.indexOf(first.body!));
    expect(html).not.toContain(first.alias);
  });

  it("distinguishes one vote from zero at the maximum total", () => {
    const idea = boardFixture.ideas[0]!;
    const counts = [...Array<number>(9).fill(250), 249, 1, 0];
    const board = {
      ...boardFixture,
      status: "closed" as const,
      countsVisible: true,
      voteBudget: 10,
      participantCount: 250,
      ideas: counts.map((voteCount, index) => ({
        ...idea,
        id: `${idea.id.slice(0, -2)}${String(index + 1).padStart(2, "0")}`,
        body: `Priority ${index + 1}`,
        voteCount,
      })),
    };
    const html = renderToStaticMarkup(withEnglishLocale(<BoardAnalytics board={board} />));
    expect(html).toContain("Votes cast</dt><dd>2,500</dd>");
    expect(html).toContain("Priority 11</span></th><td>1</td><td>0.04%");
    expect(html).toContain("Priority 12</span></th><td>0</td><td>0%");
  });

  it("keeps zero counts visible without rendering a percentage for zero total votes", () => {
    const board = {
      ...boardFixture,
      status: "closed" as const,
      countsVisible: true,
      ideas: [{ ...boardFixture.ideas[0]!, voteCount: 0 }],
    };
    const html = renderToStaticMarkup(withEnglishLocale(<BoardAnalytics board={board} />));
    expect(html).toContain("No votes were cast in this round.");
    expect(html).toContain("Votes cast</dt><dd>0</dd>");
    expect(html).toContain("</th><td>0</td><td>—</td>");
    expect(html).not.toContain("width:");
  });
});
