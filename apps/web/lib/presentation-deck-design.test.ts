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
import { createNativeTableNode } from "./presentation-native-data";
import {
  applyNativeDesignToDeck,
  applyNativeSceneToDeck,
  nativeSceneDocumentVersion,
} from "./presentation-deck-design";

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
    [7, 4, 8],
    [8, 1, 8],
    [8, 2, 8],
    [8, 3, 8],
    [8, 4, 8],
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
    const target = original.blocks[0]!;
    if (target.kind !== "content" || !target.scene) throw new Error("Expected a native slide");
    const table = createNativeTableNode();
    const nextScene = {
      ...target.scene,
      schemaVersion: 4 as const,
      nodes: [...target.scene.nodes, table],
      readingOrder: [...target.scene.readingOrder, table.id],
    };
    expect(() => applyNativeSceneToDeck(original, target.id, nextScene)).toThrow(/3 MiB/);
    expect(JSON.stringify(original)).toBe(source);
    const reduced = structuredClone(original);
    const last = reduced.blocks.at(-1)!;
    if (last.kind !== "content" || !last.scene) throw new Error("Expected a native slide");
    const body = last.scene.nodes.find(
      (node) => node.type === "text" && node.role === "body" && node.text.length >= 1000,
    );
    if (body?.type !== "text") throw new Error("Expected long body text");
    body.text = body.text.slice(1000);
    const accepted = applyNativeSceneToDeck(reduced, target.id, nextScene);
    expect(accepted.schemaVersion).toBe(8);
    expect(accepted.blocks[0]).toEqual({ ...target, scene: nextScene });
    expect(accepted.blocks[1]).toBe(reduced.blocks[1]);
  });

  it("preserves composition content and document floors through bulk design, hiding and older native edits", () => {
    const original = draft();
    const block = original.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected a native slide");
    const table = createNativeTableNode();
    block.scene = {
      ...block.scene,
      schemaVersion: 4,
      nodes: [...block.scene.nodes, table],
      readingOrder: [...block.scene.readingOrder, table.id],
      groups: [{ id: "group", nodeIds: [block.scene.nodes[0]!.id, table.id] }],
    };
    original.schemaVersion = 8;
    const changed = applyNativeDesignToDeck(original, design);
    const first = changed.blocks[0]!;
    if (first.kind !== "content" || !first.scene) throw new Error("Expected the designed slide");
    expect(first.scene).toEqual({ ...block.scene, design });
    expect(changed.schemaVersion).toBe(8);
    expect(setPresentationSlideHidden(changed, first.id, true).schemaVersion).toBe(8);
    const legacy = changed.blocks[1]!;
    if (legacy.kind !== "content" || !legacy.scene)
      throw new Error("Expected the other native slide");
    const olderScene = { ...legacy.scene, schemaVersion: 1 as const };
    delete olderScene.design;
    const updated = applyNativeSceneToDeck(changed, legacy.id, olderScene);
    expect(updated.schemaVersion).toBe(8);
    expect(updated.blocks[0]).toBe(changed.blocks[0]);
    expect(applyNativeDesignToDeck(changed, design)).toBe(changed);
  });
});
