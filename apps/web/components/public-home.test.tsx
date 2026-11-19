import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicHome } from "./public-home";
import { getPublicProductPage, getPublicSolutionPage } from "../lib/public-product-content";
import { getPublicResource } from "../lib/public-resources";

describe("public product-led homepage", () => {
  it("renders its product story and real public destinations before hydration", () => {
    const markup = renderToStaticMarkup(<PublicHome />);
    expect(markup).toContain("Make every voice pop.");
    expect(markup).toContain('id="how-it-works"');
    expect(markup).toContain("Illustrative example");
    expect(markup).toContain("does not prove lasting learning");
    expect(markup).toContain('lang="en-CA"');
    expect(markup).not.toContain('href="/help"');
    expect(markup).not.toContain('href="/templates"');
    expect(markup).not.toContain('id="join-title"');
    for (const [, href] of markup.matchAll(/href="([^"?#]+)[^"]*"/g)) {
      if (!href) continue;
      if (href.startsWith("/product/"))
        expect(getPublicProductPage(href.split("/")[2]!), href).toBeDefined();
      if (href.startsWith("/solutions/"))
        expect(getPublicSolutionPage(href.split("/")[2]!), href).toBeDefined();
      if (href.startsWith("/resources/"))
        expect(getPublicResource(href.split("/")[2]!), href).toBeDefined();
    }
  });
});
