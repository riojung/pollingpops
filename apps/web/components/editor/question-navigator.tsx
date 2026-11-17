"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { QuestionDraft, QuestionType, QuizDraft } from "@openround/contracts";
import { TEXT_RESPONSE_MAX_QUESTIONS } from "@openround/contracts";
import { isTextQuestion } from "../../lib/text-response";
import {
  roundNavigationCopy,
  type RoundNavigationMessage,
} from "../../lib/i18n/round-navigation-copy";
import { useLocale } from "../locale-provider";
import {
  availableQuestionTypes,
  QUESTION_TYPE_GROUPS,
  questionOutlineItems,
  type QuestionOutlineFilter,
} from "./round-navigation-helpers";
import { QuestionTypeGlyph, RoundNavigationIcon } from "./round-navigation-icon";
import shell from "./round-builder.module.css";
import styles from "./round-navigation.module.css";

const typeDescriptions: Record<QuestionType, RoundNavigationMessage> = {
  single_select: "Pick one correct answer from a set of choices.",
  true_false: "Check whether a statement is true or false.",
  multi_select: "Choose several correct answers.",
  numeric: "A numeric answer with optional tolerance and unit.",
  poll: "Gather preferences with a choice-based poll.",
  rating: "Rate a topic on a labelled scale.",
  ranking: "Put choices in order of preference.",
  open_text: "Invite written answers in participants’ own words.",
  word_cloud: "Collect short responses as a word cloud.",
};

export interface QuestionNavigatorProps {
  draft: QuizDraft;
  insertType: QuestionType;
  selectedQuestionId: string | null;
  uxBeta: boolean;
  rankingPollsEnabled?: boolean;
  openTextPollsEnabled?: boolean;
  wordCloudPollsEnabled?: boolean;
  canReuseQuestions?: boolean;
  collapsed?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  modal?: boolean;
  id?: string;
  issueQuestionIds?: ReadonlySet<string>;
  onAddQuestion: (type: QuestionType) => void;
  onDeleteQuestion?: (questionId: string) => void;
  onDuplicateQuestion?: (questionId: string) => void;
  onInsertTypeChange: (type: QuestionType) => void;
  onMoveQuestion?: (questionId: string, direction: -1 | 1) => void;
  onOpenQuestionReuse?: () => void;
  onSelectQuestion: (questionId: string) => void;
  onToggleCollapsed?: () => void;
  questionReuseOpen?: boolean;
}

