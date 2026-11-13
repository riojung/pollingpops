import { describe, expect, it } from "vitest";
import {
  PRESENTATION_SCENE_MAX_BYTES,
  PresentationDraftSchema,
  PresentationSceneDraftSchema,
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  plainTextToPresentationRichText,
  type PresentationDraft,
  type PresentationScene,
} from "@openround/contracts";
import { setNativeTextLanguage } from "./presentation-native-text-language";
import {
  applyNativeDesignToDeck,
  applyNativeSceneToDeck,
  nativeSceneDocumentVersion,
} from "./presentation-deck-design";
import {
  updateNativeNode,
  duplicateNativeScene,
  reorderNativeNode,
} from "./presentation-native-scene";
import {
  promotePresentationOpinionFormats,
  normalizePresentationRecoveryDraft,
} from "./presentation-builder";
import { applyNativeLayout } from "./presentation-native-design";

const blockId = "00000000-0000-4000-8000-000000000001";
const scene = (): PresentationScene => ({
  schemaVersion: 6,
  aspectRatio: "16:9",
  design: { theme: "ocean", font: "serif", spacing: "compact" },
  groups: [],
  nodes: [
    {
      id: "Title",
      type: "text",
      role: "title",
      text: "Evidence",
      frame: { x: 7, y: 5, width: 86, height: 18 },
    },
    {
      id: "Body:Exact",
      type: "text",
      role: "body",
      text: "Review the evidence.",
      frame: { x: 7, y: 30, width: 86, height: 60 },
    },
  ],
  readingOrder: ["Title", "Body:Exact"],
});
function draft(): PresentationDraft {
  return PresentationDraftSchema.parse({
    schemaVersion: 15,
    title: "Original deck",
    sections: [],
    spatial: { schemaVersion: 1, frames: [{ blockId, x: 0, y: 0, width: 1280, height: 720 }] },
    blocks: [
      {
        id: blockId,
        kind: "content",
        layout: "title_body",
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "Private notes",
        scene: scene(),
        citations: [{ locator: "Page 1", excerpt: "Original source" }],
        sourceDisclosure: {
          sourceName: "Original",
          sourceDigest: "a".repeat(64),
          provider: "original",
          model: "source",
          conversionNotes: ["Keep original note"],
        },
        textAssistance: {
          schemaVersion: 1,
          nodeId: "Body:Exact",
          role: "body",
          operation: "rewrite",
          sourceDigest: "b".repeat(64),
          outputDigest: "c".repeat(64),
          provider: "approved",
          model: "bounded-text",
          generatedAt: "2026-11-01T00:00:00.000Z",
          reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
        },
      },
    ],
  });
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function text(scene: PresentationScene, id: string) {
  const node = scene.nodes.find((node) => node.id === id);
  if (node?.type !== "text") throw new Error("Expected text node");
  return node;
}

describe("durable native text language updates", () => {
  it("sets or clears one exact node without changing text, frames, styles, IDs, order or the source", () => {
    const original = freeze(scene()),
      before = JSON.stringify(original),
      annotated = setNativeTextLanguage(original, "Body:Exact", "fr");
    expect(annotated.schemaVersion).toBe(7);
    expect(text(annotated, "Body:Exact")).toEqual({ ...text(original, "Body:Exact"), lang: "fr" });
    expect(annotated.nodes[0]).toBe(original.nodes[0]);
    expect(annotated.readingOrder).toBe(original.readingOrder);
    expect(annotated.design).toBe(original.design);
    expect(annotated.groups).toBe(original.groups);
    expect(JSON.stringify(original)).toBe(before);
    expect(PresentationSceneDraftSchema.safeParse(annotated).success).toBe(true);
    expect(setNativeTextLanguage(annotated, "Body:Exact", "fr")).toBe(annotated);
    const cleared = setNativeTextLanguage(annotated, "Body:Exact", null);
    expect(cleared.schemaVersion).toBe(7);
    expect(text(cleared, "Body:Exact")).not.toHaveProperty("lang");
    expect({ ...cleared, schemaVersion: 6 }).toEqual(original);
    expect(setNativeTextLanguage(original, "Body:Exact", null)).toBe(original);
  });
  it("retains independently marked objects when another object is translated, corrected or cleared", () => {
    const first = setNativeTextLanguage(scene(), "Title", "ja"),
      second = setNativeTextLanguage(first, "Body:Exact", "fr"),
      corrected = setNativeTextLanguage(second, "Body:Exact", "es"),
      cleared = setNativeTextLanguage(corrected, "Body:Exact", null);
    for (const result of [first, second, corrected, cleared])
      expect(text(result, "Title").lang).toBe("ja");
    expect(text(second, "Body:Exact").lang).toBe("fr");
    expect(text(corrected, "Body:Exact").lang).toBe("es");
    expect(text(cleared, "Body:Exact")).not.toHaveProperty("lang");
  });
  it("never falls back to another case-sensitive or non-text target and rejects noncanonical tags", () => {
    const original = scene();
    expect(setNativeTextLanguage(original, "body:exact", "fr")).toBe(original);
    expect(setNativeTextLanguage(original, "removed", "fr")).toBe(original);
    for (const lang of ["FR", "en-CA", "ar", ""])
      expect(() => setNativeTextLanguage(original, "Body:Exact", lang as never)).toThrow();
    expect(text(original, "Body:Exact")).not.toHaveProperty("lang");
  });
  it("promotes generic node updates to7 and preserves pronunciation across manual text, formatting, layout, reorder and copy", () => {
    const annotated = updateNativeNode(scene(), "Body:Exact", (node) =>
      node.type === "text" ? { ...node, lang: "fr" } : node,
    );
    expect(annotated.schemaVersion).toBe(7);
    const edited = updateNativeNode(annotated, "Body:Exact", (node) =>
      node.type === "text" ? { ...node, text: "Texte révisé." } : node,
    );
    const formatted = updateNativeNode(edited, "Body:Exact", (node) =>
      node.type === "text"
        ? { ...node, richText: plainTextToPresentationRichText(node.text) }
        : node,
    );
    for (const result of [
      edited,
      formatted,
      applyNativeLayout(formatted, "title_body"),
      reorderNativeNode(formatted, "Body:Exact", -1),
    ]) {
      expect(result.schemaVersion).toBe(7);
      expect(text(result, "Body:Exact").lang).toBe("fr");
      expect(PresentationSceneDraftSchema.safeParse(result).success).toBe(true);
    }
    const copied = duplicateNativeScene(formatted);
    expect(copied.schemaVersion).toBe(7);
    expect(copied.nodes.find((node) => node.type === "text" && node.role === "body")).toMatchObject(
      { lang: "fr", text: "Texte révisé." },
    );
  });
  it("rejects language metadata growth beyond the existing scene budget without mutating rich text", () => {
    const runs = Array.from({ length: 65 }, () => ({ text: "x", href: "https://example.test/" }));
    const source = scene();
    source.nodes = source.nodes.map((node) =>
      node.type === "text" && node.id === "Body:Exact"
        ? {
            ...node,
            text: "x".repeat(runs.length),
            richText: { paragraphs: [{ kind: "paragraph", runs }] },
          }
        : node,
    );
    let remaining =
      PRESENTATION_SCENE_MAX_BYTES -
      1 -
      new TextEncoder().encode(JSON.stringify(source)).byteLength;
    for (const run of runs) {
      const count = Math.min(2048 - run.href.length, remaining);
      run.href += "a".repeat(count);
      remaining -= count;
    }
    expect(remaining).toBe(0);
    expect(PresentationSceneDraftSchema.safeParse(source).success).toBe(true);
    const before = JSON.stringify(source);
    expect(() => setNativeTextLanguage(freeze(source), "Body:Exact", "fr")).toThrow();
    expect(JSON.stringify(source)).toBe(before);
  });
  it("keeps translated motion scenes editable without downgrading their scene or document", () => {
    const source = scene();
    source.schemaVersion = 8;
    source.design = { ...source.design!, motionBackground: "aurora" };
    source.nodes = source.nodes.map((node) =>
      node.type === "text" ? { ...node, lang: "fr" } : node,
    );
    const original = freeze(source),
      before = JSON.stringify(original);
    const edited = updateNativeNode(original, "Body:Exact", (node) =>
      node.type === "text" ? { ...node, text: "Examinez les faits." } : node,
    );
    const formatted = updateNativeNode(edited, "Body:Exact", (node) =>
      node.type === "text"
        ? { ...node, richText: plainTextToPresentationRichText(node.text) }
        : node,
    );
    const titleEdited = updateNativeNode(formatted, "Title", (node) =>
      node.type === "text" ? { ...node, text: "Une décision claire" } : node,
    );
    for (const next of [edited, formatted, titleEdited]) {
      expect(next.schemaVersion).toBe(8);
      expect(next.design).toBe(original.design);
      expect(text(next, "Body:Exact").lang).toBe("fr");
      expect(PresentationSceneDraftSchema.safeParse(next).success).toBe(true);
      const deck = applyNativeSceneToDeck(draft(), blockId, next);
      expect(deck.schemaVersion).toBe(17);
      expect(PresentationDraftSchema.safeParse(deck).success).toBe(true);
    }
    expect(text(titleEdited, "Body:Exact").text).toBe("Examinez les faits.");
    expect(text(titleEdited, "Title").text).toBe("Une décision claire");
    expect(JSON.stringify(original)).toBe(before);
  });
  it("adds, corrects and clears pronunciation on scene8, including after motion is removed", () => {
    const source = scene();
    source.schemaVersion = 8;
    source.design = { ...source.design!, motionBackground: "waves" };
    const original = freeze(source),
      before = JSON.stringify(original);
    const added = setNativeTextLanguage(original, "Body:Exact", "ja");
    const corrected = setNativeTextLanguage(added, "Body:Exact", "fr");
    const cleared = setNativeTextLanguage(corrected, "Body:Exact", null);
    for (const next of [added, corrected, cleared]) {
      expect(next.schemaVersion).toBe(8);
      expect(next.design).toBe(original.design);
      expect(PresentationSceneDraftSchema.safeParse(next).success).toBe(true);
    }
    expect(text(added, "Body:Exact").lang).toBe("ja");
    expect(text(corrected, "Body:Exact").lang).toBe("fr");
    expect(text(cleared, "Body:Exact")).not.toHaveProperty("lang");
    const { motionBackground, ...stillDesign } = corrected.design!;
    expect(motionBackground).toBe("waves");
    const still = { ...corrected, design: stillDesign };
    const edited = updateNativeNode(still, "Body:Exact", (node) =>
      node.type === "text" ? { ...node, text: "Updated after disabling motion." } : node,
    );
    expect(edited.schemaVersion).toBe(8);
    expect(PresentationSceneDraftSchema.safeParse(edited).success).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
  });
  it("promotes16 for scene7 or translation provenance and keeps all unrelated authoring data intact", () => {
    const original = freeze(draft()),
      before = JSON.stringify(original),
      block = original.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected native slide");
    const marked = setNativeTextLanguage(block.scene, "Body:Exact", "fr"),
      updated = applyNativeSceneToDeck(original, blockId, marked);
    expect(updated.schemaVersion).toBe(16);
    expect(updated.spatial).toBe(original.spatial);
    expect(updated.sections).toBe(original.sections);
    const nextBlock = updated.blocks[0]!;
    expect({ ...nextBlock, scene: undefined }).toEqual({ ...block, scene: undefined });
    expect(JSON.stringify(original)).toBe(before);
    const promoted = promotePresentationOpinionFormats({
      ...original,
      blocks: [{ ...block, scene: marked }],
    });
    expect(promoted.schemaVersion).toBe(16);
    expect(PresentationDraftSchema.safeParse(promoted).success).toBe(true);
    const translated = {
      ...block,
      textAssistance: {
        ...block.textAssistance!,
        operation: "translate" as const,
        targetLanguage: "fr" as const,
        sourceLanguage: null,
      },
    };
    expect(
      promotePresentationOpinionFormats({ ...original, blocks: [translated] }).schemaVersion,
    ).toBe(16);
    expect(nativeSceneDocumentVersion(15, { schemaVersion: 7 })).toBe(16);
    expect(nativeSceneDocumentVersion(16, { schemaVersion: 1 })).toBe(16);
    const clear = setNativeTextLanguage(marked, "Body:Exact", null),
      cleared = applyNativeSceneToDeck(updated, blockId, clear);
    expect(cleared.schemaVersion).toBe(16);
    expect(clear.schemaVersion).toBe(7);
    expect(
      applyNativeDesignToDeck(cleared, { theme: "midnight", font: "sans", spacing: "relaxed" })
        .schemaVersion,
    ).toBe(16);
    expect(normalizePresentationRecoveryDraft(updated)).toEqual(updated);
    expect(() => normalizePresentationRecoveryDraft({ ...updated, schemaVersion: 15 })).toThrow();
  });
});
