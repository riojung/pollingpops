"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ContentSlideDraft, SupportedLocale } from "@openround/contracts";
import {
  questionStartersCopy,
  questionStartersFeedback,
} from "../../lib/i18n/question-starters-copy";
import {
  createPresentationQuestionStarters,
  presentationQuestionStarterAvailability,
  type PresentationQuestionStarter,
  type PresentationQuestionStarterSource,
} from "../../lib/presentation-question-starters";
import styles from "./presentation-question-starters.module.css";
import { EditorIcon } from "./presentation-editor-chrome";

interface Props {
  block: ContentSlideDraft;
  sourceKey: string;
  disabled?: boolean;
  locale?: SupportedLocale;
  onInsert: (starter: PresentationQuestionStarter) => boolean | void;
}
interface Review {
  sourceKey: string;
  fingerprint: string;
  starters: PresentationQuestionStarter[];
  selectedId: PresentationQuestionStarter["id"];
}

function choiceLanguage(starter: PresentationQuestionStarter, choice: string) {
  return (
    starter.source.body.find((body) =>
      body.paragraphs.some((paragraph) => paragraph.text === choice),
    )?.lang ?? ""
  );
}

/** The source is the exact visible text projection, never notes, link destinations or import evidence. */
export function QuestionStarterSourceReview({
  source,
  locale = "en-CA",
}: {
  source: PresentationQuestionStarterSource;
  locale?: SupportedLocale;
}) {
  const copy = questionStartersCopy(locale);
  return (
    <section className={styles.source} aria-label={copy("Private source context")} lang={locale}>
      <h3>{copy("Private source context")}</h3>
      <p>
        {copy(
          "Saved source excerpts are private creator context. This local template does not independently verify the slide’s statements.",
        )}
      </p>
      {source.readingOrder.map((id) => {
        if (id === source.title.nodeId)
          return (
            <article key={id} data-question-starter-source-node={id}>
              <h4>{copy("Slide title")}</h4>
              <p className={styles.sourceText} lang={source.title.lang ?? ""}>
                {source.title.text}
              </p>
            </article>
          );
        const index = source.body.findIndex((body) => body.nodeId === id);
        const body = source.body[index];
        return body ? (
          <article key={id} data-question-starter-source-node={id}>
            <h4>{copy("Body text {number}", { number: index + 1 })}</h4>
            <p className={styles.sourceText} lang={body.lang ?? ""}>
              {body.text}
            </p>
          </article>
        ) : null;
      })}
    </section>
  );
}

