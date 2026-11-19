import type { SurveyDraft, SurveyPage } from "@openround/contracts/surveys";
import { MAX_SURVEY_PAGES } from "@openround/contracts/surveys";
import { surveyMutationKey } from "./survey-client";

export type PagedSurveyDraft = Extract<SurveyDraft, { schemaVersion: 3 }>;
export type SurveyDraftItem = SurveyDraft["items"][number];

/** Every layout change also updates flat item order; neither representation is secondary. */
function layout(
  draft: PagedSurveyDraft,
  pages: SurveyPage[],
  items = draft.items,
): PagedSurveyDraft {
  const byId = new Map(items.map((item) => [item.question.id, item]));
  const ids = pages.flatMap((page) => page.questionIds);
  if (
    !pages.length ||
    pages.length > MAX_SURVEY_PAGES ||
    items.length > 100 ||
    new Set(pages.map((page) => page.id)).size !== pages.length ||
    byId.size !== items.length ||
    new Set(ids).size !== ids.length ||
    ids.length !== items.length ||
    ids.some((id) => !byId.has(id))
  )
    throw new Error("Survey pages must contain every question exactly once");
  return { ...draft, pages, items: ids.map((id) => byId.get(id)!) };
}

function pageAt(draft: PagedSurveyDraft, pageId: string) {
  const index = draft.pages.findIndex((page) => page.id === pageId);
  if (index < 0) throw new Error("Survey page not found");
  return index;
}

export function convertSurveyToPages(
  draft: SurveyDraft,
  pageId = surveyMutationKey(),
): PagedSurveyDraft {
  if (draft.schemaVersion === 3) return draft;
  return {
    ...draft,
    schemaVersion: 3,
    pages: [
      {
        id: pageId,
        title: "",
        description: "",
        questionIds: draft.items.map((item) => item.question.id),
      },
    ],
  };
}

export function updateSurveyPage(
  draft: PagedSurveyDraft,
  pageId: string,
  fields: Pick<Partial<SurveyPage>, "title" | "description">,
): PagedSurveyDraft {
  pageAt(draft, pageId);
  return {
    ...draft,
    pages: draft.pages.map((page) => (page.id === pageId ? { ...page, ...fields } : page)),
  };
}

export function addSurveyPage(draft: PagedSurveyDraft, pageId = surveyMutationKey()) {
  return layout(draft, [
    ...draft.pages,
    { id: pageId, title: "", description: "", questionIds: [] },
  ]);
}

export function moveSurveyPage(draft: PagedSurveyDraft, pageId: string, direction: -1 | 1) {
  const index = pageAt(draft, pageId);
  const target = index + direction;
  if (target < 0 || target >= draft.pages.length) return draft;
  const pages = [...draft.pages];
  [pages[index], pages[target]] = [pages[target]!, pages[index]!];
  return layout(draft, pages);
}

export function surveyPageRemovalTarget(draft: PagedSurveyDraft, pageId: string) {
  const index = pageAt(draft, pageId);
  return draft.pages.length === 1 ? null : draft.pages[index > 0 ? index - 1 : 1]!;
}

/** Removing layout never removes questions: merge into the previous page, or the next first page. */
export function removeSurveyPage(draft: PagedSurveyDraft, pageId: string) {
  const index = pageAt(draft, pageId);
  const source = draft.pages[index]!;
  const target = surveyPageRemovalTarget(draft, pageId);
  if (!target) return draft;
  return layout(
    draft,
    draft.pages
      .filter((page) => page.id !== pageId)
      .map((page) =>
        page.id !== target.id
          ? page
          : {
              ...page,
              questionIds:
                index === 0
                  ? [...source.questionIds, ...page.questionIds]
                  : [...page.questionIds, ...source.questionIds],
            },
      ),
  );
}

export function addSurveyPageQuestion(
  draft: PagedSurveyDraft,
  pageId: string,
  item: SurveyDraftItem,
) {
  pageAt(draft, pageId);
  return layout(
    draft,
    draft.pages.map((page) =>
      page.id === pageId ? { ...page, questionIds: [...page.questionIds, item.question.id] } : page,
    ),
    [...draft.items, item],
  );
}

export function updateSurveyPageQuestion(
  draft: PagedSurveyDraft,
  questionId: string,
  item: SurveyDraftItem,
) {
  if (questionId !== item.question.id || !draft.items.some((row) => row.question.id === questionId))
    throw new Error("Survey question identity cannot change");
  return {
    ...draft,
    items: draft.items.map((row) => (row.question.id === questionId ? item : row)),
  };
}

export function removeSurveyPageQuestion(draft: PagedSurveyDraft, questionId: string) {
  return layout(
    draft,
    draft.pages.map((page) => ({
      ...page,
      questionIds: page.questionIds.filter((id) => id !== questionId),
    })),
    draft.items.filter((item) => item.question.id !== questionId),
  );
}

/** Omitting index appends to the destination. Within-page moves use the final desired index. */
export function moveSurveyPageQuestion(
  draft: PagedSurveyDraft,
  questionId: string,
  targetId: string,
  index?: number,
) {
  pageAt(draft, targetId);
  if (!draft.items.some((item) => item.question.id === questionId))
    throw new Error("Survey question not found");
  return layout(
    draft,
    draft.pages.map((page) => {
      const questionIds = page.questionIds.filter((id) => id !== questionId);
      if (page.id === targetId)
        questionIds.splice(
          Math.min(Math.max(index ?? questionIds.length, 0), questionIds.length),
          0,
          questionId,
        );
      return { ...page, questionIds };
    }),
  );
}
