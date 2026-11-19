import { z } from "zod";
import { isTextOpinionQuestion } from "./text-opinions";
import {
  QuestionDraftSchema,
  QuizContentSchema,
  RoundCategorySchema,
  ExperiencePresetRefSchema,
  RoomPasswordSchema,
} from "./index";

/** Surveys are separate, unscored artifacts. They never enter the learning engine. */
export const CURRENT_SURVEY_SCHEMA_VERSION = 2;
/** Expand readers before enabling page authoring. Ordinary factories still write v2. */
export const MAX_SUPPORTED_SURVEY_SCHEMA_VERSION = 3;
export const SURVEY_READER_HEADER = "x-pollingpops-survey-schema";
export const MAX_SURVEY_PAGES = 20;

export const SurveyPageSchema = z
  .object({
    id: z.string().uuid().toLowerCase(),
    title: z.string().trim().max(160).default(""),
    description: z.string().trim().max(1000).default(""),
    questionIds: z.array(z.string().uuid()).max(100),
  })
  .strict();
export type SurveyPage = z.infer<typeof SurveyPageSchema>;
// Selection limits are Survey-specific until live client capability negotiation ships.
export const SurveyQuestionDraftSchema = QuestionDraftSchema.and(
  z.object({ maxSelections: z.number().int().min(1).max(6).optional() }),
).superRefine((question, ctx) => {
  if (question.type === "ranking" || isTextOpinionQuestion(question)) {
    ctx.addIssue({
      code: "custom",
      message: "Rankings currently support live Rounds only",
      path: ["type"],
    });
  }
  if (question.maxSelections === undefined) return;
  if (question.type !== "poll" || question.maxSelections > question.choices.length) {
    ctx.addIssue({
      code: "custom",
      path: ["maxSelections"],
      message: "Only polls may set a selection limit, between one and the number of options",
    });
  }
});
export type SurveyQuestionDraft = z.infer<typeof SurveyQuestionDraftSchema>;

// Keep the legacy parsed key order: accepted request hashes include its JSON representation.
const surveyShape = {
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  title: z.string().trim().max(160),
  description: z.string().trim().max(1000).default(""),
  category: RoundCategorySchema.default("general"),
  experiencePreset: ExperiencePresetRefSchema.default({ id: "focus", version: 1 }),
  items: z.array(z.object({ required: z.boolean(), question: SurveyQuestionDraftSchema })).max(100),
};
const flatSurveySchema = z.object(surveyShape).strict();
const pagedSurveySchema = z
  .object({
    ...surveyShape,
    schemaVersion: z.literal(3),
    pages: z.array(SurveyPageSchema).min(1).max(MAX_SURVEY_PAGES),
  })
  .strict();

