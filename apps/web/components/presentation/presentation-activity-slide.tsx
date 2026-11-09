"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { PresentationSceneDesign, QuestionType } from "@openround/contracts";
import { copyPresentationSceneDesign } from "../../lib/presentation-activity-design";
import { NATIVE_DESIGN_FONTS, NATIVE_DESIGN_THEMES } from "../../lib/presentation-native-design";
import { TextResponseControl } from "../text-response-control";
import { useNativeTextOverflow } from "./use-native-text-overflow";
import styles from "./presentation-activity-slide.module.css";

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
}

const activityNames: Record<QuestionType, string> = {
  single_select: "Multiple choice",
  true_false: "True or false",
  multi_select: "Multiple answers",
  poll: "Poll",
  numeric: "Number response",
  rating: "Rating",
  ranking: "Ranking",
  open_text: "Open response",
  word_cloud: "Word cloud",
};

function isChoiceActivity(type: QuestionType) {
  return (
    type === "single_select" ||
    type === "true_false" ||
    type === "multi_select" ||
    type === "poll" ||
    type === "ranking"
  );
}

function instructions(question: PresentationActivityQuestion) {
  if (question.type === "ranking")
    return question.rankCount
      ? `Rank your top ${question.rankCount} choices`
      : "Put the choices in your preferred order";
  if (question.type === "multi_select") return "Choose all answers that apply";
  if (question.type === "poll" && (question.maxSelections ?? 1) > 1)
    return `Choose up to ${question.maxSelections} answers`;
  if (isChoiceActivity(question.type)) return "Choose one answer";
  if (question.type === "numeric") return "Enter a number on your device";
  if (question.type === "rating") return "Choose a rating on your device";
  if (question.type === "word_cloud") return "Share a word or short phrase on your device";
  return "Share your response on your device";
}

function EditableText({
  value,
  label,
  placeholder,
  prompt = false,
  onChange,
  onFocus,
}: {
  value: string;
  label: string;
  placeholder: string;
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
        lang={value.trim() ? "" : "en-CA"}
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
}: PresentationActivitySlideProps) {
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
      aria-label={staticThumbnail ? undefined : "Audience activity slide"}
      style={style}
      lang="en-CA"
    >
      <div className={styles.stage}>
        <article
          {...(staticThumbnail ? {} : overflow)}
          className={styles.surface}
          aria-label={staticThumbnail ? undefined : "Activity content"}
        >
          <header className={styles.meta}>
            <span>Audience activity · {activityNames[question.type]}</span>
            <span>{question.timeLimitSeconds} seconds</span>
          </header>
          <div className={styles.prompt}>
            {canEdit && onPromptChange ? (
              <EditableText
                value={question.prompt}
                label="Question prompt"
                placeholder="What do you want the room to think about?"
                prompt
                onChange={onPromptChange}
              />
            ) : (
              <h1 lang={question.prompt.trim() ? "" : "en-CA"}>
                {question.prompt || "Untitled question"}
              </h1>
            )}
          </div>
          <p className={styles.instructions}>{instructions(question)}</p>
          <div className={styles.responseLayout} data-activity-media={media ? "true" : undefined}>
            {media ? <div className={styles.media}>{media}</div> : null}
            {isChoiceActivity(question.type) ? (
              <div className={styles.choices} role="list" aria-label="Answer choices">
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
                            label={`Slide answer ${letter}`}
                            placeholder={`Answer ${letter}`}
                            onChange={(text) => onChoiceChange(choice.id, text)}
                            onFocus={() => onSelectChoice?.(choice.id)}
                          />
                        ) : (
                          <span lang={choice.label.trim() ? "" : "en-CA"}>
                            {choice.label || `Answer ${letter}`}
                          </span>
                        )}
                        {revealed ? (
                          <span className={styles.correctAnswer} lang="en-CA">
                            Correct answer
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : question.type === "numeric" ? (
              <div className={styles.responseExample}>
                <span className={styles.numberExample}>123</span>
                <span>Participants enter a number{question.unit ? ` (${question.unit})` : ""}</span>
              </div>
            ) : question.type === "rating" ? (
              <div className={styles.rating}>
                <div
                  className={styles.ratingScale}
                  aria-label={`Rating scale from ${rating.min} to ${rating.max}`}
                >
                  {Array.from(
                    { length: Math.max(0, Math.min(10, rating.max - rating.min + 1)) },
                    (_, index) => (
                      <span key={index}>{rating.min + index}</span>
                    ),
                  )}
                </div>
                <div className={styles.ratingLabels}>
                  <span lang={rating.minLabel ? "" : "en-CA"}>{rating.minLabel || "Low"}</span>
                  <span lang={rating.maxLabel ? "" : "en-CA"}>{rating.maxLabel || "High"}</span>
                </div>
              </div>
            ) : question.type === "open_text" || question.type === "word_cloud" ? (
              staticThumbnail ? (
                <div className={styles.responseExample}>
                  {question.type === "word_cloud" ? "A word or short phrase" : "A written response"}
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
      {!staticThumbnail && needsRoom ? (
        <div className={styles.fitGuidance}>
          <span>
            This activity may need more room. Shorten the text or use Reading view to see it in
            full.
          </span>
          <button
            type="button"
            aria-pressed={readingView}
            onClick={() => setReadingView((current) => !current)}
          >
            {readingView ? "Slide view" : "Reading view"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
