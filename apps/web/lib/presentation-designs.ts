import {
  ContentSlideDraftSchema,
  PresentationDraftSchema,
  PresentationSceneSchema,
  adaptContentSlideToScene,
  type ContentSlideDraft,
  type PresentationDraft,
  type PresentationScene,
  type PresentationSceneDesign,
} from "@openround/contracts";
import { nativeSceneDocumentVersion } from "./presentation-deck-design";
import { resolvePresentationContentDesign } from "./presentation-activity-design";
import { nativeSceneNodesForDesign } from "./presentation-native-design";
import { clientUuid } from "./uuid";
import { createPresentationDesignComposition } from "./presentation-design-compositions";

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
    design: { theme: "paper", font: "sans", spacing: "relaxed", palette: "cobalt" },
  },
  {
    id: "editorial",
    name: "Editorial",
    style: "editorial",
    tone: "light",
    design: { theme: "paper", font: "serif", spacing: "relaxed", palette: "sand" },
  },
  {
    id: "midnight",
    name: "Midnight",
    style: "bold",
    tone: "dark",
    design: { theme: "midnight", font: "sans", spacing: "relaxed", palette: "ink" },
  },
  {
    id: "blueprint",
    name: "Blueprint",
    style: "technical",
    tone: "cool",
    design: { theme: "ocean", font: "sans", spacing: "compact", palette: "cobalt" },
  },
  {
    id: "terracotta",
    name: "Terracotta",
    style: "editorial",
    tone: "warm",
    design: { theme: "sunset", font: "serif", spacing: "relaxed", palette: "clay" },
  },
  {
    id: "signal",
    name: "Signal",
    style: "bold",
    tone: "warm",
    design: { theme: "sunset", font: "sans", spacing: "compact", palette: "coral" },
  },
  {
    id: "monograph",
    name: "Monograph",
    style: "technical",
    tone: "dark",
    design: { theme: "midnight", font: "sans", spacing: "compact", palette: "default" },
  },
  {
    id: "canvas",
    name: "Canvas",
    style: "minimal",
    tone: "cool",
    design: { theme: "ocean", font: "sans", spacing: "relaxed", palette: "rose" },
  },
  {
    id: "atlas",
    name: "Atlas",
    style: "technical",
    tone: "light",
    design: { theme: "paper", font: "sans", spacing: "compact", palette: "forest" },
  },
  {
    id: "ledger",
    name: "Ledger",
    style: "minimal",
    tone: "light",
    design: { theme: "paper", font: "mono", spacing: "compact", palette: "default" },
  },
  {
    id: "prism",
    name: "Prism",
    style: "bold",
    tone: "warm",
    design: { theme: "paper", font: "sans", spacing: "relaxed", palette: "coral" },
  },
  {
    id: "folio",
    name: "Folio",
    style: "editorial",
    tone: "warm",
    design: { theme: "paper", font: "serif", spacing: "compact", palette: "sand" },
  },
  {
    id: "horizon",
    name: "Horizon",
    style: "technical",
    tone: "cool",
    design: { theme: "ocean", font: "mono", spacing: "relaxed", palette: "cobalt" },
  },
  {
    id: "circuit",
    name: "Circuit",
    style: "technical",
    tone: "dark",
    design: { theme: "midnight", font: "mono", spacing: "compact", palette: "ink" },
  },
  {
    id: "slate",
    name: "Slate",
    style: "minimal",
    tone: "dark",
    design: { theme: "midnight", font: "sans", spacing: "compact", palette: "ink" },
  },
  {
    id: "spectrum",
    name: "Spectrum",
    style: "bold",
    tone: "warm",
    design: { theme: "sunset", font: "mono", spacing: "relaxed", palette: "coral" },
  },
  {
    id: "botanica",
    name: "Botanica",
    style: "editorial",
    tone: "cool",
    design: { theme: "paper", font: "serif", spacing: "relaxed", palette: "forest" },
  },
  {
    id: "archive",
    name: "Archive",
    style: "editorial",
    tone: "warm",
    design: { theme: "paper", font: "serif", spacing: "compact", palette: "clay" },
  },
  {
    id: "workshop",
    name: "Workshop",
    style: "bold",
    tone: "light",
    design: { theme: "paper", font: "sans", spacing: "compact", palette: "rose" },
  },
  {
    id: "scholar",
    name: "Scholar",
    style: "technical",
    tone: "light",
    design: { theme: "paper", font: "serif", spacing: "compact", palette: "cobalt" },
  },
  {
    id: "ribbon",
    name: "Ribbon",
    style: "bold",
    tone: "warm",
    design: { theme: "sunset", font: "sans", spacing: "relaxed", palette: "rose" },
  },
  {
    id: "mosaic",
    name: "Mosaic",
    style: "minimal",
    tone: "light",
    design: { theme: "paper", font: "sans", spacing: "relaxed", palette: "rose" },
  },
  {
    id: "linen",
    name: "Linen",
    style: "minimal",
    tone: "warm",
    design: { theme: "paper", font: "sans", spacing: "relaxed", palette: "sand" },
  },
  {
    id: "beacon",
    name: "Beacon",
    style: "bold",
    tone: "cool",
    design: { theme: "ocean", font: "sans", spacing: "relaxed", palette: "forest" },
  },
  {
    id: "summit",
    name: "Summit",
    style: "minimal",
    tone: "light",
    design: { theme: "paper", font: "sans", spacing: "compact", palette: "sand" },
  },
  {
    id: "atelier",
    name: "Atelier",
    style: "editorial",
    tone: "warm",
    design: { theme: "paper", font: "serif", spacing: "relaxed", palette: "rose" },
  },
  {
    id: "campus",
    name: "Campus",
    style: "technical",
    tone: "cool",
    design: { theme: "ocean", font: "serif", spacing: "relaxed", palette: "cobalt" },
  },
  {
    id: "meadow",
    name: "Meadow",
    style: "minimal",
    tone: "cool",
    design: { theme: "paper", font: "sans", spacing: "relaxed", palette: "forest" },
  },
  {
    id: "confetti",
    name: "Confetti",
    style: "bold",
    tone: "warm",
    design: { theme: "sunset", font: "mono", spacing: "compact", palette: "rose" },
  },
  {
    id: "facet",
    name: "Facet",
    style: "bold",
    tone: "cool",
    design: { theme: "midnight", font: "mono", spacing: "relaxed", palette: "ink" },
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
  const nodes = createPresentationDesignComposition(designId, layoutId, copy, createId);
  const scene = PresentationSceneSchema.parse({
    schemaVersion: 9,
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
    schemaVersion: 18,
    sections: [],
    experiencePreset: { id: "studio", version: 1 },
    blocks: DESIGN_LAYOUTS.map((layout) =>
      createDesignSlide(designId, layout, copy.slides[layout], createId),
    ),
  });
}

