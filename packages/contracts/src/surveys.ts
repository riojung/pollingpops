import { z } from "zod";
import {
  QuestionDraftSchema,
  QuizContentSchema,
  RoundCategorySchema,
  ExperiencePresetRefSchema,
} from "./index";

/** Surveys are separate, unscored artifacts. They never enter the learning engine. */
export const SurveyDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().max(160),
    description: z.string().trim().max(1000).default(""),
    category: RoundCategorySchema.default("general"),
    experiencePreset: ExperiencePresetRefSchema.default({ id: "focus", version: 1 }),
    items: z.array(z.object({ required: z.boolean(), question: QuestionDraftSchema })).max(100),
  })
  .strict()
  .superRefine((draft, ctx) => {
    for (const [index, { question }] of draft.items.entries()) {
      if (
        !["poll", "rating"].includes(question.type) ||
        question.purpose !== "opinion" ||
        question.confidence !== "off" ||
        question.delivery !== "main" ||
        question.basePoints !== 0 ||
        question.linkedRecheckQuestionId ||
        question.mediaId ||
        question.recoveryPackSource ||
        question.sourceCitations?.length ||
        question.conceptKeys?.length ||
        ("choices" in question &&
          question.choices.some((c) => c.isCorrect || c.misconceptionKey || c.feedback))
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "question"],
          message:
            "Surveys support unscored polls and ratings only, without diagnostic or private learning metadata",
        });
      }
    }
    if (new Set(draft.items.map((item) => item.question.id)).size !== draft.items.length) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Survey question IDs must be unique",
      });
    }
  });
export type SurveyDraft = z.infer<typeof SurveyDraftSchema>;
export const SurveyContentSchema = SurveyDraftSchema.superRefine((draft, ctx) => {
  const content = QuizContentSchema.safeParse({
    ...draft,
    questions: draft.items.map((item) => item.question),
  });
  if (!content.success)
    for (const issue of content.error.issues) {
      const path =
        issue.path[0] === "questions"
          ? ["items", issue.path[1], "question", ...issue.path.slice(2)]
          : issue.path;
      ctx.addIssue({
        code: "custom",
        path: path as (string | number)[],
        message: issue.message === "Enter a quiz title" ? "Enter a Survey title" : issue.message,
      });
    }
});
export const SurveyResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("poll"), choiceIds: z.array(z.string().uuid()).length(1) }).strict(),
  z.object({ kind: z.literal("rating"), value: z.number().int().min(1).max(10) }).strict(),
]);
export type SurveyResponse = z.infer<typeof SurveyResponseSchema>;
export const SurveyResponsesSchema = z.record(z.string().uuid(), SurveyResponseSchema);
export type SurveyResponses = z.infer<typeof SurveyResponsesSchema>;
export const SurveyMutationSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    draft: SurveyDraftSchema,
  })
  .strict();
export const SurveyRoomCreateSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    windowDays: z.number().int().min(1).max(30).default(7),
  })
  .strict();
export const SurveyAttemptMutationSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    responses: SurveyResponsesSchema,
  })
  .strict();

export function validateSurveyResponses(
  content: SurveyDraft,
  responses: SurveyResponses,
  final: boolean,
) {
  const parsed = SurveyResponsesSchema.parse(responses);
  const issues: string[] = [];
  if (Object.keys(parsed).some((id) => !content.items.some((item) => item.question.id === id)))
    issues.push("Remove responses to questions not in this survey");
  for (const [index, item] of content.items.entries()) {
    const response = parsed[item.question.id];
    if (!response) {
      if (final && item.required) issues.push(`Question ${index + 1}: a response is required`);
      continue;
    }
    const question = item.question;
    const valid =
      question.type === "poll"
        ? response.kind === "poll" &&
          response.choiceIds.length === 1 &&
          question.choices.some((c) => c.id === response.choiceIds[0])
        : question.type === "rating" &&
          response.kind === "rating" &&
          response.value >= question.min &&
          response.value <= question.max;
    if (!valid) issues.push(`Question ${index + 1}: select a valid response`);
  }
  return issues;
}

/** No attempt identifiers, response rows, aliases or precise respondent timestamps. */
export function surveyAggregate(
  content: SurveyDraft,
  responses: SurveyResponses[],
  closed = false,
) {
  // Live exact-count differences can reconstruct a single respondent's linked answers.
  // Release one final distribution only after admission and submission have both closed.
  const suppressed = !closed || responses.length < 5;
  return {
    schemaVersion: 1 as const,
    title: content.title,
    submittedCount: responses.length,
    suppressed,
    resultsStatus: !closed
      ? ("collecting" as const)
      : suppressed
        ? ("insufficient_sample" as const)
        : ("available" as const),
    minimumRespondents: 5,
    questions: content.items.map(({ question }) => {
      const answeredCount = responses.filter((row) => row[question.id]).length;
      const questionSuppressed = suppressed || answeredCount < 5;
      return {
        id: question.id,
        prompt: question.prompt,
        type: question.type,
        suppressed: questionSuppressed,
        answeredCount: questionSuppressed ? null : answeredCount,
        distribution: questionSuppressed
          ? []
          : question.type === "poll"
            ? question.choices.map((choice) => ({
                label: choice.label,
                count: responses.filter((row) => {
                  const r = row[question.id];
                  return r?.kind === "poll" && r.choiceIds[0] === choice.id;
                }).length,
              }))
            : question.type === "rating"
              ? Array.from({ length: question.max - question.min + 1 }, (_, offset) => ({
                  label: String(question.min + offset),
                  count: responses.filter((row) => {
                    const r = row[question.id];
                    return r?.kind === "rating" && r.value === question.min + offset;
                  }).length,
                }))
              : [],
      };
    }),
  };
}
