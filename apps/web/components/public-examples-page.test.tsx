import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublicExamplePreview, PublicExamplesPage } from "./public-examples-page";
import { publicExamples } from "../lib/public-examples";

vi.mock("./site-header", () => ({ SiteHeader: () => <header>Public header</header> }));
vi.mock("./site-footer", () => ({ SiteFooter: () => <footer>Public footer</footer> }));

describe("public example previews", () => {
  it("renders a filterable catalog and a substantial read-only preview without private API data", () => {
    const markup = renderToStaticMarkup(<PublicExamplesPage />);
    expect(markup).toContain('lang="en-CA"');
    expect(markup).toContain("9 examples");
    expect(markup).toContain("Search examples");
    expect(markup).toContain("All formats");
    expect(markup).toContain("All use cases");
    expect(markup).toContain("Where should we focus today’s discussion?");
    expect(markup).toContain("A decision waiting on us");
    expect(markup).toContain("Prepare");
    expect(markup).toContain("Previewing creates no content");
    expect(markup).not.toContain("/v1/");
    expect(markup).not.toContain("<form");
  });

  it("opens a linked example and applies product-page format and use-case context", () => {
    const selected = renderToStaticMarkup(
      <PublicExamplesPage initialExampleId="retrospective-presentation" />,
    );
    expect(selected).toContain('id="example-title">Retrospective to action');
    expect(selected).toContain("Turn an observation into an experiment");
    const filtered = renderToStaticMarkup(
      <PublicExamplesPage initialKind="survey" initialUseCase="events" />,
    );
    expect(filtered).toContain("1 example");
    expect(filtered).toContain("How useful was this event for the goal you brought?");
    expect(filtered).not.toContain("Where should we focus today’s discussion?");
  });

  it("keeps every preview non-interactive and uses honest canonical continuation labels", () => {
    for (const example of publicExamples) {
      const markup = renderToStaticMarkup(<PublicExamplePreview example={example} />);
      expect(markup).toContain("Read-only preview");
      expect(markup).toContain("signing in");
      expect(markup).not.toMatch(/<(input|textarea|form)\b/u);
      expect(markup).toContain(
        example.kind === "board" ? "Open board starters" : "Open in Templates",
      );
      expect(markup).not.toContain(">Use this template<");
    }
  });
});