import {
  canReflowPresentationDesign,
  reflowPresentationDesign,
} from "./presentation-design-layout-application";

export type PresentationDesignApplicationMode = "layout" | "style";
export type PresentationDesignScope = {
  scope: "deck" | "slide";
  blockId?: string;
  application?: PresentationDesignApplicationMode;
};
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
  reflowedSlides: number;
  retainedLayoutSlides: number;
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
 * Style remains the backwards-compatible default. Layout mode applies real family compositions
 * to existing content; semantically connected canvases retain their exact object geometry.
 * The complete operation is validated before any result can enter editor history.
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
    reflowedSlides: 0,
    retainedLayoutSlides: 0,
  };
  const contentIds = draft.blocks
    .filter((block) => block.kind === "content")
    .map((block) => block.id);
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
    const sameStyle =
      original.design?.theme === design.theme &&
      original.design.font === design.font &&
      original.design.spacing === design.spacing &&
      original.design.palette === design.palette;
    if (options.application !== "layout" && !converted && sameStyle) return block;
    let reflowedLayout = false;
    let scene: PresentationScene = {
      ...original,
      schemaVersion: Math.max(original.schemaVersion, 9) as PresentationScene["schemaVersion"],
      design,
      nodes: nativeSceneNodesForDesign(original, design),
    };
    if (options.application === "layout") {
      if (
        canReflowPresentationDesign(original, block.sourceDisclosure?.model === "visual-import-v1")
      ) {
        const reflowed = reflowPresentationDesign(original, {
          blockId: block.id,
          family: designId,
          design,
          first: contentIds[0] === block.id,
          last: contentIds.at(-1) === block.id,
          compose: createPresentationDesignComposition,
        });
        if (reflowed !== original) {
          scene = reflowed;
          reflowedLayout = true;
          summary.reflowedSlides += 1;
        } else summary.retainedLayoutSlides += 1;
      } else summary.retainedLayoutSlides += 1;
    }
    if (options.application === "layout" && !reflowedLayout && !converted && sameStyle)
      return block;
    if (!converted && JSON.stringify(scene) === JSON.stringify(original)) return block;
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
