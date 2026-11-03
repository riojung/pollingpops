import { z } from "zod";
import { CanvasColorSchema, CanvasShapeVariantSchema } from "./canvas-content-v4";
import { ContentSlideDraftSchema, type ContentSlideDraft } from "./index";
import { contentSlideMediaFrame, resolveContentSlideFrames } from "./slide-geometry";

/** Experimental single-slide artifact. Never pass this to production Presentation mutations. */
export const PRESENTATION_SCENE_PROTOTYPE_VERSION = 1 as const;
export const PRESENTATION_SCENE_PROTOTYPE_MAX_NODES = 50;
export const PRESENTATION_SCENE_PROTOTYPE_MAX_BYTES = 128 * 1024;

function hasControlCharacters(value: string, allowTextWhitespace = false) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code === 127 || (code < 32 && !(allowTextWhitespace && [9, 10, 13].includes(code)));
  });
}

const identifier = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0 && !hasControlCharacters(value), {
    message: "Use a nonblank stable identifier without control characters",
  });
const plainText = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => !hasControlCharacters(value, true), {
      message: "Use plain text without control characters",
    });

/** Percentages within the fixed slide, rather than the board's unbounded world coordinates. */
export const PresentationScenePrototypeFrameSchema = z
  .object({
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
    width: z.number().finite().min(1).max(100),
    height: z.number().finite().min(1).max(100),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.x + frame.width > 100) {
      context.addIssue({
        code: "custom",
        path: ["width"],
        message: "Keep the node inside the slide width",
      });
    }
    if (frame.y + frame.height > 100) {
      context.addIssue({
        code: "custom",
        path: ["height"],
        message: "Keep the node inside the slide height",
      });
    }
  });
export type PresentationScenePrototypeFrame = z.infer<typeof PresentationScenePrototypeFrameSchema>;

/** Bundled assets are resolved by an explicit application registry, never interpreted as URLs. */
export const PresentationScenePrototypeAssetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("bundled_fixture"),
      assetId: z.literal("workflow-diagram"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("legacy_private_media"),
      mediaId: z.string().uuid(),
    })
    .strict(),
]);
export type PresentationScenePrototypeAsset = z.infer<typeof PresentationScenePrototypeAssetSchema>;

const framedNode = {
  id: identifier,
  frame: PresentationScenePrototypeFrameSchema,
};
const textNode = z
  .object({
    ...framedNode,
    type: z.literal("text"),
    role: z.enum(["title", "body"]),
    text: plainText(4_000),
  })
  .strict()
  .superRefine((node, context) => {
    if (node.role === "title" && node.text.length > 160) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Prototype titles support at most 160 characters",
      });
    }
  });
const imageNode = z
  .object({
    ...framedNode,
    type: z.literal("image"),
    asset: PresentationScenePrototypeAssetSchema,
    // Draft conversion must retain incomplete alt text, rather than inventing a description.
    altText: plainText(300).nullable(),
  })
  .strict();
const shapeNode = z
  .object({
    ...framedNode,
    type: z.literal("shape"),
    shape: z.enum([...CanvasShapeVariantSchema.options, "ellipse", "diamond", "parallelogram"]),
    color: CanvasColorSchema,
  })
  .strict();
const endpoint = z
  .object({
    nodeId: identifier,
    anchor: z.enum(["center", "top", "right", "bottom", "left"]),
  })
  .strict();
const connectorNode = z
  .object({
    id: identifier,
    type: z.literal("connector"),
    from: endpoint,
    to: endpoint,
    label: plainText(200),
    color: CanvasColorSchema,
  })
  .strict();

export const PresentationScenePrototypeNodeSchema = z.discriminatedUnion("type", [
  textNode,
  imageNode,
  shapeNode,
  connectorNode,
]);
export type PresentationScenePrototypeNode = z.infer<typeof PresentationScenePrototypeNodeSchema>;

