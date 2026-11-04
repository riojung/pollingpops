import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PRESENTATION_DESIGN_SCENE_SCHEMA_VERSION,
  CreatePresentationSchema,
  createPresentationDesignScene,
  PresentationContentSchema,
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  PresentationLiveContentBlockSchema,
  PresentationSceneDesignSchema,
  PresentationSceneDraftSchema,
  PresentationSceneFocalPointSchema,
  PresentationSceneSchema,
  adaptContentSlideToScene,
  migratePresentationV1,
  plainTextToPresentationRichText,
  preparePresentationPublication,
  type ContentSlideDraft,
  type PresentationScene,
  type PresentationSceneDesign,
} from "../src/index";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const frame = { x: 8, y: 8, width: 84, height: 20 };
const design: PresentationSceneDesign = { theme: "ocean", font: "serif", spacing: "compact" };

describe("native Presentation creation", () => {
  it("makes native creation explicit without changing legacy request defaults", () => {
    expect(CreatePresentationSchema.parse({ title: "Blank" })).toEqual({
      title: "Blank",
      description: "",
    });
    expect(
      CreatePresentationSchema.parse({ title: "Blank", initialSlide: "native" }).initialSlide,
    ).toBe("native");
    expect(
      CreatePresentationSchema.safeParse({ title: "Blank", initialSlide: "unknown" }).success,
    ).toBe(false);
    const starter = createPresentationDesignScene("title", "body");
    expect(PresentationSceneDraftSchema.parse(starter)).toEqual(starter);
    expect(starter).toMatchObject({
      schemaVersion: 3,
      design: { theme: "paper", font: "sans", spacing: "relaxed" },
    });
    expect(starter.nodes.map((node) => node.id)).toEqual(["title", "body"]);
    expect(starter.readingOrder).toEqual(["title", "body"]);
    expect(PresentationSceneSchema.safeParse(starter).success).toBe(false);
  });
});

function scene(): PresentationScene {
  return {
    schemaVersion: PRESENTATION_DESIGN_SCENE_SCHEMA_VERSION,
    aspectRatio: "16:9",
    design: { ...design },
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Decision",
        richText: plainTextToPresentationRichText("Decision"),
        frame: { ...frame },
      },
      {
        id: "image",
        type: "image",
        mediaId: uuid(2),
        altText: "Evidence on the board",
        fit: "cover",
        focalPoint: { x: 25, y: 75 },
        frame: { x: 8, y: 35, width: 40, height: 50 },
      },
      {
        id: "shape",
        type: "shape",
        shape: "diamond",
        color: "blue",
        label: "Decision point",
        frame: { x: 55, y: 35, width: 35, height: 50 },
      },
      {
        id: "connector",
        type: "connector",
        from: { nodeId: "image", anchor: "right" },
        to: { nodeId: "shape", anchor: "left" },
        label: "Supports",
        color: "blue",
      },
    ],
    readingOrder: ["title", "image", "shape", "connector"],
  };
}

function slide(input = scene()): ContentSlideDraft {
  return {
    id: uuid(1),
    kind: "content",
    layout: "title_body",
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE presenter cue",
    citations: [{ locator: "PRIVATE source", excerpt: "PRIVATE excerpt" }],
    sourceDisclosure: {
      sourceName: "PRIVATE document",
      sourceDigest: "a".repeat(64),
      provider: "local",
      model: "none",
    },
    scene: input,
  };
}

function deck(schemaVersion = 7, input = scene()) {
  return { title: "Decision", schemaVersion, blocks: [slide(input)] };
}

function image(input: PresentationScene) {
  const result = input.nodes.find((node) => node.type === "image");
  if (result?.type !== "image") throw new Error("Expected image fixture");
  return result;
}

