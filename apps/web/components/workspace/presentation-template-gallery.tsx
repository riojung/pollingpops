"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PresentationDraft } from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import { formatNumber } from "../../lib/i18n/format";
import {
  instantiatePresentationTemplate,
  allPresentationTemplates,
  type PresentationTemplateId,
} from "../../lib/presentation-templates";
import { clientUuid } from "../../lib/uuid";
import { useLocale } from "../locale-provider";
import { useWorkspace } from "./workspace-provider";
import { recordAuthoringEvent, recordCreationEvent } from "./product-events";
import styles from "./presentation-template-gallery.module.css";
import {
  PresentationTemplateThumbnail,
  PresentationTemplatePreview,
} from "./presentation-template-preview";

const scenarioFilters: Array<{
  id: string;
  label: string;
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

const discussionScenarios: Partial<Record<PresentationTemplateId, string>> = {
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
  const { canEdit, productFeatures } = useWorkspace();
  const [search, setSearch] = useState("");
  const [scenario, setScenario] = useState("all");
  const [preview, setPreview] = useState<{
    id: PresentationTemplateId;
    draft: PresentationDraft;
  } | null>(null);
  const [busyId, setBusyId] = useState<PresentationTemplateId | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(new Map<PresentationTemplateId, PendingTemplate>());
  const creating = useRef(false);
  const selectedFilter = scenarioFilters.find((filter) => filter.id === scenario)!;
  const visibleTemplates = allPresentationTemplates.filter(
    (template) =>
      (scenario === "all" || selectedFilter.templates.includes(template.id)) &&
      `${template.scenarioLabel} ${discussionScenarios[template.id] ?? ""} ${template.title} ${template.description} ${template.id}`
        .toLocaleLowerCase(locale)
        .includes(search.trim().toLocaleLowerCase(locale)),
  );
  const filtered = search.length > 0 || scenario !== "all";

  function clearFilters() {
    setSearch("");
    setScenario("all");
  }

  async function useTemplate(id: PresentationTemplateId) {
    if (creating.current || !canEdit || !productFeatures?.presentations) return;
    creating.current = true;
    setBusyId(id);
    setError("");
    recordCreationEvent("creation_started", "starter", "presentation");
    try {
      let attempt = pending.current.get(id);
      if (!attempt) {
        const draft = instantiatePresentationTemplate(id);
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
        <div
          className={styles.scenarios}
          role="group"
          aria-label="Filter templates by use case"
          lang="en-CA"
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
              {filter.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.gallerySummary}>
        <p role="status" aria-live="polite">
          <strong>
            {t("templateLibrary.count", { count: formatNumber(locale, visibleTemplates.length) })}
          </strong>
          <span>{t("templateLibrary.englishContent")}</span>
        </p>
        {filtered ? (
          <button className={styles.clearFilters} type="button" onClick={clearFilters} lang="en-CA">
            Clear filters
          </button>
        ) : null}
      </div>
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
                <PresentationTemplateThumbnail templateId={template.id} />
                <span className={styles.collectionLabel} lang="en-CA">
                  {activityCount > 0 ? "Slides + audience activities" : "Slides + speaker notes"}
                </span>
              </div>
              <div className={styles.cardBody}>
                <small className={styles.scenarioLabel} lang="en-CA">
                  {discussionScenarios[template.id] ?? template.scenarioLabel}
                </small>
                <h3 lang="en-CA">{template.title}</h3>
                <p lang="en-CA">{template.description}</p>
                <div className={styles.metaLine} lang="en-CA">
                  <span>{formatNumber(locale, contentCount)} content slides</span>
                  <span>
                    {formatNumber(locale, activityCount)} audience{" "}
                    {activityCount === 1 ? "activity" : "activities"}
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
                        draft: instantiatePresentationTemplate(template.id),
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
      {visibleTemplates.length === 0 ? (
        <div className={styles.noMatches}>
          <h3>{t("starter.noMatches")}</h3>
          <p lang="en-CA">Try another search or clear the filters to see every template.</p>
        </div>
      ) : null}
      {preview ? (
        <PresentationTemplatePreview
          key={preview.id}
          draft={preview.draft}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
