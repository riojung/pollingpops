import { z } from "zod";
import { CanvasExportRegionSchema } from "@openround/contracts";

/** Short-lived presentation lease; never part of a canvas document or durable outbox. */
export const CanvasPresenterRecordSchema = z
  .object({
    userId: z.string().uuid(),
    sessionId: z.string().uuid(),
    revision: z.number().int().positive(),
    active: z.boolean(),
    audience: z.enum(["team", "published"]),
    frameId: z.string().uuid().nullable(),
    viewport: CanvasExportRegionSchema.nullable(),
    expiresAt: z.number().int().positive(),
    operationId: z.string().uuid(),
    operationActorId: z.string().uuid(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type CanvasPresenterRecord = z.infer<typeof CanvasPresenterRecordSchema>;
export const CANVAS_PRESENTER_TTL_MS = 15_000;
