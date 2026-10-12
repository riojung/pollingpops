export type LibraryItemStatus = "draft" | "published" | "archived";
export type LibraryStatusFilter = "active" | LibraryItemStatus | "all";
export type LibraryOwnershipFilter = "all" | "workspace";

/** Keep header searches on the selected content type without forwarding private URL context. */
export function librarySearchHref(query: string, pathname: string, search: string) {
  const requested = new URLSearchParams(search).get("type");
  const type =
    pathname === "/surveys" || pathname.startsWith("/surveys/")
      ? "surveys"
      : pathname === "/library" && (requested === "surveys" || requested === "presentations")
        ? requested
        : null;
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (query.trim()) params.set("q", query.trim());
  return `/library${params.size ? `?${params}` : ""}`;
}

export interface LibraryFilterableItem {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: LibraryItemStatus;
  searchTerms?: readonly string[];
  folderId?: string | null;
  favorite?: boolean;
}

export interface LibraryFilters {
  query: string;
  status: LibraryStatusFilter;
  ownership: LibraryOwnershipFilter;
  workspaceId: string;
  folderId?: string;
  favoritesOnly?: boolean;
}

export function filterLibraryItems<T extends LibraryFilterableItem>(
  items: readonly T[],
  filters: LibraryFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase("en-CA");

  return items.filter((item) => {
    if (
      filters.ownership === "workspace" &&
      filters.workspaceId &&
      item.workspaceId !== filters.workspaceId
    ) {
      return false;
    }

    if (filters.status === "active" && item.status === "archived") return false;
    if (filters.status !== "active" && filters.status !== "all" && item.status !== filters.status) {
      return false;
    }

    if (filters.favoritesOnly && !item.favorite) return false;
    if (filters.folderId === "unfiled" && item.folderId) return false;
    if (
      filters.folderId &&
      filters.folderId !== "all" &&
      filters.folderId !== "unfiled" &&
      item.folderId !== filters.folderId
    ) {
      return false;
    }

    if (!query) return true;
    return [item.title, item.description, ...(item.searchTerms ?? [])].some((value) =>
      value.toLocaleLowerCase("en-CA").includes(query),
    );
  });
}

export function selectedLibraryItems<T extends { id: string }>(
  items: readonly T[],
  selectedIds: ReadonlySet<string>,
) {
  return items.filter((item) => selectedIds.has(item.id));
}

export function roundBulkActionIds<T extends { id: string; status: LibraryItemStatus }>(
  items: readonly T[],
  selectedIds: ReadonlySet<string>,
) {
  const selected = selectedLibraryItems(items, selectedIds);
  return {
    duplicate: selected.map((item) => item.id),
    archive: selected.filter((item) => item.status !== "archived").map((item) => item.id),
    restore: selected.filter((item) => item.status === "archived").map((item) => item.id),
  };
}

export const libraryBulkActionIds = roundBulkActionIds;