export function QuestionStarterPreview({
  starter,
  locale = "en-CA",
}: {
  starter: PresentationQuestionStarter;
  locale?: SupportedLocale;
}) {
  const copy = questionStartersCopy(locale);
  const title = starter.source.title.text;
  const quotedStart = title ? starter.prompt.indexOf(`“${title}”`) : -1;
  const titleStart = quotedStart < 0 ? -1 : quotedStart + 1;
  const prompt =
    titleStart < 0 ? (
      starter.prompt
    ) : (
      <>
        {starter.prompt.slice(0, titleStart)}
        <span lang={starter.source.title.lang ?? ""}>{title}</span>
        {starter.prompt.slice(titleStart + title.length)}
      </>
    );
  return (
    <section className={styles.preview} aria-label={copy("Question preview")} lang={locale}>
      <h3>{copy("Question preview")}</h3>
      <p className={styles.kind}>
        {starter.type === "open_text"
          ? copy("Open-text discussion")
          : starter.type === "rating"
            ? copy("Clarity rating")
            : copy("Priority poll")}
      </p>
      <p className={styles.prompt} lang={starter.creationLocale ?? "en-CA"}>
        {prompt}
      </p>
      <p className={styles.settings}>{copy("Opinion · 0 points · no correct answer")}</p>
      {starter.type === "poll" && starter.choices ? (
        <>
          <h4>{copy("Participants choose one option")}</h4>
          <ol className={styles.options}>
            {starter.choices.map((choice, index) => (
              <li key={index} lang={choiceLanguage(starter, choice)}>
                {choice}
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {starter.type === "rating" && starter.rating ? (
        <dl className={styles.rating}>
          <div>
            <dt>{copy("Lowest value")}</dt>
            <dd lang={starter.creationLocale ?? "en-CA"}>
              {starter.rating.min} — {starter.rating.minLabel}
            </dd>
          </div>
          <div>
            <dt>{copy("Highest value")}</dt>
            <dd lang={starter.creationLocale ?? "en-CA"}>
              {starter.rating.max} — {starter.rating.maxLabel}
            </dd>
          </div>
        </dl>
      ) : null}
      {starter.type === "open_text" ? (
        <p>{copy("Participants write an open-text response.")}</p>
      ) : null}
      <p className={styles.help}>
        {copy(
          "This question collects opinions. It does not award points, collect confidence or create a linked recheck.",
        )}
      </p>
    </section>
  );
}

export function PresentationQuestionStarters(props: Props) {
  const { block, sourceKey, disabled = false, locale = "en-CA" } = props;
  const copy = questionStartersCopy(locale);
  const availability = presentationQuestionStarterAvailability(block);
  const candidates = createPresentationQuestionStarters(block);
  const fingerprint = candidates[0]?.source.fingerprint ?? null;
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const active = useRef<Review | null>(null);
  const mounted = useRef(true);
  const latest = useRef(props);
  latest.current = props;
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const sourceCurrent = Boolean(
    review && !disabled && review.sourceKey === sourceKey && review.fingerprint === fingerprint,
  );
  const current = Boolean(review && active.current === review && sourceCurrent);
  if (
    active.current &&
    (disabled ||
      active.current.sourceKey !== sourceKey ||
      active.current.fingerprint !== fingerprint)
  )
    active.current = null;
  function close() {
    active.current = null;
    setReview(null);
    setError("");
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current = null;
    };
  }, []);
  useEffect(() => {
    if (review && !sourceCurrent) close();
  }, [review, sourceCurrent]);
  const open = Boolean(review);
  useEffect(() => {
    if (!open) return;
    const target = dialog.current;
    if (target && !target.open) target.showModal();
    return () => {
      if (target?.open) target.close();
      if (trigger.current?.isConnected && !trigger.current.disabled)
        trigger.current.focus({ preventScroll: true });
    };
  }, [open]);

  function stillCurrent(expected: Review) {
    if (
      !mounted.current ||
      active.current !== expected ||
      latest.current.disabled ||
      latest.current.sourceKey !== expected.sourceKey
    )
      return false;
    return (
      createPresentationQuestionStarters(latest.current.block)[0]?.source.fingerprint ===
      expected.fingerprint
    );
  }
  function suggest() {
    if (!mounted.current || latest.current.disabled || active.current) return;
    const starters = createPresentationQuestionStarters(
      latest.current.block,
      latest.current.locale ?? "en-CA",
    );
    if (!starters.length) {
      setError(
        presentationQuestionStarterAvailability(latest.current.block).reason ??
          "This slide has no question starters available.",
      );
      return;
    }
    const next: Review = {
      sourceKey: latest.current.sourceKey,
      fingerprint: starters[0]!.source.fingerprint,
      starters: structuredClone(starters),
      selectedId: starters[0]!.id,
    };
    active.current = next;
    setReview(next);
    setError("");
  }
  function select(expected: Review, id: PresentationQuestionStarter["id"]) {
    if (!stillCurrent(expected) || !expected.starters.some((starter) => starter.id === id)) return;
    const next = { ...expected, selectedId: id };
    active.current = next;
    setReview(next);
    setError("");
  }
  function insert(expected: Review) {
    if (!stillCurrent(expected)) return;
    const starter = expected.starters.find((candidate) => candidate.id === expected.selectedId);
    if (!starter) return;
    active.current = null;
    try {
      const inserted = latest.current.onInsert(structuredClone(starter));
      if (inserted === false) {
        active.current = expected;
        setError(
          "This question could not be inserted. Resolve outstanding draft changes or review the current slide, then try again.",
        );
        return;
      }
      close();
    } catch (failure) {
      active.current = expected;
      setError(
        failure instanceof Error
          ? failure.message
          : "The question could not be inserted. Your presentation is retained.",
      );
    }
  }
  const selected = review?.starters.find((starter) => starter.id === review.selectedId);
  const availabilityFeedback = availability.reason
    ? questionStartersFeedback(locale, availability.reason)
    : null;
  const errorFeedback = questionStartersFeedback(locale, error);
  return (
    <section className={styles.entry} aria-label={copy("Local question starters")} lang={locale}>
      <div className={styles.entryHeading}>
        <EditorIcon name="interaction" />
        <span>{copy("From this slide")}</span>
        <span className={styles.localBadge}>{copy("No AI needed")}</span>
      </div>
      <button
        ref={trigger}
        type="button"
        disabled={disabled || !availability.supported}
        onClick={suggest}
      >
        {copy("Question starters")}
      </button>
      <p className={styles.help} lang={availabilityFeedback?.lang}>
        {availabilityFeedback?.text ??
          copy(
            "Review local discussion, clarity and priority starters from this slide’s title and body text. No AI service or allowance is used.",
          )}
      </p>
      {!review && error ? (
        <p role="alert" lang={errorFeedback.lang}>
          {errorFeedback.text}
        </p>
      ) : null}
      {review && selected ? (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-modal="true"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClose={close}
        >
          <header className={styles.heading}>
            <h2 id={titleId}>{copy("Review question starters")}</h2>
            <button type="button" aria-label={copy("Close review")} onClick={close}>
              {copy("Close")}
            </button>
          </header>
          <p id={descriptionId}>
            {copy(
              "Choose one starter and review the complete question and source context. Inserting creates an editable opinion question after this slide.",
            )}
          </p>
          <p className={styles.help}>
            {copy(
              "Created locally. No AI service or allowance is used. Prompts use the language selected when you open this review and your slide’s exact wording. Other objects, images, tables, charts and closed interaction content are not interpreted.",
            )}
          </p>
          <fieldset className={styles.choices} disabled={!current}>
            <legend>{copy("Choose a question starter")}</legend>
            {review.starters.map((starter) => (
              <label key={starter.id}>
                <input
                  type="radio"
                  name={`${titleId}-starter`}
                  value={starter.id}
                  checked={starter.id === review.selectedId}
                  onChange={() => select(review, starter.id)}
                />
                <span>
                  <strong>
                    {copy(
                      starter.id === "discussion"
                        ? "Discussion"
                        : starter.id === "clarity"
                          ? "Clarity rating"
                          : "Priority poll",
                    )}
                  </strong>
                  <span>
                    {copy(
                      starter.id === "discussion"
                        ? "Invite questions and comments about the authored slide title."
                        : starter.id === "clarity"
                          ? "Ask for a subjective clarity rating, not a scored understanding check."
                          : "Use every authored body point as an option for what to discuss next.",
                    )}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {!review.starters.some((starter) => starter.id === "priority") ? (
            <p className={styles.help}>
              {copy(
                "A priority poll needs 2–6 distinct authored points, each at most 180 characters. All points are included without shortening.",
              )}
            </p>
          ) : null}
          <QuestionStarterPreview starter={selected} locale={locale} />
          <QuestionStarterSourceReview source={selected.source} locale={locale} />
          {error ? (
            <p role="alert" className={styles.error} lang={errorFeedback.lang}>
              {errorFeedback.text}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" disabled={!current} onClick={() => insert(review)}>
              {copy("Insert reviewed question")}
            </button>
            <button type="button" onClick={close}>
              {copy("Cancel")}
            </button>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
