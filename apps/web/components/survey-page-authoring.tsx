"use client";

import { useEffect, useRef, useState } from "react";
import type { SupportedLocale } from "@openround/contracts";
import { MAX_SURVEY_PAGES } from "@openround/contracts/surveys";
import { formatNumber } from "../lib/i18n/format";
import { surveyPageAuthoringCopy } from "../lib/i18n/survey-page-authoring-copy";
import { surveyPagesCopy } from "../lib/i18n/survey-pages-copy";
import {
  addSurveyPage,
  addSurveyPageQuestion,
  moveSurveyPage,
  moveSurveyPageQuestion,
  removeSurveyPage,
  removeSurveyPageQuestion,
  surveyPageRemovalTarget,
  updateSurveyPage,
  updateSurveyPageQuestion,
  type PagedSurveyDraft,
} from "../lib/survey-page-authoring";
import { newSurveyQuestion, SurveyQuestionEditor } from "./survey-controls";
import { SurveyPagedReader } from "./survey-paged-reader";
import styles from "./survey-page-authoring.module.css";

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

export function SurveyPageAuthoring({
  draft,
  disabled,
  locale,
  onChange,
}: {
  draft: PagedSurveyDraft;
  disabled: boolean;
  locale: SupportedLocale;
  onChange: (draft: PagedSurveyDraft) => void;
}) {
  const copy = surveyPageAuthoringCopy(locale);
  const readerCopy = surveyPagesCopy(locale);
  const [selectedId, setSelectedId] = useState(draft.pages[0]!.id);
  const [preview, setPreview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const index = Math.max(
    0,
    draft.pages.findIndex((page) => page.id === selectedId),
  );
  const page = draft.pages[index]!;
  useEffect(() => {
    if (mounted.current && !preview) heading.current?.focus();
    mounted.current = true;
  }, [page.id, preview]);
  const items = page.questionIds.map((id) => draft.items.find((item) => item.question.id === id)!);
  const title = (pageId: string) => {
    const offset = draft.pages.findIndex((page) => page.id === pageId);
    return (
      draft.pages[offset]!.title.trim() ||
      fill(readerCopy.untitledPage, { page: formatNumber(locale, offset + 1) })
    );
  };
  const change = (next: PagedSurveyDraft) => {
    if (!disabled) onChange(next);
  };
  return (
    <section className={styles.editor} data-survey-page-authoring lang={locale}>
      <h2>{copy.pagesTitle}</h2>
      <nav aria-label={copy.pagesNavigation}>
        <ol className={styles.pages}>
          {draft.pages.map((entry) => (
            <li key={entry.id} data-survey-author-page={entry.id}>
              <button
                className="button-quiet"
                type="button"
                aria-current={page.id === entry.id ? "page" : undefined}
                title={title(entry.id)}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className={styles.titleSummary} lang={entry.title.trim() ? "" : locale}>
                  {title(entry.id)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className={styles.actions}>
        <button
          className="button-quiet"
          type="button"
          disabled={disabled || draft.pages.length >= MAX_SURVEY_PAGES}
          onClick={() => {
            const next = addSurveyPage(draft);
            change(next);
            setSelectedId(next.pages.at(-1)!.id);
            setPreview(false);
          }}
        >
          {copy.addPage}
        </button>
        <button className="button-quiet" type="button" onClick={() => setPreview(!preview)}>
          {preview ? copy.editorToggle : copy.preview}
        </button>
      </div>
      {draft.pages.length >= MAX_SURVEY_PAGES ? (
        <p className="notice">
          {fill(copy.pageLimit, { count: formatNumber(locale, MAX_SURVEY_PAGES) })}
        </p>
      ) : null}
      {preview ? (
        <SurveyPagedReader
          content={draft}
          pageIndex={index}
          locale={locale}
          preview
          onBack={() => setSelectedId(draft.pages[index - 1]!.id)}
          onNext={() => setSelectedId(draft.pages[index + 1]!.id)}
        />
      ) : (
        <div className={styles.selected} data-survey-selected-page={page.id}>
          <h3
            className={styles.titleSummary}
            ref={heading}
            tabIndex={-1}
            title={title(page.id)}
            lang={page.title.trim() ? "" : locale}
          >
            {title(page.id)}
          </h3>
          <fieldset disabled={disabled}>
            <legend>{copy.pagesTitle}</legend>
            <label className="field">
              {copy.pageTitle}
              <input
                className="input"
                maxLength={160}
                value={page.title}
                onChange={(event) =>
                  change(updateSurveyPage(draft, page.id, { title: event.target.value }))
                }
              />
            </label>
            <label className="field">
              {copy.pageInstructions}
              <textarea
                className="input"
                maxLength={1000}
                value={page.description}
                onChange={(event) =>
                  change(updateSurveyPage(draft, page.id, { description: event.target.value }))
                }
              />
            </label>
            <div className={styles.actions}>
              <button
                className="button-quiet"
                type="button"
                disabled={disabled || index === 0}
                onClick={() => change(moveSurveyPage(draft, page.id, -1))}
              >
                {copy.movePageUp}
              </button>
              <button
                className="button-quiet"
                type="button"
                disabled={disabled || index === draft.pages.length - 1}
                onClick={() => change(moveSurveyPage(draft, page.id, 1))}
              >
                {copy.movePageDown}
              </button>
              <button
                className="button-quiet"
                type="button"
                disabled={disabled || draft.pages.length === 1}
                onClick={() => {
                  const target = surveyPageRemovalTarget(draft, page.id);
                  if (
                    !target ||
                    !window.confirm(fill(copy.removePageConfirm, { destination: title(target.id) }))
                  )
                    return;
                  change(removeSurveyPage(draft, page.id));
                  setSelectedId(target.id);
                }}
              >
                {copy.removePage}
              </button>
            </div>
          </fieldset>
          {draft.pages.length === 1 ? <p>{copy.lastPageNotice}</p> : null}
          {!items.length ? (
            <p className="notice" data-survey-empty-page>
              {copy.emptyPageNotice}
            </p>
          ) : null}
          <div role="group" aria-label={copy.pageQuestions} className={styles.questions}>
            {items.map((item, questionIndex) => {
              const questionLabel = fill(copy.questionLabel, {
                question: formatNumber(locale, questionIndex + 1),
              });
              return (
                <section
                  className={`card ${styles.question}`}
                  key={item.question.id}
                  data-survey-author-question={item.question.id}
                >
                  <h4>{questionLabel}</h4>
                  <div lang="en-CA">
                    <SurveyQuestionEditor
                      question={item.question}
                      disabled={disabled}
                      onChange={(question) =>
                        change(
                          updateSurveyPageQuestion(draft, item.question.id, { ...item, question }),
                        )
                      }
                    />
                  </div>
                  <label className="field">
                    <input
                      type="checkbox"
                      checked={item.required}
                      disabled={disabled}
                      onChange={(event) =>
                        change(
                          updateSurveyPageQuestion(draft, item.question.id, {
                            ...item,
                            required: event.target.checked,
                          }),
                        )
                      }
                    />
                    {copy.requiredResponse}
                  </label>
                  <label className="field">
                    {copy.moveQuestionToPage}
                    <select
                      className="input"
                      aria-label={`${copy.moveQuestionToPage}: ${questionLabel}`}
                      value={page.id}
                      disabled={disabled || draft.pages.length < 2}
                      onChange={(event) => {
                        change(moveSurveyPageQuestion(draft, item.question.id, event.target.value));
                        heading.current?.focus();
                      }}
                    >
                      {draft.pages.map((destination) => (
                        <option key={destination.id} value={destination.id}>
                          {title(destination.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.actions}>
                    <button
                      className="button-quiet"
                      type="button"
                      disabled={disabled || questionIndex === 0}
                      onClick={() =>
                        change(
                          moveSurveyPageQuestion(
                            draft,
                            item.question.id,
                            page.id,
                            questionIndex - 1,
                          ),
                        )
                      }
                    >
                      {copy.moveQuestionUp}
                    </button>
                    <button
                      className="button-quiet"
                      type="button"
                      disabled={disabled || questionIndex === items.length - 1}
                      onClick={() =>
                        change(
                          moveSurveyPageQuestion(
                            draft,
                            item.question.id,
                            page.id,
                            questionIndex + 1,
                          ),
                        )
                      }
                    >
                      {copy.moveQuestionDown}
                    </button>
                    <button
                      className="button-quiet"
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (window.confirm(copy.removeQuestionConfirm)) {
                          change(removeSurveyPageQuestion(draft, item.question.id));
                          heading.current?.focus();
                        }
                      }}
                    >
                      {copy.removeQuestion}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
          <div className={styles.actions}>
            {(["poll", "rating"] as const).map((type) => (
              <button
                className="button-quiet"
                type="button"
                key={type}
                disabled={disabled || draft.items.length >= 100}
                onClick={() =>
                  change(
                    addSurveyPageQuestion(draft, page.id, {
                      required: true,
                      question: newSurveyQuestion(type, locale),
                    }),
                  )
                }
              >
                {type === "poll" ? copy.addPoll : copy.addRating}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
