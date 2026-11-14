import { describe, expect, it } from "vitest";
import {
  PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES,
  PresentationDraftSchema,
  PresentationSceneSchema,
  type ContentSlideDraft,
  type PresentationDraft,
  type PresentationScene,
  type PresentationSceneNode,
} from "@openround/contracts";
import { createContentBlock, createQuestionBlock } from "./presentation-builder";
import { createPresentationDesignComposition } from "./presentation-design-compositions";
import {
  PRESENTATION_DESIGNS,
  applyPresentationDesign,
  createDesignDraft,
  createDesignSlide,
} from "./presentation-designs";
import { presentationDesignDraftCopy } from "./i18n/presentation-design-copy";
import { createNativeContentBlock } from "./presentation-native-scene";
import { instantiateNativePresentationTemplate } from "./presentation-native-templates";

const copy = {
  title: "Authored heading",
  body: "Keep this authored explanation.",
  eyebrow: "Authored context",
};
const frame = { x: 8, y: 40, width: 38, height: 30 };
const image: PresentationSceneNode = {
  id: "authored-image",
  type: "image",
  mediaId: "00000000-0000-4000-8000-000000000099",
  altText: "Authored alternative",
  fit: "cover",
  focalPoint: { x: 35, y: 68 },
  frame,
};
const table: PresentationSceneNode = {
  id: "authored-table",
  type: "table",
  caption: "Authored table",
  headers: ["Period", "Result"],
  rows: [
    ["Prior", "17"],
    ["Current", "29"],
  ],
  frame,
};
const chart: PresentationSceneNode = {
  id: "authored-chart",
  type: "chart",
  chartType: "bar",
  title: "Authored chart",
  summary: "The complete authored summary",
  categories: ["One", "Two"],
  series: [{ name: "Actual", values: [31, 45] }],
  frame,
};
function slide(...nodes: PresentationSceneNode[]) {
  const block = createNativeContentBlock();
  const title = block.scene!.nodes[0]!;
  if (title.type !== "text") throw Error("Expected title");
  title.text = copy.title;
  block.scene = {
    ...block.scene!,
    schemaVersion: 9,
    nodes: [title, ...nodes],
    readingOrder: [title.id, ...nodes.map((node) => node.id)],
  };
  return block;
}
function body(id = "authored-body"): PresentationSceneNode {
  return { id, type: "text", role: "body", text: copy.body, frame };
}
function deck(blocks: PresentationDraft["blocks"]): PresentationDraft {
  return {
    title: "Authored deck",
    description: "Keep description",
    schemaVersion: 18,
    sections: [],
    experiencePreset: { id: "studio", version: 1 },
    blocks,
  };
}
function scene(block: PresentationDraft["blocks"][number]): PresentationScene {
  if (block.kind !== "content" || !block.scene) throw Error("Expected native content");
  return block.scene;
}
function withoutFrame(node: PresentationSceneNode) {
  if (node.type === "connector") return node;
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "frame"));
}
const layout = { scope: "deck", application: "layout" } as const;

