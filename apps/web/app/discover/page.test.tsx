import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";

const state = vi.hoisted(() => ({ canEdit: true, presentations: true, builderV2: true }));
vi.mock("next/navigation", () => ({ usePathname: () => "/discover" }));
vi.mock("../../components/workspace/workspace-provider", () => ({
  useWorkspace: () => ({
    canEdit: state.canEdit,
    productFeatures: { presentations: state.presentations, builderV2: state.builderV2 },
  }),
}));
vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspacePage: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("../../components/workspace/starter-gallery", () => ({
  StarterGallery: () => <div>Read-only catalog</div>,
}));
import DiscoverPage from "./page";

describe("Discover creation entry points", () => {
  beforeEach(() => {
    state.canEdit = true;
    state.presentations = true;
    state.builderV2 = true;
  });
  it("uses the shared format and method setup destinations", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<DiscoverPage />));
    expect(markup.match(/href="\/create\?type=custom&amp;start=source"/g)).toHaveLength(2);
    expect(markup.match(/href="\/create\/presentation"/g)).toHaveLength(2);
    expect(markup).toContain('href="/templates?type=designs"');
  });
  it("keeps catalog browsing available without offering writes to viewers", () => {
    state.canEdit = false;
    const markup = renderToStaticMarkup(withEnglishLocale(<DiscoverPage />));
    expect(markup).not.toContain('href="/create');
    expect(markup).toContain('href="/templates');
    expect(markup).toContain("Read-only catalog");
  });
  it("respects independent source and Presentation feature grants", () => {
    state.builderV2 = false;
    let markup = renderToStaticMarkup(withEnglishLocale(<DiscoverPage />));
    expect(markup).not.toContain("start=source");
    expect(markup).toContain('href="/create/presentation"');
    state.presentations = false;
    markup = renderToStaticMarkup(withEnglishLocale(<DiscoverPage />));
    expect(markup).not.toContain('href="/create');
    expect(markup).not.toContain("type=designs");
  });
});
