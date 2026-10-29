"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PresentationDraft } from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import { formatNumber } from "../../lib/i18n/format";
import {
  instantiatePresentationTemplate,
  presentationTemplates,
  type PresentationTemplateId,
} from "../../lib/presentation-templates";
import { clientUuid } from "../../lib/uuid";
import { useLocale } from "../locale-provider";
import { useWorkspace } from "./workspace-provider";
import { recordAuthoringEvent, recordCreationEvent } from "./product-events";
import styles from "./workspace-content.module.css";
import galleryStyles from "./template-gallery.module.css";

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
  const [preview, setPreview] = useState<PresentationTemplateId | null>(null);
  const [busyId, setBusyId] = useState<PresentationTemplateId | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(new Map<PresentationTemplateId, PendingTemplate>());
  const creating = useRef(false);
  const visibleTemplates = presentationTemplates.filter((template) =>
    `${template.title} ${template.description}`
      .toLocaleLowerCase(locale)
      .includes(search.trim().toLocaleLowerCase(locale)),
  );

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
          schemaVersion: attempt.draft.schemaVersion,
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
    <div lang={locale}>
      <div className={galleryStyles.gallerySummary}>
        <strong>
          {t("templateLibrary.count", { count: formatNumber(locale, visibleTemplates.length) })}
        </strong>
        <span>{t("templateLibrary.englishContent")}</span>
      </div>
      <div className={styles.templateFilters}>
        <label className="field">
          <span>{t("templateLibrary.searchPresentations")}</span>
          <input
            className="input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.starterGrid}>
        {visibleTemplates.map((template) => (
          <article
            className={`${styles.starterCard} ${galleryStyles.templateCard}`}
            data-category={template.category}
            key={template.id}
          >
            <div className={styles.cardTopline}>
              <span className={styles.category}>{t(`category.${template.category}`)}</span>
            </div>
            <h3 lang="en-CA">{template.title}</h3>
            <p lang="en-CA">{template.description}</p>
            <div className={styles.metaLine}>
              <span>{t("create.common.presentationTemplate")}</span>
              <span>
                {t("templateLibrary.blockCount", {
                  count: formatNumber(locale, template.blocks.length),
                })}
              </span>
            </div>
            {preview === template.id ? (
              <ol
                className={galleryStyles.preview}
                id={`presentation-preview-${template.id}`}
                lang="en-CA"
              >
                {template.blocks.map((block, index) => (
                  <li key={index}>
                    <strong>{block.kind === "content" ? block.title : block.prompt}</strong>
                    {block.kind === "content" ? (
                      <p>{block.body}</p>
                    ) : block.kind === "check" ? (
                      <ul>
                        {block.labels.map((label) => (
                          <li key={label}>{label}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        1 — {block.low} / 5 — {block.high}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            ) : null}
            <div className={galleryStyles.cardActions}>
              <button
                className="button-quiet small-button"
                type="button"
                aria-expanded={preview === template.id}
                aria-controls={
                  preview === template.id ? `presentation-preview-${template.id}` : undefined
                }
                onClick={() => setPreview(preview === template.id ? null : template.id)}
              >
                {preview === template.id
                  ? t("starter.closePreview")
                  : t("templateLibrary.previewStructure")}
              </button>
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
            </div>
          </article>
        ))}
      </div>
      {visibleTemplates.length === 0 ? <p role="status">{t("starter.noMatches")}</p> : null}
    </div>
  );
}
