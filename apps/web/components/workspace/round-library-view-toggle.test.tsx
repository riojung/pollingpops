import { supportedLocales } from "@openround/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadMessages, translate } from "../../lib/i18n/catalog";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { LocaleProvider } from "../locale-provider";
import { RoundLibraryViewToggle } from "./round-library-view-toggle";

vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
}));

describe("RoundLibraryViewToggle", () => {
  it("exposes a labelled, pressed-state view choice", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<RoundLibraryViewToggle onChange={() => undefined} value="list" />),
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Round library view"');
    expect(markup).toContain('aria-label="Grid view" aria-pressed="false"');
    expect(markup).toContain('aria-label="List view" aria-pressed="true"');
  });

  it.each(supportedLocales)(
    "keeps visible labels equal to accessible names and the selected view pressed in %s",
    async (locale) => {
      const messages = await loadMessages(locale, ["workspace-pages"]);
      for (const selectedView of ["grid", "list"] as const) {
        const markup = renderToStaticMarkup(
          <LocaleProvider
            initialDomains={["workspace-pages"]}
            initialLocale={locale}
            initialMessages={messages}
          >
            <RoundLibraryViewToggle onChange={() => undefined} value={selectedView} />
          </LocaleProvider>,
        );
        const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
        expect(buttons).toHaveLength(2);
        for (const [index, view] of (["grid", "list"] as const).entries()) {
          const [, attributes, visibleLabel] = buttons[index]!;
          const accessibleName = /aria-label="([^"]*)"/.exec(attributes!)?.[1];
          const expectedLabel = translate(
            messages,
            view === "grid" ? "pages.library.gridView" : "pages.library.listView",
          );
          const escapedExpectedLabel = renderToStaticMarkup(<>{expectedLabel}</>);
          expect(accessibleName).toBe(escapedExpectedLabel);
          expect(visibleLabel).toBe(accessibleName);
          expect(attributes).toContain(`aria-pressed="${selectedView === view}"`);
          expect(attributes).toContain('type="button"');
        }
      }
    },
  );
});
