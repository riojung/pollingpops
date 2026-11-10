"use client";

import { useId, useState, type FormEvent } from "react";
import type { PresentationPublishedQuestionSelection } from "@openround/contracts";
import { useLocale } from "../locale-provider";
import { formatNumber } from "../../lib/i18n/format";
import { localizeCompanionError } from "../../lib/i18n/domains/live-delivery/companion-translations";
import {
  publishedQuestionSelection,
  selectedPublishedQuestion,
  type CompanionPublishedQuestionCatalog,
} from "../../lib/presentation-companion-published-questions";
import styles from "./companion.module.css";

export function CompanionPublishedQuestionPicker({
  catalog,
  loading,
  error,
  disabled,
  onSearch,
  onInsert,
}: {
  catalog: CompanionPublishedQuestionCatalog | null;
  loading: boolean;
  error: string;
  disabled: boolean;
  onSearch: (search: string) => void;
  onInsert: (selection: PresentationPublishedQuestionSelection) => void;
}) {
  const { locale, t } = useLocale();
  const displayError = localizeCompanionError(locale, error);
  const id = useId();
  const [search, setSearch] = useState("");
  const [sourceVersionId, setSourceVersionId] = useState("");
  const [selection, setSelection] = useState<PresentationPublishedQuestionSelection | null>(null);
  const sources = [
    ...new Map(
      catalog?.questions.map((question) => [question.sourceQuizVersionId, question]),
    ).values(),
  ];
  const source = sources.find((question) => question.sourceQuizVersionId === sourceVersionId);
  const questions =
    catalog?.questions.filter(
      (question) => question.sourceQuizVersionId === source?.sourceQuizVersionId,
    ) ?? [];
  const selected = selectedPublishedQuestion(catalog, selection);
  const searchQuestions = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled && !loading) onSearch(search.trim());
  };

  return (
    <section
      className={styles.packPicker}
      aria-label={t("live.companion.publishedQuestions.title")}
      lang={locale}
    >
      <p className="muted">{t("live.companion.publishedQuestions.description")}</p>
      <form onSubmit={searchQuestions}>
        <label className="field">
          <span id={`${id}-search-label`}>{t("live.companion.publishedQuestions.search")}</span>
          <input
            aria-labelledby={`${id}-search-label`}
            className="input"
            disabled={disabled || loading}
            maxLength={100}
            lang={search.trim() ? "" : locale}
            onChange={(event) => {
              if (!disabled && !loading) setSearch(event.target.value);
            }}
            type="search"
            value={search}
          />
        </label>
        <button className="button-quiet" disabled={disabled || loading} type="submit">
          {t("live.companion.publishedQuestions.searchButton")}
        </button>
      </form>
      {loading ? <p role="status">{t("live.companion.publishedQuestions.loading")}</p> : null}
      {error ? (
        <p className="error" role="alert" lang={displayError.language}>
          {displayError.text}
        </p>
      ) : null}
      {!loading && catalog?.questions.length === 0 ? (
        <p role="status">{t("live.companion.publishedQuestions.empty")}</p>
      ) : null}
      {catalog?.hasMore ? (
        <p className="muted" role="status">
          {t("live.companion.publishedQuestions.hasMore")}
        </p>
      ) : null}
      <label className="field">
        <span id={`${id}-round-label`}>{t("live.companion.publishedQuestions.round")}</span>
        <select
          aria-labelledby={`${id}-round-label`}
          className="select"
          disabled={disabled || loading || !sources.length}
          onChange={(event) => {
            if (disabled || loading) return;
            setSourceVersionId(event.target.value);
            setSelection(null);
          }}
          value={source?.sourceQuizVersionId ?? ""}
        >
          <option value="">{t("live.companion.publishedQuestions.chooseRound")}</option>
          {sources.map((question) => (
            <option key={question.sourceQuizVersionId} value={question.sourceQuizVersionId} lang="">
              {question.title} ·{" "}
              {t("live.companion.publishedQuestions.version", {
                version: formatNumber(locale, question.sourceQuizVersion),
              })}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span id={`${id}-question-label`}>{t("live.companion.publishedQuestions.question")}</span>
        <select
          aria-labelledby={`${id}-question-label`}
          className="select"
          disabled={disabled || loading || !source || !questions.length}
          onChange={(event) => {
            if (disabled || loading) return;
            const question = questions.find(
              (candidate) => candidate.sourceQuestionId === event.target.value,
            );
            setSelection(question ? publishedQuestionSelection(question) : null);
          }}
          value={
            selected?.sourceQuizVersionId === source?.sourceQuizVersionId
              ? (selected?.sourceQuestionId ?? "")
              : ""
          }
        >
          <option value="">{t("live.companion.publishedQuestions.chooseQuestion")}</option>
          {questions.map((question) => (
            <option key={question.sourceQuestionId} value={question.sourceQuestionId} lang="">
              {question.prompt} · {t(`questionType.${question.type}.label`)}
            </option>
          ))}
        </select>
      </label>
      {selected && selected.sourceQuizVersionId === source?.sourceQuizVersionId ? (
        <p lang="">{selected.prompt}</p>
      ) : null}
      <button
        className="button full-width"
        disabled={
          disabled ||
          loading ||
          !selected ||
          selected.sourceQuizVersionId !== source?.sourceQuizVersionId
        }
        onClick={() => {
          if (
            !disabled &&
            !loading &&
            selected &&
            selected.sourceQuizVersionId === source?.sourceQuizVersionId
          )
            onInsert(publishedQuestionSelection(selected));
        }}
        type="button"
      >
        {t("live.companion.publishedQuestions.insert")}
      </button>
      {disabled ? (
        <p className="muted" role="status">
          {t("live.companion.publishedQuestions.boundary")}
        </p>
      ) : null}
      {!loading && error ? (
        <button
          className="button-quiet full-width"
          disabled={disabled}
          onClick={() => {
            if (!disabled) onSearch(search.trim());
          }}
          type="button"
        >
          {t("live.companion.publishedQuestions.reload")}
        </button>
      ) : null}
    </section>
  );
}
