import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AggregateSessionSummarySchema } from "@openround/contracts";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { summaryFixture, summarySource } from "../../test-utils/session-summary";
import { SessionSummaryView } from "./summary-view";
import { SessionSummaryDownloads } from "./summary-downloads";
import { PublicSessionSummary } from "./public-summary";
import { metadata } from "../../app/summary/[id]/page";

vi.mock("next/navigation", () => ({ usePathname: () => "/summary/example" }));

describe("aggregate summary presentation", () => {
  it("renders accessible respondent tables, opinion caveats and paired recovery", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<SessionSummaryView summary={summaryFixture} />),
    );
    expect(markup).toContain("<h1");
    expect(markup).toContain("<caption>Respondent counts</caption>");
    expect(markup).toContain('scope="row"');
    expect(markup).toContain("Opinion feedback · Not scored");
    expect(markup).toContain("totals may exceed the respondent count");
    expect(markup).toContain("3 of 5 eligible pairs recovered");
    expect(markup).toContain("Participant-written text is excluded");
    expect(markup).not.toContain("participantId");
  });
  it("escapes authored markup and preserves bidirectional plain text", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <SessionSummaryView
          summary={{
            ...summaryFixture,
            title: "<script>unsafe()</script>",
            nextSteps: "<img onerror=unsafe()>",
          }}
        />,
      ),
    );
    expect(markup).toContain("&lt;script&gt;unsafe()&lt;/script&gt;");
    expect(markup).toContain("&lt;img onerror=unsafe()&gt;");
    expect(markup).toContain('dir="auto" lang=""');
    expect(markup).not.toContain("<script>");
  });
  it("distinguishes linked rechecks from revotes with the same authored label and preserves each sample", () => {
    const summary = AggregateSessionSummarySchema.parse({
      ...summaryFixture,
      recovery: [
        { kind: "linked", label: "Same authored prompt", eligible: 5, recovered: 3, percent: 60 },
        { kind: "revote", label: "Same authored prompt", eligible: 6, recovered: 5, percent: 83.3 },
      ],
    });
    const markup = renderToStaticMarkup(
      withEnglishLocale(<SessionSummaryView summary={summary} />),
    );
    const visibleText = markup.replace(/<[^>]+>/g, "");
    expect(visibleText).toContain(
      "Linked recheck · Same authored prompt · 3 of 5 eligible pairs recovered (60%)",
    );
    expect(visibleText).toContain(
      "Revote · Same authored prompt · 5 of 6 eligible pairs recovered (83.3%)",
    );
  });
  it("gives same-prompt question result regions distinct accessible names by source position", () => {
    const question = summaryFixture.questions[0]!;
    const summary = AggregateSessionSummarySchema.parse({
      ...summaryFixture,
      questions: [
        { ...question, index: 0, prompt: "Same authored question" },
        { ...question, index: 1, prompt: "Same authored question" },
      ],
    });
    const markup = renderToStaticMarkup(
      withEnglishLocale(<SessionSummaryView summary={summary} />),
    );
    expect(markup).toContain(
      'role="region" aria-label="Question 1 results: Same authored question"',
    );
    expect(markup).toContain(
      'role="region" aria-label="Question 2 results: Same authored question"',
    );
    expect(markup).not.toContain('role="region" aria-label="Question results"');
  });
  it("counts Presentation content and opinion checkpoints without calling the total questions", () => {
    const summary = AggregateSessionSummarySchema.parse({
      ...summaryFixture,
      kind: "presentation",
      initialAccuracy: null,
      recovery: [],
      questions: [
        {
          ...summaryFixture.questions[1]!,
          index: 0,
          prompt: "Authored content slide",
          type: "content",
          purpose: "content",
          suppression: "unavailable",
        },
        { ...summaryFixture.questions[0]!, index: 1 },
      ],
    });
    const markup = renderToStaticMarkup(
      withEnglishLocale(<SessionSummaryView summary={summary} />),
    );
    expect(markup).toContain("<dt>Checkpoints</dt><dd>2</dd>");
    expect(markup).toContain("Content slide · Not assessed");
    expect(markup).not.toContain("<dt>Questions</dt>");
  });
  it("suppressed samples contain no evidence tables or invented zero accuracy", () => {
    const question = {
      ...summaryFixture.questions[0]!,
      respondents: null,
      suppression: "insufficient_sample" as const,
      results: [],
    };
    const summary = AggregateSessionSummarySchema.parse({
      ...summaryFixture,
      initialAccuracy: null,
      recovery: [],
      questions: [question],
      noteCodes: ["aggregate_only", "insufficient_sample", "no_scored_evidence"],
    });
    const markup = renderToStaticMarkup(
      withEnglishLocale(<SessionSummaryView summary={summary} />),
    );
    expect(markup).toContain("hidden below five respondents");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("0%");
  });
  it("uses only server-provided download permissions", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <SessionSummaryDownloads
          access={{ source: summarySource }}
          summary={summaryFixture}
          formats={["pdf"]}
        />,
      ),
    );
    expect(markup).toContain("Download PDF");
    expect(markup).not.toContain("Download spreadsheet");
    expect(markup).not.toContain("Download image");
    const unavailable = renderToStaticMarkup(
      withEnglishLocale(
        <SessionSummaryDownloads
          access={{ source: summarySource }}
          summary={summaryFixture}
          formats={[]}
        />,
      ),
    );
    expect(unavailable).toContain("Downloads are not available");
    expect(unavailable).not.toContain("<button");
  });
  it("labels the image selector separately from its authored option text", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <SessionSummaryDownloads
          access={{ source: summarySource }}
          summary={summaryFixture}
          formats={["png"]}
        />,
      ),
    );
    const label = markup.match(/<label for="([^"]+)">Image content<\/label>/);
    expect(label).not.toBeNull();
    expect(markup).toContain(`<select id="${label![1]}"`);
    expect(markup).toContain(summaryFixture.questions[0]!.prompt);
  });
  it("keeps public SSR and metadata generic before the fragment is read", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<PublicSessionSummary shareId={summarySource.id} />),
    );
    expect(markup).toContain("Loading summary");
    expect(markup).not.toContain(summaryFixture.title);
    expect(markup).not.toContain("token");
    expect(metadata).toMatchObject({
      referrer: "no-referrer",
      robots: { index: false, follow: false },
    });
    expect(JSON.stringify(metadata)).not.toContain(summaryFixture.title);
  });
});
