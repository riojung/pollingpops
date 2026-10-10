"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "../../components/locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import { buildHistoryQuery } from "../../lib/history-query";
import { formatPercent } from "../../components/workspace/workspace-model";
import { formatDateTime, pluralCategory } from "../../lib/i18n/format";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { SessionPhaseLabel } from "../../components/workspace/session-phase-label";
import type {
  CursorPage,
  FollowupSummary,
  ReportSummary,
  RoundFilterOption,
} from "../../components/workspace/workspace-types";
import styles from "../../components/workspace/workspace-content.module.css";
import { PackPracticeAttribution } from "../../components/practice/pack-practice-attribution";

type ReportStatusFilter = "all" | ReportSummary["status"];
type FollowupStatusFilter = "all" | FollowupSummary["status"];

function HistoryFilters({
  status,
  statusLabel,
  statusOptions,
  quizId,
  rounds,
  fromDate,
  toDate,
  onStatusChange,
  onQuizChange,
  onFromDateChange,
  onToDateChange,
  onClear,
}: {
  status: string;
  statusLabel: string;
  statusOptions: ReadonlyArray<{ value: string; label: string }>;
  quizId: string;
  rounds: RoundFilterOption[];
  fromDate: string;
  toDate: string;
  onStatusChange: (value: string) => void;
  onQuizChange: (value: string) => void;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const hasFilters = status !== "all" || quizId !== "all" || fromDate !== "" || toDate !== "";
  return (
    <section aria-label={t("pages.results.historyFilters")} className={styles.filters}>
      <label className="field">
        <span>{statusLabel}</span>
        <select
          className="select"
          onChange={(event) => onStatusChange(event.target.value)}
          value={status}
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("pages.common.round")}</span>
        <select
          className="select"
          onChange={(event) => onQuizChange(event.target.value)}
          value={quizId}
        >
          <option value="all">{t("pages.results.allRounds")}</option>
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
          onChange={(event) => onFromDateChange(event.target.value)}
          type="date"
          value={fromDate}
        />
      </label>
      <label className="field">
        <span>{t("pages.common.to")}</span>
        <input
          className="input"
          min={fromDate || undefined}
          onChange={(event) => onToDateChange(event.target.value)}
          type="date"
          value={toDate}
        />
      </label>
      <button className="button-quiet" disabled={!hasFilters} onClick={onClear} type="button">
        {t("pages.results.clearFilters")}
      </button>
    </section>
  );
}

function followupLifecycleLabel(report: ReportSummary, t: ReturnType<typeof useLocale>["t"]) {
  if (!report.followupId) return t("pages.results.noFollowup");
  if (!report.followupStatus) return t("pages.results.followupCreated");
  return t("pages.results.followupStatus", {
    status: t(`pages.common.status.${report.followupStatus}`),
  });
}

