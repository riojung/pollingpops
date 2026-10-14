import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const OPEN_TEXT_CHARACTER_LIMIT = 1_000;
export const WORD_CLOUD_CHARACTER_LIMIT = 80;
export const TEXT_RESPONSE_MAX_PER_ROUND = 250;
export const TEXT_RESPONSE_MAX_QUESTIONS = 10;
export const TEXT_RESPONSE_MAX_ENTRIES = 2_500;
export const TEXT_RESPONSE_MAX_RECEIPTS = 5_000;
export type TextOpinionQuestionType = "open_text" | "word_cloud";

export function isTextOpinionQuestion(
  question: { type?: string } | undefined,
): question is { type: TextOpinionQuestionType } {
  return question?.type === "open_text" || question?.type === "word_cloud";
}
export function hasTextOpinionQuestions(content: {
  questions: readonly { type: string }[];
}): boolean {
  return content.questions.some(isTextOpinionQuestion);
}
export function textResponseCharacterLimit(type: TextOpinionQuestionType): number {
  return type === "word_cloud" ? WORD_CLOUD_CHARACTER_LIMIT : OPEN_TEXT_CHARACTER_LIMIT;
}
/** Length is measured in UTF-16 code units after normalization, matching browser input limits. */
export function normalizeTextResponse(
  value: string,
  type: TextOpinionQuestionType = "open_text",
): string {
  const normalized = value.normalize("NFC").trim();
  if (!normalized.length || normalized.length > textResponseCharacterLimit(type)) {
    throw new Error(`Enter between 1 and ${textResponseCharacterLimit(type)} characters`);
  }
  for (const character of normalized) {
    const code = character.codePointAt(0)!;
    if (
      (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) &&
      !(type === "open_text" && (code === 9 || code === 10))
    ) {
      throw new Error("Text responses cannot contain control characters");
    }
  }
  return normalized;
}
export const normalizeOpinionText = normalizeTextResponse;
export function wordCloudGroupKey(value: string): string {
  return normalizeTextResponse(value, "word_cloud")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .normalize("NFC");
}
export const TextResponseValueSchema = z
  .string()
  .max(10_000)
  .transform((value, context) => {
    try {
      return normalizeTextResponse(value);
    } catch (error) {
      context.addIssue({ code: "custom", message: (error as Error).message });
      return z.NEVER;
    }
  });
export const TextResponseModerationStatusSchema = z.enum(["pending", "approved", "removed"]);
export type TextResponseModerationStatus = z.infer<typeof TextResponseModerationStatusSchema>;
export const TextResponseModeratorActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("host"), userId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("cohost"), credentialId: z.string().uuid() }).strict(),
]);
export type TextResponseModeratorActor = z.infer<typeof TextResponseModeratorActorSchema>;
export const TextResponseModerationEntrySchema = z
  .object({
    roundId: z.string().uuid(),
    questionId: z.string().uuid(),
    status: TextResponseModerationStatusSchema,
    acceptedAtMs: z.number().int().nonnegative(),
  })
  .strict();
export type TextResponseModerationEntry = z.infer<typeof TextResponseModerationEntrySchema>;
export const TextResponseModerationMapSchema = z
  .record(z.string().uuid(), TextResponseModerationEntrySchema)
  .refine(
    (entries) => Object.keys(entries).length <= TEXT_RESPONSE_MAX_ENTRIES,
    "Text response metadata limit exceeded",
  );
export type TextResponseModerationMap = z.infer<typeof TextResponseModerationMapSchema>;
export const TextResponseModerationReceiptSchema = z
  .object({
    intentHash: z.string().regex(/^[a-f0-9]{64}$/),
    answerId: z.string().uuid(),
    actor: TextResponseModeratorActorSchema,
    previousStatus: z.enum(["pending", "approved"]),
    status: z.enum(["approved", "removed"]),
    expectedVersion: z.number().int().nonnegative(),
    resultingVersion: z.number().int().positive(),
    occurredAtMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (receipt) =>
      receipt.resultingVersion === receipt.expectedVersion + 1 &&
      (receipt.previousStatus !== "approved" || receipt.status === "removed"),
    "Invalid moderation transition receipt",
  );
export type TextResponseModerationReceipt = z.infer<typeof TextResponseModerationReceiptSchema>;
export const TextResponseModerationReceiptsSchema = z
  .record(z.string().min(8).max(160), TextResponseModerationReceiptSchema)
  .refine(
    (receipts) => Object.keys(receipts).length <= TEXT_RESPONSE_MAX_RECEIPTS,
    "Text response moderation receipt limit exceeded",
  );
export function textResponseModerationIntentHash(input: {
  answerId: string;
  status: "approved" | "removed";
  expectedVersion: number;
  actor: TextResponseModeratorActor;
}): string {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify({
          answerId: input.answerId,
          status: input.status,
          expectedVersion: input.expectedVersion,
          actor: TextResponseModeratorActorSchema.parse(input.actor),
        }),
      ),
    ),
  );
}
export const TextResponseModerationCountsSchema = z
  .object({
    pending: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  })
  .strict();
export const TextResponseAnswerIdsSchema = z
  .array(z.string().uuid())
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Request each response identifier once");
export const OpenTextResponseDistributionSchema = z
  .object({
    kind: z.literal("open_text"),
    respondents: z.number().int().min(5).max(TEXT_RESPONSE_MAX_PER_ROUND),
    entries: z
      .array(z.object({ value: TextResponseValueSchema }).strict())
      .min(5)
      .max(TEXT_RESPONSE_MAX_PER_ROUND),
  })
  .strict()
  .refine(
    (distribution) => distribution.entries.length === distribution.respondents,
    "Text entries must match the respondent count",
  );
export const WordCloudResponseDistributionSchema = z
  .object({
    kind: z.literal("word_cloud"),
    respondents: z.number().int().min(5).max(TEXT_RESPONSE_MAX_PER_ROUND),
    buckets: z
      .array(
        z
          .object({
            value: z.string().min(1).max(240),
            label: z.string().min(1).max(240),
            count: z.number().int().positive().max(TEXT_RESPONSE_MAX_PER_ROUND),
            percent: z.number().min(0).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(TEXT_RESPONSE_MAX_PER_ROUND),
  })
  .strict()
  .refine(
    (distribution) =>
      distribution.buckets.reduce((total, bucket) => total + bucket.count, 0) ===
        distribution.respondents &&
      new Set(distribution.buckets.map((bucket) => bucket.value)).size ===
        distribution.buckets.length,
    "Cloud frequencies must reconcile with respondents",
  );
export const TextResponseDistributionSchema = z.union([
  OpenTextResponseDistributionSchema,
  WordCloudResponseDistributionSchema,
]);
export type TextResponseDistribution = z.infer<typeof TextResponseDistributionSchema>;
