"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../../components/locale-provider";
import type { QuizDraft } from "@openround/contracts";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { apiFetch, humanError } from "../../lib/api";
import { clearBuilderRecovery } from "../../lib/builder-recovery";
import { pluralCategory } from "../../lib/i18n/format";
import {
  filterLibraryItems,
  libraryBulkActionIds,
  type LibraryItemStatus,
  type LibraryOwnershipFilter,
  type LibraryStatusFilter,
} from "../../lib/library-controls";
import {
  DEFAULT_ROUND_LIBRARY_VIEW,
  readRoundLibraryView,
  type RoundLibraryView,
  writeRoundLibraryView,
} from "../../lib/round-library-view";
import styles from "./library.module.css";

interface RoundRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: LibraryItemStatus;
  draft: QuizDraft;
  currentVersionId: string | null;
  folderId?: string | null;
  tags?: string[];
  updatedAt: string;
}

interface PresentationRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: LibraryItemStatus;
  blockCount: number;
  currentVersionId: string | null;
  folderId: string | null;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

type LibraryType = "rounds" | "presentations";
type ArtifactType = "round" | "presentation";
type BulkAction = "duplicate" | "archive" | "restore" | "delete";

interface FolderRecord {
  id: string;
  name: string;
}

interface FavoriteRecord {
  artifactType: ArtifactType;
  artifactId: string;
}

function favoriteKey(artifactType: ArtifactType, artifactId: string) {
  return `${artifactType}:${artifactId}`;
}

const statusFilters = new Set<LibraryStatusFilter>([
  "active",
  "draft",
  "published",
  "archived",
  "all",
]);

function statusFromQuery(value: string | null): LibraryStatusFilter {
  return value && statusFilters.has(value as LibraryStatusFilter)
    ? (value as LibraryStatusFilter)
    : "active";
}

function dateLabel(locale: string, value: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
}

