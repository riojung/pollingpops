import { z } from "zod";
import type { PresentationContent } from "./index";
import {
  CreatePresentationShareSchema,
  PresentationShareMetadataSchema,
  PresentationReviewSchema,
} from "./presentation-sharing";

export const PRESENTATION_PRACTICE_MAX_BLOCKS = 50;
export const PRESENTATION_PRACTICE_MAX_QUESTIONS = 25;
export const PRESENTATION_PRACTICE_MAX_RECEIPTS = 100;
export const PRESENTATION_PRACTICE_MAX_ATTEMPTS = 250;
export function presentationPracticeEligibility(content: Pick<PresentationContent, "blocks">) {
  const blocks = content.blocks.filter((block) => !("hidden" in block && block.hidden));
  if (!blocks.length || blocks.length > PRESENTATION_PRACTICE_MAX_BLOCKS)
    return { eligible: false, reason: "Practice needs 1–50 visible published pages." };
  const questions = blocks.filter((block) => block.kind === "question");
  if (!questions.length || questions.length > PRESENTATION_PRACTICE_MAX_QUESTIONS)
    return { eligible: false, reason: "Practice needs 1–25 single-choice or true/false checks." };
  if (
    new Set(blocks.map((block) => block.id.toLowerCase())).size !== blocks.length ||
    questions.some(
      ({ question }) =>
        "choices" in question &&
        new Set(question.choices.map((choice) => choice.id.toLowerCase())).size !==
          question.choices.length,
    )
  )
    return {
      eligible: false,
      reason:
        "Practice needs distinct page and answer identifiers. Duplicate identifiers in this published version are ambiguous.",
    };
  if (
    questions.some(
      ({ question: q }) =>
        !["single_select", "true_false"].includes(q.type) ||
        (q.delivery ?? "main") !== "main" ||
        q.linkedRecheckQuestionId ||
        !["diagnostic", "practice"].includes(q.purpose ?? "diagnostic") ||
        q.confidence === "required",
    )
  )
    return {
      eligible: false,
      reason:
        "Practice supports ordinary single-choice and true/false checks without required confidence. Publish a version without other activity formats or linked rechecks.",
    };
  return { eligible: true, reason: null };
}
const id = z.string().uuid();
const time = z.string().datetime();
const revision = z.number().int().min(0).max(PRESENTATION_PRACTICE_MAX_RECEIPTS);
export const CreatePresentationPracticeAssignmentSchema = CreatePresentationShareSchema;
export type CreatePresentationPracticeAssignment = z.infer<
  typeof CreatePresentationPracticeAssignmentSchema
