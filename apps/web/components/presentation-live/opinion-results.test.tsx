import type { PresentationOpinionResultSummary } from "@openround/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PresentationOpinionResults } from "./opinion-results";

const poll: PresentationOpinionResultSummary = {
  kind: "poll",
  blockId: "poll",
  responseCount: 4,
  maxSelections: 2,
  totalSelections: 7,
  choices: [
    { choiceId: "a", label: "Examples", count: 4, percentOfRespondents: 100 },
    { choiceId: "b", label: "Practice", count: 3, percentOfRespondents: 75 },
    { choiceId: "c", label: "Discussion", count: 0, percentOfRespondents: 0 },
  ],
};

const ranking: PresentationOpinionResultSummary = {
  kind: "ranking",
  blockId: "ranking",
  responseCount: 2,
  rankCount: 2,
  totalRankings: 4,
  choices: [
    {
      choiceId: "a",
      label: "Examples",
      weightedScore: 7,
      rankedRespondents: 2,
      averageRank: 1.5,
      rankCounts: [1, 1],
    },
    {
      choiceId: "b",
      label: "Practice",
      weightedScore: 4,
      rankedRespondents: 1,
      averageRank: 1,
      rankCounts: [1, 0],
    },
    {
      choiceId: "c",
      label: "Discussion",
      weightedScore: 3,
      rankedRespondents: 1,
      averageRank: 2,
      rankCounts: [0, 1],
    },
    {
      choiceId: "d",
      label: "Reflection",
      weightedScore: 0,
      rankedRespondents: 0,
      averageRank: null,
      rankCounts: [0, 0],
    },
  ],
};

function barWidths(markup: string) {
  return Array.from(
    markup.matchAll(/data-opinion-result-bar="true" style="width:([^"]+)"/g),
    (match) => match[1],
  );
}

describe("Presentation stage opinion charts", () => {
  it("shows the exact per-choice respondent shares even when they total over 100%", () => {
    const markup = renderToStaticMarkup(
      <PresentationOpinionResults summary={poll} compact showChart />,
    );
    expect(barWidths(markup)).toEqual(["100%", "75%", "0%"]);
    expect(markup).toContain("<caption>Poll selections by choice</caption>");
    expect(markup).toContain('>75%<span aria-hidden="true"');
    expect(markup).toContain("<td>3</td>");
  });

  it("uses the same maximum possible weighted points for all ranking choices", () => {
    const markup = renderToStaticMarkup(
      <PresentationOpinionResults summary={ranking} compact showChart />,
    );
    expect(barWidths(markup)).toEqual(["87.5%", "50%", "37.5%", "0%"]);
    expect(markup).toContain('<th scope="col">Weighted points</th>');
    expect(markup).toContain('>7<span aria-hidden="true"');
  });

  it("makes zero-response charts static at zero and requires explicit chart opt-in", () => {
    const summary = {
      ...ranking,
      responseCount: 0,
      totalRankings: 0,
      choices: ranking.choices.map((choice) => ({
        ...choice,
        weightedScore: 0,
        rankedRespondents: 0,
        averageRank: null,
        rankCounts: [0, 0],
      })),
    };
    const markup = renderToStaticMarkup(
      <PresentationOpinionResults summary={summary} compact showChart />,
    );
    expect(barWidths(markup)).toEqual(["0%", "0%", "0%", "0%"]);
    expect(markup).toContain("No responses were recorded.");
    expect(
      renderToStaticMarkup(<PresentationOpinionResults summary={ranking} compact />),
    ).not.toContain("data-opinion-result-bar");
  });
});
