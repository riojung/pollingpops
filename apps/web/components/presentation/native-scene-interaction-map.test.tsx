import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PresentationScene, PresentationSceneNode } from "@openround/contracts";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { NativeSceneInteractionMap } from "./native-scene-interaction-map";

function fixture(): PresentationScene {
  const base = createNativeContentBlock().scene!;
  const actions: PresentationSceneNode[] = [
    {
      id: "reveal",
      type: "reveal",
      scope: "broadcast",
      label: "Evidence",
      body: "NEVER RENDER REVEAL BODY",
      frame: { x: 10, y: 10, width: 20, height: 20 },
    },
    {
      id: "dialog",
      type: "dialog",
      scope: "local",
      label: "Evidence",
      detailTitle: "Evidence details",
      body: "NEVER RENDER DETAIL BODY",
      frame: { x: 10, y: 40, width: 20, height: 20 },
    },
    {
      id: "navigation",
      type: "navigation",
      label: "Decision",
      targetBlockId: "ABCDEFAB-1111-4111-8111-111111111111",
      frame: { x: 40, y: 10, width: 20, height: 20 },
    },
    {
      id: "link",
      type: "link",
      label: "Read source",
      href: "https://example.com/evidence",
      frame: { x: 40, y: 40, width: 20, height: 20 },
    },
    {
      id: "image",
      type: "image",
      mediaId: "media",
      altText: "Evidence photograph",
      frame: { x: 60, y: 10, width: 30, height: 30 },
    },
    {
      id: "hotspot",
      type: "hotspot",
      scope: "local",
      label: "Inspect photo",
      imageNodeId: "image",
      detailTitle: "Photograph detail",
      body: "NEVER RENDER HOTSPOT BODY",
      frame: { x: 70, y: 20, width: 10, height: 10 },
    },
  ];
  return {
    ...base,
    schemaVersion: 6,
    nodes: [...base.nodes, ...actions],
    readingOrder: [
      ...base.readingOrder,
      "navigation",
      "reveal",
      "hotspot",
      "dialog",
      "link",
      "image",
    ],
  };
}
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}
function map({
  selectedNodeIds = ["reveal"],
  expanded = true,
  scene = fixture(),
  editable = true,
}: {
  selectedNodeIds?: string[];
  expanded?: boolean;
  scene?: PresentationScene;
  editable?: boolean;
} = {}) {
  const onSelect = vi.fn(),
    onExpandedChange = vi.fn(),
    onEdit = vi.fn();
  const tree = NativeSceneInteractionMap({
    scene,
    selectedNodeIds,
    expanded,
    onExpandedChange,
    onSelect,
    onEdit: editable ? onEdit : undefined,
    navigationTargets: [
      { id: "abcdefab-1111-4111-8111-111111111111", title: "Decision checkpoint" },
    ],
  });
  const all = elements(tree);
  return {
    tree,
    all,
    scene,
    onSelect,
    onEdit,
    onExpandedChange,
    markup: renderToStaticMarkup(tree),
    rows: all.filter(
      (node) => node.type === "button" && typeof node.props["aria-pressed"] === "boolean",
    ),
    buttons: all.filter((node) => node.type === "button"),
  };
}

