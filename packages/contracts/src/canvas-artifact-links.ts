import { z } from "zod";
import { CanvasVersionMetadataSchema } from "./canvas-facilitation";

export const CANVAS_ARTIFACT_LINK_LIMIT = 20;
export const CANVAS_ARTIFACT_LINK_RECEIPT_LIMIT = 2_000;
const id = z.string().uuid();
export const CanvasArtifactLinkCreateSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: id,
    linkId: id,
    boardId: id,
    versionId: id,
  })
  .strict();
export type CanvasArtifactLinkCreate = z.infer<typeof CanvasArtifactLinkCreateSchema>;
export const CanvasArtifactLinkDeleteSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: id,
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type CanvasArtifactLinkDelete = z.infer<typeof CanvasArtifactLinkDeleteSchema>;
export const CanvasArtifactLinkSchema = z
  .object({
    id,
    boardId: id,
    versionId: id,
    boardTitle: z.string().max(160),
    name: z.string().max(120),
    createdAt: z.string().datetime(),
    createdBy: id.nullable(),
    revision: z.literal(1),
    canDelete: z.boolean(),
  })
  .strict();
export type CanvasArtifactLink = z.infer<typeof CanvasArtifactLinkSchema>;
export const CanvasArtifactLinkListSchema = z
  .object({
    schemaVersion: z.literal(1),
    canCreate: z.boolean(),
    links: z.array(CanvasArtifactLinkSchema).max(CANVAS_ARTIFACT_LINK_LIMIT),
  })
  .strict();
export const CanvasArtifactLinkReceiptSchema = z
  .object({
    operationId: id,
    linkId: id,
    deleted: z.boolean(),
  })
  .strict();
export const CanvasArtifactLinkMutationResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    receipt: CanvasArtifactLinkReceiptSchema,
  })
  .strict();
export const CanvasArtifactLinkEligibleSchema = z
  .object({
    schemaVersion: z.literal(1),
    boards: z
      .array(
        z
          .object({
            id,
            title: z.string().max(160),
            versions: z.array(CanvasVersionMetadataSchema).max(10),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
