import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContentSlideDraftSchema,
  PresentationContentSchema,
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  PresentationLiveContentBlockSchema,
  PresentationSceneDraftSchema,
  PresentationSceneFrameSchema,
  PresentationSceneSchema,
  RecoveryPackContentSchema,
  adaptContentSlideToScene,
  contentSlideMediaFrame,
  presentationSceneTitle,
  recoveryPackContentHash,
  resolveContentSlideFrames,
  type ContentSlideDraft,
  type PresentationScene,
  type PresentationSceneNode,
} from "../src/index";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const frame = { x: 8, y: 8, width: 40, height: 20 };

function scene(): PresentationScene {
  return {
    schemaVersion: 1,
    aspectRatio: "16:9",
    nodes: [
      { id: "title", type: "text", role: "title", text: "Project update", frame: { ...frame } },
      { id: "image", type: "image", mediaId: uuid(2), altText: "Workflow", frame: { ...frame } },
      {
        id: "shape",
        type: "shape",
        shape: "diamond",
        color: "blue",
        label: "Decision",
        frame: { ...frame },
      },
      {
        id: "connector",
        type: "connector",
        from: { nodeId: "image", anchor: "right" },
        to: { nodeId: "shape", anchor: "left" },
        label: "Produces",
        color: "blue",
      },
    ],
    readingOrder: ["title", "image", "connector", "shape"],
  };
}

