import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationSceneDraftSchema,
  PresentationSceneSchema,
  type PresentationDraft,
  type PresentationScene,
} from "@openround/contracts";
import {
  createNativeContentBlock,
  createNativeHotspotNode,
  duplicateNativeScene,
} from "./presentation-native-scene";
import {
  moveNativeSceneNodes,
  resizeNativeSceneNode,
  removeNativeSceneNodes,
} from "./presentation-native-geometry";
import {
  createQuestionBlock,
  duplicatePresentationBlock,
  presentationInteractionTargets,
  enablePresentationSections,
} from "./presentation-builder";
import { applyNativeSceneToDeck } from "./presentation-deck-design";

function scene(): PresentationScene {
  const base = createNativeContentBlock().scene!;
  const title = base.nodes[0]!;
  if (title.type !== "text") throw new Error("Title required");
  title.text = "Image details";
  const image = {
    id: "image",
    type: "image" as const,
    mediaId: "11111111-1111-4111-8111-111111111111",
    altText: "Workflow diagram",
    frame: { x: 10, y: 35, width: 60, height: 40 },
  };
  const hotspot = {
    ...createNativeHotspotNode(image),
    label: "Inspect step",
    detailTitle: "The detail",
    body: "Audience-only detail",
  };
  return {
    ...base,
    schemaVersion: 6,
    nodes: [...base.nodes, image, hotspot],
    readingOrder: [...base.readingOrder, image.id, hotspot.id],
  };
}
const draft = (blocks: PresentationDraft["blocks"]): PresentationDraft => ({
  title: "Advanced interactions",
  description: "",
  experiencePreset: { id: "focus", version: 1 },
  schemaVersion: 13,
  sections: [],
  blocks,
});

describe("Advanced interaction authoring references", () => {
  it("moves and scales image hotspots without changing detail content or source state", () => {
    const original = scene();
    const before = structuredClone(original);
    const hotspot = original.nodes.find((node) => node.type === "hotspot")!;
    if (hotspot.type !== "hotspot") throw new Error("Hotspot required");
    const moved = moveNativeSceneNodes(original, ["image"], 5, 4);
    expect(moved.nodes.find((node) => node.id === hotspot.id)).toMatchObject({
      frame: { ...hotspot.frame, x: hotspot.frame.x + 5, y: hotspot.frame.y + 4 },
      body: hotspot.body,
    });
    const resized = resizeNativeSceneNode(moved, "image", 12, 8);
    const scaled = resized.nodes.find((node) => node.id === hotspot.id)!;
    if (scaled.type !== "hotspot") throw new Error("Hotspot required");
    expect(scaled.frame.width).toBeCloseTo(hotspot.frame.width * 1.2);
    expect(scaled.frame.height).toBeCloseTo(hotspot.frame.height * 1.2);
    expect(PresentationSceneSchema.safeParse(resized).success).toBe(true);
    expect(original).toEqual(before);
  });
  it("remaps image references when duplicating and preserves a repairable detail when its image is removed", () => {
    const original = scene();
    const copied = duplicateNativeScene(original);
    const image = copied.nodes.find((node) => node.type === "image")!;
    const hotspot = copied.nodes.find((node) => node.type === "hotspot")!;
    if (hotspot.type !== "hotspot") throw new Error("Hotspot required");
    expect(hotspot.imageNodeId).toBe(image.id);
    expect(image.id).not.toBe("image");
    const removed = removeNativeSceneNodes(copied, [image.id]);
    expect(removed.nodes.find((node) => node.id === hotspot.id)).toMatchObject({
      imageNodeId: null,
      body: hotspot.body,
    });
    expect(PresentationSceneDraftSchema.safeParse(removed).success).toBe(true);
    expect(PresentationSceneSchema.safeParse(removed).success).toBe(false);
  });
  it("promotes scene6 to document13 and keeps advanced content through draft validation", () => {
    const block = createNativeContentBlock();
    const previous = { ...draft([block]), schemaVersion: 4 as const };
    delete previous.sections;
    const result = applyNativeSceneToDeck(previous, block.id, scene());
    expect(result.schemaVersion).toBe(13);
    expect(result.sections).toEqual([]);
    expect(PresentationDraftSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
    const withoutSections = { ...result };
    delete withoutSections.sections;
    expect(enablePresentationSections(withoutSections).schemaVersion).toBe(13);
  });
  it("remaps branch and answer-choice identities while retaining the frozen target", () => {
    const block = createQuestionBlock();
    if (!("choices" in block.question)) throw new Error("Choice fixture required");
    block.branches = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        label: "Review this idea",
        condition: {
          kind: "choice_share",
          choiceId: block.question.choices[0]!.id.toUpperCase(),
          minPercent: 50,
          minResponses: 1,
        },
        targetBlockId: "33333333-3333-4333-8333-333333333333",
      },
    ];
    const copy = duplicatePresentationBlock(block);
    if (copy.kind !== "question" || !("choices" in copy.question))
      throw new Error("Choice copy required");
    expect(copy.branches?.[0]?.id).not.toBe(block.branches[0]!.id);
    expect(copy.branches?.[0]?.condition).toMatchObject({ choiceId: copy.question.choices[0]!.id });
    expect(copy.branches?.[0]?.targetBlockId).toBe(block.branches[0]!.targetBlockId);
  });
  it("offers only stable safe targets and leaves a removed target visibly invalid for publication", () => {
    const first = createNativeContentBlock();
    const target = createNativeContentBlock();
    const hidden = { ...createNativeContentBlock(), hidden: true as const };
    const input = draft([first, target, hidden]);
    expect(presentationInteractionTargets(input, first.id).map((entry) => entry.id)).toEqual([
      target.id,
    ]);
    const node = {
      id: "navigation",
      type: "navigation" as const,
      label: "Read more",
      targetBlockId: target.id,
      frame: { x: 10, y: 40, width: 30, height: 20 },
    };
    const actual = scene();
    first.scene = {
      ...actual,
      nodes: [...actual.nodes, node],
      readingOrder: [...actual.readingOrder, node.id],
    };
    const removed = { ...input, blocks: [first] };
    expect(PresentationDraftSchema.safeParse(removed).success).toBe(true);
    expect(PresentationContentSchema.safeParse(removed).success).toBe(false);
    expect(presentationInteractionTargets(removed, first.id)).toEqual([]);
  });
});