describe("native scene interaction map", () => {
  it("renders semantic action order, ordinal/type/label and the selected trigger/outcome", () => {
    const view = map();
    expect(view.rows.map((row) => text(row).replace(/\s+/g, " ").trim())).toEqual([
      "1 Slide link Decision",
      "2 Reveal panel Evidence",
      "3 Image hotspot Inspect photo",
      "4 Detail dialog Evidence",
      "5 External link Read source",
    ]);
    expect(view.markup).toContain('data-native-interaction-map="true"');
    expect(view.markup).toContain("5 interactions");
    for (const kind of [
      "Reveal panel",
      "Detail dialog",
      "Image hotspot",
      "External link",
      "Slide link",
    ])
      expect(view.markup).toContain(kind);
    expect(view.markup).toContain('aria-label="Selected interaction connection"');
    expect(view.markup).toContain('data-native-interaction-connection="true"');
    expect(view.markup).toContain("Audience content in this panel");
    expect(view.markup).toContain("Live: reveal for everyone");
    expect(view.markup).toContain("Preview and shared links: this screen only");
    expect(view.markup).toContain("Content tools");
  });

  it("selects only the pressed row and edits only through the explicit action", () => {
    const view = map();
    view.rows[2]!.props.onClick();
    expect(view.onSelect.mock.calls).toEqual([["hotspot"]]);
    expect(view.onEdit).not.toHaveBeenCalled();
    expect(view.onExpandedChange).not.toHaveBeenCalled();
    const focus = vi.fn();
    view.onEdit.mockImplementation(() =>
      expect(focus).toHaveBeenCalledWith({ preventScroll: true }),
    );
    view.buttons.at(-1)!.props.onClick({ currentTarget: { focus } });
    expect(view.onEdit.mock.calls).toEqual([["reveal"]]);
    expect(view.onSelect.mock.calls).toEqual([["hotspot"]]);
    expect(view.markup).not.toContain("href=");
    expect(view.markup).not.toContain("<a ");
    expect(view.markup).not.toContain("Ready");
    expect(view.markup).not.toContain("Preview this slide");
  });

  it("uses the last selected ID rather than highlighting every group or batch member", () => {
    const view = map({ selectedNodeIds: ["reveal", "dialog"] });
    expect(view.rows.map((row) => row.props["aria-pressed"])).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(view.markup).toContain("Evidence details");
    expect(view.markup).not.toContain("Audience content in this panel");
    const other = map({ selectedNodeIds: ["reveal", "image"] });
    expect(other.rows.every((row) => row.props["aria-pressed"] === false)).toBe(true);
    expect(other.markup).not.toContain('data-native-interaction-connection="true"');
  });

  it("keeps collapse controlled and removes map actions until expanded", () => {
    const collapsed = map({ expanded: false });
    expect(collapsed.buttons).toHaveLength(1);
    expect(collapsed.buttons[0]!.props["aria-expanded"]).toBe(false);
    expect(collapsed.markup).toContain("Show interaction map");
    expect(collapsed.markup).not.toContain("Slide interactions");
    collapsed.buttons[0]!.props.onClick();
    expect(collapsed.onExpandedChange.mock.calls).toEqual([[true]]);
    expect(collapsed.onSelect).not.toHaveBeenCalled();
    expect(collapsed.onEdit).not.toHaveBeenCalled();
    const expanded = map();
    expect(expanded.buttons[0]!.props["aria-expanded"]).toBe(true);
    expect(expanded.markup).toContain("Hide interaction map");
    expanded.buttons[0]!.props.onClick();
    expect(expanded.onExpandedChange.mock.calls).toEqual([[false]]);
  });

  it("provides image association and invalid destination guidance without exposing bodies", () => {
    const source = fixture();
    const before = JSON.stringify(source);
    const image = map({ scene: source, selectedNodeIds: ["hotspot"] });
    expect(image.markup).toContain("On image: ");
    expect(image.markup).toContain("Evidence photograph");
    expect(image.markup).toContain("Photograph detail");
    const available = map({ scene: source, selectedNodeIds: ["navigation"] });
    expect(available.markup).toContain("Decision checkpoint");
    expect(JSON.stringify(source)).toBe(before);
    source.nodes = source.nodes.filter((node) => node.id !== "image");
    const missingImage = map({ scene: source, selectedNodeIds: ["hotspot"] });
    expect(missingImage.markup).toContain("Choose the image for this hotspot.");
    expect(missingImage.markup).not.toContain("On image:");
    const navigation = source.nodes.find((node) => node.type === "navigation")!;
    if (navigation.type === "navigation") navigation.targetBlockId = null;
    expect(map({ scene: source, selectedNodeIds: ["navigation"] }).markup).toContain(
      "Choose an available target slide or activity.",
    );
    for (const view of [image, available, missingImage])
      expect(view.markup).not.toContain("NEVER RENDER");
  });

  it("omits Edit when no editor callback is provided and omits map chrome from ordinary scenes", () => {
    const standalone = map({ editable: false });
    expect(standalone.buttons).toHaveLength(6);
    expect(standalone.markup).not.toContain("Edit interaction");
    const empty = map({ scene: createNativeContentBlock().scene! });
    expect(empty.tree).toBeNull();
    expect(empty.markup).toBe("");
    expect(empty.rows).toHaveLength(0);
    expect(empty.markup).not.toContain('data-native-interaction-connection="true"');
  });
});