function LibraryContent() {
  const { locale, t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canEdit, creator, productFeatures } = useWorkspace();
  const canDelete = creator?.role === "owner";
  const presentationsEnabled = productFeatures?.presentations === true;
  const requestedType = searchParams.get("type");
  const [type, setType] = useState<LibraryType>(
    requestedType === "presentations" && presentationsEnabled ? "presentations" : "rounds",
  );
  const [rounds, setRounds] = useState<RoundRecord[]>([]);
  const [presentations, setPresentations] = useState<PresentationRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState<LibraryStatusFilter>(() =>
    statusFromQuery(searchParams.get("status")),
  );
  const [ownership, setOwnership] = useState<LibraryOwnershipFilter>(
    searchParams.get("owner") === "workspace" ? "workspace" : "all",
  );
  const [folderId, setFolderId] = useState(searchParams.get("folder") ?? "all");
  const [favoritesOnly, setFavoritesOnly] = useState(searchParams.get("favorites") === "true");
  const [view, setView] = useState<RoundLibraryView>(DEFAULT_ROUND_LIBRARY_VIEW);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [targetFolderId, setTargetFolderId] = useState("unfiled");
  const [busyAction, setBusyAction] = useState<BulkAction | "favorite" | "folder" | "">("");
  const [announcement, setAnnouncement] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [roundResponse, presentationResponse, folderResponse, favoriteResponse] =
        await Promise.all([
          apiFetch<{ quizzes: RoundRecord[] }>("/v1/quizzes?archived=true"),
          presentationsEnabled
            ? apiFetch<{ presentations: PresentationRecord[] }>("/v1/presentations?archived=true")
            : Promise.resolve({ presentations: [] }),
          apiFetch<{ folders: FolderRecord[] }>("/v1/folders"),
          apiFetch<{ favorites: FavoriteRecord[] }>("/v1/library/favorites"),
        ]);
      setRounds(roundResponse.quizzes);
      setPresentations(presentationResponse.presentations);
      setFolders(folderResponse.folders);
      setFavoriteIds(
        new Set(
          favoriteResponse.favorites.map((favorite) =>
            favoriteKey(favorite.artifactType, favorite.artifactId),
          ),
        ),
      );
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) router.replace("/signin");
      else setError(humanError(caught));
    } finally {
      setLoading(false);
    }
  }, [presentationsEnabled, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setType(requestedType === "presentations" && presentationsEnabled ? "presentations" : "rounds");
    setSearch(searchParams.get("q") ?? "");
    setStatus(statusFromQuery(searchParams.get("status")));
    setOwnership(searchParams.get("owner") === "workspace" ? "workspace" : "all");
    setFolderId(searchParams.get("folder") ?? "all");
    setFavoritesOnly(searchParams.get("favorites") === "true");
  }, [presentationsEnabled, requestedType, searchParams]);

  useEffect(() => {
    if (!creator?.workspaceId) return;
    setView(readRoundLibraryView(window.localStorage, creator.workspaceId));
  }, [creator?.workspaceId]);

  useEffect(() => {
    const available = new Set(
      (type === "rounds" ? rounds : presentations).map((artifact) => artifact.id),
    );
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [presentations, rounds, type]);

  const filters = useMemo(
    () => ({
      query: search,
      status,
      ownership,
      workspaceId: creator?.workspaceId ?? "",
      folderId,
      favoritesOnly,
    }),
    [creator?.workspaceId, favoritesOnly, folderId, ownership, search, status],
  );

  const visibleRounds = useMemo(
    () =>
      filterLibraryItems(
        rounds.map((round) => ({
          ...round,
          favorite: favoriteIds.has(favoriteKey("round", round.id)),
          searchTerms: [
            ...(round.tags ?? []),
            folders.find((folder) => folder.id === round.folderId)?.name ?? "",
          ],
        })),
        filters,
      ),
    [favoriteIds, filters, folders, rounds],
  );
  const visiblePresentations = useMemo(
    () =>
      filterLibraryItems(
        presentations.map((presentation) => ({
          ...presentation,
          favorite: favoriteIds.has(favoriteKey("presentation", presentation.id)),
          searchTerms: [folders.find((folder) => folder.id === presentation.folderId)?.name ?? ""],
        })),
        filters,
      ),
    [favoriteIds, filters, folders, presentations],
  );
  const bulkTargets = useMemo(
    () =>
      type === "rounds"
        ? libraryBulkActionIds(rounds, selectedIds)
        : libraryBulkActionIds(presentations, selectedIds),
    [presentations, rounds, selectedIds, type],
  );
  const visibleIds = useMemo(
    () => (type === "rounds" ? visibleRounds : visiblePresentations).map((artifact) => artifact.id),
    [type, visiblePresentations, visibleRounds],
  );
  useEffect(() => {
    const visible = new Set(visibleIds);
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleIds]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const filtered =
    Boolean(search.trim()) ||
    status !== "active" ||
    ownership !== "all" ||
    folderId !== "all" ||
    favoritesOnly;
  const visibleCount = type === "rounds" ? visibleRounds.length : visiblePresentations.length;
  const totalCount = type === "rounds" ? rounds.length : presentations.length;

  function chooseType(next: LibraryType) {
    setType(next);
    setSelectedIds(new Set());
    const params = new URLSearchParams(searchParams.toString());
    if (next === "presentations") params.set("type", "presentations");
    else params.delete("type");
    if (search.trim()) params.set("q", search.trim());
    else params.delete("q");
    if (status === "active") params.delete("status");
    else params.set("status", status);
    if (ownership === "workspace") params.set("owner", "workspace");
    else params.delete("owner");
    if (folderId !== "all") params.set("folder", folderId);
    else params.delete("folder");
    if (favoritesOnly) params.set("favorites", "true");
    else params.delete("favorites");
    router.replace(`/library${params.size ? `?${params}` : ""}`);
  }

  function chooseView(next: RoundLibraryView) {
    setView(next);
    if (creator?.workspaceId) {
      writeRoundLibraryView(window.localStorage, creator.workspaceId, next);
    }
  }

  function clearFilters() {
    setSearch("");
    setStatus("active");
    setOwnership("all");
    setFolderId("all");
    setFavoritesOnly(false);
    const params = new URLSearchParams();
    if (type === "presentations") params.set("type", "presentations");
    router.replace(`/library${params.size ? `?${params}` : ""}`);
  }

  function toggleSelection(artifactId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(artifactId)) next.delete(artifactId);
      else next.add(artifactId);
      return next;
    });
  }

  function toggleVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function runArtifactAction(action: BulkAction, ids: string[]) {
    if (!ids.length || busyAction) return;
    const actionType = type;
    if (action === "delete") {
      if (!canDelete) return;
      const items = actionType === "rounds" ? rounds : presentations;
      const targets = items.filter((item) => ids.includes(item.id) && item.status === "archived");
      if (targets.length !== ids.length) return;
      const message =
        targets.length === 1
          ? t("pages.library.deleteConfirm", { title: targets[0]!.title })
          : t("pages.library.deleteManyConfirm", { count: targets.length });
      if (!window.confirm(message)) return;
    }
    setBusyAction(action);
    setAnnouncement("");
    setError("");
    const results = await Promise.allSettled(
      ids.map((id) =>
        action === "delete"
          ? apiFetch(actionType === "rounds" ? `/v1/quizzes/${id}` : `/v1/presentations/${id}`, {
              method: "DELETE",
            })
          : action === "duplicate"
            ? apiFetch(`/v1/quizzes/${id}/duplicate`, { method: "POST", body: "{}" })
            : apiFetch(
                actionType === "rounds"
                  ? `/v1/quizzes/${id}/archive`
                  : `/v1/presentations/${id}/archive`,
                {
                  method: "POST",
                  body: JSON.stringify({ archived: action === "archive" }),
                },
              ),
      ),
    );
    const succeeded = ids.filter((_, index) => results[index]?.status === "fulfilled");
    const failed = results.find((result) => result.status === "rejected");
    if (action === "delete") {
      const deleted = new Set(succeeded);
      if (actionType === "rounds")
        setRounds((current) => current.filter((item) => !deleted.has(item.id)));
      else setPresentations((current) => current.filter((item) => !deleted.has(item.id)));
      setFavoriteIds((current) => {
        const next = new Set(current);
        succeeded.forEach((id) =>
          next.delete(favoriteKey(actionType === "rounds" ? "round" : "presentation", id)),
        );
        return next;
      });
      await Promise.allSettled(
        succeeded.map((id) =>
          clearBuilderRecovery(`${actionType === "rounds" ? "round" : "presentation"}:${id}`),
        ),
      );
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      succeeded.forEach((id) => next.delete(id));
      return next;
    });
    await refresh();
    if (failed?.status === "rejected") setError(humanError(failed.reason));
    if (succeeded.length) {
      setAnnouncement(
        t("pages.library.actionComplete", {
          count: succeeded.length,
          type: t(actionType === "rounds" ? "pages.common.rounds" : "pages.common.presentations"),
          action: t(`pages.library.action.${action}`),
        }),
      );
    }
    setBusyAction("");
  }

  async function applyFolder(ids: string[]) {
    if (!ids.length) return;
    setBusyAction("folder");
    setAnnouncement("");
    setError("");
    const nextFolderId = targetFolderId === "unfiled" ? null : targetFolderId;
    const results = await Promise.allSettled(
      ids.map((id) =>
        type === "rounds"
          ? apiFetch(`/v1/quizzes/${id}/organization`, {
              method: "PATCH",
              body: JSON.stringify({
                folderId: nextFolderId,
                tags: rounds.find((round) => round.id === id)?.tags ?? [],
              }),
            })
          : apiFetch(`/v1/presentations/${id}/organization`, {
              method: "PATCH",
              body: JSON.stringify({ folderId: nextFolderId }),
            }),
      ),
    );
    const succeeded = ids.filter((_, index) => results[index]?.status === "fulfilled");
    const failed = results.find((result) => result.status === "rejected");
    await refresh();
    if (failed?.status === "rejected") setError(humanError(failed.reason));
    if (succeeded.length) {
      const folderName =
        nextFolderId === null
          ? t("pages.library.unfiled")
          : (folders.find((folder) => folder.id === nextFolderId)?.name ??
            t("pages.library.selectedFolder"));
      setAnnouncement(t("pages.library.moved", { count: succeeded.length, folder: folderName }));
    }
    setBusyAction("");
  }

  async function toggleFavorite(artifactType: ArtifactType, artifactId: string) {
    const key = favoriteKey(artifactType, artifactId);
    const favorite = !favoriteIds.has(key);
    setBusyAction("favorite");
    setError("");
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (favorite) next.add(key);
      else next.delete(key);
      return next;
    });
    try {
      await apiFetch(`/v1/library/favorites/${artifactType}/${artifactId}`, {
        method: "PUT",
        body: JSON.stringify({ favorite }),
      });
      setAnnouncement(
        t(favorite ? "pages.library.favoriteAdded" : "pages.library.favoriteRemoved"),
      );
    } catch (caught) {
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (favorite) next.delete(key);
        else next.add(key);
        return next;
      });
      setError(humanError(caught));
    } finally {
      setBusyAction("");
    }
  }

  return (
    <WorkspaceShell
      actions={
        canEdit ? (
          <Link
            className="button"
            href={
              type === "presentations"
                ? "/create/presentation"
                : productFeatures?.builderV2
                  ? "/create"
                  : "/dashboard"
            }
          >
            {t(
              type === "rounds" ? "pages.library.createRound" : "pages.library.createPresentation",
            )}
          </Link>
        ) : null
      }
      description={t("page.library.description")}
      eyebrow={t("page.library.eyebrow")}
      title={t("page.library.title")}
      translationLevel="full"
    >
      <p>
        <Link href="/surveys">{t("create.kind.browseSurveys")}</Link>
      </p>
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label={t("pages.library.typeLabel")}>
          <button
            aria-controls="rounds-panel"
            aria-selected={type === "rounds"}
            className={type === "rounds" ? styles.tabActive : styles.tab}
            id="rounds-tab"
            onClick={() => chooseType("rounds")}
            role="tab"
            type="button"
          >
            {t("pages.common.rounds")} <span>{rounds.length}</span>
          </button>
          {presentationsEnabled ? (
            <button
              aria-controls="presentations-panel"
              aria-selected={type === "presentations"}
              className={type === "presentations" ? styles.tabActive : styles.tab}
              id="presentations-tab"
              onClick={() => chooseType("presentations")}
              role="tab"
              type="button"
            >
              {t("pages.common.presentations")} <span>{presentations.length}</span>
            </button>
          ) : null}
        </div>
        <label className={styles.searchField}>
          <span className="sr-only">
            {t(
              type === "rounds"
                ? "pages.library.searchRounds"
                : "pages.library.searchPresentations",
            )}
          </span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t(
              type === "rounds"
                ? "pages.library.searchRounds"
                : "pages.library.searchPresentations",
            )}
            type="search"
            value={search}
          />
        </label>
        <Link className={styles.manageLink} href="/dashboard">
          {t("pages.library.manageFolders")}
        </Link>
        <Link className={styles.manageLink} href="/recovery-packs" lang="en-CA">
          Recovery Packs
        </Link>
      </div>

      <section className={styles.filterBar} aria-label={t("pages.library.filtersLabel")}>
        <label className={styles.filterField}>
          <span>{t("pages.common.statusLabel")}</span>
          <select
            aria-label={t("pages.library.filterStatus")}
            onChange={(event) => setStatus(event.target.value as LibraryStatusFilter)}
            value={status}
          >
            <option value="active">{t("pages.common.status.active")}</option>
            <option value="draft">{t("pages.common.status.draft")}</option>
            <option value="published">{t("pages.common.status.published")}</option>
            <option value="archived">{t("pages.common.status.archived")}</option>
            <option value="all">{t("pages.library.allStatuses")}</option>
          </select>
        </label>
        <label className={styles.filterField}>
          <span>{t("pages.library.folder")}</span>
          <select
            aria-label={t("pages.library.filterFolder")}
            onChange={(event) => setFolderId(event.target.value)}
            value={folderId}
          >
            <option value="all">{t("pages.library.allFolders")}</option>
            <option value="unfiled">{t("pages.library.unfiled")}</option>
            {folders.map((folder) => (
              <option key={folder.id} lang="" value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-pressed={favoritesOnly}
          className={styles.favoriteFilter}
          onClick={() => setFavoritesOnly((current) => !current)}
          type="button"
        >
          <span aria-hidden="true">★</span> {t("pages.library.favorites")}
        </button>
        <label className={styles.filterField}>
          <span>{t("pages.library.ownership")}</span>
          <select
            aria-label={t("pages.library.filterOwnership")}
            onChange={(event) => setOwnership(event.target.value as LibraryOwnershipFilter)}
            value={ownership}
          >
            <option value="all">{t("pages.library.allOwners")}</option>
            <option value="workspace">{t("pages.library.workspaceOwned")}</option>
          </select>
        </label>
        <p className={styles.resultSummary} role="status">
          {loading
            ? t("pages.library.loadingContent")
            : t("pages.library.resultCount", {
                visible: visibleCount,
                total: totalCount,
                type: t(type === "rounds" ? "pages.common.rounds" : "pages.common.presentations"),
              })}
        </p>
        <div aria-label={t("pages.library.layoutLabel")} className={styles.viewToggle} role="group">
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

      {announcement ? (
        <p className={styles.actionStatus} role="status">
          {announcement}
        </p>
      ) : null}
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && canEdit && visibleIds.length ? (
        <div className={styles.selectionBar} data-active={selectedIds.size > 0}>
          <label className={styles.selectAll}>
            <input checked={allVisibleSelected} onChange={toggleVisible} type="checkbox" />
            <span>
              {allVisibleSelected
                ? t("pages.library.deselectResults")
                : t("pages.library.selectAll", { count: visibleIds.length })}
            </span>
          </label>
          {selectedIds.size ? (
            <>
              <strong>
                {t("pages.library.selectedCount", { count: selectedIds.size })}
                <span className="sr-only"> {type}</span>
              </strong>
              <div className={styles.bulkActions}>
                {type === "rounds" ? (
                  <button
                    disabled={Boolean(busyAction)}
                    onClick={() => void runArtifactAction("duplicate", bulkTargets.duplicate)}
                    type="button"
                  >
                    {t("pages.library.duplicateCount", { count: bulkTargets.duplicate.length })}
                  </button>
                ) : null}
                {bulkTargets.archive.length ? (
                  <button
                    disabled={Boolean(busyAction)}
                    onClick={() => void runArtifactAction("archive", bulkTargets.archive)}
                    type="button"
                  >
                    {t("pages.library.archiveCount", { count: bulkTargets.archive.length })}
                  </button>
                ) : null}
                {bulkTargets.restore.length ? (
                  <button
                    disabled={Boolean(busyAction)}
                    onClick={() => void runArtifactAction("restore", bulkTargets.restore)}
                    type="button"
                  >
                    {t("pages.library.restoreCount", { count: bulkTargets.restore.length })}
                  </button>
                ) : null}
                {canDelete && bulkTargets.restore.length ? (
                  <button
                    className={styles.dangerAction}
                    disabled={Boolean(busyAction)}
                    onClick={() => void runArtifactAction("delete", bulkTargets.restore)}
                    type="button"
                  >
                    {t("pages.library.deleteCount", { count: bulkTargets.restore.length })}
                  </button>
                ) : null}
                <label className={styles.bulkFolder}>
                  <span className="sr-only">{t("pages.library.destinationFolder")}</span>
                  <select
                    aria-label={t("pages.library.destinationFolder")}
                    disabled={Boolean(busyAction)}
                    onChange={(event) => setTargetFolderId(event.target.value)}
                    value={targetFolderId}
                  >
                    <option value="unfiled">{t("pages.library.unfiled")}</option>
                    {folders.map((folder) => (
                      <option key={folder.id} lang="" value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={Boolean(busyAction)}
                  onClick={() => void applyFolder([...selectedIds])}
                  type="button"
                >
                  {t("pages.library.move")}
                </button>
                <button
                  disabled={Boolean(busyAction)}
                  onClick={() => setSelectedIds(new Set())}
                  type="button"
                >
                  {t("pages.library.clear")}
                </button>
              </div>
            </>
          ) : (
            <span className={styles.selectionHint}>{t("pages.library.selectionHint")}</span>
          )}
        </div>
      ) : null}

      {loading ? (
        <div className={styles.loadingGrid} aria-label={t("pages.library.loading")} />
      ) : null}

      <div
        aria-labelledby="rounds-tab"
        hidden={type !== "rounds"}
        id="rounds-panel"
        role="tabpanel"
      >
        {!loading && type === "rounds" ? (
          visibleRounds.length ? (
            <section className={styles.collection} data-view={view}>
              {visibleRounds.map((round) => {
                const archived = round.status === "archived";
                const selected = selectedIds.has(round.id);
                const folderName = folders.find((folder) => folder.id === round.folderId)?.name;
                return (
                  <article
                    className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
                    key={round.id}
                  >
                    {canEdit ? (
                      <label className={styles.cardSelector}>
                        <input
                          aria-label={t("pages.library.selectItem", { title: round.title })}
                          checked={selected}
                          onChange={() => toggleSelection(round.id)}
                          type="checkbox"
                        />
                      </label>
                    ) : null}
                    <button
                      aria-label={t(
                        round.favorite
                          ? "pages.library.removeFavorite"
                          : "pages.library.addFavorite",
                        { title: round.title },
                      )}
                      aria-pressed={round.favorite}
                      className={styles.favoriteButton}
                      disabled={busyAction === "favorite"}
                      onClick={() => void toggleFavorite("round", round.id)}
                      type="button"
                    >
                      <span aria-hidden="true">{round.favorite ? "★" : "☆"}</span>
                    </button>
                    <div className={`${styles.artwork} ${styles.roundArtwork}`} aria-hidden="true">
                      <span>R</span>
                      <div />
                      <div />
                    </div>
                    <div className={styles.cardBody}>
                      <div className={styles.cardMeta}>
                        <span className={styles.status} data-status={round.status}>
                          {t(`pages.common.status.${round.status}`)}
                        </span>
                        <span>
                          {t("pages.common.updated", { date: dateLabel(locale, round.updatedAt) })}
                        </span>
                      </div>
                      <div className={styles.cardMain}>
                        <h2 lang="">{round.title}</h2>
                        {round.description ? (
                          <p className={styles.description} lang="">
                            {round.description}
                          </p>
                        ) : null}
                        <p className={styles.facts}>
                          {t(
                            pluralCategory(locale, round.draft.questions.length) === "one"
                              ? "pages.home.authoring.questionCount.one"
                              : "pages.home.authoring.questionCount.other",
                            { count: round.draft.questions.length },
                          )}
                        </p>
                        <p className={styles.folderLabel}>
                          {folderName ? (
                            <span lang="">{folderName}</span>
                          ) : (
                            t("pages.library.unfiled")
                          )}
                        </p>
                      </div>
                      <div className={styles.cardActions}>
                        <Link
                          className="button-quiet small-button"
                          href={archived ? `/quiz/${round.id}/preview` : `/quiz/${round.id}`}
                        >
                          {canEdit && !archived ? t("pages.library.edit") : t("pages.library.view")}
                        </Link>
                        {round.currentVersionId && canEdit && !archived ? (
                          <Link className="button small-button" href={`/host/setup/${round.id}`}>
                            {t("pages.library.host")}
                          </Link>
                        ) : null}
                        {round.currentVersionId && canEdit && !archived ? (
                          <Link
                            className="button-quiet small-button"
                            href={`/quiz/${round.id}/assign`}
                          >
                            {t("pages.library.assign")}
                          </Link>
                        ) : null}
                        {canEdit ? (
                          <details className={styles.moreMenu}>
                            <summary>{t("pages.library.more")}</summary>
                            <div className={styles.moreMenuPanel}>
                              <button
                                disabled={Boolean(busyAction)}
                                onClick={() => void runArtifactAction("duplicate", [round.id])}
                                type="button"
                              >
                                {t("pages.library.duplicate")}
                              </button>
                              <button
                                className={!archived ? styles.dangerAction : undefined}
                                disabled={Boolean(busyAction)}
                                onClick={() =>
                                  void runArtifactAction(archived ? "restore" : "archive", [
                                    round.id,
                                  ])
                                }
                                type="button"
                              >
                                {archived ? t("pages.library.restore") : t("pages.library.archive")}
                              </button>
                              {archived && canDelete ? (
                                <button
                                  className={styles.dangerAction}
                                  disabled={Boolean(busyAction)}
                                  onClick={() => void runArtifactAction("delete", [round.id])}
                                  type="button"
                                >
                                  {t("pages.library.delete")}
                                </button>
                              ) : null}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          ) : (
            <EmptyLibrary
              canEdit={canEdit}
              filtered={filtered}
              onClear={clearFilters}
              type="rounds"
            />
          )
        ) : null}
      </div>

      {presentationsEnabled ? (
        <div
          aria-labelledby="presentations-tab"
          hidden={type !== "presentations"}
          id="presentations-panel"
          role="tabpanel"
        >
          {!loading && type === "presentations" ? (
            visiblePresentations.length ? (
              <section className={styles.collection} data-view={view}>
                {visiblePresentations.map((presentation) => {
                  const archived = presentation.status === "archived";
                  const selected = selectedIds.has(presentation.id);
                  const folderName = folders.find(
                    (folder) => folder.id === presentation.folderId,
                  )?.name;
                  return (
                    <article
                      className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
                      key={presentation.id}
                    >
                      {canEdit ? (
                        <label className={styles.cardSelector}>
                          <input
                            aria-label={t("pages.library.selectItem", {
                              title: presentation.title,
                            })}
                            checked={selected}
                            onChange={() => toggleSelection(presentation.id)}
                            type="checkbox"
                          />
                        </label>
                      ) : null}
                      <button
                        aria-label={t(
                          presentation.favorite
                            ? "pages.library.removeFavorite"
                            : "pages.library.addFavorite",
                          { title: presentation.title },
                        )}
                        aria-pressed={presentation.favorite}
                        className={styles.favoriteButton}
                        disabled={busyAction === "favorite"}
                        onClick={() => void toggleFavorite("presentation", presentation.id)}
                        type="button"
                      >
                        <span aria-hidden="true">{presentation.favorite ? "★" : "☆"}</span>
                      </button>
                      <div
                        className={`${styles.artwork} ${styles.presentationArtwork}`}
                        aria-hidden="true"
                      >
                        <span>P</span>
                        <div />
                        <div />
                      </div>
                      <div className={styles.cardBody}>
                        <div className={styles.cardMeta}>
                          <span className={styles.status} data-status={presentation.status}>
                            {t(`pages.common.status.${presentation.status}`)}
                          </span>
                          {presentation.hasUnpublishedChanges &&
                          presentation.status === "published" ? (
                            <span className={styles.changed}>
                              {t("pages.library.unpublishedChanges")}
                            </span>
                          ) : (
                            <span>
                              {t("pages.common.updated", {
                                date: dateLabel(locale, presentation.updatedAt),
                              })}
                            </span>
                          )}
                        </div>
                        <div className={styles.cardMain}>
                          <h2 lang="">{presentation.title}</h2>
                          {presentation.description ? (
                            <p className={styles.description} lang="">
                              {presentation.description}
                            </p>
                          ) : null}
                          <p className={styles.facts}>
                            {t("pages.library.structuredBlockCount", {
                              count: presentation.blockCount,
                            })}
                          </p>
                          <p className={styles.folderLabel}>
                            {folderName ? (
                              <span lang="">{folderName}</span>
                            ) : (
                              t("pages.library.unfiled")
                            )}
                          </p>
                        </div>
                        <div className={styles.cardActions}>
                          <Link
                            className="button-quiet small-button"
                            href={`/presentation/${presentation.id}`}
                          >
                            {canEdit && !archived
                              ? t("pages.library.edit")
                              : t("pages.library.view")}
                          </Link>
                          {presentation.currentVersionId && canEdit && !archived ? (
                            <Link
                              className="button small-button"
                              href={`/presentation/${presentation.id}/host`}
                            >
                              {t("pages.library.host")}
                            </Link>
                          ) : null}
                          {canEdit ? (
                            <details className={styles.moreMenu}>
                              <summary>{t("pages.library.more")}</summary>
                              <div className={styles.moreMenuPanel}>
                                <button
                                  className={!archived ? styles.dangerAction : undefined}
                                  disabled={Boolean(busyAction)}
                                  onClick={() =>
                                    void runArtifactAction(archived ? "restore" : "archive", [
                                      presentation.id,
                                    ])
                                  }
                                  type="button"
                                >
                                  {archived
                                    ? t("pages.library.restore")
                                    : t("pages.library.archive")}
                                </button>
                                {archived && canDelete ? (
                                  <button
                                    className={styles.dangerAction}
                                    disabled={Boolean(busyAction)}
                                    onClick={() =>
                                      void runArtifactAction("delete", [presentation.id])
                                    }
                                    type="button"
                                  >
                                    {t("pages.library.delete")}
                                  </button>
                                ) : null}
                              </div>
                            </details>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            ) : (
              <EmptyLibrary
                canEdit={canEdit}
                filtered={filtered}
                onClear={clearFilters}
                type="presentations"
              />
            )
          ) : null}
        </div>
      ) : null}
    </WorkspaceShell>
  );
}

function EmptyLibrary({
  type,
  canEdit,
  filtered,
  onClear,
}: {
  type: LibraryType;
  canEdit: boolean;
  filtered: boolean;
  onClear: () => void;
}) {
  const { t } = useLocale();
  return (
    <section className={styles.empty}>
      <span aria-hidden="true">{type === "rounds" ? "R" : "P"}</span>
      <h2>
        {filtered
          ? t("pages.library.noMatch", {
              type: t(type === "rounds" ? "pages.common.rounds" : "pages.common.presentations"),
            })
          : t(type === "rounds" ? "pages.library.firstRound" : "pages.library.firstPresentation")}
      </h2>
      <p>
        {filtered
          ? t("pages.library.noMatchDescription")
          : type === "rounds"
            ? t("pages.library.firstRoundDescription")
            : t("pages.library.firstPresentationDescription")}
      </p>
      {filtered ? (
        <button className="button-quiet" onClick={onClear} type="button">
          {t("pages.results.clearFilters")}
        </button>
      ) : canEdit ? (
        <Link className="button" href={type === "rounds" ? "/create" : "/create/presentation"}>
          {t(type === "rounds" ? "pages.library.createRound" : "pages.library.createPresentation")}
        </Link>
      ) : null}
    </section>
  );
}

export default function LibraryPage() {
  return (
    <WorkspaceProvider>
      <LibraryContent />
    </WorkspaceProvider>
  );
}
