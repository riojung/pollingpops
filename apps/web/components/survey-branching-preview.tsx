"use client";

import { useState } from "react";
import type { SupportedLocale } from "@openround/contracts";
import type { SurveyBranchingDraft } from "@openround/contracts/survey-branching";
import { surveyBranchingCopy } from "../lib/i18n/survey-branching-copy";
import { surveyPageAuthoringCopy } from "../lib/i18n/survey-page-authoring-copy";
import { SurveyPagedReader } from "./survey-paged-reader";

/** Creator inspection includes hidden pages without simulating or recording participant answers. */
export function SurveyBranchingPreview({
  draft,
  locale,
}: {
  draft: SurveyBranchingDraft;
  locale: SupportedLocale;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const copy = surveyBranchingCopy(locale);
  const page = draft.pages[Math.min(pageIndex, draft.pages.length - 1)]!;
  const condition = page.visibleWhen;
  const controller = condition
    ? draft.items.find((item) => item.question.id === condition.questionId)?.question
    : undefined;
  const choice =
    controller?.type === "poll"
      ? controller.choices.find((value) => value.id === condition?.choiceId)
      : undefined;
  return (
    <section className="card" lang={locale} data-survey-branching-readonly>
      <h2>{surveyPageAuthoringCopy(locale).readonlyTitle}</h2>
      <p className="notice">{copy.readOnly}</p>
      <p lang="">{draft.description}</p>
      {condition ? (
        <aside className="notice" aria-label={copy.condition}>
          <p>{copy.condition}</p>
          <p lang="">
            {controller?.prompt} → <strong>{choice?.label}</strong>
          </p>
        </aside>
      ) : (
        <p>{copy.always}</p>
      )}
      <SurveyPagedReader
        content={draft}
        pageIndex={pageIndex}
        locale={locale}
        preview
        inspectAllPages
        onBack={() => setPageIndex((index) => Math.max(0, index - 1))}
        onNext={() => setPageIndex((index) => Math.min(draft.pages.length - 1, index + 1))}
      />
    </section>
  );
}
