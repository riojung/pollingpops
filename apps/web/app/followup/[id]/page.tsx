"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ConfidenceValue, FollowupSnapshot, ResponsePayload } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { Countdown } from "../../../components/countdown";
import { QuestionMedia } from "../../../components/question-media";
import { API_URL, ApiClientError, humanError } from "../../../lib/api";
import { followupStatusAnnouncement } from "../../../lib/followup-announcement";
import {
  isCurrentFollowupAccess,
  releasePendingFollowupAttempt,
  reservePendingFollowupAttempt,
  shouldDiscardSavedAttemptForAccess,
  shouldReplaceSavedAttempt,
} from "../../../lib/followup-resume";
import { clientUuid } from "../../../lib/uuid";
import { FollowupInterventionCard } from "../../../components/practice/followup-intervention-card";
import {
  createFollowupCommandRecovery,
  mayApplyFollowupSnapshot,
  type FollowupCommandRecoveryState,
} from "../../../lib/followup-command-recovery";

async function followupFetch<T>(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiClientError(
      body?.error?.message ?? `Request failed (${response.status}).`,
      body?.error?.code,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

function FollowupContent() {
  const { id } = useParams<{ id: string }>();
  const [snapshot, setSnapshot] = useState<FollowupSnapshot | null>(null);
  const [attemptToken, setAttemptToken] = useState("");
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([]);
  const [numericValue, setNumericValue] = useState("");
  const [ratingValue, setRatingValue] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accessRevision, setAccessRevision] = useState(0);
  const accessRevisionRef = useRef(0);
  const confidenceControlRef = useRef<HTMLButtonElement>(null);
  const [commandState, setCommandState] = useState<FollowupCommandRecoveryState>({
    busy: false,
    pendingAction: null,
  });
  const snapshotRef = useRef<FollowupSnapshot | null>(null);
  const snapshotReady = useRef(false);
  const [snapshotSyncRequired, setSnapshotSyncRequired] = useState(false);
  const snapshotSyncBusy = useRef(false);
  const mounted = useRef(true);
  const recovery = useRef<{
    key: string;
    manager: ReturnType<typeof createFollowupCommandRecovery>;
  } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recovery.current?.manager.reset();
    };
  }, []);

  useEffect(() => {
    const heading = document.querySelector<HTMLElement>("#main h1");
    heading?.focus();
  }, [snapshot?.phase, snapshot?.question?.id, snapshot?.intervention?.index]);

  function adoptSnapshot(incoming: FollowupSnapshot) {
    if (!mayApplyFollowupSnapshot(snapshotRef.current, incoming)) return false;
    snapshotRef.current = incoming;
    snapshotReady.current = true;
    setSnapshotSyncRequired(false);
    setSnapshot(incoming);
    return true;
  }

  useEffect(() => {
    const handleHashChange = () => {
      const incomingAccessToken =
        new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      if (!incomingAccessToken) return;
      const accessKey = `openround:followup-access:${id}`;
      const attemptKey = `openround:followup-attempt:${id}`;
      const pendingAttemptKey = `openround:followup-pending-attempt:${id}`;
      const storedAccessToken = sessionStorage.getItem(accessKey) ?? "";
      if (shouldDiscardSavedAttemptForAccess(incomingAccessToken, storedAccessToken)) {
        sessionStorage.removeItem(attemptKey);
        sessionStorage.removeItem(pendingAttemptKey);
        setSnapshot(null);
        setAttemptToken("");
        setError("");
      }
      accessRevisionRef.current += 1;
      recovery.current?.manager.reset();
      recovery.current = null;
      setCommandState({ busy: false, pendingAction: null });
      snapshotReady.current = false;
      snapshotSyncBusy.current = false;
      setSnapshotSyncRequired(false);
      snapshotRef.current = null;
      setBusy(false);
      sessionStorage.setItem(accessKey, incomingAccessToken);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setAccessRevision(accessRevisionRef.current);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const accessKey = `openround:followup-access:${id}`;
    const attemptKey = `openround:followup-attempt:${id}`;
    const pendingAttemptKey = `openround:followup-pending-attempt:${id}`;
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    const storedAccessToken = sessionStorage.getItem(accessKey) ?? "";
    if (shouldDiscardSavedAttemptForAccess(fragmentToken, storedAccessToken)) {
      sessionStorage.removeItem(attemptKey);
      sessionStorage.removeItem(pendingAttemptKey);
    }
    if (fragmentToken) {
      sessionStorage.setItem(accessKey, fragmentToken);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    const accessToken = fragmentToken || storedAccessToken;
    const savedAttemptToken = sessionStorage.getItem(attemptKey) ?? "";
    const accessIsCurrent = () =>
      isCurrentFollowupAccess(accessToken, sessionStorage.getItem(accessKey) ?? "", cancelled);

    const start = async () => {
      if (!accessToken) {
        throw new Error(
          "This practice link is missing its private access token. Ask the facilitator for a new link.",
        );
      }
      const clientAttemptToken = reservePendingFollowupAttempt(
        sessionStorage,
        pendingAttemptKey,
        () => `${clientUuid()}${clientUuid()}`,
      );
      const result = await followupFetch<{
        attemptToken: string;
        snapshot: FollowupSnapshot;
      }>(`/v1/followups/${id}/start`, accessToken, {
        method: "POST",
        body: JSON.stringify({ attemptToken: clientAttemptToken }),
        signal: controller.signal,
      });
      if (accessIsCurrent()) {
        sessionStorage.setItem(attemptKey, result.attemptToken);
        releasePendingFollowupAttempt(sessionStorage, pendingAttemptKey, clientAttemptToken);
      }
      return result;
    };

    const load = async () => {
      try {
        let result: { attemptToken: string; snapshot: FollowupSnapshot };
        if (savedAttemptToken) {
          try {
            const resumed = await followupFetch<{ snapshot: FollowupSnapshot }>(
              `/v1/followups/${id}/snapshot`,
              savedAttemptToken,
              { signal: controller.signal },
            );
            if (accessIsCurrent()) sessionStorage.removeItem(pendingAttemptKey);
            result = { attemptToken: savedAttemptToken, snapshot: resumed.snapshot };
          } catch (caught) {
            if (!shouldReplaceSavedAttempt(caught)) throw caught;
            if (!accessIsCurrent()) return;
            sessionStorage.removeItem(attemptKey);
            result = await start();
          }
        } else result = await start();
        if (accessIsCurrent()) {
          setAttemptToken(result.attemptToken);
          adoptSnapshot(result.snapshot);
          setError("");
        }
      } catch (caught) {
        if (accessIsCurrent()) setError(humanError(caught));
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessRevision, id]);

  useEffect(() => {
    setSelectedChoiceIds([]);
    setNumericValue("");
    setRatingValue(null);
    setConfidence(null);
  }, [snapshot?.question?.id]);

  function chooseChoice(choiceId: string) {
    if (
      !snapshot?.question ||
      snapshot.phase !== "question_open" ||
      !snapshotReady.current ||
      busy ||
      commandState.pendingAction
    )
      return;
    if (snapshot.question.type === "multi_select") {
      setSelectedChoiceIds((current) =>
        current.includes(choiceId)
          ? current.filter((selected) => selected !== choiceId)
          : [...current, choiceId],
      );
    } else setSelectedChoiceIds([choiceId]);
  }

  function response(): ResponsePayload | null {
    const question = snapshot?.question;
    if (!question) return null;
    if (
      question.type === "ranking" ||
      question.type === "open_text" ||
      question.type === "word_cloud"
    )
      return null;
    if (["single_select", "true_false", "multi_select"].includes(question.type)) {
      return selectedChoiceIds.length ? { kind: "choice", choiceIds: selectedChoiceIds } : null;
    }
    if (question.type === "poll") {
      return selectedChoiceIds.length === 1 ? { kind: "poll", choiceIds: selectedChoiceIds } : null;
    }
    if (question.type === "numeric") {
      return numericValue.trim()
        ? { kind: "numeric", value: numericValue, unit: question.unit ?? undefined }
        : null;
    }
    return ratingValue === null ? null : { kind: "rating", value: ratingValue };
  }

  function commandManager() {
    const revision = accessRevisionRef.current;
    const key = `${id}:${attemptToken}:${revision}`;
    if (recovery.current?.key !== key) {
      const wrapper = {
        key,
        manager: null as unknown as ReturnType<typeof createFollowupCommandRecovery>,
      };
      wrapper.manager = createFollowupCommandRecovery({
        execute: async (action, body) => {
          const result = await followupFetch<{ snapshot: FollowupSnapshot }>(
            `/v1/followups/${id}/${action === "answer" ? "answers" : "advance"}`,
            attemptToken,
            { method: "POST", body },
          );
          return result.snapshot;
        },
        onState: (state) => {
          if (
            !mounted.current ||
            recovery.current !== wrapper ||
            accessRevisionRef.current !== revision
          )
            return;
          setCommandState(state);
          setBusy(state.busy);
        },
      });
      recovery.current = wrapper;
    }
    return recovery.current.manager;
  }

  async function runCommand(action: "answer" | "advance", payload: () => object, retry = false) {
    const revision = accessRevisionRef.current;
    const manager = commandManager();
    setError("");
    try {
      const incoming = await (retry ? manager.retry() : manager.run(action, payload));
      if (mounted.current && accessRevisionRef.current === revision && incoming)
        adoptSnapshot(incoming);
    } catch (caught) {
      if (!mounted.current || accessRevisionRef.current !== revision) return;
      setError(humanError(caught));
      if ((caught as { status?: number }).status === 409) {
        snapshotReady.current = false;
        setSnapshotSyncRequired(true);
        await refreshSnapshot();
      }
    }
  }

  async function refreshSnapshot() {
    if (!attemptToken || snapshotSyncBusy.current) return;
    const revision = accessRevisionRef.current;
    snapshotSyncBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await followupFetch<{ snapshot: FollowupSnapshot }>(
        `/v1/followups/${id}/snapshot`,
        attemptToken,
      );
      if (!mounted.current || accessRevisionRef.current !== revision) return;
      if (!adoptSnapshot(result.snapshot))
        throw new Error("This practice update could not be verified. Retry practice sync.");
    } catch (caught) {
      if (mounted.current && accessRevisionRef.current === revision) setError(humanError(caught));
    } finally {
      if (mounted.current && accessRevisionRef.current === revision) {
        snapshotSyncBusy.current = false;
        setBusy(false);
      }
    }
  }

  async function submit() {
    if (!snapshotReady.current || busy || commandState.pendingAction) return;
    const answer = response();
    if (!snapshot?.question || !answer || !attemptToken) {
      setError("Complete the response before submitting.");
      return;
    }
    if (snapshot.question.confidence === "required" && confidence === null) {
      setError("Choose how sure you are before submitting.");
      window.requestAnimationFrame(() => confidenceControlRef.current?.focus());
      return;
    }
    await runCommand("answer", () => ({
      idempotencyKey: clientUuid(),
      questionId: snapshot.question!.id,
      expectedVersion: snapshot.version,
      response: answer,
      ...(confidence === null ? {} : { confidence }),
    }));
  }

  async function advance() {
    if (!attemptToken || !snapshot || !snapshotReady.current || busy || commandState.pendingAction)
      return;
    await runCommand("advance", () => ({
      expectedVersion: snapshot.version,
      idempotencyKey: clientUuid(),
    }));
  }

  const displayedChoiceIds =
    snapshot?.response?.kind === "choice" || snapshot?.response?.kind === "poll"
      ? snapshot.response.choiceIds
      : selectedChoiceIds;
  const revealed = snapshot?.phase === "answer_reveal";
  const assignment = snapshot?.purpose === "assignment";
  const locked = busy || commandState.pendingAction !== null || snapshotSyncRequired;

  return (
    <div className="live-shell" lang="en-CA">
      <header className="shell live-topbar">
        <Brand inverted />
        {snapshot ? (
          <span className="status-pill">
            {snapshot.phase === "intervention" || snapshot.timeMode === "flex"
              ? "No countdown"
              : `${snapshot.timeMultiplier}× time`}
          </span>
        ) : null}
      </header>
      <main className="shell live-stage" id="main">
        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {followupStatusAnnouncement(snapshot)}
        </p>
        {error ? (
          <section className="live-card">
            <p className="error" role="alert">
              {error}
            </p>
            {!snapshot ? (
              <Link className="button-quiet" href="/">
                Return home
              </Link>
            ) : null}
          </section>
        ) : null}
        {commandState.pendingAction ? (
          <section className="live-card">
            <p role="status" aria-live="polite">
              {commandState.busy
                ? "Waiting for acknowledgement…"
                : "The request was not acknowledged. Keep this page open and retry the same request; no new response or continue action will be sent."}
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => void runCommand(commandState.pendingAction!, () => ({}), true)}
              type="button"
            >
              {commandState.pendingAction === "answer"
                ? "Retry response acknowledgement"
                : "Retry continue acknowledgement"}
            </button>
          </section>
        ) : null}
        {snapshotSyncRequired ? (
          <section className="live-card">
            <p role="status" aria-live="polite">
              Refresh the current practice state before responding or continuing. No action will be
              sent until the current state is confirmed.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => void refreshSnapshot()}
              type="button"
            >
              {busy ? "Syncing practice…" : "Retry practice sync"}
            </button>
          </section>
        ) : null}
        {!snapshot && !error ? (
          <section className="live-card">
            <p>Opening your private practice…</p>
          </section>
        ) : null}
        {snapshot?.status === "completed" ? (
          <section className="live-card">
            <p className="eyebrow">{assignment ? "Practice complete" : "Follow-up complete"}</p>
            <h1 tabIndex={-1}>Thanks for checking your understanding.</h1>
            <p className="lead">Your responses were saved without creating an account.</p>
          </section>
        ) : null}
        {snapshot?.phase === "intervention" &&
        snapshot.intervention &&
        snapshot.status === "in_progress" ? (
          <FollowupInterventionCard
            intervention={snapshot.intervention}
            busy={locked}
            onContinue={() => void advance()}
          />
        ) : null}
        {snapshot?.question && snapshot.status === "in_progress" ? (
          <section className="live-card">
            <div className="page-heading" style={{ alignItems: "center", marginBottom: 20 }}>
              <span className="status-pill">
                Question {(snapshot.questionIndex ?? 0) + 1} of {snapshot.questionCount}
              </span>
              {snapshot.phase === "question_open" && snapshot.deadline ? (
                <Countdown deadline={snapshot.deadline} />
              ) : null}
            </div>
            <p className="eyebrow" lang="">
              {snapshot.title}
            </p>
            <h1 lang="" tabIndex={-1} style={{ fontSize: "clamp(2rem, 7vw, 4rem)" }}>
              {snapshot.question.prompt}
            </h1>
            <div lang="">
              <QuestionMedia
                altText={snapshot.question.mediaAlt}
                credential={attemptToken}
                mediaId={snapshot.question.mediaId}
                mode="followup"
                sessionId={id}
              />
            </div>
            {snapshot.question.type === "ranking" ||
            snapshot.question.type === "open_text" ||
            snapshot.question.type === "word_cloud" ? (
              <p className="notice" lang="en-CA">
                These opinion formats currently support live Rounds only.
              </p>
            ) : ["single_select", "true_false", "multi_select", "poll"].includes(
                snapshot.question.type,
              ) ? (
              <div className="answer-grid" aria-label="Response choices">
                {snapshot.question.choices.map((choice, index) => {
                  const selected = displayedChoiceIds.includes(choice.id);
                  const correct =
                    revealed &&
                    snapshot.correctResponse?.kind === "choice" &&
                    snapshot.correctResponse.choiceIds.includes(choice.id);
                  return (
                    <button
                      aria-pressed={selected}
                      className="answer-button"
                      data-correct={correct || undefined}
                      data-incorrect={(revealed && selected && !correct) || undefined}
                      data-selected={selected || undefined}
                      disabled={snapshot.phase !== "question_open" || locked}
                      key={choice.id}
                      onClick={() => chooseChoice(choice.id)}
                      type="button"
                    >
                      <span aria-hidden="true" style={{ marginRight: 10 }}>
                        {String.fromCharCode(65 + index)}.
                      </span>
                      <span lang="">{choice.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : snapshot.question.type === "numeric" ? (
              <label className="field">
                <span>
                  Numeric response <span lang="">{snapshot.question.unit ?? ""}</span>
                </span>
                <input
                  className="input"
                  disabled={snapshot.phase !== "question_open" || locked}
                  inputMode="decimal"
                  onChange={(event) => setNumericValue(event.target.value)}
                  value={
                    snapshot.response?.kind === "numeric" ? snapshot.response.value : numericValue
                  }
                />
              </label>
            ) : snapshot.question.rating ? (
              <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="field-label">Choose a rating</legend>
                <div className="answer-grid">
                  {Array.from(
                    { length: snapshot.question.rating.max - snapshot.question.rating.min + 1 },
                    (_, index) => snapshot.question!.rating!.min + index,
                  ).map((value) => (
                    <button
                      aria-pressed={ratingValue === value}
                      className="answer-button"
                      data-selected={ratingValue === value || undefined}
                      disabled={snapshot.phase !== "question_open" || locked}
                      key={value}
                      onClick={() => setRatingValue(value)}
                      type="button"
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <p className="muted" lang="">
                  {snapshot.question.rating.minLabel} · {snapshot.question.rating.maxLabel}
                </p>
              </fieldset>
            ) : null}
            {snapshot.question.confidence !== "off" && snapshot.phase === "question_open" ? (
              <fieldset className="field" style={{ border: 0, padding: 0 }}>
                <legend className="field-label">
                  How sure are you?{snapshot.question.confidence === "required" ? " Required" : ""}
                </legend>
                <div className="button-row">
                  {[
                    [1, "Not sure"],
                    [2, "Somewhat sure"],
                    [3, "Very sure"],
                  ].map(([value, label]) => (
                    <button
                      aria-pressed={confidence === value}
                      disabled={locked}
                      className="button-quiet"
                      data-selected={confidence === value || undefined}
                      key={value}
                      onClick={() => setConfidence(value as ConfidenceValue)}
                      ref={value === 1 ? confidenceControlRef : undefined}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {snapshot.phase === "question_open" ? (
              <button
                className="button"
                disabled={locked}
                onClick={() => void submit()}
                type="button"
              >
                {busy ? "Saving…" : "Submit response"}
              </button>
            ) : null}
            {revealed ? (
              <div className={snapshot.correct === true ? "success" : "notice"}>
                <strong>
                  {snapshot.question.purpose === "opinion"
                    ? "Response recorded"
                    : snapshot.correct
                      ? "Correct"
                      : "Review this question"}
                </strong>
                {snapshot.explanation ? <div lang="">{snapshot.explanation}</div> : null}
                {snapshot.feedback ? <div lang="">{snapshot.feedback}</div> : null}
                <button
                  className="button"
                  disabled={locked}
                  onClick={() => void advance()}
                  style={{ marginTop: 16 }}
                  type="button"
                >
                  {snapshot.questionIndex === snapshot.questionCount - 1
                    ? assignment
                      ? "Finish practice"
                      : "Finish follow-up"
                    : snapshot.practiceMode === "full_sequence"
                      ? "Review recovery guidance"
                      : "Next question"}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default function FollowupPage() {
  const { id } = useParams<{ id: string }>();
  return <FollowupContent key={id} />;
}
