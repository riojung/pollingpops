import { describe, expect, it } from "vitest";
import {
  PresentationDraftSchema,
  PresentationSceneDraftSchema,
  type PresentationDraft,
  type PresentationScene,
} from "@openround/contracts";
import {
  contentSlideTitle,
  duplicatePresentationBlock,
  normalizePresentationRecoveryDraft,
  presentationReadiness,
} from "./presentation-builder";
import {
  boundNativeSceneFrame,
  createNativeContentBlock,
  removeNativeNode,
  reorderNativeNode,
  updateNativeNode,
} from "./presentation-native-scene";

function nativeSceneFixture(): PresentationScene {
  return {
    schemaVersion: 1,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Native workflow",
        frame: { x: 8, y: 8, width: 84, height: 20 },
      },
      {
        id: "shape",
        type: "shape",
        shape: "diamond",
        color: "blue",
        label: "Decision",
        frame: { x: 40, y: 40, width: 25, height: 30 },
      },
      {
        id: "body",
        type: "text",
        role: "body",
        text: "Start here",
        frame: { x: 8, y: 40, width: 25, height: 20 },
      },
      {
        id: "edge",
        type: "connector",
        from: { nodeId: "body", anchor: "right" },
        to: { nodeId: "shape", anchor: "left" },
        label: "Continue",
        color: "blue",
      },
    ],
    readingOrder: ["title", "body", "shape", "edge"],
  };
}

function draft(): PresentationDraft {
  return {
    title: "Native deck",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 4,
    blocks: [
      { ...createNativeContentBlock(), scene: nativeSceneFixture(), speakerNotes: "Private notes" },
    ],
  };
}

describe("native Presentation authoring operations", () => {
  it("creates a valid incomplete scene and preserves all visual edits through recovery", () => {
    expect(PresentationSceneDraftSchema.safeParse(createNativeContentBlock().scene).success).toBe(
      true,
    );
    const edited = draft();
    const block = edited.blocks[0]!;
    if (block.kind !== "content") throw new Error("fixture");
    block.scene = updateNativeNode(block.scene!, "body", (node) =>
      node.type === "text"
        ? { ...node, text: "Recovered evidence", frame: { ...node.frame, x: 12 } }
        : node,
    );
    block.scene = reorderNativeNode(block.scene, "shape", -1);
    const restored = normalizePresentationRecoveryDraft(JSON.parse(JSON.stringify(edited)));
    expect(restored).toEqual(edited);
    expect(PresentationDraftSchema.safeParse(restored).success).toBe(true);
    expect(contentSlideTitle(block)).toBe("Native workflow");
    expect(presentationReadiness(restored)).toEqual([]);
  });

  it("remaps every node, endpoint and reading-order reference when duplicating", () => {
    const original = draft().blocks[0]!;
    const before = structuredClone(original);
    const copy = duplicatePresentationBlock(original);
    expect(original).toEqual(before);
    expect(copy.id).not.toBe(original.id);
    if (copy.kind !== "content" || original.kind !== "content") throw new Error("fixture");
    expect(copy.speakerNotes).toBe("Private notes");
    expect(PresentationSceneDraftSchema.safeParse(copy.scene).success).toBe(true);
    const originalIds = new Set(original.scene!.nodes.map((node) => node.id));
    expect(copy.scene!.nodes.every((node) => !originalIds.has(node.id))).toBe(true);
    const edge = copy.scene!.nodes.find((node) => node.type === "connector")!;
    if (edge.type !== "connector") throw new Error("fixture");
    expect(edge.from.nodeId).toBe(
      copy.scene!.nodes.find((node) => node.type === "text" && node.role === "body")!.id,
    );
    expect(edge.to.nodeId).toBe(copy.scene!.nodes.find((node) => node.type === "shape")!.id);
    expect(copy.scene!.readingOrder[1]).toBe(edge.from.nodeId);
  });

  it("deletes connected edges atomically and retains the required title", () => {
    const scene = nativeSceneFixture();
    const removed = removeNativeNode(scene, "shape");
    expect(removed.nodes.map((node) => node.id)).toEqual(["title", "body"]);
    expect(removed.readingOrder).toEqual(["title", "body"]);
    expect(PresentationSceneDraftSchema.safeParse(removed).success).toBe(true);
    expect(removeNativeNode(scene, "title")).toBe(scene);
  });

  it("bounds movement and resizing within the slide", () => {
    expect(boundNativeSceneFrame({ x: -10, y: 110, width: 150, height: -5 })).toEqual({
      x: 0,
      y: 99,
      width: 100,
      height: 1,
    });
  });

  it("reports native accessibility failures without legacy empty-text errors", () => {
    const input = draft();
    const block = input.blocks[0]!;
    if (block.kind !== "content") throw new Error("fixture");
    block.scene!.nodes.push({
      id: "image",
      type: "image",
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: null,
      frame: { x: 70, y: 40, width: 20, height: 30 },
    });
    block.scene!.readingOrder.push("image");
    const issues = presentationReadiness(input);
    expect(issues.some((issue) => issue.field === "altText")).toBe(true);
    expect(issues.some((issue) => issue.message === "Add content to this slide.")).toBe(false);
  });
});
