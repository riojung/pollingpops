import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PUBLIC_PRODUCT_CTA_HREF,
  getPublicProductPage,
  getPublicSolutionPage,
  publicProductNavigation,
  publicProductPages,
  publicSolutionNavigation,
  publicSolutionPages,
} from "../lib/public-product-content";

vi.mock("./site-header", () => ({ SiteHeader: () => <header>Public navigation</header> }));
vi.mock("./site-footer", () => ({ SiteFooter: () => <footer>Public footer</footer> }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("PUBLIC_PAGE_NOT_FOUND");
  },
}));

import {
  ProductFeaturePage,
  ProductOverviewPage,
  PublicContentNotFound,
  SolutionDetailPage,
  SolutionsOverviewPage,
} from "./public-product-pages";
import ProductRoute, {
  generateMetadata as productMetadata,
  generateStaticParams as productParams,
} from "../app/product/[slug]/page";
import SolutionRoute, {
  generateMetadata as solutionMetadata,
  generateStaticParams as solutionParams,
} from "../app/solutions/[slug]/page";

describe("public product discovery", () => {
  it("keeps product and solution navigation connected to public pages", () => {
    expect(publicProductNavigation).toHaveLength(10);
    expect(publicSolutionNavigation).toHaveLength(4);
    for (const item of publicProductNavigation) {
      expect(getPublicProductPage(item.slug)?.title).toBe(item.title);
      expect(item.href).toBe(`/product/${item.slug}`);
    }
    for (const item of publicSolutionNavigation) {
      expect(getPublicSolutionPage(item.slug)?.title).toBe(item.title);
      expect(item.href).toBe(`/solutions/${item.slug}`);
    }
    for (const page of publicProductPages) {
      for (const related of page.relatedSlugs) {
        expect(getPublicProductPage(related), `${page.slug} → ${related}`).toBeDefined();
        expect(related).not.toBe(page.slug);
      }
    }
  });

  it("sends creator calls to action through signup with a safe creation return path", () => {
    const destination = new URL(PUBLIC_PRODUCT_CTA_HREF, "https://polling-pops.invalid");
    expect(destination.pathname).toBe("/signin");
    expect(destination.searchParams.get("mode")).toBe("signup");
    expect(destination.searchParams.get("returnTo")).toBe("/create");
  });

  it("renders both overview indexes with links to every editorial page", () => {
    const product = renderToStaticMarkup(<ProductOverviewPage />);
    const solutions = renderToStaticMarkup(<SolutionsOverviewPage />);
    for (const item of publicProductNavigation) expect(product).toContain(`href="${item.href}"`);
    for (const item of publicSolutionNavigation) expect(solutions).toContain(`href="${item.href}"`);
    expect(product).toContain('id="main" lang="en-CA"');
    expect(solutions).toContain('id="main" lang="en-CA"');
  });
});

describe("public feature pages", () => {
  it.each(publicProductPages)(
    "renders $slug with a complete public workflow and repeated CTA",
    (page) => {
      const markup = renderToStaticMarkup(<ProductFeaturePage page={page} />);
      expect(markup).toContain("Public navigation");
      expect(markup).toContain("Public footer");
      expect(markup).toContain('id="main" lang="en-CA"');
      expect(markup.match(/<h1>/g)).toHaveLength(1);
      expect(markup).toContain('id="workflow-title"');
      expect(markup).toContain('id="details-title"');
      expect(markup).toContain('id="use-cases-title"');
      expect(markup).toContain('id="faq-title"');
      expect(markup.match(/<details>/g)).toHaveLength(page.faqs.length);
      expect(markup.match(/href="\/signin\?mode=signup&amp;returnTo=%2Fcreate"/g)).toHaveLength(2);
      expect(markup).toContain(`href="${page.examplesHref.replaceAll("&", "&amp;")}"`);
      expect(markup).toContain("Availability");
    },
  );

  it("generates metadata and route parameters for every published feature", async () => {
    expect(productParams()).toEqual(publicProductPages.map(({ slug }) => ({ slug })));
    for (const page of publicProductPages) {
      const props = { params: Promise.resolve({ slug: page.slug }) };
      const metadata = await productMetadata(props);
      expect(metadata.title).toBe(page.title);
      expect(metadata.alternates?.canonical).toBe(`/product/${page.slug}`);
      expect(renderToStaticMarkup(await ProductRoute(props))).toContain('id="details-title"');
    }
  });

  it.each(["missing-feature", "__proto__", "toString", "LIVE-POLLS"])(
    "returns not-found for unknown feature %s in content and metadata",
    async (slug) => {
      expect(getPublicProductPage(slug)).toBeUndefined();
      await expect(ProductRoute({ params: Promise.resolve({ slug }) })).rejects.toThrow(
        "PUBLIC_PAGE_NOT_FOUND",
      );
      await expect(productMetadata({ params: Promise.resolve({ slug }) })).rejects.toThrow(
        "PUBLIC_PAGE_NOT_FOUND",
      );
    },
  );

  it("keeps unavailable Survey branching and optional pages explicit", () => {
    const survey = getPublicProductPage("surveys")!;
    const markup = renderToStaticMarkup(<ProductFeaturePage page={survey} />);
    expect(markup).toContain("disabled by default");
    expect(markup).toContain("Conditional page branching is currently unavailable");
  });
});

describe("public solution pages", () => {
  it.each(publicSolutionPages)(
    "renders $slug with a practical workflow and valid feature links",
    (page) => {
      const markup = renderToStaticMarkup(<SolutionDetailPage page={page} />);
      expect(markup.match(/<h1>/g)).toHaveLength(1);
      expect(markup).toContain('id="workflow-title"');
      expect(markup).toContain('id="use-cases-title"');
      expect(markup).toContain('id="formats-title"');
      expect(markup.match(/<details>/g)).toHaveLength(page.faqs.length);
      for (const slug of page.featureSlugs) expect(markup).toContain(`href="/product/${slug}"`);
    },
  );

  it("generates metadata and route parameters for every solution", async () => {
    expect(solutionParams()).toEqual(publicSolutionPages.map(({ slug }) => ({ slug })));
    for (const page of publicSolutionPages) {
      const props = { params: Promise.resolve({ slug: page.slug }) };
      const metadata = await solutionMetadata(props);
      expect(metadata.title).toBe(page.title);
      expect(metadata.alternates?.canonical).toBe(`/solutions/${page.slug}`);
      expect(renderToStaticMarkup(await SolutionRoute(props))).toContain('id="formats-title"');
    }
  });

  it("handles unknown solutions in content and metadata", async () => {
    const props = { params: Promise.resolve({ slug: "missing-solution" }) };
    expect(getPublicSolutionPage("missing-solution")).toBeUndefined();
    await expect(SolutionRoute(props)).rejects.toThrow("PUBLIC_PAGE_NOT_FOUND");
    await expect(solutionMetadata(props)).rejects.toThrow("PUBLIC_PAGE_NOT_FOUND");
  });

  it("gives a missing page a public recovery path", () => {
    const markup = renderToStaticMarkup(<PublicContentNotFound kind="product" />);
    expect(markup).toContain("That page is not here.");
    expect(markup).toContain('href="/product"');
    expect(markup).toContain('href="/product/live-polls"');
  });
});
