"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../locale-provider";
import { useWorkspace } from "../workspace-provider";
import { WorkspaceShell } from "../workspace-shell";
import { WorkspaceKindIcon, WorkspaceStatus } from "../workspace-signals";
import { LibraryScopeNavigation } from "../library-sharing/scope-navigation";
import { LibraryShareActions } from "../library-sharing/share-actions";
import { LibraryShareDue } from "../library-sharing/share-due";
import type { LibraryScope } from "../library-sharing/client";
import { AUTH_CHANGE_EVENT } from "../../../lib/api";
import { SESSION_EXPIRED_EVENT, SESSION_LOGOUT_EVENT } from "../../../lib/idle-session";
import { librarySharingMessages } from "../../../lib/i18n/library-sharing-messages";
import {
  formatLibraryDiscoveryText,
  libraryDiscoveryCopy,
} from "../../../lib/i18n/library-discovery-copy";
import {
  libraryDiscoveryHref,
  readLibraryDiscoveryQuery,
  type LibraryDiscoveryQuery,
} from "../../../lib/library-controls";
import {
  emptyDiscoverySnapshot,
  LibraryDiscoveryPager,
  readLibraryDiscovery,
  discoveryItemKey,
  type DiscoveryItem,
  type DiscoverySnapshot,
} from "./client";
import styles from "./library-discovery.module.css";

export type LibraryManagementType = "all" | "rounds" | "presentations" | "surveys";

