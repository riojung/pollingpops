"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuestionType, RoundCategory, QuizDraft, SupportedLocale } from "@openround/contracts";
import { apiFetch, humanError, ApiClientError } from "../../lib/api";
import { useLocale } from "../locale-provider";
import { formatNumber, pluralCategory } from "../../lib/i18n/format";
import type { MessageKey } from "../../lib/i18n/catalog";
import { useWorkspace } from "./workspace-provider";
import { prioritizeStartersForSegment } from "./workspace-model";
import type { StarterSummary } from "./workspace-types";
import styles from "./workspace-content.module.css";
import galleryStyles from "./template-gallery.module.css";
import { recordAuthoringEvent, recordCreationEvent } from "./product-events";
import { surveyMutationKey } from "../../lib/survey-client";

const categoryKeys: Record<RoundCategory, MessageKey> = {
  general: "category.general",
  education: "category.education",
  business: "category.business",
  technical: "category.technical",
  safety_compliance: "category.safety_compliance",
  icebreaker: "category.icebreaker",
};

const questionTypeLabelKeys: Record<QuestionType, MessageKey> = {
  single_select: "questionType.single_select.label",
  true_false: "questionType.true_false.label",
  multi_select: "questionType.multi_select.label",
  numeric: "questionType.numeric.label",
  rating: "questionType.rating.label",
  poll: "questionType.poll.label",
  ranking: "questionType.ranking.label",
  open_text: "questionType.open_text.label",
  word_cloud: "questionType.word_cloud.label",
};

