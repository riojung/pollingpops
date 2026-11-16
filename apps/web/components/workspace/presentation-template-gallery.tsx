"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PresentationDraft, SupportedLocale } from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import {
  presentationTemplateCopy,
  templateLoadError,
} from "../../lib/i18n/presentation-template-copy";
import { formatNumber } from "../../lib/i18n/format";
import { templateGuideCopy } from "../../lib/i18n/template-guide-copy";
import {
  instantiatePresentationTemplate,
  allPresentationTemplatesForLocale,
  type PresentationTemplateId,
} from "../../lib/presentation-templates";
import {
  isPresentationTemplateLocaleLoaded,
  loadPresentationTemplateLocale,
} from "../../lib/presentation-template-locales";
import { clientUuid } from "../../lib/uuid";
import { useLocale } from "../locale-provider";
import { useWorkspace } from "./workspace-provider";
import { recordAuthoringEvent, recordCreationEvent } from "./product-events";
import styles from "./presentation-template-gallery.module.css";
import {
  PresentationTemplateThumbnail,
  PresentationTemplatePreview,
} from "./presentation-template-preview";

const visualStyleLabels = {
  editorial: "Editorial",
  briefing: "Briefing",
  workshop: "Workshop",
} as const;
type VisualStyle = keyof typeof visualStyleLabels;

type TemplateUiKey = Parameters<ReturnType<typeof presentationTemplateCopy>>[0];
const scenarioFilters: Array<{
  id: string;
  label: TemplateUiKey;
  templates: PresentationTemplateId[];
}> = [
  { id: "all", label: "All templates", templates: [] },
  {
    id: "pitch",
    label: "Pitch & propose",
    templates: ["native-startup-pitch", "native-client-proposal"],
  },
  {
    id: "team",
    label: "Meet & decide",
    templates: [
      "native-project-update",
      "native-quarterly-strategy",
      "native-business-decision-brief",
      "meeting",
      "kickoff",
      "retrospective",
      "decision",
    ],
  },
  {
    id: "demo",
    label: "Demo & onboard",
    templates: ["native-product-demo", "native-customer-onboarding", "demo", "onboarding"],
  },
  {
    id: "learn",
    label: "Teach & explore",
    templates: [
      "native-practical-workshop",
      "native-lesson-explainer",
      "native-research-findings",
      "review",
      "training",
      "workshop",
    ],
  },
  {
    id: "creative",
    label: "Talks & portfolios",
    templates: ["native-portfolio-case-study", "native-event-talk"],
  },
];

const discussionScenarios: Partial<Record<PresentationTemplateId, TemplateUiKey>> = {
  review: "Evidence & discussion",
  training: "Training & practice",
  meeting: "Team meeting",
  kickoff: "Project kickoff",
  retrospective: "Team retrospective",
  onboarding: "Team onboarding",
  workshop: "Practical workshop",
  decision: "Group decision",
  demo: "Product demo",
};

type PendingTemplate = {
  presentationId: string;
  revision: number;
  mutationId: string;
  draft: PresentationDraft;
};

