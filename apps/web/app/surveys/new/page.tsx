"use client";

import type { SupportedLocale } from "@openround/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { useLocale } from "../../../components/locale-provider";
import { CreationMethodDetails } from "../../../components/workspace/creation-method-details";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import { StarterGallery } from "../../../components/workspace/starter-gallery";
import {
  resolveSurveyCreation,
  surveyCreationHref,
} from "../../../components/workspace/workspace-creation-model";
import { apiFetch, humanError } from "../../../lib/api";
import { creationMethodCopy } from "../../../lib/i18n/creation-method-copy";
import styles from "../../../components/workspace/workspace-content.module.css";
import { surveyMutationKey } from "../../../lib/survey-client";

function CreateSurvey() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const copy = creationMethodCopy(locale);
  const { creator, canEdit, productFeatures, loading, error: workspaceError } = useWorkspace();
  const canCreate = Boolean(
    creator?.userId &&
    creator.workspaceId &&
    canEdit &&
    !loading &&
    !workspaceError &&
    productFeatures?.surveys === true,
  );
  const allowed = useRef(canCreate);
  allowed.current = canCreate;
  const pending = useRef<{ idempotencyKey: string; locale: SupportedLocale } | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selection = resolveSurveyCreation(searchParams);
  const method = selection.method;

  async function createBlankSurvey() {
    if (!allowed.current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    pending.current ??= { idempotencyKey: surveyMutationKey(), locale };
    try {
      const { survey } = await apiFetch<{ survey: { id: string } }>("/v1/surveys", {
        method: "POST",
        body: JSON.stringify(pending.current),
      });
      router.push(`/surveys/${survey.id}`);
    } catch (caught) {
      setError(humanError(caught));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <WorkspaceShell
      title={copy.survey.title}
      eyebrow={copy.survey.eyebrow}
      description={copy.survey.description}
      translationLevel="full"
      actions={
        <Link className="button-quiet" href="/create">
          {copy.survey.allTypes}
        </Link>
      }
    >
      <p className="notice">{copy.survey.privacy}</p>
      {canCreate ? (
        <>
          {method || selection.issue ? (
            <div className={styles.methodToolbar}>
              <Link className="button-quiet small-button" href={surveyCreationHref()}>
                {copy.allMethods}
              </Link>
              {method ? (
                <span>
                  {method === "blank" ? copy.survey.blankTitle : copy.survey.templateTitle}
                </span>
              ) : null}
            </div>
          ) : null}
          {selection.issue ? <p role="status">{copy.invalidSelection}</p> : null}
          {!method ? (
            <nav className={styles.starterGridCompact} aria-label={copy.allMethods}>
              <section className={styles.starterCard}>
                <h2>{copy.survey.blankTitle}</h2>
                <p>{copy.survey.blankDescription}</p>
                <Link className="button" href={surveyCreationHref("blank")}>
                  {copy.survey.blankTitle}
                </Link>
              </section>
              <section className={styles.starterCard}>
                <h2>{copy.survey.templateTitle}</h2>
                <p>{copy.survey.templateDescription}</p>
                <Link className="button-quiet" href={surveyCreationHref("template")}>
                  {copy.survey.templateTitle}
                </Link>
              </section>
            </nav>
          ) : (
            <>
              <CreationMethodDetails
                method={method === "blank" ? "surveyBlank" : "surveyTemplate"}
              />
              {method === "blank" ? (
                <section className={styles.panel}>
                  <h2>{copy.survey.blankTitle}</h2>
                  <p>{copy.survey.blankDescription}</p>
                  {error ? (
                    <p role="alert" className="error" lang="en-CA">
                      {error}
                    </p>
                  ) : null}
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => void createBlankSurvey()}
                  >
                    {busy ? copy.survey.creating : copy.survey.createBlank}
                  </button>
                </section>
              ) : (
                <section className={styles.panel}>
                  <h2>{copy.survey.templateTitle}</h2>
                  <p>{copy.survey.templateDescription}</p>
                  <StarterGallery survey roundType="poll" />
                </section>
              )}
            </>
          )}
        </>
      ) : (
        <p>
          {copy.survey.unavailable} <Link href="/surveys">{copy.survey.viewExisting}</Link>
        </p>
      )}
    </WorkspaceShell>
  );
}

export default function NewSurveyPage() {
  return (
    <WorkspaceProvider>
      <CreateSurvey />
    </WorkspaceProvider>
  );
}
