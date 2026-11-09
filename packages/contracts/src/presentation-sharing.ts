import { z } from "zod";
import { PresentationLiveContentBlockSchema } from "./presentation-content";

export const CreatePresentationShareSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    requestId: z.string().uuid(),
    versionId: z.string().uuid(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type CreatePresentationShare = z.infer<typeof CreatePresentationShareSchema>;

export const PresentationShareMetadataSchema = z
  .object({
    id: z.string().uuid(),
    versionId: z.string().uuid(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
  })
  .strict();
export type PresentationShareMetadata = z.infer<typeof PresentationShareMetadataSchema>;
export const PresentationShareAccessSchema = z
  .object({ versionId: z.string().uuid(), expiresAt: z.string().datetime() })
  .strict();
export const PresentationShareCreatedSchema = z
  .object({
    share: PresentationShareMetadataSchema,
    url: z.string().url().nullable(),
    replayed: z.boolean(),
  })
  .strict();
export const PresentationShareListSchema = z
  .object({ shares: z.array(PresentationShareMetadataSchema).max(100) })
  .strict();

const reviewQuestion = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("question"),
    question: z
      .object({
        type: z.enum([
          "single_select",
          "true_false",
          "multi_select",
          "numeric",
          "rating",
          "poll",
          "ranking",
          "open_text",
          "word_cloud",
        ]),
        prompt: z.string().max(2_000),
        mediaId: z.string().uuid().nullable(),
        mediaAlt: z.string().max(300).nullable(),
        choices: z
          .array(z.object({ id: z.string().uuid(), label: z.string().max(300) }).strict())
          .max(6)
          .optional(),
        unit: z.string().max(32).nullable().optional(),
        rating: z
          .object({
            min: z.number(),
            max: z.number(),
            minLabel: z.string().max(80).nullable(),
            maxLabel: z.string().max(80).nullable(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();
/** Every delivered object is strict, including content shared with live Presentations. */
export const PresentationReviewBlockSchema = z.union([
  z.lazy(() => PresentationLiveContentBlockSchema),
  reviewQuestion,
]);
export type PresentationReviewBlock = z.infer<typeof PresentationReviewBlockSchema>;
export const PresentationReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    versionId: z.string().uuid(),
    version: z.number().int().positive(),
    title: z.string().max(160),
    blocks: z.array(PresentationReviewBlockSchema).min(1).max(200),
    sections: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            title: z.string().max(120),
            blockIds: z.array(z.string().uuid()).max(200),
          })
          .strict(),
      )
      .max(50),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type PresentationReview = z.infer<typeof PresentationReviewSchema>;
