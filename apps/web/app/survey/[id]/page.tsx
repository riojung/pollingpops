"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SurveyResponses } from "@openround/contracts/surveys";
import { SurveyResponseControl } from "../../../components/survey-controls";
import { Brand } from "../../../components/brand";
import { apiFetch, humanError, ApiClientError } from "../../../lib/api";
import { surveyMutationKey, type SurveyAttempt } from "../../../lib/survey-client";

export default function SurveyPlayer() {
  const id = useParams<{ id: string }>().id;
  const [attempt, setAttempt] = useState<SurveyAttempt | null>(null);
  const [responses, setResponses] = useState<SurveyResponses>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pending = useRef<{ final: boolean; body: string } | null>(null);
  const token = useRef("");
  async function load() {
    setError("");
    try {
      token.current = window.localStorage.getItem(`pollingpops:survey:${id}`) ?? "";
      if (!token.current)
        throw new Error("Join this Survey using the shared link or seven-digit code first.");
      const result = await apiFetch<{ attempt: SurveyAttempt }>(`/v1/survey-rooms/${id}/attempt`, {
        credentials: "omit",
        headers: { authorization: `Bearer ${token.current}` },
      });
      setAttempt(result.attempt);
      setResponses(result.attempt.responses);
    } catch (caught) {
      setError(humanError(caught));
    }
  }
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [id]);
  const dirty = Boolean(attempt && JSON.stringify(attempt.responses) !== JSON.stringify(responses));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const closed = Boolean(
    attempt && (attempt.closed || new Date(attempt.closesAt).getTime() <= now),
  );
  async function save(final: boolean) {
    if (!attempt) return;
    setBusy(true);
    setError("");
    const operation = pending.current ?? {
      final,
      body: JSON.stringify({
        expectedRevision: attempt.revision,
        idempotencyKey: surveyMutationKey(),
        responses,
      }),
    };
    pending.current = operation;
    try {
      const result = await apiFetch<{ attempt: SurveyAttempt }>(
        `/v1/survey-rooms/${id}/${operation.final ? "submit" : "draft"}`,
        {
          method: "POST",
          credentials: "omit",
          headers: { authorization: `Bearer ${token.current}` },
          body: operation.body,
        },
      );
      setAttempt(result.attempt);
      setResponses(result.attempt.responses);
      setNotice(
        operation.final
          ? "Your responses were submitted."
          : "Progress saved. You can refresh or return on this browser.",
      );
      pending.current = null;
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status < 500 && caught.status !== 429)
        pending.current = null;
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-shell" lang="en-CA" style={{ maxWidth: 760 }}>
      <Brand />
      <h1>{attempt?.content.title || "Self-paced Survey"}</h1>
      <p>
        Answer at your own pace. No account or alias is requested. Your facilitator sees
        question-level totals only after the run closes, with at least five responses per question.
        Your browser stores a room-only credential for resume; clear site data to remove it.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}{" "}
          {pending.current ? (
            <button type="button" disabled={busy} onClick={() => void save(pending.current!.final)}>
              Retry same operation
            </button>
          ) : (
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          )}
        </p>
      ) : null}
      <p role="status">{notice}</p>
      {attempt?.finalized ? (
        <section className="card">
          <h2>Thank you</h2>
          <p>
            This Survey is complete. Receipt: {attempt.receipt}. One completed attempt is allowed
            per room credential.
          </p>
        </section>
      ) : attempt ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(true);
          }}
        >
          <p>{attempt.content.description}</p>
          {closed ? (
            <p className="notice">
              This Survey is closed. You can view saved progress, but cannot change or submit it.
            </p>
          ) : null}
          {attempt.content.items.map((item) => (
            <section className="card" style={{ marginBottom: 20 }} key={item.question.id}>
              <SurveyResponseControl
                required={item.required}
                question={item.question}
                response={responses[item.question.id]}
                disabled={closed || busy || Boolean(pending.current)}
                onChange={(response) => {
                  setNotice("");
                  setResponses((current) => {
                    const next = { ...current };
                    if (response) next[item.question.id] = response;
                    else delete next[item.question.id];
                    return next;
                  });
                }}
              />
            </section>
          ))}
          <p>
            {dirty ? "Unsaved responses — save progress before leaving." : "Progress is saved."}
          </p>
          <button
            className="button-quiet"
            type="button"
            disabled={closed || busy || Boolean(pending.current) || !dirty}
            onClick={() => void save(false)}
          >
            Save progress
          </button>{" "}
          <button
            className="button"
            type="submit"
            disabled={closed || busy || Boolean(pending.current)}
          >
            Submit Survey
          </button>
        </form>
      ) : null}
      <p>
        <Link href="/join">Join another activity</Link>
      </p>
    </main>
  );
}
