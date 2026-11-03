import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FeedbackButton, FeedbackDialog } from "./feedback-button";
import { withEnglishLocale } from "../../test-utils/english-locale";
vi.mock("next/navigation", () => ({ usePathname: () => "/library" }));
describe("product feedback", () => {
  it("provides a global labelled dialog trigger", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<FeedbackButton />));
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-label="Feedback"');
    expect(markup).toMatch(/title="[^"]+"/);
    expect(markup).toContain("<svg");
    // The trigger contains SVG geometry only, with no visible label beside or inside it.
    expect(markup).toMatch(/^<button[^>]*><svg[^>]*>(?:<path[^>]*><\/path>)+<\/svg><\/button>$/);
  });
  it("explains collection, protects sensitive data, and asks for optional follow-up consent", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<FeedbackDialog page="/library" onClose={() => undefined} />),
    );
    expect(markup).toMatch(/<dialog[^>]*aria-labelledby="feedback-title"/);
    expect(markup).toContain('minLength="10"');
    expect(markup).toContain('maxLength="4000"');
    expect(markup).toContain("90 days");
    expect(markup).toContain("No page queries");
    expect(markup).not.toContain('type="checkbox" checked');
    expect(markup).toContain("Send feedback");
  });
});