export function StarterGallery({
  compact = false,
  roundType = "all",
  survey = false,
}: {
  compact?: boolean;
  roundType?: "all" | "quiz" | "poll" | "custom";
  survey?: boolean;
}) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const { creator, canEdit, productFeatures } = useWorkspace();
  const [starters, setStarters] = useState<StarterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<RoundCategory | "all">("all");
  const [type, setType] = useState(roundType);
  const [preview, setPreview] = useState<{
    id: string;
    draft: QuizDraft;
    contentLocale: SupportedLocale;
  } | null>(null);
  const [contentLocale, setContentLocale] = useState(locale);
  const surveyRequests = useRef(new Map<string, string>());
  const creating = useRef(false);
  const listRequest = useRef(0);
  const previewRequest = useRef(0);
  const latestLocale = useRef(locale);
  latestLocale.current = locale;
  const catalogCurrent = !loading && contentLocale === locale;

  const refresh = useCallback(async () => {
    const request = ++listRequest.current;
    setLoadError("");
    setLoading(true);
    try {
      const response = await apiFetch<{ starters: StarterSummary[] }>(
        `/v1/starters?locale=${locale}`,
      );
      if (request !== listRequest.current || latestLocale.current !== locale) return;
      setStarters(response.starters);
      setContentLocale(locale);
    } catch (caught) {
      if (request !== listRequest.current || latestLocale.current !== locale) return;
      setLoadError(humanError(caught));
    } finally {
      if (request === listRequest.current && latestLocale.current === locale) setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void refresh();
    return () => {
      listRequest.current++;
      previewRequest.current++;
    };
  }, [refresh]);

  async function useStarter(starter: StarterSummary) {
    if (creating.current || !canEdit || !catalogCurrent || latestLocale.current !== locale) return;
    creating.current = true;
    setBusyId(starter.id);
    setActionError("");
    if (!survey) recordCreationEvent("creation_started", "starter", "round");
    try {
      if (survey) {
        // A lost response is retried with exactly the originally submitted content language.
        const body =
          surveyRequests.current.get(starter.id) ??
          JSON.stringify({ idempotencyKey: surveyMutationKey(), templateId: starter.id, locale });
        surveyRequests.current.set(starter.id, body);
        const response = await apiFetch<{ survey: { id: string } }>("/v1/surveys", {
          method: "POST",
          body,
        });
        router.push(`/surveys/${response.survey.id}`);
        return;
      }
      const response = await apiFetch<{ quiz: { id: string } }>(`/v1/starters/${starter.id}/use`, {
        method: "POST",
        body: JSON.stringify({ locale }),
      });
      recordCreationEvent("creation_completed", "starter", "round");
      if (starter.questionCount > 0) recordAuthoringEvent("first_block_created", "round");
      router.push(`/quiz/${response.quiz.id}`);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        surveyRequests.current.delete(starter.id);
      setActionError(humanError(caught));
      setBusyId("");
      creating.current = false;
    }
  }

  if (loading && starters.length === 0)
    return (
      <p className={styles.muted} lang={locale} role="status">
        {t("starter.loading")}
      </p>
    );

  const effectiveType = survey ? "poll" : roundType !== "all" ? roundType : type;
  const orderedStarters = prioritizeStartersForSegment(starters, creator?.segment).filter(
    (starter) =>
      (!survey || starter.responseTypes.every((type) => type === "poll" || type === "rating")) &&
      (effectiveType === "all" || starter.roundType === effectiveType) &&
      (category === "all" || starter.category === category) &&
      `${starter.title} ${starter.description}`
        .toLocaleLowerCase(locale)
        .includes(search.trim().toLocaleLowerCase(locale)),
  );

  return (
    <div lang={locale} aria-busy={loading}>
      <div className={galleryStyles.gallerySummary}>
        <strong>
          {t("templateLibrary.count", { count: formatNumber(locale, orderedStarters.length) })}
        </strong>
        <span>{t("templateLibrary.englishContent")}</span>
      </div>
      <div className={galleryStyles.filters}>
        <label className="field">
          <span>{t("starter.search")}</span>
          <input
            className="input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("starter.allCategories")}</span>
          <select
            className="input"
            value={category}
            onChange={(event) => setCategory(event.target.value as RoundCategory | "all")}
          >
            <option value="all">{t("starter.allCategories")}</option>
            {Object.entries(categoryKeys).map(([value, key]) => (
              <option value={value} key={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </label>
        {!survey && roundType === "all" ? (
          <label className="field">
            <span>{t("starter.allTypes")}</span>
            <select
              className="input"
              value={type}
              onChange={(event) => setType(event.target.value as typeof type)}
            >
              <option value="all">{t("starter.allTypes")}</option>
              {(["quiz", "poll", "custom"] as const).map((value) => (
                <option value={value} key={value}>
                  {t(`create.kind.${value}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {loadError ? (
        <div>
          <p className="error" lang="en-CA" role="alert">
            {loadError}
          </p>
          <button
            className="button-quiet small-button"
            onClick={() => void refresh()}
            type="button"
          >
            {t("starter.retry")}
          </button>
        </div>
      ) : null}
      {actionError ? (
        <p className="error" lang="en-CA" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className={galleryStyles.starterGrid} data-compact={compact || undefined}>
        {orderedStarters.map((starter) => {
          const recommended = starter.segment === "all" || starter.segment === creator?.segment;
          return (
            <article
              className={galleryStyles.templateCard}
              data-category={starter.category}
              key={starter.id}
            >
              <div className={galleryStyles.cardTopline}>
                <span className={galleryStyles.category}>{t(categoryKeys[starter.category])}</span>
                {recommended ? (
                  <span className={galleryStyles.recommended}>{t("starter.recommended")}</span>
                ) : null}
              </div>
              <h3 lang={contentLocale}>{starter.title}</h3>
              <p lang={contentLocale}>{starter.description}</p>
              {starter.previewPrompt && preview?.id !== starter.id ? (
                <div className={galleryStyles.questionSample}>
                  <small>{t("templateLibrary.questionPreview")}</small>
                  <p lang={contentLocale}>{starter.previewPrompt}</p>
                </div>
              ) : null}
              <div className={galleryStyles.metaLine}>
                <span>{t(`create.kind.${survey ? "survey" : starter.roundType}`)}</span>
                <span>
                  {t(
                    pluralCategory(locale, starter.questionCount) === "one"
                      ? "starter.questionCount.one"
                      : "starter.questionCount.other",
                    { count: formatNumber(locale, starter.questionCount) },
                  )}
                </span>
                <span>
                  {starter.responseTypes.map((type) => t(questionTypeLabelKeys[type])).join(" · ")}
                </span>
              </div>
              <div className={galleryStyles.cardActions}>
                <button
                  className="button-quiet small-button"
                  type="button"
                  disabled={preview?.id !== starter.id && !catalogCurrent}
                  aria-expanded={preview?.id === starter.id}
                  aria-controls={
                    preview?.id === starter.id ? `starter-preview-${starter.id}` : undefined
                  }
                  onClick={async () => {
                    const request = ++previewRequest.current;
                    if (preview?.id === starter.id) {
                      setPreview(null);
                      return;
                    }
                    if (!catalogCurrent || latestLocale.current !== locale) return;
                    setActionError("");
                    try {
                      const result = await apiFetch<{ draft: QuizDraft }>(
                        `/v1/starters/${starter.id}?locale=${locale}`,
                      );
                      if (request !== previewRequest.current || latestLocale.current !== locale)
                        return;
                      setPreview({ id: starter.id, draft: result.draft, contentLocale: locale });
                    } catch (caught) {
                      if (request !== previewRequest.current || latestLocale.current !== locale)
                        return;
                      setActionError(humanError(caught));
                    }
                  }}
                >
                  {preview?.id === starter.id ? t("starter.closePreview") : t("starter.preview")}
                </button>
                {canEdit && (!survey || productFeatures?.surveys) ? (
                  <button
                    className="button small-button"
                    disabled={Boolean(busyId) || !catalogCurrent}
                    onClick={() => void useStarter(starter)}
                    type="button"
                  >
                    {busyId === starter.id ? t("starter.creating") : t("starter.use")}
                  </button>
                ) : !canEdit ? (
                  <p className={galleryStyles.readOnlyNote}>{t("starter.readOnly")}</p>
                ) : null}
              </div>
              {preview?.id === starter.id ? (
                <ol
                  className={galleryStyles.preview}
                  id={`starter-preview-${starter.id}`}
                  lang={preview.contentLocale}
                >
                  {preview.draft.questions.map((question) => (
                    <li key={question.id}>
                      {question.prompt}
                      {"choices" in question ? (
                        <ul>
                          {question.choices.map((choice) => (
                            <li key={choice.id}>{choice.label}</li>
                          ))}
                        </ul>
                      ) : question.type === "rating" ? (
                        <p>
                          {question.min} — {question.minLabel} / {question.max} —{" "}
                          {question.maxLabel}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </article>
          );
        })}
      </div>
      {starters.length > 0 && orderedStarters.length === 0 ? (
        <p role="status">{t("starter.noMatches")}</p>
      ) : null}
      {!starters.length && !loadError ? (
        <div className={styles.emptyState}>
          <h3>{t("starter.emptyTitle")}</h3>
          <p>{t("starter.emptyDescription")}</p>
        </div>
      ) : null}
    </div>
  );
}
