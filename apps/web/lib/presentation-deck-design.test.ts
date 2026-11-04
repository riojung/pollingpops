import { describe, expect, it } from "vitest";
import {
  PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES,
  PresentationDraftSchema,
  type PresentationDraft,
  type PresentationSceneDesign,
} from "@openround/contracts";
import {
  createContentBlock,
  createQuestionBlock,
  setPresentationSlideHidden,
} from "./presentation-builder";
import { createNativeContentBlock } from "./presentation-native-scene";
import { applyNativeDesignToDeck, nativeSceneDocumentVersion } from "./presentation-deck-design";

const design: PresentationSceneDesign = { theme: "midnight", font: "serif", spacing: "relaxed" };

function draft(): PresentationDraft {
  const first = createNativeContentBlock();
  first.speakerNotes = "Private speaker cue";
  first.citations = [{ locator: "Source page 1", excerpt: "Private citation" }];
  const hidden = createNativeContentBlock();
  return {
    title: "Design workshop",
    description: "Preserve this description",
    schemaVersion: 6,
    experiencePreset: { id: "focus", version: 1 },
    blocks: [first, { ...hidden, hidden: true }, createContentBlock(), createQuestionBlock()],
  };
}

describe("native design across a Presentation", () => {
  it("changes design in all native slides while retaining content, IDs, hidden state and ordinary blocks", () => {
    const original = draft();
    const snapshot = structuredClone(original);
    const updated = applyNativeDesignToDeck(original, design);
    expect(updated.schemaVersion).toBe(7);
    expect(updated.title).toBe(original.title);
    expect(updated.description).toBe(original.description);
    for (const [index, block] of updated.blocks.entries()) {
      const source = snapshot.blocks[index]!;
      if (block.kind !== "content" || !block.scene) {
        expect(block).toBe(original.blocks[index]);
        expect(block).toEqual(source);
        continue;
      }
      expect(block.scene.schemaVersion).toBe(3);
      expect(block.scene.design).toEqual(design);
      if (source.kind !== "content" || !source.scene) throw new Error("Expected native source");
      expect({ ...block, scene: undefined }).toEqual({ ...source, scene: undefined });
      expect(block.scene.nodes).toEqual(source.scene.nodes);
      expect(block.scene.readingOrder).toEqual(source.scene.readingOrder);
    }
    expect(PresentationDraftSchema.safeParse(updated).success).toBe(true);
    expect(original).toEqual(snapshot);
    expect(applyNativeDesignToDeck(updated, design)).toBe(updated);
  });

  it("leaves a deck without native slides unchanged", () => {
    const ordinary = { ...draft(), schemaVersion: 2 as const, blocks: [createContentBlock()] };
    expect(applyNativeDesignToDeck(ordinary, design)).toBe(ordinary);
  });

  it("rejects unsupported tokens without modifying any slide", () => {
    const original = draft();
    const snapshot = structuredClone(original);
    expect(() =>
      applyNativeDesignToDeck(original, { ...design, font: "url(evil)" } as never),
    ).toThrow();
    expect(original).toEqual(snapshot);
  });

  it("preserves document v7 when a designed slide is hidden and shown", () => {
    const original = applyNativeDesignToDeck(draft(), design);
    const first = original.blocks[0]!;
    const hidden = setPresentationSlideHidden(original, first.id, true);
    expect(hidden.schemaVersion).toBe(7);
    expect(setPresentationSlideHidden(hidden, first.id, false)).toEqual(original);
    expect(PresentationDraftSchema.safeParse(hidden).success).toBe(true);
  });

  it.each([
    [2, 1, 4],
    [4, 2, 5],
    [6, 2, 6],
    [6, 3, 7],
    [7, 1, 7],
    [7, 2, 7],
    [7, 3, 7],
  ] as const)(
    "preserves/promotes document %s for scene %s to %s",
    (current, sceneVersion, expected) => {
      expect(nativeSceneDocumentVersion(current, { schemaVersion: sceneVersion })).toBe(expected);
    },
  );

  it("refuses an all-slide design that exceeds the document budget without changing the source", () => {
    const original = draft();
    original.blocks = Array.from({ length: 32 }, () => {
      const block = createNativeContentBlock();
      const scene = block.scene!;
      for (let index = 0; index < 24; index++) {
        const id = `${block.id}-body-${index}`;
        scene.nodes.push({
          id,
          type: "text",
          role: "body",
          text: "x".repeat(4_000),
          frame: { x: 8, y: 35, width: 84, height: 40 },
        });
        scene.readingOrder.push(id);
      }
      return block;
    });
    let excess =
      new TextEncoder().encode(JSON.stringify(original)).byteLength -
      (PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES - 1);
    expect(excess).toBeGreaterThan(0);
    for (const block of [...original.blocks].reverse()) {
      if (block.kind !== "content" || !block.scene) continue;
      for (const node of [...block.scene.nodes].reverse()) {
        if (node.type !== "text" || node.role !== "body" || excess <= 0) continue;
        const removed = Math.min(node.text.length, excess);
        node.text = node.text.slice(removed);
        excess -= removed;
      }
    }
    expect(excess).toBe(0);
    expect(PresentationDraftSchema.safeParse(original).success).toBe(true);
    const source = JSON.stringify(original);
    expect(() => applyNativeDesignToDeck(original, design)).toThrow(/3 MiB/);
    expect(JSON.stringify(original)).toBe(source);
  });
});
