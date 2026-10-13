"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../../components/locale-provider";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import { apiFetch, humanError } from "../../../lib/api";
import {
  folderArtifactType,
  folderPathLabel,
  folderSiblingPosition,
  getFolderMoveOptions,
  getFolderOptions,
  type FolderRecord,
  type LibraryType,
} from "../../../lib/folders";
import { FolderPaginationError, loadFolderContent, type ContentRecord } from "./folder-content";
import { FolderTree, type FolderCommand } from "./folder-tree";
import styles from "./folders.module.css";

interface FolderEdit {
  kind: FolderCommand;
  id: string;
  name: string;
  parentId: string;
}

function FolderManager({ type, workspaceId }: { type: LibraryType; workspaceId: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const { canEdit } = useWorkspace();
  const artifactType = folderArtifactType(type);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [content, setContent] = useState<ContentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState("unfiled");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [destinationId, setDestinationId] = useState("unfiled");
  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState("root");
  const [editing, setEditing] = useState<FolderEdit | null>(null);
  const active = useRef(true);
  const readController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    try {
      const [folderResponse, records] = await Promise.all([
        apiFetch<{ folders: FolderRecord[] }>(`/v1/folders?artifactType=${artifactType}`, {
          signal: controller.signal,
        }),
        loadFolderContent(type, controller.signal),
      ]);
      if (!active.current || controller.signal.aborted) return;
      const scopedFolders = folderResponse.folders.filter(
        (folder) => folder.artifactType === artifactType,
      );
      setFolders(scopedFolders);
      setContent(
        records.filter((record) => !record.workspaceId || record.workspaceId === workspaceId),
      );
      setSelectedFolderId((current) =>
        scopedFolders.some((folder) => folder.id === current) ? current : "unfiled",
      );
      setNewParentId((current) =>
        scopedFolders.some((folder) => folder.id === current) ? current : "root",
      );
      setDestinationId((current) =>
        scopedFolders.some((folder) => folder.id === current) ? current : "unfiled",
      );
      setSelectedIds(new Set());
    } catch (caught) {
      if (!active.current || controller.signal.aborted) return;
      if ((caught as { status?: number }).status === 401) router.replace("/signin");
      else
        setError(
          caught instanceof FolderPaginationError
            ? t("pages.folders.loadingFailed")
            : humanError(caught),
        );
    } finally {
      if (active.current && !controller.signal.aborted) setLoading(false);
    }
  }, [artifactType, router, t, type, workspaceId]);

  useEffect(() => {
    active.current = true;
    void refresh();
    return () => {
      active.current = false;
      readController.current?.abort();
    };
  }, [refresh]);

  const options = useMemo(() => getFolderOptions(folders), [folders]);
  const counts = useMemo(() => {
    const result = new Map<string | null, number>();
    for (const item of content)
      result.set(item.folderId ?? null, (result.get(item.folderId ?? null) ?? 0) + 1);
    return result;
  }, [content]);
  const visibleContent = content.filter(
    (item) => (item.folderId ?? "unfiled") === selectedFolderId,
  );
  const currentLabel =
    selectedFolderId === "unfiled"
      ? t("pages.library.unfiled")
      : (folderPathLabel(folders, selectedFolderId) ?? t("pages.library.unfiled"));
  const unavailable = busy || loading;

  async function mutate(
    operation: () => Promise<unknown>,
    message: string,
    collisionMessage = false,
  ) {
    if (!canEdit || unavailable) return;
    setBusy(true);
    setError("");
    setAnnouncement("");
    try {
      await operation();
      if (!active.current) return;
      setEditing(null);
      await refresh();
      if (active.current) setAnnouncement(message);
    } catch (caught) {
      if (active.current) {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else
          setError(
            collisionMessage && (caught as { status?: number }).status === 409
              ? t("pages.folders.deleteCollision")
              : humanError(caught),
          );
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }

  function selectFolder(id: string) {
    setSelectedFolderId(id);
    setSelectedIds(new Set());
    setAnnouncement("");
  }

  async function moveSelected() {
    if (!canEdit || unavailable || !selectedIds.size || destinationId === selectedFolderId) return;
    const folderId = destinationId === "unfiled" ? null : destinationId;
    if (
      folderId &&
      !folders.some((folder) => folder.id === folderId && folder.artifactType === artifactType)
    )
      return;
    const records = visibleContent.filter((record) => selectedIds.has(record.id));
    setBusy(true);
    setError("");
    setAnnouncement("");
    const results = await Promise.allSettled(
      records.map((record) => {
        const path = type === "rounds" ? "quizzes" : type;
        const body =
          type === "surveys"
            ? { folderId, expectedRevision: record.revision, idempotencyKey: crypto.randomUUID() }
            : { folderId };
        return apiFetch(`/v1/${path}/${record.id}/organization`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }),
    );
    if (!active.current) return;
    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.find((result) => result.status === "rejected");
    await refresh();
    if (!active.current) return;
    if (failed?.status === "rejected") setError(humanError(failed.reason));
    if (succeeded)
      setAnnouncement(
        t("pages.library.moved", {
          count: succeeded,
          folder: folderId
            ? (folderPathLabel(folders, folderId) ?? "")
            : t("pages.library.unfiled"),
        }),
      );
    setBusy(false);
  }

  return (
    <>
      <p aria-live="polite" className={styles.announcement} role="status">
        {announcement}
      </p>
      {error ? (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button
            disabled={unavailable}
            onClick={() => {
              setError("");
              void refresh();
            }}
            type="button"
          >
            {t("pages.common.tryAgain")}
          </button>
        </div>
      ) : null}
      {!canEdit ? <p className={styles.notice}>{t("pages.folders.readOnly")}</p> : null}
      {canEdit ? (
        <form
          className={styles.createForm}
          onSubmit={(event) => {
            event.preventDefault();
            const name = newName.trim();
            if (!name) {
              setError(t("pages.folders.nameRequired"));
              return;
            }
            void mutate(
              async () => {
                await apiFetch("/v1/folders", {
                  method: "POST",
                  body: JSON.stringify({
                    name,
                    artifactType,
                    parentId: newParentId === "root" ? null : newParentId,
                  }),
                });
                if (active.current) setNewName("");
              },
              t("pages.folders.created", { folder: name }),
            );
          }}
        >
          <label>
            <span>{t("pages.folders.folderName")}</span>
            <input
              disabled={unavailable}
              maxLength={80}
              onChange={(event) => setNewName(event.target.value)}
              required
              value={newName}
            />
          </label>
          <label>
            <span>{t("pages.folders.parentFolder")}</span>
            <select
              disabled={unavailable}
              onChange={(event) => setNewParentId(event.target.value)}
              value={newParentId}
            >
              <option value="root">{t("pages.folders.topLevel")}</option>
              {options.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.primaryButton}
            disabled={unavailable || !newName.trim()}
            type="submit"
          >
            {t("pages.folders.create")}
          </button>
        </form>
      ) : null}
      {editing && canEdit ? (
        <section aria-labelledby="folder-command-title" className={styles.command}>
          <h2 id="folder-command-title">
            {t(`pages.folders.${editing.kind}Label`, {
              folder: folderPathLabel(folders, editing.id) ?? editing.name,
            })}
          </h2>
          {editing.kind === "delete" ? (
            <>
              <p>
                {t("pages.folders.deleteExplanation", {
                  folder: folderPathLabel(folders, editing.id) ?? editing.name,
                })}
              </p>
              <div className={styles.commandActions}>
                <button
                  className={styles.dangerButton}
                  disabled={unavailable}
                  onClick={() =>
                    void mutate(
                      () => apiFetch(`/v1/folders/${editing.id}`, { method: "DELETE" }),
                      t("pages.folders.deleted", { folder: editing.name }),
                      true,
                    )
                  }
                  type="button"
                >
                  {t("pages.folders.deleteFolder")}
                </button>
                <button disabled={unavailable} onClick={() => setEditing(null)} type="button">
                  {t("pages.folders.cancel")}
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (editing.kind === "rename" && !editing.name.trim()) {
                  setError(t("pages.folders.nameRequired"));
                  return;
                }
                const body =
                  editing.kind === "rename"
                    ? { name: editing.name.trim() }
                    : { parentId: editing.parentId === "root" ? null : editing.parentId };
                void mutate(
                  () =>
                    apiFetch(`/v1/folders/${editing.id}`, {
                      method: "PATCH",
                      body: JSON.stringify(body),
                    }),
                  t("pages.folders.updated"),
                );
              }}
            >
              {editing.kind === "rename" ? (
                <label>
                  <span>{t("pages.folders.newName")}</span>
                  <input
                    autoFocus
                    disabled={unavailable}
                    maxLength={80}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                    required
                    value={editing.name}
                  />
                </label>
              ) : (
                <label>
                  <span>{t("pages.folders.newParent")}</span>
                  <select
                    autoFocus
                    disabled={unavailable}
                    onChange={(event) => setEditing({ ...editing, parentId: event.target.value })}
                    value={editing.parentId}
                  >
                    <option value="root">{t("pages.folders.topLevel")}</option>
                    {getFolderMoveOptions(folders, editing.id).map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className={styles.commandActions}>
                <button
                  className={styles.primaryButton}
                  disabled={unavailable || (editing.kind === "rename" && !editing.name.trim())}
                  type="submit"
                >
                  {t(
                    editing.kind === "rename"
                      ? "pages.folders.saveName"
                      : "pages.folders.moveFolder",
                  )}
                </button>
                <button disabled={unavailable} onClick={() => setEditing(null)} type="button">
                  {t("pages.folders.cancel")}
                </button>
              </div>
            </form>
          )}
        </section>
      ) : null}
      <div aria-busy={unavailable} className={styles.layout}>
        <section aria-labelledby="folder-tree-title" className={styles.panel}>
          <h2 id="folder-tree-title">{t("pages.folders.treeTitle")}</h2>
          <button
            aria-pressed={selectedFolderId === "unfiled"}
            className={styles.unfiled}
            disabled={unavailable}
            onClick={() => selectFolder("unfiled")}
            type="button"
          >
            <span>{t("pages.library.unfiled")}</span>
            <span className={styles.count}>{counts.get(null) ?? 0}</span>
          </button>
          {loading ? (
            <p role="status">{t("pages.folders.loading")}</p>
          ) : folders.length ? (
            <FolderTree
              busy={unavailable}
              canEdit={canEdit}
              counts={counts}
              folders={folders}
              onCommand={(kind, folder) =>
                setEditing({
                  kind,
                  id: folder.id,
                  name: folder.name,
                  parentId: folder.parentId ?? "root",
                })
              }
              onReorder={(folder, direction) => {
                const position = folderSiblingPosition(folders, folder.id, direction);
                if (position !== null)
                  void mutate(
                    () =>
                      apiFetch(`/v1/folders/${folder.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ position }),
                      }),
                    t("pages.folders.updated"),
                  );
              }}
              onSelect={selectFolder}
              selectedFolderId={selectedFolderId}
            />
          ) : (
            <p className={styles.empty}>{t("pages.folders.emptyFolders")}</p>
          )}
        </section>
        <section aria-labelledby="folder-content-title" className={styles.panel}>
          <div className={styles.contentHeading}>
            <h2 id="folder-content-title">{currentLabel}</h2>
            <span>{t("pages.folders.contentCount", { count: visibleContent.length })}</span>
          </div>
          {loading ? (
            <p role="status">{t("pages.library.loadingContent")}</p>
          ) : visibleContent.length ? (
            <>
              {canEdit ? (
                <div className={styles.bulkControls}>
                  <label className={styles.selectAll}>
                    <input
                      checked={selectedIds.size === visibleContent.length}
                      disabled={unavailable}
                      onChange={(event) =>
                        setSelectedIds(
                          event.target.checked
                            ? new Set(visibleContent.map((record) => record.id))
                            : new Set(),
                        )
                      }
                      type="checkbox"
                    />
                    {t("pages.library.selectAll", { count: visibleContent.length })}
                  </label>
                  <span>{t("pages.library.selectedCount", { count: selectedIds.size })}</span>
                  <label>
                    <span>{t("pages.library.destinationFolder")}</span>
                    <select
                      disabled={unavailable}
                      onChange={(event) => setDestinationId(event.target.value)}
                      value={destinationId}
                    >
                      <option value="unfiled">{t("pages.library.unfiled")}</option>
                      {options.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className={styles.primaryButton}
                    disabled={
                      unavailable || !selectedIds.size || destinationId === selectedFolderId
                    }
                    onClick={() => void moveSelected()}
                    type="button"
                  >
                    {t("pages.folders.moveSelected")}
                  </button>
                </div>
              ) : null}
              <ul className={styles.contentList}>
                {visibleContent.map((item) => (
                  <li data-content-id={item.id} key={item.id}>
                    {canEdit ? (
                      <input
                        aria-label={t("pages.library.selectItem", { title: item.title })}
                        checked={selectedIds.has(item.id)}
                        disabled={unavailable}
                        onChange={(event) =>
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })
                        }
                        type="checkbox"
                      />
                    ) : null}
                    <Link
                      href={
                        type === "rounds"
                          ? `/quiz/${item.id}`
                          : type === "surveys"
                            ? `/surveys/${item.id}`
                            : `/presentation/${item.id}`
                      }
                    >
                      {item.title}
                    </Link>
                    <span className={styles.status}>{t(`pages.common.status.${item.status}`)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.empty}>{t("pages.folders.emptyContent")}</p>
          )}
        </section>
      </div>
    </>
  );
}

function FolderManagerContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const { creator, productFeatures, loading } = useWorkspace();
  const requestedType = searchParams.get("type");
  const presentationsEnabled = productFeatures?.presentations === true;
  const type: LibraryType =
    requestedType === "surveys"
      ? "surveys"
      : requestedType === "presentations" && presentationsEnabled
        ? "presentations"
        : "rounds";
  const types: LibraryType[] = presentationsEnabled
    ? ["rounds", "presentations", "surveys"]
    : ["rounds", "surveys"];
  return (
    <WorkspaceShell
      actions={
        <Link className={styles.backLink} href={`/library?type=${type}`}>
          {t("pages.folders.backToLibrary")}
        </Link>
      }
      description={t("pages.folders.description", { type: t(`pages.common.${type}`) })}
      requireBeta={false}
      title={t("pages.library.manageFolders")}
      translationLevel="full"
    >
      <nav aria-label={t("pages.library.typeLabel")} className={styles.tabs}>
        {types.map((entry) => (
          <Link
            aria-current={entry === type ? "page" : undefined}
            className={entry === type ? styles.tabActive : styles.tab}
            href={`/library/folders?type=${entry}`}
            key={entry}
          >
            {t(`pages.common.${entry}`)}
          </Link>
        ))}
      </nav>
      {!loading && creator ? (
        <FolderManager
          key={`${creator.workspaceId}:${type}`}
          type={type}
          workspaceId={creator.workspaceId}
        />
      ) : (
        <p role="status">{t("pages.folders.loading")}</p>
      )}
    </WorkspaceShell>
  );
}

export default function FoldersPage() {
  return (
    <WorkspaceProvider>
      <Suspense>
        <FolderManagerContent />
      </Suspense>
    </WorkspaceProvider>
  );
}
