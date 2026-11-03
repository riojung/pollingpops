import { describe, expect, it } from "vitest";
import {
  ContentSlideDraftSchema,
  PresentationContentSchema,
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  PresentationScenePrototypeFrameSchema,
  PresentationScenePrototypeSchema,
  adaptContentSlideToScenePrototype,
  contentSlideMediaFrame,
  migratePresentationV1,
  resolveContentSlideFrames,
  type ContentSlideDraft,
  type PresentationScenePrototype,
  type PresentationScenePrototypeNode,
} from "../src/index";

const slideId = "00000000-0000-4000-8000-000000000001";
const mediaId = "00000000-0000-4000-8000-000000000002";
const frame = { x: 8, y: 8, width: 40, height: 20 };

function scene(): PresentationScenePrototype {
  return {
    artifactType: "presentation_scene_prototype",
    schemaVersion: 1,
    id: "original-prototype-slide",
    aspectRatio: "16:9",
    speakerNotes: "Private preparation note",
    nodes: [
      { id: "title", type: "text", role: "title", text: "Project update", frame: { ...frame } },
      {
        id: "diagram",
        type: "image",
        frame: { x: 8, y: 40, width: 40, height: 40 },
        asset: { kind: "bundled_fixture", assetId: "workflow-diagram" },
        altText: "A three-step workflow",
      },
      {
        id: "outcome",
        type: "shape",
        frame: { x: 60, y: 40, width: 30, height: 30 },
        shape: "rounded_rectangle",
        color: "blue",
      },
      {
        id: "flow",
        type: "connector",
        from: { nodeId: "diagram", anchor: "right" },
        to: { nodeId: "outcome", anchor: "left" },
        label: "Produces",
        color: "blue",
      },
    ],
    readingOrder: ["title", "diagram", "flow", "outcome"],
  };
}

