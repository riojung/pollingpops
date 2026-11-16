import { describe, expect, it } from "vitest";
import {
  PRESENTATION_DESIGN_PALETTES,
  PresentationSceneDraftSchema,
  PresentationDeliveredSceneSchema,
  PresentationSceneTypographySchema,
  PresentationSceneShapeAppearanceSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationLiveContentBlockSchema,
  migratePresentationV1,
  preparePresentationPublication,
  presentationDesignPalette,
  type PresentationScene,
} from "../src/index";

const scene = (): PresentationScene => ({
  schemaVersion: 9,
  aspectRatio: "16:9",
  design: { theme: "paper", palette: "ink", font: "sans", spacing: "compact" },
  nodes: [
    {
      id: "decoration",
      type: "shape",
      shape: "rectangle",
      color: "blue",
      label: "",
      decorative: true,
      appearance: { fill: "accent", stroke: "none", strokeWidth: 0 },
      frame: { x: 0, y: 0, width: 20, height: 100 },
    },
    {
      id: "title",
      type: "text",
      role: "title",
      text: "A designed collection",
      typography: {
        size: 96,
        weight: 800,
        align: "right",
        font: "serif",
        color: "accent",
        leading: 0.95,
      },
      frame: { x: 25, y: 10, width: 70, height: 80 },
    },
  ],
  readingOrder: ["title", "decoration"],
});
const block = () => ({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "content" as const,
  layout: "title_body" as const,
  textElements: [],
  mediaId: null,
  mediaAlt: null,
  speakerNotes: "Private speaker cue",
  scene: scene(),
});
const deck = () => ({ title: "Designed", description: "", schemaVersion: 18, blocks: [block()] });

describe("additive styled native scenes", () => {
  it("round-trips palette, typography and decorative paint through authoring, publication and public delivery", () => {
    const input = scene();
    expect(PresentationSceneDraftSchema.parse(input)).toEqual(input);
    expect(PresentationDeliveredSceneSchema.parse(input)).toEqual(input);
    const draft = PresentationDraftSchema.parse(deck());
    expect(migratePresentationV1(draft)).toBe(draft);
    expect(PresentationContentSchema.parse(preparePresentationPublication(draft))).toEqual(draft);
    const { speakerNotes, ...publicBlock } = block();
    void speakerNotes;
    const delivered = PresentationLiveContentBlockSchema.parse(publicBlock);
    expect(delivered.scene).toEqual(input);
    expect(JSON.stringify(delivered)).not.toContain("Private speaker cue");
    expect(PresentationLiveContentBlockSchema.safeParse(block()).success).toBe(false);
  });

  it("requires scene9/document18 while preserving stored scenes1 through8 without defaults", () => {
    const input = scene();
    for (let schemaVersion = 1; schemaVersion < 9; schemaVersion++)
      expect(PresentationSceneDraftSchema.safeParse({ ...input, schemaVersion }).success).toBe(
        false,
      );
    for (let schemaVersion = 2; schemaVersion < 18; schemaVersion++)
      expect(PresentationDraftSchema.safeParse({ ...deck(), schemaVersion }).success).toBe(false);
    for (let schemaVersion = 1; schemaVersion <= 8; schemaVersion++) {
      const historical = {
        schemaVersion,
        aspectRatio: "16:9",
        nodes: [
          {
            id: "title",
            type: "text",
            role: "title",
            text: "Historical",
            frame: { x: 5, y: 5, width: 90, height: 20 },
          },
        ],
        readingOrder: ["title"],
      };
      expect(PresentationSceneDraftSchema.parse(historical)).toEqual(historical);
    }
    expect(
      presentationDesignPalette({ theme: "paper", font: "sans", spacing: "relaxed" }).background,
    ).toBe("#fffdf7");
    expect(presentationDesignPalette(scene().design)).toEqual(PRESENTATION_DESIGN_PALETTES.ink);
  });

  it("rejects arbitrary CSS, URLs, unknown properties and out-of-range typography or paint", () => {
    for (const value of [
      { size: 11 },
      { size: 145 },
      { size: Infinity },
      { weight: 450 },
      { align: "justify" },
      { font: "url(https://example.com/font)" },
      { color: "#fff" },
      { leading: 0.84 },
      { leading: 1.81 },
      { style: "display:none" },
    ])
      expect(PresentationSceneTypographySchema.safeParse(value).success).toBe(false);
    for (const value of [
      { fill: "url(https://example.com)" },
      { stroke: "#fff" },
      { strokeWidth: -1 },
      { strokeWidth: 7 },
      { filter: "blur(2px)" },
    ])
      expect(PresentationSceneShapeAppearanceSchema.safeParse(value).success).toBe(false);
    expect(PresentationSceneTypographySchema.parse({})).toEqual({});
    expect(PresentationSceneShapeAppearanceSchema.parse({})).toEqual({});
    for (const palette of Object.keys(PRESENTATION_DESIGN_PALETTES))
      expect(
        PresentationSceneDraftSchema.safeParse({
          ...scene(),
          design: { ...scene().design, palette },
        }).success,
      ).toBe(true);
    expect(
      PresentationSceneDraftSchema.safeParse({
        ...scene(),
        design: { ...scene().design, palette: "url(https://example.com)" },
      }).success,
    ).toBe(false);
  });
  it("keeps standard palette text, links, muted copy and accent labels at readable contrast", () => {
    const luminance = (hex: string) => {
      const channels = hex
        .slice(1)
        .match(/../g)!
        .map((value) => Number.parseInt(value, 16) / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };
    const contrast = (a: string, b: string) => {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    for (const palette of Object.values(PRESENTATION_DESIGN_PALETTES)) {
      for (const role of ["text", "link", "muted"] as const)
        expect(contrast(palette[role], palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.accentText, palette.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