>;
export const StartPresentationPracticeAttemptSchema = z
  .object({ attemptId: id, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export type StartPresentationPracticeAttempt = z.infer<
  typeof StartPresentationPracticeAttemptSchema
>;
export const PresentationPracticeProgressSchema = z.discriminatedUnion("kind", [
  z
    .object({ requestId: id, expectedRevision: revision, kind: z.literal("read"), blockId: id })
    .strict(),
  z
    .object({
      requestId: id,
      expectedRevision: revision,
      kind: z.literal("answer"),
      blockId: id,
      choiceId: id,
    })
    .strict(),
  z.object({ requestId: id, expectedRevision: revision, kind: z.literal("complete") }).strict(),
]);
export type PresentationPracticeProgress = z.infer<typeof PresentationPracticeProgressSchema>;
export const PresentationPracticeAssignmentMetadataSchema = PresentationShareMetadataSchema.extend({
  mode: z.literal("practice"),
}).strict();
export type PresentationPracticeAssignmentMetadata = z.infer<
  typeof PresentationPracticeAssignmentMetadataSchema
>;
export const PresentationPracticeAssignmentCreatedSchema = z
  .object({
    assignment: PresentationPracticeAssignmentMetadataSchema,
    url: z.string().url(),
    replayed: z.boolean(),
  })
  .strict();
export const PresentationPracticeAssignmentListSchema = z
  .object({ assignments: z.array(PresentationPracticeAssignmentMetadataSchema).max(50) })
  .strict();
export const PresentationPracticeAssignmentAccessSchema = z
  .object({ versionId: id, expiresAt: time })
  .strict();
const review = PresentationReviewSchema.superRefine((value, ctx) => {
  const questions = value.blocks.filter((block) => block.kind === "question");
  if (
    value.blocks.length > PRESENTATION_PRACTICE_MAX_BLOCKS ||
    questions.length < 1 ||
    questions.length > PRESENTATION_PRACTICE_MAX_QUESTIONS ||
    questions.some(
      ({ question: q }) =>
        !["single_select", "true_false"].includes(q.type) || !q.choices || q.choices.length < 2,
    )
  )
    ctx.addIssue({
      code: "custom",
      message: "Practice requires a bounded publication of supported choice checks",
    });
});
export const PresentationPracticePreviewSchema = z
  .object({ assignment: PresentationPracticeAssignmentMetadataSchema, review })
  .strict();
export type PresentationPracticePreview = z.infer<typeof PresentationPracticePreviewSchema>;
export const PresentationPracticeAnswerSchema = z
  .object({
    blockId: id,
    choiceId: id,
    correct: z.boolean(),
    submittedAt: time,
    feedback: z
      .object({
        correctChoiceId: id,
        explanation: z.string().max(1000).nullable(),
        selectedFeedback: z.string().max(500).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.correct !==
      (value.choiceId.toLowerCase() === value.feedback.correctChoiceId.toLowerCase())
    )
      ctx.addIssue({
        code: "custom",
        message: "Accepted correctness must match its frozen feedback",
      });
  });
export type PresentationPracticeAnswer = z.infer<typeof PresentationPracticeAnswerSchema>;
export const PresentationPracticeAttemptSchema = z
  .object({
    id,
    assignmentId: id,
    revision,
    readBlockIds: z.array(id).max(PRESENTATION_PRACTICE_MAX_BLOCKS),
    currentBlockId: id.nullable(),
    startedAt: time,
    updatedAt: time,
    completedAt: time.nullable(),
    answers: z.array(PresentationPracticeAnswerSchema).max(PRESENTATION_PRACTICE_MAX_QUESTIONS),
  })
  .strict()
  .superRefine((value, ctx) => {
    const read = value.readBlockIds.map((v) => v.toLowerCase()),
      answers = value.answers.map((v) => v.blockId.toLowerCase());
    if (
      new Set(read).size !== read.length ||
      new Set(answers).size !== answers.length ||
      answers.some((v) => !read.includes(v)) ||
      (value.currentBlockId !== null && !read.includes(value.currentBlockId.toLowerCase()))
    )
      ctx.addIssue({
        code: "custom",
        message: "Practice acknowledgements and accepted answers must be unique and consistent",
      });
  });
export type PresentationPracticeAttempt = z.infer<typeof PresentationPracticeAttemptSchema>;
export const PresentationPracticeAttemptSnapshotSchema = PresentationPracticePreviewSchema.extend({
  attempt: PresentationPracticeAttemptSchema,
}).strict();
export type PresentationPracticeAttemptSnapshot = z.infer<
  typeof PresentationPracticeAttemptSnapshotSchema
>;
export const PresentationPracticeMutationResultSchema = z
  .object({ attempt: PresentationPracticeAttemptSchema, replayed: z.boolean() })
  .strict();
export type PresentationPracticeMutationResult = z.infer<
  typeof PresentationPracticeMutationResultSchema
>;
const count = z.number().int().min(0).max(PRESENTATION_PRACTICE_MAX_ATTEMPTS);
const cell = count.refine((v) => v === 0 || v >= 5).nullable();
export const PresentationPracticeInsightsSchema = z
  .object({
    schemaVersion: z.literal(1),
    assignment: PresentationPracticeAssignmentMetadataSchema,
    generatedAt: time,
    minimumAttempts: z.literal(5),
    startedAttempts: count.min(5).nullable(),
    completedAttempts: cell,
    inProgressAttempts: cell,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.startedAttempts === null &&
        (value.completedAttempts !== null || value.inProgressAttempts !== null)) ||
      (value.completedAttempts === null) !== (value.inProgressAttempts === null) ||
      (value.completedAttempts !== null &&
        value.inProgressAttempts !== null &&
        value.completedAttempts + value.inProgressAttempts !== value.startedAttempts)
    )
      ctx.addIssue({
        code: "custom",
        message: "Practice insights must suppress related small groups and preserve denominators",
      });
  });
export type PresentationPracticeInsights = z.infer<typeof PresentationPracticeInsightsSchema>;
