"use client";

import { useLocale } from "../../../components/locale-provider";
import { folderSiblingPosition, getFolderOptions, type FolderRecord } from "../../../lib/folders";
import styles from "./folders.module.css";

export type FolderCommand = "rename" | "move" | "delete";

export function FolderTree({
  folders,
  counts,
  selectedFolderId,
  canEdit,
  busy,
  onSelect,
  onCommand,
  onReorder,
}: {
  folders: readonly FolderRecord[];
  counts: ReadonlyMap<string | null, number>;
  selectedFolderId: string;
  canEdit: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onCommand: (kind: FolderCommand, folder: FolderRecord) => void;
  onReorder: (folder: FolderRecord, direction: "up" | "down") => void;
}) {
  const { t } = useLocale();
  const options = getFolderOptions(folders);
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  function branch(parentId: string | null) {
    const children = options.filter((option) => {
      const parent = byId.get(option.id)?.parentId;
      return parentId === null ? !parent || !byId.has(parent) : parent === parentId;
    });
    if (!children.length) return null;
    return (
      <ul className={parentId === null ? styles.folderList : styles.children}>
        {children.map((option) => {
          const folder = byId.get(option.id)!;
          return (
            <li data-folder-id={folder.id} key={folder.id}>
              <div className={styles.folderRow}>
                <button
                  aria-label={t("pages.folders.openFolder", { folder: option.label })}
                  aria-pressed={selectedFolderId === folder.id}
                  className={styles.folderSelect}
                  disabled={busy}
                  onClick={() => onSelect(folder.id)}
                  type="button"
                >
                  <span aria-hidden="true" className={styles.folderIcon}>
                    ▱
                  </span>
                  <span className={styles.folderName}>{folder.name}</span>
                  <span className={styles.count}>{counts.get(folder.id) ?? 0}</span>
                </button>
                {canEdit ? (
                  <div className={styles.folderActions}>
                    {(["rename", "move", "delete"] as const).map((kind) => (
                      <button
                        aria-label={t(`pages.folders.${kind}Label`, { folder: option.label })}
                        disabled={busy}
                        key={kind}
                        onClick={() => onCommand(kind, folder)}
                        type="button"
                      >
                        {t(`pages.folders.${kind}`)}
                      </button>
                    ))}
                    {(["up", "down"] as const).map((direction) => (
                      <button
                        aria-label={t(`pages.folders.${direction}Label`, { folder: option.label })}
                        disabled={
                          busy || folderSiblingPosition(folders, folder.id, direction) === null
                        }
                        key={direction}
                        onClick={() => onReorder(folder, direction)}
                        type="button"
                      >
                        {t(`pages.folders.${direction}`)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {branch(folder.id)}
            </li>
          );
        })}
      </ul>
    );
  }
  return branch(null);
}
