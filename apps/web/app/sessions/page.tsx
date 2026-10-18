"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "../../components/locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import { formatDateTime } from "../../lib/i18n/format";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { SessionPhaseLabel } from "../../components/workspace/session-phase-label";
import type { CursorPage, SessionSummary } from "../../components/workspace/workspace-types";
import {
  filterSessionRows,
  presentationSessionStatus,
  readSessionsView,
  roundSessionsPath,
  sessionActions,
  sessionFiltersForType,
  sessionFiltersFromQuery,
  sessionsHref,
  surveySessionStatus,
  writeSessionsView,
  type PresentationSessionSummary,
  type SessionFilters,
  type SessionStatus,
  type SessionType,
  type SessionView,
  type SurveySessionSummary,
} from "../../lib/session-controls";
import contentStyles from "../../components/workspace/workspace-content.module.css";
import styles from "./sessions.module.css";
import controls from "../../components/workspace/workspace-history-controls.module.css";

type SessionCounts = Record<SessionType, number>;
type SourceOption = { id: string; title: string };
interface SessionData {
  key: string;
  rounds: SessionSummary[];
  presentations: PresentationSessionSummary[];
  surveys: SurveySessionSummary[];
  nextCursor: string | null;
}
const EMPTY_DATA: SessionData = {
  key: "",
  rounds: [],
  presentations: [],
  surveys: [],
  nextCursor: null,
};

function SessionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, t } = useLocale();
  const { creator, productFeatures } = useWorkspace();
  const workspaceId = creator?.workspaceId ?? "";
  const role = creator?.role ?? "viewer";
  const presentationsEnabled = productFeatures?.presentations === true;
  const featuresLoaded = productFeatures !== null;
  const filters = useMemo(
    () => sessionFiltersFromQuery(searchParams, presentationsEnabled),
    [searchParams, presentationsEnabled],
  );
  const { type, query, status, sourceId, from, to } = filters;
  const queryKey = `${workspaceId}\u0000${sessionsHref(filters)}`;
  const dataRequestKey =
    type === "rounds" ? queryKey : `${workspaceId}\u0000/sessions?type=${type}`;
  const roundRequestPath = type === "rounds" ? roundSessionsPath(filters) : "/v1/sessions?limit=25";
  const sourceKey = `${workspaceId}\u0000${type}`;
  const [data, setData] = useState<SessionData>(EMPTY_DATA);
  const [sources, setSources] = useState<{ key: string; items: SourceOption[] }>({
    key: "",
    items: [],
  });
  const [counts, setCounts] = useState<{
    workspaceId: string;
    values: SessionCounts | null;
    loading: boolean;
  }>({ workspaceId: "", values: null, loading: true });
  const [countsRevision, setCountsRevision] = useState(0);
  const [fetching, setFetching] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [displayPage, setDisplayPage] = useState({ key: "", limit: 25 });
  const [busyId, setBusyId] = useState("");
  const [pendingDeletions, setPendingDeletions] = useState<
    Array<{ workspaceId: string; type: SessionType; id: string }>
  >([]);
  const [error, setError] = useState<{ key: string; message: string }>({ key: "", message: "" });
  const [loadError, setLoadError] = useState<{ key: string; message: string }>({
    key: "",
    message: "",
  });
  const [viewPreference, setViewPreference] = useState<{ workspaceId: string; view: SessionView }>({
    workspaceId: "",
    view: "grid",
  });
  const [now, setNow] = useState(() => Date.now());
  const activeQueryKey = useRef(queryKey);
  const activeDataRequestKey = useRef(dataRequestKey);
  const activeWorkspace = useRef(workspaceId);
  const mounted = useRef(false);
  const loadMoreController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const deletionControllers = useRef(new Map<string, AbortController>());
  const deletedIds = useRef(new Set<string>());
  activeQueryKey.current = queryKey;
  activeDataRequestKey.current = dataRequestKey;
  activeWorkspace.current = workspaceId;
  const loading = fetching || data.key !== dataRequestKey;
  const current = data.key === dataRequestKey ? data : EMPTY_DATA;
  const view = viewPreference.workspaceId === workspaceId ? viewPreference.view : "grid";
  const displayLimit = displayPage.key === queryKey ? displayPage.limit : 25;
  const loadingErrorMessage = t("pages.sessions.loadingError");
  const pendingDeletion = pendingDeletions.find((item) => item.workspaceId === workspaceId);
  const mutationBusy = Boolean(busyId || pendingDeletion);
  const deletingId = pendingDeletion?.type === type ? pendingDeletion.id : "";

  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      actionController.current?.abort();
      for (const controller of deletionControllers.current.values()) controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    setViewPreference({ workspaceId, view: readSessionsView(window.localStorage, workspaceId) });
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !productFeatures) return;
    if (searchParams.get("type") === "presentations" && !presentationsEnabled) {
      router.replace(sessionsHref(filters), { scroll: false });
    }
  }, [filters, presentationsEnabled, productFeatures, router, searchParams, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    setCounts({ workspaceId, values: null, loading: true });
    void apiFetch<{ counts: SessionCounts }>("/v1/sessions/counts", { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted && activeWorkspace.current === workspaceId) {
          setCounts({ workspaceId, values: response.counts, loading: false });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && activeWorkspace.current === workspaceId) {
          setCounts({ workspaceId, values: null, loading: false });
        }
      });
    return () => controller.abort();
  }, [countsRevision, workspaceId]);

  useEffect(() => {
    if (!workspaceId || type !== "rounds") return;
    const controller = new AbortController();
    void apiFetch<{ quizzes: SourceOption[] }>("/v1/quizzes?archived=true&summary=true", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted && activeWorkspace.current === workspaceId) {
          setSources({ key: sourceKey, items: response.quizzes });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [sourceKey, type, workspaceId]);

  const fetchRounds = useCallback(
    (cursor?: string, signal?: AbortSignal) =>
      apiFetch<CursorPage<SessionSummary>>(
        `${roundRequestPath}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal },
      ),
    [roundRequestPath],
  );

  useEffect(() => {
    actionController.current?.abort();
    actionController.current = null;
    setBusyId("");
    setDisplayPage({ key: queryKey, limit: 25 });
    setError({ key: queryKey, message: "" });
    return () => actionController.current?.abort();
  }, [queryKey]);

  useEffect(() => {
    const controller = new AbortController();
    const requestedKey = dataRequestKey;
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setLoadingMore(false);
    setFetching(true);
    setLoadError({ key: requestedKey, message: "" });
    if (!workspaceId || !featuresLoaded) return () => controller.abort();
    const deletedKey = (id: string) => `${workspaceId}:${type}:${id}`;
    async function load(): Promise<SessionData> {
      if (type === "rounds") {
        const response = await fetchRounds(undefined, controller.signal);
        return {
          ...EMPTY_DATA,
          key: requestedKey,
          rounds: response.items.filter((row) => !deletedIds.current.has(deletedKey(row.id))),
          nextCursor: response.nextCursor,
        };
      }
      if (type === "presentations") {
        const response = await apiFetch<{ sessions: PresentationSessionSummary[] }>(
          "/v1/presentation-sessions",
          { signal: controller.signal },
        );
        return {
          ...EMPTY_DATA,
          key: requestedKey,
          presentations: response.sessions.filter(
            (row) => !deletedIds.current.has(deletedKey(row.id)),
          ),
        };
      }
      const surveys: SurveySessionSummary[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      do {
        if (cursor) {
          if (seenCursors.has(cursor)) throw new Error(loadingErrorMessage);
          seenCursors.add(cursor);
        }
        const params = new URLSearchParams({ limit: "50" });
        if (cursor) params.set("cursor", cursor);
        const page: { rooms: SurveySessionSummary[]; nextCursor: string | null } = await apiFetch(
          `/v1/survey-rooms?${params}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted || activeDataRequestKey.current !== requestedKey)
          return EMPTY_DATA;
        surveys.push(...page.rooms.filter((row) => !deletedIds.current.has(deletedKey(row.id))));
        cursor = page.nextCursor;
      } while (cursor);
      return { ...EMPTY_DATA, key: requestedKey, surveys };
    }
    void load()
      .then((response) => {
        if (!controller.signal.aborted && activeDataRequestKey.current === requestedKey) {
          setData({
            ...response,
            rounds: response.rounds.filter(
              (row) => !deletedIds.current.has(`${workspaceId}:rounds:${row.id}`),
            ),
            presentations: response.presentations.filter(
              (row) => !deletedIds.current.has(`${workspaceId}:presentations:${row.id}`),
            ),
            surveys: response.surveys.filter(
              (row) => !deletedIds.current.has(`${workspaceId}:surveys:${row.id}`),
            ),
          });
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted && activeDataRequestKey.current === requestedKey) {
          setData({ ...EMPTY_DATA, key: requestedKey });
          setLoadError({ key: requestedKey, message: humanError(caught) });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && activeDataRequestKey.current === requestedKey)
          setFetching(false);
      });
    return () => {
      controller.abort();
      loadMoreController.current?.abort();
    };
  }, [dataRequestKey, fetchRounds, featuresLoaded, loadingErrorMessage, type, workspaceId]);

  const filteredPresentations = filterSessionRows(current.presentations, filters, (row) => ({
    sourceId: row.presentationId,
    status: presentationSessionStatus(row, now),
    date: row.createdAt,
  }));
  const filteredSurveys = filterSessionRows(current.surveys, filters, (row) => ({
    sourceId: row.surveyId,
    status: surveySessionStatus(row, now),
    date: row.closesAt,
  }));
  const presentations = filteredPresentations.slice(0, displayLimit);
  const surveys = filteredSurveys.slice(0, displayLimit);
  const hasMore =
    type === "rounds"
      ? Boolean(current.nextCursor)
      : type === "presentations"
        ? filteredPresentations.length > displayLimit
        : filteredSurveys.length > displayLimit;
  const sourceOptions = useMemo(() => {
    const options = new Map<string, string>();
    if (type === "rounds") {
      if (sources.key === sourceKey)
        for (const row of sources.items) options.set(row.id, row.title);
      for (const row of current.rounds)
        if (!options.has(row.quizId)) options.set(row.quizId, row.title);
    } else if (type === "presentations") {
      for (const row of current.presentations)
        if (!options.has(row.presentationId)) options.set(row.presentationId, row.title);
    } else {
      for (const row of current.surveys)
        if (!options.has(row.surveyId)) options.set(row.surveyId, row.title);
    }
    return [...options]
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [current, sourceKey, sources, type]);

  function updateFilters(next: SessionFilters, push = false) {
    const href = sessionsHref(next);
    if (push) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }

  function chooseView(next: SessionView) {
    setViewPreference({ workspaceId, view: next });
    if (workspaceId) writeSessionsView(window.localStorage, workspaceId, next);
  }

  function statusLabel(value: SessionStatus) {
    if (value === "expired") return t("pages.sessions.accessExpired");
    if (type === "surveys")
      return t(value === "active" ? "pages.common.status.open" : "pages.common.status.closed");
    return t(`pages.common.status.${value}`);
  }

  async function loadMore() {
    if (loading || loadingMore) return;
    if (type !== "rounds") {
      setDisplayPage({ key: queryKey, limit: displayLimit + 25 });
      return;
    }
    if (!current.nextCursor) return;
    const requestedKey = queryKey;
    const requestedCursor = current.nextCursor;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setError({ key: requestedKey, message: "" });
    try {
      const response = await fetchRounds(requestedCursor, controller.signal);
      if (controller.signal.aborted || activeQueryKey.current !== requestedKey || !mounted.current)
        return;
      if (response.nextCursor === requestedCursor) throw new Error(loadingErrorMessage);
      setData((previous) => {
        if (previous.key !== requestedKey) return previous;
        const ids = new Set(previous.rounds.map((row) => row.id));
        return {
          ...previous,
          rounds: [
            ...previous.rounds,
            ...response.items.filter(
              (row) =>
                !ids.has(row.id) && !deletedIds.current.has(`${workspaceId}:rounds:${row.id}`),
            ),
          ],
          nextCursor: response.nextCursor,
        };
      });
    } catch (caught) {
      if (!controller.signal.aborted && activeQueryKey.current === requestedKey && mounted.current)
        setError({ key: requestedKey, message: humanError(caught) });
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        if (activeQueryKey.current === requestedKey && mounted.current) setLoadingMore(false);
      }
    }
  }

  async function resumeSession(session: SessionSummary) {
    if (mutationBusy || !sessionActions("rounds", session.status, role).canResume) return;
    const requestedKey = queryKey;
    const controller = new AbortController();
    actionController.current = controller;
    setBusyId(session.id);
    setError({ key: requestedKey, message: "" });
    try {
      const response = await apiFetch<{ token: string }>(
        `/v1/sessions/${session.id}/control-pass`,
        { method: "POST", body: "{}", signal: controller.signal },
      );
      if (controller.signal.aborted || activeQueryKey.current !== requestedKey || !mounted.current)
        return;
      window.sessionStorage.setItem(`openround:host:${session.id}`, response.token);
      router.push(`/host/${session.id}`);
    } catch (caught) {
      if (!controller.signal.aborted && activeQueryKey.current === requestedKey && mounted.current)
        setError({ key: requestedKey, message: humanError(caught) });
    } finally {
      if (actionController.current === controller) {
        actionController.current = null;
        if (activeQueryKey.current === requestedKey && mounted.current) setBusyId("");
      }
    }
  }

  async function deleteSession(session: { id: string; title: string }, value: SessionStatus) {
    if (
      mutationBusy ||
      [...deletionControllers.current.keys()].some((key) =>
        key.startsWith(`${workspaceId}\u0000`),
      ) ||
      !sessionActions(type, value, role).canDelete ||
      !window.confirm(
        t(
          type === "surveys"
            ? "pages.sessions.deleteSurveyConfirm"
            : "pages.sessions.deleteConfirm",
          { title: session.title },
        ),
      )
    )
      return;
    const requestedKey = queryKey;
    const requestedWorkspace = workspaceId;
    const requestedType = type;
    const controller = new AbortController();
    const deletionKey = `${requestedWorkspace}\u0000${requestedType}\u0000${session.id}`;
    deletionControllers.current.set(deletionKey, controller);
    setPendingDeletions((previous) => [
      ...previous,
      { workspaceId: requestedWorkspace, type: requestedType, id: session.id },
    ]);
    setError({ key: requestedKey, message: "" });
    try {
      const path =
        type === "rounds"
          ? "sessions"
          : type === "presentations"
            ? "presentation-sessions"
            : "survey-rooms";
      await apiFetch(`/v1/${path}/${session.id}`, { method: "DELETE", signal: controller.signal });
      deletedIds.current.add(`${requestedWorkspace}:${requestedType}:${session.id}`);
      if (activeWorkspace.current === requestedWorkspace && mounted.current) {
        setCountsRevision((revision) => revision + 1);
      }
      try {
        const kinds =
          requestedType === "presentations"
            ? ["presentation-host", "presentation-participant", "presentation-companion"]
            : requestedType === "rounds"
              ? [
                  "host",
                  "participant",
                  "presenter",
                  "presenter-policy",
                  "presenter-origins",
                  "code",
                ]
              : [];
        for (const kind of kinds)
          window.sessionStorage.removeItem(`openround:${kind}:${session.id}`);
      } catch {
        // Deletion already revoked durable credentials when browser storage is unavailable.
      }
      if (activeWorkspace.current !== requestedWorkspace || !mounted.current) return;
      setData((previous) =>
        previous.key.startsWith(`${requestedWorkspace}\u0000/sessions?type=${requestedType}`)
          ? {
              ...previous,
              rounds:
                requestedType === "rounds"
                  ? previous.rounds.filter((row) => row.id !== session.id)
                  : previous.rounds,
              presentations:
                requestedType === "presentations"
                  ? previous.presentations.filter((row) => row.id !== session.id)
                  : previous.presentations,
              surveys:
                requestedType === "surveys"
                  ? previous.surveys.filter((row) => row.id !== session.id)
                  : previous.surveys,
            }
          : previous,
      );
    } catch (caught) {
      if (!controller.signal.aborted && activeQueryKey.current === requestedKey && mounted.current)
        setError({ key: requestedKey, message: humanError(caught) });
    } finally {
      deletionControllers.current.delete(deletionKey);
      if (mounted.current) {
        setPendingDeletions((previous) =>
          previous.filter(
            (item) =>
              item.workspaceId !== requestedWorkspace ||
              item.type !== requestedType ||
              item.id !== session.id,
          ),
        );
      }
    }
  }

  const searchLabel = t(
    type === "rounds"
      ? "pages.sessions.searchRounds"
      : type === "presentations"
        ? "pages.sessions.searchPresentations"
        : "pages.sessions.searchSurveys",
  );
  const singularTypeLabel = t(
    type === "rounds"
      ? "pages.common.round"
      : type === "presentations"
        ? "pages.common.presentation"
        : "pages.common.survey",
  );
  const visibleCount =
    type === "rounds"
      ? current.rounds.length
      : type === "presentations"
        ? presentations.length
        : surveys.length;
  const filtered =
    Boolean(query.trim()) || status !== "all" || sourceId !== "all" || Boolean(from || to);
  const errorMessage =
    (error.key === queryKey ? error.message : "") ||
    (loadError.key === dataRequestKey ? loadError.message : "");
  const availableTypes: SessionType[] = presentationsEnabled
    ? ["rounds", "presentations", "surveys"]
    : ["rounds", "surveys"];

  function countBadge(value: SessionType) {
    if (counts.workspaceId === workspaceId && counts.values) return counts.values[value];
    return (
      <span
        aria-label={t(
          counts.workspaceId !== workspaceId || counts.loading
            ? "pages.sessions.countLoading"
            : "pages.sessions.countUnavailable",
        )}
      >
        …
      </span>
    );
  }

  function tabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % availableTypes.length
        : event.key === "ArrowLeft"
          ? (index + availableTypes.length - 1) % availableTypes.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? availableTypes.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    updateFilters(sessionFiltersForType(filters, availableTypes[next]!), true);
    document.getElementById(`${availableTypes[next]}-tab`)?.focus();
  }

  return (
    <WorkspaceShell
      description={t("pages.sessions.description")}
      eyebrow={t("pages.sessions.eyebrow")}
      title={t("page.sessions.title")}
      translationLevel="full"
    >
      <div className={controls.toolbar}>
        <div className={controls.tabs} role="tablist" aria-label={t("pages.sessions.typeLabel")}>
          {availableTypes.map((value, index) => (
            <button
              aria-controls={`${value}-panel`}
              aria-selected={type === value}
              className={type === value ? controls.tabActive : controls.tab}
              id={`${value}-tab`}
              key={value}
              onClick={() => updateFilters(sessionFiltersForType(filters, value), true)}
              onKeyDown={(event) => tabKey(event, index)}
              role="tab"
              tabIndex={type === value ? 0 : -1}
              type="button"
            >
              {t(
                value === "rounds"
                  ? "pages.common.rounds"
                  : value === "presentations"
                    ? "pages.common.presentations"
                    : "pages.common.surveys",
              )}{" "}
              <span>{countBadge(value)}</span>
            </button>
          ))}
        </div>
        <label className={controls.searchField}>
          <span className="sr-only">{searchLabel}</span>
          <input
            maxLength={160}
            onChange={(event) => updateFilters({ ...filters, query: event.target.value })}
            placeholder={searchLabel}
            type="search"
            value={query}
          />
        </label>
        <Link className={controls.libraryLink} href={`/library?type=${type}`}>
          {t("pages.sessions.backToLibrary", { type: singularTypeLabel })}
        </Link>
      </div>
      <section className={controls.filterBar} aria-label={t("pages.sessions.filtersLabel")}>
        <label className={controls.filterField}>
          <span>{t("pages.common.statusLabel")}</span>
          <select
            onChange={(event) =>
              updateFilters({ ...filters, status: event.target.value as SessionFilters["status"] })
            }
            value={status}
          >
            <option value="all">{t("pages.sessions.allSessions")}</option>
            <option value="active">{statusLabel("active")}</option>
            <option value="finished">{statusLabel("finished")}</option>
            <option value="expired">{statusLabel("expired")}</option>
          </select>
        </label>
        <label className={controls.filterField}>
          <span>{singularTypeLabel}</span>
          <select
            onChange={(event) => updateFilters({ ...filters, sourceId: event.target.value })}
            value={sourceId}
          >
            <option value="all">
              {t(
                type === "rounds"
                  ? "pages.sessions.allRounds"
                  : type === "presentations"
                    ? "pages.sessions.allPresentations"
                    : "pages.sessions.allSurveys",
              )}
            </option>
            {sourceId !== "all" && !sourceOptions.some((source) => source.id === sourceId) ? (
              <option value={sourceId} lang="">
                {sourceId}
              </option>
            ) : null}
            {sourceOptions.map((source) => (
              <option key={source.id} lang="" value={source.id}>
                {source.title}
              </option>
            ))}
          </select>
        </label>
        <label className={controls.filterField}>
          <span>
            {t(type === "surveys" ? "pages.sessions.closesFrom" : "pages.sessions.startedFrom")}
          </span>
          <input
            onChange={(event) => updateFilters({ ...filters, from: event.target.value })}
            type="date"
            value={from}
          />
        </label>
        <label className={controls.filterField}>
          <span>
            {t(type === "surveys" ? "pages.sessions.closesTo" : "pages.sessions.startedTo")}
          </span>
          <input
            min={from || undefined}
            onChange={(event) => updateFilters({ ...filters, to: event.target.value })}
            type="date"
            value={to}
          />
        </label>
        <p className={controls.resultSummary} role="status">
          {loading
            ? t("pages.sessions.loading")
            : t("pages.sessions.resultCount", { count: visibleCount })}
        </p>
        <div
          aria-label={t("pages.sessions.layoutLabel")}
          className={controls.viewToggle}
          role="group"
        >
          <button
            aria-label={t("pages.library.gridView")}
            aria-pressed={view === "grid"}
            onClick={() => chooseView("grid")}
            type="button"
          >
            {t("pages.library.grid")}
          </button>
          <button
            aria-label={t("pages.library.listView")}
            aria-pressed={view === "list"}
            onClick={() => chooseView("list")}
            type="button"
          >
            {t("pages.library.list")}
          </button>
        </div>
      </section>
      {errorMessage ? (
        <p className="error" lang="en-CA" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <section aria-labelledby={`${type}-tab`} id={`${type}-panel`} role="tabpanel" tabIndex={0}>
        {type === "surveys" ? (
          <p className={styles.description}>{t("pages.sessions.surveyDescription")}</p>
        ) : null}
        {loading ? <p className={contentStyles.muted}>{t("pages.sessions.loading")}</p> : null}
        {!loading && !errorMessage && visibleCount === 0 ? (
          <div className={styles.empty}>
            <h2>
              {t(
                filtered
                  ? "pages.sessions.noMatches"
                  : type === "rounds"
                    ? "pages.sessions.emptyRounds"
                    : type === "presentations"
                      ? "pages.sessions.emptyPresentations"
                      : "pages.sessions.emptySurveys",
              )}
            </h2>
            {!filtered ? (
              <p>
                {t(
                  type === "rounds"
                    ? "pages.sessions.roundEmptyDescription"
                    : type === "presentations"
                      ? "pages.sessions.presentationEmptyDescription"
                      : "pages.sessions.surveyEmptyDescription",
                )}
              </p>
            ) : null}
            <Link className="button-quiet" href={`/library?type=${type}`}>
              {t("pages.sessions.backToLibrary", { type: singularTypeLabel })}
            </Link>
          </div>
        ) : null}
        {!loading ? (
          <section
            className={styles.collection}
            data-view={view}
            aria-label={t(
              type === "rounds"
                ? "pages.sessions.roundListLabel"
                : type === "presentations"
                  ? "pages.sessions.presentationListLabel"
                  : "pages.sessions.surveyListLabel",
            )}
          >
            {current.rounds.map((session) => (
              <article className={styles.card} key={session.id}>
                <div className={styles.cardTopline}>
                  <div>
                    <h2 lang="">{session.title}</h2>
                    <p>
                      {t("pages.sessions.startedInRoom", {
                        date: formatDateTime(locale, session.createdAt),
                        code: session.code,
                      })}
                    </p>
                    <p>
                      {t(
                        session.status === "expired"
                          ? "pages.sessions.accessExpiredOn"
                          : "pages.sessions.accessExpiresOn",
                        { date: formatDateTime(locale, session.expiresAt) },
                      )}
                    </p>
                  </div>
                  <span className={contentStyles.status} data-tone={session.status}>
                    {statusLabel(session.status)}
                  </span>
                </div>
                <div className={styles.metrics}>
                  <div>
                    <strong>{session.participantCount}</strong>
                    <span>{t("pages.common.participants")}</span>
                  </div>
                  <div>
                    <strong>{session.answerCount}</strong>
                    <span>{t("pages.sessions.answersReceived")}</span>
                  </div>
                  <div>
                    <strong>
                      {session.questionPosition === null
                        ? t("pages.common.notStarted")
                        : `${session.questionPosition}/${session.questionCount}`}
                    </strong>
                    <span>{t("pages.sessions.questionProgress")}</span>
                  </div>
                  <div>
                    <strong>
                      <SessionPhaseLabel phase={session.phase} />
                    </strong>
                    <span>{t("pages.sessions.lastPhase")}</span>
                  </div>
                </div>
                <div className={styles.actions}>
                  {sessionActions("rounds", session.status, role).canResume ? (
                    <button
                      className="button small-button"
                      disabled={mutationBusy}
                      onClick={() => void resumeSession(session)}
                      type="button"
                    >
                      {busyId === session.id
                        ? t("pages.sessions.preparingResume")
                        : t("pages.sessions.resumeSession")}
                    </button>
                  ) : null}
                  {session.reportId ? (
                    <Link
                      className="button-quiet small-button"
                      href={`/report/${session.reportId}`}
                    >
                      {t("pages.sessions.viewResult")}
                    </Link>
                  ) : null}
                  <Link
                    className="button-quiet small-button"
                    href={`/quiz/${session.quizId}/preview`}
                  >
                    {t("pages.sessions.viewRound")}
                  </Link>
                  {sessionActions("rounds", session.status, role).canDelete ? (
                    <button
                      className="button-quiet small-button"
                      disabled={mutationBusy}
                      onClick={() => void deleteSession(session, session.status)}
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
            {presentations.map((session) => {
              const value = presentationSessionStatus(session, now);
              const actions = sessionActions("presentations", value, role);
              return (
                <article className={styles.card} key={session.id}>
                  <div className={styles.cardTopline}>
                    <div>
                      <h2 lang="">{session.title}</h2>
                      <p>
                        {t("pages.sessions.startedInRoom", {
                          date: formatDateTime(locale, session.createdAt),
                          code: session.code,
                        })}
                      </p>
                    </div>
                    <span className={contentStyles.status} data-tone={value}>
                      {statusLabel(value)}
                    </span>
                  </div>
                  <div className={styles.metrics}>
                    <div>
                      <strong>{session.participantCount}</strong>
                      <span>{t("pages.common.participants")}</span>
                    </div>
                    <div>
                      <strong>{session.responseCount}</strong>
                      <span>{t("pages.sessions.currentResponses")}</span>
                    </div>
                    <div>
                      <strong>
                        {session.currentBlockIndex < 0
                          ? t("pages.common.notStarted")
                          : `${session.currentBlockIndex + 1}/${session.blockCount}`}
                      </strong>
                      <span>{t("pages.sessions.blockProgress")}</span>
                    </div>
                    <div>
                      <strong>
                        <SessionPhaseLabel phase={session.phase} />
                      </strong>
                      <span>{t("pages.sessions.lastPhase")}</span>
                    </div>
                  </div>
                  <div className={styles.actions}>
                    {actions.canResume ? (
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
                    {actions.canDelete ? (
                      <button
                        className="button-quiet small-button"
                        disabled={mutationBusy}
                        onClick={() => void deleteSession(session, value)}
                        type="button"
                      >
                        {deletingId === session.id
                          ? t("pages.sessions.deleting")
                          : t("pages.sessions.delete")}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {surveys.map((session) => {
              const value = surveySessionStatus(session, now);
              const actions = sessionActions("surveys", value, role);
              return (
                <article className={styles.card} key={session.id}>
                  <div className={styles.cardTopline}>
                    <div>
                      <h2 lang="">{session.title}</h2>
                      <p>
                        {t("pages.sessions.surveyClosesInRoom", {
                          date: formatDateTime(locale, session.closesAt),
                          code: session.code,
                        })}
                      </p>
                      <p>
                        {t(
                          value === "expired"
                            ? "pages.sessions.accessExpiredOn"
                            : "pages.sessions.accessExpiresOn",
                          { date: formatDateTime(locale, session.expiresAt) },
                        )}
                      </p>
                    </div>
                    <span className={contentStyles.status} data-tone={value}>
                      {statusLabel(value)}
                    </span>
                  </div>
                  <div className={styles.actions}>
                    {actions.canManageSharing ? (
                      <Link className="button small-button" href={`/surveys/rooms/${session.id}`}>
                        {t("pages.sessions.surveySharing")}
                      </Link>
                    ) : null}
                    {actions.canViewSurveyResults ? (
                      <Link
                        className="button-quiet small-button"
                        href={`/results/surveys/${session.id}`}
                      >
                        {t("pages.common.viewResults")}
                      </Link>
                    ) : null}
                    {actions.canDelete ? (
                      <button
                        className="button-quiet small-button"
                        disabled={mutationBusy}
                        onClick={() => void deleteSession(session, value)}
                        type="button"
                      >
                        {deletingId === session.id
                          ? t("pages.sessions.deleting")
                          : t("pages.sessions.deleteSurvey")}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
        {hasMore ? (
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
      </section>
    </WorkspaceShell>
  );
}

export default function SessionsPage() {
  return (
    <Suspense>
      <WorkspaceProvider>
        <SessionsContent />
      </WorkspaceProvider>
    </Suspense>
  );
}
