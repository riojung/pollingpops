import { z } from "zod";

export const SummarySourceKindSchema = z.enum(["round", "presentation", "survey"]);
export type SummarySourceKind = z.infer<typeof SummarySourceKindSchema>;
export const SummarySourceSchema = z
  .object({ kind: SummarySourceKindSchema, id: z.string().uuid() })
  .strict();
export type SummarySource = z.infer<typeof SummarySourceSchema>;
export const SummaryExportFormatSchema = z.enum(["pdf", "png", "xlsx"]);
export type SummaryExportFormat = z.infer<typeof SummaryExportFormatSchema>;
export const SummaryLocaleSchema = z.enum([
  "en-CA",
  "fr-FR",
  "de-DE",
  "es-ES",
  "it-IT",
  "pt-PT",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
]);
export type SummaryLocale = z.infer<typeof SummaryLocaleSchema>;

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const SummaryAccuracySchema = z
  .object({ correct: count, responses: count.min(5), percent: z.number().min(0).max(100) })
  .strict()
  .refine((value) => value.correct <= value.responses, "Correct responses exceed the sample");
export type SummaryAccuracy = z.infer<typeof SummaryAccuracySchema>;
export const SummaryRecoverySchema = z
  .object({
    kind: z.enum(["linked", "revote"]),
    label: z.string().max(2_000),
    eligible: count.min(5),
    recovered: count,
    percent: z.number().min(0).max(100),
  })
  .strict()
  .refine((value) => value.recovered <= value.eligible, "Recovered responses exceed the sample");
export type SummaryRecovery = z.infer<typeof SummaryRecoverySchema>;
export const SummaryQuestionSchema = z
  .object({
    index: z.number().int().min(0).max(199),
    prompt: z.string().max(2_000),
    type: z.string().min(1).max(64),
    purpose: z.enum(["assessed", "opinion", "content"]),
    respondents: count.min(5).nullable(),
    accuracy: SummaryAccuracySchema.nullable(),
    suppression: z.enum(["none", "insufficient_sample", "participant_text", "unavailable"]),
    measure: z.enum(["respondents", "selections", "weighted_points"]),
    maxSelections: z.number().int().min(1).max(32).nullable(),
    results: z
      .array(
        z
          .object({ label: z.string().max(2_000), value: z.number().finite().nonnegative() })
          .strict(),
      )
      .max(32),
  })
  .strict()
  .superRefine((question, ctx) => {
    if (
      question.suppression !== "none" &&
      (question.results.length > 0 || question.accuracy !== null)
    ) {
      ctx.addIssue({ code: "custom", message: "Suppressed results must contain no evidence" });
    }
    if (question.purpose !== "assessed" && question.accuracy !== null) {
      ctx.addIssue({ code: "custom", message: "Opinion and content checkpoints are unscored" });
    }
    if (question.results.length > 0 && question.respondents === null) {
      ctx.addIssue({
        code: "custom",
        message: "Distributions require an adequate respondent sample",
      });
    }
  });
export type SummaryQuestion = z.infer<typeof SummaryQuestionSchema>;

/** Strict allowlist for public pages and every summary format; source/actor IDs are private. */
export const AggregateSessionSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: SummarySourceKindSchema,
    title: z.string().min(1).max(160),
    finishedAt: z.string().datetime(),
    minimumRespondents: z.literal(5),
    participantCount: count,
    responseCount: count,
    questionCount: count.max(200),
    initialAccuracy: SummaryAccuracySchema.nullable(),
    recovery: z.array(SummaryRecoverySchema).max(200),
    questions: z.array(SummaryQuestionSchema).max(200),
    noteCodes: z
      .array(
        z.enum([
          "aggregate_only",
          "insufficient_sample",
          "participant_text_excluded",
          "paired_evidence",
          "no_scored_evidence",
        ]),
      )
      .max(5),
    nextSteps: z.string().max(2_000),
  })
  .strict()
  .refine(
    (summary) =>
      new Set(summary.questions.map((question) => question.index)).size ===
      summary.questions.length,
    "Summary question positions must be unique",
  );
export type AggregateSessionSummary = z.infer<typeof AggregateSessionSummarySchema>;

export const SummaryCapabilitiesSchema = z
  .object({
    canCreateShare: z.boolean(),
    canRevokeShare: z.boolean(),
    downloadFormats: z.array(SummaryExportFormatSchema).max(3),
    reasonCodes: z.array(z.enum(["feature_disabled", "role", "exports_entitlement"])).max(3),
  })
  .strict();
export type SummaryCapabilities = z.infer<typeof SummaryCapabilitiesSchema>;
export const SessionSummaryPreviewSchema = z
  .object({
    source: SummarySourceSchema,
    summary: AggregateSessionSummarySchema,
    sourceExpiresAt: z.string().datetime(),
    capabilities: SummaryCapabilitiesSchema,
  })
  .strict();
export type SessionSummaryPreview = z.infer<typeof SessionSummaryPreviewSchema>;

export const SummaryShareMetadataSchema = z
  .object({
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
    allowDownloads: z.boolean(),
  })
  .strict();
export type SummaryShareMetadata = z.infer<typeof SummaryShareMetadataSchema>;
export const CreateSummaryShareSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    expiresInDays: z.number().int().min(1).max(30).default(7),
    allowDownloads: z.boolean().default(true),
    nextSteps: z.string().trim().max(2_000).default(""),
  })
  .strict();
export type CreateSummaryShare = z.infer<typeof CreateSummaryShareSchema>;
export const CreatedSummaryShareSchema = z
  .object({
    share: SummaryShareMetadataSchema,
    url: z.string().url().nullable(),
    replayed: z.boolean(),
  })
  .strict();
export type CreatedSummaryShare = z.infer<typeof CreatedSummaryShareSchema>;
export const SummaryShareListSchema = z
  .object({ shares: z.array(SummaryShareMetadataSchema).max(100) })
  .strict();
const SummaryExportRequestBaseSchema = z
  .object({
    format: SummaryExportFormatSchema,
    locale: SummaryLocaleSchema.default("en-CA"),
    questionIndex: z.number().int().min(0).max(199).optional(),
    nextSteps: z.string().trim().max(2_000).default(""),
  })
  .strict();
const imageSelectionOnly = (value: { format: SummaryExportFormat; questionIndex?: number }) =>
  value.questionIndex === undefined || value.format === "png";
export const SummaryExportRequestSchema = SummaryExportRequestBaseSchema.refine(
  imageSelectionOnly,
  "Checkpoint selection is available for images only",
);
export type SummaryExportRequest = z.infer<typeof SummaryExportRequestSchema>;
export const PublicSummaryExportRequestSchema = SummaryExportRequestBaseSchema.omit({
  nextSteps: true,
}).refine(imageSelectionOnly, "Checkpoint selection is available for images only");
export const SharedSessionSummarySchema = z
  .object({
    summary: AggregateSessionSummarySchema,
    expiresAt: z.string().datetime(),
    downloadFormats: z.array(SummaryExportFormatSchema).max(3),
  })
  .strict();
export type SharedSessionSummary = z.infer<typeof SharedSessionSummarySchema>;
