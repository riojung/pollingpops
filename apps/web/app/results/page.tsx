"use client";

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  SurveyResultSummary,
  SurveyResultsPage,
  SurveyResultsSources,
} from "@openround/contracts";
import { useLocale } from "../../components/locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import {
  buildHistoryFilterQuery,
  buildHistoryQuery,
  type HistoryQueryFilters,
} from "../../lib/history-query";
import { formatDateTime, formatNumber, pluralCategory } from "../../lib/i18n/format";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { SessionPhaseLabel } from "../../components/workspace/session-phase-label";
import {
  WorkspaceKindIcon,
  WorkspaceStatus,
  workspaceStateTone,
} from "../../components/workspace/workspace-signals";
import type {
  CursorPage,
  FollowupSummary,
  ReportSummary,
  RoundFilterOption,
} from "../../components/workspace/workspace-types";
import styles from "../../components/workspace/workspace-content.module.css";
import controls from "../../components/workspace/workspace-history-controls.module.css";
import signals from "../../components/workspace/workspace-signals.module.css";
import resultStyles from "./results.module.css";
import { PackPracticeAttribution } from "../../components/practice/pack-practice-attribution";
import { EvidenceMeter, ResultKindIcon, ResultsOverview } from "./results-overview";
import {
  PracticeResultsOverview,
  PresentationResultsOverview,
  RoundResultsOverview,
  useSurveyResultsAnalytics,
} from "./history-results-overview";
import {
  evidencePercent,
  type PresentationResultSummary,
  type ResultsActivityGrouping,
} from "./results-overview-model";

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
  countAvailable,
  loading,
  hasMore = false,
  practice = false,
  layout,
  onLayoutChange,
}: ListControls & {
  count: number;
  countAvailable: boolean;
  loading: boolean;
  hasMore?: boolean;
  practice?: boolean;
}) {
  const { t } = useLocale();
  const summary = t(practice ? "pages.results.practiceCount" : "pages.results.resultCount", {
    count,
  });
  return (
    <>
      <p className={controls.resultSummary} role="status">
        {loading
          ? t("pages.results.loading")
          : !countAvailable
            ? null
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
            {t(value === "grid" ? "pages.library.gridView" : "pages.library.listView")}
          </button>
        ))}
      </div>
    </>
  );
}

function useHistorySearch(input: string) {
  const search = input.trim();
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    if (search === debouncedSearch) return;
    if (!search) {
      setDebouncedSearch("");
      return;
    }
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);
  return search ? debouncedSearch : "";
}

function readHistoryPage<T>(path: string, signal?: AbortSignal) {
  return apiFetch<CursorPage<T>>(path, { signal });
}

