import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeCreatorActions } from "./home-creator-actions";

// The initial public action has to be safe before the account response arrives.
describe("public creator entry", () => {
  it("uses Home as the canonical destination while the session resolves", () => {
    const markup = renderToStaticMarkup(<HomeCreatorActions />);
    expect(markup).toContain('href="/home"');
    expect(markup).not.toContain('href="/dashboard"');
    expect(markup).toContain('href="#how-it-works"');
  });
});