function legacySlide(): ContentSlideDraft {
  return {
    id: uuid(1),
    kind: "content",
    layout: "title_body",
    textElements: [
      { id: "body", role: "body", text: "An update", region: "middle_left", order: 0 },
      { id: "title", role: "title", text: "Project update", region: "top_center", order: 0 },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "Keep this note private.",
    citations: [{ locator: "Page 2", excerpt: "Original source" }],
    sourceDisclosure: {
      sourceName: "Brief",
      sourceDigest: "a".repeat(64),
      provider: "provider",
      model: "model",
    },
  };
}

function nativeSlide(): ContentSlideDraft {
  return { ...legacySlide(), textElements: [], scene: scene() };
}

function deck(block = nativeSlide()) {
  return { title: "Update", schemaVersion: 4, blocks: [block] };
}

function node<T extends PresentationSceneNode["type"]>(value: PresentationScene, type: T) {
  return value.nodes.find((item) => item.type === type)! as Extract<
    PresentationSceneNode,
    { type: T }
  >;
}

describe("production native Presentation scenes", () => {
  it("round-trips public scene content in a v4 document and the existing mutation envelope", () => {
    const input = deck();
    expect(PresentationSceneSchema.parse(input.blocks[0]!.scene)).toEqual(scene());
    expect(PresentationContentSchema.parse(input).blocks[0]).toEqual(nativeSlide());
    expect(
      PresentationDraftMutationSchema.parse({
        draft: input,
        schemaVersion: 2,
        mutationId: uuid(3),
        expectedRevision: 0,
      }).draft.schemaVersion,
    ).toBe(4);
    expect(presentationSceneTitle(scene())).toBe("Project update");
    const slide = nativeSlide();
    const live = {
      id: slide.id,
      kind: slide.kind,
      layout: slide.layout,
      textElements: slide.textElements,
      mediaId: slide.mediaId,
      mediaAlt: slide.mediaAlt,
      scene: slide.scene,
    };
    expect(PresentationLiveContentBlockSchema.parse(live)).toEqual(live);
    expect(PresentationLiveContentBlockSchema.safeParse(nativeSlide()).success).toBe(false);
  });

  it("requires v4 and rejects simultaneous legacy content, missing titles and empty legacy slides", () => {
    for (const schemaVersion of [2, 3]) {
      expect(PresentationDraftSchema.safeParse({ ...deck(), schemaVersion }).success).toBe(false);
      expect(PresentationContentSchema.safeParse({ ...deck(), schemaVersion }).success).toBe(false);
    }
    for (const patch of [
      { textElements: legacySlide().textElements },
      { mediaId: uuid(2) },
      { mediaAlt: "Hidden legacy description" },
    ]) {
      expect(ContentSlideDraftSchema.safeParse({ ...nativeSlide(), ...patch }).success).toBe(false);
    }
    expect(ContentSlideDraftSchema.safeParse({ ...legacySlide(), textElements: [] }).success).toBe(
      false,
    );
    const input = scene();
    node(input, "text").role = "body";
    expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
    input.nodes.push({ ...node(input, "text"), id: "title2", role: "title" });
    input.readingOrder.push("title2");
    expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(true);
    input.nodes.push({ ...node(input, "text"), id: "title3", role: "title" });
    input.readingOrder.push("title3");
    expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
  });

  it("retains incomplete draft text and descriptions but blocks publication until accessible", () => {
    const input = scene();
    node(input, "text").text = "";
    node(input, "image").altText = null;
    node(input, "shape").label = "";
    expect(
      PresentationDraftSchema.safeParse(deck({ ...nativeSlide(), scene: input })).success,
    ).toBe(true);
    const published = PresentationContentSchema.safeParse(deck({ ...nativeSlide(), scene: input }));
    expect(published.success).toBe(false);
    if (!published.success) {
      expect(published.error.issues.map((issue) => issue.path.join("."))).toEqual(
        expect.arrayContaining(["blocks.0.scene.nodes.1.altText", "blocks.0.scene.nodes.2.label"]),
      );
    }
    const blank = { ...input, nodes: [input.nodes[0]!], readingOrder: ["title"] };
    expect(PresentationSceneDraftSchema.safeParse(blank).success).toBe(true);
    expect(PresentationSceneSchema.safeParse(blank).success).toBe(false);
  });

  it("rejects private metadata, prototype assets, arbitrary URLs and unknown versions or markup", () => {
    for (const patch of [
      { speakerNotes: "secret" },
      { sourceDisclosure: { sourceName: "Private source" } },
      { artifactType: "presentation_scene_prototype" },
      { id: "prototype-id" },
      { schemaVersion: 2 },
      { aspectRatio: "4:3" },
    ]) {
      expect(PresentationSceneDraftSchema.safeParse({ ...scene(), ...patch }).success).toBe(false);
    }
    for (const patch of [
      { mediaId: "https://example.com/image.png" },
      { asset: { kind: "bundled_fixture", assetId: "workflow-diagram" } },
      { downloadUrl: "https://example.com/image.png" },
      { html: "<script>alert(1)</script>" },
    ]) {
      const input = scene();
      Object.assign(node(input, "image"), patch);
      expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
    }
  });

  it("canonicalizes native media UUIDs across PostgreSQL and memory authorization lookups", () => {
    const input = scene();
    const mediaId = "ABCDEFAB-1234-7ABC-8ABC-ABCDEFABCDEF";
    node(input, "image").mediaId = mediaId;
    const parsed = PresentationSceneDraftSchema.parse(input);
    expect(node(parsed, "image").mediaId).toBe(mediaId.toLowerCase());
    expect(node(input, "image").mediaId).toBe(mediaId);
    for (const specialId of [
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ]) {
      node(input, "image").mediaId = specialId;
      expect(node(PresentationSceneDraftSchema.parse(input), "image").mediaId).toBe(specialId);
    }
  });

  it("validates exact reading order coverage, stable IDs and connector targets", () => {
    for (const readingOrder of [
      ["title", "image", "shape"],
      ["title", "image", "connector", "shape", "shape"],
      ["title", "image", "connector", "missing"],
    ]) {
      expect(PresentationSceneDraftSchema.safeParse({ ...scene(), readingOrder }).success).toBe(
        false,
      );
    }
    for (const target of ["missing", "connector", "image"]) {
      const input = scene();
      node(input, "connector").to.nodeId = target;
      expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
    }
    const duplicate = scene();
    node(duplicate, "image").id = "title";
    expect(PresentationSceneDraftSchema.safeParse(duplicate).success).toBe(false);
  });

  it.each([
    { x: -1, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 91, y: 0, width: 10, height: 10 },
    { x: 0, y: 91, width: 10, height: 10 },
    { x: Number.NaN, y: 0, width: 10, height: 10 },
    { x: 0, y: Number.POSITIVE_INFINITY, width: 10, height: 10 },
  ])("rejects out-of-stage or nonfinite frames %j", (candidate) => {
    expect(PresentationSceneFrameSchema.safeParse(candidate).success).toBe(false);
  });

  it("bounds nodes and UTF-8 bytes while preserving ordinary author text verbatim", () => {
    const input = scene();
    node(input, "text").text = "  Title\n\tText  ";
    expect(PresentationSceneDraftSchema.parse(input)).toEqual(input);
    node(input, "text").text = "Hidden\u0000control";
    expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
    const many = (count: number, text: string): PresentationScene => ({
      schemaVersion: 1,
      aspectRatio: "16:9",
      nodes: Array.from({ length: count }, (_, index) => ({
        id: `text-${index}`,
        type: "text",
        role: index === 0 ? "title" : "body",
        text: index === 0 ? "Title" : text,
        frame: { ...frame },
      })),
      readingOrder: Array.from({ length: count }, (_, index) => `text-${index}`),
    });
    expect(PresentationSceneDraftSchema.safeParse(many(50, "Small")).success).toBe(true);
    expect(PresentationSceneDraftSchema.safeParse(many(51, "Small")).success).toBe(false);
    expect(PresentationSceneDraftSchema.safeParse(many(20, "a".repeat(3_000))).success).toBe(true);
    expect(PresentationSceneDraftSchema.safeParse(many(20, "界".repeat(3_000))).success).toBe(
      false,
    );
    const largeScene = many(40, "a".repeat(3_000));
    expect(PresentationSceneDraftSchema.safeParse(largeScene).success).toBe(true);
    const oversized = {
      ...deck(),
      blocks: Array.from({ length: 28 }, (_, index) => ({
        ...nativeSlide(),
        id: uuid(index + 100),
        scene: largeScene,
      })),
    };
    expect(() => PresentationDraftSchema.parse(oversized)).toThrow("3 MiB");
    expect(() => PresentationContentSchema.parse(oversized)).toThrow("3 MiB");
  });

  it("includes frozen Pack original/update metadata in the native document budget", () => {
    const question = (id: number) => ({
      id: uuid(id),
      type: "single_select",
      prompt: `Checkpoint ${id}`,
      purpose: "diagnostic",
      delivery: "main",
      conceptKeys: ["safe"],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 30,
      basePoints: 1_000,
      explanation: "Explanation",
      mediaId: null,
      mediaAlt: null,
      choices: [
        { id: uuid(id + 10), label: "First", isCorrect: true },
        { id: uuid(id + 20), label: "Second", isCorrect: false },
      ],
    });
    const pack = RecoveryPackContentSchema.parse({
      schemaVersion: 1,
      title: "Safety",
      diagnostic: { ...question(10), linkedRecheckQuestionId: uuid(11) },
      recheck: { ...question(11), delivery: "recheck" },
      interventions: Array.from({ length: 5 }, (_, index) => ({
        id: uuid(index + 50),
        title: "Context",
        body: "界".repeat(2_000),
      })),
      conceptKeys: ["safe"],
    });
    const contentHash = recoveryPackContentHash(pack);
    const insertions = Array.from({ length: 60 }, (_, index) => ({
      id: uuid(index + 100),
      packId: uuid(4),
      packVersionId: uuid(5),
      packVersion: 1,
      contentHash,
      diagnosticQuestionId: uuid(index + 200),
      recheckQuestionId: uuid(index + 300),
      originalContent: pack,
      updateBaseline: { packVersionId: uuid(6), packVersion: 2, contentHash, content: pack },
    }));
    const input = { ...deck(), recoveryPackInsertions: insertions };
    expect(() => PresentationDraftSchema.parse(input)).toThrow("3 MiB");
    expect(() => PresentationContentSchema.parse(input)).toThrow("3 MiB");
    // Pre-existing v3 admission remains unchanged, including retained source snapshots.
    expect(
      PresentationContentSchema.safeParse({
        ...input,
        schemaVersion: 3,
        blocks: [legacySlide()],
      }).success,
    ).toBe(true);
  });
});

describe("explicit native slide conversion and legacy compatibility", () => {
  it("preserves source metadata, IDs, frames and reading order without mutation", () => {
    const source = legacySlide();
    source.mediaId = uuid(2);
    source.mediaAlt = null;
    source.textElements[0]!.id = `${source.id}:image`;
    const before = structuredClone(source);
    const first = adaptContentSlideToScene(source);
    expect(adaptContentSlideToScene(source)).toEqual(first);
    expect(source).toEqual(before);
    expect(first).toMatchObject({
      id: source.id,
      textElements: [],
      mediaId: null,
      mediaAlt: null,
      speakerNotes: source.speakerNotes,
      citations: source.citations,
      sourceDisclosure: source.sourceDisclosure,
      scene: {
        readingOrder: ["title", `${source.id}:image`, `${source.id}:image:1`],
      },
    });
    for (const element of source.textElements) {
      expect(first.scene!.nodes.find((item) => item.id === element.id)).toMatchObject({
        text: element.text,
        frame: resolveContentSlideFrames(source)[element.id],
      });
    }
    expect(node(first.scene!, "image")).toMatchObject({
      mediaId: uuid(2),
      altText: null,
      frame: contentSlideMediaFrame,
    });
    expect(adaptContentSlideToScene(first)).toEqual(first);
  });

  it("rejects legacy-valid incompatible text without lossy conversion", () => {
    const source = legacySlide();
    source.textElements[0]!.text = "A\u0000B";
    const before = structuredClone(source);
    expect(ContentSlideDraftSchema.safeParse(source).success).toBe(true);
    expect(() => adaptContentSlideToScene(source)).toThrow();
    expect(source).toEqual(before);
  });

  it("keeps legacy v2 serialized output and content hashing unchanged", () => {
    const expected = {
      title: "Update",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [legacySlide()],
    };
    const serialized = JSON.stringify(expected);
    const content = PresentationContentSchema.parse({
      title: "Update",
      schemaVersion: 2,
      blocks: [legacySlide()],
    });
    expect(JSON.stringify(content)).toBe(serialized);
    expect(createHash("sha256").update(JSON.stringify(content)).digest("hex")).toBe(
      createHash("sha256").update(serialized).digest("hex"),
    );
  });
});