export const SurveyDraftSchema = z
  .discriminatedUnion("schemaVersion", [flatSurveySchema, pagedSurveySchema])
  .superRefine((draft, ctx) => {
    for (const [index, { question }] of draft.items.entries()) {
      if (draft.schemaVersion === 1 && (question.maxSelections ?? 1) > 1) {
        ctx.addIssue({
          code: "custom",
          path: ["schemaVersion"],
          message: "Multiple-selection Survey polls require schema version 2",
        });
      }
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
    if (draft.schemaVersion === 3) {
      if (new Set(draft.pages.map((page) => page.id)).size !== draft.pages.length)
        ctx.addIssue({
          code: "custom",
          path: ["pages"],
          message: "Survey page IDs must be unique",
        });
      const pageQuestions = draft.pages.flatMap((page) => page.questionIds);
      if (
        pageQuestions.length !== draft.items.length ||
        pageQuestions.some((id, index) => id !== draft.items[index]?.question.id)
      )
        ctx.addIssue({
          code: "custom",
          path: ["pages"],
          message: "Pages must contain every Survey question exactly once, in question order",
        });
    }
  });
export type SurveyDraft = z.infer<typeof SurveyDraftSchema>;
/** Explicit reader upgrade: unknown future versions fail instead of losing fields. */
export function upgradeSurveyDraft(value: unknown): SurveyDraft {
  const parsed = SurveyDraftSchema.parse(value);
  return parsed.schemaVersion === 3
    ? parsed
    : { ...parsed, schemaVersion: CURRENT_SURVEY_SCHEMA_VERSION };
}
export const SurveyContentSchema = SurveyDraftSchema.superRefine((draft, ctx) => {
  if (draft.schemaVersion === 3)
    for (const [index, page] of draft.pages.entries()) {
      if (!page.questionIds.length)
        ctx.addIssue({
          code: "custom",
          path: ["pages", index, "questionIds"],
          message: "Add at least one question to every Survey page before publishing",
        });
    }
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

export interface SurveyPageView {
  /** Null identifies the virtual single page of a legacy Survey; it is never stored. */
  id: string | null;
  title: string;
  description: string;
  items: SurveyDraft["items"];
}

/** Page layout is a reader projection; legacy documents and response identities stay intact. */
export function surveyPageViews(draft: SurveyDraft): SurveyPageView[] {
  if (draft.schemaVersion !== 3)
    return [{ id: null, title: "", description: "", items: draft.items }];
  const items = new Map(draft.items.map((item) => [item.question.id, item]));
  return draft.pages.map((page) => ({
    id: page.id,
    title: page.title,
    description: page.description,
    items: page.questionIds.map((id) => {
      const item = items.get(id);
      if (!item) throw new Error("Survey page references an unknown question");
      return item;
    }),
  }));
}
export const SurveyResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("poll"),
      choiceIds: z
        .array(z.string().uuid())
        .min(1)
        .max(6)
        .refine((ids) => new Set(ids).size === ids.length, "Select each option at most once")
        .transform((ids) => [...ids].sort()),
    })
    .strict(),
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
    joinPassword: RoomPasswordSchema.optional(),
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
          response.choiceIds.length <= (question.maxSelections ?? 1) &&
          response.choiceIds.every((id) => question.choices.some((c) => c.id === id))
        : question.type === "rating" &&
          response.kind === "rating" &&
          response.value >= question.min &&
          response.value <= question.max;
    if (!valid) issues.push(`Question ${index + 1}: select a valid response`);
  }
  return issues;
}

/** Next-page validation adds only that page's required fields; final submission checks all. */
export function validateSurveyPageResponses(
  content: SurveyDraft,
  responses: SurveyResponses,
  pageId: string | null,
) {
  const page = surveyPageViews(content).find((candidate) => candidate.id === pageId);
  if (!page) return ["Choose a valid Survey page"];
  const issues = validateSurveyResponses(content, responses, false);
  for (const item of page.items) {
    if (item.required && !responses[item.question.id]) {
      const index = content.items.findIndex(
        (candidate) => candidate.question.id === item.question.id,
      );
      issues.push(`Question ${index + 1}: a response is required`);
    }
  }
  return issues;
}

/** Resume hint from saved answers, including optional unanswered items; no visit tracking. */
export function surveyResumePageIndex(content: SurveyDraft, responses: SurveyResponses) {
  const pages = surveyPageViews(content);
  const index = pages.findIndex((page) => page.items.some((item) => !responses[item.question.id]));
  return index < 0 ? pages.length - 1 : index;
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
    schemaVersion: 2 as const,
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
        maxSelections: question.type === "poll" ? (question.maxSelections ?? 1) : undefined,
        percentBasis: "respondents" as const,
        suppressed: questionSuppressed,
        answeredCount: questionSuppressed ? null : answeredCount,
        distribution: questionSuppressed
          ? []
          : question.type === "poll"
            ? question.choices.map((choice) => ({
                label: choice.label,
                count: responses.filter((row) => {
                  const r = row[question.id];
                  return r?.kind === "poll" && r.choiceIds.includes(choice.id);
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
