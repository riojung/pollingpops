import {
  FolderError,
  type FolderCreateInput,
  type FolderRecord,
  type FolderUpdateInput,
} from "./types.js";

export function folderOrder(left: FolderRecord, right: FolderRecord) {
  return (
    left.position - right.position ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

function siblings(folders: FolderRecord[], folder: FolderRecord) {
  return folders
    .filter(
      (candidate) =>
        candidate.id !== folder.id &&
        candidate.artifactType === folder.artifactType &&
        candidate.parentId === folder.parentId,
    )
    .sort(folderOrder);
}

function validate(folders: FolderRecord[], folder: FolderRecord) {
  if (folder.parentId) {
    const parent = folders.find((candidate) => candidate.id === folder.parentId);
    if (
      !parent ||
      parent.workspaceId !== folder.workspaceId ||
      parent.artifactType !== folder.artifactType
    )
      throw new FolderError("NOT_FOUND", "Parent folder not found in this content library");
    const seen = new Set([folder.id]);
    let ancestor: FolderRecord | undefined = parent;
    while (ancestor) {
      if (seen.has(ancestor.id))
        throw new FolderError(
          "CONFLICT",
          "A folder cannot be moved into itself or its descendants",
        );
      seen.add(ancestor.id);
      ancestor = folders.find((candidate) => candidate.id === ancestor!.parentId);
    }
  }
  if (
    siblings(folders, folder).some(
      (candidate) => candidate.name.toLowerCase() === folder.name.toLowerCase(),
    )
  )
    throw new FolderError("CONFLICT", "A folder with this name already exists at this location");
}

function compact(
  folders: FolderRecord[],
  artifactType: FolderRecord["artifactType"],
  parentId: string | null,
) {
  folders
    .filter((folder) => folder.artifactType === artifactType && folder.parentId === parentId)
    .sort(folderOrder)
    .forEach((folder, position) => {
      folder.position = position;
    });
}

function insert(folders: FolderRecord[], folder: FolderRecord, position: number) {
  const ordered = siblings(folders, folder);
  ordered.splice(Math.min(position, ordered.length), 0, folder);
  ordered.forEach((candidate, index) => {
    candidate.position = index;
  });
}

export function createFolderState(existing: FolderRecord[], input: FolderCreateInput) {
  const folders = structuredClone(existing);
  if (folders.some((folder) => folder.id === input.id))
    throw new FolderError("CONFLICT", "Folder identifier already exists");
  const folder: FolderRecord = {
    ...input,
    artifactType: input.artifactType ?? "round",
    parentId: input.parentId ?? null,
    position: input.position ?? folders.length,
  };
  validate(folders, folder);
  folders.push(folder);
  insert(folders, folder, input.position ?? siblings(folders, folder).length);
  return { folders, folder };
}

export function updateFolderState(existing: FolderRecord[], id: string, input: FolderUpdateInput) {
  const folders = structuredClone(existing);
  const folder = folders.find((candidate) => candidate.id === id);
  if (!folder) return null;
  const oldParentId = folder.parentId;
  Object.assign(folder, input, { updatedAt: new Date() });
  validate(folders, folder);
  compact(folders, folder.artifactType, oldParentId);
  insert(
    folders,
    folder,
    input.position ??
      (oldParentId === folder.parentId ? folder.position : siblings(folders, folder).length),
  );
  return { folders, folder };
}

export function deleteFolderState(existing: FolderRecord[], id: string) {
  const folders = structuredClone(existing);
  const folder = folders.find((candidate) => candidate.id === id);
  if (!folder) return null;
  const children = folders.filter((candidate) => candidate.parentId === id).sort(folderOrder);
  const retained = folders.filter((candidate) => candidate.id !== id);
  for (const child of children) {
    child.parentId = null;
    child.updatedAt = new Date();
    validate(retained, child);
    insert(retained, child, siblings(retained, child).length);
  }
  compact(retained, folder.artifactType, folder.parentId);
  return retained;
}
