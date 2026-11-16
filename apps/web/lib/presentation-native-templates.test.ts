import { beforeAll, describe, expect, it } from "vitest";
import {
  PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES,
  PRESENTATION_SCENE_MAX_BYTES,
  PresentationContentSchema,
  supportedLocales,
  type PresentationDraft,
  type PresentationScene,
} from "@openround/contracts";
import {
  instantiateNativePresentationTemplate,
  nativePresentationTemplateThumbnail,
  nativePresentationTemplates,
  nativePresentationTemplatesForLocale,
} from "./presentation-native-templates";
import { loadPresentationTemplateLocale } from "./presentation-template-locales";
import {
  allPresentationTemplates,
  instantiatePresentationTemplate,
  legacyPresentationTemplates,
} from "./presentation-templates";
import { presentationReadiness } from "./presentation-builder";

beforeAll(async () => {
  await Promise.all(supportedLocales.map(loadPresentationTemplateLocale));
});

function contentScenes(draft: PresentationDraft): PresentationScene[] {
  return draft.blocks.map((block) => {
    if (block.kind !== "content" || !block.scene) throw new Error("Expected native content");
    return block.scene;
  });
}

const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();

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
  it("authors a complete visual sequence in three families using eight purposeful layouts", () => {
    expect(new Set(nativePresentationTemplates.map((template) => template.visualStyle))).toEqual(
      new Set(["editorial", "briefing", "workshop"]),
    );
    expect(
      new Set(
        nativePresentationTemplates.flatMap((template) => template.blocks.map((b) => b.layout)),
      ),
    ).toEqual(
      new Set([
        "cover",
        "statement",
        "process",
        "timeline",
        "comparison",
        "cards",
        "closing",
        "data",
      ]),
    );
    const familyCovers = new Map<string, unknown>();
    for (const template of nativePresentationTemplates) {
      expect(template.blocks[0]!.layout).toBe("cover");
      expect(template.blocks.at(-1)!.layout).toBe("closing");
      expect(new Set(template.blocks.map((block) => block.layout)).size).toBeGreaterThanOrEqual(4);
      const cover = contentScenes(instantiateNativePresentationTemplate(template.id))[0]!;
      const geometry = cover.nodes.map((node) => ({
        type: node.type,
        ...("frame" in node ? { frame: node.frame } : {}),
      }));
      if (familyCovers.has(template.visualStyle))
        expect(geometry).toEqual(familyCovers.get(template.visualStyle));
      else familyCovers.set(template.visualStyle, geometry);
      for (const block of template.blocks) {
        expect(block.layout === "data").toBe(
          Boolean(block.illustrativeTable || block.illustrativeChart),
        );
        expect(["process", "timeline", "comparison", "cards"].includes(block.layout)).toBe(
          Boolean(block.columns),
        );
      }
    }
    expect(
      new Set([...familyCovers.values()].map((geometry) => JSON.stringify(geometry))).size,
    ).toBe(3);
  });

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

  it.each(supportedLocales)(
    "%s preserves every authored column and statement in semantic reading order without overlapping frames",
    (locale) => {
      const localized = nativePresentationTemplatesForLocale(locale);
      for (const [templateIndex, template] of localized.entries()) {
        const source = nativePresentationTemplates[templateIndex]!;
        expect(template.visualStyle).toBe(source.visualStyle);
        expect(template.blocks.map((block) => block.layout)).toEqual(
          source.blocks.map((b) => b.layout),
        );
        const scenes = contentScenes(
          instantiateNativePresentationTemplate(template.id, undefined, locale),
        );
        for (const [slideIndex, scene] of scenes.entries()) {
          const copy = template.blocks[slideIndex]!;
          const framed = scene.nodes.filter((node) => node.type !== "connector");
          for (const [index, node] of framed.entries()) {
            for (const other of framed.slice(index + 1)) {
              const horizontal =
                Math.min(node.frame.x + node.frame.width, other.frame.x + other.frame.width) -
                Math.max(node.frame.x, other.frame.x);
              const vertical =
                Math.min(node.frame.y + node.frame.height, other.frame.y + other.frame.height) -
                Math.max(node.frame.y, other.frame.y);
              expect(horizontal > 0 && vertical > 0, `${locale}/${template.id}/${slideIndex}`).toBe(
                false,
              );
            }
          }
          expect(scene.readingOrder[0]).toBe(scene.nodes[0]!.id);
          expect(scene.nodes[0]).toMatchObject({ type: "text", role: "title", text: copy.title });
          if (copy.columns) {
            expect(scene.groups).toHaveLength(copy.columns.length);
            for (const [index, group] of scene.groups!.entries()) {
              const [heading, detail] = group.nodeIds.map((id) =>
                scene.nodes.find((node) => node.id === id)!,
              );
              if (heading?.type !== "shape" || detail?.type !== "text")
                throw new Error("Expected editable card");
              expect(copy.columns[index]!.startsWith(heading.label)).toBe(true);
              expect(normalize(copy.columns[index]!.slice(heading.label.length))).toBe(
                normalize(detail.text),
              );
              expect(scene.readingOrder.indexOf(detail.id)).toBe(
                scene.readingOrder.indexOf(heading.id) + 1,
              );
              expect(heading.label.trim()).not.toBe("");
            }
            const connectors = scene.nodes.filter((node) => node.type === "connector");
            expect(connectors).toHaveLength(
              ["process", "timeline"].includes(copy.layout) ? copy.columns.length - 1 : 0,
            );
            for (const [index, connector] of connectors.entries()) {
              expect(connector.from.nodeId).toBe(scene.groups![index]!.nodeIds[0]);
              expect(connector.to.nodeId).toBe(scene.groups![index + 1]!.nodeIds[0]);
              expect(scene.readingOrder.indexOf(connector.id)).toBe(
                scene.readingOrder.indexOf(scene.groups![index]!.nodeIds[1]!) + 1,
              );
            }
          }
          if (copy.layout === "statement") {
            const callout = scene.nodes[1];
            const detail = scene.nodes[2];
            if (callout?.type !== "shape" || detail?.type !== "text")
              throw new Error("Expected takeaway and qualification");
            expect(copy.body.startsWith(callout.label)).toBe(true);
            expect(normalize(copy.body.slice(callout.label.length))).toBe(normalize(detail.text));
          }
          if (copy.layout === "cover" || copy.layout === "closing") {
            expect(
              scene.nodes.some(
                (node) => node.type === "shape" && node.label === template.scenarioLabel,
              ),
            ).toBe(true);
            expect(
              scene.nodes.some((node) => node.type === "text" && node.text === copy.body),
            ).toBe(true);
          }
        }
      }
    },
  );

  it("remaps process endpoints and editable card groups into each independent copy", () => {
    const original = nativePresentationTemplates.find(
      (template) => template.id === "native-startup-pitch",
    )!;
    const first = contentScenes(instantiateNativePresentationTemplate(original.id))[3]!;
    const second = contentScenes(instantiateNativePresentationTemplate(original.id))[3]!;
    const copiedIds = new Set(first.nodes.map((node) => node.id));
    expect(first.groups).toHaveLength(3);
    for (const group of first.groups!)
      expect(group.nodeIds.every((id) => copiedIds.has(id))).toBe(true);
    for (const connector of first.nodes.filter((node) => node.type === "connector")) {
      expect(copiedIds.has(connector.from.nodeId)).toBe(true);
      expect(copiedIds.has(connector.to.nodeId)).toBe(true);
    }
    const header = first.nodes.find((node) => node.type === "shape")!;
    if (header.type !== "shape") throw new Error("Expected process header");
    const secondMembers = [...second.groups![0]!.nodeIds];
    header.label = "A local process edit";
    first.groups![0]!.nodeIds.reverse();
    expect(second.nodes.some((node) => node.type === "shape" && node.label === header.label)).toBe(
      false,
    );
    expect(second.groups![0]!.nodeIds).toEqual(secondMembers);
    expect(original.blocks[3]!.columns![0]).toBe(
      "Capture: location, issue, urgency and an optional approved image.",
    );
  });
});
