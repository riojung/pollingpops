import { z } from "zod";

export const BOARD_INVITATION_MAX_RECIPIENTS = 20;
const emails = z
  .array(z.string().trim().toLowerCase().email().max(320))
  .min(1)
  .max(BOARD_INVITATION_MAX_RECIPIENTS)
  .transform((values) => [...new Set(values)].sort());

export const CanvasBoardInvitationBatchSchema = z
  .object({
    operationId: z.string().uuid(),
    emails,
    role: z.enum(["editor", "viewer", "facilitator"]),
  })
  .strict();
export type CanvasBoardInvitationBatch = z.infer<typeof CanvasBoardInvitationBatchSchema>;

export const IdeaBoardInvitationBatchSchema = z
  .object({ operationId: z.string().uuid(), emails })
  .strict();
export type IdeaBoardInvitationBatch = z.infer<typeof IdeaBoardInvitationBatchSchema>;

export const BoardInvitationDeliveryStatusSchema = z.enum([
  "sent",
  "pending",
  "failed",
  "unknown",
  "rejected",
]);
export type BoardInvitationDeliveryStatus = z.infer<typeof BoardInvitationDeliveryStatusSchema>;
export const BoardInvitationDeliveryErrorSchema = z.enum([
  "RECIPIENT_UNAVAILABLE",
  "DELIVERY_UNAVAILABLE",
  "DELIVERY_UNKNOWN",
  "ACCESS_CHANGED",
]);
export const BoardInvitationDeliveryResultSchema = z
  .object({
    email: z.string().email().max(320),
    status: BoardInvitationDeliveryStatusSchema,
    invitationId: z.string().uuid().optional(),
    errorCode: BoardInvitationDeliveryErrorSchema.optional(),
  })
  .strict();
export type BoardInvitationDeliveryResult = z.infer<typeof BoardInvitationDeliveryResultSchema>;

/** Complete means no pending deliveries; unknown/failed/rejected entries are terminal too. */
export const BoardInvitationBatchResponseSchema = z
  .object({
    batchId: z.string().uuid(),
    results: z
      .array(BoardInvitationDeliveryResultSchema)
      .min(1)
      .max(BOARD_INVITATION_MAX_RECIPIENTS),
    complete: z.boolean(),
  })
  .strict();
export type BoardInvitationBatchResponse = z.infer<typeof BoardInvitationBatchResponseSchema>;
