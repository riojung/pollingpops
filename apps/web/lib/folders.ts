import type { Folder, FolderArtifactType } from "@openround/contracts";

export type LibraryType = "rounds" | "presentations" | "surveys";
export type FolderRecord = Pick<Folder, "id" | "name" | "artifactType" | "parentId" | "position">;
export interface FolderOption {
  id: string;
  name: string;
  label: string;
  depth: number;
}

export function folderArtifactType(type: LibraryType): FolderArtifactType {
  return type === "presentations" ? "presentation" : type === "surveys" ? "survey" : "round";
}

function compareFolders(a: FolderRecord, b: FolderRecord) {
  return a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Full paths distinguish identically named folders in different branches. */
export function folderPathLabel(
  folders: readonly FolderRecord[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(id);
  if (!current) return null;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(" / ");
}

/** Ordered preorder traversal, with a defensive fallback for incomplete cached trees. */
export function getFolderOptions(folders: readonly FolderRecord[]): FolderOption[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const children = new Map<string | null, FolderRecord[]>();
  for (const folder of folders) {
    const parentId = folder.parentId && byId.has(folder.parentId) ? folder.parentId : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(folder);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareFolders);
  const options: FolderOption[] = [];
  const visited = new Set<string>();
  function visit(folder: FolderRecord, depth: number, prefix: string) {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    const label = prefix ? `${prefix} / ${folder.name}` : folder.name;
    options.push({ id: folder.id, name: folder.name, label, depth });
    for (const child of children.get(folder.id) ?? []) visit(child, depth + 1, label);
  }
  for (const folder of children.get(null) ?? []) visit(folder, 0, "");
  for (const folder of [...folders].sort(compareFolders)) {
    if (!visited.has(folder.id)) visit(folder, 0, "");
  }
  return options;
}

export function getFolderMoveOptions(folders: readonly FolderRecord[], folderId: string) {
  const excluded = new Set([folderId]);
  let previousSize = -1;
  while (excluded.size !== previousSize) {
    previousSize = excluded.size;
    for (const folder of folders) {
      if (folder.parentId && excluded.has(folder.parentId)) excluded.add(folder.id);
    }
  }
  return getFolderOptions(folders).filter((folder) => !excluded.has(folder.id));
}

export function folderSiblingPosition(
  folders: readonly FolderRecord[],
  id: string,
  direction: "up" | "down",
): number | null {
  const folder = folders.find((entry) => entry.id === id);
  if (!folder) return null;
  const siblings = folders
    .filter(
      (entry) => entry.parentId === folder.parentId && entry.artifactType === folder.artifactType,
    )
    .sort(compareFolders);
  const index = siblings.findIndex((entry) => entry.id === id);
  const nextIndex = index + (direction === "up" ? -1 : 1);
  return nextIndex >= 0 && nextIndex < siblings.length ? nextIndex : null;
}
