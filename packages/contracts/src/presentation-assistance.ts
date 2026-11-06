import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const PRESENTATION_ASSISTANCE_MAX_ACTIVE_JOBS = 2;
export const PRESENTATION_ASSISTANCE_MAX_ATTEMPTS = 3;
export const PRESENTATION_ASSISTANCE_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const PRESENTATION_ASSISTANCE_REVIEW_WARNING =
  "AI-generated draft. Claims are unverified; review every slide and exact source citation before inserting.";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid().toLowerCase();
const name = z.string().trim().min(1).max(160);
export const CreatePresentationAssistanceJobSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: uuid,
    presentationId: uuid,
    sourceName: name,
    outline: z.string().trim().min(50).max(12_000),
    slideCount: z.number().int().min(3).max(8),
  })
  .strict();
export type CreatePresentationAssistanceJob = z.infer<typeof CreatePresentationAssistanceJobSchema>;
export const PresentationAssistanceCitationSchema = z
  .object({
    locator: z.string().trim().min(1).max(120),
    excerpt: z.string().trim().min(1).max(500),
  })
  .strict();
export const PresentationAssistanceSlideProposalSchema = z
  .object({
    id: uuid,
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(2_000),
    citations: z.array(PresentationAssistanceCitationSchema).min(1).max(4),
  })
  .strict();
export type PresentationAssistanceSlideProposal = z.infer<
  typeof PresentationAssistanceSlideProposalSchema
>;
export const PresentationAssistanceProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceName: name,
    sourceDigest: digest,
    slides: z.array(PresentationAssistanceSlideProposalSchema).min(3).max(8),
    generatedAt: z.string().datetime(),
    provider: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(120),
    reviewWarning: z.literal(PRESENTATION_ASSISTANCE_REVIEW_WARNING),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (new Set(proposal.slides.map((slide) => slide.id)).size !== proposal.slides.length)
      context.addIssue({
        code: "custom",
        path: ["slides"],
        message: "Slide identities must be unique",
      });
  });
export type PresentationAssistanceProposal = z.infer<typeof PresentationAssistanceProposalSchema>;
export const PresentationAssistanceErrorCodeSchema = z.enum([
  "PROVIDER_UNAVAILABLE",
  "INVALID_OUTPUT",
  "SOURCE_UNAVAILABLE",
  "EXPIRED",
  "ATTEMPTS_EXHAUSTED",
]);
export type PresentationAssistanceErrorCode = z.infer<typeof PresentationAssistanceErrorCodeSchema>;
export const PRESENTATION_ASSISTANCE_ERROR_MESSAGES: Record<
  PresentationAssistanceErrorCode,
  string
> = {
  PROVIDER_UNAVAILABLE: "Slide assistance is temporarily unavailable. Your deck has not changed.",
  INVALID_OUTPUT: "The generated draft could not be validated. Your deck has not changed.",
  SOURCE_UNAVAILABLE: "The source or its author is no longer available.",
  EXPIRED: "This draft has expired. Its private source and proposals have been erased.",
  ATTEMPTS_EXHAUSTED: "Slide assistance could not finish within its attempt limit.",
};
export const PresentationAssistanceJobSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    requestId: uuid,
    presentationId: uuid,
    sourceName: name,
    slideCount: z.number().int().min(3).max(8),
    status: z.enum(["pending", "processing", "ready", "failed", "expired"]),
    attempts: z.number().int().min(0).max(PRESENTATION_ASSISTANCE_MAX_ATTEMPTS),
    proposal: PresentationAssistanceProposalSchema.nullable(),
    proposalHash: digest.nullable(),
    sourceDigest: digest,
    error: z
      .object({ code: PresentationAssistanceErrorCodeSchema, message: z.string().min(1).max(160) })
      .strict()
      .nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.id !== job.requestId)
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Job identity must match its request identity",
      });
    if (
      (job.status === "ready") !== (job.proposal !== null && job.proposalHash !== null) ||
      (job.status !== "ready" && (job.proposal !== null || job.proposalHash !== null))
    )
      context.addIssue({
        code: "custom",
        path: ["proposal"],
        message: "Only ready jobs have proposals",
      });
    if (
      job.proposal &&
      (job.proposal.sourceName !== job.sourceName ||
        job.proposal.sourceDigest !== job.sourceDigest ||
        job.proposal.slides.length !== job.slideCount ||
        presentationAssistanceProposalHash(job.proposal) !== job.proposalHash)
    )
      context.addIssue({
        code: "custom",
        path: ["proposalHash"],
        message: "The complete proposal must match its source and hash",
      });
    if (job.error && job.error.message !== PRESENTATION_ASSISTANCE_ERROR_MESSAGES[job.error.code])
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Use the static error message",
      });
  });
export type PresentationAssistanceJob = z.infer<typeof PresentationAssistanceJobSchema>;
export const InsertPresentationAssistanceProposalsSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: uuid,
    proposalHash: digest,
    selectedSlideIds: z.array(uuid).min(1).max(8),
    reviewed: z.literal(true),
    expectedRevision: z.number().int().min(0),
    mutationId: uuid,
    afterBlockId: uuid.nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.selectedSlideIds).size !== request.selectedSlideIds.length)
      context.addIssue({
        code: "custom",
        path: ["selectedSlideIds"],
        message: "Select each slide once",
      });
  });
export type InsertPresentationAssistanceProposals = z.infer<
  typeof InsertPresentationAssistanceProposalsSchema
>;
const hash = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)));
/** Complete normalized intent, including target, count, source name and stable request identity. */
export const presentationAssistanceRequestHash = (request: unknown) =>
  hash(JSON.stringify(CreatePresentationAssistanceJobSchema.parse(request)));
export const presentationAssistanceSourceDigest = (outline: string) =>
  hash(CreatePresentationAssistanceJobSchema.shape.outline.parse(outline));
/** Canonical complete normalized proposal binding, stable across JSONB key reordering. */
export const presentationAssistanceProposalHash = (proposal: unknown) =>
  hash(JSON.stringify(PresentationAssistanceProposalSchema.parse(proposal)));

/** Compact recovery binding for an explicitly selected, ordered set of content slides. */
export const presentationAssistanceSlideProjectionHash = (slides: unknown) =>
  hash(
    JSON.stringify(z.array(PresentationAssistanceSlideProposalSchema).min(1).max(8).parse(slides)),
  );
