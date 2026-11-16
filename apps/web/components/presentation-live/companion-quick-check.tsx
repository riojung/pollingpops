"use client";

import { useId, useState, type FormEvent } from "react";
import type { PresentationQuickCheckInput, PresentationTimeMode } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { formatNumber } from "../../lib/i18n/format";
import {
  addCompanionQuickCheckChoice,
  removeCompanionQuickCheckChoice,
  validateCompanionQuickCheckDraft,
  type CompanionQuickCheckDraft,
  type CompanionQuickCheckValidation,
} from "../../lib/presentation-companion-quick-check";
import styles from "./companion.module.css";

export function CompanionQuickCheckForm({
  draft,
  timeMode,
  available,
  disabled,
  onChange,
  onInsert,
}: {
  draft: CompanionQuickCheckDraft;
  timeMode: PresentationTimeMode;
  available: boolean;
  disabled: boolean;
  onChange: (draft: CompanionQuickCheckDraft) => void;
  onInsert: (quickCheck: PresentationQuickCheckInput) => void;
}) {
  const { locale, t } = useLocale();
  const id = useId();
  const [validation, setValidation] = useState<CompanionQuickCheckValidation | null>(null);
  const error = validation?.success === false ? validation : null;
  const change = (next: CompanionQuickCheckDraft) => {
    if (disabled) return;
    setValidation(null);
    onChange(next);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || !available) return;
    const result = validateCompanionQuickCheckDraft(draft);
    setValidation(result);
    if (result.success) onInsert(result.quickCheck);
  };

  return (
    <form className={styles.quickCheckForm} lang={locale} noValidate onSubmit={submit}>
      <p className="muted">{t("live.companion.quickCheck.description")}</p>
      <label className="field" htmlFor={`${id}-prompt`}>
        <span>{t("live.companion.quickCheck.prompt")}</span>
        <textarea
          aria-describedby={error?.field === "prompt" ? `${id}-error` : undefined}
          aria-invalid={error?.field === "prompt" || undefined}
          className="input"
          disabled={disabled}
          id={`${id}-prompt`}
          lang={draft.prompt.trim() ? "" : locale}
          maxLength={500}
          minLength={1}
          name="prompt"
          onChange={(event) => change({ ...draft, prompt: event.target.value })}
          required
          rows={3}
          value={draft.prompt}
        />
      </label>
      <fieldset
        aria-describedby={`${id}-choices-help${error?.field === "choices" ? ` ${id}-error` : ""}`}
        className={styles.quickCheckChoices}
        disabled={disabled}
      >
        <legend>{t("live.companion.quickCheck.choices")}</legend>
        <p className="muted" id={`${id}-choices-help`}>
          {t("live.companion.quickCheck.choicesHelp")}
        </p>
        {draft.choices.map((choice, index) => (
          <div className={styles.quickCheckChoice} key={index}>
            <label className="field" htmlFor={`${id}-choice-${index}`}>
              <span>
                {t("live.companion.quickCheck.choice", { number: formatNumber(locale, index + 1) })}
              </span>
              <input
                aria-describedby={error?.field === "choices" ? `${id}-error` : undefined}
                aria-invalid={error?.field === "choices" || undefined}
                className="input"
                id={`${id}-choice-${index}`}
                lang={choice.trim() ? "" : locale}
                maxLength={180}
                minLength={1}
                name={`choice-${index + 1}`}
                onChange={(event) =>
                  change({
                    ...draft,
                    choices: draft.choices.map((label, choiceIndex) =>
                      choiceIndex === index ? event.target.value : label,
                    ),
                  })
                }
                required
                type="text"
                value={choice}
              />
            </label>
            <button
              aria-label={t("live.companion.quickCheck.removeChoice", {
                number: formatNumber(locale, index + 1),
              })}
              className="button-quiet"
              disabled={draft.choices.length <= 2}
              onClick={() => change(removeCompanionQuickCheckChoice(draft, index))}
              type="button"
            >
              {t("live.companion.quickCheck.remove")}
            </button>
          </div>
        ))}
        <button
          className="button-quiet"
          disabled={draft.choices.length >= 6}
          onClick={() => change(addCompanionQuickCheckChoice(draft))}
          type="button"
        >
          {t("live.companion.quickCheck.addChoice")}
        </button>
      </fieldset>
      {timeMode === "timed" ? (
        <label className="field" htmlFor={`${id}-seconds`}>
          <span id={`${id}-seconds-label`}>{t("live.companion.quickCheck.timeLimit")}</span>
          <input
            aria-describedby={`${id}-timing-help${error?.field === "timeLimitSeconds" ? ` ${id}-error` : ""}`}
            aria-invalid={error?.field === "timeLimitSeconds" || undefined}
            aria-labelledby={`${id}-seconds-label`}
            className="input"
            disabled={disabled}
            id={`${id}-seconds`}
            max={300}
            min={10}
            name="timeLimitSeconds"
            onChange={(event) => change({ ...draft, timeLimitSeconds: event.target.value })}
            required
            step={1}
            type="number"
            value={draft.timeLimitSeconds}
          />
          <span className="muted" id={`${id}-timing-help`}>
            {t("live.companion.quickCheck.timedDescription")}
          </span>
        </label>
      ) : (
        <p className="muted">{t("live.companion.quickCheck.flexDescription")}</p>
      )}
      {error ? (
        <p className="error" id={`${id}-error`} role="alert">
          {t(error.messageKey)}
        </p>
      ) : null}
      {!available ? (
        <p className="muted" role="status">
          {t("live.companion.quickCheck.boundary")}
        </p>
      ) : null}
      <button className="button full-width" disabled={disabled || !available} type="submit">
        {t("live.companion.quickCheck.insert")}
      </button>
    </form>
  );
}
