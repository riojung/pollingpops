import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  supportedLocales,
  type PresentationScene,
  type PresentationSceneNode,
  type SupportedLocale,
} from "@openround/contracts";
import { nativeInteractionCopy } from "./native-interaction-copy";
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
  locale,
  navigationTargets = [
    { id: "abcdefab-1111-4111-8111-111111111111", title: "Decision checkpoint" },
  ],
}: {
  selectedNodeIds?: string[];
  expanded?: boolean;
  scene?: PresentationScene;
  editable?: boolean;
  locale?: SupportedLocale;
  navigationTargets?: { id: string; title: string }[];
} = {}) {
  const onSelect = vi.fn(),
    onExpandedChange = vi.fn(),
    onEdit = vi.fn();
  const tree = NativeSceneInteractionMap({
    scene,
    locale,
    selectedNodeIds,
    expanded,
    onExpandedChange,
    onSelect,
    onEdit: editable ? onEdit : undefined,
    navigationTargets,
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
  it.each(supportedLocales)(
    "localizes map controls, current connections and blocked guidance in %s",
    (locale) => {
      const copy = nativeInteractionCopy(locale);
      const ready = map({ locale, selectedNodeIds: ["navigation"] });
      expect(ready.markup).toContain(`aria-label="${copy("Interaction map")}" lang="${locale}"`);
      expect(ready.markup).toContain(copy("Hide interaction map"));
      expect(ready.markup).toContain(copy("{count} interactions", { count: 5 }));
      expect(ready.markup).toContain(copy("Slide link"));
      expect(ready.markup).toContain('<span lang="">Decision checkpoint</span>');
      expect(ready.markup).toContain(
        copy("Live: move everyone. Preview and shared links: move this reader only."),
      );
      expect(ready.markup).not.toContain(copy("Choose an available target slide or activity."));
      const before = JSON.stringify(ready.scene);
      const blocked = map({
        locale,
        scene: ready.scene,
        selectedNodeIds: ["navigation"],
        navigationTargets: [],
      });
      expect(blocked.markup).toContain(copy("Choose an available target slide or activity."));
      expect(blocked.markup).toContain(copy("Check in Content tools"));
      expect(blocked.markup).toContain(copy("Choose a slide or activity"));
      expect(blocked.markup).not.toContain("Decision checkpoint");
      expect(JSON.stringify(ready.scene)).toBe(before);
      expect(blocked.markup).not.toContain("NEVER RENDER");
      expect(blocked.markup).not.toContain("href=");
      blocked.rows[0]!.props.onClick();
      expect(blocked.onSelect.mock.calls).toEqual([["navigation"]]);
      expect(blocked.onEdit).not.toHaveBeenCalled();
    },
  );

  it("separates translated kinds and generated targets from authored English collisions and annotations", () => {
    const source = fixture();
    source.nodes = source.nodes.map((node) =>
      node.type === "navigation"
        ? { ...node, label: "Slide link" }
        : node.type === "dialog"
          ? { ...node, label: "Detail dialog", detailTitle: "Detail dialog" }
          : node,
    );
    const navigation = map({
      scene: source,
      locale: "ko-KR",
      selectedNodeIds: ["navigation"],
      navigationTargets: [
        { id: "abcdefab-1111-4111-8111-111111111111", title: "Choose a slide or activity" },
      ],
    });
    expect(navigation.markup).toContain('<span lang="">Slide link</span>');
    expect(navigation.markup).toContain('<span lang="">Choose a slide or activity</span>');
    expect(text(navigation.rows[0])).toContain("슬라이드 링크 Slide link");
    const dialog = map({ scene: source, locale: "ko-KR", selectedNodeIds: ["dialog"] });
    expect(dialog.markup).toContain('<span lang="">Detail dialog</span>');
    expect(dialog.markup).toContain("상세 대화상자");
    source.nodes = source.nodes.map((node) =>
      node.type === "dialog" ? { ...node, label: " ", detailTitle: " " } : node,
    );
    const fallback = map({ scene: source, locale: "ko-KR", selectedNodeIds: ["dialog"] });
    expect(text(fallback.rows[3])).toContain("상세 대화상자 상세 대화상자");
    expect(fallback.markup).not.toContain('<span lang="">상세 대화상자</span>');
    expect(fallback.markup).toContain("상세 제목을 추가하세요.");
    const readOnly = map({ scene: source, locale: "ko-KR", editable: false });
    expect(readOnly.markup).not.toContain("상호작용 편집");
    expect(readOnly.rows).toHaveLength(5);
  });

  it("uses current image source geometry for localized associations and failures", () => {
    const source = fixture();
    source.nodes = source.nodes.map((node) =>
      node.type === "image" ? { ...node, altText: "Image description needed" } : node,
    );
    const valid = map({ scene: source, locale: "ko-KR", selectedNodeIds: ["hotspot"] });
    expect(valid.markup).toContain('이미지: <span lang="">Image description needed</span>');
    expect(valid.markup).not.toContain("이미지 설명 필요");
    source.nodes = source.nodes.map((node) =>
      node.type === "image" ? { ...node, altText: " " } : node,
    );
    const unnamed = map({ scene: source, locale: "ko-KR", selectedNodeIds: ["hotspot"] });
    expect(unnamed.markup).toContain("이미지: 이미지 설명 필요");
    expect(unnamed.markup).not.toContain('<span lang="">이미지 설명 필요</span>');
    source.nodes = source.nodes.map((node) =>
      node.type === "image" ? { ...node, rotation: 15, altText: "STALE ASSOCIATION" } : node,
    );
    const rotated = map({ scene: source, locale: "ko-KR", selectedNodeIds: ["hotspot"] });
    expect(rotated.markup).toContain("핫스폿을 회전하지 않은 이미지 안에 유지하세요.");
    expect(rotated.markup).not.toContain("이미지: ");
    source.nodes = source.nodes.filter((node) => node.type !== "image");
    const removed = map({ scene: source, locale: "ko-KR", selectedNodeIds: ["hotspot"] });
    expect(removed.markup).toContain("이 핫스폿의 이미지를 선택하세요.");
    expect(removed.markup).not.toContain("STALE ASSOCIATION");
    expect(removed.markup).not.toContain("이미지: ");
    for (const view of [valid, unnamed, rotated, removed])
      expect(view.markup).not.toContain("NEVER RENDER");
  });
});
