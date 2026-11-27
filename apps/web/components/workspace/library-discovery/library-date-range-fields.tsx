"use client";

import { useEffect, useId, useState } from "react";
import { isLibraryDateRangeReversed, type LibraryDateRange } from "../../../lib/library-controls";

interface DateRangeDraft {
  appliedKey: string;
  range: LibraryDateRange;
  pendingKeys: string[];
}

function rangeKey({ dateFrom, dateTo }: LibraryDateRange) {
  return `${dateFrom}/${dateTo}`;
}

export function LibraryDateRangeFields({
  range: { dateFrom, dateTo },
  onChange,
  fromLabel,
  toLabel,
  invalidRangeMessage,
  fieldClassName,
  errorClassName,
}: {
  range: LibraryDateRange;
  onChange: (range: LibraryDateRange) => void;
  fromLabel: string;
  toLabel: string;
  invalidRangeMessage: string;
  fieldClassName?: string;
  errorClassName?: string;
}) {
  const errorId = useId();
  const range = { dateFrom, dateTo };
  const appliedKey = rangeKey(range);
  const [draft, setDraft] = useState<DateRangeDraft | null>(null);
  let currentDraft = draft;
  if (draft && draft.appliedKey !== appliedKey) {
    const committed = draft.pendingKeys.indexOf(appliedKey);
    // A URL update can acknowledge an older edit while the next edit is still being entered.
    currentDraft =
      committed < 0
        ? null
        : { ...draft, appliedKey, pendingKeys: draft.pendingKeys.slice(committed + 1) };
    setDraft(currentDraft);
  }
  const values = currentDraft?.range ?? range;
  const invalid = isLibraryDateRangeReversed(values);

  useEffect(() => {
    const resetDraft = () => setDraft(null);
    window.addEventListener("popstate", resetDraft);
    return () => window.removeEventListener("popstate", resetDraft);
  }, []);

  function update(bound: keyof LibraryDateRange, input: HTMLInputElement) {
    if (input.validity.badInput || input.validity.rangeOverflow || input.validity.rangeUnderflow)
      return;
    const next = { ...values, [bound]: input.value };
    const nextKey = rangeKey(next);
    const pendingKeys = currentDraft?.pendingKeys ?? [];
    const submit =
      !isLibraryDateRangeReversed(next) && nextKey !== (pendingKeys.at(-1) ?? appliedKey);
    setDraft({
      appliedKey,
      range: next,
      pendingKeys: submit ? [...pendingKeys, nextKey] : pendingKeys,
    });
    if (submit) onChange(next);
  }

  return (
    <>
      <label className={fieldClassName}>
        <span>{fromLabel}</span>
        <input
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          value={values.dateFrom}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => update("dateFrom", event.currentTarget)}
        />
      </label>
      <label className={fieldClassName}>
        <span>{toLabel}</span>
        <input
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          value={values.dateTo}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => update("dateTo", event.currentTarget)}
        />
      </label>
      {invalid ? (
        <p className={errorClassName} id={errorId} role="alert">
          {invalidRangeMessage}
        </p>
      ) : null}
    </>
  );
}
