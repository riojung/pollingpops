"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { PresentationSceneDesign, QuestionType, SupportedLocale } from "@openround/contracts";
import { copyPresentationSceneDesign } from "../../lib/presentation-activity-design";
import { NATIVE_DESIGN_FONTS, NATIVE_DESIGN_THEMES } from "../../lib/presentation-native-design";
import { TextResponseControl } from "../text-response-control";
import { useLocale } from "../locale-provider";
import {
  presentationActivityCopy,
  type PresentationActivityCopy,
} from "./presentation-activity-copy";
import { useNativeTextOverflow } from "./use-native-text-overflow";
import styles from "./presentation-activity-slide.module.css";
import {
  PresentationMotionBackground,
  PresentationMotionControls,
} from "./presentation-motion-background";

/** Audience-safe shape shared by draft artwork and phase-fenced delivery projections. */
export interface PresentationActivityQuestion {
  id?: string;
  type: QuestionType;
  prompt: string;
  timeLimitSeconds: number;
  choices?: readonly { id: string; label: string }[];
  maxSelections?: number;
  rankCount?: number;
  unit?: string | null;
  rating?: { min: number; max: number; minLabel: string; maxLabel: string };
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  mediaId?: string | null;
  mediaAlt?: string | null;
}

export interface PresentationActivitySlideProps {
  question: PresentationActivityQuestion;
  design?: PresentationSceneDesign;
  media?: ReactNode;
  editable?: boolean;
  onPromptChange?: (text: string) => void;
  onChoiceChange?: (id: string, text: string) => void;
  selectedChoiceId?: string;
  onSelectChoice?: (id: string) => void;
  /** Live delivery passes only IDs from its explicit, public revealed-answer projection. */
  revealedChoiceIds?: readonly string[];
  /** Inert slide artwork inside the creator's filmstrip. */
  staticThumbnail?: boolean;
  /** Distinguish simultaneous editor, preview, and live artwork landmarks. */
  accessibilityContext?: "audience" | "editor" | "preview";
}

function isChoiceActivity(type: QuestionType) {
  return (
    type === "single_select" ||
    type === "true_false" ||
    type === "multi_select" ||
    type === "poll" ||
    type === "ranking"
  );
}

function instructions(
  question: PresentationActivityQuestion,
  copy: PresentationActivityCopy,
  formatNumber: (value: number) => string,
) {
  if (question.type === "ranking")
    return question.rankCount
      ? copy.rankTop.replace("{count}", formatNumber(question.rankCount))
      : copy.rankOrder;
  if (question.type === "multi_select") return copy.chooseAll;
  if (question.type === "poll" && (question.maxSelections ?? 1) > 1)
    return copy.chooseUpTo.replace("{count}", formatNumber(question.maxSelections!));
  if (isChoiceActivity(question.type)) return copy.chooseOne;
  if (question.type === "numeric") return copy.numberDevice;
  if (question.type === "rating") return copy.ratingDevice;
  if (question.type === "word_cloud") return copy.phraseDevice;
  return copy.responseDevice;
}

function EditableText({
  value,
  label,
  placeholder,
  locale,
  prompt = false,
  onChange,
  onFocus,
}: {
  value: string;
  label: string;
  placeholder: string;
  locale: SupportedLocale;
  prompt?: boolean;
  onChange: (value: string) => void;
  onFocus?: () => void;
}) {
  return (
    <div className={styles.textEditor} data-activity-text={prompt ? "prompt" : "answer"}>
      <span aria-hidden="true" className={styles.textMirror}>
        {(value || placeholder) + "\u200b"}
      </span>
      <textarea
        aria-label={label}
        aria-invalid={!value.trim()}
        className={styles.editableText}
        lang={value.trim() ? "" : locale}
        maxLength={prompt ? 500 : 180}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        rows={1}
        value={value}
      />
    </div>
  );
}

