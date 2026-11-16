import { z } from "zod";

export const PRESENTATION_REVIEW_MAX_THREADS = 100;
export const PRESENTATION_REVIEW_MAX_THREAD_MESSAGES = 20;
export const PRESENTATION_REVIEW_MAX_MESSAGES = 500;
export const PRESENTATION_REVIEW_MAX_COMMENT_BYTES = 512 * 1024;
export const PRESENTATION_REVIEW_MAX_RECEIPTS = 5000;
const id = z.string().uuid();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z
  .string()
  .normalize("NFC")
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const code = character.codePointAt(0)!;
        return (
          (code < 32 && ![9, 10, 13].includes(code)) ||
          (code >= 127 && code <= 159) ||
          (code >= 0x202a && code <= 0x202e) ||
          (code >= 0x2066 && code <= 0x2069)
        );
      }),
    "Use plain comment text",
  );
export const EnablePresentationReviewSchema = z.object({ operationId: id, versionId: id }).strict();
export type EnablePresentationReview = z.infer<typeof EnablePresentationReviewSchema>;

/** Capability discovery contains no feedback, account identity or creator-only source data. */
export const PresentationReviewFeedbackAccessSchema = z
  .object({
    schemaVersion: z.literal(1),
    shareId: id,
    versionId: id,
    enabled: z.boolean(),
    signInRequired: z.boolean(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type PresentationReviewFeedbackAccess = z.infer<
  typeof PresentationReviewFeedbackAccessSchema
>;
export const PresentationReviewFeedbackMessageSchema = z
  .object({
    id,
    text: z.string().max(2000),
    authorLabel: z.string().regex(/^(Author|Reviewer [1-9][0-9]{0,2})$/),
    authorRole: z.enum(["author", "reviewer"]),
    isOwn: z.boolean(),
    version: revision.min(1),
    deleted: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.authorRole === "author") !== (value.authorLabel === "Author") ||
      (value.deleted ? value.text !== "" : value.text.trim().length === 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Comment identity and body must match their safe state",
      });
  });
export type PresentationReviewFeedbackMessage = z.infer<
  typeof PresentationReviewFeedbackMessageSchema
>;
export const PresentationReviewFeedbackThreadSchema = z
  .object({
    id,
    blockId: id,
    blockIndex: z.number().int().min(0).max(199),
    version: revision.min(1),
    resolved: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    messages: z
      .array(PresentationReviewFeedbackMessageSchema)
      .min(1)
      .max(PRESENTATION_REVIEW_MAX_THREAD_MESSAGES),
  })
  .strict();
export type PresentationReviewFeedbackThread = z.infer<
  typeof PresentationReviewFeedbackThreadSchema
>;
export const PresentationReviewFeedbackSchema = z
  .object({
    schemaVersion: z.literal(1),
    shareId: id,
    versionId: id,
    version: revision.min(1),
    reviewSeq: revision,
    status: z.enum(["not_enabled", "open", "closed"]),
    viewerKey: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.string().datetime(),
    serverTime: z.string().datetime(),
    capabilities: z
      .object({
        enable: z.boolean(),
        comment: z.boolean(),
        resolve: z.boolean(),
        approve: z.boolean(),
      })
      .strict(),
    approval: z
      .object({
        state: z.enum(["not_approved", "approved", "stale"]),
        approvedAt: z.string().datetime().nullable(),
        approvedReviewSeq: revision.min(1).nullable(),
      })
      .strict(),
    threads: z.array(PresentationReviewFeedbackThreadSchema).max(PRESENTATION_REVIEW_MAX_THREADS),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.threads.map((thread) => thread.id.toLowerCase())).size !==
        value.threads.length ||
      new Set(
        value.threads.flatMap((thread) =>
          thread.messages.map((message) => message.id.toLowerCase()),
        ),
      ).size !== value.threads.reduce((sum, thread) => sum + thread.messages.length, 0) ||
      value.threads.reduce((sum, thread) => sum + thread.messages.length, 0) >
        PRESENTATION_REVIEW_MAX_MESSAGES ||
      new TextEncoder().encode(
        value.threads.flatMap((thread) => thread.messages.map((message) => message.text)).join(""),
      ).byteLength > PRESENTATION_REVIEW_MAX_COMMENT_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "Review discussions must remain unique and bounded",
      });
    if (
      value.status !== "open" &&
      (value.capabilities.comment || value.capabilities.resolve || value.capabilities.approve)
    )
      ctx.addIssue({ code: "custom", message: "Only an active review accepts feedback mutations" });
    if (
      (value.status !== "not_enabled" && (value.reviewSeq < 1 || value.capabilities.enable)) ||
      (value.status === "not_enabled" &&
        (value.reviewSeq !== 0 || value.threads.length || value.approval.state !== "not_approved"))
    )
      ctx.addIssue({ code: "custom", message: "Disabled reviews contain no persisted feedback" });
    const approval = value.approval;
    if (
      (approval.state === "not_approved") !==
        (approval.approvedAt === null && approval.approvedReviewSeq === null) ||
      (approval.state !== "not_approved" &&
        (approval.approvedAt === null ||
          approval.approvedReviewSeq === null ||
          approval.approvedReviewSeq > value.reviewSeq)) ||
      (approval.state === "approved" &&
        (approval.approvedReviewSeq !== value.reviewSeq ||
          value.threads.some((thread) => !thread.resolved))) ||
      (approval.state === "stale" && approval.approvedReviewSeq === value.reviewSeq)
    )
      ctx.addIssue({
        code: "custom",
        message: "Author approval belongs to one reviewed feedback revision",
      });
  });
