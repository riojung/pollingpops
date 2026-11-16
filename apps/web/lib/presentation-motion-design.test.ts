import { describe, expect, it } from "vitest";
import {
  PresentationDraftSchema,
  type PresentationDraft,
  type PresentationSceneDesign,
} from "@openround/contracts";
import { createNativeContentBlock, duplicateNativeScene } from "./presentation-native-scene";
import {
  createQuestionBlock,
  promotePresentationOpinionFormats,
  normalizePresentationRecoveryDraft,
} from "./presentation-builder";
import {
  applyNativeDesignToDeck,
  applyNativeSceneToDeck,
  nativeSceneDocumentVersion,
} from "./presentation-deck-design";
import { applyNativeSceneDesign } from "./presentation-native-design";
import {
  copyPresentationSceneDesign,
  inheritPresentationSceneDesign,
  resolvePresentationActivityDesign,
} from "./presentation-activity-design";

const motion: PresentationSceneDesign = {
  theme: "ocean",
  font: "sans",
  spacing: "relaxed",
  motionBackground: "waves",
};
function draft(): PresentationDraft {
  return {
    schemaVersion: 4,
    title: "A focused briefing",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    blocks: [createNativeContentBlock(), createQuestionBlock("poll"), createNativeContentBlock()],
  };
}

describe("motion background design persistence", () => {
  it("opts into scene8/document17 only on an explicit change and does not mutate original content", () => {
    const source = draft();
    const original = structuredClone(source);
    const block = source.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected native content");
    const scene = applyNativeSceneDesign(block.scene, motion);
    expect(scene.schemaVersion).toBe(8);
    const changed = applyNativeSceneToDeck(source, block.id, scene);
    expect(changed.schemaVersion).toBe(17);
    expect(PresentationDraftSchema.safeParse(changed).success).toBe(true);
    expect(source).toEqual(original);
    expect(nativeSceneDocumentVersion(16, scene)).toBe(17);
    expect(nativeSceneDocumentVersion(17, { schemaVersion: 1 })).toBe(17);
    expect(normalizePresentationRecoveryDraft(changed)).toEqual(changed);
  });

  it("includes motion in bulk design changes and no-op detection, then clears it without downgrading", () => {
    const source = draft();
    const { motionBackground, ...still } = motion;
    expect(motionBackground).toBe("waves");
    const plain = applyNativeDesignToDeck(source, still);
    expect(plain.schemaVersion).toBe(7);
    const changed = applyNativeDesignToDeck(plain, motion);
    expect(changed).not.toBe(plain);
    expect(changed.schemaVersion).toBe(17);
    for (const block of changed.blocks)
      if (block.kind === "content") {
        expect(block.scene!.schemaVersion).toBe(8);
        expect(block.scene!.design).toEqual(motion);
      }
    expect(applyNativeDesignToDeck(changed, { ...motion })).toBe(changed);
    const cleared = applyNativeDesignToDeck(changed, still);
    expect(cleared.schemaVersion).toBe(17);
    for (const block of cleared.blocks)
      if (block.kind === "content") {
        expect(block.scene!.schemaVersion).toBe(8);
        expect(block.scene!.design).not.toHaveProperty("motionBackground");
      }
    expect(PresentationDraftSchema.safeParse(cleared).success).toBe(true);
  });

  it("preserves motion for duplicate scenes, inserted slides and inherited audience activity design", () => {
    const changed = applyNativeDesignToDeck(draft(), motion);
    const block = changed.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected native content");
    const copy = duplicateNativeScene(block.scene);
    expect(copy.design).toEqual(motion);
    const editedCopy = applyNativeSceneDesign(copy, { ...motion, motionBackground: "orbs" });
    expect(editedCopy.design!.motionBackground).toBe("orbs");
    expect(block.scene.design!.motionBackground).toBe("waves");
    expect(copy.schemaVersion).toBe(8);
    expect(copy.nodes[0]!.id).not.toBe(block.scene.nodes[0]!.id);
    expect(inheritPresentationSceneDesign(changed.blocks, changed.blocks[1]!.id)).toEqual(motion);
    expect(resolvePresentationActivityDesign(changed.blocks, changed.blocks[1]!.id)).toEqual(
      motion,
    );
    const sanitized = copyPresentationSceneDesign({
      ...motion,
      motionBackground: "url(untrusted)",
    } as never);
    expect(sanitized).not.toHaveProperty("motionBackground");
    expect(copyPresentationSceneDesign(motion)).toEqual(motion);
  });

  it("promotes recovered motion scenes through normal editor history reconciliation", () => {
    const source = draft();
    const first = source.blocks[0]!;
    if (first.kind !== "content" || !first.scene) throw new Error("Expected native content");
    first.scene = applyNativeSceneDesign(first.scene, motion);
    const promoted = promotePresentationOpinionFormats(source);
    expect(promoted.schemaVersion).toBe(17);
    expect(PresentationDraftSchema.safeParse(promoted).success).toBe(true);
    expect(source.schemaVersion).toBe(4);
  });
});
