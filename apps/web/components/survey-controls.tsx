"use client";

import type { SurveyQuestionDraft, SurveyResponse } from "@openround/contracts/surveys";
import { surveyMutationKey } from "../lib/survey-client";
import styles from "./survey-controls.module.css";

export function newSurveyQuestion(type: "poll" | "rating"): SurveyQuestionDraft {
  const common = {
    id: surveyMutationKey(),
    prompt: "",
    purpose: "opinion" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    basePoints: 0,
    timeLimitSeconds: 30,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  return type === "poll"
    ? {
        ...common,
        type,
        choices: ["Option 1", "Option 2"].map((label) => ({
          id: surveyMutationKey(),
          label,
          isCorrect: false,
        })),
      }
    : { ...common, type, min: 1, max: 5, minLabel: "Not at all", maxLabel: "Very much" };
}

/** Shared opinion-response renderer: surveys have no timer, score or correctness projection. */
export function SurveyResponseControl({
  question,
  response,
  onChange,
  disabled = false,
  required = false,
}: {
  question: SurveyQuestionDraft;
  response?: SurveyResponse;
  onChange?: (value?: SurveyResponse) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  if (question.type !== "poll" && question.type !== "rating") return null;
  const maxSelections = question.type === "poll" ? (question.maxSelections ?? 1) : 1;
  const multiple = maxSelections > 1;
  const selectedIds = response?.kind === "poll" ? response.choiceIds : [];
  const options =
    question.type === "poll"
      ? question.choices.map((choice) => ({
          value: choice.id,
          label: choice.label,
          selected: selectedIds.includes(choice.id),
        }))
      : question.type === "rating"
        ? Array.from({ length: question.max - question.min + 1 }, (_, offset) => ({
            value: String(question.min + offset),
            label: `${question.min + offset}${offset === 0 ? ` — ${question.minLabel}` : offset === question.max - question.min ? ` — ${question.maxLabel}` : ""}`,
            selected: response?.kind === "rating" && response.value === question.min + offset,
          }))
        : [];
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend>
        {question.prompt || "Untitled question"} {required ? "(required)" : "(optional)"}
      </legend>
      {multiple ? (
        <p>
          Select up to {maxSelections} options. {selectedIds.length} selected.
        </p>
      ) : null}
      {options.map((option) => (
        <label className={styles.responseOption} key={option.value}>
          <input
            type={multiple ? "checkbox" : "radio"}
            name={question.id}
            value={option.value}
            checked={option.selected}
            disabled={multiple && !option.selected && selectedIds.length >= maxSelections}
            onChange={() => {
              if (question.type === "rating") {
                onChange?.({ kind: "rating", value: Number(option.value) });
                return;
              }
              const choiceIds = multiple
                ? option.selected
                  ? selectedIds.filter((id) => id !== option.value)
                  : [...selectedIds, option.value].sort()
                : [option.value];
              onChange?.(choiceIds.length ? { kind: "poll", choiceIds } : undefined);
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
      {!required && response && onChange ? (
        <button className="button-quiet small-button" type="button" onClick={() => onChange()}>
          Clear response
        </button>
      ) : null}
    </fieldset>
  );
}

export function SurveyQuestionEditor({
  question,
  onChange,
  disabled,
}: {
  question: SurveyQuestionDraft;
  onChange: (question: SurveyQuestionDraft) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend>{question.type === "poll" ? "Poll question" : "Rating question"}</legend>
      <label className={`field ${styles.editorField}`}>
        Question
        <textarea
          className="input"
          maxLength={500}
          rows={3}
          value={question.prompt}
          onChange={(event) => onChange({ ...question, prompt: event.target.value })}
        />
      </label>
      {question.type === "poll" ? (
        <>
          <label className={`field ${styles.editorField}`}>
            Maximum selections
            <select
              className="input"
              value={question.maxSelections ?? 1}
              onChange={(event) =>
                onChange({ ...question, maxSelections: Number(event.target.value) })
              }
            >
              {question.choices.map((_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index === 0 ? "1 — single choice" : `${index + 1} — multiple choices`}
                </option>
              ))}
            </select>
          </label>
          <p>Participants may select up to this limit. Polls have no correct answer or score.</p>
          <div className={styles.options}>
            {question.choices.map((choice, index) => (
              <div className={styles.optionRow} key={choice.id}>
                <label className={`field ${styles.editorField}`}>
                  Option {index + 1}
                  <textarea
                    className="input"
                    maxLength={180}
                    rows={2}
                    value={choice.label}
                    onChange={(event) =>
                      onChange({
                        ...question,
                        choices: question.choices.map((c) =>
                          c.id === choice.id ? { ...c, label: event.target.value } : c,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  aria-label={`Remove option ${index + 1}`}
                  className={`button-quiet ${styles.removeOption}`}
                  disabled={question.choices.length <= 2}
                  title={`Remove option ${index + 1}`}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...question,
                      choices: question.choices.filter((c) => c.id !== choice.id),
                      maxSelections: Math.min(
                        question.maxSelections ?? 1,
                        question.choices.length - 1,
                      ),
                    })
                  }
                >
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <button
            className={`button-quiet ${styles.addOption}`}
            disabled={question.choices.length >= 6}
            type="button"
            onClick={() =>
              onChange({
                ...question,
                choices: [
                  ...question.choices,
                  { id: surveyMutationKey(), label: "", isCorrect: false },
                ],
              })
            }
          >
            Add option
          </button>
        </>
      ) : question.type === "rating" ? (
        <>
          <label className={`field ${styles.editorField}`}>
            Scale maximum
            <select
              className="input"
              value={question.max}
              onChange={(event) => onChange({ ...question, max: Number(event.target.value) })}
            >
              {Array.from({ length: 9 }, (_, i) => i + 2).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className={`field ${styles.editorField}`}>
            Low endpoint label
            <input
              className="input"
              maxLength={80}
              value={question.minLabel}
              onChange={(event) => onChange({ ...question, minLabel: event.target.value })}
            />
          </label>
          <label className={`field ${styles.editorField}`}>
            High endpoint label
            <input
              className="input"
              maxLength={80}
              value={question.maxLabel}
              onChange={(event) => onChange({ ...question, maxLabel: event.target.value })}
            />
          </label>
        </>
      ) : null}
    </fieldset>
  );
}

export function SurveyQuestionActions({
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={styles.questionActions}
      role="group"
      aria-label={`Question ${index + 1} actions`}
    >
      {(
        [
          [-1, "Move up"],
          [1, "Move down"],
        ] as const
      ).map(([direction, label]) => (
        <button
          className="button-quiet"
          key={direction}
          type="button"
          disabled={disabled || index + direction < 0 || index + direction >= count}
          onClick={() => onMove(direction)}
        >
          {label}
        </button>
      ))}
      <button
        className={`button-quiet ${styles.removeQuestion}`}
        type="button"
        disabled={disabled}
        onClick={onRemove}
      >
        Remove question {index + 1}
      </button>
    </div>
  );
}
