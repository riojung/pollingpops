"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthoringAssistant } from "../../../components/authoring-assistant";
import { useLocale } from "../../../components/locale-provider";
import { apiFetch, humanError } from "../../../lib/api";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import { recordCreationEvent } from "../../../components/workspace/product-events";
import { PresentationTemplateGallery } from "../../../components/workspace/presentation-template-gallery";
import styles from "../../../components/workspace/workspace-hub.module.css";

function PresentationLauncher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const { canEdit } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function createBlankPresentation() {
    setCreating(true);
    setError("");
    recordCreationEvent("creation_started", "blank", "presentation");
    try {
      const response = await apiFetch<{ presentation: { id: string } }>("/v1/presentations", {
        method: "POST",
        body: JSON.stringify({
          title: "Untitled presentation",
          description: "",
        }),
      });
      recordCreationEvent("creation_completed", "blank", "presentation");
      router.push(`/presentation/${response.presentation.id}`);
    } catch (caught) {
      setError(humanError(caught));
      setCreating(false);
    }
  }

  const selectedStart = searchParams.get("start");

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
              <span>
                {selectedStart === "source"
                  ? t("create.common.sourceGrounded")
                  : t("create.common.presentationTemplate")}
              </span>
            </div>
          ) : null}
          {!selectedStart ? (
            <div className={styles.methodGrid}>
              <Link className={styles.methodCard} href="/create/presentation?start=source">
                <span className={styles.cardIcon} data-tone="violet">
                  S
                </span>
                <small>{t("create.presentation.method.source.kicker")}</small>
                <h2>{t("create.presentation.method.source.title")}</h2>
                <p>{t("create.presentation.method.source.description")}</p>
                <span className={styles.cardLink}>
                  {t("create.presentation.method.source.action")}
                </span>
              </Link>
              <Link className={styles.methodCard} href="/create/presentation?start=template">
                <span className={styles.cardIcon}>T</span>
                <small>{t("create.common.fastestStart")}</small>
                <h2>{t("create.presentation.method.template.title")}</h2>
                <p>{t("create.presentation.method.template.description")}</p>
                <span className={styles.cardLink}>
                  {t("create.presentation.method.template.action")}
                </span>
              </Link>
              <button
                className={styles.methodCard}
                disabled={creating}
                onClick={() => void createBlankPresentation()}
                type="button"
              >
                <span className={styles.cardIcon} data-tone="coral">
                  B
                </span>
                <small>{t("create.common.fullControl")}</small>
                <h2>{t("create.presentation.method.blank.title")}</h2>
                <p>{t("create.presentation.method.blank.description")}</p>
                <span className={styles.cardLink}>
                  {creating
                    ? t("create.presentation.method.blank.creating")
                    : t("create.presentation.method.blank.action")}
                </span>
              </button>
            </div>
          ) : null}

          {selectedStart === "source" ? (
            <section className={styles.panel}>
              <p className="eyebrow">{t("create.presentation.source.eyebrow")}</p>
              <h2>{t("create.presentation.source.title")}</h2>
              <p>{t("create.presentation.source.description")}</p>
              <div lang="en-CA">
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

          {selectedStart === "template" ? (
            <section className={styles.panel}>
              <p className="eyebrow">{t("create.presentation.templates.eyebrow")}</p>
              <h2>{t("create.presentation.templates.title")}</h2>
              <PresentationTemplateGallery />
            </section>
          ) : null}

          {error ? (
            <p className="error" lang="en-CA" role="alert">
              {error}
            </p>
          ) : null}

          <p className={styles.notice}>
            <strong>{t("create.presentation.notice.title")}</strong>{" "}
            {t("create.presentation.notice.description")}
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
