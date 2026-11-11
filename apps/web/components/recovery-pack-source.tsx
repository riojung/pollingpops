"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  AuthoringJob,
  QuestionDraft,
  RecoveryPackDraft,
  SupportedLocale,
} from "@openround/contracts";
import {
  createRecoveryPackSourceAuthoring,
  recoveryPackSourceApproved,
  recoveryPackSourceGeneration,
  type PackSourceAuthoringState,
  type RecoveryPackRecord,
} from "../lib/recovery-pack-source";

import {
  packSourceCopy,
  packSourceFeedback,
  packSourceQuestionType,
  packSourcePurpose,
  packSourceDelivery,
  packSourceConfidence,
} from "../lib/i18n/pack-source-copy";

export function PackSourceCitations({
  citations,
  locale = "en-CA",
}: {
  citations: RecoveryPackDraft["citations"];
  locale?: SupportedLocale;
}) {
  const t = packSourceCopy(locale);
  return citations.length ? (
    <ul
      lang={locale}
      aria-label={t("Source citation details")}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      {citations.map((citation, index) => (
        <li key={index}>
          <strong lang="">{citation.sourceName}</strong> · <span lang="">{citation.locator}</span>
          <p lang="">{citation.excerpt}</p>
          <small>
            {t("Source digest:")} <code lang="">{citation.sourceDigest}</code>
          </small>
        </li>
      ))}
    </ul>
  ) : (
    <p lang={locale} className="muted">
      {t("No citations on this item.")}
    </p>
  );
}