export function LibraryDiscovery({
  scope = "workspace",
  type = "all",
}: {
  scope?: LibraryScope;
  type?: LibraryManagementType;
}) {
  const { locale, t } = useLocale();
  const copy = libraryDiscoveryCopy(locale);
  const sharing = librarySharingMessages(locale);
  const router = useRouter();
  const searchParams = useSearchParams();
  const context = useWorkspace();
  const { creator, workspace, management, productFeatures, canEdit } = context;
  const shared = scope !== "workspace";
  const query = readLibraryDiscoveryQuery(searchParams);
  const queryKey = JSON.stringify(query);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const actor = JSON.stringify([creator?.userId, creator?.workspaceId]);
  const [stoppedActor, setStoppedActor] = useState<string | null>(null);
  const stopped = stoppedActor === actor;
  const blocked = Boolean(context.loading || context.error || !creator?.userId || stopped);
  const key = JSON.stringify([
    creator?.userId,
    creator?.workspaceId,
    creator?.role,
    workspace?.id,
    workspace?.organization,
    workspace?.permissions,
    canEdit,
    productFeatures,
    management?.user,
    management?.organizations,
    management?.organizationManagementEnabled,
    management?.loading,
    management?.error,
    context.loading,
    context.error,
    scope,
    type,
    queryKey,
    sessionEpoch,
    stopped,
  ]);
  const activeKey = useRef(key);
  activeKey.current = key;
  const [snapshot, setSnapshot] = useState<DiscoverySnapshot>(emptyDiscoverySnapshot);
  const pager = useRef<LibraryDiscoveryPager | null>(null);
  if (!pager.current) pager.current = new LibraryDiscoveryPager(setSnapshot);
  const currentPager = pager.current;
  const [searchDraft, setSearchDraft] = useState({ key: query.q, value: query.q });
  const search = searchDraft.key === query.q ? searchDraft.value : query.q;
  const current = !blocked && snapshot.key === key;
  const state = current ? snapshot : emptyDiscoverySnapshot;
  const busy = state.phase === "loading" || state.phase === "more";
  const initialError = state.phase === "error";
  const pageError = state.phase === "page-error";
  const facets = state.facets;
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

  useEffect(() => {
    setSearchDraft({ key: query.q, value: query.q });
  }, [query.q]);

  useEffect(() => {
    if (blocked) {
      currentPager.clear();
      return;
    }
    // Parse from the captured URL so a delayed response cannot adopt newer controls.
    const captured = JSON.parse(queryKey) as LibraryDiscoveryQuery;
    currentPager.start(key, (cursor, signal) =>
      readLibraryDiscovery(scope, captured, cursor, signal),
    );
    return () => currentPager.clear();
  }, [blocked, currentPager, key, queryKey, scope]);

  useEffect(() => {
    const invalidate = () => {
      currentPager.clear();
      setSessionEpoch((value) => value + 1);
    };
    const stop = () => {
      currentPager.clear();
      setStoppedActor(actor);
    };
    const auth = () => {
      invalidate();
    };
    const focus = () => {
      if (document.visibilityState !== "hidden") invalidate();
    };
    window.addEventListener(AUTH_CHANGE_EVENT, auth);
    window.addEventListener(SESSION_EXPIRED_EVENT, stop);
    window.addEventListener(SESSION_LOGOUT_EVENT, stop);
    window.addEventListener("polling-pops:workspace-updated", invalidate);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, auth);
      window.removeEventListener(SESSION_EXPIRED_EVENT, stop);
      window.removeEventListener(SESSION_LOGOUT_EVENT, stop);
      window.removeEventListener("polling-pops:workspace-updated", invalidate);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [actor, currentPager]);

  function change(patch: Partial<LibraryDiscoveryQuery>, nextType = type) {
    if (activeKey.current !== key) return;
    if (patch.q !== undefined) setSearchDraft({ key: query.q, value: patch.q });
    router.push(libraryDiscoveryHref({ ...query, ...patch }, scope, nextType), { scroll: false });
  }
  function refresh() {
    if (activeKey.current === key && !blocked) currentPager.refresh(key);
  }
  function more() {
    if (activeKey.current === key && !blocked) currentPager.more(key, state.nextCursor);
  }
  const kinds = ["round", "presentation", "survey"] as const;
  const managementKinds = kinds.filter(
    (kind) => shared || kind !== "presentation" || productFeatures?.presentations === true,
  );
  const kindLabel = (kind: (typeof kinds)[number]) =>
    t(
      kind === "round"
        ? "pages.common.rounds"
        : kind === "presentation"
          ? "pages.common.presentations"
          : "pages.common.surveys",
    );
  const managementType = (kind: (typeof kinds)[number]) =>
    kind === "round" ? "rounds" : kind === "presentation" ? "presentations" : "surveys";
  const filtered = Boolean(
    query.q ||
    query.kind !== "all" ||
    (shared
      ? query.progress !== "all" || query.permission !== "all"
      : query.status !== "active" || query.favorites || query.folder !== "all"),
  );
  const text = (message: string, values: Record<string, string | number>) =>
    formatLibraryDiscoveryText(message, values);
  const countLabel = (label: string, count: number | undefined) =>
    count === undefined ? label : `${label} (${new Intl.NumberFormat(locale).format(count)})`;

  function itemHref(item: DiscoveryItem) {
    if ("capabilities" in item) return `/library/shared/${item.id}`;
    if (item.artifactType === "round")
      return `/quiz/${item.id}${item.status === "archived" ? "/preview" : ""}`;
    return item.artifactType === "presentation"
      ? `/presentation/${item.id}`
      : `/surveys/${item.id}`;
  }

  return (
    <WorkspaceShell
      title={shared ? sharing[scope] : t("page.library.title")}
      eyebrow={t("page.library.eyebrow")}
      description={
        shared
          ? scope === "organization"
            ? sharing.organizationIntro
            : scope === "managed"
              ? sharing.managedIntro
              : sharing.sharedIntro
          : copy.intro
      }
      translationLevel="full"
    >
      <div data-library-discovery="" className={styles.discovery}>
        <LibraryScopeNavigation
          scope={scope}
          type={type}
          organization={hasOrganizationLibrary}
          canManage={canManageShares}
        />
        <nav className={styles.views} aria-label={copy.managementViews}>
          <Link
            href={libraryDiscoveryHref({ ...query, kind: "all" }, scope)}
            aria-current={type === "all" ? "page" : undefined}
          >
            {copy.allContent}
          </Link>
          {managementKinds.map((kind) => (
            <Link
              key={kind}
              href={libraryDiscoveryHref({ ...query, kind }, scope, managementType(kind))}
              aria-current={type === managementType(kind) ? "page" : undefined}
            >
              <WorkspaceKindIcon kind={kind} />
              {kindLabel(kind)}
            </Link>
          ))}
        </nav>
        {shared ? <p className={styles.help}>{copy.intro}</p> : null}
        <form
          className={styles.search}
          onSubmit={(event) => {
            event.preventDefault();
            change({ q: search.trim().slice(0, 160) });
          }}
          role="search"
        >
          <label htmlFor="library-discovery-search" className="sr-only">
            {shared ? sharing.search : copy.search}
          </label>
          <input
            id="library-discovery-search"
            className="input"
            type="search"
            maxLength={160}
            value={search}
            placeholder={shared ? sharing.search : copy.search}
            onChange={(event) => setSearchDraft({ key: query.q, value: event.target.value })}
          />
          <button className="button-quiet" type="submit">
            {copy.searchAction}
          </button>
        </form>
        <section
          className={styles.filters}
          aria-describedby="library-discovery-facet-help"
          aria-label={t("pages.library.filtersLabel")}
        >
          <label>
            <span>{t("pages.library.typeLabel")}</span>
            <select
              className="select"
              value={query.kind}
              onChange={(event) =>
                change({ kind: event.target.value as LibraryDiscoveryQuery["kind"] }, "all")
              }
            >
              <option value="all">{copy.allContent}</option>
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {countLabel(kindLabel(kind), facets?.kinds[kind])}
                </option>
              ))}
            </select>
          </label>
          {shared ? (
            <>
              <label>
                <span>{copy.progress}</span>
                <select
                  className="select"
                  value={query.progress}
                  onChange={(event) =>
                    change({ progress: event.target.value as LibraryDiscoveryQuery["progress"] })
                  }
                >
                  <option value="all">{copy.allValues}</option>
                  {(["new", "in_progress", "done"] as const).map((progress) => (
                    <option key={progress} value={progress}>
                      {countLabel(
                        sharing[progress],
                        facets && "progress" in facets ? facets.progress[progress] : undefined,
                      )}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{sharing.permission}</span>
                <select
                  className="select"
                  value={query.permission}
                  onChange={(event) =>
                    change({
                      permission: event.target.value as LibraryDiscoveryQuery["permission"],
                    })
                  }
                >
                  <option value="all">{copy.allValues}</option>
                  {(["view", "use"] as const).map((permission) => (
                    <option key={permission} value={permission}>
                      {countLabel(
                        permission === "use" ? sharing.canUse : sharing.canView,
                        facets && "permissions" in facets
                          ? facets.permissions[permission]
                          : undefined,
                      )}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                <span>{t("pages.common.statusLabel")}</span>
                <select
                  className="select"
                  value={query.status}
                  onChange={(event) =>
                    change({ status: event.target.value as LibraryDiscoveryQuery["status"] })
                  }
                >
                  <option value="active">{t("pages.common.status.active")}</option>
                  {(["draft", "published", "archived"] as const).map((status) => (
                    <option key={status} value={status}>
                      {countLabel(
                        t(`pages.common.status.${status}`),
                        facets && "statuses" in facets ? facets.statuses[status] : undefined,
                      )}
                    </option>
                  ))}
                  <option value="all">{t("pages.library.allStatuses")}</option>
                </select>
              </label>
              <label>
                <span>{t("pages.library.folder")}</span>
                <select
                  className="select"
                  value={query.folder}
                  onChange={(event) => change({ folder: event.target.value })}
                >
                  <option value="all">{t("pages.library.allFolders")}</option>
                  <option value="unfiled">{t("pages.library.unfiled")}</option>
                  {query.folder !== "all" && query.folder !== "unfiled" ? (
                    <option value={query.folder}>{copy.selectedFolder}</option>
                  ) : null}
                </select>
              </label>
              <button
                className="button-quiet"
                type="button"
                aria-pressed={query.favorites}
                onClick={() => change({ favorites: !query.favorites })}
              >
                {t("pages.library.favorites")}
              </button>
            </>
          )}
          <label>
            <span>{copy.sort}</span>
            <select
              className="select"
              value={query.sort}
              onChange={(event) =>
                change({ sort: event.target.value as LibraryDiscoveryQuery["sort"] })
              }
            >
              <option value="recent">{shared ? copy.recentShared : copy.recent}</option>
              <option value="title_asc">{copy.titleAsc}</option>
              <option value="title_desc">{copy.titleDesc}</option>
            </select>
          </label>
          {filtered ? (
            <button
              className="button-quiet"
              type="button"
              onClick={() =>
                change(
                  {
                    q: "",
                    kind: "all",
                    status: "active",
                    favorites: false,
                    folder: "all",
                    progress: "all",
                    permission: "all",
                  },
                  "all",
                )
              }
            >
              {t("pages.results.clearFilters")}
            </button>
          ) : null}
        </section>
        <p id="library-discovery-facet-help" className={styles.help}>
          {copy.facetHelp}
        </p>
        <p className={styles.summary} role="status" aria-live="polite">
          {state.phase === "loading" ? (
            sharing.loading
          ) : initialError ? (
            ""
          ) : (
            <>
              {facets ? (
                <strong>
                  {text(copy.total, { count: new Intl.NumberFormat(locale).format(facets.total) })}
                </strong>
              ) : null}
              <span>
                {text(copy.shown, {
                  count: new Intl.NumberFormat(locale).format(state.items.length),
                })}
              </span>
            </>
          )}
        </p>
        {initialError || pageError ? (
          <div role="alert" className={styles.error}>
            <p>{pageError ? copy.pageError : copy.initialError}</p>
            <button className="button-quiet" type="button" onClick={pageError ? more : refresh}>
              {sharing.retry}
            </button>
          </div>
        ) : null}
        {state.phase === "ready" && !state.items.length ? (
          <section className={styles.empty}>
            <h2>
              {filtered ? copy.noResultsTitle : shared ? sharing.emptyTitle : copy.emptyTitle}
            </h2>
            <p>{filtered ? copy.noResultsHelp : shared ? sharing.emptyHelp : copy.emptyHelp}</p>
          </section>
        ) : null}
        <ul className={styles.list} aria-label={copy.allContent} aria-busy={busy}>
          {state.items.map((item) => {
            const isShare = "capabilities" in item;
            const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
              new Date(isShare ? item.sharedAt : item.updatedAt),
            );
            return (
              <li
                key={discoveryItemKey(item)}
                data-library-item={discoveryItemKey(item)}
                data-kind={item.artifactType}
              >
                <article className={styles.row}>
                  <div className={styles.content}>
                    <div className={styles.meta}>
                      <span className={styles.kind}>
                        <WorkspaceKindIcon kind={item.artifactType} />
                        {kindLabel(item.artifactType)}
                      </span>
                      {isShare ? (
                        <>
                          <span>
                            {item.permission === "use" ? sharing.canUse : sharing.canView}
                          </span>
                          <span>{sharing[item.progress]}</span>
                        </>
                      ) : (
                        <WorkspaceStatus status={item.status}>
                          {t(`pages.common.status.${item.status}`)}
                        </WorkspaceStatus>
                      )}
                    </div>
                    <h2 lang="" dir="auto">
                      {isShare ? (
                        item.title
                      ) : (
                        <Link prefetch={false} href={itemHref(item)}>
                          {item.title}
                        </Link>
                      )}
                    </h2>
                    {item.description ? (
                      <p className={styles.description} lang="" dir="auto">
                        {item.description}
                      </p>
                    ) : null}
                    <p className={styles.details}>
                      {isShare ? (
                        <>
                          <span lang="" dir="auto">
                            {item.organizationName}
                          </span>
                          <span>
                            {sharing.from}:{" "}
                            <span lang="" dir="auto">
                              {item.sourceWorkspaceName}
                            </span>
                          </span>
                        </>
                      ) : (
                        <span>{text(copy.items, { count: item.itemCount })}</span>
                      )}
                      <span>{text(isShare ? copy.sharedDate : copy.updated, { date })}</span>
                    </p>
                    {isShare && item.message ? (
                      <p
                        className={styles.message}
                        data-library-share-message=""
                        lang=""
                        dir="auto"
                      >
                        {item.message}
                      </p>
                    ) : null}
                    {isShare ? (
                      <LibraryShareDue dueAt={item.dueAt} progress={item.progress} />
                    ) : null}
                  </div>
                  <div className={styles.actions}>
                    {isShare ? (
                      <LibraryShareActions
                        share={item}
                        onChange={refresh}
                        onRevoked={refresh}
                        onAccessChanged={refresh}
                      />
                    ) : (
                      <Link prefetch={false} className="button-quiet" href={itemHref(item)}>
                        {t(
                          canEdit && item.status !== "archived"
                            ? "pages.library.edit"
                            : "pages.library.view",
                        )}
                      </Link>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
        {current && state.nextCursor && !pageError ? (
          <button className="button-quiet" disabled={busy} type="button" onClick={more}>
            {state.phase === "more" ? sharing.loading : sharing.loadMore}
          </button>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
