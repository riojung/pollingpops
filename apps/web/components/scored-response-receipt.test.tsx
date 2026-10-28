import type { SessionSnapshot } from "@openround/contracts";
import { supportedLocales } from "@openround/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { scoredResponseCopy } from "../lib/i18n/scored-response-copy";
import { withEnglishLocale } from "../test-utils/english-locale";
import { ScoredResponseReceipt } from "./scored-response-receipt";

vi.mock("next/navigation", () => ({ usePathname: () => "/play/test-session" }));

function render(responseSummary?: SessionSnapshot["myScoredResponseSummary"]) {
  return renderToStaticMarkup(
    withEnglishLocale(<ScoredResponseReceipt responseSummary={responseSummary} />),
  );
}

describe("own scored response receipt", () => {
  it("makes no answer claims before results are revealed or when history is unknown", () => {
    expect(render()).toBe("");
    expect(
      render({
        answeredScoredQuestions: 0,
        correctScoredQuestions: 0,
        revealedScoredQuestions: 0,
      }),
    ).toBe("");
  });

  it("distinguishes no saved answer from a saved incorrect answer", () => {
    const unsaved = render({
      answeredScoredQuestions: 0,
      correctScoredQuestions: 0,
      revealedScoredQuestions: 2,
      lastResponseStatus: "unanswered",
    });
    expect(unsaved).toContain("No answer was saved for the revealed scored questions.");
    expect(unsaved).toContain("0 / 2");
    expect(unsaved).not.toContain("were not correct");

    const incorrect = render({
      answeredScoredQuestions: 1,
      correctScoredQuestions: 0,
      revealedScoredQuestions: 2,
      lastResponseStatus: "incorrect",
    });
    expect(incorrect).toContain(
      "Your saved answers to the revealed scored questions were not correct.",
    );
    expect(incorrect).toContain("1 / 2");
    expect(incorrect).not.toContain("No answer was saved");
  });

  it("reports the participant's accepted and correct counts with an explicit release scope", () => {
    const markup = render({
      answeredScoredQuestions: 3,
      correctScoredQuestions: 2,
      revealedScoredQuestions: 4,
    });
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Your saved answers"');
    expect(markup).toContain("Revealed scored questions only.");
    expect(markup).toContain("3 / 4");
    expect(markup).toContain("<dt>Correct</dt><dd>2</dd>");
    expect(markup).not.toContain("No answer was saved");
    expect(markup).not.toContain("were not correct");
    expect(markup).not.toContain("points");
  });

  it("provides the same receipt meanings in every supported locale", () => {
    expect(Object.keys(scoredResponseCopy).sort()).toEqual([...supportedLocales].sort());
    const keys = Object.keys(scoredResponseCopy["en-CA"]).sort();
    for (const locale of supportedLocales) {
      expect(Object.keys(scoredResponseCopy[locale]).sort()).toEqual(keys);
      for (const value of Object.values(scoredResponseCopy[locale]))
        expect(value.trim()).not.toBe("");
    }
  });
});
