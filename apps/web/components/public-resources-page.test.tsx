import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublicResourcePage, PublicResourcesPage } from "./public-resources-page";
import { publicResources } from "../lib/public-resources";

vi.mock("./site-header", () => ({ SiteHeader: () => <header>Public header</header> }));
vi.mock("./site-footer", () => ({ SiteFooter: () => <footer>Public footer</footer> }));

describe("public resource pages", () => {
  it("links every guide and the current public policy and status destinations", () => {
    const markup = renderToStaticMarkup(<PublicResourcesPage />);
    expect(markup).toContain('lang="en-CA"');
    for (const resource of publicResources)
      expect(markup).toContain(`href="/resources/${resource.slug}"`);
    for (const href of ["/examples", "/privacy", "/terms", "/status"])
      expect(markup).toContain(`href="${href}"`);
    expect(markup).not.toContain("mailto:");
    expect(markup).not.toContain("<form");
  });

  it("renders each full guide with working section anchors and relevant next destinations", () => {
    for (const resource of publicResources) {
      const markup = renderToStaticMarkup(<PublicResourcePage resource={resource} />);
      expect(markup).toContain('lang="en-CA"');
      expect(markup).toContain(resource.title.replaceAll("&", "&amp;"));
      resource.sections.forEach((_, index) => {
        expect(markup).toContain(`id="guide-section-${index + 1}"`);
        expect(markup).toContain(`href="#guide-section-${index + 1}"`);
      });
      resource.links.forEach((link) =>
        expect(markup).toContain(`href="${link.href.replaceAll("&", "&amp;")}"`),
      );
      expect(markup).toContain('href="/resources"');
    }
  });
});
