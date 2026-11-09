import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PresentationScene } from "@openround/contracts";
import {
  createNativeContentBlock,
  createNativeRevealNode,
  createNativeLinkNode,
  createNativeDialogNode,
  createNativeHotspotNode,
  createNativeNavigationNode,
} from "../../lib/presentation-native-scene";
import { describeNativeInteraction, NativeInteractionSummary } from "./native-interaction-summary";

function elements(tree: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, any>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
const scene = createNativeContentBlock().scene!;
const targets = [{ id: "ABCDEFAB-1111-4111-8111-111111111111", title: "Decision checkpoint" }];

describe("interaction authoring overview", () => {
  it("distinguishes local, live broadcast and preview reveal scope without mutating the scene", () => {
    const node = { ...createNativeRevealNode(), label: "Show evidence", body: "Public evidence" };
    const before = JSON.stringify(scene);
    const local = describeNativeInteraction(scene, node, []);
    const shared = describeNativeInteraction(scene, { ...node, scope: "broadcast" }, []);
    expect(local.audience).toContain("own screen");
    expect(shared.trigger).toContain("facilitator");
    expect(shared.audience).toContain("Live: reveal for everyone");
    expect(shared.audience).toContain("Preview and shared links: this screen only");
    expect(shared.issues).toEqual([]);
    expect(JSON.stringify(scene)).toBe(before);
  });
  it("explains safe external links and refuses incomplete or unsafe destinations", () => {
    const node = {
      ...createNativeLinkNode(),
      label: "Visit source",
      href: "https://example.com/source",
    };
    expect(describeNativeInteraction(scene, node, []).result).toContain("in a new tab");
    for (const href of ["", "javascript:alert(1)", "https://user:password@example.com"]) {
      const summary = describeNativeInteraction(scene, { ...node, href }, []);
      expect(summary.issues).toHaveLength(1);
      expect(summary.result).not.toContain(href || "javascript:");
    }
  });
  it("resolves navigation only against supplied available targets, case-insensitively", () => {
    const node = {
      ...createNativeNavigationNode(),
      label: "Decide",
      targetBlockId: targets[0]!.id.toLowerCase(),
    };
    expect(describeNativeInteraction(scene, node, targets)).toMatchObject({
      result: "Go to “Decision checkpoint”.",
      issues: [],
    });
    expect(describeNativeInteraction(scene, node, []).issues).toContain(
      "Choose an available target slide or activity.",
    );
    expect(describeNativeInteraction(scene, node, targets).audience).toContain(
      "Live: move everyone",
    );
  });
  it("requires detail titles and audience content before a dialog can be tried", () => {
    const node = { ...createNativeDialogNode(), label: "Inspect" };
    expect(describeNativeInteraction(scene, node, []).issues).toHaveLength(2);
    expect(
      describeNativeInteraction(
        scene,
        { ...node, detailTitle: "Evidence", body: "Public detail" },
        [],
      ).issues,
    ).toEqual([]);
  });
  it("checks hotspot image association, rotation and complete frame containment", () => {
    const image = {
      id: "image",
      type: "image" as const,
      mediaId: "media",
      altText: null,
      frame: { x: 10, y: 30, width: 70, height: 50 },
    };
    const source: PresentationScene = {
      ...scene,
      schemaVersion: 6,
      nodes: [...scene.nodes, image],
      readingOrder: [...scene.readingOrder, image.id],
    };
    const node = {
      ...createNativeHotspotNode(image),
      label: "Inspect",
      detailTitle: "Evidence",
      body: "Public detail",
    };
    expect(describeNativeInteraction(source, node, []).issues).toEqual([]);
    expect(describeNativeInteraction(source, node, []).trigger).toContain("the linked image");
    for (const invalid of [
      { ...node, imageNodeId: "missing" },
      { ...node, rotation: 15 },
      { ...node, frame: { ...node.frame, x: 0 } },
    ])
      expect(describeNativeInteraction(source, invalid, []).issues).toHaveLength(1);
    const rotated = {
      ...source,
      nodes: source.nodes.map((n) => (n.id === image.id ? { ...image, rotation: 15 } : n)),
    };
    expect(describeNativeInteraction(rotated, node, []).issues).toHaveLength(1);
  });
  it("focuses the invoking action before opening preview and preserves the complete draft", () => {
    const node = { ...createNativeRevealNode(), label: "Show", body: "Complete content" };
    const focus = vi.fn(),
      preview = vi.fn(() => expect(focus).toHaveBeenCalledOnce());
    const tree = NativeInteractionSummary({ scene, node, onPreview: preview });
    const button = elements(tree).find((element) => element.type === "button")!;
    expect(button.props.disabled).toBe(false);
    button.props.onClick({ currentTarget: { focus } });
    expect(preview).toHaveBeenCalledOnce();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("does not start a live session or publish changes");
  });
  it("blocks preview while a draft/link entry is unavailable, even for a valid selected action", () => {
    const node = { ...createNativeRevealNode(), label: "Show", body: "Evidence" };
    const preview = vi.fn();
    const tree = NativeInteractionSummary({
      scene,
      node,
      onPreview: preview,
      previewUnavailableReason: "Correct the unsaved link entries on this slide before previewing.",
    });
    const button = elements(tree).find((element) => element.type === "button")!;
    expect(button.props.disabled).toBe(true);
    button.props.onClick({ currentTarget: { focus: vi.fn() } });
    expect(preview).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(tree)).toContain("unsaved link entries");
  });
});
