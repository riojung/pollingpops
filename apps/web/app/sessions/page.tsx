"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "../../components/locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import { formatDateTime } from "../../lib/i18n/format";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { SessionPhaseLabel } from "../../components/workspace/session-phase-label";
import type { CursorPage, SessionSummary } from "../../components/workspace/workspace-types";
import styles from "../../components/workspace/workspace-content.module.css";

type StatusFilter = "all" | SessionSummary["status"];
type ArtifactFilter = "all" | "round" | "presentation";

function sessionStatusLabel(
  status: Exclude<StatusFilter, "all">,
  t: ReturnType<typeof useLocale>["t"],
) {
  return status === "expired"
    ? t("pages.sessions.accessExpired")
    : t(`pages.common.status.${status}`);
}

interface PresentationSessionSummary {
  id: string;
  artifactType: "presentation";
  presentationId: string;
  title: string;
  code: string;
  status: "active" | "finished";
  phase: string;
  currentBlockIndex: number;
  blockCount: number;
  participantCount: number;
  responseCount: number;
  createdAt: string;
  liveExpiresAt?: string;
}

function presentationSessionStatus(session: PresentationSessionSummary) {
  return session.liveExpiresAt && new Date(session.liveExpiresAt).getTime() <= Date.now()
    ? "expired"
    : session.status;
}

