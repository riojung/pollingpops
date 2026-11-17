"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  liveQuestionConfidence,
  questionPurpose,
  type ExperienceThemeSnapshot,
  type QuestionDraft,
  type QuizDraft,
} from "@openround/contracts";
import { useLocale } from "../../../../components/locale-provider";
import { OptionalConfidenceControl } from "../../../../components/optional-confidence-control";
import { RankingChoices } from "../../../../components/ranking-choices";
import { TextResponseControl } from "../../../../components/text-response-control";
import { apiFetch } from "../../../../lib/api";
import { confidenceControlCopy } from "../../../../lib/i18n/confidence-control-copy";
import { roundPreviewCopy } from "../../../../lib/i18n/round-preview-copy";
import {
  canCheckPreviewAnswer,
  initialPreviewResponse,
  togglePreviewChoice,
} from "../../../../lib/round-preview-state";
import { isTextQuestion } from "../../../../lib/text-response";
import { experienceThemeStyle } from "../../../../lib/theme";
import styles from "./round-preview.module.css";

export function PreviewMedia({ question }: { question: QuestionDraft }) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [media, setMedia] = useState<{ id: string; url: string; failed: boolean } | null>(null);
  const mediaId = question.mediaId;
  useEffect(() => {
    if (!mediaId) return;
    const controller = new AbortController();
    let active = true;
    apiFetch<{ downloadUrl: string }>(`/v1/media/${mediaId}`, { signal: controller.signal })
      .then(({ downloadUrl }) => {
        if (active) setMedia({ id: mediaId, url: downloadUrl, failed: false });
      })
      .catch((caught) => {
        if (!active) return;
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        setMedia({ id: mediaId, url: "", failed: true });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [mediaId, router]);
  if (!mediaId) return null;
  if (media?.id !== mediaId)
    return (
      <p className="muted" role="status">
        {t("common.loading")}
      </p>
    );
  if (media.failed) return <p className="muted">{roundPreviewCopy[locale].mediaUnavailable}</p>;
  return (
    <img
      alt={question.mediaAlt ?? ""}
      className={styles.media}
      height={360}
      onError={() =>
        setMedia((current) =>
          current?.id === mediaId ? { id: mediaId, url: "", failed: true } : current,
        )
      }
      src={media.url}
      width={640}
    />
  );
}

/** All answer actions below only update component state. */
export function RehearsalQuestion({
  question,
  revealed,
  resetKey,
}: {
  question: QuestionDraft;
  revealed: boolean;
  resetKey: number;
}) {
  return <TestAnswer key={`${question.id}:${resetKey}`} question={question} revealed={revealed} />;
}

function TestAnswer({ question, revealed }: { question: QuestionDraft; revealed: boolean }) {
  const { locale, t } = useLocale();
  const copy = roundPreviewCopy[locale];
  const [response, setResponse] = useState(() => initialPreviewResponse(question));
  const opinion = questionPurpose(question) === "opinion";
  const disabled = response.submitted || revealed;
  const multiChoice =
    question.type === "multi_select" ||
    (question.type === "poll" && (question.maxSelections ?? 1) > 1);
  const limit = question.type === "poll" ? (question.maxSelections ?? 1) : Infinity;
  return (
    <form
      className={styles.answerForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (!revealed && canCheckPreviewAnswer(question, response))
          setResponse((current) => ({ ...current, submitted: true }));
      }}
    >
      {isTextQuestion(question.type) ? (
        <TextResponseControl
          type={question.type}
          value={response.text}
          disabled={disabled}
          onChange={(text) => setResponse((current) => ({ ...current, text }))}
        />
      ) : question.type === "ranking" ? (
        <RankingChoices
          question={question}
          selectedChoiceIds={response.choices}
          disabled={disabled}
          onChange={(choices) => setResponse((current) => ({ ...current, choices }))}
        />
      ) : "choices" in question ? (
        <fieldset className={styles.choices} disabled={disabled}>
          <legend className="sr-only">{t("reportRound.preview.answerChoices")}</legend>
          {question.type === "poll" && multiChoice ? (
            <p className="muted" role="status">
              {t("live.roundPlay.pollSelectionLimit", { limit, selected: response.choices.length })}
            </p>
          ) : null}
          <div className={`answer-grid ${styles.answerGrid}`}>
            {question.choices.map((choice, index) => {
              const selected = response.choices.includes(choice.id);
              const correct = revealed && !opinion && choice.isCorrect;
              return (
                <label
                  className={`answer-button ${styles.choice}`}
                  data-selected={selected || undefined}
                  data-correct={correct || undefined}
                  key={choice.id}
                >
                  <input
                    checked={selected}
                    disabled={multiChoice && !selected && response.choices.length >= limit}
                    name={`preview-${question.id}`}
                    onChange={() =>
                      setResponse((current) => ({
                        ...current,
                        choices: togglePreviewChoice(question, current.choices, choice.id),
                      }))
                    }
                    type={multiChoice ? "checkbox" : "radio"}
                    value={choice.id}
                  />
                  <span className={styles.choiceLetter} aria-hidden="true">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className={styles.choiceText}>
                    <span lang="">{choice.label}</span>
                    {correct ? <small>{copy.correct} ✓</small> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : question.type === "numeric" ? (
        <label className="field">
          <span>{t("reportRound.preview.numericResponse", { unit: question.unit ?? "" })}</span>
          <input
            autoComplete="off"
            className="input"
            disabled={disabled}
            inputMode="decimal"
            onChange={(event) =>
              setResponse((current) => ({ ...current, text: event.target.value }))
            }
            value={response.text}
          />
        </label>
      ) : question.type === "rating" ? (
        <fieldset className={styles.choices} disabled={disabled}>
          <legend className="field-label">{t("reportRound.preview.chooseRating")}</legend>
          <div className={styles.ratingGrid}>
            {Array.from(
              { length: question.max - question.min + 1 },
              (_, index) => question.min + index,
            ).map((rating) => (
              <label
                className={`answer-button ${styles.rating}`}
                key={rating}
                data-selected={response.rating === rating || undefined}
              >
                <input
                  type="radio"
                  name={`preview-${question.id}`}
                  checked={response.rating === rating}
                  value={rating}
                  onChange={() => setResponse((current) => ({ ...current, rating }))}
                />
                <span>{new Intl.NumberFormat(locale).format(rating)}</span>
              </label>
            ))}
          </div>
          <p className={styles.scaleLabels}>
            <span lang="">{question.minLabel}</span>
            <span lang="">{question.maxLabel}</span>
          </p>
        </fieldset>
      ) : null}
      {liveQuestionConfidence(question, {}) !== "off" ? (
        <OptionalConfidenceControl
          value={response.confidence}
          disabled={disabled}
          onChange={(confidence) => setResponse((current) => ({ ...current, confidence }))}
        />
      ) : null}
      {revealed ? (
        <div className={styles.reveal} role="status">
          <strong>{opinion ? copy.unscored : t("reportRound.preview.correctRevealed")}</strong>
          {question.type === "numeric" && !opinion ? (
            <p>
              {t("reportRound.preview.acceptedValue", {
                value: question.correctValue,
                tolerance: question.tolerance,
                unit: question.unit ?? "",
              })}
            </p>
          ) : null}
          {question.explanation ? <p lang="">{question.explanation}</p> : null}
        </div>
      ) : (
        <div className={styles.submitRow}>
          <button
            className="button"
            disabled={!canCheckPreviewAnswer(question, response)}
            type="submit"
          >
            {copy.submit}
          </button>
          <p className="muted" role="status">
            {response.submitted ? copy.answered : copy.testAnswer}
          </p>
        </div>
      )}
    </form>
  );
}

export function RoundRehearsal({
  draft,
  experienceTheme,
}: {
  draft: QuizDraft;
  experienceTheme: ExperienceThemeSnapshot;
}) {
  const { locale, t } = useLocale();
  const copy = roundPreviewCopy[locale];
  const [questionIndex, setQuestionIndex] = useState(0);
  const [presenter, setPresenter] = useState(true);
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const [revealed, setRevealed] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const question = draft.questions[questionIndex];
  if (!question) return null;
  const opinion = questionPurpose(question) === "opinion";
  const progress = t("reportRound.preview.progress", {
    current: questionIndex + 1,
    total: draft.questions.length,
  });
  const seconds = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "second",
    unitDisplay: "narrow",
  }).format(question.timeLimitSeconds);
  function selectQuestion(index: number) {
    setQuestionIndex(index);
    setRevealed(false);
    setResetKey((current) => current + 1);
  }
  return (
    <>
      <div className={styles.workspaceHeading}>
        <div className={styles.titleCopy}>
          <p className={styles.eyebrow}>
            {copy.rehearsal} <span aria-hidden="true">/</span> {copy.draft}
          </p>
          <h1 lang="">{draft.title}</h1>
          <p>{copy.sourceHelp}</p>
        </div>
        <div className={styles.viewSwitch} role="group" aria-label={copy.rehearsal}>
          <button aria-pressed={!presenter} onClick={() => setPresenter(false)} type="button">
            {copy.audience}
          </button>
          <button aria-pressed={presenter} onClick={() => setPresenter(true)} type="button">
            {copy.presenter}
          </button>
        </div>
      </div>
      <div className={styles.testBanner}>
        <span className={styles.testDot} aria-hidden="true" />
        <strong>{copy.testOnly}</strong>
        <span>{copy.testHelp}</span>
      </div>
      <div className={styles.workspace} data-presenter={presenter}>
        <nav className={styles.outline} aria-label={t("reportRound.preview.checkpoints")}>
          <div className={styles.outlineHeading}>
            <h2>{t("reportRound.preview.checkpoints")}</h2>
            <span>{draft.questions.length}</span>
          </div>
          <ol>
            {draft.questions.map((item, index) => (
              <li key={item.id}>
                <button
                  aria-current={index === questionIndex ? "step" : undefined}
                  className={styles.outlineItem}
                  onClick={() => selectQuestion(index)}
                  type="button"
                >
                  <span className={styles.outlineNumber}>
                    {new Intl.NumberFormat(locale).format(index + 1)}
                  </span>
                  <span className={styles.outlineCopy}>
                    <strong lang="">{item.prompt}</strong>
                    <small>
                      {t(`delivery.builder.type.${item.type}`)}
                      {item.delivery === "recheck" ? ` · ${t("delivery.builder.recheck")}` : ""}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className={styles.previewColumn} aria-label={copy.audience}>
          <div className={styles.canvasToolbar}>
            <span>{copy.audience}</span>
            <div className={styles.viewSwitch} role="group" aria-label={copy.device}>
              <button
                aria-pressed={width === "desktop"}
                onClick={() => setWidth("desktop")}
                type="button"
              >
                {copy.desktop}
              </button>
              <button
                aria-pressed={width === "phone"}
                onClick={() => setWidth("phone")}
                type="button"
              >
                {copy.phone}
              </button>
            </div>
          </div>
          <div className={styles.canvasFrame}>
            <div
              className={`live-shell ${styles.audience}`}
              data-width={width}
              data-corners={experienceTheme.tokens.corners}
              data-motion={experienceTheme.motion}
              data-pattern={experienceTheme.tokens.pattern}
              data-typography={experienceTheme.tokens.typography}
              style={experienceThemeStyle(experienceTheme)}
            >
              <article className={`live-card ${styles.questionCard}`}>
                <div className={styles.questionMeta}>
                  <span role="status">{progress}</span>
                  <span
                    className={styles.timer}
                    title={copy.timer}
                    aria-label={`${copy.timer}: ${seconds}`}
                  >
                    {seconds} <span aria-hidden="true">Ⅱ</span>
                  </span>
                </div>
                <h2 lang="">{question.prompt}</h2>
                <PreviewMedia key={question.id} question={question} />
                <RehearsalQuestion question={question} revealed={revealed} resetKey={resetKey} />
              </article>
            </div>
          </div>
          <div className={styles.controls}>
            <button
              className="button-quiet small-button"
              disabled={questionIndex === 0}
              onClick={() => selectQuestion(questionIndex - 1)}
              type="button"
            >
              {t("reportRound.preview.previous")}
            </button>
            <div className={styles.revealControls}>
              <button
                className="button-quiet small-button"
                onClick={() => {
                  setResetKey((current) => current + 1);
                  setRevealed(false);
                }}
                type="button"
              >
                {copy.reset}
              </button>
              <button
                aria-pressed={revealed}
                className="button-quiet small-button"
                onClick={() => setRevealed((current) => !current)}
                type="button"
              >
                {opinion
                  ? revealed
                    ? copy.hideExplanation
                    : copy.showExplanation
                  : revealed
                    ? t("reportRound.preview.hideAnswer")
                    : copy.reveal}
              </button>
            </div>
            <button
              className="button small-button"
              disabled={questionIndex === draft.questions.length - 1}
              onClick={() => selectQuestion(questionIndex + 1)}
              type="button"
            >
              {t("reportRound.preview.next")}
            </button>
          </div>
          {questionIndex === draft.questions.length - 1 ? (
            <p className={styles.endNote}>{copy.end}</p>
          ) : null}
        </section>
        {presenter ? (
          <aside className={styles.presenter} aria-label={copy.presenter}>
            <div className={styles.presenterHeading}>
              <span aria-hidden="true">◧</span>
              <h2>{copy.presenter}</h2>
            </div>
            <section>
              <h3>{copy.notes}</h3>
              <p className={styles.notesLabel}>{t("delivery.builder.explanationAfterReveal")}</p>
              <p
                className={question.explanation ? styles.authoredNotes : styles.emptyNotes}
                lang={question.explanation ? "" : undefined}
              >
                {question.explanation || copy.noNotes}
              </p>
            </section>
            <section>
              <h3>{copy.settings}</h3>
              <dl className={styles.settings}>
                <div>
                  <dt>{t(`delivery.builder.type.${question.type}`)}</dt>
                  <dd>
                    {question.delivery === "recheck" ? t("delivery.builder.recheck") : progress}
                  </dd>
                </div>
                <div>
                  <dt>{copy.timer}</dt>
                  <dd>{seconds}</dd>
                </div>
                <div>
                  <dt>{copy.scoring}</dt>
                  <dd>
                    {opinion
                      ? copy.unscored
                      : copy.points.replace(
                          "{points}",
                          new Intl.NumberFormat(locale).format(question.basePoints),
                        )}
                  </dd>
                </div>
                <div>
                  <dt>{confidenceControlCopy[locale].shortLabel}</dt>
                  <dd>
                    {liveQuestionConfidence(question, {}) === "off"
                      ? confidenceControlCopy[locale].off
                      : confidenceControlCopy[locale].on}
                  </dd>
                </div>
              </dl>
            </section>
            <p className={styles.presenterHint}>{copy.testHelp}</p>
          </aside>
        ) : null}
      </div>
    </>
  );
}
