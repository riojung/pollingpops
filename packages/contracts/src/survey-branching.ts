import { z } from "zod";
import {
  MAX_SURVEY_PAGES,
  SurveyContentSchema,
  SurveyDraftSchema,
  SurveyPageSchema,
  SurveyResponseSchema,
  surveyPageViews,
  type SurveyDraft,
  type SurveyPageView,
} from "./surveys";

/** Conditional-page content version; authoring and publication remain separately fenced. */
export const PROPOSED_SURVEY_BRANCHING_SCHEMA_VERSION = 4;
export const MAX_SUPPORTED_SURVEY_READER_VERSION = 4;

export const SurveyPageVisibilityConditionSchema = z
  .object({
    kind: z.literal("choice_equals"),
    questionId: z.string().uuid(),
    choiceId: z.string().uuid(),
  })
  .strict();
export type SurveyPageVisibilityCondition = z.infer<typeof SurveyPageVisibilityConditionSchema>;

export const SurveyBranchingPageSchema = SurveyPageSchema.extend({
  visibleWhen: SurveyPageVisibilityConditionSchema.optional(),
}).strict();
export type SurveyBranchingPage = z.infer<typeof SurveyBranchingPageSchema>;
type PagedSurveyDraft = Extract<SurveyDraft, { schemaVersion: 3 }>;
export type SurveyBranchingDraft = Omit<PagedSurveyDraft, "schemaVersion" | "pages"> & {
  schemaVersion: 4;
  pages: SurveyBranchingPage[];
};

/** Internal validation adapter only; never downgrade or persist a document through it. */
function flatValidationInput(draft: SurveyBranchingDraft) {
  return {
    ...draft,
    schemaVersion: 3 as const,
    pages: draft.pages.map(({ visibleWhen: _condition, ...page }) => page),
  };
}

// Retain unknown top-level keys until the strict v3 parser checks them. This reuses its
// defaults, normalization, exact partition, question restrictions and 100-question bound.
export const SurveyBranchingDraftSchema = z
  .object({
    schemaVersion: z.literal(PROPOSED_SURVEY_BRANCHING_SCHEMA_VERSION),
    pages: z.array(SurveyBranchingPageSchema).min(1).max(MAX_SURVEY_PAGES),
  })
  .passthrough()
  .transform((input, ctx): SurveyBranchingDraft => {
    const base = SurveyDraftSchema.safeParse({
      ...input,
      schemaVersion: 3,
      pages: input.pages.map(({ visibleWhen: _condition, ...page }) => page),
    });
    if (!base.success) {
      for (const issue of base.error.issues)
        ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
      return z.NEVER;
    }
    if (base.data.schemaVersion !== 3) return z.NEVER;
    return {
      ...base.data,
      schemaVersion: PROPOSED_SURVEY_BRANCHING_SCHEMA_VERSION,
      pages: base.data.pages.map((page, index) => ({
        ...page,
        ...(input.pages[index]!.visibleWhen
          ? { visibleWhen: input.pages[index]!.visibleWhen }
          : {}),
      })),
    };
  })
  .superRefine((draft, ctx) => {
    const questions = new Map(draft.items.map(({ question }) => [question.id, question]));
    const pageIndices = new Map(
      draft.pages.flatMap((page, index) => page.questionIds.map((id) => [id, index] as const)),
    );
    for (const [index, page] of draft.pages.entries()) {
      const condition = page.visibleWhen;
      if (!condition) continue;
      const path = ["pages", index, "visibleWhen"];
      if (index === 0)
        ctx.addIssue({ code: "custom", path, message: "The first Survey page is always visible" });
      const question = questions.get(condition.questionId);
      const controllerPage = pageIndices.get(condition.questionId);
      if (controllerPage === undefined || controllerPage >= index)
        ctx.addIssue({
          code: "custom",
          path: [...path, "questionId"],
          message: "Page visibility must reference a question on a strictly earlier page",
        });
      if (!question || question.type !== "poll" || (question.maxSelections ?? 1) !== 1) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "questionId"],
          message: "Page visibility requires an earlier single-choice Survey poll",
        });
      } else if (!question.choices.some((choice) => choice.id === condition.choiceId)) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "choiceId"],
          message: "Page visibility must reference a choice on its controlling poll",
        });
      }
    }
  });

/** Frozen-content validation does not grant authoring or publication access. */
export const SurveyBranchingContentSchema = SurveyBranchingDraftSchema.superRefine((draft, ctx) => {
  const published = SurveyContentSchema.safeParse(flatValidationInput(draft));
  if (!published.success)
    for (const issue of published.error.issues)
      ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
});

