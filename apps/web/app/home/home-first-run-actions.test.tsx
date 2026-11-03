import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { HomeFirstRunActions } from "./home-first-run-actions";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
}));

describe("Home first-run actions", () => {
  it("links an editor to creation and the permanent quick-start guide", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<HomeFirstRunActions canCreate guideAvailable />),
    );

    expect(markup).toContain('href="/create"');
    expect(markup).toContain('href="/help#quick-start"');
    expect(markup).toContain("Watch the 1-minute quick start");
  });

  it("keeps guidance available without showing a creation action to a viewer", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<HomeFirstRunActions canCreate={false} guideAvailable />),
    );

    expect(markup).not.toContain("Create your first artifact");
    expect(markup).toContain('href="/help#quick-start"');
  });

  it("does not link to a video guide when its covered features are unavailable", () => {
    const editorMarkup = renderToStaticMarkup(
      withEnglishLocale(<HomeFirstRunActions canCreate guideAvailable={false} />),
    );
    const viewerMarkup = renderToStaticMarkup(
      withEnglishLocale(<HomeFirstRunActions canCreate={false} guideAvailable={false} />),
    );

    expect(editorMarkup).toContain('href="/create"');
    expect(editorMarkup).not.toContain("/help#quick-start");
    expect(viewerMarkup).toBe("");
  });
});
