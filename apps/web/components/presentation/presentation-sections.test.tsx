import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  supportedLocales,
  type SupportedLocale,
  type PresentationSection,
} from "@openround/contracts";
import { PresentationSectionHeader, PresentationSections } from "./presentation-sections";
import { sectionsSpatialCopy } from "../../lib/i18n/sections-spatial-copy";
import { presentationNavigatorCopy } from "./presentation-navigator-copy";

const fixture = vi.hoisted(() => ({ locale: "en-CA" as SupportedLocale }));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: fixture.locale }) }));
afterEach(() => {
  fixture.locale = "en-CA";
});
const sectionId = "10000000-0000-4000-8000-000000000001";
const blockId = "20000000-0000-4000-8000-000000000002";
const callbacks = {
  onEnable: vi.fn(),
  onAdd: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onAssign: vi.fn(),
};
function markup(
  enabled: boolean,
  sections: PresentationSection[],
  selectedBlockId: string | null,
  disabled = false,
) {
  return renderToStaticMarkup(
    <PresentationSections
      enabled={enabled}
      sections={sections}
      selectedBlockId={selectedBlockId}
      disabled={disabled}
      {...callbacks}
    />,
  );
}
function header(
  section: PresentationSection,
  options: {
    disabled?: boolean;
    continued?: boolean;
    collapsed?: boolean;
    fragmented?: boolean;
  } = {},
) {
  return renderToStaticMarkup(
    <PresentationSectionHeader
      section={section}
      runKey={`${section.id}:run`}
      count={section.blockIds.length}
      continued={options.continued ?? false}
      collapsed={options.collapsed ?? false}
      disabled={options.disabled ?? false}
      canMove={() => true}
      fragmented={options.fragmented ?? false}
      onToggle={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onMove={vi.fn()}
    />,
  );
}

describe("Compact section authoring and integrated headers", () => {
  it("offers explicit opt-in and keeps rename/delete forms out of the toolbar", () => {
    const html = markup(false, [], blockId);
    expect(html).toContain("Enable sections and navigation");
    expect(html).not.toContain("Selected slide section");
    expect(html).not.toContain("Add section");
    const enabled = markup(true, [], blockId);
    expect(enabled).toContain('aria-label="Sections and navigation"');
    expect(enabled).toContain("Add section");
    expect(enabled).toContain('<option value="" selected="">Unsectioned</option>');
    expect(enabled).not.toContain("Rename");
    expect(enabled).not.toContain("Delete");
    expect(enabled).not.toContain("<form");
  });
  it("renders public names as plain text and displays section actions by the slides", () => {
    const title = '<img src="private"> & discussion';
    const section = { id: sectionId, title, blockIds: [blockId.toUpperCase()] };
    const html = markup(true, [section], blockId);
    expect(html).toContain(`value="${sectionId}" selected="">`);
    expect(html).not.toContain('<img src="private">');
    const heading = header(section);
    expect(heading).toContain('aria-expanded="true"');
    expect(heading).toContain('aria-controls="section-slides-');
    expect(heading).toContain("Collapse section &lt;img");
    expect(heading).toContain("Section actions: &lt;img");
    expect(heading).toContain("1 slide");
    expect(heading).toContain("Rename");
    expect(heading).toContain("Move section up");
    expect(heading).toContain("Move section down");
    expect(heading).toContain("Remove section only; keep all slides.");
    expect(heading).not.toContain('<img src="private">');
    expect(heading).not.toContain("<input");
  });
  it("caps named sections while keeping empty drafts and assignment available", () => {
    const sections = Array.from({ length: 50 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: "",
      blockIds: [],
    }));
    const html = markup(true, sections, blockId);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-expanded="false"/);
    expect(html).toContain("50 section limit reached");
    expect(html).toContain("Unnamed section 1");
    expect(html).toContain('<option value="" selected="">Unsectioned</option>');
    expect(header(sections[0]!)).toContain("0 slides");
    expect(markup(true, [], null)).not.toContain("Selected slide section");
  });
  it("explains legacy repeated runs and exposes collapse state without changing membership", () => {
    const section = { id: sectionId, title: "Original", blockIds: [blockId] };
    const before = structuredClone(section);
    const html = header(section, { continued: true, collapsed: true, fragmented: true });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Expand section Original (continued)");
    expect(html).toContain("This section has separated slides.");
    expect(html).toMatch(/<button disabled=""[^>]*>.*?Move section up/s);
    expect(section).toEqual(before);
  });
  it.each(supportedLocales)(
    "localizes %s controls while preserving authored titles and identities",
    (locale) => {
      fixture.locale = locale;
      const section = { id: sectionId, title: "Authored section 原文", blockIds: [blockId] };
      const before = structuredClone(section);
      const html = markup(true, [section], blockId);
      const copy = sectionsSpatialCopy(locale),
        navigator = presentationNavigatorCopy(locale);
      expect(html).toContain(`aria-label="${copy("Sections and navigation")}"`);
      expect(html).toContain(navigator("Selected slide section"));
      expect(html).toContain(copy("Add section"));
      expect(html).toContain(`value="${sectionId}" selected="">Authored section 原文`);
      const heading = header(section);
      expect(heading).toContain(navigator("Collapse section {title}", { title: section.title }));
      expect(heading).toContain(navigator("Remove section"));
      expect(heading).toContain('lang=""');
      expect(section).toEqual(before);
    },
  );
  it("retains read-only navigation while exposing no section mutation action", () => {
    const section = { id: sectionId, title: "Preserved title", blockIds: [blockId] };
    const html = markup(true, [section], blockId, true);
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('<select disabled="">');
    expect(html).toContain("workspace owners and editors");
    const heading = header(section, { disabled: true });
    expect(heading).toContain("Collapse section Preserved title");
    expect(heading).not.toContain("Section actions:");
    expect(heading).not.toContain("Rename");
    expect(heading).not.toContain("Remove section");
  });
});
