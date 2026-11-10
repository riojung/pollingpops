"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { AuthoringAssistant } from "../../../components/authoring-assistant";
import { useLocale } from "../../../components/locale-provider";
import { apiFetch, humanError } from "../../../lib/api";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import { recordCreationEvent } from "../../../components/workspace/product-events";
import { PresentationTemplateGallery } from "../../../components/workspace/presentation-template-gallery";
import { PresentationOutlineStart } from "../../../components/workspace/presentation-outline-start";
import { presentationStartCopy } from "../../../components/workspace/presentation-start-copy";
import { creatorWorkflowCopy } from "../../../components/editor/creator-workflow-copy";
import styles from "./presentation-launcher.module.css";

function PresentationLauncher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useLocale();
  const workflowCopy = creatorWorkflowCopy(locale);
  const startCopy = presentationStartCopy(locale);
  const { canEdit } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [error, setError] = useState("");

  async function createBlankPresentation() {
    if (!canEdit || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError("");
    recordCreationEvent("creation_started", "blank", "presentation");
    try {
      const response = await apiFetch<{ presentation: { id: string } }>("/v1/presentations", {
        method: "POST",
        body: JSON.stringify({
          title: t("delivery.presentationBuilder.untitled"),
          description: "",
          initialSlide: "native",
        }),
      });
      recordCreationEvent("creation_completed", "blank", "presentation");
      router.push(`/presentation/${response.presentation.id}`);
    } catch (caught) {
      setError(humanError(caught));
      creatingRef.current = false;
      setCreating(false);
    }
  }

  const requestedStarts = searchParams.getAll("start");
  const selectedStart =
    requestedStarts.length === 1 && ["source", "template", "outline"].includes(requestedStarts[0]!)
      ? requestedStarts[0]
      : null;

  return (
    <WorkspaceShell
      actions={
        <Link className="button-quiet" href="/create">
          {t("create.presentation.switchToRound")}
        </Link>
      }
      description={t("create.presentation.description")}
      eyebrow={t("create.presentation.eyebrow")}
      requiredFeature="presentations"
      title={t("create.presentation.title")}
      translationLevel="full"
    >
      {!canEdit ? (
        <div className={styles.emptyCanvas}>
          <div>
            <span className={styles.emptyMark} aria-hidden="true">
              P
            </span>
            <h2>{t("create.common.readOnlyTitle")}</h2>
            <p>{t("create.presentation.readOnlyDescription")}</p>
            <Link className="button-quiet" href="/discover">
              {t("create.presentation.browseDiscover")}
            </Link>
          </div>
        </div>
      ) : (
        <>
          {selectedStart ? (
            <div className={styles.methodToolbar}>
              <Link className="button-quiet small-button" href="/create/presentation">
                {t("create.common.allStartingPoints")}
              </Link>
              <span lang={locale}>
                {selectedStart === "source"
                  ? t("create.common.sourceGrounded")
                  : selectedStart === "outline"
                    ? startCopy.fromOutline
                    : t("create.common.presentationTemplate")}
              </span>
            </div>
          ) : null}
          {!selectedStart ? (
            <section className={styles.blankStart}>
              <span className={styles.blankMark} aria-hidden="true">
                <svg viewBox="0 0 72 52" fill="none">
                  <rect x="2" y="2" width="68" height="48" rx="5" />
                  <path d="M28 26h16M36 18v16" />
                </svg>
              </span>
              <div className={styles.blankCopy}>
                <p className={styles.kicker}>{t("create.common.fullControl")}</p>
                <h2>{t("create.presentation.method.blank.title")}</h2>
                <p>{t("create.presentation.method.blank.description")}</p>
              </div>
              <button
                className="button"
                disabled={creating}
                onClick={() => void createBlankPresentation()}
                type="button"
              >
                {creating
                  ? t("create.presentation.method.blank.creating")
                  : t("create.presentation.method.blank.action")}
              </button>
            </section>
          ) : null}

          {error ? (
            <p className="error" lang="en-CA" role="alert">
              {error}
            </p>
          ) : null}

          {!selectedStart ? (
            <details className={styles.alternatives}>
              <summary>{workflowCopy.otherStartingPoints}</summary>
              <div className={styles.methodGrid}>
                <Link className={styles.methodCard} href="/create/presentation?start=source">
                  <small>{startCopy.sourceAssistance}</small>
                  <h3>{t("create.presentation.method.source.title")}</h3>
                  <p>{startCopy.sourceWarning}</p>
                  <span className={styles.cardLink}>
                    {t("create.presentation.method.source.action")}
                  </span>
                </Link>
                <Link
                  className={styles.methodCard}
                  href="/create/presentation?start=outline"
                  lang={locale}
                  aria-label={startCopy.fromOutline}
                >
                  <small>{startCopy.optionalAI}</small>
                  <h3>{startCopy.fromOutline}</h3>
                  <p>{startCopy.outlineCard}</p>
                  <span className={styles.cardLink}>{startCopy.outlineAction}</span>
                </Link>
              </div>
            </details>
          ) : null}

          {!selectedStart || selectedStart === "template" ? (
            <section className={styles.templates} aria-labelledby="presentation-templates-title">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.kicker}>{t("create.common.fastestStart")}</p>
                  <h2 id="presentation-templates-title">
                    {t("create.presentation.templates.title")}
                  </h2>
                  <p>{t("create.presentation.method.template.description")}</p>
                </div>
                {!selectedStart ? (
                  <Link
                    className="button-quiet small-button"
                    href="/create/presentation?start=template"
                  >
                    <span>{startCopy.browseTemplates}</span>
                  </Link>
                ) : null}
              </div>
              <PresentationTemplateGallery />
            </section>
          ) : null}

          {selectedStart === "source" ? (
            <section className={styles.panel}>
              <p className="eyebrow">{t("create.presentation.source.eyebrow")}</p>
              <h2>{t("create.presentation.source.title")}</h2>
              <p>{t("create.presentation.source.description")}</p>
              <div lang={locale}>
                <AuthoringAssistant
                  artifactType="presentation"
                  canEdit
                  plain
                  terminology="round"
                  trackCreation
                />
              </div>
            </section>
          ) : null}

          {selectedStart === "outline" ? <PresentationOutlineStart /> : null}

          <p className={styles.notice} lang={locale}>
            {startCopy.privateDraft}
          </p>
        </>
      )}
    </WorkspaceShell>
  );
}

export default function CreatePresentationPage() {
  return (
    <WorkspaceProvider>
      <PresentationLauncher />
    </WorkspaceProvider>
  );
}
