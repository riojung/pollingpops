import { describe, expect, it } from "vitest";
import type { PresentationScene, PresentationSceneNode } from "@openround/contracts";
import {
  createNativeContentBlock,
  createNativeDialogNode,
  createNativeHotspotNode,
  createNativeLinkNode,
  createNativeNavigationNode,
  createNativeRevealNode,
} from "./presentation-native-scene";
import { nativeInteractionMapItems } from "./presentation-native-interaction-map";

const target = { id: "ABCDEFAB-1111-4111-8111-111111111111", title: "Decision checkpoint" };
function fixture() {
  const image: Extract<PresentationSceneNode, { type: "image" }> = {
    id: "image",
    type: "image",
    mediaId: "media",
    altText: "Evidence photograph",
    frame: { x: 10, y: 30, width: 70, height: 50 },
  };
  const reveal = {
    ...createNativeRevealNode(),
    id: "reveal",
    label: "Inspect evidence",
    body: "Audience body must not become map text",
  };
  const dialog = {
    ...createNativeDialogNode(),
    id: "dialog",
    label: "Inspect evidence",
    detailTitle: "Evidence details",
    body: "Detail audience body",
  };
  const hotspot = {
    ...createNativeHotspotNode(image),
    id: "hotspot",
    label: "Examine photo",
    detailTitle: "Photograph detail",
    body: "Photograph audience body",
  };
  const link = {
    ...createNativeLinkNode(),
    id: "link",
    label: "Read source",
    href: "https://example.com/evidence",
  };
  const navigation: Extract<PresentationSceneNode, { type: "navigation" }> = {
    ...createNativeNavigationNode(),
    id: "navigation",
    label: "Choose next step",
    targetBlockId: target.id.toLowerCase(),
  };
  const base = createNativeContentBlock().scene!;
  const scene: PresentationScene = {
    ...base,
    schemaVersion: 6,
    nodes: [...base.nodes, image, reveal, dialog, hotspot, link, navigation],
    readingOrder: [
      ...base.readingOrder,
      "navigation",
      "dialog",
      "hotspot",
      "link",
      "reveal",
      image.id,
    ],
  };
  return { scene, image, reveal, dialog, hotspot, link, navigation };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("native interaction map model", () => {
  it("lists all five action types in semantic order with interaction-only ordinals", () => {
    const { scene } = fixture();
    const items = nativeInteractionMapItems(scene, [target]);
    expect(items.map((item) => [item.node.id, item.ordinal, item.kind])).toEqual([
      ["navigation", 1, "Slide link"],
      ["dialog", 2, "Detail dialog"],
      ["hotspot", 3, "Image hotspot"],
      ["link", 4, "External link"],
      ["reveal", 5, "Reveal panel"],
    ]);
    expect(
      items.filter((item) => item.label === "Inspect evidence").map((item) => item.ordinal),
    ).toEqual([2, 5]);
    expect(items.every((item) => item.issues.length === 0)).toBe(true);
  });

  it("preserves frozen scenes, navigation targets and original node/image references", () => {
    const source = freeze(fixture());
    const targets = freeze([target]);
    const before = JSON.stringify(source);
    const items = nativeInteractionMapItems(source.scene, targets);
    expect(items.find((item) => item.node.id === "reveal")!.node).toBe(source.reveal);
    expect(items.find((item) => item.node.id === "hotspot")!.imageTarget).toBe(source.image);
    expect(JSON.stringify(source)).toBe(before);
    expect(targets).toEqual([target]);
  });

  it("resolves navigation titles case-insensitively against supplied available targets only", () => {
    const { scene } = fixture();
    const available = nativeInteractionMapItems(scene, [target])[0]!;
    expect(available.targetLabel).toBe("Decision checkpoint");
    expect(available.result).toBe("Go to “Decision checkpoint”.");
    const unavailable = nativeInteractionMapItems(scene)[0]!;
    expect(unavailable.targetLabel).toBe("Choose a slide or activity");
    expect(unavailable.issues).toEqual(["Choose an available target slide or activity."]);
    expect(unavailable.result).not.toContain(target.id);
  });

  it("describes panel, dialog and external destinations without extracting audience bodies", () => {
    const { scene } = fixture();
    const items = nativeInteractionMapItems(scene, [target]);
    expect(items.find((item) => item.node.id === "reveal")!.targetLabel).toBe(
      "Audience content in this panel",
    );
    expect(items.find((item) => item.node.id === "dialog")!.targetLabel).toBe("Evidence details");
    expect(items.find((item) => item.node.id === "link")!.targetLabel).toBe("External website");
    expect(
      items
        .map(({ trigger, result, audience, targetLabel }) =>
          JSON.stringify({ trigger, result, audience, targetLabel }),
        )
        .join(" "),
    ).not.toContain("audience body");
  });

  it("distinguishes local reveals from facilitator broadcast and preview scope", () => {
    const { scene, reveal } = fixture();
    const local = nativeInteractionMapItems(scene).find((item) => item.node.id === reveal.id)!;
    reveal.scope = "broadcast";
    const broadcast = nativeInteractionMapItems(scene).find((item) => item.node.id === reveal.id)!;
    expect(local.audience).toContain("own screen");
    expect(broadcast.trigger).toContain("facilitator");
    expect(broadcast.audience).toContain("Live: reveal for everyone");
    expect(broadcast.audience).toContain("Preview and shared links: this screen only");
  });

  it.each([
    "image rotation",
    "hotspot rotation",
    "left edge",
    "top edge",
    "right edge",
    "bottom edge",
  ])("withholds the image target for invalid %s while retaining existing guidance", (invalid) => {
    const { scene, image, hotspot } = fixture();
    if (invalid === "image rotation") image.rotation = 15;
    else if (invalid === "hotspot rotation") hotspot.rotation = 15;
    else if (invalid === "left edge") hotspot.frame.x = image.frame.x - 1;
    else if (invalid === "top edge") hotspot.frame.y = image.frame.y - 1;
    else if (invalid === "right edge") hotspot.frame.x = image.frame.x + image.frame.width;
    else hotspot.frame.y = image.frame.y + image.frame.height;
    const item = nativeInteractionMapItems(scene).find((item) => item.node.id === hotspot.id)!;
    expect(item.imageTarget).toBeUndefined();
    expect(item.issues).toContain("Keep the hotspot inside its unrotated image.");
  });

  it("accepts exact image bounds and handles deleted, missing and non-image associations", () => {
    const { scene, image, hotspot, reveal } = fixture();
    hotspot.frame = { ...image.frame };
    const item = () =>
      nativeInteractionMapItems(scene).find((item) => item.node.id === hotspot.id)!;
    expect(item().imageTarget).toBe(image);
    hotspot.imageNodeId = reveal.id;
    expect(item().imageTarget).toBeUndefined();
    expect(item().issues).toContain("Choose the image for this hotspot.");
    hotspot.imageNodeId = image.id;
    scene.nodes = scene.nodes.filter((node) => node.id !== image.id);
    expect(item().imageTarget).toBeUndefined();
    expect(item().issues).toContain("Choose the image for this hotspot.");
    hotspot.imageNodeId = null;
    expect(item().imageTarget).toBeUndefined();
  });

  it("keeps incomplete actions selectable with safe labels and guidance", () => {
    const { scene, reveal, link, navigation, dialog } = fixture();
    reveal.label = " ";
    reveal.body = "";
    link.href = "";
    navigation.targetBlockId = null;
    dialog.detailTitle = "";
    const items = nativeInteractionMapItems(scene);
    expect(items.find((item) => item.node.id === reveal.id)).toMatchObject({
      label: "Reveal panel",
      issues: ["Add a clear button or link label.", "Add the audience content to reveal."],
    });
    expect(items.find((item) => item.node.id === link.id)!.issues).toContain(
      "Add a complete, safe HTTP or HTTPS URL.",
    );
    expect(items.find((item) => item.node.id === navigation.id)!.issues).toContain(
      "Choose an available target slide or activity.",
    );
    expect(items.find((item) => item.node.id === dialog.id)!.targetLabel).toBe("Detail dialog");
  });

  it("has no items for ordinary scenes and tolerates stale reading-order entries", () => {
    expect(nativeInteractionMapItems(createNativeContentBlock().scene!)).toEqual([]);
    const { scene } = fixture();
    scene.readingOrder.unshift("deleted");
    expect(nativeInteractionMapItems(scene)).toHaveLength(5);
  });
});
