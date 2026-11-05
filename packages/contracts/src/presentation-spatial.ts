import { z } from "zod";

export const PRESENTATION_SPATIAL_WORLD_SIZE = 20_000;
const geometry = {
  x: z.number().int().min(0).max(PRESENTATION_SPATIAL_WORLD_SIZE),
  y: z.number().int().min(0).max(PRESENTATION_SPATIAL_WORLD_SIZE),
  width: z.number().int().min(320).max(3200),
  height: z.number().int().min(180).max(1800),
};
export interface PresentationSpatialRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
function validateGeometry(value: PresentationSpatialRectangle, ctx: z.RefinementCtx) {
  if (value.width * 9 !== value.height * 16)
    ctx.addIssue({
      code: "custom",
      path: ["height"],
      message: "Spatial frames keep the slide's 16:9 aspect ratio",
    });
  if (
    value.x + value.width > PRESENTATION_SPATIAL_WORLD_SIZE ||
    value.y + value.height > PRESENTATION_SPATIAL_WORLD_SIZE
  )
    ctx.addIssue({
      code: "custom",
      message: "Keep the complete frame inside the bounded spatial world",
    });
}
export const PresentationSpatialFrameSchema = z
  .object({ blockId: z.string().uuid(), ...geometry })
  .strict()
  .superRefine(validateGeometry);
export type PresentationSpatialFrame = z.infer<typeof PresentationSpatialFrameSchema>;
export const PresentationSpatialLayoutSchema = z
  .object({
    schemaVersion: z.literal(1),
    frames: z.array(PresentationSpatialFrameSchema).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.frames.map((frame) => frame.blockId.toLowerCase())).size !== value.frames.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["frames"],
        message: "Give each block at most one spatial frame",
      });
  });
export type PresentationSpatialLayout = z.infer<typeof PresentationSpatialLayoutSchema>;

/** Geometry only. Future content, authored labels and identifiers do not enter this audience DTO. */
export const PresentationSpatialSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    frames: z
      .array(
        z
          .object({ blockIndex: z.number().int().min(0).max(199), ...geometry })
          .strict()
          .superRefine(validateGeometry),
      )
      .max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.frames.some((frame, index) => frame.blockIndex !== index))
      ctx.addIssue({
        code: "custom",
        path: ["frames"],
        message: "Spatial snapshot frames follow consecutive canonical block order",
      });
  });
export type PresentationSpatialSnapshot = z.infer<typeof PresentationSpatialSnapshotSchema>;

/** Sparse positions never rewrite stored content; live additions receive the same bounded fallback. */
export function resolvePresentationSpatialFrames(content: {
  blocks: ReadonlyArray<{ id: string }>;
  spatial?: PresentationSpatialLayout;
}): PresentationSpatialFrame[] {
  if (content.blocks.length > 200)
    throw new Error("Spatial presentations support at most 200 blocks");
  const byId = new Map(
    (content.spatial?.frames ?? []).map((frame) => [frame.blockId.toLowerCase(), frame]),
  );
  return content.blocks.map((block, index) => {
    const authored = byId.get(block.id.toLowerCase());
    return authored
      ? {
          blockId: block.id,
          x: authored.x,
          y: authored.y,
          width: authored.width,
          height: authored.height,
        }
      : {
          blockId: block.id,
          x: (index % 12) * 1600,
          y: Math.floor(index / 12) * 960,
          width: 1280,
          height: 720,
        };
  });
}
/** Shared geometric bounds; no viewport, authoring state or Canvas follow lease is persisted. */
export function presentationSpatialBounds(
  rectangles: readonly PresentationSpatialRectangle[],
): PresentationSpatialRectangle | null {
  if (!rectangles.length) return null;
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const rectangle of rectangles) {
    x = Math.min(x, rectangle.x);
    y = Math.min(y, rectangle.y);
    right = Math.max(right, rectangle.x + rectangle.width);
    bottom = Math.max(bottom, rectangle.y + rectangle.height);
  }
  return { x, y, width: right - x, height: bottom - y };
}
