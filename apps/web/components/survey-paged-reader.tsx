"use client";

import { useEffect, useRef } from "react";
import {
  surveyPageViews,
  type SurveyDraft,
  type SurveyResponses,
  type SurveyResponse,
} from "@openround/contracts/surveys";
import type { SupportedLocale } from "@openround/contracts";
import { surveyPagesCopy } from "../lib/i18n/survey-pages-copy";
import { formatNumber } from "../lib/i18n/format";
import { SurveyResponseControl } from "./survey-controls";
import styles from "./survey-paged-reader.module.css";

export function SurveyPagedReader({
  content,
  responses = {},
  pageIndex,
  locale,
  locked = false,
  closed = false,
  preview = false,
  validation = {},
  validationRevision = 0,
  dirty = false,
  onChange,
  onBack,
  onNext,
  onSave,
  onSubmit,
}: {
  content: SurveyDraft;
  responses?: SurveyResponses;
  pageIndex: number;
  locale: SupportedLocale;
  locked?: boolean;
  closed?: boolean;
  preview?: boolean;
  validation?: Record<string, "required" | "invalid">;
  validationRevision?: number;
  dirty?: boolean;
  onChange?: (id: string, response?: SurveyResponse) => void;
  onBack: () => void;
  onNext: () => void;
  onSave?: () => void;
  onSubmit?: () => void;
}) {
  const pages = surveyPageViews(content);
  const index = Math.min(Math.max(0, pageIndex), pages.length - 1);
  const page = pages[index];
  const copy = surveyPagesCopy(locale);
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const previousPage = useRef<string | null>(null);
  const pageKey = page?.id ?? `legacy-${index}`;
  const validationTarget = useRef<string | undefined>(undefined);
  validationTarget.current = page?.items.find((item) => validation[item.question.id])?.question.id;
  useEffect(() => {
    if (previousPage.current !== pageKey && (!preview || previousPage.current !== null))
      heading.current?.focus();
    previousPage.current = pageKey;
  }, [pageKey, preview]);
  useEffect(() => {
    if (!validationRevision) return;
    if (validationTarget.current)
      panel.current
        ?.querySelector<HTMLInputElement>(`[name="${validationTarget.current}"]:not(:disabled)`)
        ?.focus();
  }, [validationRevision]);
  if (!page) return null;
  const fill = (text: string, values: Record<string, string>) =>
    text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
  const numbered = {
    page: formatNumber(locale, index + 1),
    count: formatNumber(locale, pages.length),
  };
  return (
    <section
      className={styles.reader}
      data-survey-page={page.id ?? "legacy"}
      lang={locale}
      ref={panel}
    >
      <p role="status" aria-live="polite" data-survey-page-progress>
        {fill(copy.pageProgress, numbered)}
      </p>
      <h2 ref={heading} tabIndex={-1} data-survey-page-heading lang={page.title ? "" : locale}>
        {page.title || fill(copy.untitledPage, numbered)}
      </h2>
      {page.description ? (
        <p className={styles.description} lang="">
          {page.description}
        </p>
      ) : null}
      {preview ? <p className="notice">{copy.reviewOnly}</p> : null}
      {Object.keys(validation).length ? (
        <p className="error" role="alert">
          {Object.values(validation).includes("required") ? copy.requiredError : copy.invalidError}
        </p>
      ) : null}
      {page.items.map((item) => (
        <div className={`card ${styles.question}`} key={item.question.id}>
          <SurveyResponseControl
            question={item.question}
            required={item.required}
            response={responses[item.question.id]}
            disabled={preview || closed || locked}
            onChange={onChange ? (response) => onChange(item.question.id, response) : undefined}
            error={
              validation[item.question.id] === "required"
                ? copy.questionRequired
                : validation[item.question.id]
                  ? copy.questionInvalid
                  : undefined
            }
          />
        </div>
      ))}
      <div className={styles.actions} aria-label={fill(copy.pageProgress, numbered)}>
        <button
          className="button-quiet"
          type="button"
          disabled={locked || index === 0}
          onClick={onBack}
        >
          {copy.back}
        </button>
        {!preview && onSave ? (
          <button
            className="button-quiet"
            type="button"
            disabled={locked || closed || !dirty}
            onClick={onSave}
          >
            {copy.saveProgress}
          </button>
        ) : null}
        {index < pages.length - 1 ? (
          <button
            className="button"
            type={preview || closed ? "button" : "submit"}
            disabled={locked}
            onClick={(event) => {
              event.preventDefault();
              onNext();
            }}
          >
            {copy.next}
          </button>
        ) : !preview && !closed && onSubmit ? (
          <button
            className="button"
            type="submit"
            disabled={locked}
            onClick={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {copy.submit}
          </button>
        ) : null}
      </div>
    </section>
  );
}
