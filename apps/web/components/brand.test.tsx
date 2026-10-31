import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Brand, CreatorBrand, creatorLandingHref, creatorLibraryHref } from "./brand";

describe("Brand", () => {
  it("keeps the home link named when responsive styles hide the visible name", () => {
    const markup = renderToStaticMarkup(<Brand />);

    expect(markup).toContain('<span class="sr-only">Polling Pops</span>');
    expect(markup).toContain('<span class="brand-name" aria-hidden="true">Polling Pops</span>');
    expect(markup).toContain('href="/"');
  });

  it("uses the configured organization name as the accessible name", () => {
    const markup = renderToStaticMarkup(<Brand name="Acme Learning" />);

    expect(markup).toContain('<span class="sr-only">Acme Learning</span>');
    expect(markup).toContain('<span class="brand-name" aria-hidden="true">Acme Learning</span>');
    expect(markup).not.toContain('viewBox="0 0 64 80"');
    expect(markup).toContain("AL");
  });

  it("uses an original decorative lollipop and keeps inverted branding readable", () => {
    const markup = renderToStaticMarkup(<Brand inverted />);

    expect(markup).toContain('viewBox="0 0 64 80"');
    expect(markup).toContain('data-inverted="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).not.toContain("OpenRound");
  });

  it("uses workspace Home by default and preserves an explicitly disabled shell", () => {
    const publicMarkup = renderToStaticMarkup(<Brand />);
    const betaMarkup = renderToStaticMarkup(
      <CreatorBrand productFeatures={{ workspaceShell: true }} />,
    );
    const legacyMarkup = renderToStaticMarkup(
      <CreatorBrand productFeatures={{ workspaceShell: false }} />,
    );
    const unresolvedMarkup = renderToStaticMarkup(<CreatorBrand />);

    expect(publicMarkup).toContain('href="/"');
    expect(betaMarkup).toContain('href="/home"');
    expect(legacyMarkup).toContain('href="/dashboard"');
    expect(unresolvedMarkup).toContain('href="/home"');
  });

  it("keeps Home canonical while account features resolve", () => {
    expect(creatorLandingHref(undefined)).toBe("/home");
    expect(creatorLandingHref(null)).toBe("/home");
    expect(creatorLandingHref({})).toBe("/home");
    expect(creatorLandingHref({ workspaceShell: false })).toBe("/dashboard");
    expect(creatorLandingHref({ workspaceShell: true })).toBe("/home");
  });

  it("opens the modern library unless the shell was explicitly disabled", () => {
    expect(creatorLibraryHref(undefined)).toBe("/library");
    expect(creatorLibraryHref(null)).toBe("/library");
    expect(creatorLibraryHref({ workspaceShell: true })).toBe("/library");
    expect(creatorLibraryHref({ workspaceShell: false })).toBe("/dashboard");
  });
});
