import { z } from "zod";
import {
  PresentationSceneDraftSchema,
  PresentationSceneSchema,
  PresentationDeliveredSceneSchema,
  PresentationSceneDesignSchema,
} from "./presentation-scene";
import { PresentationTextAssistanceProvenanceSchema } from "./presentation-text-assistance";

// Shared slide schemas stay independent of the contracts barrel so private sharing,
// reading, and practice can initialize from any compiled server entry point.
export const ContentSlideLayoutSchema = z.enum([
  "title",
  "title_body",
  "media",
  "quote",
  "section",
  "callout",
]);
export type ContentSlideLayout = z.infer<typeof ContentSlideLayoutSchema>;

export const ContentSlideRegionSchema = z.enum([
  "top_left",
  "top_center",
  "top_right",
  "middle_left",
  "middle_center",
  "middle_right",
  "bottom_left",
  "bottom_center",
  "bottom_right",
]);
export type ContentSlideRegion = z.infer<typeof ContentSlideRegionSchema>;

export const ContentSlideFrameSchema = z
  .object({
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
    width: z.number().finite().min(12).max(100),
    height: z.number().finite().min(6).max(100),
  })
  .superRefine((frame, context) => {
    if (frame.x + frame.width > 100) {
      context.addIssue({
        code: "custom",
        path: ["width"],
        message: "Text elements must fit within the slide width",
      });
    }
    if (frame.y + frame.height > 100) {
      context.addIssue({
        code: "custom",
        path: ["height"],
        message: "Text elements must fit within the slide height",
      });
    }
  });
export type ContentSlideFrame = z.infer<typeof ContentSlideFrameSchema>;

const ContentSlideTitleElementSchema = z.object({
  id: z.string().trim().min(1).max(200),
  role: z.literal("title"),
  text: z.string().trim().max(160),
  region: ContentSlideRegionSchema,
  order: z.number().int().min(0).max(7),
  frame: ContentSlideFrameSchema.optional(),
});

const ContentSlideBodyElementSchema = z.object({
  id: z.string().trim().min(1).max(200),
  role: z.literal("body"),
  text: z.string().trim().max(4_000),
  region: ContentSlideRegionSchema,
  order: z.number().int().min(0).max(7),
  frame: ContentSlideFrameSchema.optional(),
});

export const ContentSlideTextElementSchema = z.discriminatedUnion("role", [
  ContentSlideTitleElementSchema,
  ContentSlideBodyElementSchema,
]);
export type ContentSlideTextElement = z.infer<typeof ContentSlideTextElementSchema>;

export const PresentationCitationSchema = z.object({
  locator: z.string().trim().min(1).max(120),
  excerpt: z.string().trim().min(1).max(500),
});

export const PresentationSourceDisclosureSchema = z.object({
  sourceName: z.string().trim().min(1).max(200),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(120),
  conversionNotes: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
});

const ContentSlideDraftFields = {
  id: z.string().uuid(),
  kind: z.literal("content"),
  layout: ContentSlideLayoutSchema,
  textElements: z.array(ContentSlideTextElementSchema).max(8),
  mediaId: z.string().uuid().nullable(),
  mediaAlt: z.string().trim().max(300).nullable(),
  speakerNotes: z.string().trim().max(2_000),
  citations: z.array(PresentationCitationSchema).max(20).optional(),
  sourceDisclosure: PresentationSourceDisclosureSchema.optional(),
  textAssistance: PresentationTextAssistanceProvenanceSchema.optional(),
  scene: PresentationSceneDraftSchema.optional(),
  hidden: z.literal(true).optional(),
};

/** Draft slides retain bounded storage shape while allowing incomplete accessibility metadata. */
export const ContentSlideDraftSchema = z
  .object(ContentSlideDraftFields)
  .superRefine((slide, ctx) => {
    if (slide.scene) {
      if (slide.textElements.length || slide.mediaId !== null || slide.mediaAlt !== null) {
        ctx.addIssue({
          code: "custom",
          message: "Native slides keep text and images in the scene only",
          path: ["scene"],
        });
      }
      return;
    }
    const titles = slide.textElements.filter((element) => element.role === "title");
    if (titles.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Every content slide must have exactly one title element",
        path: ["textElements"],
      });
    }
    const ids = new Set<string>();
    const locations = new Set<string>();
    for (const [index, element] of slide.textElements.entries()) {
      if (ids.has(element.id)) {
        ctx.addIssue({
          code: "custom",
          message: "Every text element needs a unique ID",
          path: ["textElements", index, "id"],
        });
      }
      ids.add(element.id);
      const location = `${element.region}:${element.order}`;
      if (locations.has(location)) {
        ctx.addIssue({
          code: "custom",
          message: "Text elements in the same region need a unique order",
          path: ["textElements", index, "order"],
        });
      }
      locations.add(location);
    }
  });
export type ContentSlideDraft = z.infer<typeof ContentSlideDraftSchema>;

export const ContentSlideSchema = z.object(ContentSlideDraftFields).superRefine((slide, ctx) => {
  if (slide.scene) {
    const draft = ContentSlideDraftSchema.safeParse(slide);
    if (!draft.success) {
      for (const issue of draft.error.issues) ctx.addIssue({ ...issue });
    }
    const scene = PresentationSceneSchema.safeParse(slide.scene);
    if (!scene.success) {
      for (const issue of scene.error.issues) {
        ctx.addIssue({ ...issue, path: ["scene", ...issue.path] });
      }
    }
    return;
  }
  if (!slide.textElements.some((element) => element.text.trim()) && !slide.mediaId) {
    ctx.addIssue({
      code: "custom",
      message: "Add a title, body, or image to this slide",
      path: ["textElements"],
    });
  }
  if (!ContentSlideDraftSchema.safeParse(slide).success) {
    ctx.addIssue({
      code: "custom",
      message: "This slide has invalid text elements",
      path: ["textElements"],
    });
  }
  if (slide.mediaId && !slide.mediaAlt?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "Describe the slide image for participants who cannot see it",
      path: ["mediaAlt"],
    });
  }
});
export type ContentSlide = z.infer<typeof ContentSlideSchema>;

/** Content that is safe for every live Presentation role. */
export const PresentationLiveContentBlockSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("content"),
    layout: ContentSlideLayoutSchema,
    textElements: z.array(ContentSlideTextElementSchema).max(8),
    mediaId: z.string().uuid().nullable(),
    mediaAlt: z.string().max(300).nullable(),
    scene: PresentationDeliveredSceneSchema.optional(),
    design: PresentationSceneDesignSchema.optional(),
  })
  .superRefine((block, ctx) => {
    const parsed = ContentSlideDraftSchema.safeParse({ ...block, speakerNotes: "" });
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: "Live content slides must contain valid text element positions",
        path: ["textElements"],
      });
    }
  })
  .strict();
export type PresentationLiveContentBlock = z.infer<typeof PresentationLiveContentBlockSchema>;