describe("applying full presentation design compositions", () => {
  it("keeps every Studio layout, authored ID and edge folio stable when Linen is reapplied", () => {
    const source = createDesignDraft("studio", presentationDesignDraftCopy("studio"));
    const first = applyPresentationDesign(source, "linen", layout);
    expect(first.summary.reflowedSlides).toBeGreaterThan(0);
    const snapshot = structuredClone(first.draft);
    const second = applyPresentationDesign(first.draft, "linen", layout);
    expect(second.summary.changedSlides).toBe(0);
    expect(second.draft).toBe(first.draft);
    expect(second.draft).toEqual(snapshot);
    for (const [index, before] of source.blocks.entries()) {
      const after = scene(second.draft.blocks[index]!);
      for (const node of scene(before).nodes) {
        if (node.type !== "text") continue;
        expect(after.nodes).toContainEqual(
          expect.objectContaining({ id: node.id, text: node.text }),
        );
      }
    }
  });

  it("keeps page-marker identity when switching between upper and lower family folios", () => {
    let current = createDesignDraft("studio", presentationDesignDraftCopy("studio"));
    const folio = scene(current.blocks[0]!).nodes.find(
      (node) => node.type === "text" && node.text === "01",
    );
    if (folio?.type !== "text") throw Error("Expected authored page marker");
    for (const family of ["linen", "studio", "meadow", "atlas", "linen"] as const) {
      const result = applyPresentationDesign(current, family, layout);
      const marker = scene(result.draft.blocks[0]!).nodes.find((node) => node.id === folio.id);
      expect(marker).toMatchObject({
        id: folio.id,
        text: "01",
        typography: { font: "mono", align: "right" },
      });
      if (marker?.type !== "text") throw Error();
      if (result.summary.reflowedSlides) {
        const expected = createPresentationDesignComposition(
          family,
          "cover",
          copy,
          () => "recipe",
        ).find((node) => node.type === "text" && node.text === "01");
        if (expected?.type !== "text") throw Error();
        expect(marker.frame).toEqual(expected.frame);
      }
      expect(applyPresentationDesign(result.draft, family, layout).draft).toBe(result.draft);
      current = result.draft;
    }
  });

  it("recognizes header folios after a style-only font change removes their mono override", () => {
    const source = createDesignDraft("studio", presentationDesignDraftCopy("studio"));
    const first = applyPresentationDesign(source, "linen", layout).draft;
    const paragraph = scene(first.blocks[0]!).nodes.find(
      (node) =>
        node.type === "text" &&
        node.text === presentationDesignDraftCopy("studio").slides.cover.body,
    );
    if (paragraph?.type !== "text") throw Error("Expected authored paragraph");
    const styled = applyPresentationDesign(first, "editorial", {
      scope: "deck",
      application: "style",
    }).draft;
    const marker = scene(styled.blocks[0]!).nodes.find(
      (node) => node.type === "text" && node.text === "01",
    );
    if (marker?.type !== "text") throw Error("Expected authored page marker");
    expect(marker.typography?.font).toBeUndefined();
    expect(marker.frame).toEqual({ x: 84, y: 8, width: 7, height: 5 });
    const restored = applyPresentationDesign(styled, "linen", layout);
    const after = scene(restored.draft.blocks[0]!).nodes.find((node) => node.id === marker.id);
    expect(after).toMatchObject({
      text: "01",
      frame: marker.frame,
      typography: { font: "mono", align: "right", size: 14 },
    });
    expect(
      scene(restored.draft.blocks[0]!).nodes.find((node) => node.id === paragraph.id),
    ).toMatchObject({ text: paragraph.text, frame: paragraph.frame });
    const repeated = applyPresentationDesign(restored.draft, "linen", layout);
    expect(repeated.summary.changedSlides).toBe(0);
    expect(repeated.draft).toBe(restored.draft);
  });

  it.each([
    { x: 8, y: 8, width: 38, height: 20 },
    { x: 50, y: 85, width: 40, height: 12 },
    { x: 87, y: 91, width: 6, height: 5 },
  ])(
    "keeps ordinary small numeric body content out of the page marker at $x,$y",
    (numericFrame) => {
      const numeric = body("authored-figure");
      if (numeric.type !== "text") throw Error();
      numeric.text = "17";
      numeric.frame = numericFrame;
      numeric.typography = { size: 14, font: "mono", align: "left" };
      const result = applyPresentationDesign(deck([slide(numeric)]), "linen", layout);
      const after = scene(result.draft.blocks[0]!).nodes.find((node) => node.id === numeric.id);
      expect(result.summary.reflowedSlides).toBe(1);
      expect(after).toMatchObject({ text: "17", frame: { x: 19, y: 81, width: 66, height: 12 } });
      expect(
        scene(result.draft.blocks[0]!)
          .nodes.filter((node) => node.type === "text")
          .map((node) => node.text),
      ).toEqual([copy.title, "17"]);
    },
  );

  it("keeps an ordinary small numeric metric and its label in the data region", () => {
    const numeric = body("authored-value");
    const label = body("authored-label");
    if (numeric.type !== "text" || label.type !== "text") throw Error();
    numeric.text = "24";
    numeric.frame = { x: 8, y: 87, width: 22, height: 9 };
    numeric.typography = { size: 18, font: "mono", align: "left" };
    label.text = "Actual";
    const result = applyPresentationDesign(deck([slide(numeric, label, table)]), "linen", layout);
    const after = scene(result.draft.blocks[0]!).nodes.find((node) => node.id === numeric.id);
    expect(result.summary.reflowedSlides).toBe(1);
    expect(after).toMatchObject({ text: "24", frame: { x: 19, y: 58, width: 19, height: 19.5 } });
  });

  it.each([16, 18])(
    "does not promote an inherited-font %ipx corner figure into the folio",
    (size) => {
      const numeric = body("authored-corner-figure");
      if (numeric.type !== "text") throw Error();
      numeric.text = "17";
      numeric.frame = { x: 84, y: 8, width: 7, height: 5 };
      numeric.typography = { size, align: "right" };
      const result = applyPresentationDesign(deck([slide(numeric)]), "linen", layout);
      expect(
        scene(result.draft.blocks[0]!).nodes.find((node) => node.id === numeric.id),
      ).toMatchObject({ text: "17", frame: { x: 19, y: 81, width: 66, height: 12 } });
    },
  );

  it("retains geometry atomically when six explicit body lines cannot fit the chosen cover", () => {
    const text = body();
    if (text.type !== "text") throw Error();
    text.text = "One\nTwo\nThree\nFour\nFive\nSix";
    const source = deck([slide(text)]);
    const original = scene(source.blocks[0]!);
    const result = applyPresentationDesign(source, "linen", layout);
    expect(result.summary).toMatchObject({ reflowedSlides: 0, retainedLayoutSlides: 1 });
    expect(scene(result.draft.blocks[0]!).nodes).toEqual(original.nodes);
    expect(scene(result.draft.blocks[0]!).readingOrder).toBe(original.readingOrder);
    expect(PresentationDraftSchema.safeParse(result.draft).success).toBe(true);
  });

  it.each(PRESENTATION_DESIGNS)(
    "$id reflows representative authored objects safely and idempotently",
    (family) => {
      const callout: PresentationSceneNode = {
        id: "authored-callout",
        type: "shape",
        shape: "rectangle",
        color: "sky",
        label: "Keep this authored callout",
        frame,
      };
      const source = deck([
        slide(body("opening")),
        slide(body("left"), body("right"), callout),
        slide(body("image-caption"), image),
        slide(body("data-lead"), table),
        slide(body("closing")),
      ]);
      const snapshot = structuredClone(source);
      const result = applyPresentationDesign(source, family.id, layout);
      expect(result.summary.reflowedSlides).toBe(source.blocks.length);
      expect(result.summary.retainedLayoutSlides).toBe(0);
      expect(PresentationDraftSchema.safeParse(result.draft).success).toBe(true);
      for (const [index, before] of source.blocks.entries()) {
        const after = scene(result.draft.blocks[index]!);
        for (const node of scene(before).nodes) {
          const retained = after.nodes.find((item) => item.id === node.id);
          expect(retained).toBeDefined();
          if (node.type === "text") expect(retained).toMatchObject({ text: node.text });
          if (node.type === "shape") expect(retained).toMatchObject({ label: node.label });
          if (node.type === "table")
            expect(retained).toMatchObject({
              caption: node.caption,
              headers: node.headers,
              rows: node.rows,
            });
          if (node.type === "image")
            expect(retained).toMatchObject({
              mediaId: node.mediaId,
              altText: node.altText,
              fit: node.fit,
              focalPoint: node.focalPoint,
            });
        }
        const regions = after.nodes.filter(
          (node): node is Exclude<PresentationSceneNode, { type: "connector" }> =>
            node.type !== "connector" && !(node.type === "shape" && node.decorative),
        );
        for (let a = 0; a < regions.length; a++)
          for (const b of regions.slice(a + 1)) {
            const first = regions[a]!.frame,
              next = b.frame;
            expect(
              Math.min(first.x + first.width, next.x + next.width) <= Math.max(first.x, next.x) ||
                Math.min(first.y + first.height, next.y + next.height) <= Math.max(first.y, next.y),
            ).toBe(true);
          }
      }
      expect(applyPresentationDesign(result.draft, family.id, layout).draft).toBe(result.draft);
      expect(source).toEqual(snapshot);
    },
  );

  it("applies the actual family title geometry, typography and artwork to existing content", () => {
    const source = deck([slide(body())]);
    const before = structuredClone(source);
    const result = applyPresentationDesign(source, "midnight", layout);
    const changed = scene(result.draft.blocks[0]!);
    const authored = scene(source.blocks[0]!);
    const recipe = createPresentationDesignComposition("midnight", "cover", copy, () => "recipe");
    const recipeTitle = recipe.find((node) => node.type === "text" && node.role === "title");
    if (recipeTitle?.type !== "text") throw Error("Expected recipe title");
    expect(result.summary).toMatchObject({
      reflowedSlides: 1,
      retainedLayoutSlides: 0,
      changedSlides: 1,
    });
    expect(changed.nodes.find((node) => node.id === authored.nodes[0]!.id)).toMatchObject({
      frame: recipeTitle.frame,
      typography: { font: "sans", weight: 800, size: 90 },
      text: copy.title,
    });
    expect(
      changed.nodes
        .filter((node) => node.type === "shape" && node.decorative)
        .map(({ id: _id, ...node }) => node),
    ).toEqual(
      recipe
        .filter((node) => node.type === "shape" && node.decorative)
        .map(({ id: _id, ...node }) => node),
    );
    expect(changed.nodes.filter((node) => node.type === "text").map((node) => node.text)).toEqual([
      copy.title,
      copy.body,
    ]);
    expect(changed.readingOrder.filter((id) => authored.readingOrder.includes(id))).toEqual(
      authored.readingOrder,
    );
    expect(source).toEqual(before);
    expect(PresentationDraftSchema.safeParse(result.draft).success).toBe(true);
  });

  it("keeps legacy style-only callers geometrically unchanged", () => {
    const source = deck([slide(body())]);
    const result = applyPresentationDesign(source, "midnight", { scope: "deck" });
    expect(scene(result.draft.blocks[0]!).nodes).toBe(scene(source.blocks[0]!).nodes);
    expect(result.summary).toMatchObject({ reflowedSlides: 0, retainedLayoutSlides: 0 });
  });

  it("replaces only unreferenced empty decoration and produces stable, idempotent object IDs", () => {
    const block = createDesignSlide("studio", "cover", copy);
    const original = scene(block);
    const meaningfulIds = original.nodes
      .filter((node) => !(node.type === "shape" && node.decorative))
      .map((node) => node.id);
    const first = applyPresentationDesign(deck([block]), "midnight", layout);
    const firstScene = scene(first.draft.blocks[0]!);
    const second = applyPresentationDesign(first.draft, "midnight", layout);
    expect(second.draft).toBe(first.draft);
    expect(second.summary.changedSlides).toBe(0);
    const third = applyPresentationDesign(second.draft, "folio", layout);
    const thirdScene = scene(third.draft.blocks[0]!);
    expect(thirdScene.nodes.filter((node) => node.type === "text").map((node) => node.id)).toEqual(
      meaningfulIds,
    );
    expect(
      thirdScene.nodes.some((node) =>
        firstScene.nodes.some(
          (old) => old.type === "shape" && old.decorative && old.id === node.id,
        ),
      ),
    ).toBe(false);
    expect(JSON.stringify(thirdScene)).not.toContain("__design_slot_");
    expect(JSON.stringify(thirdScene)).not.toContain("↗");
  });

  it("preserves formatted content, authored language, metadata, hidden state, motion and scopes", () => {
    const text = body();
    if (text.type !== "text") throw Error();
    text.text = "형식 있는 본문";
    text.lang = "ko";
    text.richText = {
      paragraphs: [{ kind: "paragraph", runs: [{ text: text.text, bold: true, italic: true }] }],
    };
    const first = slide(text);
    first.hidden = true;
    first.speakerNotes = "Private presenter cue";
    first.citations = [{ locator: "Source page 4", excerpt: "Author evidence" }];
    first.sourceDisclosure = {
      sourceName: "Original",
      sourceDigest: "a".repeat(64),
      provider: "Author",
      model: "source-v1",
    };
    first.scene!.design = {
      theme: "paper",
      font: "sans",
      spacing: "compact",
      motionBackground: "waves",
    };
    const question = createQuestionBlock("poll");
    const other = slide(body("other-body"));
    const source = deck([first, question, other]);
    const result = applyPresentationDesign(source, "atlas", {
      scope: "slide",
      blockId: first.id.toUpperCase(),
      application: "layout",
    });
    const changed = result.draft.blocks[0] as ContentSlideDraft;
    expect(changed).toMatchObject({
      id: first.id,
      hidden: true,
      speakerNotes: first.speakerNotes,
      citations: first.citations,
      sourceDisclosure: first.sourceDisclosure,
    });
    expect(scene(changed).nodes.find((node) => node.id === text.id)).toMatchObject({
      text: text.text,
      lang: text.lang,
      richText: text.richText,
    });
    expect(scene(changed).design?.motionBackground).toBe("waves");
    expect(result.draft.blocks[1]).toBe(question);
    expect(result.draft.blocks[2]).toBe(other);
    expect(result.draft.sections).toBe(source.sections);
    expect(result.draft.title).toBe(source.title);
  });

  it("maps images, full tables and full charts into family regions without changing media or figures", () => {
    const source = deck([slide(body(), image), slide(table), slide(chart)]);
    const result = applyPresentationDesign(source, "horizon", layout);
    expect(result.summary.reflowedSlides).toBe(3);
    for (const [index, object] of [image, table, chart].entries()) {
      const changed = scene(result.draft.blocks[index]!).nodes.find(
        (node) => node.id === object.id,
      )!;
      expect(withoutFrame(changed)).toEqual(withoutFrame(object));
      expect(changed).not.toMatchObject({ frame: object.frame });
    }
    expect(JSON.stringify(result.draft)).not.toContain("__design_slot_");
    expect(
      scene(result.draft.blocks[1]!).nodes.filter((node) => node.type === "text"),
    ).toHaveLength(1);
  });

  it("reflows extra paragraphs and labelled native shapes into separate adaptive regions", () => {
    const label: PresentationSceneNode = {
      id: "label",
      type: "shape",
      shape: "rounded_rectangle",
      color: "sky",
      label: "Authored callout",
      frame,
    };
    const target = slide(body("one"), label, body("two"));
    const source = deck([slide(body("opening")), target, slide(body("closing"))]);
    const result = applyPresentationDesign(source, "ledger", layout);
    expect(result.summary.reflowedSlides).toBe(3);
    const changed = scene(result.draft.blocks[1]!);
    for (const node of scene(target).nodes) {
      if (node.type === "connector") continue;
      const after = changed.nodes.find((item) => item.id === node.id)!;
      expect(after).not.toMatchObject({ frame: node.frame });
      if (node.type === "shape") expect(after).toMatchObject({ label: node.label });
      if (node.type === "text") expect(after).toMatchObject({ text: node.text });
    }
    const content = changed.nodes.filter(
      (node): node is Exclude<PresentationSceneNode, { type: "connector" }> =>
        node.type !== "connector" && !(node.type === "shape" && node.decorative),
    );
    for (let index = 0; index < content.length; index++)
      for (const b of content.slice(index + 1)) {
        const a = content[index]!;
        expect(
          Math.min(a.frame.x + a.frame.width, b.frame.x + b.frame.width) <=
            Math.max(a.frame.x, b.frame.x) ||
            Math.min(a.frame.y + a.frame.height, b.frame.y + b.frame.height) <=
              Math.max(a.frame.y, b.frame.y),
        ).toBe(true);
      }
  });

  it("reflows common native content and explicitly retains diagrams and content that cannot fit", () => {
    const source = instantiateNativePresentationTemplate("native-startup-pitch");
    const result = applyPresentationDesign(source, "midnight", layout);
    expect(result.summary).toMatchObject({ reflowedSlides: 4, retainedLayoutSlides: 4 });
    for (const [index, before] of source.blocks.entries()) {
      const after = scene(result.draft.blocks[index]!);
      if (!after.nodes.some((node) => node.id.startsWith("design:"))) {
        expect(after.nodes.map((node) => (node.type === "connector" ? node : node.frame))).toEqual(
          scene(before).nodes.map((node) => (node.type === "connector" ? node : node.frame)),
        );
      }
      for (const node of scene(before).nodes) {
        const retained = after.nodes.find((item) => item.id === node.id)!;
        if (node.type === "text") expect(retained).toMatchObject({ text: node.text });
        if (node.type === "shape") expect(retained).toMatchObject({ label: node.label });
      }
    }
  });

  it("keeps adaptive extra text within each split panel and its intended contrast role", () => {
    const source = deck([
      slide(body("opening")),
      slide(body("one"), body("two"), body("three")),
      slide(body("closing")),
    ]);
    const result = applyPresentationDesign(source, "signal", layout);
    const content = scene(result.draft.blocks[1]!).nodes.filter(
      (node) => node.type === "text" && node.role === "body",
    );
    expect(content).toHaveLength(3);
    for (const node of content) {
      if (node.type !== "text") throw Error();
      if (node.frame.x < 50) {
        expect(node.frame.x + node.frame.width).toBeLessThanOrEqual(47);
        expect(node.typography?.color).toBe("accentText");
      } else {
        expect(node.frame.x).toBeGreaterThanOrEqual(53);
        expect(node.typography?.color).toBe("text");
      }
    }
  });

  it("measures rich paragraph and list spacing while preserving every authored run", () => {
    const text = body();
    if (text.type !== "text") throw Error();
    const paragraph = "Keep the complete authored qualification alongside its supporting evidence.";
    text.richText = {
      paragraphs: Array.from({ length: 4 }, (_, index) => ({
        kind: index ? ("bullet" as const) : ("paragraph" as const),
        runs: [{ text: paragraph, bold: true as const }],
      })),
    };
    text.text = Array(4).fill(paragraph).join("\n");
    const rich = deck([slide(body("opening")), slide(text), slide(body("closing"))]);
    const plain = structuredClone(rich);
    const plainNode = scene(plain.blocks[1]!).nodes.find((node) => node.id === text.id);
    if (plainNode?.type !== "text") throw Error();
    delete plainNode.richText;
    const after = scene(
      applyPresentationDesign(rich, "midnight", layout).draft.blocks[1]!,
    ).nodes.find((node) => node.id === text.id);
    const unformatted = scene(
      applyPresentationDesign(plain, "midnight", layout).draft.blocks[1]!,
    ).nodes.find((node) => node.id === text.id);
    if (after?.type !== "text" || unformatted?.type !== "text") throw Error();
    expect(after.richText).toBe(text.richText);
    expect(after.text).toBe(text.text);
    expect(after.typography!.size!).toBeLessThan(unformatted.typography!.size!);
  });

  it.each(["connector", "group", "hotspot", "reveal", "navigation", "import"])(
    "explicitly retains %s geometry and reference graphs without painting over content",
    (kind) => {
      const block = slide(body(), image);
      if (kind === "connector")
        block.scene!.nodes.push({
          id: "edge",
          type: "connector",
          from: { nodeId: block.scene!.nodes[0]!.id, anchor: "bottom" },
          to: { nodeId: "authored-body", anchor: "top" },
          color: "sky",
          label: "Author relationship",
        });
      if (kind === "group")
        block.scene!.groups = [{ id: "group", nodeIds: ["authored-body", "authored-image"] }];
      if (kind === "hotspot")
        block.scene!.nodes.push({
          id: "hotspot",
          type: "hotspot",
          imageNodeId: "authored-image",
          scope: "local",
          label: "Details",
          detailTitle: "Original",
          body: "Keep local content",
          frame,
        });
      if (kind === "reveal")
        block.scene!.nodes.push({
          id: "reveal",
          type: "reveal",
          scope: "broadcast",
          label: "Details",
          body: "Keep broadcast content",
          frame,
        });
      if (kind === "navigation")
        block.scene!.nodes.push({
          id: "navigation",
          type: "navigation",
          targetBlockId: block.id,
          label: "Again",
          frame,
        });
      if (kind === "import")
        block.sourceDisclosure = {
          sourceName: "Source.pdf",
          sourceDigest: "b".repeat(64),
          provider: "Author",
          model: "visual-import-v1",
        };
      block.scene!.readingOrder = block.scene!.nodes.map((node) => node.id);
      const before = structuredClone(block);
      const result = applyPresentationDesign(deck([block]), "folio", layout);
      expect(result.summary).toMatchObject({
        reflowedSlides: 0,
        retainedLayoutSlides: 1,
        changedSlides: 1,
      });
      expect(scene(result.draft.blocks[0]!).nodes).toEqual(block.scene!.nodes);
      expect(scene(result.draft.blocks[0]!).readingOrder).toBe(block.scene!.readingOrder);
      expect(scene(result.draft.blocks[0]!).groups).toBe(block.scene!.groups);
      expect(PresentationSceneSchema.safeParse(scene(result.draft.blocks[0]!)).success).toBe(true);
      expect(block).toEqual(before);
    },
  );

  it("retains referenced decorations rather than breaking connectors", () => {
    const decoration: PresentationSceneNode = {
      id: "referenced-decoration",
      type: "shape",
      shape: "ellipse",
      color: "sky",
      label: "",
      decorative: true,
      frame,
    };
    const block = slide(body(), decoration);
    block.scene!.nodes.push({
      id: "edge",
      type: "connector",
      from: { nodeId: decoration.id, anchor: "right" },
      to: { nodeId: "authored-body", anchor: "left" },
      label: "",
      color: "sky",
    });
    block.scene!.readingOrder.push("edge");
    const result = applyPresentationDesign(deck([block]), "circuit", layout);
    expect(scene(result.draft.blocks[0]!).nodes).toContainEqual(decoration);
    expect(result.summary.retainedLayoutSlides).toBe(1);
  });

  it("converts ordinary slides deterministically and gives preview and commit identical geometry", () => {
    const ordinary = createContentBlock("media");
    ordinary.textElements[0]!.text = copy.title;
    ordinary.textElements[1]!.text = copy.body;
    ordinary.mediaId = image.mediaId;
    ordinary.mediaAlt = "Keep alternative";
    ordinary.speakerNotes = "Keep private notes";
    const source = deck([ordinary]);
    const preview = applyPresentationDesign(source, "prism", layout);
    const commit = applyPresentationDesign(source, "prism", layout);
    expect(preview).toEqual(commit);
    expect(preview.summary).toMatchObject({ convertedSlides: 1, reflowedSlides: 1 });
    const changed = preview.draft.blocks[0] as ContentSlideDraft;
    expect(changed.id).toBe(ordinary.id);
    expect(changed.speakerNotes).toBe(ordinary.speakerNotes);
    for (const element of ordinary.textElements)
      expect(scene(changed).nodes).toContainEqual(
        expect.objectContaining({ id: element.id, text: element.text }),
      );
    expect(scene(changed).nodes).toContainEqual(
      expect.objectContaining({ mediaId: ordinary.mediaId, altText: ordinary.mediaAlt }),
    );
  });

  it("rejects the complete edit atomically if retained content exceeds the document budget after styling", () => {
    const source = deck(
      Array.from({ length: 32 }, () =>
        slide(
          ...Array.from({ length: 24 }, (_, index) => ({
            ...body(`body:${index}`),
            text: "x".repeat(4_000),
          })),
        ),
      ),
    );
    let excess =
      new TextEncoder().encode(JSON.stringify(source)).byteLength -
      (PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES - 1);
    for (const block of [...source.blocks].reverse())
      for (const node of [...scene(block).nodes].reverse()) {
        if (node.type !== "text" || node.role !== "body" || excess <= 0) continue;
        const remove = Math.min(excess, node.text.length);
        node.text = node.text.slice(remove);
        excess -= remove;
      }
    expect(PresentationDraftSchema.safeParse(source).success).toBe(true);
    const before = JSON.stringify(source);
    expect(() => applyPresentationDesign(source, "midnight", layout)).toThrow(/3 MiB/);
    expect(JSON.stringify(source)).toBe(before);
  });
});
