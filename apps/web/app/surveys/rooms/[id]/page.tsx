"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { surveyAggregate } from "@openround/contracts/surveys";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../../components/workspace/workspace-shell";
import { JoinAccess } from "../../../../components/join-access";
import { apiFetch, humanError } from "../../../../lib/api";
import { surveyMutationKey } from "../../../../lib/survey-client";
import styles from "../../../../components/workspace/workspace-content.module.css";

function Room() {
  const id = useParams<{ id: string }>().id;
  const router = useRouter();
  const { canEdit, creator } = useWorkspace();
  const [room, setRoom] = useState<{
    title: string;
    code: string;
    closesAt: string;
    closed: boolean;
  } | null>(null);
  const [results, setResults] = useState<ReturnType<typeof surveyAggregate> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try {
      const [r, data] = await Promise.all([
        apiFetch<{ room: NonNullable<typeof room> }>(`/v1/survey-rooms/${id}`),
        apiFetch<{ results: NonNullable<typeof results> }>(`/v1/survey-rooms/${id}/results`),
      ]);
      setRoom(r.room);
      setResults(data.results);
    } catch (caught) {
      setError(humanError(caught));
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  return (
    <WorkspaceShell
      title={room?.title || "Survey room"}
      description="Share this self-paced survey, then review question-level feedback."
      eyebrow="Anonymous feedback"
      actions={
        <Link className="button-quiet" href="/surveys">
          All Surveys
        </Link>
      }
    >
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {room ? (
        <section className={styles.panel}>
          <h2>
            {room.closed || new Date(room.closesAt) <= new Date()
              ? "Survey closed"
              : "Share your Survey"}
          </h2>
          <p>
            Code: <strong>{room.code}</strong>. Closes {new Date(room.closesAt).toLocaleString()}.
          </p>
          <JoinAccess code={room.code} editable={canEdit} activityName="Survey" />
          <p>
            No aliases or account identities are collected. Organizers cannot inspect linked
            respondent answers.
          </p>
          {canEdit ? (
            <div className={styles.surveyActions}>
              <button
                className="button-quiet"
                type="button"
                disabled={busy || room.closed}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await apiFetch(`/v1/survey-rooms/${id}/close`, {
                      method: "POST",
                      body: JSON.stringify({ idempotencyKey: surveyMutationKey() }),
                    });
                    await load();
                  } catch (caught) {
                    setError(humanError(caught));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Close admissions and submissions
              </button>
              {creator?.role === "owner" ? (
                <button
                  className="button-quiet"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Delete this survey run and all its responses? This cannot be undone.",
                      )
                    )
                      return;
                    setBusy(true);
                    try {
                      await apiFetch(`/v1/survey-rooms/${id}`, { method: "DELETE" });
                      router.push("/surveys");
                    } catch (caught) {
                      setError(humanError(caught));
                      setBusy(false);
                    }
                  }}
                >
                  Delete survey run
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : (
        <p role="status">Loading…</p>
      )}
      <section className={styles.panel}>
        <h2>Aggregate results</h2>
        <button className="button-quiet" type="button" onClick={() => void load()}>
          Refresh results
        </button>
        {results ? (
          <>
            <p>
              {results.submittedCount} finalized submissions. Only finalized responses are counted.
            </p>
            {results.suppressed ? (
              <p className="notice">
                {results.resultsStatus === "collecting"
                  ? "Distributions stay hidden while this Survey is open. Close admissions and submissions, or wait for the deadline, to release final results. Each question needs at least five responses."
                  : "Distributions are hidden because fewer than five respondents submitted."}
              </p>
            ) : (
              results.questions.map((question) => (
                <section key={question.id}>
                  <h3>{question.prompt}</h3>
                  {question.suppressed ? (
                    <p className="notice">
                      Distributions are hidden because this question has fewer than five responses.
                    </p>
                  ) : (
                    <>
                      <p>{question.answeredCount} responses</p>
                      <table>
                        <caption>Response counts</caption>
                        <thead>
                          <tr>
                            <th scope="col">Response</th>
                            <th scope="col">Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {question.distribution.map((row) => (
                            <tr key={row.label}>
                              <th scope="row">{row.label}</th>
                              <td>{row.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </section>
              ))
            )}
          </>
        ) : null}
      </section>
    </WorkspaceShell>
  );
}
export default function SurveyRoomPage() {
  return (
    <WorkspaceProvider>
      <Room />
    </WorkspaceProvider>
  );
}
