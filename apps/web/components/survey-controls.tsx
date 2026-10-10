"use client";

import type { QuestionDraft } from "@openround/contracts";
import type { SurveyResponse } from "@openround/contracts/surveys";
import { surveyMutationKey } from "../lib/survey-client";

export function newSurveyQuestion(type: "poll" | "rating"): QuestionDraft {
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
  question: QuestionDraft;
  response?: SurveyResponse;
  onChange?: (value?: SurveyResponse) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  if (question.type !== "poll" && question.type !== "rating") return null;
  const options =
    question.type === "poll"
      ? question.choices.map((choice) => ({
          value: choice.id,
          label: choice.label,
          selected: response?.kind === "poll" && response.choiceIds[0] === choice.id,
        }))
      : question.type === "rating"
        ? Array.from({ length: question.max - question.min + 1 }, (_, offset) => ({
            value: String(question.min + offset),
            label: `${question.min + offset}${offset === 0 ? ` — ${question.minLabel}` : offset === question.max - question.min ? ` — ${question.maxLabel}` : ""}`,
            selected: response?.kind === "rating" && response.value === question.min + offset,
          }))
        : [];
  return (
    <fieldset disabled={disabled}>
      <legend>
        {question.prompt || "Untitled question"} {required ? "(required)" : "(optional)"}
      </legend>
      {options.map((option) => (
        <label
          className="field"
          key={option.value}
          style={{ padding: "0.5rem 0", display: "flex", gap: 12 }}
        >
          <input
            type="radio"
            name={question.id}
            value={option.value}
            checked={option.selected}
            onChange={() =>
              onChange?.(
                question.type === "poll"
                  ? { kind: "poll", choiceIds: [option.value] }
                  : { kind: "rating", value: Number(option.value) },
              )
            }
          />
          {option.label}
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
  question: QuestionDraft;
  onChange: (question: QuestionDraft) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>{question.type === "poll" ? "Poll question" : "Rating question"}</legend>
      <label className="field">
        Question
        <input
          className="input"
          maxLength={500}
          value={question.prompt}
          onChange={(event) => onChange({ ...question, prompt: event.target.value })}
        />
      </label>
      {question.type === "poll" ? (
        <>
          {question.choices.map((choice, index) => (
            <div key={choice.id}>
              <label className="field">
                Option {index + 1}
                <input
                  className="input"
                  maxLength={180}
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
                className="button-quiet small-button"
                disabled={question.choices.length <= 2}
                type="button"
                onClick={() =>
                  onChange({
                    ...question,
                    choices: question.choices.filter((c) => c.id !== choice.id),
                  })
                }
              >
                Remove option {index + 1}
              </button>
            </div>
          ))}
          <button
            className="button-quiet small-button"
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
          <label className="field">
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
          <label className="field">
            Low endpoint label
            <input
              className="input"
              maxLength={80}
              value={question.minLabel}
              onChange={(event) => onChange({ ...question, minLabel: event.target.value })}
            />
          </label>
          <label className="field">
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
