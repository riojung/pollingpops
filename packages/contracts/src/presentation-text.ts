import { z } from "zod";
import {
  isTextOpinionQuestion,
  TextResponseValueSchema,
  TextResponseModerationStatusSchema,
} from "./text-opinions";

export const PRESENTATION_TEXT_SCHEMA_VERSION = 10;
export const isPresentationTextResultQuestion = isTextOpinionQuestion;
export function requiresPresentationTextOpinions(document: {
  blocks: readonly { kind: string; question?: { type?: string } }[];
}): boolean {
  return document.blocks.some(
    (block) => block.kind === "question" && isTextOpinionQuestion(block.question),
  );
}
const integer = z.number().int().nonnegative();
export const PresentationTextModerationRequestSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedRevision: integer,
    expectedModerationVersion: integer,
    status: z.enum(["approved", "removed"]),
  })
  .strict();
export type PresentationTextModerationRequest = z.infer<
  typeof PresentationTextModerationRequestSchema
>;
export const PresentationTextModerationReceiptSchema = z
  .object({
    commandId: z.string().uuid(),
    responseId: z.string().uuid(),
    blockId: z.string().uuid(),
    previousStatus: z.enum(["pending", "approved"]),
    status: z.enum(["approved", "removed"]),
    expectedRevision: integer,
    expectedModerationVersion: integer,
    resultingModerationVersion: integer,
    acceptedAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (receipt) =>
      receipt.resultingModerationVersion === receipt.expectedModerationVersion + 1 &&
      (receipt.previousStatus !== "approved" || receipt.status === "removed"),
    "Invalid text moderation receipt",
  );
export type PresentationTextModerationReceipt = z.infer<
  typeof PresentationTextModerationReceiptSchema
>;
export const PresentationTextResponseMetadataSchema = z
  .object({
    responseId: z.string().uuid(),
    blockId: z.string().uuid(),
    status: TextResponseModerationStatusSchema,
    moderationVersion: integer,
  })
  .strict();
export const PresentationTextModerationAckSchema = z
  .object({
    sessionId: z.string().uuid(),
    revision: integer,
    seq: integer,
    accepted: z.boolean(),
    duplicate: z.boolean(),
    receipt: PresentationTextModerationReceiptSchema,
    response: PresentationTextResponseMetadataSchema,
  })
  .strict()
  .refine(
    (ack) =>
      (!ack.duplicate || ack.accepted) &&
      ack.receipt.responseId.toLowerCase() === ack.response.responseId.toLowerCase() &&
      ack.receipt.blockId.toLowerCase() === ack.response.blockId.toLowerCase() &&
      ack.response.moderationVersion >= ack.receipt.resultingModerationVersion,
    "Moderation acknowledgement must retain the original receipt and current response",
  );
export type PresentationTextModerationAck = z.infer<typeof PresentationTextModerationAckSchema>;
export const PresentationTextModerationQuerySchema = z
  .object({
    status: TextResponseModerationStatusSchema.default("pending"),
    blockId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
    cursor: z.string().max(2000).optional(),
  })
  .strict();
export type PresentationTextModerationQuery = z.infer<typeof PresentationTextModerationQuerySchema>;
export const PresentationTextResultsQuerySchema = z
  .object({
    blockId: z.string().uuid(),
    role: z.enum(["creator", "host", "participant", "companion", "stage"]),
    limit: z.coerce.number().int().min(1).max(50).default(50),
    cursor: z.string().max(2000).optional(),
  })
  .strict();
export type PresentationTextResultsQuery = z.infer<typeof PresentationTextResultsQuerySchema>;
export const PresentationTextModerationPageSchema = z
  .object({
    sessionId: z.string().uuid(),
    revision: integer,
    seq: integer,
    phase: z.enum([
      "lobby",
      "content",
      "question_open",
      "question_reveal",
      "intervention",
      "finished",
    ]),
    items: z
      .array(
        z
          .object({
            responseId: z.string().uuid(),
            blockId: z.string().uuid(),
            questionId: z.string().uuid(),
            questionPrompt: z.string().max(500),
            textValue: TextResponseValueSchema.nullable(),
            status: TextResponseModerationStatusSchema,
            moderationVersion: integer,
            submittedAt: z.string().datetime(),
            authorAlias: z.string().max(80).nullable(),
          })
          .strict()
          .refine(
            (item) => item.status !== "removed" || item.textValue === null,
            "Removed responses cannot expose a body",
          ),
      )
      .max(50),
    nextCursor: z.string().max(2000).nullable(),
  })
  .strict();
export type PresentationTextModerationPage = z.infer<typeof PresentationTextModerationPageSchema>;
export const PresentationTextResponseResultsSchema = z
  .object({
    sessionId: z.string().uuid(),
    blockId: z.string().uuid(),
    revision: integer,
    seq: integer,
    type: z.enum(["open_text", "word_cloud"]),
    visible: z.boolean(),
    approvedRespondents: integer.max(250),
    items: z.array(z.object({ textValue: TextResponseValueSchema }).strict()).max(50),
    terms: z
      .array(
        z
          .object({
            value: z.string().min(1).max(240),
            label: z.string().min(1).max(240),
            count: z.number().int().positive().max(250),
            percent: z.number().min(0).max(100),
          })
          .strict(),
      )
      .max(50),
    nextCursor: z.string().max(2000).nullable(),
  })
  .strict()
  .refine(
    (result) =>
      (result.type === "open_text" ? result.terms.length === 0 : result.items.length === 0) &&
      (result.visible
        ? result.approvedRespondents >= 5
        : result.items.length === 0 && result.terms.length === 0 && result.nextCursor === null),
    "Unrevealed or small-sample results cannot expose text",
  );
export type PresentationTextResponseResults = z.infer<typeof PresentationTextResponseResultsSchema>;