export const PresentationScenePrototypeSchema = z
  .object({
    artifactType: z.literal("presentation_scene_prototype"),
    schemaVersion: z.literal(PRESENTATION_SCENE_PROTOTYPE_VERSION),
    id: identifier,
    aspectRatio: z.literal("16:9"),
    speakerNotes: plainText(2_000),
    nodes: z
      .array(PresentationScenePrototypeNodeSchema)
      .min(1)
      .max(PRESENTATION_SCENE_PROTOTYPE_MAX_NODES),
    readingOrder: z.array(identifier).min(1).max(PRESENTATION_SCENE_PROTOTYPE_MAX_NODES),
  })
  .strict()
  .superRefine((scene, context) => {
    const byId = new Map(scene.nodes.map((node) => [node.id, node]));
    if (byId.size !== scene.nodes.length) {
      context.addIssue({ code: "custom", path: ["nodes"], message: "Node IDs must be unique" });
    }
    const readingIds = new Set(scene.readingOrder);
    if (
      readingIds.size !== scene.readingOrder.length ||
      readingIds.size !== byId.size ||
      scene.readingOrder.some((id) => !byId.has(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["readingOrder"],
        message: "List every node exactly once in semantic reading order",
      });
    }
    for (const [index, node] of scene.nodes.entries()) {
      if (node.type !== "connector") continue;
      for (const side of ["from", "to"] as const) {
        const target = byId.get(node[side].nodeId);
        if (!target || target.type === "connector") {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, side, "nodeId"],
            message: "Connect to an existing text, image or shape node in this slide",
          });
        }
      }
      if (node.from.nodeId === node.to.nodeId) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "to", "nodeId"],
          message: "Connect two different nodes",
        });
      }
    }
    if (
      new TextEncoder().encode(JSON.stringify(scene)).byteLength >
      PRESENTATION_SCENE_PROTOTYPE_MAX_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "The prototype scene exceeds its 128 KiB UTF-8 JSON budget",
      });
    }
  });
export type PresentationScenePrototype = z.infer<typeof PresentationScenePrototypeSchema>;

// Match ContentSlideView: row-major regions, then explicit order, then stable ID.
const legacyRegions = [
  "top_left",
  "top_center",
  "top_right",
  "middle_left",
  "middle_center",
  "middle_right",
  "bottom_left",
  "bottom_center",
  "bottom_right",
] as const;

/**
 * Bounded, one-way lab preview for an already current ContentSlideDraft, not a production migration.
 * Stricter prototype text/ID rules can reject otherwise schema-valid legacy content. Never silently
 * sanitize or truncate it: the original artifact remains unchanged and is the source of truth.
 * Source citations and disclosure are not represented by this experimental scene or transferred.
 * Notes and private-media authorization references remain backstage data. A lab renderer must
 * show a placeholder for private media; possessing its ID does not authorize an asset read.
 */
export function adaptContentSlideToScenePrototype(
  slide: ContentSlideDraft,
): PresentationScenePrototype {
  // Validate the source shape, but retain its original strings and IDs without transforming it.
  ContentSlideDraftSchema.parse(slide);
  const frames = resolveContentSlideFrames(slide);
  const nodes: PresentationScenePrototypeNode[] = slide.textElements.map((element) => ({
    id: element.id,
    type: "text",
    role: element.role,
    text: element.text,
    frame: { ...frames[element.id]! },
  }));
  const readingOrder = legacyRegions.flatMap((region) =>
    slide.textElements
      .filter((element) => element.region === region)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((element) => element.id),
  );
  if (slide.mediaId) {
    const textIds = new Set(nodes.map((node) => node.id));
    const baseId = `${slide.id}:image`;
    let imageId = baseId;
    for (let suffix = 1; textIds.has(imageId); suffix += 1) imageId = `${baseId}:${suffix}`;
    nodes.push({
      id: imageId,
      type: "image",
      frame: { ...contentSlideMediaFrame },
      altText: slide.mediaAlt,
      asset: { kind: "legacy_private_media", mediaId: slide.mediaId },
    });
    readingOrder.push(imageId);
  }
  return PresentationScenePrototypeSchema.parse({
    artifactType: "presentation_scene_prototype",
    schemaVersion: PRESENTATION_SCENE_PROTOTYPE_VERSION,
    id: slide.id,
    aspectRatio: "16:9",
    speakerNotes: slide.speakerNotes,
    nodes,
    readingOrder,
  });
}
