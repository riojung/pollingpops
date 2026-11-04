import { z } from "zod";
import { CanvasColorSchema, CanvasShapeVariantSchema } from "./canvas-content-v4";
import {
  PresentationRichTextSchema,
  presentationRichTextToPlainText,
} from "./presentation-rich-text";

/** Plain scenes opt into Presentation v4; formatted scene v2 requires Presentation v5. */
export const PRESENTATION_SCENE_SCHEMA_VERSION = 1 as const;
export const PRESENTATION_RICH_TEXT_SCENE_SCHEMA_VERSION = 2 as const;
export const PRESENTATION_SCENE_MAX_NODES = 50;
export const PRESENTATION_SCENE_MAX_BYTES = 128 * 1024;

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

/** Finite percentages within a fixed slide, independent of Canvas world coordinates. */
export const PresentationSceneFrameSchema = z
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
export type PresentationSceneFrame = z.infer<typeof PresentationSceneFrameSchema>;

const framedNode = { id: identifier, frame: PresentationSceneFrameSchema };
const textNode = z
  .object({
    ...framedNode,
    type: z.literal("text"),
    role: z.enum(["title", "body"]),
    text: plainText(4_000),
    richText: PresentationRichTextSchema.optional(),
  })
  .strict()
  .superRefine((node, context) => {
    if (node.role === "title" && node.text.length > 160) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Slide titles support at most 160 characters",
      });
    }
    if (node.richText && presentationRichTextToPlainText(node.richText) !== node.text) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Plain text must exactly match the formatted text content",
      });
    }
    if (
      node.role === "title" &&
      node.richText?.paragraphs.some((paragraph) => paragraph.kind !== "paragraph")
    ) {
      context.addIssue({
        code: "custom",
        path: ["richText"],
        message: "Slide titles use paragraphs rather than lists",
      });
    }
  });
const imageNode = z
  .object({
    ...framedNode,
    type: z.literal("image"),
    // Match PostgreSQL UUID canonicalization for memory authorization and retention lookups.
    // This is an authorization reference, never an unrestricted URL or storage path.
    mediaId: z.string().uuid().toLowerCase(),
    altText: plainText(300).nullable(),
  })
  .strict();
const shapeNode = z
  .object({
    ...framedNode,
    type: z.literal("shape"),
    shape: z.enum([...CanvasShapeVariantSchema.options, "ellipse", "diamond", "parallelogram"]),
    color: CanvasColorSchema,
    label: plainText(200),
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

export const PresentationSceneNodeSchema = z.discriminatedUnion("type", [
  textNode,
  imageNode,
  shapeNode,
  connectorNode,
]);
export type PresentationSceneNode = z.infer<typeof PresentationSceneNodeSchema>;

/** Public slide content only. Notes, provenance and source disclosure stay on the block. */
export const PresentationSceneDraftSchema = z
  .object({
    schemaVersion: z.union([
      z.literal(PRESENTATION_SCENE_SCHEMA_VERSION),
      z.literal(PRESENTATION_RICH_TEXT_SCENE_SCHEMA_VERSION),
    ]),
    aspectRatio: z.literal("16:9"),
    nodes: z.array(PresentationSceneNodeSchema).min(1).max(PRESENTATION_SCENE_MAX_NODES),
    readingOrder: z.array(identifier).min(1).max(PRESENTATION_SCENE_MAX_NODES),
  })
  .strict()
  .superRefine((scene, context) => {
    const byId = new Map(scene.nodes.map((node) => [node.id, node]));
    if (byId.size !== scene.nodes.length) {
      context.addIssue({ code: "custom", path: ["nodes"], message: "Node IDs must be unique" });
    }
    if (scene.nodes.filter((node) => node.type === "text" && node.role === "title").length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Every native slide must have exactly one title node",
      });
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
      if (scene.schemaVersion === 1 && node.type === "text" && "richText" in node) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "richText"],
          message: "Formatted text requires scene schema version 2",
        });
      }
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
    if (new TextEncoder().encode(JSON.stringify(scene)).byteLength > PRESENTATION_SCENE_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        message: "The scene exceeds its 128 KiB UTF-8 JSON budget",
      });
    }
  });
export type PresentationSceneDraft = z.infer<typeof PresentationSceneDraftSchema>;

export const PresentationSceneSchema = PresentationSceneDraftSchema.superRefine(
  (scene, context) => {
    if (
      !scene.nodes.some(
        (node) =>
          (node.type === "text" && node.text.trim()) ||
          node.type === "image" ||
          (node.type === "shape" && node.label.trim()),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Add text, an image or a named shape to this slide",
      });
    }
    for (const [index, node] of scene.nodes.entries()) {
      if (node.type === "image" && !node.altText?.trim()) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "altText"],
          message: "Describe the image for participants who cannot see it",
        });
      }
      if (node.type === "shape" && !node.label.trim()) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "label"],
          message: "Name the shape for participants who cannot see it",
        });
      }
    }
  },
);
export type PresentationScene = z.infer<typeof PresentationSceneSchema>;

export function presentationSceneTitle(scene: PresentationSceneDraft): string {
  const title = scene.nodes.find((node) => node.type === "text" && node.role === "title");
  return title?.type === "text" ? title.text : "";
}