/** Shared audience-facing artwork; authoring controls stay outside its coordinate plane. */
export function PresentationActivitySlide({
  question,
  design: suppliedDesign,
  media,
  editable = false,
  onPromptChange,
  onChoiceChange,
  selectedChoiceId,
  onSelectChoice,
  revealedChoiceIds,
  staticThumbnail = false,
  accessibilityContext,
}: PresentationActivitySlideProps) {
  const { locale } = useLocale();
  const copy = presentationActivityCopy(locale);
  const numberFormatter = new Intl.NumberFormat(locale);
  const formatNumber = (value: number) => numberFormatter.format(value);
  const design = copyPresentationSceneDesign(suppliedDesign);
  const palette = NATIVE_DESIGN_THEMES[design.theme];
  const [readingView, setReadingView] = useState(false);
  const choices = question.choices ?? [];
  const rating = question.rating ?? {
    min: question.min ?? 1,
    max: question.max ?? 5,
    minLabel: question.minLabel ?? "",
    maxLabel: question.maxLabel ?? "",
  };
  const contentKey = JSON.stringify([
    locale,
    question.type,
    question.prompt,
    question.timeLimitSeconds,
    choices.map(({ id, label }) => [id, label]),
    rating,
    question.maxSelections,
    question.rankCount,
    question.unit,
    design,
    Boolean(media),
    readingView,
    revealedChoiceIds,
  ]);
  const overflow = useNativeTextOverflow(contentKey);
  const dense =
    question.prompt.length > 240 ||
    question.prompt.split("\n").length > 4 ||
    (isChoiceActivity(question.type) &&
      (choices.length > 4 || choices.some((choice) => choice.label.split("\n").length > 4))) ||
    Boolean(media);
  const needsRoom = dense || overflow.tabIndex === 0 || readingView;
  const canEdit = editable && !staticThumbnail;
  const context = accessibilityContext ?? (canEdit ? "editor" : "audience");
  const slideName =
    context === "editor"
      ? copy.editorSlideName
      : context === "preview"
        ? copy.previewSlideName
        : copy.slideName;
  const style = {
    "--activity-background": palette.background,
    "--activity-text": palette.text,
    "--activity-accent": palette.link,
    "--activity-border": palette.border,
    "--activity-font": NATIVE_DESIGN_FONTS[design.font],
  } as CSSProperties;

  return (
    <section
      className={styles.activity}
      data-presentation-activity="true"
      data-has-media={media ? "true" : "false"}
      data-activity-theme={design.theme}
      data-activity-font={design.font}
      data-activity-spacing={design.spacing}
      data-activity-reading-view={readingView ? "true" : undefined}
      data-static-thumbnail={staticThumbnail ? "true" : undefined}
      aria-hidden={staticThumbnail ? true : undefined}
      inert={staticThumbnail ? true : undefined}
      aria-label={staticThumbnail ? undefined : slideName}
      style={style}
      lang={locale}
    >
      <div className={styles.stage}>
        <PresentationMotionBackground
          preset={design.motionBackground}
          theme={design.theme}
          static={staticThumbnail || readingView}
        />
        <article
          {...(staticThumbnail ? {} : overflow)}
          className={styles.surface}
          aria-label={staticThumbnail ? undefined : copy.contentName}
        >
          <header className={styles.meta}>
            <span>
              {copy.audienceActivity} · {copy[question.type]}
            </span>
            <span>{copy.seconds.replace("{count}", formatNumber(question.timeLimitSeconds))}</span>
          </header>
          <div className={styles.prompt}>
            {canEdit && onPromptChange ? (
              <EditableText
                value={question.prompt}
                label={copy.questionPrompt}
                placeholder={copy.promptPlaceholder}
                locale={locale}
                prompt
                onChange={onPromptChange}
              />
            ) : (
              <h1 lang={question.prompt.trim() ? "" : locale}>
                {question.prompt || copy.untitledQuestion}
              </h1>
            )}
          </div>
          <p className={styles.instructions}>{instructions(question, copy, formatNumber)}</p>
          <div className={styles.responseLayout} data-activity-media={media ? "true" : undefined}>
            {media ? <div className={styles.media}>{media}</div> : null}
            {isChoiceActivity(question.type) ? (
              <div className={styles.choices} role="list" aria-label={copy.answerChoices}>
                {choices.map((choice, index) => {
                  const letter = String.fromCharCode(65 + index);
                  const revealed =
                    !staticThumbnail && !canEdit && revealedChoiceIds?.includes(choice.id) === true;
                  return (
                    <div
                      className={styles.choice}
                      data-selected={canEdit && selectedChoiceId === choice.id ? "true" : undefined}
                      data-revealed-correct={revealed ? "true" : undefined}
                      key={choice.id}
                      role="listitem"
                    >
                      <span className={styles.badge} aria-hidden="true">
                        {letter}
                      </span>
                      <div className={styles.choiceLabel}>
                        {canEdit && onChoiceChange && question.type !== "true_false" ? (
                          <EditableText
                            value={choice.label}
                            label={copy.slideAnswer.replace("{letter}", letter)}
                            placeholder={copy.answer.replace("{letter}", letter)}
                            locale={locale}
                            onChange={(text) => onChoiceChange(choice.id, text)}
                            onFocus={() => onSelectChoice?.(choice.id)}
                          />
                        ) : (
                          <span lang={choice.label.trim() ? "" : locale}>
                            {choice.label || copy.answer.replace("{letter}", letter)}
                          </span>
                        )}
                        {revealed ? (
                          <span className={styles.correctAnswer}>{copy.correctAnswer}</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : question.type === "numeric" ? (
              <div className={styles.responseExample}>
                <span className={styles.numberExample}>{formatNumber(123)}</span>
                <span>
                  {copy.participantsNumber.replace(
                    "{unit}",
                    question.unit ? ` (${question.unit})` : "",
                  )}
                </span>
              </div>
            ) : question.type === "rating" ? (
              <div className={styles.rating}>
                <div
                  className={styles.ratingScale}
                  aria-label={copy.ratingScale
                    .replace("{min}", formatNumber(rating.min))
                    .replace("{max}", formatNumber(rating.max))}
                >
                  {Array.from(
                    { length: Math.max(0, Math.min(10, rating.max - rating.min + 1)) },
                    (_, index) => (
                      <span key={index}>{formatNumber(rating.min + index)}</span>
                    ),
                  )}
                </div>
                <div className={styles.ratingLabels}>
                  <span lang={rating.minLabel ? "" : locale}>{rating.minLabel || copy.low}</span>
                  <span lang={rating.maxLabel ? "" : locale}>{rating.maxLabel || copy.high}</span>
                </div>
              </div>
            ) : question.type === "open_text" || question.type === "word_cloud" ? (
              staticThumbnail ? (
                <div className={styles.responseExample}>
                  {question.type === "word_cloud" ? copy.phrase : copy.written}
                </div>
              ) : (
                <div className={styles.textResponse}>
                  <TextResponseControl type={question.type} disabled />
                </div>
              )
            ) : null}
          </div>
        </article>
      </div>
      {!staticThumbnail && !readingView ? (
        <PresentationMotionControls preset={design.motionBackground} locale={locale} />
      ) : null}
      {!staticThumbnail && needsRoom ? (
        <div className={styles.fitGuidance}>
          <span>{copy.fitGuidance}</span>
          <button
            type="button"
            aria-pressed={readingView}
            onClick={() => setReadingView((current) => !current)}
          >
            {readingView ? copy.slideView : copy.readingView}
          </button>
        </div>
      ) : null}
    </section>
  );
}
