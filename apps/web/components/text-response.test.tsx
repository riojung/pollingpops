import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../test-utils/english-locale";
import { TextResponseControl } from "./text-response-control";
import { TextResultsView } from "./text-results-view";
import { TextModerationPanel } from "./text-moderation-panel";

vi.mock("next/navigation", () => ({ usePathname: () => "/play/test-session" }));

describe("text response views", () => {
  it("labels text input with the normalized counter and moderation privacy guidance", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<TextResponseControl type="open_text" value={" e\u0301 "} />),
    );
    expect(markup).toContain("Your response");
    expect(markup).toContain("1 of 1000 characters");
    expect(markup).toContain("aria-describedby=");
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain("Only approved responses can appear publicly after reveal");
    expect(markup).toContain("<textarea");
    // HTML maxLength would reject decomposed text whose normalized value fits.
    expect(markup).not.toContain("maxLength=");
  });

  it("renders approved text literally without HTML interpretation", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <TextResultsView
          type="open_text"
          respondents={5}
          items={[{ answerId: "a", body: '<script>alert("x")</script>' }]}
        />,
      ),
    );
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("5 approved respondents");
  });

  it("uses server groups and counts verbatim in an accessible count table", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <TextResultsView
          type="word_cloud"
          respondents={5}
          terms={[
            { value: "café", label: "café", count: 4 },
            { value: "practice", label: "practice", count: 1 },
          ]}
        />,
      ),
    );
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("<caption>Word-cloud counts</caption>");
    expect(markup).toContain('scope="row" lang="">café</th><td>4</td>');
    expect(markup).toContain('scope="row" lang="">practice</th><td>1</td>');
  });

  it("does not fetch or offer any moderation action after finish", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <TextModerationPanel
          sessionId="room"
          version={1}
          phase="finished"
          credential=""
          disabled
          onModerate={() => undefined}
        />,
      ),
    );
    expect(markup).toContain("Text responses can no longer be moderated");
    expect(markup).not.toContain("Approve response");
    expect(markup).not.toContain("Remove response");
  });
});
