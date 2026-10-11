"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import { StarterGallery } from "../../../components/workspace/starter-gallery";
import { apiFetch, humanError } from "../../../lib/api";
import styles from "../../../components/workspace/workspace-content.module.css";
import { surveyMutationKey } from "../../../lib/survey-client";

function CreateSurvey() {
  const router = useRouter();
  const { canEdit, productFeatures } = useWorkspace();
  const key = useRef("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <WorkspaceShell
      title="Create a Survey"
      eyebrow="Independent, self-paced feedback"
      description="Share a link, QR code, or seven-digit code. No participant accounts, aliases, timers, or scores."
      actions={
        <Link className="button-quiet" href="/create">
          All activity types
        </Link>
      }
    >
      <p className="notice">
        Organizers cannot see who submitted which answers. Results are question-level only and
        appear only after the run closes, with at least five responses per question. One completion
        per room credential is enforced—not verified one-person participation.
      </p>
      {canEdit && productFeatures?.surveys ? (
        <>
          <section className={styles.panel}>
            <h2>Start blank</h2>
            <p>
              Build with unscored choice polls and labeled rating scales. Open text, ranking, and
              word clouds are not included yet.
            </p>
            {error ? (
              <p role="alert" className="error">
                {error}
              </p>
            ) : null}
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                key.current ||= surveyMutationKey();
                try {
                  const { survey } = await apiFetch<{ survey: { id: string } }>("/v1/surveys", {
                    method: "POST",
                    body: JSON.stringify({ idempotencyKey: key.current }),
                  });
                  router.push(`/surveys/${survey.id}`);
                } catch (caught) {
                  setError(humanError(caught));
                  setBusy(false);
                }
              }}
            >
              Create blank Survey
            </button>
          </section>
          <section className={styles.panel}>
            <h2>Start from a feedback template</h2>
            <p>These opinion-only templates create Surveys, not live Rounds.</p>
            <StarterGallery survey roundType="poll" />
          </section>
        </>
      ) : (
        <p>
          Survey creation is not enabled for this workspace yet, or your role is read-only. An
          operator must enable FEATURE_AUDIENCE_SCOPES, FEATURE_FEEDBACK_ROOMS, and FEATURE_SURVEYS
          and include your workspace in CORE_PARITY_WORKSPACE_ALLOWLIST.{" "}
          <Link href="/surveys">View existing Surveys</Link>.
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
