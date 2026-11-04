import { describe, expect, it } from "vitest";
import { PresentationSceneDraftSchema, type PresentationScene } from "@openround/contracts";
import {
  INITIAL_NATIVE_DESIGN,
  NATIVE_DESIGN_THEMES,
  NATIVE_LAYOUT_PRESETS,
  alignNativeSceneNodes,
  applyNativeLayout,
  applyNativeSceneDesign,
  canApplyNativeLayout,
  canDistributeNativeSceneNodes,
  canLayerNativeSceneNode,
  distributeNativeSceneNodes,
  layerNativeSceneNode,
} from "./presentation-native-design";

function fixture(bodyCount = 1, image = false): PresentationScene {
  const nodes: PresentationScene["nodes"] = [
    {
      id: "title",
      type: "text",
      role: "title",
      text: "Title",
      richText: { paragraphs: [{ kind: "paragraph", runs: [{ text: "Title", bold: true }] }] },
      frame: { x: 0, y: 0, width: 20, height: 10 },
    },
  ];
  for (let i = 0; i < bodyCount; i++)
    nodes.push({
      id: `body${i}`,
      type: "text",
      role: "body",
      text: `Body ${i}`,
      richText: {
        paragraphs: [{ kind: "paragraph", runs: [{ text: `Body ${i}`, italic: true }] }],
      },
      frame: { x: 10 + i * 30, y: 30 + i * 10, width: 15 + i, height: 20 },
    });
  if (image)
    nodes.push({
      id: "image",
      type: "image",
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: "Evidence",
      fit: "cover",
      focalPoint: { x: 20, y: 80 },
      frame: { x: 60, y: 20, width: 30, height: 50 },
    });
  nodes.push({
    id: "edge",
    type: "connector",
    from: { nodeId: "title", anchor: "bottom" },
    to: { nodeId: "body0", anchor: "top" },
    color: "blue",
    label: "Continue",
  });
  return {
    schemaVersion: 3,
    aspectRatio: "16:9",
    design: INITIAL_NATIVE_DESIGN,
    nodes,
    readingOrder: nodes.map((node) => node.id),
  };
}

function frame(scene: PresentationScene, id: string) {
  const node = scene.nodes.find((node) => node.id === id)!;
  if (node.type === "connector") throw new Error("not framed");
  return node.frame;
}

function content(scene: PresentationScene) {
  return scene.nodes.map((node) => {
    if (node.type === "connector") return node;
    const { frame: _frame, ...content } = node;
    void _frame;
    return content;
  });
}