export function PresentationTemplateGallery() {
  const router = useRouter();
  const { locale, t } = useLocale();
  const copy = presentationTemplateCopy(locale);
  const guideCopy = templateGuideCopy(locale);
  const { canEdit, productFeatures } = useWorkspace();
  const [search, setSearch] = useState("");
  const [scenario, setScenario] = useState("all");
  const [visualStyle, setVisualStyle] = useState<VisualStyle | "all">("all");
  const [preview, setPreview] = useState<{
    id: PresentationTemplateId;
    locale: SupportedLocale;
    draft: PresentationDraft;
  } | null>(null);
  const [busyId, setBusyId] = useState<PresentationTemplateId | null>(null);
  const [error, setError] = useState("");
  const [loadState, setLoadState] = useState<{ locale: SupportedLocale; failed: boolean } | null>(
    null,
  );
  const [loadAttempt, setLoadAttempt] = useState(0);
  const ready = isPresentationTemplateLocaleLoaded(locale);
  useEffect(() => {
    if (isPresentationTemplateLocaleLoaded(locale)) return;
    let cancelled = false;
    void loadPresentationTemplateLocale(locale).then(
      () => {
        if (!cancelled) setLoadState({ locale, failed: false });
      },
      () => {
        if (!cancelled) setLoadState({ locale, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [locale, loadAttempt]);
  const pending = useRef(new Map<PresentationTemplateId, PendingTemplate>());
  const creating = useRef(false);
  const selectedFilter = scenarioFilters.find((filter) => filter.id === scenario)!;
  const templates = useMemo(
    () => (ready ? allPresentationTemplatesForLocale(locale) : []),
    [locale, ready],
  );
  const visibleTemplates = templates.filter(
    (template) =>
      (scenario === "all" || selectedFilter.templates.includes(template.id)) &&
      (visualStyle === "all" ||
        (template.collection === "native" && template.visualStyle === visualStyle)) &&
      `${template.scenarioLabel} ${discussionScenarios[template.id] ? copy(discussionScenarios[template.id]!) : ""} ${template.title} ${template.description} ${template.id}`
        .toLocaleLowerCase(locale)
        .includes(search.trim().toLocaleLowerCase(locale)),
  );
  const filtered = search.length > 0 || scenario !== "all" || visualStyle !== "all";

  function clearFilters() {
    setSearch("");
    setScenario("all");
    setVisualStyle("all");
  }

  async function useTemplate(id: PresentationTemplateId) {
    if (creating.current || !canEdit || !productFeatures?.presentations || !ready) return;
    creating.current = true;
    setBusyId(id);
    setError("");
    recordCreationEvent("creation_started", "starter", "presentation");
    try {
      let attempt = pending.current.get(id);
      if (!attempt) {
        const draft = instantiatePresentationTemplate(id, locale);
        const created = await apiFetch<{ presentation: { id: string; draftRevision: number } }>(
          "/v1/presentations",
          {
            method: "POST",
            body: JSON.stringify({ title: draft.title, description: draft.description }),
          },
        );
        attempt = {
          presentationId: created.presentation.id,
          revision: created.presentation.draftRevision,
          mutationId: clientUuid(),
          draft,
        };
        pending.current.set(id, attempt);
      }
      await apiFetch(`/v1/presentations/${attempt.presentationId}/draft`, {
        method: "PUT",
        body: JSON.stringify({
          draft: attempt.draft,
          expectedRevision: attempt.revision,
          mutationId: attempt.mutationId,
          schemaVersion: 2,
        }),
      });
      recordCreationEvent("creation_completed", "starter", "presentation");
      recordAuthoringEvent("first_block_created", "presentation");
      router.push(`/presentation/${attempt.presentationId}`);
    } catch (caught) {
      setError(humanError(caught));
      setBusyId(null);
      creating.current = false;
    }
  }

  return (
    <div className={styles.gallery} lang={locale}>
      <div className={styles.filters}>
        <div className={styles.filterFields}>
          <label className={`field ${styles.search}`}>
            <span>{t("templateLibrary.searchPresentations")}</span>
            <input
              className="input"
              type="search"
              aria-controls="presentation-template-results"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className={`field ${styles.styleFilter}`}>
            <span>{guideCopy("Visual style")}</span>
            <select
              className="input"
              value={visualStyle}
              onChange={(event) => setVisualStyle(event.target.value as VisualStyle | "all")}
              aria-controls="presentation-template-results"
            >
              <option value="all">{guideCopy("All styles")}</option>
              {Object.entries(visualStyleLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {guideCopy(label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          className={styles.scenarios}
          role="group"
          aria-label={copy("Filter templates by use case")}
        >
          {scenarioFilters.map((filter) => (
            <button
              key={filter.id}
              className={styles.filterChip}
              type="button"
              aria-pressed={scenario === filter.id}
              aria-controls="presentation-template-results"
              onClick={() => setScenario(filter.id)}
            >
              {copy(filter.label)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.gallerySummary}>
        <p role="status" aria-live="polite">
          <strong>
            {ready
              ? t("templateLibrary.count", { count: formatNumber(locale, visibleTemplates.length) })
              : t("starter.loading")}
          </strong>
          <span>{t("templateLibrary.englishContent")}</span>
        </p>
        {filtered ? (
          <button className={styles.clearFilters} type="button" onClick={clearFilters}>
            {copy("Clear filters")}
          </button>
        ) : null}
      </div>
      {!ready && loadState?.locale === locale && loadState.failed ? (
        <div>
          <p className="error" role="alert">
            {templateLoadError(locale)}
          </p>
          <button
            className="button-quiet"
            type="button"
            onClick={() => {
              setLoadState(null);
              setLoadAttempt((value) => value + 1);
            }}
          >
            {t("starter.retry")}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.starterGrid} id="presentation-template-results">
        {visibleTemplates.map((template) => {
          const contentCount = template.blocks.filter((block) => block.kind === "content").length;
          const activityCount = template.blocks.length - contentCount;
          return (
            <article
              className={styles.templateCard}
              data-category={template.category}
              data-template-id={template.id}
              data-template-collection={template.collection}
              key={template.id}
            >
              <div className={styles.cardVisual}>
                <PresentationTemplateThumbnail templateId={template.id} locale={locale} />
                <span className={styles.collectionLabel}>
                  {copy(
                    activityCount > 0 ? "Slides + audience activities" : "Slides + speaker notes",
                  )}
                </span>
              </div>
              <div className={styles.cardBody}>
                <small className={styles.scenarioLabel}>
                  {discussionScenarios[template.id]
                    ? copy(discussionScenarios[template.id]!)
                    : template.scenarioLabel}
                </small>
                <h3>{template.title}</h3>
                <p>{template.description}</p>
                <div className={styles.metaLine}>
                  {template.collection === "native" ? (
                    <span className={styles.designTag}>
                      {guideCopy(visualStyleLabels[template.visualStyle])}
                    </span>
                  ) : null}
                  <span>
                    {copy("Content slides: {count}", { count: formatNumber(locale, contentCount) })}
                  </span>
                  <span>
                    {copy("Audience activities: {count}", {
                      count: formatNumber(locale, activityCount),
                    })}
                  </span>
                </div>
                <div className={styles.cardActions}>
                  {canEdit && productFeatures?.presentations ? (
                    <button
                      className="button small-button"
                      disabled={Boolean(busyId)}
                      onClick={() => void useTemplate(template.id)}
                      type="button"
                    >
                      {busyId === template.id
                        ? t("templateLibrary.creatingPresentation")
                        : t("templateLibrary.usePresentation")}
                    </button>
                  ) : !canEdit ? (
                    <p className={styles.readOnlyNote}>{t("starter.readOnly")}</p>
                  ) : null}
                  <button
                    className="button-quiet small-button"
                    type="button"
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      event.currentTarget.focus();
                      setPreview({
                        id: template.id,
                        locale,
                        draft: instantiatePresentationTemplate(template.id, locale),
                      });
                    }}
                  >
                    {t("templateLibrary.previewStructure")}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {ready && visibleTemplates.length === 0 ? (
        <div className={styles.noMatches}>
          <h3>{t("starter.noMatches")}</h3>
          <p>{copy("Try another search or clear the filters to see every template.")}</p>
        </div>
      ) : null}
      {preview ? (
        <PresentationTemplatePreview
          key={preview.id}
          draft={preview.draft}
          contentLocale={preview.locale}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
