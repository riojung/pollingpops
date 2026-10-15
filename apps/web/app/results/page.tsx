"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "../../components/locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import { buildHistoryQuery, type HistoryQueryFilters } from "../../lib/history-query";
import type { SurveySessionSummary } from "../../lib/session-controls";
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
import controls from "../../components/workspace/workspace-history-controls.module.css";
import resultStyles from "./results.module.css";
import { PackPracticeAttribution } from "../../components/practice/pack-practice-attribution";

type ReportStatusFilter = "all" | ReportSummary["status"];
type FollowupStatusFilter = "all" | FollowupSummary["status"];

type ResultsLayout = "grid" | "list";
interface ListControls {
  search: string;
  layout: ResultsLayout;
  onLayoutChange: (value: ResultsLayout) => void;
  onSearchClear: () => void;
}

function ResultsSummary({
  count,
  loading,
  hasMore = false,
  practice = false,
  layout,
  onLayoutChange,
}: ListControls & { count: number; loading: boolean; hasMore?: boolean; practice?: boolean }) {
  const { t } = useLocale();
  const summary = t(practice ? "pages.results.practiceCount" : "pages.results.resultCount", {
    count,
  });
  return (
    <>
      <p className={controls.resultSummary} role="status">
        {loading
          ? t("pages.results.loading")
          : hasMore
            ? t("pages.results.moreAvailable", { summary })
            : summary}
      </p>
      <div aria-label={t("pages.results.layoutLabel")} className={controls.viewToggle} role="group">
        {(["grid", "list"] as const).map((value) => (
          <button
            aria-label={t(value === "grid" ? "pages.library.gridView" : "pages.library.listView")}
            aria-pressed={layout === value}
            key={value}
            onClick={() => onLayoutChange(value)}
            type="button"
          >
            {t(value === "grid" ? "pages.library.grid" : "pages.library.list")}
          </button>
        ))}
      </div>
    </>
  );
}

