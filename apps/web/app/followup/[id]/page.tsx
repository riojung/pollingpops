"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ConfidenceValue, FollowupSnapshot, ResponsePayload } from "@openround/contracts";
import { useLocale } from "../../../components/locale-provider";
import { followupCopy, localizeFollowupMessage } from "../../../lib/i18n/followup-copy";
import { formatNumber } from "../../../lib/i18n/format";
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
import { learnerCopy } from "./learner-copy";
import styles from "./page.module.css";

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
  const { locale, t } = useLocale();
  const copy = followupCopy(locale);
  const learner = learnerCopy(locale);
  const { id } = useParams<{ id: string }>();
  const [snapshot, setSnapshot] = useState<FollowupSnapshot | null>(null);
  const [highContrast, setHighContrast] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
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
  const responseControlsRef = useRef<HTMLDivElement>(null);
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
    // Private links can open directly, without mounting the live-room preferences menu.
    const readAccessibility = () => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("openround:experience-preferences") ?? "null",
        );
        setHighContrast(saved?.highContrast === true);
        setReducedMotion(saved?.reducedMotion === true);
      } catch {
        setHighContrast(false);
        setReducedMotion(false);
      }
    };
    readAccessibility();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "openround:experience-preferences")
        readAccessibility();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
      window.requestAnimationFrame(() =>
        responseControlsRef.current
          ?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")
          ?.focus(),
      );
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

  const revealed = snapshot?.phase === "answer_reveal";
  // A deadline can expire while the learner is editing. Reveal only the server's
  // saved response; an unsaved local draft must never look like an accepted answer.
  const displayedChoiceIds =
    snapshot?.response?.kind === "choice" || snapshot?.response?.kind === "poll"
      ? snapshot.response.choiceIds
      : revealed
        ? []
        : selectedChoiceIds;
  const assignment = snapshot?.purpose === "assignment";
  const locked = busy || commandState.pendingAction !== null || snapshotSyncRequired;
  const completedCount =
    snapshot?.status === "completed"
      ? snapshot.questionCount
      : (snapshot?.questionIndex ?? 0) + (revealed ? 1 : 0);
  const progressLabel = snapshot
    ? learner("{completed} of {total} questions completed", {
        completed: formatNumber(locale, completedCount),
        total: formatNumber(locale, snapshot.questionCount),
      })
    : "";
  const displayedRating =
    snapshot?.response?.kind === "rating" ? snapshot.response.value : revealed ? null : ratingValue;
  const displayedNumeric =
    snapshot?.response?.kind === "numeric" ? snapshot.response.value : revealed ? "" : numericValue;
  const responseInstruction =
    snapshot?.question?.type === "multi_select"
      ? learner("Choose all answers that apply.")
      : snapshot?.question &&
          ["single_select", "true_false", "poll", "rating"].includes(snapshot.question.type)
        ? learner("Choose one answer.")
        : learner("Enter your answer, then submit.");

  return (
    <div
      className={`live-shell ${styles.learner}`}
      data-contrast={highContrast ? "high" : undefined}
      data-motion={reducedMotion ? "reduced" : undefined}
      lang={locale}
    >
      <header className={`shell live-topbar ${styles.topbar}`}>
        <Brand />
        {snapshot ? (
          <span className={styles.kind}>{learner(assignment ? "Assignment" : "Follow-up")}</span>
        ) : null}
      </header>
      <main className={`shell live-stage ${styles.stage}`} id="main">
        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {followupStatusAnnouncement(snapshot, locale)}
        </p>
        {error ? (
          <section className="live-card">
            <p className="error" role="alert">
              <span lang={localizeFollowupMessage(locale, error).language}>
                {localizeFollowupMessage(locale, error).text}
              </span>
            </p>
            {!snapshot ? (
              <>
                <p>
                  {copy(
                    "Ask the facilitator for a new private link if access has expired or was revoked.",
                  )}
                </p>
                <div className="button-row">
                  <button
                    className="button"
                    onClick={() => {
                      setError("");
                      accessRevisionRef.current += 1;
                      setAccessRevision(accessRevisionRef.current);
                    }}
                    type="button"
                  >
                    {copy("Retry opening practice")}
                  </button>
                  <Link className="button-quiet" href="/">
                    {copy("Return home")}
                  </Link>
                </div>
              </>
            ) : null}
          </section>
        ) : null}
        {commandState.pendingAction ? (
          <section className="live-card">
            <p role="status" aria-live="polite">
              {commandState.busy
                ? copy("Waiting for acknowledgement…")
                : copy(
                    "The request was not acknowledged. Keep this page open and retry the same request; no new response or continue action will be sent.",
                  )}
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => void runCommand(commandState.pendingAction!, () => ({}), true)}
              type="button"
            >
              {commandState.pendingAction === "answer"
                ? copy("Retry response acknowledgement")
                : copy("Retry continue acknowledgement")}
            </button>
          </section>
        ) : null}
        {snapshotSyncRequired ? (
          <section className="live-card">
            <p role="status" aria-live="polite">
              {copy(
                "Refresh the current practice state before responding or continuing. No action will be sent until the current state is confirmed.",
              )}
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => void refreshSnapshot()}
              type="button"
            >
              {busy ? copy("Syncing practice…") : copy("Retry practice sync")}
            </button>
          </section>
        ) : null}
        {!snapshot && !error ? (
          <section className="live-card">
            <p role="status">{copy("Opening your private practice…")}</p>
          </section>
        ) : null}
        {snapshot?.status === "completed" ? (
          <section className={`live-card ${styles.completion}`}>
            <span className={styles.completeMark} aria-hidden="true">
              ✓
            </span>
            <p className="eyebrow">
              {assignment ? copy("Practice complete") : copy("Follow-up complete")}
            </p>
            <h1 tabIndex={-1}>{copy("Thanks for checking your understanding.")}</h1>
            <p className="lead">{copy("Your responses were saved without creating an account.")}</p>
            <p className={styles.savedSummary}>{progressLabel}</p>
            <p className="muted">{learner("You can close this page.")}</p>
            <Link className="button-quiet" href="/">
              {copy("Return home")}
            </Link>
          </section>
        ) : null}
        {snapshot?.phase === "intervention" &&
        snapshot.intervention &&
        snapshot.status === "in_progress" ? (
          <FollowupInterventionCard
            intervention={snapshot.intervention}
            locale={locale}
            busy={locked}
            onContinue={() => void advance()}
          />
        ) : null}
        {snapshot?.question && snapshot.status === "in_progress" ? (
          <section
            className={`live-card ${styles.questionCard}`}
            aria-labelledby="followup-question-heading"
            aria-busy={busy}
          >
            <div className={styles.context}>
              <p className={styles.assignmentTitle} lang="">
                {snapshot.title}
              </p>
              <div className={styles.timing}>
                <span className={styles.timeLabel}>
                  {snapshot.timeMode === "flex"
                    ? copy("No countdown")
                    : copy("{multiplier}× time", {
                        multiplier: formatNumber(locale, snapshot.timeMultiplier),
                      })}
                </span>
                {snapshot.phase === "question_open" && snapshot.deadline ? (
                  <Countdown
                    deadline={snapshot.deadline}
                    labels={{
                      seconds: (seconds) =>
                        copy("{seconds}s", { seconds: formatNumber(locale, seconds) }),
                      remaining: (seconds) =>
                        copy("{seconds} seconds remaining", {
                          seconds: formatNumber(locale, seconds),
                        }),
                      paused: copy("Paused"),
                      timeUp: copy("Time is up"),
                    }}
                  />
                ) : null}
              </div>
            </div>
            <div className={styles.progressHeader}>
              <span className={styles.questionPosition}>
                {copy("Question {current} of {total}", {
                  current: formatNumber(locale, (snapshot.questionIndex ?? 0) + 1),
                  total: formatNumber(locale, snapshot.questionCount),
                })}
              </span>
              <span className={styles.progressCaption}>{progressLabel}</span>
            </div>
            <div
              className={styles.progress}
              role="progressbar"
              aria-label={learner("Your progress")}
              aria-valuemin={0}
              aria-valuemax={snapshot.questionCount}
              aria-valuenow={completedCount}
              aria-valuetext={progressLabel}
            >
              <span style={{ width: `${(completedCount / snapshot.questionCount) * 100}%` }} />
            </div>
            <h1
              id="followup-question-heading"
              className={styles.questionTitle}
              lang=""
              tabIndex={-1}
            >
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
            {snapshot.phase === "question_open" ? (
              <p className={styles.instruction} id="followup-response-instruction">
                {responseInstruction}
              </p>
            ) : null}
            <div
              ref={responseControlsRef}
              role="group"
              aria-label={copy("Response choices")}
              aria-describedby={
                snapshot.phase === "question_open" ? "followup-response-instruction" : undefined
              }
            >
              {snapshot.question.type === "ranking" ||
              snapshot.question.type === "open_text" ||
              snapshot.question.type === "word_cloud" ? (
                <p className="notice" lang={locale}>
                  {copy("These opinion formats currently support live Rounds only.")}
                </p>
              ) : ["single_select", "true_false", "multi_select", "poll"].includes(
                  snapshot.question.type,
                ) ? (
                <div className="answer-grid" aria-label={copy("Response choices")}>
                  {snapshot.question.choices.map((choice, index) => {
                    const selected = displayedChoiceIds.includes(choice.id);
                    const correct =
                      revealed &&
                      snapshot.question?.purpose !== "opinion" &&
                      snapshot.correctResponse?.kind === "choice" &&
                      snapshot.correctResponse.choiceIds.includes(choice.id);
                    const incorrect =
                      revealed &&
                      selected &&
                      snapshot.question?.purpose !== "opinion" &&
                      snapshot.correctResponse?.kind === "choice" &&
                      !correct;
                    return (
                      <button
                        aria-pressed={selected}
                        className="answer-button"
                        data-correct={correct || undefined}
                        data-incorrect={incorrect || undefined}
                        data-selected={selected || undefined}
                        disabled={snapshot.phase !== "question_open" || locked}
                        key={choice.id}
                        onClick={() => chooseChoice(choice.id)}
                        type="button"
                      >
                        <span className={styles.choiceKey} aria-hidden="true">
                          {String.fromCharCode(65 + index)}
                        </span>
                        <span className={styles.choiceBody}>
                          <span lang="">{choice.label}</span>
                          {selected || correct ? (
                            <span className={styles.choiceState}>
                              {revealed
                                ? selected
                                  ? `${learner("Your answer")}${correct ? ` · ${copy("Correct")}` : incorrect ? ` · ${learner("Incorrect")}` : ""}`
                                  : learner("Correct answer")
                                : learner("Selected")}
                            </span>
                          ) : null}
                        </span>
                        <span className={styles.choiceMark} aria-hidden="true">
                          {incorrect ? "×" : selected || correct ? "✓" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : snapshot.question.type === "numeric" ? (
                <label className="field">
                  <span>
                    {t("live.presentationPlay.numericResponse")}{" "}
                    <span lang="">{snapshot.question.unit ?? ""}</span>
                  </span>
                  <input
                    className="input"
                    disabled={snapshot.phase !== "question_open" || locked}
                    inputMode="decimal"
                    onChange={(event) => setNumericValue(event.target.value)}
                    value={displayedNumeric}
                  />
                </label>
              ) : snapshot.question.rating ? (
                <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                  <legend className="field-label">{t("live.presentationPlay.chooseRating")}</legend>
                  <div className="answer-grid">
                    {Array.from(
                      { length: snapshot.question.rating.max - snapshot.question.rating.min + 1 },
                      (_, index) => snapshot.question!.rating!.min + index,
                    ).map((value) => (
                      <button
                        aria-pressed={displayedRating === value}
                        className="answer-button"
                        data-selected={displayedRating === value || undefined}
                        disabled={snapshot.phase !== "question_open" || locked}
                        key={value}
                        onClick={() => setRatingValue(value)}
                        type="button"
                      >
                        {formatNumber(locale, value)}
                      </button>
                    ))}
                  </div>
                  <p className="muted" lang="">
                    {snapshot.question.rating.minLabel} · {snapshot.question.rating.maxLabel}
                  </p>
                </fieldset>
              ) : null}
            </div>
            {snapshot.question.confidence !== "off" && snapshot.phase === "question_open" ? (
              <fieldset className={`field ${styles.confidence}`}>
                <legend className="field-label">
                  {copy("How sure are you?")}
                  {snapshot.question.confidence === "required"
                    ? ` ${t("live.presentationPlay.required")}`
                    : ""}
                </legend>
                <div className="button-row">
                  {[
                    [1, t("live.roundPlay.confidence.notSure")],
                    [2, t("live.roundPlay.confidence.somewhat")],
                    [3, t("live.roundPlay.confidence.very")],
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
              <div className={styles.actions}>
                <button
                  className="button"
                  disabled={locked}
                  onClick={() => void submit()}
                  type="button"
                >
                  {busy ? t("live.common.saving") : t("live.presentationPlay.submit")}
                </button>
              </div>
            ) : null}
            {revealed ? (
              <>
                <div
                  className={styles.feedback}
                  data-outcome={
                    snapshot.question.purpose === "opinion"
                      ? "recorded"
                      : snapshot.correct === true
                        ? "correct"
                        : "review"
                  }
                >
                  <span className={styles.feedbackMark} aria-hidden="true">
                    {snapshot.question.purpose === "opinion" || snapshot.correct === true
                      ? "✓"
                      : "↳"}
                  </span>
                  <div>
                    <h2>
                      {snapshot.question.purpose === "opinion" && snapshot.response
                        ? t("live.presentationPlay.responseRecorded")
                        : snapshot.correct
                          ? copy("Correct")
                          : copy("Review this question")}
                    </h2>
                    <p>
                      {learner(
                        snapshot.response
                          ? "Your response has been saved."
                          : "No response was submitted.",
                      )}
                    </p>
                    {snapshot.correctResponse?.kind === "numeric" ? (
                      <p>
                        <strong>{learner("Correct answer")}: </strong>
                        <span lang="">
                          {snapshot.correctResponse.value}{" "}
                          {snapshot.correctResponse.unit ??
                            (snapshot.question.type === "numeric" ? snapshot.question.unit : "") ??
                            ""}
                        </span>
                      </p>
                    ) : null}
                    {snapshot.explanation ? (
                      <p className={styles.authoredFeedback} lang="">
                        {snapshot.explanation}
                      </p>
                    ) : null}
                    {snapshot.feedback ? (
                      <p className={styles.authoredFeedback} lang="">
                        {snapshot.feedback}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className={styles.actions}>
                  <p className="muted">{learner("Review the feedback, then continue.")}</p>
                  <button
                    className="button"
                    disabled={locked}
                    onClick={() => void advance()}
                    type="button"
                  >
                    {snapshot.questionIndex === snapshot.questionCount - 1
                      ? assignment
                        ? copy("Finish practice")
                        : copy("Finish follow-up")
                      : snapshot.practiceMode === "full_sequence"
                        ? copy("Review recovery guidance")
                        : t("live.host.command.nextQuestion")}
                  </button>
                </div>
              </>
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
