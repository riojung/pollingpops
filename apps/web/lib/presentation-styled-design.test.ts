import { describe, expect, it } from "vitest";
import { PresentationDraftSchema } from "@openround/contracts";
import { createNativeContentBlock } from "./presentation-native-scene";
import { applyNativeSceneDesign } from "./presentation-native-design";
import {
  applyNativeDesignToDeck,
  applyNativeSceneToDeck,
  nativeSceneDocumentVersion,
} from "./presentation-deck-design";
import {
  normalizePresentationRecoveryDraft,
  promotePresentationOpinionFormats,
} from "./presentation-builder";

describe("styled collection document promotion and recovery", () => {
  it("promotes explicit styling to scene9/document18 and preserves it through recovery, later editing and design removal", () => {
    const block = createNativeContentBlock();
    const draft = PresentationDraftSchema.parse({
      title: "Styled",
      description: "",
      schemaVersion: 4,
      blocks: [block],
    });
    const design = { theme: "paper", palette: "ink", font: "serif", spacing: "compact" } as const;
    const styled = applyNativeSceneDesign(block.scene!, design);
    expect(styled.schemaVersion).toBe(9);
    expect(nativeSceneDocumentVersion(4, styled)).toBe(18);
    const next = applyNativeSceneToDeck(draft, block.id, styled);
    expect(next.schemaVersion).toBe(18);
    expect(normalizePresentationRecoveryDraft(JSON.parse(JSON.stringify(next)))).toEqual(next);
    const removed = applyNativeDesignToDeck(next, {
      theme: "paper",
      font: "sans",
      spacing: "relaxed",
    });
    expect(removed.schemaVersion).toBe(18);
    expect(removed.blocks[0]!.kind === "content" && removed.blocks[0]!.scene?.schemaVersion).toBe(
      9,
    );
    expect(promotePresentationOpinionFormats({ ...next, schemaVersion: 16 }).schemaVersion).toBe(
      18,
    );
    expect(draft.schemaVersion).toBe(4);
    expect(block.scene!.schemaVersion).toBe(1);
  });
  it("honors explicit slide font edits while retaining authored type size, paint, frames and rich text", () => {
    const block = createNativeContentBlock();
    const scene = applyNativeSceneDesign(block.scene!, {
      theme: "paper",
      palette: "sand",
      font: "sans",
      spacing: "relaxed",
    });
    scene.nodes = scene.nodes.map((node) =>
      node.type === "text"
        ? {
            ...node,
            typography: { font: "serif", size: 96, weight: 800, color: "accent", leading: 1 },
          }
        : node,
    );
    const changed = applyNativeSceneDesign(scene, { ...scene.design!, font: "mono" });
    const title = changed.nodes.find((node) => node.type === "text")!;
    if (title.type !== "text") throw new Error("Expected text");
    expect(title.typography).toEqual({ size: 96, weight: 800, color: "accent", leading: 1 });
    expect(title.frame).toEqual(scene.nodes[0]!.type !== "connector" && scene.nodes[0]!.frame);
    expect(applyNativeSceneDesign(scene, { ...scene.design!, spacing: "compact" }).nodes).toEqual(
      scene.nodes,
    );
    const draft = PresentationDraftSchema.parse({
      title: "Styled",
      description: "",
      schemaVersion: 18,
      blocks: [{ ...block, scene }],
    });
    const bulk = applyNativeDesignToDeck(draft, { ...scene.design!, font: "mono" });
    const bulkScene = bulk.blocks[0]!.kind === "content" && bulk.blocks[0]!.scene;
    expect(bulkScene && bulkScene.nodes).toEqual(changed.nodes);
    expect(scene.nodes.find((node) => node.type === "text")!.typography?.font).toBe("serif");
  });
});