describe("closed native Presentation design contract", () => {
  it("round-trips every design token and all existing rich/plain scene node kinds", () => {
    for (const theme of PresentationSceneDesignSchema.shape.theme.options) {
      for (const font of PresentationSceneDesignSchema.shape.font.options) {
        for (const spacing of PresentationSceneDesignSchema.shape.spacing.options) {
          const input = { ...scene(), design: { theme, font, spacing } };
          expect(PresentationSceneDraftSchema.parse(input)).toEqual(input);
          expect(PresentationSceneSchema.parse(input)).toEqual(input);
        }
      }
    }
    const plain = scene();
    delete plain.design;
    for (const node of plain.nodes) if (node.type === "text") delete node.richText;
    delete image(plain).fit;
    delete image(plain).focalPoint;
    expect(PresentationSceneSchema.parse(plain)).toEqual(plain);
    expect(PresentationSceneSchema.parse(plain)).not.toHaveProperty("design");
    expect(image(PresentationSceneSchema.parse(plain))).not.toHaveProperty("fit");
    expect(image(PresentationSceneSchema.parse(plain))).not.toHaveProperty("focalPoint");
  });

  it.each([
    {},
    { theme: "ocean" },
    { ...design, theme: "custom" },
    { ...design, font: "url(https://example.com/font)" },
    { ...design, spacing: "10px" },
    { ...design, style: { background: "red" } },
    { ...design, html: "<script>alert(1)</script>" },
    { ...design, sourceDisclosure: {} },
    null,
    "ocean",
  ])("rejects partial, unknown and injected design values %j", (candidate) => {
    expect(PresentationSceneDesignSchema.safeParse(candidate).success).toBe(false);
    expect(PresentationSceneDraftSchema.safeParse({ ...scene(), design: candidate }).success).toBe(
      false,
    );
  });

  it("admits bounded cover focal points and contain fit without inventing defaults", () => {
    for (const x of [0, 50, 100]) {
      for (const y of [0, 50, 100]) {
        const input = scene();
        image(input).focalPoint = { x, y };
        expect(PresentationSceneSchema.parse(input)).toEqual(input);
      }
    }
    const input = scene();
    delete image(input).focalPoint;
    for (const fit of ["contain", "cover"] as const) {
      image(input).fit = fit;
      expect(PresentationSceneSchema.parse(input)).toEqual(input);
    }
  });

  it("rejects nonfinite, unbounded, partial, injected and incompatible image crop data", () => {
    for (const axis of ["x", "y"] as const) {
      for (const value of [-1, 100.01, NaN, Infinity, -Infinity, "50", null]) {
        const focalPoint = { x: 50, y: 50, [axis]: value };
        expect(PresentationSceneFocalPointSchema.safeParse(focalPoint).success).toBe(false);
        const input = scene();
        Object.assign(image(input), { focalPoint });
        expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
      }
    }
    for (const patch of [
      { fit: "fill" },
      { fit: "cover; background:url(javascript:alert(1))" },
      { fit: "contain" },
      { fit: undefined },
      { focalPoint: { x: 50 } },
      { focalPoint: { x: 50, y: 50, unit: "%" } },
      { crop: { x: 0, y: 0, width: 100, height: 100 } },
      { style: { objectPosition: "50% 50%" } },
      { url: "https://example.com/untrusted.png" },
    ]) {
      const input = scene();
      Object.assign(image(input), patch);
      expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
    }
    const input = scene();
    delete image(input).fit;
    expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
  });

  it("keeps arbitrary styling, rotation, groups and data nodes outside the native contract", () => {
    for (const patch of [{ rotation: 45 }, { style: {} }, { font: "serif" }]) {
      const input = scene();
      Object.assign(input.nodes[0]!, patch);
      expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
    }
    for (const type of ["group", "chart", "data"]) {
      const input = scene();
      Object.assign(input.nodes[0]!, { type });
      expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
    }
    expect(PresentationSceneDraftSchema.safeParse({ ...scene(), css: "color:red" }).success).toBe(
      false,
    );
  });

  it.each([1, 2] as const)("rejects every design field under old scene v%s", (schemaVersion) => {
    const plain = scene();
    plain.schemaVersion = schemaVersion;
    delete plain.design;
    for (const node of plain.nodes) if (node.type === "text") delete node.richText;
    delete image(plain).fit;
    delete image(plain).focalPoint;
    expect(PresentationSceneSchema.parse(plain)).toEqual(plain);
    for (const value of [design, undefined]) {
      expect(PresentationSceneDraftSchema.safeParse({ ...plain, design: value }).success).toBe(
        false,
      );
    }
    for (const patch of [
      { fit: "contain" },
      { fit: "cover", focalPoint: { x: 50, y: 50 } },
      { fit: undefined },
      { fit: "cover", focalPoint: undefined },
    ]) {
      const input = structuredClone(plain);
      Object.assign(image(input), patch);
      expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("Presentation design document v7 compatibility", () => {
  it.each([2, 3, 4, 5, 6])("rejects scene3 under old document v%s", (schemaVersion) => {
    expect(PresentationDraftSchema.safeParse(deck(schemaVersion)).success).toBe(false);
    expect(PresentationContentSchema.safeParse(deck(schemaVersion)).success).toBe(false);
  });

  it("retains document7, the mutation envelope2, and older valid native scene versions", () => {
    const input = PresentationDraftSchema.parse(deck());
    expect(input.schemaVersion).toBe(7);
    expect(migratePresentationV1(input)).toBe(input);
    expect(PresentationContentSchema.parse(input).schemaVersion).toBe(7);
    expect(
      PresentationDraftMutationSchema.parse({
        draft: input,
        expectedRevision: 0,
        mutationId: uuid(3),
        schemaVersion: 2,
      }).draft,
    ).toEqual(input);
    for (const schemaVersion of [1, 2] as const) {
      const older = scene();
      older.schemaVersion = schemaVersion;
      delete older.design;
      delete image(older).fit;
      delete image(older).focalPoint;
      if (schemaVersion === 1) {
        for (const node of older.nodes) if (node.type === "text") delete node.richText;
      }
      const retained = PresentationContentSchema.parse(deck(7, older));
      expect(retained.schemaVersion).toBe(7);
      expect(retained.blocks[0]!.kind === "content" && retained.blocks[0]!.scene).toEqual(older);
    }
    const withoutDesign = scene();
    delete withoutDesign.design;
    delete image(withoutDesign).fit;
    delete image(withoutDesign).focalPoint;
    const retained = PresentationDraftSchema.parse(deck(7, withoutDesign));
    expect(retained.schemaVersion).toBe(7);
    expect(adaptContentSlideToScene(slide(withoutDesign))).toEqual(slide(withoutDesign));
  });

  it("preserves full validated scene content in the strict audience projection", () => {
    const {
      speakerNotes: _notes,
      citations: _citations,
      sourceDisclosure: _source,
      ...publicBlock
    } = slide();
    void [_notes, _citations, _source];
    const projected = PresentationLiveContentBlockSchema.parse(publicBlock);
    expect(projected.scene).toEqual(scene());
    expect(JSON.stringify(projected)).not.toContain("PRIVATE");
    for (const privatePatch of [
      { speakerNotes: "PRIVATE cue" },
      { citations: [] },
      { sourceDisclosure: {} },
    ]) {
      expect(
        PresentationLiveContentBlockSchema.safeParse({ ...publicBlock, ...privatePatch }).success,
      ).toBe(false);
    }
    expect(
      PresentationLiveContentBlockSchema.safeParse({
        ...publicBlock,
        scene: { ...scene(), speakerNotes: "PRIVATE cue" },
      }).success,
    ).toBe(false);
  });

  it("keeps hidden scene3 slides draft-only and gives the all-hidden publication error in v7", () => {
    const input = deck();
    input.blocks[0]!.hidden = true;
    const draft = PresentationDraftSchema.parse(input);
    expect(draft.blocks[0]).toEqual(input.blocks[0]);
    expect(PresentationContentSchema.safeParse(draft).success).toBe(false);
    const prepared = preparePresentationPublication(draft);
    expect(prepared.schemaVersion).toBe(7);
    expect(prepared.blocks).toEqual([]);
    const result = PresentationContentSchema.safeParse(prepared);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ message }) => message)).toContain(
      "Show a slide or add an activity before publishing",
    );
  });

  it("retains default document2 without adding design or image defaults", () => {
    const legacy = {
      ...slide(),
      textElements: [
        { id: "title", role: "title", text: "Decision", region: "top_center", order: 0 },
      ],
    };
    delete legacy.scene;
    const parsed = PresentationDraftSchema.parse({ title: "Decision", blocks: [legacy] });
    expect(parsed.schemaVersion).toBe(2);
    expect(JSON.stringify(parsed)).not.toContain('"design"');
    expect(JSON.stringify(parsed)).not.toContain('"fit"');
    expect(JSON.stringify(parsed)).not.toContain('"focalPoint"');
  });

  it("freezes the canonical JSON hashes for prior documents rather than promoting them", () => {
    const expectedHashes = {
      // Generated with the previous contracts from git HEAD, before scene3 support.
      2: "8262b65f1b90214d8b704b4c61d582fa6725f4e6bcfff776ca9e309728d22879",
      3: "161f82e8d267ba8b970897c5b07e5d594b29b85d9143dc939d8da000060fe628",
      4: "c6a1b982af38306c63046dac13c3c6168e217a30644c794ab5b035a6dbef6a8d",
      5: "9dda8afc68d33028e039ab0cfa79001db91ea1d9dfce9bd1691b4e0acc38c8e7",
      6: "8a2efc2aded908d96be1d3bb89ba52101c73c6158942c0985e616f8a77f69cdb",
    };
    for (const schemaVersion of [2, 3, 4, 5, 6] as const) {
      const older = scene();
      older.schemaVersion = schemaVersion < 5 ? 1 : 2;
      delete older.design;
      delete image(older).fit;
      delete image(older).focalPoint;
      if (schemaVersion < 5) {
        for (const node of older.nodes) if (node.type === "text") delete node.richText;
      }
      const block = slide(older);
      if (schemaVersion < 4) {
        delete block.scene;
        block.textElements = [
          { id: "title", role: "title", text: "Decision", region: "top_center", order: 0 },
        ];
      }
      const input = { title: "Decision", schemaVersion, blocks: [block] };
      const draft = PresentationDraftSchema.parse(input);
      expect(migratePresentationV1(draft)).toEqual(draft);
      const parsed = PresentationContentSchema.parse(draft);
      expect(JSON.stringify(parsed)).toBe(JSON.stringify(draft));
      expect(createHash("sha256").update(JSON.stringify(parsed)).digest("hex")).toBe(
        expectedHashes[schemaVersion],
      );
    }
  });
});
