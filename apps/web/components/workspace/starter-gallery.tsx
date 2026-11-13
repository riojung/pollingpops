"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  QuestionType,
  RoundCategory,
  QuizDraft,
  StarterGuide,
  SupportedLocale,
} from "@openround/contracts";
import type { SurveyDraft } from "@openround/contracts/surveys";
import { templateGuideCopy } from "../../lib/i18n/template-guide-copy";
import { StarterTemplatePreview, type StarterPreviewContent } from "./starter-template-preview";
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
  const guideCopy = templateGuideCopy(locale);
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
    content: StarterPreviewContent;
    guide?: StarterGuide;
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
      const items = survey
        ? (
            await apiFetch<{ templates: StarterSummary[] }>(
              `/v1/surveys/templates?locale=${locale}`,
            )
          ).templates
        : (await apiFetch<{ starters: StarterSummary[] }>(`/v1/starters?locale=${locale}`))
            .starters;
      if (request !== listRequest.current || latestLocale.current !== locale) return;
      setStarters(items);
      setContentLocale(locale);
    } catch (caught) {
      if (request !== listRequest.current || latestLocale.current !== locale) return;
      setLoadError(humanError(caught));
    } finally {
      if (request === listRequest.current && latestLocale.current === locale) setLoading(false);
    }
  }, [locale, survey]);

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
  const orderedStarters = [...prioritizeStartersForSegment(starters, creator?.segment)]
    .sort((first, second) => Number(Boolean(second.guide)) - Number(Boolean(first.guide)))
    .filter(
      (starter) =>
        (!survey || starter.responseTypes.every((type) => type === "poll" || type === "rating")) &&
        (effectiveType === "all" || starter.roundType === effectiveType) &&
        (category === "all" || starter.category === category) &&
        `${starter.title} ${starter.description} ${starter.guide?.audience ?? ""}`
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
              data-template-id={starter.id}
            >
              <div className={galleryStyles.cardTopline}>
                <span className={galleryStyles.category}>{t(categoryKeys[starter.category])}</span>
                {recommended ? (
                  <span className={galleryStyles.recommended}>{t("starter.recommended")}</span>
                ) : null}
              </div>
              <h3 lang={contentLocale}>{starter.title}</h3>
              <p lang={contentLocale}>{starter.description}</p>
              {starter.guide ? (
                <p className={galleryStyles.audience} lang={contentLocale}>
                  {starter.guide.audience}
                </p>
              ) : null}
              {starter.previewPrompt && preview?.id !== starter.id ? (
                <div className={galleryStyles.questionSample}>
                  <small>{t("templateLibrary.questionPreview")}</small>
                  <p lang={contentLocale}>{starter.previewPrompt}</p>
                </div>
              ) : null}
              <div className={galleryStyles.metaLine}>
                {starter.guide ? (
                  <span>
                    {guideCopy("About {minutes} min", {
                      minutes: formatNumber(locale, starter.guide.minutes),
                    })}
                  </span>
                ) : null}
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
                  aria-haspopup="dialog"
                  aria-controls={
                    preview?.id === starter.id ? `starter-preview-${starter.id}` : undefined
                  }
                  onClick={async (event) => {
                    event.currentTarget.focus();
                    const request = ++previewRequest.current;
                    if (preview?.id === starter.id) {
                      setPreview(null);
                      return;
                    }
                    if (!catalogCurrent || latestLocale.current !== locale) return;
                    setActionError("");
                    try {
                      let content: StarterPreviewContent;
                      let guide: StarterGuide | undefined;
                      if (survey) {
                        const result = await apiFetch<{ draft: SurveyDraft; guide?: StarterGuide }>(
                          `/v1/surveys/templates/${starter.id}?locale=${locale}`,
                        );
                        content = { kind: "survey", draft: result.draft };
                        guide = result.guide;
                      } else {
                        const result = await apiFetch<{ draft: QuizDraft; guide?: StarterGuide }>(
                          `/v1/starters/${starter.id}?locale=${locale}`,
                        );
                        content = { kind: "round", draft: result.draft };
                        guide = result.guide;
                      }
                      if (request !== previewRequest.current || latestLocale.current !== locale)
                        return;
                      setPreview({
                        id: starter.id,
                        content,
                        guide: guide ?? starter.guide,
                        contentLocale: locale,
                      });
                    } catch (caught) {
                      if (request !== previewRequest.current || latestLocale.current !== locale)
                        return;
                      setActionError(humanError(caught));
                    }
                  }}
                >
                  {preview?.id === starter.id
                    ? t("starter.closePreview")
                    : survey
                      ? guideCopy("Preview questionnaire")
                      : t("starter.preview")}
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
            </article>
          );
        })}
      </div>
      {preview ? (
        <StarterTemplatePreview
          key={preview.id}
          id={preview.id}
          content={preview.content}
          guide={preview.guide}
          contentLocale={preview.contentLocale}
          uiLocale={locale}
          closeLabel={t("starter.closePreview")}
          onClose={() => setPreview(null)}
        />
      ) : null}
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
