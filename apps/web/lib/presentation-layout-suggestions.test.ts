import { describe, expect, it } from "vitest";
import {
  PRESENTATION_SCENE_MAX_BYTES,
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  PresentationDraftSchema,
  PresentationSceneDraftSchema,
  type PresentationScene,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";
import {
  nativeLayoutSuggestionAvailability,
  suggestNativeLayouts,
} from "./presentation-layout-suggestions";
import {
  instantiateNativePresentationTemplate,
  nativePresentationTemplates,
} from "./presentation-native-templates";
import { applyNativeSceneToDeck } from "./presentation-deck-design";

const titleId = "Native:Title",
  bodyId = "Native:Body",
  tableId = "Native:Table";
function fixture(version: PresentationScene["schemaVersion"] = 3): PresentationScene {
  return {
    schemaVersion: version,
    aspectRatio: "16:9",
    ...(version >= 3
      ? { design: { theme: "ocean", font: "serif", spacing: "compact" } as const }
      : {}),
    ...(version >= 4 ? { groups: [] } : {}),
    // Keep array order distinct from semantic reading order to detect normalization.
    nodes: [
      {
        id: bodyId,
        type: "text",
        role: "body",
        text: "Evidence stays editable.",
        ...(version >= 2
          ? {
              richText: {
                paragraphs: [
                  {
                    kind: "bullet" as const,
                    runs: [
                      {
                        text: "Evidence",
                        bold: true as const,
                        href: "https://example.test/evidence",
                      },
                      { text: " stays editable.", italic: true as const },
                    ],
                  },
                ],
              },
            }
          : {}),
        ...(version >= 4 ? { rotation: 0 } : {}),
        frame: { x: 12, y: 35, width: 76, height: 40 },
      },
      {
        id: titleId,
        type: "text",
        role: "title",
        text: "Review the evidence",
        frame: { x: 7, y: 6, width: 86, height: 20 },
      },
    ],
    readingOrder: [titleId, bodyId],
  };
}
function tableFixture(): PresentationScene {
  const scene = fixture(4);
  return {
    ...scene,
    nodes: [
      ...scene.nodes,
      {
        id: tableId,
        type: "table",
        caption: "Recorded evidence",
        headers: ["Case", "Outcome"],
        rows: [
          ["A", "12"],
          ["B", "18"],
        ],
        frame: { x: 7, y: 60, width: 86, height: 30 },
      },
    ],
    readingOrder: [...scene.readingOrder, tableId],
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function content(scene: PresentationScene) {
  return {
    ...scene,
    nodes: scene.nodes.map((node) =>
      Object.fromEntries(Object.entries(node).filter(([key]) => key !== "frame")),
    ),
  };
}
function frames(scene: PresentationScene): PresentationSceneFrame[] {
  return scene.nodes.flatMap((node) => ("frame" in node ? [node.frame] : []));
}
function frame(scene: PresentationScene, id: string) {
  const node = scene.nodes.find((node) => node.id === id)!;
  if (!("frame" in node)) throw new Error("Expected a framed node");
  return node.frame;
}
function checkGeometry(scene: PresentationScene) {
  expect(PresentationSceneDraftSchema.safeParse(scene).success).toBe(true);
  const boxes = frames(scene);
  for (const [index, box] of boxes.entries()) {
    expect(Object.values(box).every(Number.isFinite)).toBe(true);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.width).toBeGreaterThanOrEqual(1);
    expect(box.height).toBeGreaterThanOrEqual(1);
    expect(box.x + box.width).toBeLessThanOrEqual(100);
    expect(box.y + box.height).toBeLessThanOrEqual(100);
    for (const other of boxes.slice(index + 1))
      expect(
        box.x + box.width <= other.x ||
          other.x + other.width <= box.x ||
          box.y + box.height <= other.y ||
          other.y + other.height <= box.y,
      ).toBe(true);
  }
}
function expectAlternatives(source: PresentationScene) {
  const before = JSON.stringify(source),
    suggestions = suggestNativeLayouts(freeze(source));
  expect(nativeLayoutSuggestionAvailability(source)).toEqual({ supported: true, reason: null });
  expect(suggestions.length).toBeGreaterThanOrEqual(2);
  expect(suggestions.length).toBeLessThanOrEqual(3);
  expect(new Set(suggestions.map(({ id }) => id)).size).toBe(suggestions.length);
  expect(new Set(suggestions.map(({ scene }) => JSON.stringify(frames(scene)))).size).toBe(
    suggestions.length,
  );
  for (const suggestion of suggestions) {
    checkGeometry(suggestion.scene);
    expect(content(suggestion.scene)).toEqual(content(source));
    expect(suggestion.scene.schemaVersion).toBe(source.schemaVersion);
    expect(suggestion.scene.design).toBe(source.design);
    expect(suggestion.scene.groups).toBe(source.groups);
    expect(suggestion.scene.readingOrder).toBe(source.readingOrder);
    expect(suggestion.scene.nodes.map(({ id }) => id)).toEqual(source.nodes.map(({ id }) => id));
    expect(frames(suggestion.scene)).not.toEqual(frames(source));
    expect(`${suggestion.label} ${suggestion.description}`).not.toMatch(
      /\bfits?\b|guarantee|verified|\bAI\b/iu,
    );
  }
  expect(JSON.stringify(source)).toBe(before);
  expect(suggestNativeLayouts(source)).toEqual(suggestions);
  return suggestions;
}
function changeText(scene: PresentationScene, id: string, text: string): PresentationScene {
  return {
    ...scene,
    nodes: scene.nodes.map((node) => {
      if (node.type !== "text" || node.id !== id) return node;
      const { richText, ...plain } = node;
      void richText;
      return { ...plain, text };
    }),
  };
}

describe("reviewed deterministic native layout alternatives", () => {
  it.each([1, 2, 3, 4, 5, 6] as const)(
    "changes only frames in scene%s, retaining text, links, marks, style, IDs and semantic order",
    (version) => {
      const scene = fixture(version),
        suggestions = expectAlternatives(scene);
      expect(suggestions.map(({ id }) => id)).toEqual(["text-focus", "text-roomy", "text-compact"]);
      for (const suggestion of suggestions) {
        const original = scene.nodes.find((node) => node.id === bodyId),
          body = suggestion.scene.nodes.find((node) => node.id === bodyId);
        expect(
          original?.type === "text" && body?.type === "text" && body.richText === original.richText,
        ).toBe(true);
      }
    },
  );
  it("uses density to rank distinct geometries without asserting fit", () => {
    const brief = fixture(1),
      longBody = changeText(brief, bodyId, "Long source text. ".repeat(80));
    expect(suggestNativeLayouts(brief)[0]!.id).toBe("text-focus");
    expect(suggestNativeLayouts(longBody)[0]!.id).toBe("text-compact");
    const longTitle = changeText(
      brief,
      titleId,
      "A long heading explains the evidence and provides the context needed before the audience begins reading the body.",
    );
    expect(suggestNativeLayouts(longTitle)[0]!.id).toBe("text-roomy");
    expect(suggestNativeLayouts(changeText(brief, titleId, "Heading\rContinuation"))[0]!.id).toBe(
      "text-roomy",
    );
    const roomy = (source: PresentationScene) =>
      suggestNativeLayouts(source).find(({ id }) => id === "text-roomy")!.scene;
    expect(frame(roomy(longTitle), titleId).height).toBeGreaterThan(
      frame(roomy(brief), titleId).height,
    );
    expect(frame(roomy(longTitle), bodyId).height).toBeLessThan(frame(roomy(brief), bodyId).height);
  });
  it("supports title/lead/table scenes and preserves every literal cell, caption and header", () => {
    const source = tableFixture(),
      suggestions = expectAlternatives(source),
      original = source.nodes.find((node) => node.type === "table")!;
    for (const suggestion of suggestions) {
      const table = suggestion.scene.nodes.find((node) => node.type === "table")!;
      expect(table.rows).toBe(original.rows);
      expect(table.headers).toBe(original.headers);
    }
    const textFirst = suggestions.find(({ id }) => id === "table-text-first")!.scene,
      dataFirst = suggestions.find(({ id }) => id === "table-data-first")!.scene;
    expect(frame(textFirst, bodyId).height).toBeGreaterThan(frame(dataFirst, bodyId).height);
    expect(frame(dataFirst, tableId).height).toBeGreaterThan(frame(textFirst, tableId).height);
  });
  it("ranks long lead text and dense tables separately, keeping all three candidates available", () => {
    const source = tableFixture(),
      longLead = changeText(source, bodyId, "Lead context. ".repeat(60));
    expect(suggestNativeLayouts(longLead)[0]!.id).toBe("table-text-first");
    const dense = {
      ...source,
      nodes: source.nodes.map((node) =>
        node.type === "table"
          ? {
              ...node,
              rows: Array.from({ length: 20 }, (_, index) => [`Case ${index}`, "Recorded outcome"]),
            }
          : node,
      ),
    };
    expect(suggestNativeLayouts(dense).map(({ id }) => id)).toEqual([
      "table-data-first",
      "table-balanced",
      "table-text-first",
    ]);
    expectAlternatives(dense);
    const balanced = (scene: PresentationScene) =>
      suggestNativeLayouts(scene).find(({ id }) => id === "table-balanced")!.scene;
    expect(frame(balanced(longLead), bodyId).height).toBeGreaterThan(
      frame(balanced(source), bodyId).height,
    );
  });
  it("omits the current geometry instead of offering a no-op, including negligible numeric differences", () => {
    const current = suggestNativeLayouts(fixture())[0]!,
      remaining = suggestNativeLayouts(current.scene);
    expect(remaining).toHaveLength(2);
    expect(remaining.some(({ id }) => id === current.id)).toBe(false);
    const equivalent = {
      ...current.scene,
      nodes: current.scene.nodes.map((node) =>
        "frame" in node ? { ...node, frame: { ...node.frame, x: node.frame.x + 1e-9 } } : node,
      ),
    };
    expect(suggestNativeLayouts(equivalent).some(({ id }) => id === current.id)).toBe(false);
  });
  it("rejects grouped and rotated slides without changing them, while allowing preserved empty groups and zero rotation", () => {
    const source = fixture(4),
      grouped = { ...source, groups: [{ id: "Pair", nodeIds: [titleId, bodyId] }] },
      rotated = {
        ...source,
        nodes: source.nodes.map((node) => (node.id === bodyId ? { ...node, rotation: 5 } : node)),
      };
    for (const [scene, reason] of [
      [grouped, /grouped/],
      [rotated, /rotated/],
    ] as const) {
      expect(PresentationSceneDraftSchema.safeParse(scene).success).toBe(true);
      const bytes = JSON.stringify(scene);
      expect(suggestNativeLayouts(freeze(scene))).toEqual([]);
      expect(nativeLayoutSuggestionAvailability(scene)).toMatchObject({
        supported: false,
        reason: expect.stringMatching(reason),
      });
      expect(JSON.stringify(scene)).toBe(bytes);
    }
    expectAlternatives(source);
  });
  it("declines extra objects and other compositions without dropping, splitting or converting them", () => {
    const source = fixture(6);
    const extras: PresentationSceneNode[] = [
      {
        id: "Image",
        type: "image",
        mediaId: "00000000-0000-4000-8000-000000000001",
        altText: "Evidence",
        frame: { x: 10, y: 25, width: 30, height: 40 },
      },
      {
        id: "Shape",
        type: "shape",
        shape: "rectangle",
        color: "blue",
        label: "Evidence",
        frame: { x: 10, y: 25, width: 30, height: 40 },
      },
      {
        id: "Edge",
        type: "connector",
        from: { nodeId: titleId, anchor: "bottom" },
        to: { nodeId: bodyId, anchor: "top" },
        label: "supports",
        color: "blue",
      },
      {
        id: "Chart",
        type: "chart",
        chartType: "bar",
        title: "Count",
        summary: "Two cases",
        categories: ["A"],
        series: [{ name: "Count", values: [2] }],
        frame: { x: 10, y: 25, width: 30, height: 40 },
      },
      {
        id: "Reveal",
        type: "reveal",
        scope: "local",
        label: "Details",
        body: "Evidence",
        frame: { x: 10, y: 25, width: 30, height: 40 },
      },
      {
        id: "More body",
        type: "text",
        role: "body",
        text: "More evidence",
        frame: { x: 10, y: 25, width: 30, height: 40 },
      },
    ];
    for (const node of extras) {
      const scene = {
        ...source,
        nodes: [...source.nodes, node],
        readingOrder: [...source.readingOrder, node.id],
      };
      expect(PresentationSceneDraftSchema.safeParse(scene).success).toBe(true);
      const before = JSON.stringify(scene);
      expect(suggestNativeLayouts(freeze(scene))).toEqual([]);
      expect(nativeLayoutSuggestionAvailability(scene)).toMatchObject({
        supported: false,
        reason: expect.any(String),
      });
      expect(JSON.stringify(scene)).toBe(before);
    }
    const withoutLead = {
      ...tableFixture(),
      nodes: tableFixture().nodes.filter((node) => node.id !== bodyId),
      readingOrder: [titleId, tableId],
    };
    expect(PresentationSceneDraftSchema.safeParse(withoutLead).success).toBe(true);
    expect(suggestNativeLayouts(withoutLead)).toEqual([]);
  });
  it("rejects invalid source scenes before generating candidates", () => {
    const source = fixture();
    const invalid = [
      null,
      {},
      { ...source, schemaVersion: 7 },
      { ...source, readingOrder: [titleId, titleId] },
      {
        ...source,
        nodes: source.nodes.map((node) =>
          node.id === bodyId ? { ...node, frame: { x: 99, y: 0, width: 2, height: 10 } } : node,
        ),
      },
      {
        ...source,
        nodes: source.nodes.map((node) =>
          node.type === "text" && node.id === bodyId
            ? { ...node, text: "Does not match rich text" }
            : node,
        ),
      },
    ];
    for (const scene of invalid) {
      expect(suggestNativeLayouts(scene as PresentationScene)).toEqual([]);
      expect(nativeLayoutSuggestionAvailability(scene as PresentationScene)).toMatchObject({
        supported: false,
        reason: expect.stringMatching(/invalid/),
      });
    }
  });
  it("refuses valid near-budget sources when frame changes would exceed the unchanged scene limit", () => {
    const runs = Array.from({ length: 65 }, () => ({ text: "x", href: "https://example.test/" }));
    const scene: PresentationScene = {
      schemaVersion: 2,
      aspectRatio: "16:9",
      nodes: [
        {
          id: titleId,
          type: "text",
          role: "title",
          text: "Title",
          frame: { x: 1, y: 1, width: 1, height: 1 },
        },
        {
          id: bodyId,
          type: "text",
          role: "body",
          text: "x".repeat(runs.length),
          richText: { paragraphs: [{ kind: "paragraph", runs }] },
          frame: { x: 1, y: 1, width: 1, height: 1 },
        },
      ],
      readingOrder: [titleId, bodyId],
    };
    let remaining =
      PRESENTATION_SCENE_MAX_BYTES - 1 - new TextEncoder().encode(JSON.stringify(scene)).byteLength;
    for (const run of runs) {
      const count = Math.min(2048 - run.href.length, remaining);
      run.href += "a".repeat(count);
      remaining -= count;
    }
    expect(remaining).toBe(0);
    expect(PresentationSceneDraftSchema.safeParse(scene).success).toBe(true);
    const before = JSON.stringify(scene);
    expect(suggestNativeLayouts(freeze(scene))).toEqual([]);
    expect(nativeLayoutSuggestionAvailability(scene)).toMatchObject({
      supported: false,
      reason: expect.stringMatching(/limits/),
    });
    expect(JSON.stringify(scene)).toBe(before);
  });
  it("preserves block provenance, notes, spatial layout and document15 when applied through the existing deck helper", () => {
    const blockId = "00000000-0000-4000-8000-000000000001",
      scene = fixture(4);
    const draft = PresentationDraftSchema.parse({
      schemaVersion: 15,
      title: "Creator deck",
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
          speakerNotes: "Private author notes",
          scene,
          citations: [{ locator: "Page 1", excerpt: "Original source" }],
          sourceDisclosure: {
            sourceName: "Original source",
            sourceDigest: "a".repeat(64),
            provider: "original",
            model: "original-model",
            conversionNotes: ["Keep this note"],
          },
          textAssistance: {
            schemaVersion: 1,
            nodeId: bodyId,
            role: "body",
            operation: "rewrite",
            sourceDigest: "b".repeat(64),
            outputDigest: "c".repeat(64),
            provider: "approved",
            model: "approved-model",
            generatedAt: "2026-11-01T00:00:00.000Z",
            reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
          },
        },
      ],
    });
    const before = JSON.stringify(draft),
      next = applyNativeSceneToDeck(freeze(draft), blockId, suggestNativeLayouts(scene)[0]!.scene);
    expect(next.schemaVersion).toBe(15);
    expect(next.spatial).toBe(draft.spatial);
    expect(next.sections).toBe(draft.sections);
    const { scene: originalScene, ...originalBlock } = draft.blocks[0]! as Extract<
      (typeof draft.blocks)[number],
      { kind: "content" }
    >;
    const { scene: nextScene, ...nextBlock } = next.blocks[0]! as Extract<
      (typeof next.blocks)[number],
      { kind: "content" }
    >;
    expect(nextBlock).toEqual(originalBlock);
    expect(content(nextScene!)).toEqual(content(originalScene!));
    expect(JSON.stringify(draft)).toBe(before);
  });
  it("provides valid content-preserving alternatives for all nineteen bundled title/lead/table slides", () => {
    let counter = 0;
    const createId = () => `00000000-0000-4000-8000-${(++counter).toString().padStart(12, "0")}`;
    const scenes = nativePresentationTemplates.flatMap(({ id }) =>
      instantiateNativePresentationTemplate(id, createId).blocks.flatMap((block) =>
        block.kind === "content" && block.scene?.nodes.some((node) => node.type === "table")
          ? [block.scene]
          : [],
      ),
    );
    expect(scenes).toHaveLength(19);
    for (const scene of scenes) {
      const suggestions = expectAlternatives(scene);
      expect(suggestions.every(({ id }) => id.startsWith("table-"))).toBe(true);
    }
  });
});
