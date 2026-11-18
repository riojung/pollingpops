"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuestionType, RoundCategory, QuizDraft, StarterGuide } from "@openround/contracts";
import type { SurveyDraft } from "@openround/contracts/surveys";
import { templateGuideCopy } from "../../lib/i18n/template-guide-copy";
import { StarterTemplatePreview, type StarterPreviewContent } from "./starter-template-preview";
import { apiFetch, humanError, ApiClientError, AUTH_CHANGE_EVENT } from "../../lib/api";
import { SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT } from "../../lib/idle-session";
import { starterPreviewCopy } from "../../lib/i18n/starter-preview-copy";
import previewStyles from "./starter-template-preview.module.css";
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
import { collectionTemplateIds, type TemplateCollectionId } from "../../lib/template-collections";

const categoryKeys: Record<RoundCategory, MessageKey> = {
  general: "category.general",
  education: "category.education",
  business: "category.business",
  technical: "category.technical",
  safety_compliance: "category.safety_compliance",
  icebreaker: "category.icebreaker",
  science: "category.science",
  health_wellbeing: "category.health_wellbeing",
  arts_culture: "category.arts_culture",
  leadership: "category.leadership",
  sustainability: "category.sustainability",
  community: "category.community",
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

type PreviewState = {
  starter: StarterSummary;
  scope: string;
  content?: StarterPreviewContent;
  guide?: StarterGuide;
  loading: boolean;
  error: string;
  reveal?: boolean;
};

type StarterFilters = {
  collection: TemplateCollectionId | null;
  search: string;
  category: RoundCategory | "all";
  type: "all" | "quiz" | "poll" | "custom";
};

export function StarterGallery({
  compact = false,
  roundType = "all",
  survey = false,
  collection = null,
}: {
  compact?: boolean;
  roundType?: "all" | "quiz" | "poll" | "custom";
  survey?: boolean;
  collection?: TemplateCollectionId | null;
}) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const guideCopy = templateGuideCopy(locale);
  const copy = starterPreviewCopy(locale);
  const { creator, canEdit, productFeatures, loading: workspaceLoading } = useWorkspace();
  const actor = JSON.stringify([creator?.userId, creator?.workspaceId]);
  const scope = JSON.stringify([actor, locale, survey]);
  const authority = JSON.stringify([
    scope,
    canEdit,
    creator?.role,
    productFeatures,
    workspaceLoading,
  ]);
  const [starters, setStarters] = useState<StarterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const defaults: StarterFilters = { collection, search: "", category: "all", type: roundType };
  const [filters, setFilters] = useState<StarterFilters>(defaults);
  const currentFilters = filters.collection === collection ? filters : defaults;
  // Reset browsing without unmounting the owner of pending copies and retry intents.
  if (filters.collection !== collection) setFilters(currentFilters);
  const { search, category, type } = currentFilters;
  function updateFilters(change: Partial<Omit<StarterFilters, "collection">>) {
    setFilters((current) => ({ ...current, ...change }));
  }
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [contentLocale, setContentLocale] = useState(locale);
  const [catalogScope, setCatalogScope] = useState("");
  const [invalidActor, setInvalidActor] = useState<string | null>(null);
  const surveyRequests = useRef(new Map<string, string>());
  const creating = useRef(false);
  const mounted = useRef(true);
  const listRequest = useRef(0);
  const previewRequest = useRef(0);
  const actionRequest = useRef(0);
  const selection = useRef(0);
  const access = useRef({ authority, version: 0 });
  if (access.current.authority !== authority)
    access.current = { authority, version: access.current.version + 1 };
  const accessVersion = access.current.version;
  const renderedSelection = selection.current;
  const latest = useRef({ scope, authority, actor, allowed: false, invalid: false });
  const authInvalid = invalidActor === actor;
  const allowed = Boolean(
    creator?.userId && creator.workspaceId && canEdit && !workspaceLoading && !authInvalid,
  );
  latest.current = { scope, authority, actor, allowed, invalid: authInvalid };
  const catalogCurrent = !loading && catalogScope === scope && !authInvalid;
  // Old-language summaries may remain during a locale reload, but never another actor's content.
  const sameCatalogActor =
    catalogScope !== "" &&
    JSON.parse(catalogScope)[0] === actor &&
    JSON.parse(catalogScope)[2] === survey;
  const visibleStarters = sameCatalogActor && !authInvalid ? starters : [];
  const currentPreview = preview?.scope === scope && !authInvalid ? preview : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current || latest.current.scope !== scope || latest.current.invalid) return;
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
      if (
        request !== listRequest.current ||
        latest.current.scope !== scope ||
        latest.current.invalid
      )
        return;
      setStarters(items);
      setCatalogScope(scope);
      setContentLocale(locale);
    } catch (caught) {
      if (
        request !== listRequest.current ||
        latest.current.scope !== scope ||
        latest.current.invalid
      )
        return;
      setLoadError(humanError(caught));
    } finally {
      if (
        request === listRequest.current &&
        latest.current.scope === scope &&
        !latest.current.invalid
      )
        setLoading(false);
    }
  }, [locale, survey, scope]);

  useEffect(() => {
    setBusyId("");
    setActionError("");
    void refresh();
    return () => {
      listRequest.current++;
      previewRequest.current++;
      actionRequest.current++;
      selection.current++;
      creating.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    // Retry intents belong to the actor and workspace that submitted them.
    surveyRequests.current.clear();
    setBusyId("");
    setActionError("");
    if (typeof window === "undefined") return;
    const invalidate = () => {
      latest.current.invalid = true;
      latest.current.allowed = false;
      listRequest.current++;
      previewRequest.current++;
      actionRequest.current++;
      selection.current++;
      creating.current = false;
      surveyRequests.current.clear();
      setInvalidActor(actor);
      setPreview(null);
      setBusyId("");
      setActionError("");
    };
    const events = [AUTH_CHANGE_EVENT, SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT];
    events.forEach((name) => window.addEventListener(name, invalidate));
    return () => events.forEach((name) => window.removeEventListener(name, invalidate));
  }, [actor]);

  function eligible(starter: StarterSummary) {
    const inspected =
      currentPreview?.starter.id === starter.id ? currentPreview.content : undefined;
    if (
      inspected?.kind === "round" &&
      inspected.draft.questions.some(
        (question) => question.type === "poll" && (question.maxSelections ?? 1) > 1,
      ) &&
      productFeatures?.multiSelectPolls !== true
    )
      return false;
    return survey
      ? productFeatures?.surveys === true
      : starter.responseTypes.every((responseType) =>
          responseType === "ranking"
            ? productFeatures?.rankingPolls === true
            : responseType === "open_text"
              ? productFeatures?.openTextPolls === true
              : responseType === "word_cloud"
                ? productFeatures?.wordCloudPolls === true
                : true,
        );
  }

  const loadPreview = useCallback(
    async (starter: StarterSummary, reveal = false) => {
      if (
        !mounted.current ||
        latest.current.scope !== scope ||
        latest.current.invalid ||
        catalogScope !== scope ||
        loading
      )
        return;
      const request = ++previewRequest.current;
      selection.current++;
      setPreview({ starter, scope, loading: true, error: "", reveal });
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
        if (
          request !== previewRequest.current ||
          latest.current.scope !== scope ||
          latest.current.invalid
        )
          return;
        setPreview({
          starter,
          scope,
          content,
          guide: guide ?? starter.guide,
          loading: false,
          error: "",
          reveal,
        });
      } catch (caught) {
        if (
          request !== previewRequest.current ||
          latest.current.scope !== scope ||
          latest.current.invalid
        )
          return;
        setPreview({ starter, scope, loading: false, error: humanError(caught), reveal });
      }
    },
    [catalogScope, loading, locale, scope, survey],
  );

  function closePreview() {
    previewRequest.current++;
    selection.current++;
    setPreview(null);
  }

  async function useStarter(starter: StarterSummary, fromPreview = false) {
    if (
      creating.current ||
      !mounted.current ||
      access.current.version !== accessVersion ||
      renderedSelection !== selection.current ||
      !allowed ||
      !eligible(starter) ||
      !catalogCurrent ||
      latest.current.authority !== authority ||
      !latest.current.allowed ||
      latest.current.invalid
    )
      return;
    if (
      fromPreview &&
      (!currentPreview?.content ||
        currentPreview.loading ||
        currentPreview.error ||
        currentPreview.starter.id !== starter.id)
    )
      return;
    creating.current = true;
    const request = ++actionRequest.current;
    // Preview-only changes do not cancel a submitted copy or hide its outcome.
    // Authority/context changes still fence late responses below.
    const current = () =>
      mounted.current &&
      access.current.version === accessVersion &&
      request === actionRequest.current &&
      latest.current.authority === authority &&
      latest.current.allowed &&
      !latest.current.invalid;
    setBusyId(starter.id);
    setActionError("");
    let navigated = false;
    if (!survey) recordCreationEvent("creation_started", "starter", "round");
    try {
      if (survey) {
        // A retry in this actor, workspace and language reuses the exact mutation body.
        const intentKey = JSON.stringify([actor, locale, starter.id]);
        const body =
          surveyRequests.current.get(intentKey) ??
          JSON.stringify({ idempotencyKey: surveyMutationKey(), templateId: starter.id, locale });
        surveyRequests.current.set(intentKey, body);
        const response = await apiFetch<{ survey: { id: string } }>("/v1/surveys", {
          method: "POST",
          body,
        });
        if (current()) {
          navigated = true;
          router.push(`/surveys/${encodeURIComponent(response.survey.id)}`);
        }
        return;
      }
      const response = await apiFetch<{ quiz: { id: string } }>(`/v1/starters/${starter.id}/use`, {
        method: "POST",
        body: JSON.stringify({ locale }),
      });
      if (!current()) return;
      recordCreationEvent("creation_completed", "starter", "round");
      if (starter.questionCount > 0) recordAuthoringEvent("first_block_created", "round");
      navigated = true;
      router.push(`/quiz/${encodeURIComponent(response.quiz.id)}`);
    } catch (caught) {
      if (!current()) return;
      if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        surveyRequests.current.delete(JSON.stringify([actor, locale, starter.id]));
      setActionError(humanError(caught));
    } finally {
      if (!navigated && request === actionRequest.current) {
        setBusyId("");
        creating.current = false;
      }
    }
  }

  const effectiveType = survey ? "poll" : roundType !== "all" ? roundType : type;
  const collectionIds = collectionTemplateIds(survey ? "survey" : "round", collection);
  const orderedStarters = [...prioritizeStartersForSegment(visibleStarters, creator?.segment)]
    .sort((first, second) => Number(Boolean(second.guide)) - Number(Boolean(first.guide)))
    .filter(
      (starter) =>
        (!collectionIds || collectionIds.includes(starter.id)) &&
        (!survey ||
          starter.responseTypes.every(
            (responseType) => responseType === "poll" || responseType === "rating",
          )) &&
        (effectiveType === "all" || starter.roundType === effectiveType) &&
        (category === "all" || starter.category === category) &&
        `${starter.title} ${starter.description} ${starter.guide?.audience ?? ""}`
          .toLocaleLowerCase(locale)
          .includes(search.trim().toLocaleLowerCase(locale)),
    );
  const selectedId = currentPreview?.starter.id;
  const firstStarter = orderedStarters[0];
  const selectionVisible = orderedStarters.some((starter) => starter.id === selectedId);
  // Noncompact browsing always shows a preview of a visible result. Compact callers retain cards.
  useEffect(() => {
    if (compact || !catalogCurrent) return;
    if (!selectionVisible) {
      if (firstStarter) void loadPreview(firstStarter);
      else if (selectedId) {
        previewRequest.current++;
        selection.current++;
        setPreview(null);
      }
    }
  }, [compact, catalogCurrent, selectionVisible, selectedId, firstStarter, loadPreview]);

  function metadata(
    starter: StarterSummary,
    content?: StarterPreviewContent,
    guide = starter.guide,
  ) {
    const questions =
      content?.kind === "round"
        ? content.draft.questions
        : content?.draft.items.map((item) => item.question);
    const questionCount = questions?.length ?? starter.questionCount;
    const responseTypes = questions
      ? [...new Set(questions.map((question) => question.type))]
      : starter.responseTypes;
    return (
      <div className={galleryStyles.metaLine}>
        {guide ? (
          <span>
            {guideCopy("About {minutes} min", {
              minutes: formatNumber(locale, guide.minutes),
            })}
          </span>
        ) : null}
        <span>{t(`create.kind.${survey ? "survey" : starter.roundType}`)}</span>
        <span>
          {t(
            pluralCategory(locale, questionCount) === "one"
              ? "starter.questionCount.one"
              : "starter.questionCount.other",
            { count: formatNumber(locale, questionCount) },
          )}
        </span>
        <span>
          {responseTypes.map((responseType) => t(questionTypeLabelKeys[responseType])).join(" · ")}
        </span>
      </div>
    );
  }

  const previewPanel =
    currentPreview && (compact || selectionVisible) ? (
      <StarterTemplatePreview
        key={`${scope}:${currentPreview.starter.id}`}
        id={currentPreview.starter.id}
        content={currentPreview.content}
        title={currentPreview.starter.title}
        description={currentPreview.starter.description}
        guide={currentPreview.guide}
        contentLocale={locale}
        uiLocale={locale}
        closeLabel={t("starter.closePreview")}
        onClose={closePreview}
        mode={compact ? "dialog" : "panel"}
        loading={currentPreview.loading}
        reveal={currentPreview.reveal}
        error={currentPreview.error}
        onRetry={() => void loadPreview(currentPreview.starter)}
        metadata={metadata(currentPreview.starter, currentPreview.content, currentPreview.guide)}
        useLabel={busyId === currentPreview.starter.id ? t("starter.creating") : t("starter.use")}
        onUse={
          canEdit && eligible(currentPreview.starter)
            ? () => void useStarter(currentPreview.starter, true)
            : undefined
        }
        useDisabled={Boolean(busyId) || !catalogCurrent || !allowed}
        readOnlyLabel={!canEdit ? t("starter.readOnly") : undefined}
        actionError={actionError}
      />
    ) : null;

  if (authInvalid)
    return (
      <p role="alert" lang={locale}>
        {copy.authChanged}
      </p>
    );
  if (loading && visibleStarters.length === 0)
    return (
      <p className={styles.muted} lang={locale} role="status">
        {t("starter.loading")}
      </p>
    );

  return (
    <div lang={locale} aria-busy={loading}>
      <div className={galleryStyles.gallerySummary}>
        <strong role="status">
          {copy.matching.replace("{count}", formatNumber(locale, orderedStarters.length))}
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
            onChange={(event) => updateFilters({ search: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("starter.allCategories")}</span>
          <select
            className="input"
            value={category}
            onChange={(event) =>
              updateFilters({ category: event.target.value as RoundCategory | "all" })
            }
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
              onChange={(event) => updateFilters({ type: event.target.value as typeof type })}
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
        <div className={previewStyles.error}>
          <p role="alert">{copy.catalogError}</p>
          <details>
            <summary>{copy.details}</summary>
            <p lang="en-CA">{loadError}</p>
          </details>
          <button
            className="button-quiet small-button"
            onClick={() => void refresh()}
            type="button"
          >
            {t("starter.retry")}
          </button>
        </div>
      ) : null}
      {actionError && !previewPanel ? (
        <div className={previewStyles.error} role="alert">
          <p>{copy.actionError}</p>
          <details>
            <summary>{copy.details}</summary>
            <p lang="en-CA">{actionError}</p>
          </details>
        </div>
      ) : null}
      <div className={!compact ? previewStyles.browser : undefined}>
        {!compact && orderedStarters.length > 0 ? (
          <label className={`field ${previewStyles.mobileSelect}`}>
            <span>{copy.choose}</span>
            <select
              className="input"
              value={selectionVisible ? selectedId : ""}
              disabled={!catalogCurrent}
              onChange={(event) => {
                const starter = orderedStarters.find((item) => item.id === event.target.value);
                if (starter) void loadPreview(starter);
              }}
            >
              <option value="" disabled>
                {copy.choose}
              </option>
              {orderedStarters.map((starter) => (
                <option key={starter.id} value={starter.id}>
                  {starter.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div
          className={compact ? galleryStyles.starterGrid : previewStyles.summaryList}
          data-compact={compact || undefined}
          aria-label={copy.templates}
        >
          {orderedStarters.map((starter) => {
            const recommended = starter.segment === "all" || starter.segment === creator?.segment;
            const selected = selectedId === starter.id;
            return (
              <article
                className={`${galleryStyles.templateCard} ${!compact ? previewStyles.summaryCard : ""}`}
                data-selected={(!compact && selected) || undefined}
                data-category={starter.category}
                key={starter.id}
                data-template-id={starter.id}
              >
                <div className={galleryStyles.cardTopline}>
                  <span className={galleryStyles.category}>
                    {t(categoryKeys[starter.category])}
                  </span>
                  {recommended ? (
                    <span className={galleryStyles.recommended}>{t("starter.recommended")}</span>
                  ) : null}
                </div>
                <h3 lang={contentLocale}>{starter.title}</h3>
                <p lang={contentLocale}>{starter.description}</p>
                {compact && starter.guide ? (
                  <p className={galleryStyles.audience} lang={contentLocale}>
                    {starter.guide.audience}
                  </p>
                ) : null}
                {compact && starter.previewPrompt && !selected ? (
                  <div className={galleryStyles.questionSample}>
                    <small>{t("templateLibrary.questionPreview")}</small>
                    <p lang={contentLocale}>{starter.previewPrompt}</p>
                  </div>
                ) : null}
                {metadata(starter)}
                <div className={galleryStyles.cardActions}>
                  <button
                    className="button-quiet small-button"
                    type="button"
                    disabled={!(compact && selected) && !catalogCurrent}
                    aria-expanded={compact ? selected : undefined}
                    aria-pressed={!compact ? selected : undefined}
                    aria-haspopup={compact ? "dialog" : undefined}
                    aria-controls={selected ? `starter-preview-${starter.id}` : undefined}
                    onClick={(event) => {
                      event.currentTarget.focus();
                      if (compact && selected) closePreview();
                      else if (!selected) void loadPreview(starter, !compact);
                    }}
                  >
                    {compact && selected
                      ? t("starter.closePreview")
                      : survey
                        ? guideCopy("Preview questionnaire")
                        : t("starter.preview")}
                  </button>
                  {compact && canEdit && eligible(starter) ? (
                    <button
                      className="button small-button"
                      disabled={Boolean(busyId) || !catalogCurrent || !allowed}
                      onClick={() => void useStarter(starter)}
                      type="button"
                    >
                      {busyId === starter.id ? t("starter.creating") : t("starter.use")}
                    </button>
                  ) : compact && !canEdit ? (
                    <p className={galleryStyles.readOnlyNote}>{t("starter.readOnly")}</p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
        {!compact ? previewPanel : null}
      </div>
      {compact ? previewPanel : null}
      {visibleStarters.length > 0 && orderedStarters.length === 0 ? (
        <p role="status">{t("starter.noMatches")}</p>
      ) : null}
      {!visibleStarters.length && !loadError ? (
        <div className={styles.emptyState}>
          <h3>{t("starter.emptyTitle")}</h3>
          <p>{t("starter.emptyDescription")}</p>
        </div>
      ) : null}
    </div>
  );
}
