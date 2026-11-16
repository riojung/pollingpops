"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../locale-provider";
import { useWorkspace } from "../workspace-provider";
import { WorkspaceShell } from "../workspace-shell";
import { WorkspaceKindIcon } from "../workspace-signals";
import { AUTH_CHANGE_EVENT } from "../../../lib/api";
import { librarySharingMessages } from "../../../lib/i18n/library-sharing-messages";
import { LibraryScopeNavigation } from "./scope-navigation";
import { LibraryShareActions } from "./share-actions";
import { LibraryShareDue } from "./share-due";
import {
  libraryScopeHref,
  listLibraryShares,
  type LibraryShareSummary,
  type SharedLibraryScope,
} from "./client";
import libraryStyles from "../../../app/library/library.module.css";
import signals from "../workspace-signals.module.css";
import styles from "./library-sharing.module.css";

type Kind = "rounds" | "presentations" | "surveys";
export function SharedLibrary({
  scope,
  type,
  query: urlQuery = "",
}: {
  scope: SharedLibraryScope;
  type: Kind;
  query?: string;
}) {
  const { locale, t } = useLocale();
  const copy = librarySharingMessages(locale);
  const { creator, workspace, management, canEdit } = useWorkspace();
  const hasOrganizationLibrary = Boolean(
    workspace?.organization ||
    management?.organizations.some((organization) => organization.role !== "billing"),
  );
  const canManageShares = Boolean(
    (workspace?.organization && canEdit) ||
    management?.organizations.some(
      (organization) => organization.role === "owner" || organization.role === "admin",
    ),
  );
  const key = JSON.stringify([creator?.userId, creator?.workspaceId, scope]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    shares: LibraryShareSummary[];
    cursor: string | null;
  }>({ key: "", shares: [], cursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState(urlQuery);
  const controller = useRef<AbortController | null>(null);
  const activeKey = useRef(key);
  activeKey.current = key;
  const inFlight = useRef(false);
  const current = snapshot.key === key;
  const shares = current ? snapshot.shares : [];
  const kinds: Kind[] = ["rounds", "presentations", "surveys"];

  useEffect(() => {
    setSearch(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    setLoading(true);
    setError(false);
    inFlight.current = true;
    setSnapshot({ key, shares: [], cursor: null });
    if (!creator?.userId) return () => active.abort();
    void listLibraryShares(scope, active.signal)
      .then((result) => {
        if (!active.signal.aborted && activeKey.current === key)
          setSnapshot({ key, shares: result.shares, cursor: result.nextCursor });
      })
      .catch(() => {
        if (!active.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!active.signal.aborted) {
          setLoading(false);
          inFlight.current = false;
        }
      });
    return () => active.abort();
  }, [creator?.userId, key, refresh, scope]);

  useEffect(() => {
    const invalidate = () => {
      controller.current?.abort();
      setSnapshot({ key: "", shares: [], cursor: null });
      setRefresh((value) => value + 1);
    };
    const focus = () => setRefresh((value) => value + 1);
    window.addEventListener(AUTH_CHANGE_EVENT, invalidate);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, invalidate);
      window.removeEventListener("focus", focus);
    };
  }, []);

  async function more() {
    const active = controller.current;
    if (!current || !snapshot.cursor || inFlight.current || !active || active.signal.aborted)
      return;
    inFlight.current = true;
    setLoading(true);
    setError(false);
    try {
      const result = await listLibraryShares(scope, active.signal, snapshot.cursor);
      if (!active.signal.aborted && activeKey.current === key)
        setSnapshot((previous) => ({
          key,
          shares: [
            ...new Map(
              [...previous.shares, ...result.shares].map((share) => [share.id, share]),
            ).values(),
          ],
          cursor: result.nextCursor,
        }));
    } catch {
      if (!active.signal.aborted) setError(true);
    } finally {
      if (!active.signal.aborted) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }

  const artifactType =
    type === "rounds" ? "round" : type === "presentations" ? "presentation" : "survey";
  const query = search.trim().toLocaleLowerCase(locale);
  const visible = shares.filter(
    (share) =>
      share.artifactType === artifactType &&
      (!query ||
        [
          share.title,
          share.description,
          share.organizationName,
          share.sourceWorkspaceName,
          share.message,
        ].some((value) => value.toLocaleLowerCase(locale).includes(query))),
  );
  return (
    <WorkspaceShell title={copy[scope]} eyebrow={t("page.library.eyebrow")} translationLevel="full">
      <LibraryScopeNavigation
        scope={scope}
        type={type}
        organization={hasOrganizationLibrary}
        canManage={canManageShares}
      />
      <p className={styles.intro}>
        {scope === "organization"
          ? copy.organizationIntro
          : scope === "managed"
            ? copy.managedIntro
            : copy.sharedIntro}
      </p>
      <div className={libraryStyles.toolbar}>
        <nav className={libraryStyles.tabs} aria-label={t("pages.library.typeLabel")}>
          {kinds.map((kind) => (
            <Link
              key={kind}
              className={`${signals.kindTab} ${kind === type ? libraryStyles.tabActive : libraryStyles.tab}`}
              data-kind={
                kind === "rounds" ? "round" : kind === "presentations" ? "presentation" : "survey"
              }
              href={libraryScopeHref(scope, kind)}
              aria-current={kind === type ? "page" : undefined}
            >
              <WorkspaceKindIcon
                kind={
                  kind === "rounds" ? "round" : kind === "presentations" ? "presentation" : "survey"
                }
              />
              {t(
                kind === "rounds"
                  ? "pages.common.rounds"
                  : kind === "presentations"
                    ? "pages.common.presentations"
                    : "pages.common.surveys",
              )}
              <span>
                {
                  shares.filter(
                    (share) =>
                      share.artifactType ===
                      (kind === "rounds"
                        ? "round"
                        : kind === "presentations"
                          ? "presentation"
                          : "survey"),
                  ).length
                }
              </span>
            </Link>
          ))}
        </nav>
        <label className={libraryStyles.searchField}>
          <span className="sr-only">{copy.search}</span>
          <input
            type="search"
            aria-describedby="shared-library-search-help"
            value={search}
            placeholder={copy.search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <p id="shared-library-search-help" className={`${styles.help} ${styles.searchHelp}`}>
        {copy.searchHelp}
      </p>
      {error ? (
        <div role="alert">
          <p className="error">{copy.unavailable}</p>
          <button
            type="button"
            className="button-quiet"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {copy.retry}
          </button>
        </div>
      ) : null}
      {loading && !shares.length ? <p role="status">{copy.loading}</p> : null}
      {!loading && !error && !visible.length ? (
        <section className={styles.empty}>
          <h2>{copy.emptyTitle}</h2>
          <p>{copy.emptyHelp}</p>
        </section>
      ) : null}
      <section className={styles.grid} aria-label={copy[scope]}>
        {visible.map((share) => (
          <article className={styles.card} key={share.id}>
            <div className={styles.meta}>
              <span className={`${styles.badge} ${styles.permission}`}>
                {share.permission === "use" ? copy.canUse : copy.canView}
              </span>
              <span className={styles.badge}>{copy[share.progress]}</span>
            </div>
            <h2 lang="" dir="auto">
              {share.title}
            </h2>
            {share.description ? (
              <p lang="" dir="auto">
                {share.description}
              </p>
            ) : null}
            <p className={styles.provenance} lang="" dir="auto">
              {share.organizationName}
            </p>
            <p className={styles.provenance}>
              {copy.from}:{" "}
              <span lang="" dir="auto">
                {share.sourceWorkspaceName}
              </span>
            </p>
            {share.message ? (
              <p className={styles.message} lang="" dir="auto">
                {share.message}
              </p>
            ) : null}
            <LibraryShareDue dueAt={share.dueAt} progress={share.progress} />
            <LibraryShareActions
              share={share}
              onChange={(next) =>
                setSnapshot((previous) => ({
                  ...previous,
                  shares: previous.shares.map((row) => (row.id === next.id ? next : row)),
                }))
              }
              onRevoked={() =>
                setSnapshot((previous) => ({
                  ...previous,
                  shares: previous.shares.filter((row) => row.id !== share.id),
                }))
              }
            />
          </article>
        ))}
      </section>
      {current && snapshot.cursor ? (
        <button
          className="button-quiet"
          disabled={loading}
          type="button"
          onClick={() => void more()}
        >
          {loading ? copy.loading : copy.loadMore}
        </button>
      ) : null}
    </WorkspaceShell>
  );
}