function useHistoryPage<T>(
  path: string,
  filters: HistoryQueryFilters,
  {
    revision = 0,
    readPage = readHistoryPage<T>,
  }: { revision?: number; readPage?: typeof readHistoryPage<T> } = {},
) {
  const { creator } = useWorkspace();
  const workspaceId = creator?.workspaceId ?? "";
  const pageQuery = buildHistoryQuery(filters).toString();
  const queryKey = `${workspaceId}\u0000${path}?${pageQuery}`;
  const activeQueryKey = useRef(queryKey);
  activeQueryKey.current = queryKey;
  const activeRevision = useRef(revision);
  activeRevision.current = revision;
  const refreshedRevision = useRef(revision);
  const loadMoreController = useRef<AbortController | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const [page, setPage] = useState<{
    key: string;
    items: T[];
    nextCursor: string | null;
    pageCount: number;
  }>({
    key: "",
    items: [],
    nextCursor: null,
    pageCount: 0,
  });
  const [fetching, setFetching] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
    kind: "initial" | "more" | "refresh";
  }>({ key: "", message: "", kind: "initial" });
  const [reload, setReload] = useState(0);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const fetchPage = useCallback(
    (cursor?: string, signal?: AbortSignal) => {
      const params = new URLSearchParams(pageQuery);
      if (cursor) params.set("cursor", cursor);
      return readPage(`${path}?${params}`, signal);
    },
    [path, pageQuery, readPage],
  );

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    refreshController.current?.abort();
    refreshController.current = null;
    refreshedRevision.current = activeRevision.current;
    setFetching(true);
    setLoadingMore(false);
    setRefreshing(false);
    setFailure({ key: queryKey, message: "", kind: "initial" });
    void fetchPage(undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || activeQueryKey.current !== queryKey) return;
        setPage({ key: queryKey, ...response, pageCount: 1 });
      })
      .catch((caught) => {
        if (controller.signal.aborted || activeQueryKey.current !== queryKey) return;
        setPage((current) =>
          current.key === queryKey
            ? current
            : { key: queryKey, items: [], nextCursor: null, pageCount: 0 },
        );
        setFailure({ key: queryKey, message: humanError(caught), kind: "initial" });
      })
      .finally(() => {
        if (!controller.signal.aborted && activeQueryKey.current === queryKey) setFetching(false);
      });
    return () => {
      controller.abort();
      loadMoreController.current?.abort();
      refreshController.current?.abort();
    };
  }, [fetchPage, queryKey, workspaceId, reload]);

  useEffect(() => {
    if (
      revision === refreshedRevision.current ||
      fetching ||
      loadingMore ||
      refreshing ||
      loadMoreController.current ||
      refreshController.current ||
      page.key !== queryKey ||
      page.pageCount === 0
    )
      return;

    const controller = new AbortController();
    refreshController.current = controller;
    refreshedRevision.current = revision;
    setRefreshing(true);
    const isCurrent = () => !controller.signal.aborted && activeQueryKey.current === queryKey;

    async function refreshLoadedPages() {
      // Rebuild the same slice from fresh cursors and publish it as one update.
      // A closure or deletion can move rows across the previous page boundaries.
      const items: T[] = [];
      let nextCursor: string | null = null;
      let pageCount = 0;
      do {
        const response = await fetchPage(nextCursor ?? undefined, controller.signal);
        if (!isCurrent()) return;
        items.push(...response.items);
        nextCursor = response.nextCursor;
        pageCount++;
      } while (nextCursor && pageCount < page.pageCount);
      setPage({ key: queryKey, items, nextCursor, pageCount });
      setFailure({ key: queryKey, message: "", kind: "refresh" });
    }

    void refreshLoadedPages()
      .catch((caught) => {
        if (isCurrent())
          setFailure({ key: queryKey, message: humanError(caught), kind: "refresh" });
      })
      .finally(() => {
        if (refreshController.current === controller) {
          refreshController.current = null;
          if (isCurrent()) setRefreshing(false);
        }
      });
  }, [
    fetchPage,
    fetching,
    loadingMore,
    page.key,
    page.pageCount,
    queryKey,
    refreshing,
    refreshAttempt,
    revision,
  ]);

  async function more() {
    if (
      fetching ||
      page.key !== queryKey ||
      !page.nextCursor ||
      loadMoreController.current ||
      refreshController.current
    )
      return;
    const controller = new AbortController();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setFailure({ key: queryKey, message: "", kind: "more" });
    try {
      const response = await fetchPage(page.nextCursor, controller.signal);
      if (controller.signal.aborted || activeQueryKey.current !== queryKey) return;
      setPage((current) => ({
        key: queryKey,
        items: [...current.items, ...response.items],
        nextCursor: response.nextCursor,
        pageCount: current.pageCount + 1,
      }));
    } catch (caught) {
      if (controller.signal.aborted || activeQueryKey.current !== queryKey) return;
      setFailure({ key: queryKey, message: humanError(caught), kind: "more" });
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        if (activeQueryKey.current === queryKey) setLoadingMore(false);
      }
    }
  }

  return {
    items: page.key === queryKey ? page.items : [],
    loaded: page.key === queryKey && page.pageCount > 0,
    nextCursor: page.key === queryKey ? page.nextCursor : null,
    loading: fetching || page.key !== queryKey,
    loadingMore,
    refreshing,
    error: failure.key === queryKey ? failure.message : "",
    retry: () => {
      if (fetching || refreshing || failure.key !== queryKey || !failure.message) return;
      if (failure.kind === "more") void more();
      else if (failure.kind === "refresh") {
        refreshedRevision.current = revision - 1;
        setRefreshAttempt((value) => value + 1);
      } else {
        setFetching(true);
        setFailure({ key: queryKey, message: "", kind: "initial" });
        setReload((value) => value + 1);
      }
    },
    more,
  };
}

function useHistoryMoreFocus(
  query: string,
  count: number,
  loadingMore: boolean,
  collection: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
) {
  const pending = useRef<{ query: string; count: number; button: HTMLButtonElement } | null>(null);

  useEffect(() => {
    const queued = pending.current;
    if (!queued) return;
    if (queued.query !== query) {
      pending.current = null;
      return;
    }
    if (loadingMore) return;
    pending.current = null;
    const triggerRemoved = !queued.button.isConnected;
    if (
      document.activeElement === queued.button ||
      (triggerRemoved && document.activeElement === document.body)
    ) {
      const firstAdded = collection.current?.querySelectorAll<HTMLElement>("article")[queued.count];
      if (firstAdded) firstAdded.focus();
      else if (triggerRemoved) panel.current?.focus();
    }
  }, [query, count, loadingMore, collection, panel]);

  return (button: HTMLButtonElement) => {
    if (button?.matches(":focus")) pending.current = { query, count, button };
  };
}

