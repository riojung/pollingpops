import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { PresentationAssistanceErrorCodeSchema } from "./presentation-assistance";

export const PRESENTATION_TEXT_ASSISTANCE_MAX_ACTIVE_JOBS = 2;
export const PRESENTATION_TEXT_ASSISTANCE_MAX_ATTEMPTS = 3;
export const PRESENTATION_TEXT_ASSISTANCE_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING =
  "AI-generated wording is unverified. Existing citations describe earlier source text and do not verify this edit.";
const uuid = z.string().uuid().toLowerCase();
const nodeId = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const role = z.enum(["title", "body"]);
const operation = z.enum(["rewrite", "shorten"]);
const text = z
  .string()
  .min(1)
  .max(4_000)
  .refine((value) => value.trim().length > 0, {
    message: "Select nonempty text",
  });
const hash = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)));

/** Exact plain-text digest. Target identity and role are independently bound by each job. */
export const presentationTextAssistanceSourceDigest = (value: string) => hash(text.parse(value));

export const CreatePresentationTextAssistanceJobSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: uuid,
    presentationId: uuid,
    blockId: uuid,
    nodeId,
    operation,
    expectedRevision: z.number().int().nonnegative(),
    sourceDigest: digest,
  })
  .strict();
export type CreatePresentationTextAssistanceJob = z.infer<
  typeof CreatePresentationTextAssistanceJobSchema
>;

/** Latest accepted AI text edit, not an attribution for the whole slide or an audit log. */
export const PresentationTextAssistanceProvenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    nodeId,
    role,
    operation,
    sourceDigest: digest,
    outputDigest: digest,
    provider: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(120),
    generatedAt: z.string().datetime(),
    reviewWarning: z.literal(PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING),
  })
  .strict();
export type PresentationTextAssistanceProvenance = z.infer<
  typeof PresentationTextAssistanceProvenanceSchema
>;

export const PresentationTextAssistanceProposalSchema = z
  .object({
    ...PresentationTextAssistanceProvenanceSchema.shape,
    blockId: uuid,
    originalText: text,
    text,
  })
  .strict()
  .superRefine((proposal, context) => {
    if (
      proposal.role === "title" &&
      (proposal.text.length > 160 || proposal.originalText.length > 160)
    )
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Title text is limited to 160 characters",
      });
    if (proposal.text === proposal.originalText)
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "The proposed text must change the original",
      });
    if (proposal.operation === "shorten" && proposal.text.length >= proposal.originalText.length)
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Shortened text must be shorter than the original",
      });
    if (hash(proposal.originalText) !== proposal.sourceDigest)
      context.addIssue({
        code: "custom",
        path: ["sourceDigest"],
        message: "The exact original text must match its digest",
      });
    if (hash(proposal.text) !== proposal.outputDigest)
      context.addIssue({
        code: "custom",
        path: ["outputDigest"],
        message: "The exact proposed text must match its digest",
      });
  });
export type PresentationTextAssistanceProposal = z.infer<
  typeof PresentationTextAssistanceProposalSchema
>;

export const PresentationTextAssistanceErrorCodeSchema = PresentationAssistanceErrorCodeSchema;
export type PresentationTextAssistanceErrorCode = z.infer<
  typeof PresentationTextAssistanceErrorCodeSchema
>;
export const PRESENTATION_TEXT_ASSISTANCE_ERROR_MESSAGES: Record<
  PresentationTextAssistanceErrorCode,
  string
> = {
  PROVIDER_UNAVAILABLE: "Text assistance is temporarily unavailable. Your deck has not changed.",
  INVALID_OUTPUT: "The generated wording could not be validated. Your deck has not changed.",
  SOURCE_UNAVAILABLE: "The selected text or its author is no longer available.",
  EXPIRED: "This proposal has expired. Its private text has been erased.",
  ATTEMPTS_EXHAUSTED: "Text assistance could not finish within its attempt limit.",
};

export const PresentationTextAssistanceJobSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    requestId: uuid,
    presentationId: uuid,
    blockId: uuid,
    nodeId,
    operation,
    sourceRevision: z.number().int().nonnegative(),
    role,
    sourceDigest: digest,
    status: z.enum(["pending", "processing", "ready", "failed", "expired"]),
    attempts: z.number().int().min(0).max(PRESENTATION_TEXT_ASSISTANCE_MAX_ATTEMPTS),
    proposal: PresentationTextAssistanceProposalSchema.nullable(),
    proposalHash: digest.nullable(),
    error: z
      .object({
        code: PresentationTextAssistanceErrorCodeSchema,
        message: z.string().min(1).max(160),
      })
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
        message: "The job must retain its request identity",
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
    const parsedProposal =
      job.proposal && PresentationTextAssistanceProposalSchema.safeParse(job.proposal);
    if (
      parsedProposal?.success &&
      (parsedProposal.data.blockId !== job.blockId ||
        parsedProposal.data.nodeId !== job.nodeId ||
        parsedProposal.data.role !== job.role ||
        parsedProposal.data.operation !== job.operation ||
        parsedProposal.data.sourceDigest !== job.sourceDigest ||
        hash(JSON.stringify(parsedProposal.data)) !== job.proposalHash)
    )
      context.addIssue({
        code: "custom",
        path: ["proposalHash"],
        message: "The complete proposal must match the selected source and hash",
      });
    if (
      job.error &&
      job.error.message !== PRESENTATION_TEXT_ASSISTANCE_ERROR_MESSAGES[job.error.code]
    )
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Use the static error message",
      });
    if (
      (["failed", "expired"].includes(job.status) && !job.error) ||
      (["processing", "ready"].includes(job.status) && job.error) ||
      (job.status === "expired") !== (job.error?.code === "EXPIRED")
    )
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "The error must match the job state",
      });
  });
export type PresentationTextAssistanceJob = z.infer<typeof PresentationTextAssistanceJobSchema>;

export const ApplyPresentationTextAssistanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: uuid,
    proposalHash: digest,
    blockId: uuid,
    nodeId,
    sourceDigest: digest,
    reviewed: z.literal(true),
    expectedRevision: z.number().int().nonnegative(),
    mutationId: uuid,
  })
  .strict();
export type ApplyPresentationTextAssistance = z.infer<typeof ApplyPresentationTextAssistanceSchema>;
export const presentationTextAssistanceRequestHash = (value: unknown) =>
  hash(JSON.stringify(CreatePresentationTextAssistanceJobSchema.parse(value)));
export const presentationTextAssistanceProposalHash = (value: unknown) =>
  hash(JSON.stringify(PresentationTextAssistanceProposalSchema.parse(value)));
