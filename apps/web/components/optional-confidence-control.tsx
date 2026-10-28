"use client";

import { useId } from "react";
import type { ConfidenceValue } from "@openround/contracts";
import { confidenceControlCopy } from "../lib/i18n/confidence-control-copy";
import { useLocale } from "./locale-provider";

export function OptionalConfidenceControl({
  value,
  disabled,
  onChange,
}: {
  value: ConfidenceValue | null;
  disabled: boolean;
  onChange: (value: ConfidenceValue | null) => void;
}) {
  const { locale, t } = useLocale();
  const helpId = useId();
  const copy = confidenceControlCopy[locale];
  return (
    <fieldset
      className="field"
      disabled={disabled}
      style={{ border: 0, padding: 0 }}
      aria-describedby={helpId}
      data-testid="optional-confidence"
    >
      <legend className="field-label" lang={locale}>
        {copy.participantLegend}
      </legend>
      <p className="muted" id={helpId} lang={locale}>
        {copy.participantHelp}
      </p>
      <div className="button-row response-confidence-options">
        {(
          [
            [1, t("live.roundPlay.confidence.notSure")],
            [2, t("live.roundPlay.confidence.somewhat")],
            [3, t("live.roundPlay.confidence.very")],
          ] as const
        ).map(([level, label]) => (
          <button
            aria-pressed={value === level}
            className="button-quiet"
            data-selected={value === level || undefined}
            key={level}
            onClick={() => onChange(value === level ? null : level)}
            type="button"
          >
            {label}
            {value === level ? <span aria-hidden="true">✓</span> : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
