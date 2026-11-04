import { describe, expect, it } from "vitest";
import {
  PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES,
  PRESENTATION_SCENE_MAX_BYTES,
  PresentationContentSchema,
  type PresentationDraft,
} from "@openround/contracts";
import {
  instantiateNativePresentationTemplate,
  nativePresentationTemplateThumbnail,
  nativePresentationTemplates,
} from "./presentation-native-templates";
import {
  allPresentationTemplates,
  instantiatePresentationTemplate,
  legacyPresentationTemplates,
} from "./presentation-templates";
import { presentationReadiness } from "./presentation-builder";

function ids(draft: PresentationDraft) {
  return draft.blocks.flatMap((block) =>
    block.kind === "content"
      ? [
          block.id,
          ...(block.scene?.nodes.map((node) => node.id) ?? []),
          ...(block.scene?.groups?.map((group) => group.id) ?? []),
        ]
      : [block.id, block.question.id],
  );
}

describe("full native scenario templates", () => {
  it("adds twelve original scenarios while retaining the nine facilitated v2 templates", () => {
    expect(nativePresentationTemplates).toHaveLength(12);
    expect(legacyPresentationTemplates).toHaveLength(9);
    expect(allPresentationTemplates).toHaveLength(21);
    expect(new Set(allPresentationTemplates.map((template) => template.id)).size).toBe(21);
    for (const template of legacyPresentationTemplates)
      expect(instantiatePresentationTemplate(template.id).schemaVersion).toBe(2);
    expect(nativePresentationTemplates.every((template) => template.scenarioLabel.trim())).toBe(
      true,
    );
    expect(
      nativePresentationTemplates.reduce((count, template) => count + template.blocks.length, 0),
    ).toBe(96);
    expect(
      nativePresentationTemplates
        .flatMap((template) => template.blocks)
        .filter((block) => block.illustrativeChart),
    ).toHaveLength(8);
  });

  it.each(nativePresentationTemplates)(
    "$id creates two independent, publication-ready eight-slide decks",
    (template) => {
      const first = instantiateNativePresentationTemplate(template.id);
      const second = instantiateNativePresentationTemplate(template.id);
      for (const draft of [first, second]) {
        expect(draft.schemaVersion).toBe(8);
        expect(draft.blocks).toHaveLength(8);
        expect(draft.blocks.every((block) => block.kind === "content")).toBe(true);
        expect(PresentationContentSchema.safeParse(draft).success).toBe(true);
        expect(presentationReadiness(draft)).toEqual([]);
        expect(new TextEncoder().encode(JSON.stringify(draft)).byteLength).toBeLessThan(
          PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES,
        );
        const allIds = ids(draft);
        expect(new Set(allIds).size).toBe(allIds.length);
        for (const [index, block] of draft.blocks.entries()) {
          if (block.kind !== "content" || !block.scene) throw new Error("Expected native content");
          const copy = template.blocks[index]!;
          expect(block.speakerNotes.length).toBeGreaterThan(20);
          expect(block.speakerNotes).toContain(template.blocks[index]!.notes);
          expect(
            block.speakerNotes +
              block.scene.nodes
                .filter((node) => node.type === "text")
                .map((node) => node.text)
                .join("\n"),
          ).toContain(template.blocks[index]!.body);
          if (copy.illustrativeChart) {
            expect(block.speakerNotes).toContain(copy.body);
            expect(block.speakerNotes).toContain(copy.notes);
            expect(block.scene.nodes.map((node) => node.type)).toEqual(["text", "chart"]);
            expect(block.scene.nodes[0]).toMatchObject({ role: "title", text: copy.title });
            const chart = block.scene.nodes[1];
            expect(chart).toMatchObject({
              type: "chart",
              frame: { x: 7, y: 30, width: 86, height: 67 },
              title: copy.illustrativeChart.title,
              summary: copy.illustrativeChart.summary,
            });
          }
          expect(block.scene.schemaVersion).toBe(4);
          expect(block.scene.design).toMatchObject({ theme: template.theme, font: template.font });
          expect(block.scene.readingOrder).toEqual(block.scene.nodes.map((node) => node.id));
          expect(block.scene.nodes.every((node) => node.type !== "image")).toBe(true);
          expect(new TextEncoder().encode(JSON.stringify(block.scene)).byteLength).toBeLessThan(
            PRESENTATION_SCENE_MAX_BYTES,
          );
          for (const node of block.scene.nodes) {
            if (node.type === "connector") continue;
            expect(node.frame.x + node.frame.width).toBeLessThanOrEqual(100);
            expect(node.frame.y + node.frame.height).toBeLessThanOrEqual(100);
            if (node.type === "table") expect(node.caption).toMatch(/Illustrative|synthetic/i);
            if (node.type === "chart") {
              expect(node.title).toMatch(/Illustrative|synthetic/i);
              expect(node.summary.trim()).not.toBe("");
            }
          }
        }
      }
      expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
      const firstTable = first.blocks.flatMap((block) =>
        block.kind === "content"
          ? (block.scene?.nodes.filter((node) => node.type === "table") ?? [])
          : [],
      )[0];
      const secondTable = second.blocks.flatMap((block) =>
        block.kind === "content"
          ? (block.scene?.nodes.filter((node) => node.type === "table") ?? [])
          : [],
      )[0];
      if (firstTable?.type === "table" && secondTable?.type === "table") {
        firstTable.rows[0]![0] = "A local edit";
        expect(secondTable.rows[0]![0]).not.toBe("A local edit");
        expect(
          template.blocks.some((block) =>
            block.illustrativeTable?.rows.some((row) => row.includes("A local edit")),
          ),
        ).toBe(false);
      }
    },
  );

  it.each(nativePresentationTemplates)(
    "$id has stable read-only thumbnails independent from created copies",
    (template) => {
      const first = nativePresentationTemplateThumbnail(template.id);
      expect(nativePresentationTemplateThumbnail(template.id)).toEqual(first);
      const draft = instantiateNativePresentationTemplate(template.id);
      expect(ids(draft)).not.toContain(first.id);
      expect(first.scene?.nodes.every((node) => !ids(draft).includes(node.id))).toBe(true);
    },
  );
});
