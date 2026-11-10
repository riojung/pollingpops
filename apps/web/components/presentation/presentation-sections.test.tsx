import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import {
  supportedLocales,
  type SupportedLocale,
  type PresentationSection,
} from "@openround/contracts";
import { PresentationSections } from "./presentation-sections";
import { sectionsSpatialCopy } from "../../lib/i18n/sections-spatial-copy";

const fixture = vi.hoisted(() => ({ locale: "en-CA" as SupportedLocale }));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: fixture.locale }) }));
afterEach(() => {
  fixture.locale = "en-CA";
});

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
  it.each(supportedLocales)(
    "renders section controls in %s without changing authored titles or identifiers",
    (locale) => {
      fixture.locale = locale;
      const sections = [{ id: sectionId, title: "Authored section 原文", blockIds: [blockId] }];
      const before = structuredClone(sections);
      const html = markup(true, sections, blockId);
      const copy = sectionsSpatialCopy(locale);
      expect(html).toContain(`aria-label="${copy("Sections and navigation")}"`);
      expect(html).toContain(copy("Selected block section"));
      expect(html).toContain(copy("Add section"));
      expect(html).toContain('lang=""');
      expect(html).toContain('value="Authored section 原文"');
      expect(html).toContain(`value="${sectionId}" selected="">Authored section 原文`);
      expect(markup(false, [], null)).toContain(copy("Enable sections and navigation"));
      expect(sections).toEqual(before);
    },
  );
  it("disables read-only section controls and guards every captured callback", () => {
    const onEnable = vi.fn(),
      onAdd = vi.fn(),
      onRename = vi.fn(),
      onDelete = vi.fn(),
      onAssign = vi.fn();
    const props = {
      enabled: true,
      disabled: true,
      sections: [{ id: sectionId, title: "Preserved title", blockIds: [] }],
      selectedBlockId: blockId,
      onEnable,
      onAdd,
      onRename,
      onDelete,
      onAssign,
    };
    const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
      if (Array.isArray(node)) return node.flatMap(elements);
      if (!isValidElement<Record<string, unknown>>(node)) return [];
      return [node, ...elements(node.props.children as ReactNode)];
    };
    const tree = PresentationSections(props);
    for (const node of elements(tree)) {
      if (["button", "input", "select"].includes(node.type as string))
        expect(node.props.disabled).toBe(true);
      if (node.props.onClick) (node.props.onClick as () => void)();
      if (node.props.onChange)
        (node.props.onChange as (event: unknown) => void)({ target: { value: sectionId } });
      if (node.props.onSubmit)
        (node.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    }
    const enable = elements(PresentationSections({ ...props, enabled: false })).find(
      (node) => node.type === "button",
    )!;
    (enable.props.onClick as () => void)();
    for (const callback of [onEnable, onAdd, onRename, onDelete, onAssign])
      expect(callback).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(tree)).toContain("workspace owners and editors");
  });
});