export function QuestionNavigator({
  draft,
  insertType,
  selectedQuestionId,
  uxBeta,
  rankingPollsEnabled = false,
  openTextPollsEnabled = false,
  wordCloudPollsEnabled = false,
  canReuseQuestions,
  collapsed = false,
  disabled = false,
  readOnly = false,
  modal = false,
  id = "round-question-navigator",
  issueQuestionIds = new Set<string>(),
  onAddQuestion,
  onDeleteQuestion,
  onDuplicateQuestion,
  onInsertTypeChange,
  onMoveQuestion,
  onOpenQuestionReuse,
  onSelectQuestion,
  onToggleCollapsed,
  questionReuseOpen,
}: QuestionNavigatorProps) {
  const { locale, t } = useLocale();
  const copy = roundNavigationCopy(locale);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<QuestionOutlineFilter>("all");
  const [typeQuery, setTypeQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const typeSearch = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const questionButtons = useRef(new Map<string, HTMLButtonElement>());
  const uniqueId = useId();
  const dialogId = `${uniqueId}-question-types`;
  const dialogLabelId = `${uniqueId}-question-types-label`;
  const helpId = `${uniqueId}-question-navigation-help`;
  const localizedTypeLabels: Record<QuestionType, string> = {
    single_select: t("delivery.builder.type.single_select"),
    true_false: t("delivery.builder.type.true_false"),
    multi_select: t("delivery.builder.type.multi_select"),
    numeric: t("delivery.builder.type.numeric"),
    rating: t("delivery.builder.type.rating"),
    poll: t("delivery.builder.type.poll"),
    ranking: t("delivery.builder.type.ranking"),
    open_text: t("delivery.builder.type.open_text"),
    word_cloud: t("delivery.builder.type.word_cloud"),
  };
  const availableTypes = availableQuestionTypes({
    rankingPollsEnabled,
    openTextPollsEnabled,
    wordCloudPollsEnabled,
  });
  const textLimitReached =
    draft.questions.filter((question) => isTextQuestion(question.type)).length >=
    TEXT_RESPONSE_MAX_QUESTIONS;
  const items = questionOutlineItems(draft.questions, {
    query,
    filter,
    issueQuestionIds,
    typeLabels: localizedTypeLabels,
  });
  const navigationItems = collapsed
    ? draft.questions.map((question, index) => ({ question, index }))
    : items;
  const activeIndex = draft.questions.findIndex((question) => question.id === selectedQuestionId);
  const active = draft.questions[activeIndex];
  const activeIsVisible = items.some(({ question }) => question.id === selectedQuestionId);
  const focusedQuestionId = activeIsVisible ? selectedQuestionId : items[0]?.question.id;
  const matchingTypes = availableTypes.filter((type) =>
    `${localizedTypeLabels[type]} ${copy(typeDescriptions[type])}`
      .toLocaleLowerCase()
      .includes(typeQuery.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    if ((disabled || readOnly) && dialog.current?.open) dialog.current.close();
  }, [disabled, readOnly]);

  function restoreTriggerFocus() {
    const button = trigger.current;
    // Safari does not focus a button on pointer activation. Remember currentTarget explicitly.
    if (button?.isConnected && !button.matches(":disabled")) button.focus({ preventScroll: true });
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, questionId: string) {
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "Home" &&
      event.key !== "End"
    )
      return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || disabled) return;
    event.preventDefault();
    if (event.altKey) {
      if (readOnly || !onMoveQuestion || (event.key !== "ArrowUp" && event.key !== "ArrowDown"))
        return;
      const index = draft.questions.findIndex((question) => question.id === questionId);
      const direction = event.key === "ArrowUp" ? -1 : 1;
      if (index + direction >= 0 && index + direction < draft.questions.length)
        onMoveQuestion(questionId, direction);
      return;
    }
    const index = navigationItems.findIndex(({ question }) => question.id === questionId);
    const next =
      event.key === "Home"
        ? navigationItems[0]
        : event.key === "End"
          ? navigationItems.at(-1)
          : navigationItems[index + (event.key === "ArrowUp" ? -1 : 1)];
    if (!next) return;
    questionButtons.current.get(next.question.id)?.focus();
    onSelectQuestion(next.question.id);
  }

  function miniPreview(question: QuestionDraft) {
    if ("choices" in question) {
      const choices = question.choices.filter(({ label }) => label.trim());
      return (
        <span className={styles.miniAnswers} aria-hidden="true">
          {choices.length ? (
            choices.slice(0, 2).map((choice) => (
              <span key={choice.id} lang="">
                {choice.label}
              </span>
            ))
          ) : (
            <span>{copy("{count} choices", { count: question.choices.length })}</span>
          )}
        </span>
      );
    }
    if (question.type === "numeric")
      return (
        <span className={styles.numericPreview} aria-hidden="true" lang="">
          {question.correctValue || "—"}
          {question.unit ? ` ${question.unit}` : ""}
        </span>
      );
    if (question.type === "rating")
      return (
        <span className={styles.ratingPreview} aria-hidden="true">
          <span lang="">{question.minLabel || question.min}</span>
          <span className={styles.scaleTrack}>● ─ ● ─ ●</span>
          <span lang="">{question.maxLabel || question.max}</span>
        </span>
      );
    return (
      <span className={styles.textPreview} aria-hidden="true">
        {copy("Written response")}
        <span />
        <span />
      </span>
    );
  }

  if (!uxBeta) {
    return (
      <aside className="panel">
        <h2 style={{ fontSize: "1.4rem" }}>{t("delivery.builder.checkpoints")}</h2>
        <div className="question-list">
          {draft.questions.map((item, index) => (
            <button
              aria-current={item.id === selectedQuestionId}
              className="question-tab"
              key={item.id}
              onClick={() => onSelectQuestion(item.id)}
              type="button"
            >
              <strong>{index + 1}.</strong>{" "}
              {item.prompt ? (
                <span lang="">{item.prompt}</span>
              ) : (
                t("delivery.builder.untitledCheckpoint")
              )}
              {(item.delivery ?? "main") === "recheck" ? ` · ${t("delivery.builder.recheck")}` : ""}
            </button>
          ))}
        </div>
        <div className="button-row" style={{ marginTop: 16 }}>
          {(
            [
              "single_select",
              "true_false",
              "multi_select",
              "numeric",
              "rating",
              "poll",
              "ranking",
              "open_text",
              "word_cloud",
            ] as const
          )
            .filter((type) => availableTypes.includes(type))
            .map((type) => (
              <button
                className="button-quiet small-button"
                key={type}
                disabled={disabled || readOnly || (isTextQuestion(type) && textLimitReached)}
                onClick={() => onAddQuestion(type)}
                type="button"
              >
                {type === "numeric"
                  ? t("delivery.builder.type.numericLegacy")
                  : localizedTypeLabels[type]}
              </button>
            ))}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`${shell.questionMap} ${styles.navigator}`}
      data-collapsed={collapsed}
      id={id}
      aria-label={copy("Question outline")}
      role={modal && !collapsed ? "dialog" : undefined}
      aria-modal={modal && !collapsed ? true : undefined}
      tabIndex={modal && !collapsed ? -1 : undefined}
      lang={locale}
    >
      <div className={styles.outlineHeader}>
        <div className={collapsed ? "sr-only" : styles.outlineHeading}>
          <h2>{t("delivery.builder.questions")}</h2>
          <span className={styles.count}>{draft.questions.length}</span>
        </div>
        {onToggleCollapsed ? (
          <button
            aria-label={copy(collapsed ? "Expand question outline" : "Collapse question outline")}
            className={styles.iconButton}
            onClick={onToggleCollapsed}
            title={copy(collapsed ? "Expand question outline" : "Collapse question outline")}
            type="button"
          >
            <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <>
          <div className={styles.outlineTools}>
            <label className={styles.searchField}>
              <RoundNavigationIcon name="search" />
              <span className="sr-only">{copy("Search questions")}</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy("Search questions")}
                type="search"
                value={query}
              />
            </label>
            <div className={styles.filters} role="group" aria-label={copy("Filter questions")}>
              {(["all", "attention", "recheck"] as const).map((value) => (
                <button
                  aria-pressed={filter === value}
                  key={value}
                  onClick={() => setFilter(value)}
                  type="button"
                >
                  {copy(
                    value === "all"
                      ? "All"
                      : value === "attention"
                        ? "Needs attention"
                        : "Rechecks",
                  )}
                  {value === "attention" && issueQuestionIds.size ? (
                    <span className={styles.filterCount}>{issueQuestionIds.size}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          {query || filter !== "all" ? (
            <p className={styles.results} role="status">
              {copy("{shown} of {total}", { shown: items.length, total: draft.questions.length })}
              <button
                className={styles.textButton}
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
                type="button"
              >
                {copy("Clear filters")}
              </button>
            </p>
          ) : null}
          {active && !activeIsVisible ? (
            <div className={styles.hiddenSelected}>
              <span>{copy("Selected question is hidden by filters")}</span>
              <button
                className={styles.textButton}
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
                type="button"
              >
                {copy("Show selected question")}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <ol className={styles.questionList} aria-describedby={collapsed ? undefined : helpId}>
        {(collapsed ? draft.questions.map((question, index) => ({ question, index })) : items).map(
          ({ question, index }) => {
            const selected = question.id === selectedQuestionId;
            const hasIssue = issueQuestionIds.has(question.id);
            return (
              <li
                className={styles.questionItem}
                data-active={selected}
                key={question.id}
                value={index + 1}
              >
                <button
                  aria-current={selected}
                  className={styles.questionSelect}
                  data-issue={hasIssue}
                  onClick={() => onSelectQuestion(question.id)}
                  onKeyDown={(event) => navigate(event, question.id)}
                  ref={(element) => {
                    if (element) questionButtons.current.set(question.id, element);
                    else questionButtons.current.delete(question.id);
                  }}
                  tabIndex={
                    collapsed
                      ? selected || (activeIndex < 0 && index === 0)
                        ? 0
                        : -1
                      : question.id === focusedQuestionId
                        ? 0
                        : -1
                  }
                  title={
                    collapsed
                      ? `${index + 1}. ${question.prompt || t("delivery.builder.untitledQuestion")}`
                      : undefined
                  }
                  type="button"
                >
                  <span className={styles.questionNumber} aria-hidden="true">
                    {index + 1}
                  </span>
                  {collapsed ? (
                    <span className="sr-only">
                      {t("delivery.builder.question", { number: index + 1 })}
                      {question.prompt ? (
                        <>
                          {": "}
                          <span lang="">{question.prompt}</span>
                        </>
                      ) : null}
                      {hasIssue ? ` · ${t("delivery.builder.needsAttention")}` : ""}
                    </span>
                  ) : (
                    <span className={styles.questionContent}>
                      <span className={styles.questionMeta}>
                        <span className={styles.typeBadge}>
                          <QuestionTypeGlyph type={question.type} />
                          {localizedTypeLabels[question.type]}
                        </span>
                        <span
                          className={styles.readiness}
                          data-issue={hasIssue}
                          role="img"
                          aria-label={
                            hasIssue
                              ? t("delivery.builder.needsAttention")
                              : t("delivery.builder.ready")
                          }
                          title={
                            hasIssue
                              ? t("delivery.builder.needsAttention")
                              : t("delivery.builder.ready")
                          }
                        >
                          {hasIssue ? "!" : "✓"}
                        </span>
                      </span>
                      <strong>
                        <span className="sr-only">
                          {t("delivery.builder.question", { number: index + 1 })}
                          {": "}
                        </span>
                        {question.prompt ? (
                          <span lang="">{question.prompt}</span>
                        ) : (
                          t("delivery.builder.untitledQuestion")
                        )}
                      </strong>
                      {miniPreview(question)}
                      {question.delivery === "recheck" || question.mediaId ? (
                        <span className={styles.questionFlags}>
                          {question.delivery === "recheck" ? (
                            <span>{t("delivery.builder.recheck")}</span>
                          ) : null}
                          {question.mediaId ? (
                            <span title={copy("Image attached")}>
                              <RoundNavigationIcon name="image" />
                              <span className="sr-only">{copy("Image attached")}</span>
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  )}
                </button>
              </li>
            );
          },
        )}
      </ol>
      {!collapsed && items.length === 0 ? (
        <div className={styles.emptyState}>
          <RoundNavigationIcon name="search" />
          <p>{copy("No matching questions")}</p>
        </div>
      ) : null}
      {!collapsed ? (
        <>
          <div
            className={styles.selectedActions}
            role="group"
            aria-label={
              active
                ? copy("Question {number} actions", { number: activeIndex + 1 })
                : t("delivery.builder.questions")
            }
          >
            <span className={styles.selectedNumber}>{active ? `${activeIndex + 1}` : "—"}</span>
            {onMoveQuestion ? (
              <>
                <button
                  className={styles.iconButton}
                  aria-label={copy("Move earlier")}
                  title={copy("Move earlier")}
                  disabled={disabled || readOnly || activeIndex <= 0}
                  onClick={() => active && onMoveQuestion(active.id, -1)}
                  type="button"
                >
                  <RoundNavigationIcon name="up" />
                </button>
                <button
                  className={styles.iconButton}
                  aria-label={copy("Move later")}
                  title={copy("Move later")}
                  disabled={
                    disabled ||
                    readOnly ||
                    activeIndex < 0 ||
                    activeIndex === draft.questions.length - 1
                  }
                  onClick={() => active && onMoveQuestion(active.id, 1)}
                  type="button"
                >
                  <RoundNavigationIcon name="down" />
                </button>
              </>
            ) : null}
            <span className={styles.actionSpacer} />
            {onDuplicateQuestion ? (
              <button
                className={styles.iconButton}
                aria-label={t("delivery.common.duplicate")}
                title={t("delivery.common.duplicate")}
                disabled={
                  disabled ||
                  readOnly ||
                  !active ||
                  (isTextQuestion(active.type) && textLimitReached)
                }
                onClick={() => active && onDuplicateQuestion(active.id)}
                type="button"
              >
                <RoundNavigationIcon name="duplicate" />
              </button>
            ) : null}
            {onDeleteQuestion ? (
              <button
                className={`${styles.iconButton} ${styles.dangerButton}`}
                aria-label={t("delivery.common.delete")}
                title={t("delivery.common.delete")}
                disabled={disabled || readOnly || !active}
                onClick={() => active && onDeleteQuestion(active.id)}
                type="button"
              >
                <RoundNavigationIcon name="delete" />
              </button>
            ) : null}
          </div>
          <p className="sr-only" id={helpId}>
            {copy("Use ↑ ↓ to navigate. Alt + ↑ ↓ moves a question.")}
          </p>
          <div className={styles.insertArea}>
            <button
              aria-haspopup="dialog"
              aria-controls={dialogId}
              className={styles.addButton}
              disabled={disabled || readOnly}
              onClick={(event) => {
                trigger.current = event.currentTarget;
                setTypeQuery("");
                dialog.current?.showModal();
                typeSearch.current?.focus({ preventScroll: true });
              }}
              type="button"
            >
              <RoundNavigationIcon name="plus" />
              {t("delivery.builder.addQuestion")}
            </button>
            {canReuseQuestions && onOpenQuestionReuse ? (
              <button
                aria-controls="private-question-bank"
                aria-expanded={Boolean(questionReuseOpen)}
                className={styles.reuseButton}
                id="open-private-question-bank"
                disabled={disabled || readOnly}
                onClick={onOpenQuestionReuse}
                type="button"
              >
                {copy("Reuse from your workspace")}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      <dialog
        aria-label={t("delivery.builder.addQuestion")}
        aria-labelledby={dialogLabelId}
        aria-describedby={`${dialogId}-description`}
        className={styles.typeDialog}
        id={dialogId}
        onClose={restoreTriggerFocus}
        ref={dialog}
      >
        <fieldset disabled={disabled || readOnly} className={styles.dialogFields}>
          <div className={styles.dialogHeader}>
            <div>
              <h2 id={dialogLabelId}>{copy("Choose a question type")}</h2>
              <p id={`${dialogId}-description`}>
                {copy("Start with a format, then write your question.")}
              </p>
            </div>
            <button
              aria-label={copy("Close question type picker")}
              className={styles.iconButton}
              onClick={() => dialog.current?.close()}
              type="button"
            >
              <RoundNavigationIcon name="close" />
            </button>
          </div>
          <label className={styles.searchField}>
            <RoundNavigationIcon name="search" />
            <span className="sr-only">{copy("Find a question type")}</span>
            <input
              onChange={(event) => setTypeQuery(event.target.value)}
              placeholder={copy("Find a question type")}
              ref={typeSearch}
              type="search"
              value={typeQuery}
            />
          </label>
          <div className={styles.typeGroups}>
            {QUESTION_TYPE_GROUPS.map(({ kind, types }) => {
              const visible = types.filter((type) => matchingTypes.includes(type));
              return visible.length ? (
                <section className={styles.typeGroup} key={kind}>
                  <h3>{copy(kind === "knowledge" ? "Test knowledge" : "Collect opinions")}</h3>
                  <p>
                    {copy(
                      kind === "knowledge"
                        ? "Questions with a correct answer"
                        : "Every perspective counts · no correct answer",
                    )}
                  </p>
                  <div className={styles.typeGrid}>
                    {visible.map((type) => {
                      const atLimit = isTextQuestion(type) && textLimitReached;
                      return (
                        <button
                          className={styles.typeCard}
                          data-recent={type === insertType}
                          disabled={atLimit}
                          key={type}
                          onClick={() => {
                            if (disabled || readOnly || atLimit || !availableTypes.includes(type))
                              return;
                            onInsertTypeChange(type);
                            onAddQuestion(type);
                            dialog.current?.close();
                          }}
                          type="button"
                        >
                          <span className={styles.typeGlyph} data-kind={kind}>
                            <QuestionTypeGlyph type={type} />
                          </span>
                          <span>
                            <strong>{localizedTypeLabels[type]}</strong>
                            <small>{copy(typeDescriptions[type])}</small>
                            {atLimit ? (
                              <small className={styles.limitNotice}>
                                {t("delivery.builder.textQuestionLimit", {
                                  limit: TEXT_RESPONSE_MAX_QUESTIONS,
                                })}
                              </small>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null;
            })}
          </div>
          {!matchingTypes.length ? (
            <p className={styles.emptyState}>{copy("No matching question types")}</p>
          ) : null}
        </fieldset>
      </dialog>
    </aside>
  );
}