function PackSourceCheckpoint({
  label,
  question,
  locale,
}: {
  label: string;
  question: QuestionDraft;
  locale: SupportedLocale;
}) {
  const t = packSourceCopy(locale);
  return (
    <section lang={locale} role="group" aria-label={label}>
      <h4>{label}</h4>
      <p lang="">{question.prompt}</p>
      <p lang="">{question.explanation}</p>
      <p className="muted">
        {packSourceQuestionType(locale, question.type)} ·{" "}
        {packSourcePurpose(locale, question.purpose)} ·{" "}
        {packSourceDelivery(locale, question.delivery)} · {t("confidence")}{" "}
        {packSourceConfidence(locale, question.confidence)} · {question.timeLimitSeconds}s ·{" "}
        {t("{points} points", { points: question.basePoints })}
      </p>
      <p>
        {t("Concepts:")}{" "}
        {question.conceptKeys?.length ? (
          <span lang="">{question.conceptKeys.join(", ")}</span>
        ) : (
          t("None")
        )}
      </p>
      {"choices" in question ? (
        <ul aria-label={t("{label} response options", { label })}>
          {question.choices.map((choice) => (
            <li key={choice.id}>
              <span lang="">{choice.label}</span>
              {t(choice.isCorrect ? " (correct)" : " (incorrect)")}
              {choice.feedback ? (
                <p>
                  {t("Rationale:")} <span lang="">{choice.feedback}</span>
                </p>
              ) : null}
              {choice.misconceptionKey ? (
                <p>
                  {t("Misconception:")} <span lang="">{choice.misconceptionKey}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : question.type === "numeric" ? (
        <p>
          {t("Accepted value:")} <span lang="">{question.correctValue}</span> · {t("tolerance")}{" "}
          <span lang="">{question.tolerance}</span>
          {question.unit ? <span lang="">{` ${question.unit}`}</span> : null}
        </p>
      ) : null}
      <PackSourceCitations citations={question.sourceCitations ?? []} locale={locale} />
    </section>
  );
}

export function PackSourceContentView({
  draft,
  locale = "en-CA",
}: {
  draft: RecoveryPackDraft;
  locale?: SupportedLocale;
}) {
  const t = packSourceCopy(locale);
  return (
    <div lang={locale} style={{ minWidth: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
      <h4 lang="">{draft.title}</h4>
      <p lang="">{draft.description}</p>
      <p>
        {t("Shared concepts:")} <span lang="">{draft.conceptKeys.join(", ")}</span>
      </p>
      <p>
        {t("Misconceptions:")}{" "}
        {draft.misconceptionKeys.length ? (
          <span lang="">{draft.misconceptionKeys.join(", ")}</span>
        ) : (
          t("None")
        )}
      </p>
      <PackSourceCheckpoint
        locale={locale}
        label={t("Source diagnostic")}
        question={draft.diagnostic}
      />
      {draft.interventions.map((card, index) => (
        <section
          role="group"
          aria-label={t("Source intervention card {number}", { number: index + 1 })}
          key={card.id}
        >
          <h4>
            {t("Card {number}:", { number: index + 1 })} <span lang="">{card.title}</span>
          </h4>
          <p lang="">{card.body}</p>
          <PackSourceCitations citations={card.citations} locale={locale} />
        </section>
      ))}
      <PackSourceCheckpoint
        locale={locale}
        label={t("Source linked recheck")}
        question={draft.recheck}
      />
      {draft.delayedProbe ? (
        <PackSourceCheckpoint
          locale={locale}
          label={t("Source delayed probe")}
          question={draft.delayedProbe}
        />
      ) : null}
      <h4>{t("Global Pack citations")}</h4>
      <PackSourceCitations citations={draft.citations} locale={locale} />
    </div>
  );
}

export interface RecoveryPackSourceTarget {
  disabled: boolean;
  beforeCreate: () => boolean;
  onCreated: (pack: RecoveryPackRecord) => void;
  onBusyChange: (busy: boolean) => void;
  onSourceChanged?: () => void;
}

export function RecoveryPackSourceProposalPanel({
  job,
  canEdit,
  target,
  locale = "en-CA",
}: {
  job: AuthoringJob;
  canEdit: boolean;
  target: RecoveryPackSourceTarget;
  locale?: SupportedLocale;
}) {
  const t = packSourceCopy(locale);
  const [state, setState] = useState<PackSourceAuthoringState>({
    proposal: null,
    busy: null,
    error: "",
    status: "",
  });
  const current = useRef({ canEdit, target });
  current.current = { canEdit, target };
  const manager = useRef<ReturnType<typeof createRecoveryPackSourceAuthoring> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const error = useRef<HTMLParagraphElement>(null);
  const generation = recoveryPackSourceGeneration(job);
  useEffect(() => {
    let creating = false;
    const instance = createRecoveryPackSourceAuthoring({
      job,
      canCreate: () => current.current.canEdit,
      beforeCreate: () => !current.current.target.disabled && current.current.target.beforeCreate(),
      onCreated: (pack) => current.current.target.onCreated(pack),
      onState: (next) => {
        setState(next);
        if (creating || next.busy === "create")
          current.current.target.onBusyChange(next.busy === "create");
        creating = next.busy === "create";
      },
    });
    manager.current = instance;
    return () => {
      instance.cancel();
      if (creating) current.current.target.onBusyChange(false);
    };
    // A generation binds the manager to the complete immutable source output.
  }, [generation]);
  useEffect(() => {
    if (state.error) error.current?.focus();
    else if (state.proposal) heading.current?.focus();
  }, [state.error, state.proposal]);
  return (
    <section
      lang={locale}
      aria-label={t("Pack source proposal: {source}", { source: job.sourceName })}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <p className="muted">
        {t(
          "Source conversion proposes a diagnostic, linked recheck, and cited facilitator card. Create a draft to edit; saved content and citations require your explicit review before publication.",
        )}
      </p>
      <button
        className="button-quiet"
        style={{ minWidth: 0, maxWidth: "100%", whiteSpace: "normal" }}
        type="button"
        disabled={Boolean(state.busy) || target.disabled}
        onClick={() => void manager.current?.preview()}
      >
        {state.error && !state.proposal
          ? t("Retry Pack source proposal")
          : t("Review Pack source proposal")}
      </button>
      <p role="status" aria-live="polite" lang={packSourceFeedback(locale, state.status).lang}>
        {packSourceFeedback(locale, state.status).text}
      </p>
      {state.error ? (
        <p
          className="error"
          role="alert"
          tabIndex={-1}
          ref={error}
          lang={packSourceFeedback(locale, state.error).lang}
        >
          {packSourceFeedback(locale, state.error).text}
        </p>
      ) : null}
      {state.proposal ? (
        <>
          <h4 tabIndex={-1} ref={heading}>
            {t("Source Pack proposal")}
          </h4>
          <p>
            {t("Source:")} <span lang="">{state.proposal.sourceName}</span>
          </p>
          <p>
            {t("Source digest:")} <code lang="">{state.proposal.sourceDigest}</code>
          </p>
          <p>
            {t("Content hash:")} <code lang="">{state.proposal.contentHash}</code>
          </p>
          <PackSourceContentView draft={state.proposal.draft} locale={locale} />
          {state.proposal.conversionNotes.length ? (
            <div className="notice">
              <strong>{t("Conversion review")}</strong>
              <ul>
                {state.proposal.conversionNotes.map((note, index) => (
                  <li key={index} lang="">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <button
            className="button"
            style={{ minWidth: 0, maxWidth: "100%", whiteSpace: "normal" }}
            type="button"
            disabled={!canEdit || target.disabled || Boolean(state.busy)}
            onClick={() => void manager.current?.create()}
          >
            {state.busy === "create"
              ? t("Creating source Pack draft…")
              : state.error
                ? t("Retry creating source Pack draft")
                : t("Create source Pack draft")}
          </button>
        </>
      ) : null}
    </section>
  );
}

export function RecoveryPackSourceReviewPanel({
  pack,
  draft,
  dirty,
  invalidated,
  canEdit,
  busy,
  contentChecked,
  citationsChecked,
  onContentChecked,
  onCitationsChecked,
  onApprove,
  locale = "en-CA",
}: {
  pack: RecoveryPackRecord;
  draft: RecoveryPackDraft;
  dirty: boolean;
  invalidated: boolean;
  canEdit: boolean;
  busy: boolean;
  contentChecked: boolean;
  citationsChecked: boolean;
  onContentChecked: (checked: boolean) => void;
  onCitationsChecked: (checked: boolean) => void;
  onApprove: () => void;
  locale?: SupportedLocale;
}) {
  const t = packSourceCopy(locale);
  const headingId = useId();
  if (!pack.sourceReview) return null;
  const approved = !dirty && !invalidated && recoveryPackSourceApproved(pack);
  return (
    <section
      lang={locale}
      aria-labelledby={headingId}
      style={{ minWidth: 0, overflowWrap: "anywhere", marginTop: 24 }}
    >
      <h3 id={headingId}>{t("Source content and citation review")}</h3>
      <p>
        {t("Source:")} <span lang="">{pack.sourceReview.sourceName}</span>
      </p>
      <p>
        {t("Source digest:")} <code lang="">{pack.sourceReview.sourceDigest}</code>
      </p>
      <p role="status" aria-live="polite">
        {dirty
          ? t("Save your edits before reviewing and approving this revision.")
          : approved
            ? t(
                "Saved revision {revision} has content and citation approval. Publishing is a separate action.",
                { revision: pack.draftRevision },
              )
            : t(
                "Saved revision {revision} needs content and citation approval before publishing.",
                { revision: pack.draftRevision },
              )}
      </p>
      {!canEdit ? (
        <p className="notice">
          {t(
            "Source review is readable. Your workspace role or paused Pack authoring prevents approval.",
          )}
        </p>
      ) : null}
      <details>
        <summary>{t("Review complete Pack content and every citation")}</summary>
        <PackSourceContentView draft={draft} locale={locale} />
      </details>
      <fieldset disabled={!canEdit || busy || dirty} style={{ minWidth: 0 }}>
        <legend>{t("Explicit approval of the saved revision")}</legend>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={contentChecked}
            onChange={(event) => onContentChecked(event.target.checked)}
          />
          {t("I reviewed the full saved content, answer keys, and facilitator guidance.")}
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={citationsChecked}
            onChange={(event) => onCitationsChecked(event.target.checked)}
          />
          {t("I verified every citation and excerpt against the source.")}
        </label>
        <button
          className="button-quiet"
          style={{ minWidth: 0, maxWidth: "100%", whiteSpace: "normal" }}
          type="button"
          disabled={!contentChecked || !citationsChecked}
          onClick={onApprove}
        >
          {t("Approve saved content and citations")}
        </button>
      </fieldset>
    </section>
  );
}
