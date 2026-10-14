import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../test-utils/english-locale";
import { ResponseDistributionView } from "./response-distribution";

vi.mock("next/navigation", () => ({
  usePathname: () => "/host/test-session",
}));

describe("ResponseDistributionView", () => {
  it("shows ranking weights and respondent counts in an accessible table, including unranked options", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ResponseDistributionView
          distribution={{
            kind: "ranking",
            respondents: 5,
            rankCount: 2,
            totalRankings: 10,
            buckets: [
              {
                value: "a",
                label: "Priority A",
                weightedScore: 15,
                rankedRespondents: 5,
                averageRank: 1,
              },
              {
                value: "b",
                label: "Priority B",
                weightedScore: 10,
                rankedRespondents: 5,
                averageRank: 2,
              },
              {
                value: "c",
                label: "Priority C",
                weightedScore: 0,
                rankedRespondents: 0,
                averageRank: null,
              },
            ],
          }}
        />,
      ),
    );
    expect(markup).toContain("5 respondents · each ranked 2 choices.");
    expect(markup).toContain("First place earns 3 points");
    expect(markup).toContain('<th scope="col">Weighted score</th>');
    expect(markup).toContain('<th scope="col">Average rank</th>');
    expect(markup).toContain(
      '<th scope="row" lang="">Priority C</th><td>0</td><td>0</td><td>—</td>',
    );
    expect(markup).not.toContain("% correct");
  });
  it("labels multi-select percentages by respondents", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ResponseDistributionView
          distribution={{
            kind: "choice",
            respondents: 5,
            totalSelections: 4,
            percentBasis: "respondents",
            buckets: [{ value: "choice-1", label: "Option A", count: 4, percent: 80 }],
          }}
        />,
      ),
    );
    expect(markup).toContain("percent of respondents");
    expect(markup).toContain('<span lang="">Option A</span>');
  });

  it("keeps numeric evidence aggregate-only", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ResponseDistributionView
          distribution={{ kind: "numeric", respondents: 5, correct: 3, incorrect: 2 }}
        />,
      ),
    );
    expect(markup).toContain("3 correct");
    expect(markup).toContain("2 incorrect");
    expect(markup).toContain("60% correct");
  });
});
