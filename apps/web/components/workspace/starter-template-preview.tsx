"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  questionTypeDefinition,
  type QuizDraft,
  type StarterGuide,
  type SupportedLocale,
} from "@openround/contracts";
import type { SurveyDraft } from "@openround/contracts/surveys";
import { templateGuideCopy } from "../../lib/i18n/template-guide-copy";
import { starterPreviewCopy } from "../../lib/i18n/starter-preview-copy";
import { handleModalKeyDown } from "../presentation/presentation-modal-focus";
import { TemplateGuide } from "./template-guide";
import styles from "./template-guide.module.css";
import previewStyles from "./starter-template-preview.module.css";

export type StarterPreviewContent =
  { kind: "round"; draft: QuizDraft } | { kind: "survey"; draft: SurveyDraft };

export function StarterTemplatePreview({
  id,
  content,
  guide,
  contentLocale,
  uiLocale,
  closeLabel,
  onClose,
  mode = "dialog",
  title,
  description,
  loading = false,
  error,
  onRetry,
  metadata,
  useLabel,
  onUse,
  useDisabled = false,
  readOnlyLabel,
  actionError,
  reveal = false,
}: {
  id: string;
  content?: StarterPreviewContent;
  guide?: StarterGuide;
  contentLocale: SupportedLocale;
  uiLocale: SupportedLocale;
  closeLabel: string;
  onClose: () => void;
  mode?: "dialog" | "panel";
  title?: string;
  description?: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  metadata?: ReactNode;
  useLabel?: string;
  onUse?: () => void;
  useDisabled?: boolean;
  readOnlyLabel?: string;
  actionError?: string;
  reveal?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const copy = templateGuideCopy(uiLocale);
  const previewCopy = starterPreviewCopy(uiLocale);
  const items =
    content?.kind === "round"
      ? content.draft.questions.map((question) => ({ question, required: undefined }))
      : (content?.draft.items ?? []);
  useEffect(() => {
    if (mode !== "dialog") return;
    const node = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return () => {
      node?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [mode]);
  useEffect(() => {
    if (mode !== "panel" || !reveal) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [mode, id, reveal]);
  const headingId = `starter-preview-title-${id}`;
  const body = (
    <>
      <header className={styles.header}>
        <div>
          <span className={previewStyles.eyebrow}>{previewCopy.preview}</span>
          <h2
            ref={heading}
            id={headingId}
            lang={contentLocale}
            tabIndex={mode === "panel" ? -1 : undefined}
          >
            {content?.draft.title ?? title}
          </h2>
          <p lang={contentLocale}>{content?.draft.description ?? description}</p>
          {metadata}
        </div>
        {mode === "dialog" ? (
          <button className="button-quiet" type="button" onClick={onClose}>
            {closeLabel}
          </button>
        ) : null}
      </header>
      <div className={previewStyles.useBar}>
        <p>{onUse ? previewCopy.copyNote : previewCopy.previewOnly}</p>
        {onUse ? (
          <button
            className="button"
            type="button"
            disabled={useDisabled || loading || !content || Boolean(error)}
            onClick={onUse}
          >
            {useLabel}
          </button>
        ) : readOnlyLabel ? (
          <p role="status">{readOnlyLabel}</p>
        ) : null}
      </div>
      {actionError ? (
        <div className={previewStyles.error} role="alert">
          <p>{previewCopy.actionError}</p>
          <details>
            <summary>{previewCopy.details}</summary>
            <p lang="en-CA">{actionError}</p>
          </details>
        </div>
      ) : null}
      {loading ? (
        <p className={previewStyles.loading} role="status">
          {previewCopy.loading}
        </p>
      ) : error ? (
        <div className={previewStyles.error} role="alert">
          <p>{previewCopy.loadError}</p>
          <details>
            <summary>{previewCopy.details}</summary>
            <p lang="en-CA">{error}</p>
          </details>
          {onRetry ? (
            <button className="button-quiet" type="button" onClick={onRetry}>
              {previewCopy.retry}
            </button>
          ) : null}
        </div>
      ) : (
        <div
          className={styles.layout}
          data-guide={Boolean(guide)}
          data-panel={mode === "panel" || undefined}
        >
          {guide ? (
            <TemplateGuide guide={guide} uiLocale={uiLocale} contentLocale={contentLocale} />
          ) : null}
          <ol className={styles.questions} lang={contentLocale}>
            {items.map(({ question, required }) => {
              const knowledge =
                questionTypeDefinition(question.type).scored && question.purpose !== "opinion";
              const correct =
                knowledge && "choices" in question
                  ? question.choices
                      .filter((choice) => choice.isCorrect)
                      .map((choice) => choice.label)
                  : [];
              return (
                <li key={question.id}>
                  <h3>{question.prompt}</h3>
                  {required !== undefined ? (
                    <span className={styles.requirement} lang={uiLocale}>
                      {copy(required ? "Required" : "Optional")}
                    </span>
                  ) : null}
                  {"choices" in question ? (
                    <ul>
                      {question.choices.map((choice) => (
                        <li key={choice.id}>{choice.label}</li>
                      ))}
                    </ul>
                  ) : question.type === "rating" ? (
                    <p>
                      {question.min} — {question.minLabel} / {question.max} — {question.maxLabel}
                    </p>
                  ) : null}
                  {content?.kind === "round" && knowledge ? (
                    <div className={styles.answer}>
                      <p>
                        <strong lang={uiLocale}>{copy("Correct answer")}: </strong>
                        {question.type === "numeric"
                          ? `${question.correctValue}${question.unit ? ` ${question.unit}` : ""}`
                          : correct.join(" · ")}
                      </p>
                      {question.explanation ? (
                        <p>
                          <strong lang={uiLocale}>{copy("Why this answer")}: </strong>
                          {question.explanation}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </>
  );
  return mode === "panel" ? (
    <section
      id={`starter-preview-${id}`}
      className={previewStyles.panel}
      aria-labelledby={headingId}
      aria-busy={loading}
      lang={uiLocale}
    >
      {body}
    </section>
  ) : (
    <dialog
      ref={dialog}
      id={`starter-preview-${id}`}
      className={styles.dialog}
      aria-labelledby={headingId}
      aria-busy={loading}
      lang={uiLocale}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => handleModalKeyDown(event, onClose)}
    >
      {body}
    </dialog>
  );
}