function useHistoryPage<T>(path: string, filters: HistoryQueryFilters) {
  const { creator } = useWorkspace();
  const workspaceId = creator?.workspaceId ?? "";
  const { status, quizId, fromDate, toDate, search } = filters;
  const queryKey = `${workspaceId}\u0000${path}?${buildHistoryQuery(filters)}`;
  const activeQueryKey = useRef(queryKey);
  activeQueryKey.current = queryKey;
  const loadMoreController = useRef<AbortController | null>(null);
  const [page, setPage] = useState<{ key: string; items: T[]; nextCursor: string | null }>({
    key: "",
    items: [],
    nextCursor: null,
  });
  const [fetching, setFetching] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState({ key: "", message: "" });
  const fetchPage = useCallback(
    (cursor?: string, signal?: AbortSignal) =>
      apiFetch<CursorPage<T>>(
        `${path}?${buildHistoryQuery({ status, quizId, fromDate, toDate, search }, cursor)}`,
        { signal },
      ),
    [path, status, quizId, fromDate, toDate, search],
  );

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setFetching(true);
    setLoadingMore(false);
    setFailure({ key: queryKey, message: "" });
    void fetchPage(undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || activeQueryKey.current !== queryKey) return;
        setPage({ key: queryKey, ...response });
      })
      .catch((caught) => {
        if (controller.signal.aborted || activeQueryKey.current !== queryKey) return;
        setPage({ key: queryKey, items: [], nextCursor: null });
        setFailure({ key: queryKey, message: humanError(caught) });
      })
      .finally(() => {
        if (!controller.signal.aborted && activeQueryKey.current === queryKey) setFetching(false);
      });
    return () => {
      controller.abort();
      loadMoreController.current?.abort();
    };
  }, [fetchPage, queryKey, workspaceId]);

  async function more() {
    if (page.key !== queryKey || !page.nextCursor || loadMoreController.current) return;
    const controller = new AbortController();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setFailure({ key: queryKey, message: "" });
    try {
      const response = await fetchPage(page.nextCursor, controller.signal);
      if (controller.signal.aborted || activeQueryKey.current !== queryKey) return;
      setPage((current) => ({
        key: queryKey,
        items: [...current.items, ...response.items],
        nextCursor: response.nextCursor,
      }));
    } catch (caught) {
      if (controller.signal.aborted || activeQueryKey.current !== queryKey) return;
      setFailure({ key: queryKey, message: humanError(caught) });
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        if (activeQueryKey.current === queryKey) setLoadingMore(false);
      }
    }
  }

  return {
    items: page.key === queryKey ? page.items : [],
    nextCursor: page.key === queryKey ? page.nextCursor : null,
    loading: fetching || page.key !== queryKey,
    loadingMore,
    error: failure.key === queryKey ? failure.message : "",
    more,
  };
}

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
  listControls,
  count,
  loading,
  hasMore,
  practice,
  sourceLabel,
  allSourcesLabel,
  hideStatus = false,
  fromLabel,
  toLabel,
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
  listControls: ListControls;
  count: number;
  loading: boolean;
  hasMore: boolean;
  practice?: boolean;
  sourceLabel?: string;
  allSourcesLabel?: string;
  hideStatus?: boolean;
  fromLabel?: string;
  toLabel?: string;
}) {
  const { t } = useLocale();
  const hasFilters =
    status !== "all" ||
    quizId !== "all" ||
    fromDate !== "" ||
    toDate !== "" ||
    Boolean(listControls.search);
  return (
    <section aria-label={t("pages.results.historyFilters")} className={controls.filterBar}>
      {hideStatus ? null : (
        <label className={controls.filterField}>
          <span>{statusLabel}</span>
          <select onChange={(event) => onStatusChange(event.target.value)} value={status}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={controls.filterField}>
        <span>{sourceLabel ?? t("pages.common.round")}</span>
        <select onChange={(event) => onQuizChange(event.target.value)} value={quizId}>
          <option value="all">{allSourcesLabel ?? t("pages.results.allRounds")}</option>
          {rounds.map((round) => (
            <option key={round.id} lang="" value={round.id}>
              {round.title}
            </option>
          ))}
        </select>
      </label>
      <label className={controls.filterField}>
        <span>{fromLabel ?? t("pages.common.from")}</span>
        <input
          onChange={(event) => onFromDateChange(event.target.value)}
          type="date"
          value={fromDate}
        />
      </label>
      <label className={controls.filterField}>
        <span>{toLabel ?? t("pages.common.to")}</span>
        <input
          min={fromDate || undefined}
          onChange={(event) => onToDateChange(event.target.value)}
          type="date"
          value={toDate}
        />
      </label>
      {hasFilters ? (
        <button
          className={`button-quiet ${resultStyles.clearFilters}`}
          onClick={onClear}
          type="button"
        >
          {t("pages.results.clearFilters")}
        </button>
      ) : null}
      <ResultsSummary
        {...listControls}
        count={count}
        loading={loading}
        hasMore={hasMore}
        practice={practice}
      />
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

function ReportList({ rounds, ...listControls }: ListControls & { rounds: RoundFilterOption[] }) {
  const { locale, t } = useLocale();
  const [status, setStatus] = useState<ReportStatusFilter>("all");
  const [quizId, setQuizId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const {
    items: reports,
    nextCursor,
    loading,
    loadingMore,
    error,
    more,
  } = useHistoryPage<ReportSummary>("/v1/reports", {
    status,
    quizId,
    fromDate,
    toDate,
    search: listControls.search,
  });

  function clearFilters() {
    setStatus("all");
    setQuizId("all");
    setFromDate("");
    setToDate("");
    listControls.onSearchClear();
  }

  return (
    <>
      <HistoryFilters
        listControls={listControls}
        count={reports.length}
        loading={loading}
        hasMore={Boolean(nextCursor)}
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
            {status === "all" && quizId === "all" && !fromDate && !toDate && !listControls.search
              ? t("pages.results.emptyDescription")
              : t("pages.results.noMatches")}
          </p>
          <Link className="button" href="/dashboard">
            {t("pages.assignments.chooseRound")}
          </Link>
        </div>
      ) : null}
      <section
        className={resultStyles.collection}
        data-view={listControls.layout}
        aria-label={t("pages.common.results")}
      >
        {reports.map((report) => (
          <article className={`${styles.listCard} ${resultStyles.card}`} key={report.id}>
            <div className={`${styles.rowTopline} ${resultStyles.topline}`}>
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
            <div className={`${styles.metricGrid} ${resultStyles.metrics}`}>
              <div className={styles.metric}>
                <strong>
                  {report.initialAccuracyPercent === null
                    ? "—"
                    : formatPercent(report.initialAccuracyPercent)}
                </strong>
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
            <div className={`${styles.listCardActions} ${resultStyles.actions}`}>
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

function PracticeList({ rounds, ...listControls }: ListControls & { rounds: RoundFilterOption[] }) {
  const { locale, t } = useLocale();
  const [status, setStatus] = useState<FollowupStatusFilter>("all");
  const [quizId, setQuizId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const {
    items: followups,
    nextCursor,
    loading,
    loadingMore,
    error,
    more,
  } = useHistoryPage<FollowupSummary>("/v1/followups", {
    status,
    quizId,
    fromDate,
    toDate,
    search: listControls.search,
  });

  function clearFilters() {
    setStatus("all");
    setQuizId("all");
    setFromDate("");
    setToDate("");
    listControls.onSearchClear();
  }

  return (
    <>
      <HistoryFilters
        listControls={listControls}
        count={followups.length}
        loading={loading}
        hasMore={Boolean(nextCursor)}
        practice
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
            {status === "all" && quizId === "all" && !fromDate && !toDate && !listControls.search
              ? t("pages.results.emptyPracticeDescription")
              : t("pages.results.noPracticeMatches")}
          </p>
        </div>
      ) : null}
      <section
        className={resultStyles.collection}
        data-view={listControls.layout}
        aria-label={t("pages.results.practiceListLabel")}
      >
        {followups.map((followup) => (
          <article className={`${styles.listCard} ${resultStyles.card}`} key={followup.id}>
            <div className={`${styles.rowTopline} ${resultStyles.topline}`}>
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
              <div className={`${styles.conceptList} ${resultStyles.concepts}`}>
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
            <div className={`${styles.metricGrid} ${resultStyles.metrics}`}>
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
              <div
                className={`${styles.conceptList} ${resultStyles.concepts}`}
                aria-label={t("pages.results.conceptsPractised")}
              >
                {followup.conceptKeys.map((concept) => (
                  <span className={styles.subtlePill} key={concept}>
                    {concept}
                  </span>
                ))}
              </div>
            ) : null}
            <div className={`${styles.listCardActions} ${resultStyles.actions}`}>
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

function PresentationResultList(listControls: ListControls) {
  const { locale, t } = useLocale();
  const [sessions, setSessions] = useState<PresentationResultSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");
  const [sourceId, setSourceId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

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

  const search = listControls.search.trim().toLocaleLowerCase();
  const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : -Infinity;
  const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Infinity;
  const visible = sessions.filter((session) => {
    const createdAt = new Date(session.createdAt).getTime();
    return (
      (!search || session.title.toLocaleLowerCase().includes(search)) &&
      (status === "all" || session.status === status) &&
      (sourceId === "all" || session.presentationId === sourceId) &&
      createdAt >= from &&
      createdAt <= to
    );
  });
  const sources = Array.from(
    new Map(
      sessions.map((session) => [
        session.presentationId,
        { id: session.presentationId, title: session.title },
      ]),
    ).values(),
  );
  const filtered = Boolean(search || status !== "all" || sourceId !== "all" || fromDate || toDate);

  function clearFilters() {
    setStatus("all");
    setSourceId("all");
    setFromDate("");
    setToDate("");
    listControls.onSearchClear();
  }

  return (
    <>
      <HistoryFilters
        listControls={listControls}
        count={visible.length}
        loading={loading}
        hasMore={false}
        status={status}
        statusLabel={t("pages.common.statusLabel")}
        statusOptions={[
          { value: "all", label: t("pages.results.allResults") },
          { value: "active", label: t("pages.common.status.active") },
          { value: "finished", label: t("pages.common.status.finished") },
        ]}
        quizId={sourceId}
        rounds={sources}
        sourceLabel={t("pages.common.presentation")}
        allSourcesLabel={t("pages.sessions.allPresentations")}
        fromDate={fromDate}
        toDate={toDate}
        onStatusChange={setStatus}
        onQuizChange={setSourceId}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        onClear={clearFilters}
      />
      {loading ? <p className={styles.muted}>{t("pages.results.loadingPresentations")}</p> : null}
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && !visible.length ? (
        <div className={styles.emptyState}>
          <h2>{t("pages.results.emptyPresentationsTitle")}</h2>
          <p>
            {t(
              filtered ? "pages.results.noMatches" : "pages.results.emptyPresentationsDescription",
            )}
          </p>
          <Link className="button" href="/library?type=presentations">
            {t("pages.results.choosePresentation")}
          </Link>
        </div>
      ) : null}
      <section
        className={resultStyles.collection}
        data-view={listControls.layout}
        aria-label={t("pages.results.presentationResults")}
      >
        {visible.map((session) => (
          <article className={`${styles.listCard} ${resultStyles.card}`} key={session.id}>
            <div className={`${styles.rowTopline} ${resultStyles.topline}`}>
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
            <div className={`${styles.metricGrid} ${resultStyles.metrics}`}>
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
            <div className={`${styles.listCardActions} ${resultStyles.actions}`}>
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
    </>
  );
}

function SurveyResultList(listControls: ListControls) {
  const { locale, t } = useLocale();
  const { creator } = useWorkspace();
  const workspaceId = creator?.workspaceId ?? "";
  const activeWorkspace = useRef(workspaceId);
  activeWorkspace.current = workspaceId;
  const [snapshot, setSnapshot] = useState<{
    workspaceId: string;
    rooms: SurveySessionSummary[];
    error: string;
  }>({ workspaceId: "", rooms: [], error: "" });
  const [sourceId, setSourceId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [displayPage, setDisplayPage] = useState({ key: "", limit: 25 });
  const [now, setNow] = useState(() => Date.now());
  const loadingError = t("pages.results.surveyLoadError");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && activeWorkspace.current === workspaceId;
    async function load() {
      const rooms = new Map<string, SurveySessionSummary>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      do {
        if (cursor) {
          if (seenCursors.has(cursor)) throw new Error(loadingError);
          seenCursors.add(cursor);
        }
        const params = new URLSearchParams({ limit: "50" });
        if (cursor) params.set("cursor", cursor);
        const page = await apiFetch<{
          rooms: SurveySessionSummary[];
          nextCursor: string | null;
        }>(`/v1/survey-rooms?${params}`, { signal: controller.signal });
        if (!isCurrent()) return;
        for (const room of page.rooms) rooms.set(room.id, room);
        cursor = page.nextCursor;
      } while (cursor);
      if (isCurrent()) setSnapshot({ workspaceId, rooms: [...rooms.values()], error: "" });
    }
    void load().catch((caught) => {
      if (isCurrent()) setSnapshot({ workspaceId, rooms: [], error: humanError(caught) });
    });
    return () => controller.abort();
  }, [loadingError, workspaceId]);

  const loading = !workspaceId || snapshot.workspaceId !== workspaceId;
  const error = loading ? "" : snapshot.error;
  const retained = (loading ? [] : snapshot.rooms)
    .filter(
      (room) =>
        (room.closed || new Date(room.closesAt).getTime() <= now) &&
        new Date(room.expiresAt).getTime() > now,
    )
    .sort(
      (left, right) =>
        new Date(right.closesAt).getTime() - new Date(left.closesAt).getTime() ||
        left.id.localeCompare(right.id),
    );
  const sources = Array.from(
    new Map(
      retained.map((room) => [room.surveyId, { id: room.surveyId, title: room.title }]),
    ).values(),
  ).sort((left, right) => left.title.localeCompare(right.title));
  const search = listControls.search.trim().toLocaleLowerCase();
  const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : -Infinity;
  const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Infinity;
  const filtered = retained.filter((room) => {
    const deadline = new Date(room.closesAt).getTime();
    return (
      (!search ||
        room.title.toLocaleLowerCase().includes(search) ||
        room.code.toLocaleLowerCase().includes(search)) &&
      (sourceId === "all" || room.surveyId === sourceId) &&
      deadline >= from &&
      deadline <= to
    );
  });
  const filterKey = JSON.stringify([workspaceId, search, sourceId, fromDate, toDate]);
  const displayLimit = displayPage.key === filterKey ? displayPage.limit : 25;
  const visible = filtered.slice(0, displayLimit);
  const hasMore = filtered.length > displayLimit;
  const hasFilters = Boolean(search || sourceId !== "all" || fromDate || toDate);

  function clearFilters() {
    setSourceId("all");
    setFromDate("");
    setToDate("");
    listControls.onSearchClear();
  }

  return (
    <>
      <HistoryFilters
        listControls={listControls}
        count={visible.length}
        loading={loading}
        hasMore={hasMore}
        hideStatus
        status="all"
        statusLabel=""
        statusOptions={[]}
        onStatusChange={() => undefined}
        quizId={sourceId}
        rounds={sources}
        sourceLabel={t("pages.common.survey")}
        allSourcesLabel={t("pages.sessions.allSurveys")}
        fromDate={fromDate}
        toDate={toDate}
        fromLabel={t("pages.results.surveyDeadlineFrom")}
        toLabel={t("pages.results.surveyDeadlineTo")}
        onQuizChange={setSourceId}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        onClear={clearFilters}
      />
      {loading ? (
        <p className={styles.muted} role="status">
          {t("pages.results.loadingSurveys")}
        </p>
      ) : null}
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && !visible.length ? (
        <div className={styles.emptyState}>
          <h2>{t("pages.results.emptySurveysTitle")}</h2>
          <p>
            {t(hasFilters ? "pages.results.noMatches" : "pages.results.emptySurveysDescription")}
          </p>
          <Link className="button" href="/sessions?type=surveys">
            {t("pages.results.manageSurveyRuns")}
          </Link>
        </div>
      ) : null}
      <section
        className={resultStyles.collection}
        data-view={listControls.layout}
        aria-label={t("pages.results.surveyResults")}
      >
        {visible.map((room) => (
          <article
            className={`${styles.listCard} ${resultStyles.card} ${resultStyles.surveyCard}`}
            key={room.id}
          >
            <div className={`${styles.rowTopline} ${resultStyles.topline}`}>
              <div>
                <h2 lang="">{room.title}</h2>
                <p className={styles.summaryLine}>
                  {t("pages.results.surveyRunCode", { code: room.code })}
                </p>
                <p className={styles.summaryLine}>
                  {t("pages.results.surveyCollectionDeadline", {
                    date: formatDateTime(locale, room.closesAt),
                  })}
                </p>
                <p className={styles.summaryLine}>
                  {t("pages.results.retainedUntil", {
                    date: formatDateTime(locale, room.expiresAt),
                  })}
                </p>
              </div>
              <span className={styles.status} data-tone="closed">
                {t("pages.common.status.closed")}
              </span>
            </div>
            <div className={`${styles.listCardActions} ${resultStyles.actions}`}>
              <Link className="button small-button" href={`/results/surveys/${room.id}`}>
                {t("pages.common.viewResults")}
              </Link>
            </div>
          </article>
        ))}
      </section>
      {hasMore ? (
        <div className={styles.loadMore}>
          <button
            className="button-quiet"
            onClick={() => setDisplayPage({ key: filterKey, limit: displayLimit + 25 })}
            type="button"
          >
            {t("pages.results.loadMore")}
          </button>
        </div>
      ) : null}
    </>
  );
}

function ResultsContent() {
  const { t } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const { creator, productFeatures } = useWorkspace();
  const workspaceId = creator?.workspaceId ?? "";
  const presentationsEnabled = productFeatures?.presentations === true;
  const requestedView = params.get("view");
  const view =
    requestedView === "practice"
      ? "practice"
      : requestedView === "presentations" && presentationsEnabled
        ? "presentations"
        : requestedView === "surveys"
          ? "surveys"
          : "results";
  const search = (params.get("q") ?? "").slice(0, 160);
  const [sources, setSources] = useState<{ workspaceId: string; rounds: RoundFilterOption[] }>({
    workspaceId: "",
    rounds: [],
  });
  const [preference, setPreference] = useState<{ workspaceId: string; layout: ResultsLayout }>({
    workspaceId: "",
    layout: "grid",
  });
  const layout = preference.workspaceId === workspaceId ? preference.layout : "grid";
  const storageKey = `openround:results-view:v1:${workspaceId}`;
  const rounds = sources.workspaceId === workspaceId ? sources.rounds : [];

  useEffect(() => {
    if (!workspaceId) return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(storageKey);
    } catch {
      /* Use the default layout. */
    }
    setPreference({ workspaceId, layout: saved === "list" ? "list" : "grid" });
  }, [storageKey, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    void apiFetch<{ quizzes: RoundFilterOption[] }>("/v1/quizzes?archived=true&summary=true", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setSources({ workspaceId, rounds: response.quizzes });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId]);

  function chooseLayout(value: ResultsLayout) {
    setPreference({ workspaceId, layout: value });
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      /* Keep the in-memory preference. */
    }
  }

  function updateSearch(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("q", value);
    else next.delete("q");
    router.replace(`/results${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  const listControls: ListControls = {
    search,
    layout,
    onLayoutChange: chooseLayout,
    onSearchClear: () => updateSearch(""),
  };
  const searchLabel = t(
    view === "practice"
      ? "pages.results.searchPractice"
      : view === "presentations"
        ? "pages.results.searchPresentations"
        : view === "surveys"
          ? "pages.results.searchSurveys"
          : "pages.results.searchRounds",
  );

  return (
    <WorkspaceShell
      description={t("page.results.description")}
      eyebrow={t("page.results.eyebrow")}
      title={t("page.results.title")}
      translationLevel="full"
    >
      <div className={controls.toolbar}>
        <nav className={controls.tabs} aria-label={t("pages.results.evidenceViews")}>
          <Link
            aria-current={view === "results" ? "page" : undefined}
            className={view === "results" ? controls.tabActive : controls.tab}
            href="/results"
          >
            {t("pages.common.rounds")}
          </Link>
          {presentationsEnabled ? (
            <Link
              aria-current={view === "presentations" ? "page" : undefined}
              className={view === "presentations" ? controls.tabActive : controls.tab}
              href="/results?view=presentations"
            >
              {t("pages.common.presentations")}
            </Link>
          ) : null}
          <Link
            aria-current={view === "surveys" ? "page" : undefined}
            className={view === "surveys" ? controls.tabActive : controls.tab}
            href="/results?view=surveys"
          >
            {t("pages.common.surveys")}
          </Link>
          <Link
            aria-current={view === "practice" ? "page" : undefined}
            className={view === "practice" ? controls.tabActive : controls.tab}
            href="/results?view=practice"
          >
            {t("pages.results.practice")}
          </Link>
        </nav>
        <label className={controls.searchField}>
          <span className="sr-only">{searchLabel}</span>
          <input
            maxLength={160}
            onChange={(event) => updateSearch(event.target.value)}
            placeholder={searchLabel}
            type="search"
            value={search}
          />
        </label>
        <Link
          className={controls.libraryLink}
          href={`/library?type=${view === "presentations" ? "presentations" : view === "surveys" ? "surveys" : "rounds"}`}
        >
          {t("pages.sessions.backToLibrary", {
            type: t(
              view === "presentations"
                ? "pages.common.presentation"
                : view === "surveys"
                  ? "pages.common.survey"
                  : "pages.common.round",
            ),
          })}
        </Link>
      </div>
      <div key={`${workspaceId}\u0000${view}`}>
        {view === "practice" ? (
          <PracticeList {...listControls} rounds={rounds} />
        ) : view === "presentations" ? (
          <PresentationResultList {...listControls} />
        ) : view === "surveys" ? (
          <SurveyResultList {...listControls} />
        ) : (
          <ReportList {...listControls} rounds={rounds} />
        )}
      </div>
    </WorkspaceShell>
  );
}

export default function ResultsPage() {
  return (
    <Suspense>
      <WorkspaceProvider>
        <ResultsContent />
      </WorkspaceProvider>
    </Suspense>
  );
}