export type PresentationReviewFeedback = z.infer<typeof PresentationReviewFeedbackSchema>;
export const PresentationReviewFeedbackCommandSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("thread.create"), threadId: id, messageId: id, blockId: id, text })
    .strict(),
  z
    .object({
      type: z.literal("message.reply"),
      threadId: id,
      expectedThreadVersion: revision.min(1),
      messageId: id,
      text,
    })
    .strict(),
  z
    .object({
      type: z.literal("message.edit"),
      threadId: id,
      expectedThreadVersion: revision.min(1),
      messageId: id,
      text,
    })
    .strict(),
  z
    .object({
      type: z.literal("message.delete"),
      threadId: id,
      expectedThreadVersion: revision.min(1),
      messageId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("thread.resolve"),
      threadId: id,
      expectedThreadVersion: revision.min(1),
      resolved: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval.set"),
      expectedReviewSeq: revision.min(1),
      approved: z.boolean(),
    })
    .strict(),
]);
export type PresentationReviewFeedbackCommand = z.infer<
  typeof PresentationReviewFeedbackCommandSchema
>;
export const PresentationReviewFeedbackMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: id,
    versionId: id,
    command: PresentationReviewFeedbackCommandSchema,
    viewerKey: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PresentationReviewFeedbackMutation = z.infer<
  typeof PresentationReviewFeedbackMutationSchema
>;
export const PresentationReviewFeedbackReceiptSchema = z
  .object({
    operationId: id,
    reviewSeq: revision.min(1),
    type: z.enum([
      "review.enable",
      ...PresentationReviewFeedbackCommandSchema.options.map((option) => option.shape.type.value),
    ]),
    threadId: id.nullable(),
    messageId: id.nullable(),
  })
  .strict();
export type PresentationReviewFeedbackReceipt = z.infer<
  typeof PresentationReviewFeedbackReceiptSchema
>;
export const PresentationReviewFeedbackMutationResponseSchema = z
  .object({
    feedback: PresentationReviewFeedbackSchema,
    receipt: PresentationReviewFeedbackReceiptSchema,
    replayed: z.boolean(),
  })
  .strict();
export type PresentationReviewFeedbackMutationResponse = z.infer<
  typeof PresentationReviewFeedbackMutationResponseSchema
>;
