import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NativeSceneInteractionView,
  type NativeInteractionNode,
} from "./native-scene-interaction-view";
import { NativeSceneView } from "./native-scene-view";
import { nativeAudienceCopy } from "./native-audience-copy";

const overflow = vi.hoisted(() => ({
  tabIndex: undefined as number | undefined,
  read: vi.fn(),
  ref: vi.fn(),
  onKeyDown: vi.fn(),
}));
vi.mock("./use-native-text-overflow", () => ({
  useNativeTextOverflow: (key: string) => {
    overflow.read(key);
    return { ref: overflow.ref, tabIndex: overflow.tabIndex, onKeyDown: overflow.onKeyDown };
  },
}));
const frame = { x: 8, y: 30, width: 20, height: 10 };
const nodes: NativeInteractionNode[] = [
  {
    id: "reveal",
    type: "reveal",
    scope: "local",
    label: "Original reveal",
    body: "Original audience evidence",
    frame,
  },
  {
    id: "hotspot",
    type: "hotspot",
    scope: "local",
    label: "Original hotspot",
    detailTitle: "Original title",
    body: "Original audience evidence",
    imageNodeId: "image",
    frame,
  },
  {
    id: "dialog",
    type: "dialog",
    scope: "local",
    label: "Original dialog",
    detailTitle: "Original title",
    body: "Original audience evidence",
    frame,
  },
  { id: "link", type: "link", label: "Original link", href: "https://example.test", frame },
  {
    id: "navigation",
    type: "navigation",
    label: "Original navigation",
    targetBlockId: "target",
    frame,
  },
];
beforeEach(() => {
  overflow.tabIndex = undefined;
  vi.clearAllMocks();
});

describe("passive native interaction overflow", () => {
  it.each(nodes)(
    "focuses the actual passive $type scroll container only when its overflow hook requires it",
    (node) => {
      const before = structuredClone(node);
      const render = () =>
        renderToStaticMarkup(<NativeSceneInteractionView node={node} editing locale="ko-KR" />);
      const fitted = render();
      expect(fitted).not.toContain("tabindex");
      overflow.tabIndex = 0;
      const overflowing = render();
      expect(overflowing).toMatch(
        new RegExp(`<div[^>]*tabindex="0"[^>]*data-native-interaction="${node.type}"`),
      );
      expect(overflowing).toContain(`<span lang=""`);
      expect(overflowing).toContain(node.label);
      if ("body" in node) expect(overflowing).toContain(node.body);
      expect(overflowing).not.toContain("<button");
      expect(overflowing).not.toContain("<a ");
      expect(overflowing).not.toContain("aria-expanded");
      expect(overflow.read).toHaveBeenLastCalledWith(JSON.stringify([node, "ko-KR"]));
      expect(node).toEqual(before);
      overflow.tabIndex = undefined;
      expect(render()).not.toContain("tabindex");
    },
  );

  it("keeps live audience interactions outside the passive overflow observer", () => {
    const onNavigate = vi.fn();
    const onSetReveal = vi.fn();
    const markup = renderToStaticMarkup(
      <NativeSceneInteractionView
        node={nodes[1]!}
        locale="ko-KR"
        runtime={{ mode: "live_audience", onNavigate, onSetReveal }}
      />,
    );
    expect(overflow.read).not.toHaveBeenCalled();
    expect(markup).toContain(nativeAudienceCopy("ko-KR")("Open details on this screen"));
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("Original audience evidence");
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onSetReveal).not.toHaveBeenCalled();
  });

  it("keeps measured overflow inside the inert static thumbnail boundary", () => {
    overflow.tabIndex = 0;
    const node = nodes[1]!;
    const markup = renderToStaticMarkup(
      <NativeSceneView
        scene={{ schemaVersion: 5, aspectRatio: "16:9", nodes: [node], readingOrder: [node.id] }}
        staticThumbnail
        locale="ko-KR"
      />,
    );
    expect(markup).toContain('inert=""');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-static-thumbnail="true"');
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("aria-expanded");
  });
});