function legacySlide(): ContentSlideDraft {
  return {
    id: slideId,
    kind: "content",
    layout: "title_body",
    textElements: [
      { id: "later", role: "body", text: "Second item", region: "middle_left", order: 1 },
      { id: "first", role: "body", text: "First item", region: "middle_left", order: 0 },
      { id: "title", role: "title", text: "Legacy title", region: "top_center", order: 0 },
      { id: "end", role: "body", text: "Last item", region: "bottom_right", order: 0 },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "Keep this note private.\nPause here.",
  };
}

function nodeOfType<T extends PresentationScenePrototypeNode["type"]>(
  value: PresentationScenePrototype,
  type: T,
): Extract<PresentationScenePrototypeNode, { type: T }> {
  const found = value.nodes.find((node) => node.type === type);
  if (!found || found.type !== type) throw new Error(`Expected a ${type} node`);
  return found as Extract<PresentationScenePrototypeNode, { type: T }>;
}

describe("isolated Presentation scene prototype", () => {
  it("round-trips the strict four-node artifact without changing production schemas", () => {
    const input = scene();
    expect(PresentationScenePrototypeSchema.parse(input)).toEqual(input);
    expect(PresentationDraftSchema.safeParse(input).success).toBe(false);
    expect(PresentationContentSchema.safeParse(input).success).toBe(false);
    expect(
      PresentationDraftMutationSchema.safeParse({
        schemaVersion: 2,
        mutationId: mediaId,
        expectedRevision: 0,
        draft: input,
      }).success,
    ).toBe(false);
  });

  it("rejects future versions and unrecognized node or style fields", () => {
    expect(
      PresentationScenePrototypeSchema.safeParse({ ...scene(), schemaVersion: 2 }).success,
    ).toBe(false);
    expect(
      PresentationScenePrototypeSchema.safeParse({ ...scene(), published: true }).success,
    ).toBe(false);
    const input = scene();
    expect(
      PresentationScenePrototypeSchema.safeParse({
        ...input,
        nodes: [{ ...input.nodes[0], style: "position:fixed" }, ...input.nodes.slice(1)],
      }).success,
    ).toBe(false);
    expect(
      PresentationScenePrototypeSchema.safeParse({
        ...input,
        nodes: [{ ...input.nodes[0], type: "html", html: "<script>1</script>" }],
        readingOrder: ["title"],
      }).success,
    ).toBe(false);
  });

  it.each([
    { x: -1, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 0, y: 0, width: 10, height: 0 },
    { x: 91, y: 0, width: 10, height: 10 },
    { x: 0, y: 91, width: 10, height: 10 },
    { x: Number.NaN, y: 0, width: 10, height: 10 },
    { x: 0, y: Number.POSITIVE_INFINITY, width: 10, height: 10 },
    { x: 0, y: 0, width: Number.NEGATIVE_INFINITY, height: 10 },
  ])("rejects invalid percentage geometry %j", (candidate) => {
    expect(PresentationScenePrototypeFrameSchema.safeParse(candidate).success).toBe(false);
  });

  it("accepts the exact boundary and preserves fractional positions", () => {
    const boundary = { x: 99, y: 98.5, width: 1, height: 1.5 };
    expect(PresentationScenePrototypeFrameSchema.parse(boundary)).toEqual(boundary);
  });

  it.each([
    ["title", "diagram", "outcome"],
    ["title", "diagram", "flow", "outcome", "outcome"],
    ["title", "diagram", "flow", "missing"],
  ])("requires exact semantic node coverage: %j", (...readingOrder) => {
    expect(PresentationScenePrototypeSchema.safeParse({ ...scene(), readingOrder }).success).toBe(
      false,
    );
  });

  it("rejects duplicate IDs, dangling endpoints, connector targets and self-connections", () => {
    const duplicate = scene();
    duplicate.nodes[1]!.id = "title";
    expect(PresentationScenePrototypeSchema.safeParse(duplicate).success).toBe(false);

    for (const target of ["missing", "flow", "diagram"]) {
      const input = scene();
      nodeOfType(input, "connector").to.nodeId = target;
      expect(PresentationScenePrototypeSchema.safeParse(input).success).toBe(false);
    }
  });

  it("keeps image references explicit and rejects arbitrary URL/path sources", () => {
    const input = scene();
    const image = nodeOfType(input, "image");
    image.asset = { kind: "legacy_private_media", mediaId };
    expect(PresentationScenePrototypeSchema.parse(input)).toEqual(input);
    for (const asset of [
      { kind: "bundled_fixture", assetId: "https://example.com/image.svg" },
      { kind: "bundled_fixture", assetId: "../../private.svg" },
      { kind: "legacy_private_media", mediaId: "https://example.com/private.png" },
      { kind: "legacy_private_media", mediaId, downloadUrl: "https://example.com/private.png" },
      { kind: "remote", url: "https://example.com/image.png" },
    ]) {
      expect(
        PresentationScenePrototypeSchema.safeParse({
          ...input,
          nodes: input.nodes.map((node) => (node.type === "image" ? { ...node, asset } : node)),
        }).success,
      ).toBe(false);
    }
  });

  it("bounds nodes and total UTF-8 bytes rather than JavaScript character count", () => {
    const manyNodes = (count: number, text: string): PresentationScenePrototype => ({
      ...scene(),
      nodes: Array.from({ length: count }, (_, index) => ({
        id: `body-${index}`,
        type: "text",
        role: "body",
        text,
        frame: { ...frame },
      })),
      readingOrder: Array.from({ length: count }, (_, index) => `body-${index}`),
    });
    expect(PresentationScenePrototypeSchema.safeParse(manyNodes(50, "Small")).success).toBe(true);
    expect(PresentationScenePrototypeSchema.safeParse(manyNodes(51, "Small")).success).toBe(false);
    expect(
      PresentationScenePrototypeSchema.safeParse(manyNodes(20, "a".repeat(3_000))).success,
    ).toBe(true);
    expect(
      PresentationScenePrototypeSchema.safeParse(manyNodes(20, "界".repeat(3_000))).success,
    ).toBe(false);
  });

  it("bounds text and notes while retaining incomplete draft accessibility metadata", () => {
    const input = scene();
    nodeOfType(input, "image").altText = null;
    expect(PresentationScenePrototypeSchema.safeParse(input).success).toBe(true);
    nodeOfType(input, "text").text = "x".repeat(161);
    expect(PresentationScenePrototypeSchema.safeParse(input).success).toBe(false);
    expect(
      PresentationScenePrototypeSchema.safeParse({ ...scene(), speakerNotes: "x".repeat(2_001) })
        .success,
    ).toBe(false);
  });

  it("rejects control characters without normalizing ordinary author text", () => {
    const input = scene();
    nodeOfType(input, "text").text = "Line one\n\tLine two";
    expect(PresentationScenePrototypeSchema.parse(input)).toEqual(input);
    nodeOfType(input, "text").text = "Hidden\u0000control";
    expect(PresentationScenePrototypeSchema.safeParse(input).success).toBe(false);
    expect(
      PresentationScenePrototypeSchema.safeParse({ ...scene(), id: "slide\nother" }).success,
    ).toBe(false);
  });
});

describe("current content-slide prototype adapter", () => {
  it.each(["title text", "element ID"] as const)(
    "rejects legacy-valid control characters in %s without lossy sanitization",
    (field) => {
      const source = legacySlide();
      const title = source.textElements.find((element) => element.role === "title")!;
      if (field === "title text") title.text = "A\u0000B";
      else title.id = "title\u0000legacy";
      const before = structuredClone(source);

      expect(ContentSlideDraftSchema.safeParse(source).success).toBe(true);
      expect(() => adaptContentSlideToScenePrototype(source)).toThrow();
      expect(source).toEqual(before);
      expect(field === "title text" ? title.text : title.id).toContain("\u0000");
    },
  );

  it("preserves source IDs, exact strings, notes and existing semantic order without mutation", () => {
    const source = legacySlide();
    source.textElements[1]!.text = "  Preserve these spaces.\nAnd this line.  ";
    const before = structuredClone(source);
    const adapted = adaptContentSlideToScenePrototype(source);

    expect(source).toEqual(before);
    expect(adapted.id).toBe(source.id);
    expect(adapted.speakerNotes).toBe(source.speakerNotes);
    expect(adapted.nodes.map((node) => node.id)).toEqual(
      source.textElements.map((element) => element.id),
    );
    expect(adapted.readingOrder).toEqual(["title", "first", "later", "end"]);
    for (const element of source.textElements) {
      expect(adapted.nodes.find((node) => node.id === element.id)).toEqual({
        id: element.id,
        type: "text",
        role: element.role,
        text: element.text,
        frame: resolveContentSlideFrames(source)[element.id],
      });
    }
    nodeOfType(adapted, "text").frame.x = 0;
    expect(source).toEqual(before);
    expect(adaptContentSlideToScenePrototype(source)).toEqual(
      adaptContentSlideToScenePrototype(before),
    );
  });

  it.each(["title", "title_body", "media", "quote", "section", "callout"] as const)(
    "uses existing resolved geometry for %s, including explicit image-safe frames",
    (layout) => {
      const source = legacySlide();
      source.layout = layout;
      source.mediaId = mediaId;
      source.mediaAlt = "Legacy illustration";
      source.textElements[0]!.frame = { x: 60, y: 75, width: 36, height: 22 };
      const before = structuredClone(source);
      const adapted = adaptContentSlideToScenePrototype(source);
      const expectedFrames = resolveContentSlideFrames(source);
      for (const node of adapted.nodes) {
        if (node.type === "text") expect(node.frame).toEqual(expectedFrames[node.id]);
      }
      expect(nodeOfType(adapted, "image")).toEqual({
        id: `${slideId}:image`,
        type: "image",
        frame: contentSlideMediaFrame,
        altText: source.mediaAlt,
        asset: { kind: "legacy_private_media", mediaId },
      });
      expect(adapted.readingOrder.at(-1)).toBe(`${slideId}:image`);
      expect(source).toEqual(before);
    },
  );

  it("derives a deterministic image ID without replacing a colliding text ID", () => {
    const source = legacySlide();
    source.textElements[0]!.id = `${slideId}:image`;
    source.mediaId = mediaId;
    const adapted = adaptContentSlideToScenePrototype(source);
    expect(adapted.nodes[0]!.id).toBe(`${slideId}:image`);
    expect(nodeOfType(adapted, "image").id).toBe(`${slideId}:image:1`);
    expect(adaptContentSlideToScenePrototype(source)).toEqual(adapted);
  });

  it("requires current structured source; callers explicitly upcast older source first", () => {
    const oldSlide = {
      id: slideId,
      kind: "content",
      layout: "quote",
      title: "Original title",
      body: "Original body",
      mediaId,
      mediaAlt: null,
      speakerNotes: "Original note",
    };
    expect(() => adaptContentSlideToScenePrototype(oldSlide as never)).toThrow();
    const current = PresentationDraftSchema.parse(
      migratePresentationV1({ title: "Old deck", schemaVersion: 1, blocks: [oldSlide] }),
    ).blocks[0];
    if (current?.kind !== "content") throw new Error("Expected migrated content");
    const before = ContentSlideDraftSchema.parse(current);
    const adapted = adaptContentSlideToScenePrototype(current);
    expect(adapted.nodes.filter((node) => node.type === "text").map((node) => node.text)).toEqual([
      "Original title",
      "Original body",
    ]);
    expect(nodeOfType(adapted, "image").asset).toEqual({ kind: "legacy_private_media", mediaId });
    expect(nodeOfType(adapted, "image").altText).toBeNull();
    expect(ContentSlideDraftSchema.parse(current)).toEqual(before);
    expect(ContentSlideDraftSchema.safeParse(adapted).success).toBe(false);
  });
});
