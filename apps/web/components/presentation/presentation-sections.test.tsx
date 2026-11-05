import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PresentationSection } from "@openround/contracts";
import { PresentationSections } from "./presentation-sections";

const sectionId = "10000000-0000-4000-8000-000000000001";
const blockId = "20000000-0000-4000-8000-000000000002";

function markup(enabled: boolean, sections: PresentationSection[], selectedBlockId: string | null) {
  return renderToStaticMarkup(
    <PresentationSections
      enabled={enabled}
      sections={sections}
      selectedBlockId={selectedBlockId}
      onEnable={vi.fn()}
      onAdd={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onAssign={vi.fn()}
    />,
  );
}

describe("Presentation sections authoring controls", () => {
  it("offers an explicit opt-in before adding section authoring controls", () => {
    const html = markup(false, [], blockId);
    expect(html).toContain("Enable sections and navigation");
    expect(html).not.toContain("Selected block section");
    expect(html).not.toContain("Add section");
  });

  it("makes navigation available without requiring named sections", () => {
    const html = markup(true, [], blockId);
    expect(html).toContain("Sections and navigation");
    expect(html).toContain("Slides play in their numbered order below");
    expect(html).toContain("Add section");
    expect(html).toContain('<option value="" selected="">Unsectioned</option>');
    expect(html).not.toContain("Enable sections and navigation");
  });

  it("labels rename and assignment controls and renders public names as plain text", () => {
    const title = '<img src="private"> & discussion';
    const html = markup(
      true,
      [{ id: sectionId, title, blockIds: [blockId.toUpperCase()] }],
      blockId,
    );
    expect(html).toContain(`for="section-title-${sectionId}"`);
    expect(html).toContain('maxLength="120"');
    expect(html).toContain("Rename");
    expect(html).toContain("Delete section &lt;img");
    expect(html).toContain("1 block");
    expect(html).toContain(`value="${sectionId}" selected="">`);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain('<img src="private">');
  });

  it("caps named sections while keeping unnamed drafts editable and unassigned blocks available", () => {
    const sections = Array.from({ length: 50 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: "",
      blockIds: [],
    }));
    const html = markup(true, sections, blockId);
    expect(html).toMatch(/<button disabled=""[^>]*>Add section<\/button>/);
    expect(html).toContain("50 section limit reached");
    expect(html).toContain("Unnamed section 1");
    expect(html).toContain('<option value="" selected="">Unsectioned</option>');
    expect(markup(true, [], null)).not.toContain("Selected block section");
  });
});
