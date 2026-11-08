import { z } from "zod";
import { PresentationReviewSchema } from "./presentation-sharing";
const id = z.string().uuid();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const PRESENTATION_READING_MAX_BLOCKS = 200;
export const PRESENTATION_READING_MAX_ATTEMPTS = 1000;
export const PRESENTATION_READING_MAX_RECEIPTS = 250;
export const CreatePresentationAssignmentSchema = z
  .object({ token, requestId: id, versionId: id, expiresAt: z.string().datetime() })
  .strict();
export type CreatePresentationAssignment = z.infer<typeof CreatePresentationAssignmentSchema>;
export const StartPresentationReadingAttemptSchema = z.object({ attemptId: id, token }).strict();
export type StartPresentationReadingAttempt = z.infer<typeof StartPresentationReadingAttemptSchema>;
export const PresentationReadingProgressSchema = z.discriminatedUnion("kind", [
  z
    .object({ requestId: id, expectedRevision: revision, kind: z.literal("read"), blockId: id })
    .strict(),
  z.object({ requestId: id, expectedRevision: revision, kind: z.literal("complete") }).strict(),
]);
export type PresentationReadingProgress = z.infer<typeof PresentationReadingProgressSchema>;
export const PresentationAssignmentMetadataSchema = z
  .object({
    id,
    mode: z.literal("reading"),
    versionId: id,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
  })
  .strict();
export type PresentationAssignmentMetadata = z.infer<typeof PresentationAssignmentMetadataSchema>;
export const PresentationAssignmentCreatedSchema = z
  .object({
    assignment: PresentationAssignmentMetadataSchema,
    url: z.string().url(),
    replayed: z.boolean(),
  })
  .strict();
export const PresentationAssignmentListSchema = z
  .object({ assignments: z.array(PresentationAssignmentMetadataSchema).max(100) })
  .strict();
export const PresentationAssignmentAccessSchema = z
  .object({ versionId: id, expiresAt: z.string().datetime() })
  .strict();
export const PresentationAssignmentPreviewSchema = z
  .object({ assignment: PresentationAssignmentMetadataSchema, review: PresentationReviewSchema })
  .strict();
export type PresentationAssignmentPreview = z.infer<typeof PresentationAssignmentPreviewSchema>;
export const PresentationReadingAttemptSchema = z
  .object({
    id,
    assignmentId: id,
    revision,
    readBlockIds: z.array(id).max(PRESENTATION_READING_MAX_BLOCKS),
    currentBlockId: id.nullable(),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.readBlockIds.map((value) => value.toLowerCase())).size !==
        value.readBlockIds.length ||
      (value.currentBlockId !== null &&
        !value.readBlockIds.some((id) => id.toLowerCase() === value.currentBlockId!.toLowerCase()))
    )
      ctx.addIssue({
        code: "custom",
        message: "Reading acknowledgements must be unique and contain the current page",
      });
  });
export type PresentationReadingAttempt = z.infer<typeof PresentationReadingAttemptSchema>;
export const PresentationReadingAttemptSnapshotSchema = PresentationAssignmentPreviewSchema.extend({
  attempt: PresentationReadingAttemptSchema,
}).strict();
export type PresentationReadingAttemptSnapshot = z.infer<
  typeof PresentationReadingAttemptSnapshotSchema
>;
export const PresentationReadingMutationResultSchema = z
  .object({ attempt: PresentationReadingAttemptSchema, replayed: z.boolean() })
  .strict();
export type PresentationReadingMutationResult = z.infer<
  typeof PresentationReadingMutationResultSchema
>;