function SessionsContent() {
  const router = useRouter();
  const { locale, t } = useLocale();
  const { creator, canEdit, productFeatures } = useWorkspace();
  const canDelete = creator?.role === "owner";
  const presentationsEnabled = productFeatures?.presentations === true;
  const [artifactType, setArtifactType] = useState<ArtifactFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [quizId, setQuizId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rounds, setRounds] = useState<Array<{ id: string; title: string }>>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [presentationSessions, setPresentationSessions] = useState<PresentationSessionSummary[]>(
    [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const queryKey = `${artifactType}\u0000${status}\u0000${quizId}\u0000${fromDate}\u0000${toDate}`;
  const activeQueryKey = useRef(queryKey);
  const loadMoreController = useRef<AbortController | null>(null);
  const deletedSessionIds = useRef(new Set<string>());
  activeQueryKey.current = queryKey;

  const fetchPage = useCallback(
    (cursor?: string, signal?: AbortSignal) => {
      const params = new URLSearchParams({ limit: "25" });
      if (status !== "all") params.set("status", status);
      if (quizId !== "all") params.set("quizId", quizId);
      if (fromDate) params.set("from", new Date(`${fromDate}T00:00:00`).toISOString());
      if (toDate) params.set("to", new Date(`${toDate}T23:59:59.999`).toISOString());
      if (cursor) params.set("cursor", cursor);
      return apiFetch<CursorPage<SessionSummary>>(`/v1/sessions?${params}`, { signal });
    },
    [fromDate, quizId, status, toDate],
  );

  useEffect(() => {
    void Promise.all([
      apiFetch<{ quizzes: Array<{ id: string; title: string }> }>(
        "/v1/quizzes?archived=true&summary=true",
      ),
      presentationsEnabled
        ? apiFetch<{ sessions: PresentationSessionSummary[] }>("/v1/presentation-sessions")
        : Promise.resolve({ sessions: [] }),
    ])
      .then(([roundResponse, presentationResponse]) => {
        setRounds(roundResponse.quizzes);
        setPresentationSessions(
          presentationResponse.sessions.filter(
            (session) => !deletedSessionIds.current.has(session.id),
          ),
        );
      })
      .catch(() => undefined);
  }, [presentationsEnabled]);

  const visiblePresentationSessions = presentationSessions.filter((session) => {
    if (artifactType === "round") return false;
    if (quizId !== "all") return false;
    if (status !== "all" && status !== presentationSessionStatus(session)) return false;
    const createdAt = new Date(session.createdAt).getTime();
    if (fromDate && createdAt < new Date(`${fromDate}T00:00:00`).getTime()) return false;
    if (toDate && createdAt > new Date(`${toDate}T23:59:59.999`).getTime()) return false;
    return true;
  });

  useEffect(() => {
    const controller = new AbortController();
    const requestedQueryKey = queryKey;
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setLoading(true);
    setLoadingMore(false);
    setSessions([]);
    setNextCursor(null);
    setError("");
    void fetchPage(undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
        setSessions(
          artifactType === "presentation"
            ? []
            : response.items.filter((session) => !deletedSessionIds.current.has(session.id)),
        );
        setNextCursor(artifactType === "presentation" ? null : response.nextCursor);
      })
      .catch((caught) => {
        if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
        setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted && activeQueryKey.current === requestedQueryKey) {
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      loadMoreController.current?.abort();
    };
  }, [artifactType, fetchPage, queryKey]);

  async function loadMore() {
    if (!nextCursor) return;
    const requestedQueryKey = queryKey;
    const requestedCursor = nextCursor;
    loadMoreController.current?.abort();
    const controller = new AbortController();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setError("");
    try {
      const response = await fetchPage(requestedCursor, controller.signal);
      if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
      setSessions((current) => [
        ...current,
        ...response.items.filter((session) => !deletedSessionIds.current.has(session.id)),
      ]);
      setNextCursor(response.nextCursor);
    } catch (caught) {
      if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
      setError(humanError(caught));
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        if (activeQueryKey.current === requestedQueryKey) setLoadingMore(false);
      }
    }
  }

  async function resumeSession(session: SessionSummary) {
    setBusyId(session.id);
    setError("");
    try {
      const response = await apiFetch<{ token: string }>(
        `/v1/sessions/${session.id}/control-pass`,
        { method: "POST", body: "{}" },
      );
      window.sessionStorage.setItem(`openround:host:${session.id}`, response.token);
      router.push(`/host/${session.id}`);
    } catch (caught) {
      setError(humanError(caught));
      setBusyId("");
    }
  }

  async function deleteSession(
    session: { id: string; title: string },
    artifact: Exclude<ArtifactFilter, "all">,
  ) {
    if (
      !canDelete ||
      busyId ||
      !window.confirm(t("pages.sessions.deleteConfirm", { title: session.title }))
    )
      return;
    setBusyId(session.id);
    setDeletingId(session.id);
    setError("");
    try {
      const path = artifact === "presentation" ? "presentation-sessions" : "sessions";
      await apiFetch(`/v1/${path}/${session.id}`, { method: "DELETE" });
      deletedSessionIds.current.add(session.id);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      setPresentationSessions((current) => current.filter((item) => item.id !== session.id));
      try {
        const credentialKinds =
          artifact === "presentation"
            ? ["presentation-host", "presentation-participant", "presentation-companion"]
            : ["host", "participant", "presenter", "presenter-policy", "presenter-origins", "code"];
        for (const kind of credentialKinds) {
          window.sessionStorage.removeItem(`openround:${kind}:${session.id}`);
        }
      } catch {
        // Browser storage may be unavailable; deletion has already revoked durable credentials.
      }
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyId("");
      setDeletingId("");
    }
  }

  return (
    <>
      <div className={styles.filters}>
        {presentationsEnabled ? (
          <label className="field">
            <span>{t("pages.sessions.artifactType")}</span>
            <select
              className="select"
              onChange={(event) => {
                const next = event.target.value as ArtifactFilter;
                setArtifactType(next);
                if (next === "presentation") setQuizId("all");
              }}
              value={artifactType}
            >
              <option value="all">{t("pages.sessions.allArtifacts")}</option>
              <option value="round">{t("pages.common.rounds")}</option>
              <option value="presentation">{t("pages.common.presentations")}</option>
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>{t("pages.sessions.statusLabel")}</span>
          <select
            className="select"
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            value={status}
          >
            <option value="all">{t("pages.sessions.allSessions")}</option>
            <option value="active">{t("pages.common.status.active")}</option>
            <option value="finished">{t("pages.common.status.finished")}</option>
            <option value="expired">{t("pages.sessions.accessExpired")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("pages.common.round")}</span>
          <select
            className="select"
            disabled={artifactType === "presentation"}
            onChange={(event) => setQuizId(event.target.value)}
            value={quizId}
          >
            <option value="all">{t("pages.sessions.allRounds")}</option>
            {rounds.map((round) => (
              <option key={round.id} lang="" value={round.id}>
                {round.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("pages.common.from")}</span>
          <input
            className="input"
            onChange={(event) => setFromDate(event.target.value)}
            type="date"
            value={fromDate}
          />
        </label>
        <label className="field">
          <span>{t("pages.common.to")}</span>
          <input
            className="input"
            min={fromDate || undefined}
            onChange={(event) => setToDate(event.target.value)}
            type="date"
            value={toDate}
          />
        </label>
      </div>
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className={styles.muted}>{t("pages.sessions.loading")}</p> : null}
      {!loading && sessions.length === 0 && visiblePresentationSessions.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>{t("pages.sessions.emptyTitle")}</h2>
          <p>
            {status === "all"
              ? t("pages.sessions.emptyDescription")
              : t("pages.sessions.emptyFiltered", {
                  status: sessionStatusLabel(status, t),
                })}
          </p>
          <Link className="button" href="/dashboard">
            {t("pages.assignments.chooseRound")}
          </Link>
        </div>
      ) : null}
      {visiblePresentationSessions.length ? (
        <section className={styles.list} aria-label={t("pages.sessions.presentationListLabel")}>
          {visiblePresentationSessions.map((session) => (
            <article className={styles.listCard} key={session.id}>
              <div className={styles.rowTopline}>
                <div>
                  <p className="eyebrow">{t("pages.common.presentation")}</p>
                  <h2 lang="">{session.title}</h2>
                  <p className={styles.summaryLine}>
                    {t("pages.sessions.startedInRoom", {
                      date: formatDateTime(locale, session.createdAt),
                      code: session.code,
                    })}
                  </p>
                </div>
                <span className={styles.status} data-tone={presentationSessionStatus(session)}>
                  {sessionStatusLabel(presentationSessionStatus(session), t)}
                </span>
              </div>
              <div className={styles.metricGrid}>
                <div className={styles.metric}>
                  <strong>{session.participantCount}</strong>
                  <span>{t("pages.common.participants")}</span>
                </div>
                <div className={styles.metric}>
                  <strong>{session.responseCount}</strong>
                  <span>{t("pages.sessions.currentResponses")}</span>
                </div>
                <div className={styles.metric}>
                  <strong>
                    {session.currentBlockIndex < 0
                      ? t("pages.common.notStarted")
                      : `${session.currentBlockIndex + 1}/${session.blockCount}`}
                  </strong>
                  <span>{t("pages.sessions.blockProgress")}</span>
                </div>
                <div className={styles.metric}>
                  <strong>
                    <SessionPhaseLabel phase={session.phase} />
                  </strong>
                  <span>{t("pages.sessions.lastPhase")}</span>
                </div>
              </div>
              <div className={styles.listCardActions}>
                {presentationSessionStatus(session) === "active" && canEdit ? (
                  <Link
                    className="button small-button"
                    href={`/presentation-session/${session.id}/host`}
                  >
                    {t("pages.sessions.resumePresentation")}
                  </Link>
                ) : null}
                <Link
                  className="button-quiet small-button"
                  href={`/presentation-session/${session.id}/report`}
                >
                  {t("pages.sessions.viewReport")}
                </Link>
                <Link
                  className="button-quiet small-button"
                  href={`/presentation/${session.presentationId}`}
                >
                  {t("pages.sessions.viewPresentation")}
                </Link>
                {presentationSessionStatus(session) !== "active" && canDelete ? (
                  <button
                    className="button-quiet small-button"
                    disabled={Boolean(busyId)}
                    onClick={() => void deleteSession(session, "presentation")}
                    type="button"
                  >
                    {deletingId === session.id
                      ? t("pages.sessions.deleting")
                      : t("pages.sessions.delete")}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {artifactType !== "presentation" ? (
        <section className={styles.list} aria-label={t("pages.sessions.roundListLabel")}>
          {sessions.map((session) => (
            <article className={styles.listCard} key={session.id}>
              <div className={styles.rowTopline}>
                <div>
                  <h2 lang="">{session.title}</h2>
                  <p className={styles.summaryLine}>
                    {t("pages.sessions.startedInRoom", {
                      date: formatDateTime(locale, session.createdAt),
                      code: session.code,
                    })}
                  </p>
                  <p className={styles.summaryLine}>
                    {session.status === "expired"
                      ? t("pages.sessions.accessExpiredOn", {
                          date: formatDateTime(locale, session.expiresAt),
                        })
                      : t("pages.sessions.accessExpiresOn", {
                          date: formatDateTime(locale, session.expiresAt),
                        })}
                  </p>
                </div>
                <span className={styles.status} data-tone={session.status}>
                  {session.status === "expired"
                    ? t("pages.sessions.accessExpired")
                    : t(`pages.common.status.${session.status}`)}
                </span>
              </div>
              <div className={styles.metricGrid}>
                <div className={styles.metric}>
                  <strong>{session.participantCount}</strong>
                  <span>{t("pages.common.participants")}</span>
                </div>
                <div className={styles.metric}>
                  <strong>{session.answerCount}</strong>
                  <span>{t("pages.sessions.answersReceived")}</span>
                </div>
                <div className={styles.metric}>
                  <strong>
                    {session.questionPosition === null
                      ? t("pages.common.notStarted")
                      : `${session.questionPosition}/${session.questionCount}`}
                  </strong>
                  <span>{t("pages.sessions.questionProgress")}</span>
                </div>
                <div className={styles.metric}>
                  <strong>
                    <SessionPhaseLabel phase={session.phase} />
                  </strong>
                  <span>{t("pages.sessions.lastPhase")}</span>
                </div>
              </div>
              <div className={styles.listCardActions}>
                {session.status === "active" && canEdit ? (
                  <button
                    className="button small-button"
                    disabled={Boolean(busyId)}
                    onClick={() => void resumeSession(session)}
                    type="button"
                  >
                    {busyId === session.id
                      ? t("pages.sessions.preparingResume")
                      : t("pages.sessions.resumeSession")}
                  </button>
                ) : null}
                {session.reportId ? (
                  <Link className="button-quiet small-button" href={`/report/${session.reportId}`}>
                    {t("pages.sessions.viewResult")}
                  </Link>
                ) : null}
                <Link
                  className="button-quiet small-button"
                  href={`/quiz/${session.quizId}/preview`}
                >
                  {t("pages.sessions.viewRound")}
                </Link>
                {session.status !== "active" && canDelete ? (
                  <button
                    className="button-quiet small-button"
                    disabled={Boolean(busyId)}
                    onClick={() => void deleteSession(session, "round")}
                    type="button"
                  >
                    {deletingId === session.id
                      ? t("pages.sessions.deleting")
                      : t("pages.sessions.delete")}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {nextCursor ? (
        <div className={styles.loadMore}>
          <button
            className="button-quiet"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? t("pages.common.loading") : t("pages.sessions.loadMore")}
          </button>
        </div>
      ) : null}
    </>
  );
}

export default function SessionsPage() {
  const { t } = useLocale();
  return (
    <WorkspaceProvider>
      <WorkspaceShell
        description={t("page.sessions.description")}
        eyebrow={t("page.sessions.eyebrow")}
        title={t("page.sessions.title")}
        translationLevel="full"
      >
        <p>
          <Link href="/surveys">{t("create.kind.browseSurveys")}</Link>
        </p>
        <SessionsContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
