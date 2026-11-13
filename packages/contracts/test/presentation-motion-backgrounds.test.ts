import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PRESENTATION_MOTION_BACKGROUND_DOCUMENT_SCHEMA_VERSION,
  PRESENTATION_MOTION_BACKGROUND_PRESETS,
  PRESENTATION_MOTION_BACKGROUND_SCENE_SCHEMA_VERSION,
  PresentationContentSchema,
  PresentationDeliveredSceneSchema,
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  PresentationLiveContentBlockSchema,
  PresentationMotionBackgroundSchema,
  PresentationSceneDesignSchema,
  PresentationSceneDraftSchema,
  PresentationSceneSchema,
  migratePresentationV1,
  preparePresentationPublication,
  type PresentationScene,
  type PresentationSceneDesign,
} from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const staticDesign: PresentationSceneDesign = { theme: "ocean", font: "serif", spacing: "compact" };
const scene = (design: PresentationSceneDesign = staticDesign): PresentationScene => ({
  schemaVersion: 8,
  aspectRatio: "16:9",
  design,
  nodes: [
    {
      id: "title",
      frame: { x: 5, y: 5, width: 90, height: 15 },
      type: "text",
      role: "title",
      text: "Evidence",
    },
  ],
  readingOrder: ["title"],
});
const block = (input = scene()) => ({
  id: id(1),
  kind: "content" as const,
  layout: "title_body" as const,
  textElements: [],
  mediaId: null,
  mediaAlt: null,
  speakerNotes: "PRIVATE note",
  scene: input,
});
const deck = (input = scene()) => ({
  title: "Evidence",
  description: "",
  experiencePreset: { id: "focus", version: 1 },
  schemaVersion: 17,
  blocks: [block(input)],
});

