import {
  ContentSlideDraftSchema,
  PresentationDraftSchema,
  PresentationSceneSchema,
  adaptContentSlideToScene,
  type ContentSlideDraft,
  type PresentationDraft,
  type PresentationScene,
  type PresentationSceneDesign,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";
import { nativeSceneDocumentVersion } from "./presentation-deck-design";
import { resolvePresentationContentDesign } from "./presentation-activity-design";
import { clientUuid } from "./uuid";

export const DESIGN_LAYOUTS = [
  "cover",
  "section",
  "body",
  "split",
  "image_left",
  "image_right",
  "data",
  "closing",
] as const;
export type DesignLayoutId = (typeof DESIGN_LAYOUTS)[number];

/** Original visual families, kept independent of use-case and subject-matter templates. */
export const PRESENTATION_DESIGNS = [
  {
    id: "studio",
    name: "Studio",
    style: "minimal",
    tone: "light",
    design: { theme: "paper", font: "sans", spacing: "relaxed" },
  },
  {
    id: "editorial",
    name: "Editorial",
    style: "editorial",
    tone: "light",
    design: { theme: "paper", font: "serif", spacing: "relaxed" },
  },
  {
    id: "midnight",
    name: "Midnight",
    style: "bold",
    tone: "dark",
    design: { theme: "midnight", font: "sans", spacing: "relaxed" },
  },
  {
    id: "blueprint",
    name: "Blueprint",
    style: "technical",
    tone: "cool",
    design: { theme: "ocean", font: "mono", spacing: "compact" },
  },
  {
    id: "terracotta",
    name: "Terracotta",
    style: "editorial",
    tone: "warm",
    design: { theme: "sunset", font: "serif", spacing: "relaxed" },
  },
  {
    id: "signal",
    name: "Signal",
    style: "bold",
    tone: "warm",
    design: { theme: "sunset", font: "sans", spacing: "compact" },
  },
  {
    id: "monograph",
    name: "Monograph",
    style: "technical",
    tone: "dark",
    design: { theme: "midnight", font: "mono", spacing: "compact" },
  },
  {
    id: "canvas",
    name: "Canvas",
    style: "minimal",
    tone: "cool",
    design: { theme: "ocean", font: "sans", spacing: "relaxed" },
  },
] as const satisfies readonly {
  id: string;
  name: string;
  style: "minimal" | "editorial" | "bold" | "technical";
  tone: "light" | "dark" | "warm" | "cool";
  design: PresentationSceneDesign;
}[];
export type PresentationDesign = (typeof PRESENTATION_DESIGNS)[number];
export type PresentationDesignId = PresentationDesign["id"];

export interface PresentationDesignSlideCopy {
  title: string;
  body: string;
  eyebrow?: string;
  leftTitle?: string;
  leftBody?: string;
  rightTitle?: string;
  rightBody?: string;
  imageLabel?: string;
  dataCaption?: string;
  dataHeaders?: [string, string];
  dataRows?: [string, string][];
  speakerNotes?: string;
}

export interface PresentationDesignDraftCopy {
  title: string;
  description: string;
  slides: Record<DesignLayoutId, PresentationDesignSlideCopy>;
}

type Shape = Extract<PresentationSceneNode, { type: "shape" }>;
type FeatureFrames = {
  title: PresentationSceneFrame;
  body: PresentationSceneFrame;
  mark: PresentationSceneFrame;
};
type FamilyGeometry = {
  accent: Shape["color"];
  glyph: Shape["shape"];
  cover: FeatureFrames;
  section: FeatureFrames;
  closing: FeatureFrames;
  title: PresentationSceneFrame;
  eyebrow: PresentationSceneFrame;
  body: PresentationSceneFrame;
  split: [PresentationSceneFrame, PresentationSceneFrame];
  media: [PresentationSceneFrame, PresentationSceneFrame];
  table: PresentationSceneFrame;
};
const frame = (x: number, y: number, width: number, height: number): PresentationSceneFrame => ({
  x,
  y,
  width,
  height,
});
const feature = (title: number[], body: number[], mark: number[]): FeatureFrames => ({
  title: frame(title[0]!, title[1]!, title[2]!, title[3]!),
  body: frame(body[0]!, body[1]!, body[2]!, body[3]!),
  mark: frame(mark[0]!, mark[1]!, mark[2]!, mark[3]!),
});

/** Each family has authored silhouettes, proportions and a recurring native geometric mark. */
const GEOMETRY: Record<PresentationDesignId, FamilyGeometry> = {
  studio: {
    accent: "amber",
    glyph: "ellipse",
    cover: feature([7, 20, 61, 34], [7, 61, 61, 27], [77, 17, 16, 28]),
    section: feature([7, 18, 64, 36], [7, 64, 64, 27], [80, 66, 13, 23]),
    closing: feature([7, 14, 61, 34], [7, 58, 61, 30], [77, 56, 16, 28]),
    title: frame(7, 7, 86, 21),
    eyebrow: frame(7, 31, 86, 10),
    body: frame(7, 46, 74, 46),
    split: [frame(7, 46, 40, 46), frame(53, 46, 40, 46)],
    media: [frame(7, 44, 40, 48), frame(53, 44, 40, 48)],
    table: frame(7, 45, 86, 47),
  },
  editorial: {
    accent: "lavender",
    glyph: "diamond",
    cover: feature([8, 12, 53, 46], [64, 57, 28, 34], [68, 14, 20, 35]),
    section: feature([34, 12, 58, 43], [34, 66, 58, 26], [8, 16, 18, 32]),
    closing: feature([8, 13, 84, 32], [39, 58, 53, 34], [8, 59, 19, 33]),
    title: frame(8, 7, 84, 22),
    eyebrow: frame(8, 33, 84, 10),
    body: frame(24, 48, 68, 44),
    split: [frame(8, 48, 29, 44), frame(44, 48, 48, 44)],
    media: [frame(8, 47, 46, 45), frame(61, 47, 31, 45)],
    table: frame(17, 48, 75, 44),
  },
  midnight: {
    accent: "sky",
    glyph: "chevron",
    cover: feature([7, 12, 67, 42], [7, 62, 67, 29], [81, 13, 12, 73]),
    section: feature([7, 35, 72, 29], [7, 72, 72, 21], [7, 8, 32, 19]),
    closing: feature([7, 11, 86, 36], [7, 58, 63, 34], [79, 58, 14, 34]),
    title: frame(7, 8, 77, 23),
    eyebrow: frame(7, 35, 77, 10),
    body: frame(7, 50, 77, 42),
    split: [frame(7, 50, 47, 42), frame(61, 50, 32, 42)],
    media: [frame(7, 49, 47, 43), frame(61, 49, 32, 43)],
    table: frame(7, 50, 86, 42),
  },
  blueprint: {
    accent: "mint",
    glyph: "hexagon",
    cover: feature([8, 16, 59, 35], [8, 60, 59, 30], [75, 20, 17, 30]),
    section: feature([30, 14, 62, 35], [30, 60, 62, 31], [8, 16, 15, 27]),
    closing: feature([8, 14, 59, 34], [8, 61, 59, 30], [76, 58, 16, 29]),
    title: frame(8, 8, 84, 22),
    eyebrow: frame(8, 34, 84, 9),
    body: frame(16, 49, 76, 42),
    split: [frame(8, 49, 38, 42), frame(54, 49, 38, 42)],
    media: [frame(8, 49, 38, 42), frame(54, 49, 38, 42)],
    table: frame(8, 49, 84, 42),
  },
  terracotta: {
    accent: "orange",
    glyph: "ellipse",
    cover: feature([9, 13, 56, 38], [9, 62, 56, 29], [73, 45, 18, 32]),
    section: feature([9, 37, 82, 29], [9, 74, 70, 18], [9, 9, 13, 23]),
    closing: feature([32, 15, 59, 35], [32, 62, 59, 29], [9, 17, 15, 27]),
    title: frame(9, 8, 82, 22),
    eyebrow: frame(9, 34, 82, 9),
    body: frame(9, 50, 68, 41),
    split: [frame(9, 50, 32, 41), frame(49, 50, 42, 41)],
    media: [frame(9, 49, 42, 42), frame(59, 49, 32, 42)],
    table: frame(9, 50, 82, 41),
  },
  signal: {
    accent: "yellow",
    glyph: "parallelogram",
    cover: feature([7, 10, 86, 35], [7, 58, 62, 34], [77, 59, 16, 28]),
    section: feature([7, 11, 62, 36], [7, 62, 62, 29], [77, 11, 16, 80]),
    closing: feature([7, 38, 86, 28], [7, 75, 86, 18], [7, 8, 35, 21]),
    title: frame(7, 7, 86, 23),
    eyebrow: frame(7, 34, 86, 9),
    body: frame(7, 49, 86, 43),
    split: [frame(7, 49, 32, 43), frame(46, 49, 47, 43)],
    media: [frame(7, 48, 32, 44), frame(46, 48, 47, 44)],
    table: frame(7, 49, 86, 43),
  },
  monograph: {
    accent: "lavender",
    glyph: "rectangle",
    cover: feature([29, 14, 63, 35], [29, 63, 63, 28], [8, 14, 12, 77]),
    section: feature([8, 13, 67, 35], [8, 63, 67, 28], [82, 13, 10, 77]),
    closing: feature([8, 14, 84, 35], [29, 63, 63, 28], [8, 63, 12, 28]),
    title: frame(8, 8, 84, 23),
    eyebrow: frame(8, 35, 84, 9),
    body: frame(29, 50, 63, 41),
    split: [frame(8, 50, 26, 41), frame(42, 50, 50, 41)],
    media: [frame(8, 49, 50, 42), frame(66, 49, 26, 42)],
    table: frame(8, 50, 84, 41),
  },
  canvas: {
    accent: "sky",
    glyph: "rounded_rectangle",
    cover: feature([7, 18, 59, 35], [7, 65, 59, 26], [75, 18, 18, 64]),
    section: feature([7, 15, 59, 35], [7, 63, 59, 28], [75, 60, 18, 31]),
    closing: feature([31, 15, 62, 35], [31, 63, 62, 28], [7, 15, 17, 76]),
    title: frame(7, 8, 86, 22),
    eyebrow: frame(7, 34, 86, 9),
    body: frame(7, 49, 70, 43),
    split: [frame(7, 49, 43, 43), frame(57, 49, 36, 43)],
    media: [frame(7, 48, 43, 44), frame(57, 48, 36, 44)],
    table: frame(7, 49, 79, 43),
  },
};

export function isPresentationDesignId(value: string): value is PresentationDesignId {
  return PRESENTATION_DESIGNS.some((entry) => entry.id === value);
}

function findDesign(id: PresentationDesignId) {
  const design = PRESENTATION_DESIGNS.find((entry) => entry.id === id);
  if (!design) throw new Error("Presentation design not found");
  return design;
}

/** Localized, editable demonstration copy comes from the caller; no external assets are needed. */
export function createDesignSlide(
  designId: PresentationDesignId,
  layoutId: DesignLayoutId,
  copy: PresentationDesignSlideCopy,
  createId: () => string = clientUuid,
): ContentSlideDraft {
  const family = findDesign(designId);
  if (!DESIGN_LAYOUTS.includes(layoutId)) throw new Error("Presentation design layout not found");
  const geometry = GEOMETRY[designId];
  const nodes: PresentationSceneNode[] = [];
  const text = (value: string, bounds: PresentationSceneFrame, role: "title" | "body" = "body") => {
    nodes.push({ id: createId(), type: "text", role, text: value, frame: { ...bounds } });
  };
  const shape = (label: string, bounds: PresentationSceneFrame, glyph = geometry.glyph) => {
    nodes.push({
      id: createId(),
      type: "shape",
      shape: glyph,
      color: geometry.accent,
      label,
      frame: { ...bounds },
    });
  };
  const eyebrow = copy.eyebrow?.trim();
  if (layoutId === "cover" || layoutId === "section" || layoutId === "closing") {
    const bounds = geometry[layoutId];
    text(copy.title, bounds.title, "title");
    text(copy.body, bounds.body);
    shape(eyebrow || copy.title, bounds.mark);
  } else {
    text(copy.title, geometry.title, "title");
    if (eyebrow) text(eyebrow, geometry.eyebrow);
    if (layoutId === "body") {
      text(copy.body, geometry.body);
    } else if (layoutId === "split") {
      text(
        [copy.leftTitle, copy.leftBody ?? copy.body].filter(Boolean).join("\n\n"),
        geometry.split[0],
      );
      text(
        [copy.rightTitle, copy.rightBody ?? copy.body].filter(Boolean).join("\n\n"),
        geometry.split[1],
      );
    } else if (layoutId === "image_left" || layoutId === "image_right") {
      const mirror = (bounds: PresentationSceneFrame) =>
        layoutId === "image_right" ? { ...bounds, x: 100 - bounds.x - bounds.width } : bounds;
      shape(copy.imageLabel ?? copy.title, mirror(geometry.media[0]), "rounded_rectangle");
      text(copy.body, mirror(geometry.media[1]));
    } else {
      nodes.push({
        id: createId(),
        type: "table",
        frame: { ...geometry.table },
        caption: copy.dataCaption ?? copy.body,
        headers: [
          ...(copy.dataHeaders ?? [copy.leftTitle ?? copy.title, copy.rightTitle ?? copy.title]),
        ],
        rows: (
          copy.dataRows ?? [
            [copy.leftBody ?? copy.body, "24"],
            [copy.rightBody ?? copy.body, "36"],
          ]
        ).map((row) => [...row]),
      });
    }
  }
  const scene = PresentationSceneSchema.parse({
    schemaVersion: layoutId === "data" ? 4 : 3,
    aspectRatio: "16:9",
    design: { ...family.design },
    nodes,
    readingOrder: nodes.map((node) => node.id),
  });
  return ContentSlideDraftSchema.parse({
    id: createId(),
    kind: "content",
    layout: "title_body",
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: copy.speakerNotes ?? "",
    scene,
  });
}

/** A coordinated new deck is separate from applying style to an existing deck. */
export function createDesignDraft(
  designId: PresentationDesignId,
  copy: PresentationDesignDraftCopy,
  createId: () => string = clientUuid,
): PresentationDraft {
  return PresentationDraftSchema.parse({
    title: copy.title,
    description: copy.description,
    schemaVersion: 8,
    experiencePreset: { id: "studio", version: 1 },
    blocks: DESIGN_LAYOUTS.map((layout) =>
      createDesignSlide(designId, layout, copy.slides[layout], createId),
    ),
  });
}

export type PresentationDesignScope = { scope: "deck" | "slide"; blockId?: string };
export interface PresentationDesignSummary {
  nativeSlides: number;
  ordinarySlides: number;
  activitySlides: number;
  importedSlides: number;
  eligibleSlides: number;
}
export interface PresentationDesignApplicationSummary extends PresentationDesignSummary {
  changedSlides: number;
  convertedSlides: number;
}

function inScope(block: PresentationDraft["blocks"][number], options: PresentationDesignScope) {
  return options.scope === "deck" || block.id.toLowerCase() === options.blockId?.toLowerCase();
}

export function summarizePresentationDesign(
  draft: PresentationDraft,
  options: PresentationDesignScope,
): PresentationDesignSummary {
  const summary: PresentationDesignSummary = {
    nativeSlides: 0,
    ordinarySlides: 0,
    activitySlides: 0,
    importedSlides: 0,
    eligibleSlides: 0,
  };
  for (const block of draft.blocks) {
    if (!inScope(block, options)) continue;
    if (block.kind !== "content") {
      summary.activitySlides += 1;
      continue;
    }
    summary.eligibleSlides += 1;
    if (block.scene) summary.nativeSlides += 1;
    else summary.ordinarySlides += 1;
    if (block.sourceDisclosure?.model === "visual-import-v1") summary.importedSlides += 1;
  }
  return summary;
}

/**
 * Style changes retain native objects and geometry. Ordinary slides use the established
 * deterministic conversion, retaining text/media identities, metadata and resolved frames.
 * Activities retain their questions and inherit nearby content design through existing views.
 */
export function applyPresentationDesign(
  draft: PresentationDraft,
  designId: PresentationDesignId,
  options: PresentationDesignScope,
): { draft: PresentationDraft; summary: PresentationDesignApplicationSummary } {
  const family = findDesign(designId);
  const summary = {
    ...summarizePresentationDesign(draft, options),
    changedSlides: 0,
    convertedSlides: 0,
  };
  let schemaVersion = draft.schemaVersion;
  const blocks = draft.blocks.map((block) => {
    if (!inScope(block, options) || block.kind !== "content") return block;
    const converted = !block.scene;
    const content = converted ? adaptContentSlideToScene(block) : block;
    const original = content.scene!;
    // Unstyled native and ordinary slides borrow nearby design; an explicit static design
    // remains a barrier, so styling must not introduce motion on those slides.
    const motionBackground = block.scene?.design
      ? block.scene.design.motionBackground
      : resolvePresentationContentDesign(draft.blocks, block.id)?.motionBackground;
    const design: PresentationSceneDesign = {
      ...family.design,
      ...(motionBackground ? { motionBackground } : {}),
    };
    if (
      !converted &&
      original.design?.theme === design.theme &&
      original.design.font === design.font &&
      original.design.spacing === design.spacing
    )
      return block;
    const scene: PresentationScene = {
      ...original,
      schemaVersion: Math.max(
        original.schemaVersion,
        motionBackground ? 8 : 3,
      ) as PresentationScene["schemaVersion"],
      design,
    };
    schemaVersion = nativeSceneDocumentVersion(schemaVersion, scene);
    summary.changedSlides += 1;
    if (converted) summary.convertedSlides += 1;
    return { ...content, scene };
  });
  if (!summary.changedSlides) return { draft, summary };
  const next: PresentationDraft = {
    ...draft,
    schemaVersion,
    blocks,
    ...(schemaVersion >= 12 && draft.sections === undefined ? { sections: [] } : {}),
  };
  // Validate the complete budget before exposing any part of the operation to editor history.
  // Preserve source objects and frozen provenance rather than returning a canonicalized parse.
  PresentationDraftSchema.parse(next);
  return { draft: next, summary };
}