/** Read compatibility does not expand the existing v1-v3 mutation schemas or writer grants. */
export type SurveyReadableDraft = SurveyDraft | SurveyBranchingDraft;
export const SurveyReadableDraftSchema = z.union([SurveyDraftSchema, SurveyBranchingDraftSchema]);
export const SurveyReadableContentSchema = z.union([
  SurveyContentSchema,
  SurveyBranchingContentSchema,
]);

/** Explicit creator inspection of the entire frozen document, including conditional pages. */
export function surveyReadableAllPageViews(content: SurveyReadableDraft): SurveyPageView[] {
  if (content.schemaVersion !== 4) return surveyPageViews(content);
  const items = new Map(content.items.map((item) => [item.question.id, item]));
  return content.pages.map((page) => ({
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

/** Participant pages are derived from the current answer map, never a retained branch trace. */
export function surveyReadablePageViews(
  content: SurveyReadableDraft,
  responses: unknown = {},
): SurveyPageView[] {
  const pages = surveyReadableAllPageViews(content);
  if (content.schemaVersion !== 4) return pages;
  const visible = new Set(surveyBranchingEligibility(content, responses).visiblePageIds);
  return pages.filter((page) => page.id !== null && visible.has(page.id));
}

// Inspect keys and cardinality before any response payload. Hidden malformed payloads need
// not parse as answers in order to be removed. Payload byte limits remain a future API concern.
const ResponseMapSchema = z
  .record(z.string().uuid(), z.unknown())
  .refine((responses) => Object.keys(responses).length <= 100, "Too many Survey responses");
type ResponseMap = z.infer<typeof ResponseMapSchema>;

export interface SurveyBranchingEligibility {
  visiblePageIds: string[];
  eligibleQuestionIds: string[];
}

function validResponse(question: SurveyDraft["items"][number]["question"], value: unknown) {
  const parsed = SurveyResponseSchema.safeParse(value);
  if (!parsed.success) return null;
  const response = parsed.data;
  if (question.type === "poll")
    return response.kind === "poll" &&
      response.choiceIds.length <= (question.maxSelections ?? 1) &&
      response.choiceIds.every((id) => question.choices.some((choice) => choice.id === id))
      ? response
      : null;
  return question.type === "rating" &&
    response.kind === "rating" &&
    response.value >= question.min &&
    response.value <= question.max
    ? response
    : null;
}

function eligibility(content: SurveyBranchingDraft, responses: ResponseMap) {
  const items = new Map(content.items.map((item) => [item.question.id, item]));
  const visiblePageIds: string[] = [];
  const eligibleQuestionIds: string[] = [];
  const eligible = new Set<string>();
  for (const page of content.pages) {
    const condition = page.visibleWhen;
    if (condition) {
      // Only an eligible controller with a valid singleton answer can reveal this page.
      // Answers left on hidden controller pages cannot keep descendants visible.
      if (!eligible.has(condition.questionId)) continue;
      const controller = items.get(condition.questionId)!;
      const response = validResponse(controller.question, responses[condition.questionId]);
      if (
        response?.kind !== "poll" ||
        response.choiceIds.length !== 1 ||
        response.choiceIds[0] !== condition.choiceId
      )
        continue;
    }
    visiblePageIds.push(page.id);
    for (const id of page.questionIds) {
      eligibleQuestionIds.push(id);
      eligible.add(id);
    }
  }
  return { visiblePageIds, eligibleQuestionIds };
}

/** Eligibility on a parsed document; this calculation does not grant room access. */
export function surveyBranchingEligibility(content: SurveyBranchingDraft, responses: unknown) {
  return eligibility(content, ResponseMapSchema.parse(responses));
}

export interface SurveyBranchingReconciliation extends SurveyBranchingEligibility {
  /** Raw eligible/unknown values still require separate validation before any submission. */
  responses: Record<string, unknown>;
  clearedQuestionIds: string[];
}

/**
 * Explicit cleanup, never submission approval. Remove known hidden answers without inspecting
 * their payloads. Keep unknown IDs and malformed eligible values for validation to reject.
 * Call on each branch change; once removed, answers do not reappear when a path is reopened.
 */
export function reconcileSurveyBranchingResponses(
  content: SurveyBranchingDraft,
  responses: unknown,
): SurveyBranchingReconciliation {
  const raw = ResponseMapSchema.parse(responses);
  const result = eligibility(content, raw);
  const known = new Set(content.items.map((item) => item.question.id));
  const eligible = new Set(result.eligibleQuestionIds);
  const retained: Record<string, unknown> = {};
  const clearedQuestionIds: string[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (known.has(id) && !eligible.has(id)) clearedQuestionIds.push(id);
    else retained[id] = structuredClone(value);
  }
  return { ...result, responses: retained, clearedQuestionIds };
}

export type SurveyBranchingResponseIssueCode =
  | "invalid_response_map"
  | "unknown_question"
  | "ineligible_response"
  | "invalid_response"
  | "required"
  | "unknown_page"
  | "ineligible_page";
export interface SurveyBranchingResponseIssue {
  code: SurveyBranchingResponseIssueCode;
  questionId?: string;
  pageId?: string;
}

function responseIssues(content: SurveyBranchingDraft, raw: ResponseMap, final: boolean) {
  const result = eligibility(content, raw);
  const eligible = new Set(result.eligibleQuestionIds);
  const items = new Map(content.items.map((item) => [item.question.id, item]));
  const issues: SurveyBranchingResponseIssue[] = [];
  for (const [questionId, value] of Object.entries(raw)) {
    const item = items.get(questionId);
    if (!item) issues.push({ code: "unknown_question", questionId });
    else if (!eligible.has(questionId)) issues.push({ code: "ineligible_response", questionId });
    else if (!validResponse(item.question, value))
      issues.push({ code: "invalid_response", questionId });
  }
  if (final)
    for (const item of content.items)
      if (eligible.has(item.question.id) && item.required && !Object.hasOwn(raw, item.question.id))
        issues.push({ code: "required", questionId: item.question.id });
  return issues;
}

/** Pure validation never clears answers. Hidden or unknown entries must not be submitted. */
export function validateSurveyBranchingResponses(
  content: SurveyBranchingDraft,
  responses: unknown,
  final: boolean,
): SurveyBranchingResponseIssue[] {
  const raw = ResponseMapSchema.safeParse(responses);
  return raw.success
    ? responseIssues(content, raw.data, final)
    : [{ code: "invalid_response_map" }];
}

/** Validate the full response map plus only the current visible page's required fields. */
export function validateSurveyBranchingPageResponses(
  content: SurveyBranchingDraft,
  responses: unknown,
  pageId: string,
): SurveyBranchingResponseIssue[] {
  const raw = ResponseMapSchema.safeParse(responses);
  if (!raw.success) return [{ code: "invalid_response_map" }];
  const issues = responseIssues(content, raw.data, false);
  const page = content.pages.find((candidate) => candidate.id === pageId);
  if (!page) return [...issues, { code: "unknown_page", pageId }];
  if (!eligibility(content, raw.data).visiblePageIds.includes(pageId))
    return [...issues, { code: "ineligible_page", pageId }];
  for (const item of content.items)
    if (
      page.questionIds.includes(item.question.id) &&
      item.required &&
      !Object.hasOwn(raw.data, item.question.id)
    )
      issues.push({ code: "required", questionId: item.question.id });
  return issues;
}

export type SurveyBranchingQuestionState = "skipped_logic" | "unanswered" | "invalid" | "answered";

/** Internal question-state projection only; no answer values or reporting payload. */
export function surveyBranchingQuestionStates(content: SurveyBranchingDraft, responses: unknown) {
  const raw = ResponseMapSchema.parse(responses);
  const eligible = new Set(eligibility(content, raw).eligibleQuestionIds);
  return content.items.map(
    ({ question }): { questionId: string; state: SurveyBranchingQuestionState } => ({
      questionId: question.id,
      state: !eligible.has(question.id)
        ? "skipped_logic"
        : !Object.hasOwn(raw, question.id)
          ? "unanswered"
          : validResponse(question, raw[question.id])
            ? "answered"
            : "invalid",
    }),
  );
}

/** Resume hint: earliest visible page with an unanswered/invalid item, including optional ones. */
export function surveyBranchingResumePageId(content: SurveyBranchingDraft, responses: unknown) {
  const raw = ResponseMapSchema.parse(responses);
  const visible = new Set(eligibility(content, raw).visiblePageIds);
  const items = new Map(content.items.map((item) => [item.question.id, item]));
  const pages = content.pages.filter((page) => visible.has(page.id));
  return (
    pages.find((page) =>
      page.questionIds.some((id) => !validResponse(items.get(id)!.question, raw[id])),
    ) ?? pages[pages.length - 1]!
  ).id;
}

/**
 * Hidden/stale cursors return to the response-derived resume page. Callers must validate the
 * current page and persist cleanup before advancing.
 */
export function surveyBranchingPageNavigation(
  content: SurveyBranchingDraft,
  responses: unknown,
  pageId: string,
) {
  const pages = surveyBranchingEligibility(content, responses).visiblePageIds;
  const currentPageId = pages.includes(pageId)
    ? pageId
    : surveyBranchingResumePageId(content, responses);
  const index = pages.indexOf(currentPageId);
  return {
    currentPageId,
    previousPageId: pages[index - 1] ?? null,
    nextPageId: pages[index + 1] ?? null,
  };
}