describe("versioned built-in Presentation motion backgrounds", () => {
  it("exports exactly six closed presets and round-trips them through authoring, publication and delivery", () => {
    expect(PRESENTATION_MOTION_BACKGROUND_SCENE_SCHEMA_VERSION).toBe(8);
    expect(PRESENTATION_MOTION_BACKGROUND_DOCUMENT_SCHEMA_VERSION).toBe(17);
    expect(PRESENTATION_MOTION_BACKGROUND_PRESETS).toEqual([
      "aurora",
      "waves",
      "orbs",
      "mesh",
      "ribbons",
      "stars",
    ]);
    expect(PresentationMotionBackgroundSchema.options).toEqual(
      PRESENTATION_MOTION_BACKGROUND_PRESETS,
    );
    for (const motionBackground of PRESENTATION_MOTION_BACKGROUND_PRESETS) {
      const design = { ...staticDesign, motionBackground };
      const input = scene(design);
      expect(PresentationSceneDesignSchema.parse(design)).toEqual(design);
      for (const schema of [
        PresentationSceneDraftSchema,
        PresentationSceneSchema,
        PresentationDeliveredSceneSchema,
      ])
        expect(schema.parse(input)).toEqual(input);
      const draft = PresentationDraftSchema.parse(deck(input));
      expect(
        PresentationDraftMutationSchema.parse({
          schemaVersion: 2,
          draft,
          expectedRevision: 0,
          mutationId: id(2),
        }).draft,
      ).toEqual(draft);
      expect(PresentationContentSchema.parse(preparePresentationPublication(draft))).toEqual(draft);
      const { speakerNotes, ...publicBlock } = block(input);
      void speakerNotes;
      expect(PresentationLiveContentBlockSchema.parse({ ...publicBlock, design })).toEqual({
        ...publicBlock,
        design,
      });
    }
  });

  it("requires scene8/document17 and never permits a none token, CSS, URLs or payload objects", () => {
    const input = scene({ ...staticDesign, motionBackground: "aurora" });
    for (const schemaVersion of [1, 2, 3, 4, 5, 6, 7]) {
      for (const schema of [PresentationSceneDraftSchema, PresentationDeliveredSceneSchema]) {
        expect(schema.safeParse({ ...input, schemaVersion }).success).toBe(false);
        expect(
          schema.safeParse({
            ...input,
            schemaVersion,
            design: { ...staticDesign, motionBackground: undefined },
          }).success,
        ).toBe(false);
      }
    }
    for (const schema of [PresentationDraftSchema, PresentationContentSchema]) {
      for (let schemaVersion = 2; schemaVersion < 17; schemaVersion++)
        expect(schema.safeParse({ ...deck(input), schemaVersion }).success).toBe(false);
      // Version8 also requires document17 when its optional decoration is removed.
      expect(schema.safeParse({ ...deck(), schemaVersion: 16 }).success).toBe(false);
      expect(schema.safeParse({ ...deck(input), schemaVersion: 18 }).success).toBe(false);
    }
    expect(PresentationSceneSchema.safeParse({ ...input, schemaVersion: 9 }).success).toBe(false);
    for (const motionBackground of [
      "none",
      "Aurora",
      " aurora",
      "aurora ",
      "custom",
      "",
      null,
      1,
      "url(https://example.com/background.svg)",
      "aurora; color: red",
      { preset: "aurora" },
    ]) {
      expect(PresentationMotionBackgroundSchema.safeParse(motionBackground).success).toBe(false);
      expect(
        PresentationSceneSchema.safeParse({
          ...input,
          design: { ...staticDesign, motionBackground },
        }).success,
      ).toBe(false);
    }
    for (const extra of [{ speed: 1 }, { url: "https://example.com" }, { css: "color:red" }])
      expect(PresentationSceneDesignSchema.safeParse({ ...input.design, ...extra }).success).toBe(
        false,
      );
  });

  it("preserves historical canonical bytes and hashes without inventing a background or upgrading versions", () => {
    const hash = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    for (const schemaVersion of [1, 2, 3, 4, 5, 6, 7] as const) {
      const { design, ...plain } = scene();
      const input = { ...plain, schemaVersion, ...(schemaVersion >= 3 ? { design } : {}) };
      const before = PresentationSceneSchema.parse(input);
      const bytes = JSON.stringify(before);
      expect(JSON.stringify(PresentationSceneSchema.parse(JSON.parse(bytes)))).toBe(bytes);
      expect(hash(PresentationSceneSchema.parse(before))).toBe(hash(before));
      expect(before.design ?? {}).not.toHaveProperty("motionBackground");
    }
    // Old documents parse under their original versions; migration only handles legacy v1.
    const { scene: _scene, ...classic } = block();
    void _scene;
    for (let schemaVersion = 2; schemaVersion < 17; schemaVersion++) {
      const input = {
        ...deck(),
        schemaVersion,
        blocks: [
          {
            ...classic,
            textElements: [
              { id: "title", role: "title", text: "Evidence", region: "top_center", order: 0 },
            ],
          },
        ],
      };
      const before = PresentationContentSchema.parse(input);
      expect(migratePresentationV1(before)).toEqual(before);
      expect(hash(PresentationContentSchema.parse(before))).toBe(hash(before));
      expect(JSON.stringify(before)).not.toContain("motionBackground");
    }
    expect(PresentationSceneSchema.parse(scene()).design).toEqual(staticDesign);
    expect(PresentationContentSchema.parse(deck()).blocks[0]).toMatchObject({
      scene: { schemaVersion: 8, design: staticDesign },
    });
  });

  it("retains closed delivery privacy and publication filtering around the new token", () => {
    const input = scene({ ...staticDesign, motionBackground: "stars" });
    for (const extra of [{ speakerNotes: "PRIVATE" }, { sourceDisclosure: {} }, { private: true }])
      expect(PresentationDeliveredSceneSchema.safeParse({ ...input, ...extra }).success).toBe(
        false,
      );
    const draft = PresentationDraftSchema.parse({
      ...deck(input),
      blocks: [block(input), { ...block(input), id: id(3), hidden: true }],
    });
    const published = PresentationContentSchema.parse(preparePresentationPublication(draft));
    expect(published.blocks).toHaveLength(1);
    expect(published.blocks[0]).toMatchObject({ scene: input });
    expect(PresentationLiveContentBlockSchema.safeParse(block(input)).success).toBe(false);
  });
});
