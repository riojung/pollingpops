import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../test-utils/english-locale";
import { RankingChoices } from "./ranking-choices";

vi.mock("next/navigation", () => ({ usePathname: () => "/play/test-session" }));
const question = {
  choices: ["a", "b", "c"].map((id) => ({ id, label: `Priority ${id.toUpperCase()}` })),
};

describe("RankingChoices", () => {
  it("provides labelled keyboard move controls and announces order without a drag requirement", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<RankingChoices question={question} selectedChoiceIds={["c", "a", "b"]} />),
    );
    expect(markup).toContain("Rank 3 of 3 choices. First is the highest priority.");
    expect(markup).toContain('aria-label="Move Priority C down"');
    expect(markup).toContain('aria-label="Move Priority A up"');
    expect(markup).toContain("Current order: Priority C, Priority A, Priority B");
    expect(markup).not.toContain("Remove Priority");
    expect(markup).not.toContain('draggable="true"');
    expect(markup.indexOf('<strong lang="">Priority C')).toBeLessThan(
      markup.indexOf('<strong lang="">Priority A'),
    );
  });

  it("offers selection and removal for top-N rankings with an enforced ceiling", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <RankingChoices question={{ ...question, rankCount: 2 }} selectedChoiceIds={["c", "a"]} />,
      ),
    );
    expect(markup).toContain('aria-label="Remove Priority C from ranking"');
    expect(markup).toMatch(/disabled="" aria-label="Add Priority B to ranking"/);
    expect(markup).toContain("2 of 2 choices ranked.");
  });

  it("renders a saved ranking in its durable order with all controls disabled", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <RankingChoices question={question} selectedChoiceIds={["b", "a", "c"]} disabled />,
      ),
    );
    expect(markup).toContain('<fieldset disabled=""');
    expect(markup.indexOf('<strong lang="">Priority B')).toBeLessThan(
      markup.indexOf('<strong lang="">Priority A'),
    );
  });
});
