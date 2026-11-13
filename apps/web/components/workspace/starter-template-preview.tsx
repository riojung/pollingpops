"use client";

import { useEffect, useRef } from "react";
import {
  questionTypeDefinition,
  type QuizDraft,
  type StarterGuide,
  type SupportedLocale,
} from "@openround/contracts";
import type { SurveyDraft } from "@openround/contracts/surveys";
import { templateGuideCopy } from "../../lib/i18n/template-guide-copy";
import { handleModalKeyDown } from "../presentation/presentation-modal-focus";
import { TemplateGuide } from "./template-guide";
import styles from "./template-guide.module.css";

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
}: {
  id: string;
  content: StarterPreviewContent;
  guide?: StarterGuide;
  contentLocale: SupportedLocale;
  uiLocale: SupportedLocale;
  closeLabel: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const copy = templateGuideCopy(uiLocale);
  const items =
    content.kind === "round"
      ? content.draft.questions.map((question) => ({ question, required: undefined }))
      : content.draft.items;
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return () => {
      node?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      id={`starter-preview-${id}`}
      className={styles.dialog}
      aria-label={content.draft.title}
      lang={uiLocale}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => handleModalKeyDown(event, onClose)}
    >
      <header className={styles.header}>
        <div>
          <h2 lang={contentLocale}>{content.draft.title}</h2>
          <p lang={contentLocale}>{content.draft.description}</p>
        </div>
        <button className="button-quiet" type="button" onClick={onClose}>
          {closeLabel}
        </button>
      </header>
      <div className={styles.layout} data-guide={Boolean(guide)}>
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
                {content.kind === "round" && knowledge ? (
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
    </dialog>
  );
}