function ResultsPanel({
  view,
  busy,
  panelRef,
  children,
}: {
  view: "results" | "practice" | "presentations" | "surveys";
  busy?: boolean;
  panelRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <section
      aria-busy={busy}
      aria-labelledby={`results-${view}-link`}
      className={resultStyles.panel}
      id="results-panel"
      ref={panelRef}
      tabIndex={-1}
    >
      {children}
    </section>
  );
}

function ResultsLoading({
  label,
  layout,
  hasRows,
}: {
  label: string;
  layout: ResultsLayout;
  hasRows: boolean;
}) {
  return (
    <div className={resultStyles.loadingState}>
      <p className={styles.muted}>{label}</p>
      {!hasRows ? (
        <div aria-hidden="true" className={resultStyles.collection} data-view={layout}>
          {[0, 1, 2].map((placeholder) => (
            <div className={resultStyles.loadingCard} key={placeholder}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResultsLoadError({
  error,
  onRetry,
  panelRef,
  retained = false,
}: {
  error: string;
  onRetry: () => void;
  panelRef: RefObject<HTMLElement | null>;
  retained?: boolean;
}) {
  const { t } = useLocale();
  return (
    <section className={resultStyles.loadError} role="alert">
      <div>
        <p className="error" lang="en-CA">
          {error}
        </p>
        {retained ? <p>{t("resultsOverview.retained")}</p> : null}
      </div>
      <button
        className="button-quiet"
        onClick={() => {
          panelRef.current?.focus();
          onRetry();
        }}
        type="button"
      >
        {t("pages.common.tryAgain")}
      </button>
    </section>
  );
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
  countAvailable,
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
  countAvailable: boolean;
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
        countAvailable={countAvailable}
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
  const { creator } = useWorkspace();
  const workspaceId = creator?.workspaceId;
  const panel = useRef<HTMLElement>(null);
  const [grouping, setGrouping] = useState<ResultsActivityGrouping>("month");
  const [status, setStatus] = useState<ReportStatusFilter>("all");
  const [quizId, setQuizId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const filters = {
    status,
    quizId,
    fromDate,
    toDate,
    search: listControls.search,
    expectedWorkspaceId: workspaceId,
  };
  const totalsQuery = buildHistoryFilterQuery(filters);
  const {
    items: reports,
    loaded,
    nextCursor,
    loading,
    loadingMore,
    error,
    retry,
    more,
  } = useHistoryPage<ReportSummary>("/v1/reports", filters);
  const hasFilters = Boolean(
    status !== "all" || quizId !== "all" || fromDate || toDate || listControls.search,
  );

  function clearFilters() {
    setStatus("all");
    setQuizId("all");
    setFromDate("");
    setToDate("");
    listControls.onSearchClear();
  }

  return (
    <ResultsPanel view="results" panelRef={panel}>
      <HistoryFilters
        listControls={listControls}
        count={reports.length}
        countAvailable={loaded}
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
      {workspaceId ? (
        <RoundResultsOverview
          key={totalsQuery}
          query={totalsQuery}
          items={reports}
          hasMore={Boolean(nextCursor)}
          grouping={grouping}
          onGroupingChange={setGrouping}
        />
      ) : null}
      {error && !loading && !loadingMore ? (
        <ResultsLoadError
          error={error}
          onRetry={retry}
          panelRef={panel}
          retained={reports.length > 0}
        />
      ) : null}
      {loading ? (
        <ResultsLoading
          label={t("pages.results.loading")}
          layout={listControls.layout}
          hasRows={reports.length > 0}
        />
      ) : null}
      {!loading && !reports.length && !error ? (
        <div className={styles.emptyState}>
          <h2>{t(hasFilters ? "pages.results.noMatches" : "pages.results.emptyTitle")}</h2>
          {hasFilters ? (
            <button className="button" onClick={clearFilters} type="button">
              {t("pages.results.clearFilters")}
            </button>
          ) : (
            <>
              <p>{t("pages.results.emptyDescription")}</p>
              <Link className="button" href="/library">
                {t("pages.assignments.chooseRound")}
              </Link>
            </>
          )}
        </div>
      ) : null}
      <section
        className={resultStyles.collection}
        data-view={listControls.layout}
        aria-label={t("pages.common.results")}
        aria-busy={loading || loadingMore}
      >
        {reports.map((report) => (
          <article
            className={`${styles.listCard} ${resultStyles.card} ${signals.surface}`}
            data-kind="round"
            data-state-tone={workspaceStateTone(report.status)}
            key={report.id}
          >
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
              <WorkspaceStatus status={report.status}>
                {t(
                  `pages.common.status.${report.status === "pending" ? "processing" : report.status === "failed" ? "needsAttention" : "ready"}`,
                )}
              </WorkspaceStatus>
            </div>
            <div className={`${styles.metricGrid} ${resultStyles.metrics}`}>
              <EvidenceMeter
                label={t("pages.common.initialAccuracy")}
                value={report.status === "ready" ? report.initialAccuracyPercent : null}
              />
              <EvidenceMeter
                label={t("resultsOverview.recovery")}
                value={
                  report.status === "ready"
                    ? evidencePercent(report.recovery.recovered, report.recovery.eligible)
                    : null
                }
                detail={t("pages.results.recoveryMetric", {
                  recovered: formatNumber(locale, report.recovery.recovered),
                  eligible: formatNumber(locale, report.recovery.eligible),
                })}
                empty={
                  report.status === "ready"
                    ? t("resultsOverview.noRecovery")
                    : t("resultsOverview.noEvidence")
                }
              />
              <div className={styles.metric}>
                <strong>{report.unresolvedConceptCount}</strong>
                <span>{t("resultsOverview.unresolved")}</span>
              </div>
              <div className={styles.metric}>
                <strong>{report.interventionCount}</strong>
                <span>{t("pages.results.interventions")}</span>
              </div>
            </div>
            <div className={`${styles.listCardActions} ${resultStyles.actions}`}>
              <Link
                className={`button small-button ${signals.action}`}
                data-action={report.status === "ready" ? "result" : "view"}
                href={`/report/${report.id}`}
              >
                {report.status === "ready"
                  ? t("pages.results.openRecoveryStory")
                  : t("pages.results.viewStatus")}
              </Link>
              {report.followupId ? (
                <Link
                  className={`button-quiet small-button ${signals.action}`}
                  data-action="view"
                  href="/results?view=practice"
                >
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
    </ResultsPanel>
  );
}

function PracticeList({ rounds, ...listControls }: ListControls & { rounds: RoundFilterOption[] }) {
  const { locale, t } = useLocale();
  const { creator } = useWorkspace();
  const workspaceId = creator?.workspaceId;
  const search = useHistorySearch(listControls.search);
  const panel = useRef<HTMLElement>(null);
  const [grouping, setGrouping] = useState<ResultsActivityGrouping>("month");
  const [status, setStatus] = useState<FollowupStatusFilter>("all");
  const [quizId, setQuizId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filters = {
    status,
    quizId,
    fromDate,
    toDate,
    search,
    expectedWorkspaceId: workspaceId,
  };
  const analyticsQuery = buildHistoryFilterQuery(filters);
  const {
    items: followups,
    loaded,
    nextCursor,
    loading,
    loadingMore,
    error,
    retry,
    more,
  } = useHistoryPage<FollowupSummary>("/v1/followups", filters);
  const hasFilters = Boolean(
    status !== "all" || quizId !== "all" || fromDate || toDate || listControls.search,
  );

  function clearFilters() {
    setStatus("all");
    setQuizId("all");
    setFromDate("");
    setToDate("");
    listControls.onSearchClear();
  }

  return (
    <ResultsPanel view="practice" panelRef={panel}>
      <HistoryFilters
        listControls={listControls}
        count={followups.length}
        countAvailable={loaded}
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
      {workspaceId ? (
        <PracticeResultsOverview
          key={analyticsQuery}
          query={analyticsQuery}
          items={followups}
          hasMore={Boolean(nextCursor)}
          grouping={grouping}
          onGroupingChange={setGrouping}
        />
      ) : null}
      {error && !loading && !loadingMore ? (
        <ResultsLoadError
          error={error}
          onRetry={retry}
          panelRef={panel}
          retained={followups.length > 0}
        />
      ) : null}
      {loading ? (
        <ResultsLoading
          label={t("pages.results.loadingPractice")}
          layout={listControls.layout}
          hasRows={followups.length > 0}
        />
      ) : null}
      {!loading && !followups.length && !error ? (
        <div className={styles.emptyState}>
          <h2>
            {t(hasFilters ? "pages.results.noPracticeMatches" : "pages.results.emptyPracticeTitle")}
          </h2>
          {hasFilters ? (
            <button className="button" onClick={clearFilters} type="button">
              {t("pages.results.clearFilters")}
            </button>
          ) : (
            <p>{t("pages.results.emptyPracticeDescription")}</p>
          )}
        </div>
      ) : null}
      <section
        className={resultStyles.collection}
        data-view={listControls.layout}
        aria-label={t("pages.results.practiceListLabel")}
        aria-busy={loading || loadingMore}
      >
        {followups.map((followup) => (
          <article
            className={`${styles.listCard} ${resultStyles.card} ${signals.surface}`}
            data-kind="practice"
            data-state-tone={workspaceStateTone(followup.status)}
            key={followup.id}
          >
            <div className={`${styles.rowTopline} ${resultStyles.topline}`}>
              <div>
                <h2 lang="">{followup.title}</h2>
                <PackPracticeAttribution source={followup.recoveryPackSource} locale={locale} />
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
                <WorkspaceStatus status={followup.status}>
                  {t(`pages.common.status.${followup.status}`)}
                </WorkspaceStatus>
              </div>
            </div>
            <div className={resultStyles.cardDetails}>
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
              <EvidenceMeter
                label={t("resultsOverview.completion")}
                value={evidencePercent(followup.completedAttemptCount, followup.attemptCount)}
                detail={t("resultsOverview.attemptDetail", {
                  completed: formatNumber(locale, followup.completedAttemptCount),
                  total: formatNumber(locale, followup.attemptCount),
                })}
                empty={t("resultsOverview.noAttempts")}
              />
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
            </div>
            <div className={`${styles.listCardActions} ${resultStyles.actions}`}>
              <Link
                className={`button small-button ${signals.action}`}
                data-action="view"
                href={`/practice/${followup.id}`}
              >
                {t("pages.results.managePractice")}
              </Link>
              {followup.sourceReportId ? (
                <Link
                  className={`button-quiet small-button ${signals.action}`}
                  data-action="result"
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
    </ResultsPanel>
  );
}

function PresentationResultList(listControls: ListControls) {
  const { locale, t } = useLocale();
  const panel = useRef<HTMLElement>(null);
  const collection = useRef<HTMLElement>(null);
  const [grouping, setGrouping] = useState<ResultsActivityGrouping>("month");
  const { creator } = useWorkspace();
  const workspaceId = creator?.workspaceId ?? "";
  const search = useHistorySearch(listControls.search);
  const [status, setStatus] = useState("all");
  const [sourceId, setSourceId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sources, setSources] = useState<RoundFilterOption[]>([]);
  const [sourcesUnavailable, setSourcesUnavailable] = useState(false);
  const [sourcesAttempt, setSourcesAttempt] = useState(0);
  const filters = {
    status,
    presentationId: sourceId,
    fromDate,
    toDate,
    search,
    expectedWorkspaceId: workspaceId,
  };
  const analyticsQuery = buildHistoryFilterQuery(filters);
  const {
    items: sessions,
    loaded,
    nextCursor,
    loading,
    loadingMore,
    error,
    retry,
    more,
  } = useHistoryPage<PresentationResultSummary>("/v1/presentation-sessions/results", filters);

  const rememberLoadMoreFocus = useHistoryMoreFocus(
    analyticsQuery,
    sessions.length,
    loadingMore,
    collection,
    panel,
  );

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    void apiFetch<{ sources: RoundFilterOption[] }>(
      `/v1/presentation-sessions/results/sources?expectedWorkspaceId=${encodeURIComponent(workspaceId)}`,
      { signal: controller.signal },
    )
      .then(({ sources }) => {
        if (!controller.signal.aborted) setSources(sources);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSourcesUnavailable(true);
      });
    return () => controller.abort();
  }, [workspaceId, sourcesAttempt]);

  const filtered = Boolean(
    listControls.search || status !== "all" || sourceId !== "all" || fromDate || toDate,
  );

  function clearFilters() {
    setStatus("all");
    setSourceId("all");
    setFromDate("");
    setToDate("");
    listControls.onSearchClear();
  }

  return (
    <ResultsPanel view="presentations" panelRef={panel}>
      <HistoryFilters
        listControls={listControls}
        count={sessions.length}
        countAvailable={loaded}
        loading={loading}
        hasMore={Boolean(nextCursor)}
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
      {sourcesUnavailable ? (
        <div className={resultStyles.loadError}>
          <p role="alert">{t("resultsOverview.presentationSourcesUnavailable")}</p>
          <button
            className="button-quiet"
            type="button"
            onClick={() => {
              panel.current?.focus();
              setSourcesUnavailable(false);
              setSourcesAttempt((current) => current + 1);
            }}
          >
            {t("resultsOverview.retryPresentationSources")}
          </button>
        </div>
      ) : null}
      {workspaceId ? (
        <PresentationResultsOverview
          key={analyticsQuery}
          query={analyticsQuery}
          items={sessions}
          hasMore={Boolean(nextCursor)}
          grouping={grouping}
          onGroupingChange={setGrouping}
        />
      ) : null}
      {loading ? (
        <ResultsLoading
          label={t("pages.results.loadingPresentations")}
          layout={listControls.layout}
          hasRows={sessions.length > 0}
        />
      ) : null}
      {error && !loading && !loadingMore ? (
        <ResultsLoadError
          error={error}
          onRetry={retry}
          panelRef={panel}
          retained={sessions.length > 0}
        />
      ) : null}
      {!loading && !error && !sessions.length ? (
        <div className={styles.emptyState}>
          <h2>
            {t(filtered ? "pages.results.noMatches" : "pages.results.emptyPresentationsTitle")}
          </h2>
          {filtered ? (
            <button className="button" onClick={clearFilters} type="button">
              {t("pages.results.clearFilters")}
            </button>
          ) : (
            <>
              <p>{t("pages.results.emptyPresentationsDescription")}</p>
              <Link className="button" href="/library?type=presentations">
                {t("pages.results.choosePresentation")}
              </Link>
            </>
          )}
        </div>
      ) : null}
      <section
        className={resultStyles.collection}
        data-view={listControls.layout}
        aria-label={t("pages.results.presentationResults")}
        aria-busy={loading || loadingMore}
        ref={collection}
      >
        {sessions.map((session) => (
          <article
            className={`${styles.listCard} ${resultStyles.card} ${signals.surface}`}
            aria-label={session.title}
            data-kind="presentation"
            data-state-tone={workspaceStateTone(session.status)}
            key={session.id}
            tabIndex={-1}
          >
            <div className={`${styles.rowTopline} ${resultStyles.topline}`}>
              <div>
                <div className={resultStyles.titleRow}>
                  <ResultKindIcon kind="presentation" />
                  <div>
                    <p className="eyebrow">{t("pages.common.presentation")}</p>
                    <h2 lang="">{session.title}</h2>
                  </div>
                </div>
                <p className={styles.summaryLine}>
                  {t("pages.results.presentationStarted", {
                    date: formatDateTime(locale, session.createdAt),
                    count: session.blockCount,
                  })}
                </p>
              </div>
              <WorkspaceStatus status={session.status}>
                {t(`pages.common.status.${session.status}`)}
              </WorkspaceStatus>
            </div>
            <div className={`${styles.metricGrid} ${resultStyles.metrics}`}>
              <div className={styles.metric}>
                <strong>{session.participantCount}</strong>
                <span>{t("pages.common.participants")}</span>
              </div>
              {session.status === "active" &&
              (session.phase === "question_open" || session.phase === "question_reveal") ? (
                <div className={styles.metric}>
                  <strong>{session.responseCount}</strong>
                  <span>{t("resultsOverview.currentQuestionResponses")}</span>
                </div>
              ) : null}
              <div className={styles.metric}>
                <strong>
                  <SessionPhaseLabel phase={session.phase} />
                </strong>
                <span>{t("pages.results.sessionPhase")}</span>
              </div>
            </div>
            <div className={`${styles.listCardActions} ${resultStyles.actions}`}>
              {session.status === "finished" ? (
                <Link
                  className={`button small-button ${signals.action}`}
                  data-action="result"
                  href={`/presentation-session/${session.id}/report`}
                >
                  {t("pages.results.openReport")}
                </Link>
              ) : null}
              <Link
                className={`button-quiet small-button ${signals.action}`}
                data-action="view"
                href={`/presentation/${session.presentationId}`}
              >
                {t("pages.sessions.viewPresentation")}
              </Link>
            </div>
          </article>
        ))}
      </section>
      {nextCursor ? (
        <div className={styles.loadMore}>
          <button
            className="button-quiet"
            aria-disabled={loadingMore}
            type="button"
            onClick={(event) => {
              if (loadingMore) return;
              rememberLoadMoreFocus(event.currentTarget);
              void more();
            }}
          >
            {loadingMore ? t("pages.common.loading") : t("pages.results.loadMore")}
          </button>
        </div>
      ) : null}
    </ResultsPanel>
  );
}

type TimedSurveyResult = SurveyResultSummary & { clientExpiresAt: number };

async function readSurveyHistoryPage(path: string, signal?: AbortSignal) {
  const requestedAt = Date.now();
  const { sampledAt, items, nextCursor } = await apiFetch<SurveyResultsPage>(path, { signal });
  const offset = requestedAt - Date.parse(sampledAt);
  return {
    items: items.map((room) => ({ ...room, clientExpiresAt: offset + Date.parse(room.expiresAt) })),
    nextCursor,
  };
}

function SurveyResultList(listControls: ListControls) {
  const { locale, t } = useLocale();
  const panel = useRef<HTMLElement>(null);
  const collection = useRef<HTMLElement>(null);
  const { creator } = useWorkspace();
  const workspaceId = creator?.workspaceId ?? "";
  const search = useHistorySearch(listControls.search);
  const [grouping, setGrouping] = useState<ResultsActivityGrouping>("month");
  const [sourceId, setSourceId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [revision, setRevision] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [sourceAttempt, setSourceAttempt] = useState(0);
  const [sourceSnapshot, setSourceSnapshot] = useState<{
    revision: number;
    sources: RoundFilterOption[];
    refreshAt: number | null;
    unavailable: boolean;
  } | null>(null);
  const filters = {
    status: "all",
    surveyId: sourceId,
    fromDate,
    toDate,
    search,
    expectedWorkspaceId: workspaceId,
  };
  const analyticsQuery = buildHistoryFilterQuery(filters);
  const { items, loaded, nextCursor, loading, loadingMore, refreshing, error, retry, more } =
    useHistoryPage<TimedSurveyResult>("/v1/survey-rooms/results", filters, {
      revision,
      readPage: readSurveyHistoryPage,
    });
  const rooms = items.filter((room) => room.clientExpiresAt > clock);
  const {
    analytics,
    refreshAt: analyticsRefreshAt,
    onAnalyticsRetry,
  } = useSurveyResultsAnalytics(workspaceId ? analyticsQuery : null, revision, clock);
  const rememberLoadMoreFocus = useHistoryMoreFocus(
    analyticsQuery,
    rooms.length,
    loadingMore,
    collection,
    panel,
  );

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    const requestedAt = Date.now();
    void apiFetch<SurveyResultsSources>(
      `/v1/survey-rooms/results/sources?expectedWorkspaceId=${encodeURIComponent(workspaceId)}`,
      { signal: controller.signal },
    )
      .then(({ sources, refreshAfterMs }) => {
        if (controller.signal.aborted) return;
        setSourceSnapshot({
          revision,
          sources: [...sources].sort((left, right) =>
            left.title.localeCompare(right.title, locale),
          ),
          refreshAt: refreshAfterMs == null ? null : requestedAt + refreshAfterMs,
          unavailable: false,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSourceSnapshot({ revision, sources: [], refreshAt: null, unavailable: true });
      });
    return () => controller.abort();
  }, [workspaceId, revision, sourceAttempt, locale]);

  const currentSources = sourceSnapshot?.revision === revision ? sourceSnapshot : null;
  const sources = currentSources?.sources ?? [];
  const sourceOptions =
    sourceId === "all" || sources.some(({ id }) => id === sourceId)
      ? sources
      : [...sources, { id: sourceId, title: t("resultsOverview.selectedSurveySource") }];
  const loadedExpiry = rooms.reduce(
    (expiry, room) => Math.min(expiry, room.clientExpiresAt),
    Infinity,
  );
  const nextChange = Math.min(
    currentSources?.refreshAt ?? Infinity,
    analyticsRefreshAt,
    loadedExpiry,
  );

  useEffect(() => {
    if (!Number.isFinite(nextChange)) return;
    // Each endpoint uses its own clock sample. A later read may have already
    // crossed a lifecycle boundary that still matters for another snapshot.
    const delay = Math.min(Math.max(1_000, nextChange - Date.now()), 2_147_483_647);
    const timer = window.setTimeout(() => {
      setClock(Date.now());
      setRevision((current) => current + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [nextChange, revision]);

  const hasFilters = Boolean(
    listControls.search.trim() || sourceId !== "all" || fromDate || toDate,
  );

  function clearFilters() {
    setSourceId("all");
    setFromDate("");
    setToDate("");
    listControls.onSearchClear();
  }

  return (
    <ResultsPanel view="surveys" panelRef={panel}>
      <HistoryFilters
        listControls={listControls}
        count={rooms.length}
        countAvailable={loaded}
        loading={loading}
        hasMore={Boolean(nextCursor)}
        hideStatus
        status="all"
        statusLabel=""
        statusOptions={[]}
        onStatusChange={() => undefined}
        quizId={sourceId}
        rounds={sourceOptions}
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
      {currentSources?.unavailable ? (
        <div className={resultStyles.loadError}>
          <p role="alert">{t("resultsOverview.surveySourcesUnavailable")}</p>
          <button
            className="button-quiet"
            type="button"
            onClick={() => {
              panel.current?.focus();
              setSourceSnapshot(null);
              setSourceAttempt((current) => current + 1);
            }}
          >
            {t("resultsOverview.retrySurveySources")}
          </button>
        </div>
      ) : null}
      {workspaceId ? (
        <ResultsOverview
          kind="surveys"
          items={rooms}
          analytics={analytics}
          onAnalyticsRetry={onAnalyticsRetry}
          hasMore={Boolean(nextCursor)}
          grouping={grouping}
          onGroupingChange={setGrouping}
        />
      ) : null}
      {loading ? (
        <ResultsLoading
          label={t("pages.results.loadingSurveys")}
          layout={listControls.layout}
          hasRows={rooms.length > 0}
        />
      ) : null}
      {error && !loading && !loadingMore ? (
        <ResultsLoadError
          error={error}
          onRetry={retry}
          panelRef={panel}
          retained={rooms.length > 0}
        />
      ) : null}
      {!loading && !error && !rooms.length ? (
        <div className={styles.emptyState}>
          <h2>{t(hasFilters ? "pages.results.noMatches" : "pages.results.emptySurveysTitle")}</h2>
          {hasFilters ? (
            <button className="button" onClick={clearFilters} type="button">
              {t("pages.results.clearFilters")}
            </button>
          ) : (
            <>
              <p>{t("pages.results.emptySurveysDescription")}</p>
              <Link className="button" href="/sessions?type=surveys">
                {t("pages.results.manageSurveyRuns")}
              </Link>
            </>
          )}
        </div>
      ) : null}
      <section
        className={resultStyles.collection}
        data-view={listControls.layout}
        aria-label={t("pages.results.surveyResults")}
        aria-busy={loading || loadingMore}
        ref={collection}
      >
        {rooms.map((room) => (
          <article
            className={`${styles.listCard} ${resultStyles.card} ${resultStyles.surveyCard} ${signals.surface}`}
            aria-label={room.title}
            data-kind="survey"
            data-state-tone={workspaceStateTone("closed")}
            key={room.id}
            tabIndex={-1}
          >
            <div className={`${styles.rowTopline} ${resultStyles.topline}`}>
              <div>
                <div className={resultStyles.titleRow}>
                  <ResultKindIcon kind="survey" />
                  <h2 lang="">{room.title}</h2>
                </div>
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
              <WorkspaceStatus status="closed">{t("pages.common.status.closed")}</WorkspaceStatus>
            </div>
            <div className={`${styles.listCardActions} ${resultStyles.actions}`}>
              <Link
                className={`button small-button ${signals.action}`}
                data-action="result"
                href={`/results/surveys/${room.id}`}
              >
                {t("pages.common.viewResults")}
              </Link>
            </div>
          </article>
        ))}
      </section>
      {nextCursor ? (
        <div className={styles.loadMore}>
          <button
            className="button-quiet"
            aria-disabled={loadingMore || refreshing}
            onClick={(event) => {
              if (loadingMore || refreshing) return;
              rememberLoadMoreFocus(event.currentTarget);
              void more();
            }}
            type="button"
          >
            {loadingMore ? t("pages.common.loading") : t("pages.results.loadMore")}
          </button>
        </div>
      ) : null}
    </ResultsPanel>
  );
}

function ResultsContent() {
  const { t } = useLocale();
  const searchInput = useRef<HTMLInputElement>(null);
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
    onSearchClear: () => {
      updateSearch("");
      searchInput.current?.focus();
    },
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
            className={`${view === "results" ? controls.tabActive : controls.tab} ${signals.kindTab}`}
            data-kind="round"
            href="/results"
            id="results-results-link"
          >
            <WorkspaceKindIcon kind="round" />
            {t("pages.common.rounds")}
          </Link>
          {presentationsEnabled ? (
            <Link
              aria-current={view === "presentations" ? "page" : undefined}
              className={`${view === "presentations" ? controls.tabActive : controls.tab} ${signals.kindTab}`}
              data-kind="presentation"
              href="/results?view=presentations"
              id="results-presentations-link"
            >
              <WorkspaceKindIcon kind="presentation" />
              {t("pages.common.presentations")}
            </Link>
          ) : null}
          <Link
            aria-current={view === "surveys" ? "page" : undefined}
            className={`${view === "surveys" ? controls.tabActive : controls.tab} ${signals.kindTab}`}
            data-kind="survey"
            href="/results?view=surveys"
            id="results-surveys-link"
          >
            <WorkspaceKindIcon kind="survey" />
            {t("pages.common.surveys")}
          </Link>
          <Link
            aria-current={view === "practice" ? "page" : undefined}
            className={`${view === "practice" ? controls.tabActive : controls.tab} ${signals.kindTab}`}
            data-kind="practice"
            href="/results?view=practice"
            id="results-practice-link"
          >
            <WorkspaceKindIcon kind="practice" />
            {t("pages.results.practice")}
          </Link>
        </nav>
        <label className={controls.searchField}>
          <span className="sr-only">{searchLabel}</span>
          <input
            maxLength={160}
            onChange={(event) => updateSearch(event.target.value)}
            placeholder={searchLabel}
            ref={searchInput}
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