function ReportList({ rounds }: { rounds: RoundFilterOption[] }) {
  const { locale, t } = useLocale();
  const [status, setStatus] = useState<ReportStatusFilter>("all");
  const [quizId, setQuizId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const queryKey = `${status}\u0000${quizId}\u0000${fromDate}\u0000${toDate}`;
  const activeQueryKey = useRef(queryKey);
  const loadMoreController = useRef<AbortController | null>(null);
  activeQueryKey.current = queryKey;

  const fetchPage = useCallback(
    (cursor?: string, signal?: AbortSignal) =>
      apiFetch<CursorPage<ReportSummary>>(
        `/v1/reports?${buildHistoryQuery({ status, quizId, fromDate, toDate }, cursor)}`,
        { signal },
      ),
    [fromDate, quizId, status, toDate],
  );

  useEffect(() => {
    const controller = new AbortController();
    const requestedQueryKey = queryKey;
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setLoading(true);
    setLoadingMore(false);
    setReports([]);
    setNextCursor(null);
    setError("");
    void fetchPage(undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
        setReports(response.items);
        setNextCursor(response.nextCursor);
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
  }, [fetchPage, queryKey]);

  async function more() {
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
      setReports((current) => [...current, ...response.items]);
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

  function clearFilters() {
    setStatus("all");
    setQuizId("all");
    setFromDate("");
    setToDate("");
  }

  return (
    <>
      <HistoryFilters
        fromDate={fromDate}
        onClear={clearFilters}
        onFromDateChange={setFromDate}
        onQuizChange={setQuizId}
        onStatusChange={(value) => setStatus(value as ReportStatusFilter)}
        onToDateChange={setToDate}
        quizId={quizId}
        rounds={rounds}
        status={status}
        statusLabel={t("pages.results.resultStatus")}
        statusOptions={[
          { value: "all", label: t("pages.results.allResults") },
          { value: "ready", label: t("pages.common.status.ready") },
          { value: "pending", label: t("pages.common.status.processing") },
          { value: "failed", label: t("pages.common.status.needsAttention") },
        ]}
        toDate={toDate}
      />
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.muted} role="status">
          {t("pages.results.loading")}
        </p>
      ) : null}
      {!loading && !reports.length && !error ? (
        <div className={styles.emptyState}>
          <h2>{t("pages.results.emptyTitle")}</h2>
          <p>
            {status === "all" && quizId === "all" && !fromDate && !toDate
              ? t("pages.results.emptyDescription")
              : t("pages.results.noMatches")}
          </p>
          <Link className="button" href="/dashboard">
            {t("pages.assignments.chooseRound")}
          </Link>
        </div>
      ) : null}
      <section className={styles.list} aria-label={t("pages.common.results")}>
        {reports.map((report) => (
          <article className={styles.listCard} key={report.id}>
            <div className={styles.rowTopline}>
              <div>
                <h2 lang="">{report.title}</h2>
                <p className={styles.summaryLine}>
                  {formatDateTime(locale, report.generatedAt ?? report.createdAt)} ·{" "}
                  {t("pages.common.participantCount", { count: report.participantCount })}
                </p>
                <p className={styles.summaryLine}>
                  {t("pages.results.evidenceExpires", {
                    date: formatDateTime(locale, report.expiresAt),
                  })}{" "}
                  · {followupLifecycleLabel(report, t)}
                </p>
              </div>
              <span className={styles.status} data-tone={report.status}>
                {t(
                  `pages.common.status.${report.status === "pending" ? "processing" : report.status === "failed" ? "needsAttention" : "ready"}`,
                )}
              </span>
            </div>
            <div className={styles.metricGrid}>
              <div className={styles.metric}>
                <strong>{formatPercent(report.initialAccuracyPercent)}</strong>
                <span>{t("pages.common.initialAccuracy")}</span>
              </div>
              <div className={styles.metric}>
                <strong>{formatPercent(report.recovery.percent)}</strong>
                <span>
                  {t("pages.results.recoveryMetric", {
                    recovered: report.recovery.recovered,
                    eligible: report.recovery.eligible,
                  })}
                </span>
              </div>
              <div className={styles.metric}>
                <strong>{report.unresolvedConceptCount}</strong>
                <span>{t("pages.results.unresolvedConcepts")}</span>
              </div>
              <div className={styles.metric}>
                <strong>{report.interventionCount}</strong>
                <span>{t("pages.results.interventions")}</span>
              </div>
            </div>
            <div className={styles.listCardActions}>
              <Link className="button small-button" href={`/report/${report.id}`}>
                {report.status === "ready"
                  ? t("pages.results.openRecoveryStory")
                  : t("pages.results.viewStatus")}
              </Link>
              {report.followupId ? (
                <Link className="button-quiet small-button" href="/results?view=practice">
                  {t("pages.results.viewFollowup")}
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </section>
      {nextCursor ? (
        <div className={styles.loadMore}>
          <button className="button-quiet" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? t("pages.common.loading") : t("pages.results.loadMore")}
          </button>
        </div>
      ) : null}
    </>
  );
}

function PracticeList({ rounds }: { rounds: RoundFilterOption[] }) {
  const { locale, t } = useLocale();
  const [status, setStatus] = useState<FollowupStatusFilter>("all");
  const [quizId, setQuizId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [followups, setFollowups] = useState<FollowupSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const queryKey = `${status}\u0000${quizId}\u0000${fromDate}\u0000${toDate}`;
  const activeQueryKey = useRef(queryKey);
  const loadMoreController = useRef<AbortController | null>(null);
  activeQueryKey.current = queryKey;

  const fetchPage = useCallback(
    (cursor?: string, signal?: AbortSignal) =>
      apiFetch<CursorPage<FollowupSummary>>(
        `/v1/followups?${buildHistoryQuery({ status, quizId, fromDate, toDate }, cursor)}`,
        { signal },
      ),
    [fromDate, quizId, status, toDate],
  );

  useEffect(() => {
    const controller = new AbortController();
    const requestedQueryKey = queryKey;
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setLoading(true);
    setLoadingMore(false);
    setFollowups([]);
    setNextCursor(null);
    setError("");
    void fetchPage(undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
        setFollowups(response.items);
        setNextCursor(response.nextCursor);
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
  }, [fetchPage, queryKey]);

  async function more() {
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
      setFollowups((current) => [...current, ...response.items]);
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

  function clearFilters() {
    setStatus("all");
    setQuizId("all");
    setFromDate("");
    setToDate("");
  }

  return (
    <>
      <HistoryFilters
        fromDate={fromDate}
        onClear={clearFilters}
        onFromDateChange={setFromDate}
        onQuizChange={setQuizId}
        onStatusChange={(value) => setStatus(value as FollowupStatusFilter)}
        onToDateChange={setToDate}
        quizId={quizId}
        rounds={rounds}
        status={status}
        statusLabel={t("pages.results.practiceStatus")}
        statusOptions={[
          { value: "all", label: t("pages.results.allPractice") },
          { value: "scheduled", label: t("pages.common.status.scheduled") },
          { value: "open", label: t("pages.common.status.open") },
          { value: "closed", label: t("pages.common.status.closed") },
          { value: "expired", label: t("pages.common.status.expired") },
        ]}
        toDate={toDate}
      />
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.muted} role="status">
          {t("pages.results.loadingPractice")}
        </p>
      ) : null}
      {!loading && !followups.length && !error ? (
        <div className={styles.emptyState}>
          <h2>{t("pages.results.emptyPracticeTitle")}</h2>
          <p>
            {status === "all" && quizId === "all" && !fromDate && !toDate
              ? t("pages.results.emptyPracticeDescription")
              : t("pages.results.noPracticeMatches")}
          </p>
        </div>
      ) : null}
      <section className={styles.list} aria-label={t("pages.results.practiceListLabel")}>
        {followups.map((followup) => (
          <article className={styles.listCard} key={followup.id}>
            <div className={styles.rowTopline}>
              <div>
                <h2 lang="">{followup.title}</h2>
                <PackPracticeAttribution source={followup.recoveryPackSource} />
                <p className={styles.summaryLine}>
                  {t("pages.assignments.created", {
                    date: formatDateTime(locale, followup.createdAt),
                  })}{" "}
                  ·{" "}
                  {t(
                    pluralCategory(locale, followup.checkpointCount) === "one"
                      ? "pages.assignments.questionCount.one"
                      : "pages.assignments.questionCount.other",
                    { count: followup.checkpointCount },
                  )}
                </p>
                <p className={styles.summaryLine}>
                  {t("pages.results.retainedUntil", {
                    date: formatDateTime(locale, followup.expiresAt),
                  })}
                </p>
              </div>
              <div className={styles.conceptList}>
                <span className={styles.subtlePill}>
                  {followup.purpose === "assignment"
                    ? t("pages.results.assignment")
                    : t("pages.results.recoveryFollowup")}
                </span>
                <span className={styles.status} data-tone={followup.status}>
                  {t(`pages.common.status.${followup.status}`)}
                </span>
              </div>
            </div>
            <div className={styles.metricGrid}>
              <div className={styles.metric}>
                <strong>{followup.attemptCount}</strong>
                <span>{t("pages.common.attempts")}</span>
              </div>
              <div className={styles.metric}>
                <strong>{followup.completedAttemptCount}</strong>
                <span>{t("pages.common.completed")}</span>
              </div>
              <div className={styles.metric}>
                <strong>{formatDateTime(locale, followup.opensAt)}</strong>
                <span>{t("pages.results.opens")}</span>
              </div>
              <div className={styles.metric}>
                <strong>{formatDateTime(locale, followup.closesAt)}</strong>
                <span>{t("pages.results.closes")}</span>
              </div>
            </div>
            {followup.conceptKeys.length ? (
              <div className={styles.conceptList} aria-label={t("pages.results.conceptsPractised")}>
                {followup.conceptKeys.map((concept) => (
                  <span className={styles.subtlePill} key={concept}>
                    {concept}
                  </span>
                ))}
              </div>
            ) : null}
            <div className={styles.listCardActions}>
              <Link className="button small-button" href={`/practice/${followup.id}`}>
                {t("pages.results.managePractice")}
              </Link>
              {followup.sourceReportId ? (
                <Link
                  className="button-quiet small-button"
                  href={`/report/${followup.sourceReportId}`}
                >
                  {t("pages.results.viewSourceResult")}
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </section>
      {nextCursor ? (
        <div className={styles.loadMore}>
          <button className="button-quiet" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? t("pages.common.loading") : t("pages.results.loadMorePractice")}
          </button>
        </div>
      ) : null}
    </>
  );
}

interface PresentationResultSummary {
  id: string;
  presentationId: string;
  title: string;
  status: "active" | "finished";
  phase: string;
  participantCount: number;
  responseCount: number;
  blockCount: number;
  createdAt: string;
  finishedAt?: string | null;
}

function PresentationResultList() {
  const { locale, t } = useLocale();
  const [sessions, setSessions] = useState<PresentationResultSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ sessions: PresentationResultSummary[] }>("/v1/presentation-sessions", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setSessions(response.sessions);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  if (loading) return <p className={styles.muted}>{t("pages.results.loadingPresentations")}</p>;
  if (error)
    return (
      <p className="error" lang="en-CA" role="alert">
        {error}
      </p>
    );
  if (!sessions.length) {
    return (
      <div className={styles.emptyState}>
        <h2>{t("pages.results.emptyPresentationsTitle")}</h2>
        <p>{t("pages.results.emptyPresentationsDescription")}</p>
        <Link className="button" href="/library?type=presentations">
          {t("pages.results.choosePresentation")}
        </Link>
      </div>
    );
  }
  return (
    <section className={styles.list} aria-label={t("pages.results.presentationResults")}>
      {sessions.map((session) => (
        <article className={styles.listCard} key={session.id}>
          <div className={styles.rowTopline}>
            <div>
              <p className="eyebrow">{t("pages.common.presentation")}</p>
              <h2 lang="">{session.title}</h2>
              <p className={styles.summaryLine}>
                {t("pages.results.presentationStarted", {
                  date: formatDateTime(locale, session.createdAt),
                  count: session.blockCount,
                })}
              </p>
            </div>
            <span className={styles.status} data-tone={session.status}>
              {t(`pages.common.status.${session.status}`)}
            </span>
          </div>
          <div className={styles.metricGrid}>
            <div className={styles.metric}>
              <strong>{session.participantCount}</strong>
              <span>{t("pages.common.participants")}</span>
            </div>
            <div className={styles.metric}>
              <strong>{session.responseCount}</strong>
              <span>{t("pages.results.responses")}</span>
            </div>
            <div className={styles.metric}>
              <strong>
                <SessionPhaseLabel phase={session.phase} />
              </strong>
              <span>{t("pages.results.sessionPhase")}</span>
            </div>
          </div>
          <div className={styles.listCardActions}>
            <Link
              className="button small-button"
              href={`/presentation-session/${session.id}/report`}
            >
              {t("pages.results.openReport")}
            </Link>
            <Link
              className="button-quiet small-button"
              href={`/presentation/${session.presentationId}`}
            >
              {t("pages.sessions.viewPresentation")}
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}

function ResultsContent() {
  const { t } = useLocale();
  const params = useSearchParams();
  const { productFeatures } = useWorkspace();
  const presentationsEnabled = productFeatures?.presentations === true;
  const requestedView = params.get("view");
  const view =
    requestedView === "practice"
      ? "practice"
      : requestedView === "presentations" && presentationsEnabled
        ? "presentations"
        : "results";
  const [rounds, setRounds] = useState<RoundFilterOption[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ quizzes: RoundFilterOption[] }>("/v1/quizzes?archived=true&summary=true", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setRounds(response.quizzes);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <>
      <nav className={styles.tabList} aria-label={t("pages.results.evidenceViews")}>
        <Link
          aria-current={view === "results" ? "page" : undefined}
          className={view === "results" ? styles.tabActive : styles.tab}
          href="/results"
        >
          {t("pages.results.recoveryResults")}
        </Link>
        {presentationsEnabled ? (
          <Link
            aria-current={view === "presentations" ? "page" : undefined}
            className={view === "presentations" ? styles.tabActive : styles.tab}
            href="/results?view=presentations"
          >
            {t("pages.results.presentationResults")}
          </Link>
        ) : null}
        <Link
          aria-current={view === "practice" ? "page" : undefined}
          className={view === "practice" ? styles.tabActive : styles.tab}
          href="/results?view=practice"
        >
          {t("pages.results.practice")}
        </Link>
      </nav>
      {view === "practice" ? (
        <PracticeList rounds={rounds} />
      ) : view === "presentations" ? (
        <PresentationResultList />
      ) : (
        <ReportList rounds={rounds} />
      )}
    </>
  );
}

export default function ResultsPage() {
  const { t } = useLocale();
  return (
    <WorkspaceProvider>
      <WorkspaceShell
        description={t("page.results.description")}
        eyebrow={t("page.results.eyebrow")}
        title={t("page.results.title")}
        translationLevel="full"
      >
        <p>
          <Link href="/surveys">{t("create.kind.browseSurveys")}</Link>
        </p>
        <ResultsContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
