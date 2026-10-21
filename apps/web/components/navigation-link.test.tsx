import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationLink } from "./navigation-link";

const fixtures = vi.hoisted(() => ({ pathname: "/pricing" }));
vi.mock("next/navigation", () => ({ usePathname: () => fixtures.pathname }));

describe("product navigation links", () => {
  beforeEach(() => {
    fixtures.pathname = "/pricing";
  });

  it("keeps a native named link and exposes the current destination", () => {
    const markup = renderToStaticMarkup(
      <NavigationLink className="custom-class" href="/pricing">
        Plans
      </NavigationLink>,
    );
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('class="navigation-control custom-class"');
    expect(markup).toContain('href="/pricing"');
    expect(markup).toContain(">Plans</a>");
    expect(markup).not.toContain('role="button"');
  });

  it("distinguishes exact pages, nested sections, and unrelated route prefixes", () => {
    fixtures.pathname = "/help/getting-started";
    expect(renderToStaticMarkup(<NavigationLink href="/help">Help</NavigationLink>)).not.toContain(
      "aria-current",
    );
    expect(
      renderToStaticMarkup(
        <NavigationLink href="/help" match="section">
          Help
        </NavigationLink>,
      ),
    ).toContain('aria-current="page"');
    fixtures.pathname = "/helpful";
    expect(
      renderToStaticMarkup(
        <NavigationLink href="/help" match="section">
          Help
        </NavigationLink>,
      ),
    ).not.toContain("aria-current");
  });

  it("does not claim every same-page section is the current page", () => {
    fixtures.pathname = "/organization";
    const markup = renderToStaticMarkup(
      <NavigationLink href="/organization?organizationId=example#members">Members</NavigationLink>,
    );
    expect(markup).not.toContain("aria-current");
    expect(markup).toContain('href="/organization?organizationId=example#members"');
  });

  it("preserves external-link options and caller-supplied current semantics", () => {
    const markup = renderToStaticMarkup(
      <NavigationLink
        aria-current="step"
        href="https://example.com"
        rel="noreferrer"
        target="_blank"
      >
        Reference
      </NavigationLink>,
    );
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain('href="https://example.com"');
  });
});
