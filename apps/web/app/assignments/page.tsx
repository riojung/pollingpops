"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../components/locale-provider";
import { apiFetch, humanError } from "../../lib/api";
import { formatDateTime, pluralCategory } from "../../lib/i18n/format";
import { assignmentsDirectoryCopy } from "../../lib/i18n/assignments-directory-copy";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import type { CursorPage, FollowupSummary } from "../../components/workspace/workspace-types";
import { WorkspaceStatus, workspaceStateTone } from "../../components/workspace/workspace-signals";
import signals from "../../components/workspace/workspace-signals.module.css";
import { PackPracticeAttribution } from "../../components/practice/pack-practice-attribution";
import compact from "./assignments.module.css";

const statuses = ["all", "open", "scheduled", "closed", "expired"] as const;
type Status = (typeof statuses)[number];
type PublishedRound = {
  id: string;
  title: string;
  status: string;
  currentVersionId: string | null;
};
type Directory = CursorPage<FollowupSummary> & { key: string };

function RoundChooser({
  onClose,
  returnFocusTo,
}: {
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const { locale, t } = useLocale();
  const copy = assignmentsDirectoryCopy(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const [rounds, setRounds] = useState<PublishedRound[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    const previous = returnFocusTo ?? document.activeElement;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [returnFocusTo]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    // The summary endpoint contains only id/title, without publication metadata.
    void apiFetch<{ quizzes: PublishedRound[] }>("/v1/quizzes", {
      signal: controller.signal,
    })
      .then(({ quizzes }) => {
        if (!controller.signal.aborted)
          setRounds(
            quizzes.filter((round) => round.status === "published" && round.currentVersionId),
          );
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  const matching = rounds.filter((round) =>
    round.title.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale)),
  );
  return (
    <dialog
      className={compact.chooser}
      ref={dialog}
      aria-label={copy("Choose a published Round")}
      aria-modal="true"
      onCancel={onClose}
    >
      <div className={compact.chooserHeader}>
        <div>
          <p className={compact.eyebrow}>{copy("Create assignment")}</p>
          <h2>{copy("Choose a published Round")}</h2>
        </div>
        <button className="button-quiet small-button" onClick={onClose} type="button">
          {copy("Close")}
        </button>
      </div>
      <p className={compact.muted}>
        {copy(
          "Set up private, self-paced practice. You’ll choose availability and sharing options next.",
        )}
      </p>
      <label className={compact.searchLabel}>
        {copy("Search published Rounds")}
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {loading ? (
        <p role="status">{t("pages.assignments.loading")}</p>
      ) : error ? (
        <div role="alert">
          <p className="error" lang="en-CA">
            {error}
          </p>
          <button
            className="button-quiet"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            {copy("Retry")}
          </button>
        </div>
      ) : matching.length ? (
        <ul className={compact.roundList}>
          {matching.map((round) => (
            <li key={round.id}>
              <Link href={`/quiz/${round.id}/assign`}>
                <span>
                  <small>{copy("Published Round")}</small>
                  <strong lang="">{round.title}</strong>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={compact.chooserEmpty}>
          <h3>
            {search.trim() ? copy("No matching Rounds") : copy("No published Rounds available")}
          </h3>
          <p>
            {search.trim()
              ? copy("Try a different search or clear the filters.")
              : copy("Publish a Round from your Library to create an assignment.")}
          </p>
          <Link className="button-quiet" href="/library">
            {t("pages.assignments.browseLibrary")}
          </Link>
        </div>
      )}
    </dialog>
  );
}

function AssignmentsWorkspace() {
  const { locale, t } = useLocale();
  const copy = assignmentsDirectoryCopy(locale);
  const { creator, loading: accountLoading, canEdit, productFeatures } = useWorkspace();
  const authority =
    !accountLoading && creator ? `${creator.userId}:${creator.workspaceId}:${creator.role}` : "";
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [data, setData] = useState<Directory | null>(null);
  const [pendingKey, setPendingKey] = useState("");
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const chooserOpener = useRef<HTMLButtonElement | null>(null);
  const pagination = useRef<AbortController | null>(null);
  const queryKey = JSON.stringify([authority, debouncedSearch, status, revision]);
  const currentKey = useRef(queryKey);
  currentKey.current = queryKey;
  const canCreate = Boolean(authority && canEdit && productFeatures?.practiceAssignments);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    pagination.current?.abort();
    pagination.current = null;
    setLoadingMore(false);
    if (!authority) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ purpose: "assignment", limit: "25" });
    if (debouncedSearch) query.set("search", debouncedSearch);
    if (status !== "all") query.set("status", status);
    setPendingKey(queryKey);
    setError(null);
    void apiFetch<CursorPage<FollowupSummary>>(`/v1/followups?${query}`, {
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted && currentKey.current === queryKey)
          setData({ ...page, key: queryKey });
      })
      .catch((caught) => {
        if (!controller.signal.aborted && currentKey.current === queryKey)
          setError({ key: queryKey, message: humanError(caught) });
      })
      .finally(() => {
        if (!controller.signal.aborted && currentKey.current === queryKey) setPendingKey("");
      });
    return () => {
      controller.abort();
      pagination.current?.abort();
    };
  }, [authority, debouncedSearch, status, revision, queryKey]);

  async function loadMore() {
    if (!data?.nextCursor || data.key !== queryKey || pagination.current) return;
    const controller = new AbortController();
    pagination.current = controller;
    setLoadingMore(true);
    setError(null);
    const query = new URLSearchParams({
      purpose: "assignment",
      limit: "25",
      cursor: data.nextCursor,
    });
    if (debouncedSearch) query.set("search", debouncedSearch);
    if (status !== "all") query.set("status", status);
    try {
      const page = await apiFetch<CursorPage<FollowupSummary>>(`/v1/followups?${query}`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted && currentKey.current === queryKey)
        setData((previous) =>
          previous?.key === queryKey
            ? {
                key: queryKey,
                nextCursor: page.nextCursor,
                items: [
                  ...previous.items,
                  ...page.items.filter(
                    (item) => !previous.items.some((existing) => existing.id === item.id),
                  ),
                ],
              }
            : previous,
        );
    } catch (caught) {
      if (!controller.signal.aborted && currentKey.current === queryKey)
        setError({ key: queryKey, message: humanError(caught) });
    } finally {
      if (pagination.current === controller) {
        pagination.current = null;
        setLoadingMore(false);
      }
    }
  }

  const assignments = data?.key === queryKey && authority ? data.items : [];
  const loading =
    accountLoading ||
    Boolean(authority && (!data || data.key !== queryKey) && error?.key !== queryKey) ||
    pendingKey === queryKey;
  const filtered = Boolean(search.trim() || status !== "all");
  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatus("all");
  };
  return (
    <WorkspaceShell
      actions={
        <>
          <Link className="button-quiet" href="/results?view=practice">
            {t("pages.assignments.viewAllPractice")}
          </Link>
          {canCreate ? (
            <button
              className="button"
              type="button"
              onClick={(event) => {
                chooserOpener.current = event.currentTarget;
                setChoosing(true);
              }}
            >
              <span aria-hidden="true">＋ </span>
              {copy("Create assignment")}
            </button>
          ) : null}
        </>
      }
      description={copy(
        "Configure, share, then monitor private practice from published Rounds and Recovery Packs.",
      )}
      eyebrow={t("page.assignments.eyebrow")}
      title={t("page.assignments.title")}
      translationLevel="full"
    >
      {!accountLoading && productFeatures?.practiceAssignments === false ? (
        <p className={compact.notice}>
          {copy(
            "Creation is paused for this workspace. Existing assignments can still be managed.",
          )}
        </p>
      ) : null}
      <div className={compact.toolbar}>
        <label className={compact.searchLabel}>
          {copy("Search assignments")}
          <input
            type="search"
            maxLength={160}
            placeholder={copy("Search assignments")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className="button-quiet"
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          disabled={loading || loadingMore}
        >
          {copy("Refresh")}
        </button>
      </div>
      <div className={compact.filterbar}>
        <div className={compact.filters} role="group" aria-label={copy("Assignment status")}>
          {statuses.map((value) => (
            <button
              className={compact.filter}
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {value === "all" ? copy("All") : t(`pages.common.status.${value}`)}
            </button>
          ))}
        </div>
        <span className={compact.muted}>{copy("Newest first")}</span>
      </div>
      {error?.key === queryKey ? (
        <div className={compact.notice} role="alert">
          <span lang="en-CA">{error.message}</span>
          <button
            className="button-quiet small-button"
            type="button"
            onClick={() =>
              data?.key === queryKey && data.nextCursor
                ? void loadMore()
                : setRevision((value) => value + 1)
            }
          >
            {copy("Retry")}
          </button>
        </div>
      ) : null}
      {loading ? (
        <p className={compact.muted} role="status">
          {t("pages.assignments.loading")}
        </p>
      ) : (
        <p className={compact.resultCount} role="status">
          {copy("Showing {count}", { count: assignments.length })}
        </p>
      )}
      {!loading && error?.key !== queryKey && !assignments.length ? (
        <div className={compact.empty}>
          <span className={compact.emptyIcon} aria-hidden="true">
            ▤
          </span>
          <h2>{filtered ? copy("No matching assignments") : t("pages.assignments.emptyTitle")}</h2>
          <p>
            {filtered
              ? copy("Try a different search or clear the filters.")
              : copy(
                  "Set up private, self-paced practice. You’ll choose availability and sharing options next.",
                )}
          </p>
          {filtered ? (
            <button className="button-quiet" type="button" onClick={clearFilters}>
              {copy("Clear filters")}
            </button>
          ) : canCreate ? (
            <button
              className="button"
              type="button"
              onClick={(event) => {
                chooserOpener.current = event.currentTarget;
                setChoosing(true);
              }}
            >
              {t("pages.assignments.chooseRound")}
            </button>
          ) : (
            <Link className="button-quiet" href="/library">
              {t("pages.assignments.browseLibrary")}
            </Link>
          )}
        </div>
      ) : null}
      <section
        className={compact.list}
        aria-label={t("pages.assignments.listLabel")}
        aria-busy={loading || loadingMore}
      >
        {assignments.map((assignment) => (
          <article
            className={`${compact.card} ${signals.surface}`}
            data-kind="practice"
            data-state-tone={workspaceStateTone(assignment.status)}
            key={assignment.id}
          >
            <div className={compact.cardIdentity}>
              <div className={compact.cardTop}>
                <span className={compact.source}>
                  {assignment.recoveryPackSource ? "Recovery Pack" : copy("Published Round")}
                </span>
                <WorkspaceStatus status={assignment.status}>
                  {t(`pages.common.status.${assignment.status}`)}
                </WorkspaceStatus>
              </div>
              <h2 lang="">{assignment.title}</h2>
              <PackPracticeAttribution source={assignment.recoveryPackSource} locale={locale} />
              <p className={compact.muted}>
                {t(
                  pluralCategory(locale, assignment.checkpointCount) === "one"
                    ? "pages.assignments.questionCount.one"
                    : "pages.assignments.questionCount.other",
                  { count: assignment.checkpointCount },
                )}{" "}
                ·{" "}
                {t("pages.assignments.created", {
                  date: formatDateTime(locale, assignment.createdAt),
                })}
              </p>
            </div>
            <div className={compact.delivery}>
              <p>
                {t("pages.assignments.openRange", {
                  from: formatDateTime(locale, assignment.opensAt),
                  to: formatDateTime(locale, assignment.closesAt),
                })}
              </p>
              <p className={compact.muted}>
                {t("pages.assignments.retainedUntil")}{" "}
                {formatDateTime(locale, assignment.expiresAt)}
              </p>
            </div>
            <div className={compact.progress}>
              <strong>
                {assignment.completedAttemptCount}
                <span> / {assignment.attemptCount}</span>
              </strong>
              <span>
                {t("pages.common.completed")} / {t("pages.common.attempts")}
              </span>
              <progress
                max={Math.max(assignment.attemptCount, 1)}
                value={assignment.completedAttemptCount}
                aria-label={copy("{completed} of {attempts} attempts completed", {
                  completed: assignment.completedAttemptCount,
                  attempts: assignment.attemptCount,
                })}
              />
            </div>
            <Link
              className={`button-quiet small-button ${compact.manage}`}
              href={`/practice/${assignment.id}`}
            >
              {t("pages.assignments.manage")} <span aria-hidden="true">→</span>
            </Link>
          </article>
        ))}
      </section>
      {data?.key === queryKey && data.nextCursor ? (
        <div className={compact.loadMore}>
          <button
            className="button-quiet"
            disabled={loadingMore}
            type="button"
            onClick={() => void loadMore()}
          >
            {loadingMore ? t("pages.assignments.loading") : copy("Load more assignments")}
          </button>
        </div>
      ) : null}
      {assignments.length ? (
        <p className={compact.footerNote}>
          {copy("Attempts include anonymous participation and may not represent unique people.")}
        </p>
      ) : null}
      {choosing && canCreate ? (
        <RoundChooser
          key={authority}
          onClose={() => setChoosing(false)}
          returnFocusTo={chooserOpener.current}
        />
      ) : null}
    </WorkspaceShell>
  );
}

export default function AssignmentsPage() {
  return (
    <WorkspaceProvider>
      <AssignmentsWorkspace />
    </WorkspaceProvider>
  );
}
