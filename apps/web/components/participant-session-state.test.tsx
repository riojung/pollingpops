import type { SessionSnapshot } from "@openround/contracts";
import { supportedLocales } from "@openround/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../test-utils/english-locale";
import { liveWorkflowCopy } from "../lib/i18n/live-workflow-copy";
import { ParticipantCompletion, ParticipantSessionState } from "./participant-session-state";

vi.mock("next/navigation", () => ({ usePathname: () => "/play/test-session" }));

function snapshot(summary?: SessionSnapshot["myScoredResponseSummary"]) {
  return {
    phase: "finished",
    roundKind: "main",
    myScoredResponseSummary: summary,
  } as SessionSnapshot;
}

describe("participant session clarity", () => {
  it("acknowledges an opinion session without implying a score of zero", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ParticipantCompletion
          snapshot={snapshot({
            answeredScoredQuestions: 0,
            correctScoredQuestions: 0,
            revealedScoredQuestions: 0,
          })}
          score={0}
        />,
      ),
    );
    expect(markup).toContain("Your accepted responses were recorded");
    expect(markup).not.toContain("score");
  });

  it("preserves a real score of zero when revealed questions were scored", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ParticipantCompletion
          snapshot={snapshot({
            answeredScoredQuestions: 1,
            correctScoredQuestions: 0,
            revealedScoredQuestions: 2,
          })}
          score={0}
        />,
      ),
    );
    expect(markup).toContain("Your final score is 0.");
  });

  it("does not infer assessment from missing legacy history", () => {
    expect(
      renderToStaticMarkup(
        withEnglishLocale(<ParticipantCompletion snapshot={snapshot()} score={0} />),
      ),
    ).not.toContain("score");
    expect(
      renderToStaticMarkup(
        withEnglishLocale(<ParticipantCompletion snapshot={snapshot()} score={1000} />),
      ),
    ).toContain("final score");
  });

  it("does not invent a score of zero before the participant's own score is available", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ParticipantCompletion
          snapshot={snapshot({
            answeredScoredQuestions: 1,
            correctScoredQuestions: 1,
            revealedScoredQuestions: 1,
          })}
        />,
      ),
    );
    expect(markup).not.toContain("final score");
    expect(markup).toContain("accepted responses were recorded");
  });

  it("shows only the immediate accepted state rather than a required seven-step process", () => {
    const state = { ...snapshot(), phase: "question_open" } as SessionSnapshot;
    const markup = renderToStaticMarkup(
      withEnglishLocale(<ParticipantSessionState snapshot={state} saved />),
    );
    expect(markup).toContain("Answer received");
    expect(markup).not.toContain("Answer received and saved.");
    expect(markup).not.toContain("<ol");
    expect(markup).not.toContain("Discussion in progress");
    const recheckMarkup = renderToStaticMarkup(
      withEnglishLocale(
        <ParticipantSessionState snapshot={{ ...state, roundKind: "linked_recheck" }} saved />,
      ),
    );
    expect(recheckMarkup).toContain("Answer received");
    expect(recheckMarkup).not.toContain("Recheck in progress");
  });

  it("provides each workflow meaning in every supported locale", () => {
    const keys = Object.keys(liveWorkflowCopy("en-CA")).sort();
    for (const locale of supportedLocales) {
      expect(Object.keys(liveWorkflowCopy(locale)).sort()).toEqual(keys);
      for (const value of Object.values(liveWorkflowCopy(locale)))
        expect(value?.trim()).toBeTruthy();
      expect(liveWorkflowCopy(locale).finalScore).toContain("{score}");
    }
  });
});
