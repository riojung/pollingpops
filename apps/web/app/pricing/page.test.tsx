import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PricingPage from "./page";

describe("customer plan entry points", () => {
  it("separates personal Free and Pro from organization user licenses without inventing prices", () => {
    const markup = renderToStaticMarkup(<PricingPage />);
    expect(markup).toContain("Free · Personal");
    expect(markup).toContain("Pro · Personal");
    expect(markup).toContain("Team · Organization");
    expect(markup).toContain("separate organization-owned workspace");
    expect(markup).toContain("20 participants");
    expect(markup).toContain("100 participants");
    expect(markup).toContain("$0");
    expect(markup.match(/Pricing will be announced/g)).toHaveLength(2);
    expect(markup).toContain('href="/account#plan"');
    expect(markup).toContain('href="/account/setup?type=organization"');
    expect(markup).toContain('href="/signin?mode=signup&amp;accountType=personal"');
  });
});
