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
import { CreationMethodDetails } from "../../../components/workspace/creation-method-details";
import { PresentationDesignGallery } from "../../../components/workspace/presentation-design-gallery";
import { presentationDesignCopy } from "../../../lib/i18n/presentation-design-copy";
import { PresentationTemplateGallery } from "../../../components/workspace/presentation-template-gallery";
import { PresentationOutlineStart } from "../../../components/workspace/presentation-outline-start";
import { presentationStartCopy } from "../../../components/workspace/presentation-start-copy";
import { creationMethodCopy } from "../../../lib/i18n/creation-method-copy";
import { creationGoalMessages } from "../../../lib/i18n/creation-goal-messages";
import {
  presentationCreationHref,
  resolvePresentationCreation,
} from "../../../components/workspace/workspace-creation-model";
import styles from "./presentation-launcher.module.css";

function PresentationLauncher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useLocale();
  const designCopy = presentationDesignCopy(locale);
  const startCopy = presentationStartCopy(locale);
  const methodCopy = creationMethodCopy(locale);
  const goals = creationGoalMessages(locale);
  const { creator, canEdit, productFeatures, loading, error: workspaceError } = useWorkspace();
  const canCreate = Boolean(
    creator?.userId &&
    creator.workspaceId &&
    canEdit &&
    !loading &&
    !workspaceError &&
    productFeatures?.presentations === true,
  );
  const allowed = useRef(canCreate);
  allowed.current = canCreate;
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [error, setError] = useState("");
  const selection = resolvePresentationCreation(searchParams);
  const selectedStart = selection.method;

  async function createBlankPresentation() {
    if (!allowed.current || creatingRef.current) return;
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

  const methodLabels = {
    blank: t("create.presentation.method.blank.title"),
    source: t("create.common.sourceGrounded"),
    template: t("create.common.presentationTemplate"),
    outline: startCopy.fromOutline,
    design: designCopy.fromDesign,
  };
  const detailMethods = {
    blank: "presentationBlank",
    source: "presentationSource",
    template: "presentationTemplate",
    outline: "presentationOutline",
    design: "presentationDesign",
  } as const;

  return (
    <WorkspaceShell
      actions={
        <Link className="button-quiet" href="/create">
          {goals.allGoals}
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
      ) : canCreate ? (
        <>
          {selectedStart || selection.issue ? (
            <div className={styles.methodToolbar}>
              <Link className="button-quiet small-button" href={presentationCreationHref()}>
                {methodCopy.allMethods}
              </Link>
              {selectedStart ? <span>{methodLabels[selectedStart]}</span> : null}
            </div>
          ) : null}
          {selection.issue ? <p role="status">{methodCopy.invalidSelection}</p> : null}
          {selectedStart ? <CreationMethodDetails method={detailMethods[selectedStart]} /> : null}

          {!selectedStart || selectedStart === "blank" ? (
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
              {selectedStart === "blank" ? (
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
              ) : (
                <Link className="button" href={presentationCreationHref("blank")}>
                  {t("create.presentation.method.blank.action")}
                </Link>
              )}
            </section>
          ) : null}

          {error ? (
            <p className="error" lang="en-CA" role="alert">
              {error}
            </p>
          ) : null}

          {!selectedStart ? (
            <nav className={styles.alternatives} aria-label={methodCopy.allMethods}>
              <div className={styles.methodGrid}>
                <Link className={styles.methodCard} href={presentationCreationHref("template")}>
                  <small>{t("create.common.fastestStart")}</small>
                  <h3>{designCopy.contentTemplates}</h3>
                  <p>{t("create.presentation.method.template.description")}</p>
                  <span className={styles.cardLink}>{startCopy.browseTemplates}</span>
                </Link>
                <Link className={styles.methodCard} href={presentationCreationHref("design")}>
                  <small>{designCopy.fromDesign}</small>
                  <h3>{designCopy.title}</h3>
                  <p>{designCopy.description}</p>
                  <span className={styles.cardLink}>{designCopy.browseDesigns}</span>
                </Link>
                <Link className={styles.methodCard} href={presentationCreationHref("source")}>
                  <small>{startCopy.sourceAssistance}</small>
                  <h3>{t("create.presentation.method.source.title")}</h3>
                  <p>{startCopy.sourceWarning}</p>
                  <span className={styles.cardLink}>
                    {t("create.presentation.method.source.action")}
                  </span>
                </Link>
                <Link
                  className={styles.methodCard}
                  href={presentationCreationHref("outline")}
                  aria-label={startCopy.fromOutline}
                >
                  <small>{startCopy.optionalAI}</small>
                  <h3>{startCopy.fromOutline}</h3>
                  <p>{startCopy.outlineCard}</p>
                  <span className={styles.cardLink}>{startCopy.outlineAction}</span>
                </Link>
              </div>
            </nav>
          ) : null}

          {selectedStart === "design" ? (
            <section className={styles.templates} aria-labelledby="presentation-designs-title">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.kicker}>{designCopy.fromDesign}</p>
                  <h2 id="presentation-designs-title">{designCopy.title}</h2>
                  <p>{designCopy.description}</p>
                </div>
              </div>
              <PresentationDesignGallery />
            </section>
          ) : null}

          {selectedStart === "template" ? (
            <section className={styles.templates} aria-labelledby="presentation-templates-title">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.kicker}>{t("create.common.fastestStart")}</p>
                  <h2 id="presentation-templates-title">{designCopy.contentTemplates}</h2>
                  <p>{t("create.presentation.method.template.description")}</p>
                </div>
              </div>
              <PresentationTemplateGallery />
            </section>
          ) : null}

          {selectedStart === "source" ? (
            <section className={styles.panel}>
              <p className="eyebrow">{t("create.presentation.source.eyebrow")}</p>
              <h2>{t("create.presentation.source.title")}</h2>
              <p>{t("create.presentation.source.description")}</p>
              <div>
                <AuthoringAssistant
                  artifactType="presentation"
                  canEdit={canCreate}
                  plain
                  terminology="round"
                  trackCreation
                />
              </div>
            </section>
          ) : null}
          {selectedStart === "outline" ? <PresentationOutlineStart /> : null}
          <p className={styles.notice}>{startCopy.privateDraft}</p>
        </>
      ) : null}
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
