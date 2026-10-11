"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuestionType, RoundCategory, QuizDraft } from "@openround/contracts";
import { apiFetch, humanError, ApiClientError } from "../../lib/api";
import { useLocale } from "../locale-provider";
import { formatNumber, pluralCategory } from "../../lib/i18n/format";
import type { MessageKey } from "../../lib/i18n/catalog";
import { useWorkspace } from "./workspace-provider";
import { prioritizeStartersForSegment } from "./workspace-model";
import type { StarterSummary } from "./workspace-types";
import styles from "./workspace-content.module.css";
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
  const { creator, canEdit } = useWorkspace();
  const [starters, setStarters] = useState<StarterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<RoundCategory | "all">("all");
  const [type, setType] = useState(roundType);
  const [preview, setPreview] = useState<{ id: string; draft: QuizDraft } | null>(null);
  const surveyKeys = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    setLoadError("");
    setLoading(true);
    try {
      const response = await apiFetch<{ starters: StarterSummary[] }>("/v1/starters");
      setStarters(response.starters);
    } catch (caught) {
      setLoadError(humanError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function useStarter(starter: StarterSummary) {
    setBusyId(starter.id);
    setActionError("");
    if (!survey) recordCreationEvent("creation_started", "starter", "round");
    try {
      if (survey) {
        const key = surveyKeys.current.get(starter.id) ?? surveyMutationKey();
        surveyKeys.current.set(starter.id, key);
        const response = await apiFetch<{ survey: { id: string } }>("/v1/surveys", {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: key, templateId: starter.id }),
        });
        router.push(`/surveys/${response.survey.id}`);
        return;
      }
      const response = await apiFetch<{ quiz: { id: string } }>(`/v1/starters/${starter.id}/use`, {
        method: "POST",
        body: "{}",
      });
      recordCreationEvent("creation_completed", "starter", "round");
      if (starter.questionCount > 0) recordAuthoringEvent("first_block_created", "round");
      router.push(`/quiz/${response.quiz.id}`);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        surveyKeys.current.delete(starter.id);
      setActionError(humanError(caught));
      setBusyId("");
    }
  }

  if (loading)
    return (
      <p className={styles.muted} lang={locale} role="status">
        {t("starter.loading")}
      </p>
    );

  const effectiveType = survey ? "poll" : roundType !== "all" ? roundType : type;
  const orderedStarters = prioritizeStartersForSegment(starters, creator?.segment).filter(
    (starter) =>
      (effectiveType === "all" || starter.roundType === effectiveType) &&
      (category === "all" || starter.category === category) &&
      `${starter.title} ${starter.description}`
        .toLocaleLowerCase(locale)
        .includes(search.trim().toLocaleLowerCase(locale)),
  );

  return (
    <div lang={locale}>
      <div className={styles.templateFilters}>
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
      <div className={compact ? styles.starterGridCompact : styles.starterGrid}>
        {orderedStarters.map((starter) => {
          const recommended = starter.segment === "all" || starter.segment === creator?.segment;
          return (
            <article className={styles.starterCard} key={starter.id}>
              <div className={styles.cardTopline}>
                <span className={styles.category}>{t(categoryKeys[starter.category])}</span>
                {recommended ? (
                  <span className={styles.recommended}>{t("starter.recommended")}</span>
                ) : null}
              </div>
              <h3 lang="en-CA">{starter.title}</h3>
              <p lang="en-CA">{starter.description}</p>
              <div className={styles.metaLine}>
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
              <button
                className="button-quiet small-button"
                type="button"
                onClick={async () => {
                  if (preview?.id === starter.id) {
                    setPreview(null);
                    return;
                  }
                  setActionError("");
                  try {
                    const result = await apiFetch<{ draft: QuizDraft }>(
                      `/v1/starters/${starter.id}`,
                    );
                    setPreview({ id: starter.id, draft: result.draft });
                  } catch (caught) {
                    setActionError(humanError(caught));
                  }
                }}
              >
                {preview?.id === starter.id ? t("starter.closePreview") : t("starter.preview")}
              </button>
              {preview?.id === starter.id ? (
                <ol lang="en-CA">
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
              {canEdit ? (
                <button
                  className="button small-button"
                  disabled={Boolean(busyId)}
                  onClick={() => void useStarter(starter)}
                  type="button"
                >
                  {busyId === starter.id ? t("starter.creating") : t("starter.use")}
                </button>
              ) : (
                <p className={styles.readOnlyNote}>{t("starter.readOnly")}</p>
              )}
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