function contrast(a: string, b: string) {
  function luminance(hex: string) {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  }
  const left = luminance(a),
    right = luminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

describe("native design and conservative layouts", () => {
  it("opts into scene 3 without mutating or adding defaults to the source", () => {
    const legacy: PresentationScene = { ...fixture(), schemaVersion: 2 };
    delete legacy.design;
    const original = structuredClone(legacy);
    const designed = applyNativeSceneDesign(legacy, {
      theme: "midnight",
      font: "serif",
      spacing: "compact",
    });
    expect(legacy).toEqual(original);
    expect(designed.schemaVersion).toBe(3);
    expect(designed.design).toEqual({ theme: "midnight", font: "serif", spacing: "compact" });
    expect(designed.nodes).toEqual(legacy.nodes);
  });

  it("keeps every palette text and link above 4.5:1 contrast", () => {
    Object.values(NATIVE_DESIGN_THEMES).forEach((palette) => {
      expect(contrast(palette.background, palette.text)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.background, palette.link)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it.each([
    ["title_body", 1, false],
    ["split", 2, false],
    ["image_left", 1, true],
    ["image_right", 1, true],
    ["three_columns", 3, false],
  ] as const)(
    "repositions %s while preserving rich content, IDs, media, connectors and reading order",
    (preset, count, image) => {
      const scene = fixture(count, image);
      const original = structuredClone(scene);
      expect(canApplyNativeLayout(scene, preset)).toBe(true);
      const next = applyNativeLayout(scene, preset);
      expect(content(next)).toEqual(content(original));
      expect(next.readingOrder).toEqual(original.readingOrder);
      expect(next.design).toEqual(original.design);
      expect(scene).toEqual(original);
      expect(PresentationSceneDraftSchema.safeParse(next).success).toBe(true);
      const frames = next.nodes
        .filter((node) => node.type !== "connector")
        .map((node) => node.frame);
      for (let i = 0; i < frames.length; i++)
        for (let j = i + 1; j < frames.length; j++) {
          const a = frames[i]!,
            b = frames[j]!;
          expect(
            a.x + a.width <= b.x ||
              b.x + b.width <= a.x ||
              a.y + a.height <= b.y ||
              b.y + b.height <= a.y,
          ).toBe(true);
        }
    },
  );

  it("leaves unsupported counts and node types unchanged instead of dropping or overlapping objects", () => {
    const scene = fixture(4);
    for (const preset of NATIVE_LAYOUT_PRESETS) {
      expect(canApplyNativeLayout(scene, preset.id)).toBe(false);
      expect(applyNativeLayout(scene, preset.id)).toBe(scene);
    }
    const withShape = fixture();
    withShape.nodes.push({
      id: "shape",
      type: "shape",
      shape: "rectangle",
      color: "blue",
      label: "Decision",
      frame: { x: 20, y: 20, width: 10, height: 10 },
    });
    withShape.readingOrder.push("shape");
    expect(applyNativeLayout(withShape, "title_body")).toBe(withShape);
  });
});

describe("native arrange operations", () => {
  it.each(["left", "center", "right", "top", "middle", "bottom"] as const)(
    "aligns %s inside selected bounds while leaving connector and unselected content untouched",
    (alignment) => {
      const scene = fixture(3);
      const next = alignNativeSceneNodes(scene, ["body0", "body1", "edge"], alignment);
      const a = frame(next, "body0"),
        b = frame(next, "body1");
      const selectedAxis =
        alignment === "left"
          ? [a.x, b.x]
          : alignment === "right"
            ? [a.x + a.width, b.x + b.width]
            : alignment === "center"
              ? [a.x + a.width / 2, b.x + b.width / 2]
              : alignment === "top"
                ? [a.y, b.y]
                : alignment === "bottom"
                  ? [a.y + a.height, b.y + b.height]
                  : [a.y + a.height / 2, b.y + b.height / 2];
      expect(selectedAxis[0]).toBeCloseTo(selectedAxis[1]!);
      expect(next.nodes.find((node) => node.id === "body2")).toBe(
        scene.nodes.find((node) => node.id === "body2"),
      );
      expect(next.readingOrder).toBe(scene.readingOrder);
      expect(content(next)).toEqual(content(scene));
      expect(PresentationSceneDraftSchema.safeParse(next).success).toBe(true);
    },
  );

  it("distributes equal nonnegative gaps with fixed outer anchors and variable sizes", () => {
    const scene = fixture(3);
    const next = distributeNativeSceneNodes(
      scene,
      ["body2", "body0", "body1", "edge"],
      "horizontal",
    );
    const a = frame(next, "body0"),
      b = frame(next, "body1"),
      c = frame(next, "body2");
    expect(a).toEqual(frame(scene, "body0"));
    expect(c).toEqual(frame(scene, "body2"));
    expect(b.x - a.x - a.width).toBeCloseTo(c.x - b.x - b.width);
    expect(b.x - a.x - a.width).toBeGreaterThanOrEqual(0);
    expect(content(next)).toEqual(content(scene));
    expect(PresentationSceneDraftSchema.safeParse(next).success).toBe(true);
  });

  it("rejects a distribution requiring overlap and selections with too few framed nodes", () => {
    const scene = fixture(3);
    expect(canDistributeNativeSceneNodes(scene, ["body0", "body1", "body2"], "vertical")).toBe(
      false,
    );
    expect(distributeNativeSceneNodes(scene, ["body0", "body1", "body2"], "vertical")).toBe(scene);
    expect(alignNativeSceneNodes(scene, ["body0", "edge"], "left")).toBe(scene);
    expect(distributeNativeSceneNodes(scene, ["body0", "body1", "edge"], "horizontal")).toBe(scene);
  });

  it("keeps fractional frames within scene bounds at the right and bottom edges", () => {
    const scene = fixture(3);
    ["body0", "body1", "body2"].forEach((id, i) => {
      const node = scene.nodes.find((node) => node.id === id)!;
      if (node.type !== "connector")
        node.frame = {
          x: i * 30.33333333333333,
          y: i * 30.33333333333333,
          width: 39.333333333333336,
          height: 39.333333333333336,
        };
    });
    for (const alignment of ["right", "bottom", "center", "middle"] as const)
      expect(
        PresentationSceneDraftSchema.safeParse(
          alignNativeSceneNodes(scene, ["body0", "body1", "body2"], alignment),
        ).success,
      ).toBe(true);
  });

  it("changes only visual stacking in stable steps, preserving reading order and connector slots", () => {
    const scene = fixture(2);
    const front = layerNativeSceneNode(scene, "title", "front");
    expect(front.nodes.map((node) => node.id)).toEqual(["body0", "body1", "title", "edge"]);
    expect(front.readingOrder).toBe(scene.readingOrder);
    expect(new Map(front.nodes.map((node) => [node.id, node]))).toEqual(
      new Map(scene.nodes.map((node) => [node.id, node])),
    );
    expect(layerNativeSceneNode(front, "title", "back")).toEqual(scene);
    expect(layerNativeSceneNode(scene, "title", "forward").nodes.map((node) => node.id)).toEqual([
      "body0",
      "title",
      "body1",
      "edge",
    ]);
    expect(canLayerNativeSceneNode(scene, "edge", "front")).toBe(false);
    expect(canLayerNativeSceneNode(scene, "title", "backward")).toBe(false);
  });
});
