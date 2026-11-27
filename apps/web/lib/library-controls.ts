export type LibraryItemStatus = "draft" | "published" | "archived";
export type LibraryStatusFilter = "active" | LibraryItemStatus | "all";
export type LibraryOwnershipFilter = "all" | "workspace";

/** Keep header searches on the current content surface without forwarding private URL context. */
export function librarySearchHref(query: string, pathname: string, search: string) {
  if (
    pathname === "/boards" ||
    pathname.startsWith("/boards/") ||
    pathname.startsWith("/canvas/")
  ) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim().normalize("NFC").slice(0, 160));
    return `/boards${params.size ? `?${params}` : ""}`;
  }
  const current = new URLSearchParams(search);
  const requested = current.get("type");
  const sessions = pathname === "/sessions";
  const type =
    pathname === "/surveys" || pathname.startsWith("/surveys/")
      ? "surveys"
      : (pathname === "/library" || sessions) &&
          (requested === "surveys" ||
            requested === "presentations" ||
            (pathname === "/library" && requested === "rounds"))
        ? requested
        : null;
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  else if (pathname === "/library") {
    const kind = option(current.get("kind"), discoveryKinds, "all");
    if (kind !== "all") params.set("kind", kind);
  }
  const scope = current.get("scope");
  if (
    pathname === "/library" &&
    (scope === "organization" || scope === "shared" || scope === "managed")
  )
    params.set("scope", scope);
  if (query.trim()) params.set("q", query.trim().slice(0, 160));
  return `${sessions ? "/sessions" : "/library"}${params.size ? `?${params}` : ""}`;
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

const discoveryKinds = ["all", "round", "presentation", "survey"] as const;
export type LibraryDiscoveryKind = (typeof discoveryKinds)[number];
export type LibraryDiscoverySort = "recent" | "title_asc" | "title_desc";
export interface LibraryDiscoveryQuery {
  q: string;
  kind: LibraryDiscoveryKind;
  status: LibraryStatusFilter;
  sort: LibraryDiscoverySort;
  favorites: boolean;
  folder: string;
  progress: "all" | "new" | "in_progress" | "done";
  permission: "all" | "view" | "use";
  organizationId: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function option<T extends string>(value: string | null, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

/** URL state is authoritative; cursors belong to one loaded query, never browser history. */
export function readLibraryDiscoveryQuery(
  params: Pick<URLSearchParams, "get">,
): LibraryDiscoveryQuery {
  const type = params.get("type");
  const folder = params.get("folder");
  const organization = params.get("organizationId");
  return {
    q: (params.get("q") ?? "").trim().slice(0, 160),
    kind:
      type === "rounds"
        ? "round"
        : type === "presentations"
          ? "presentation"
          : type === "surveys"
            ? "survey"
            : option(params.get("kind"), discoveryKinds, "all"),
    status: option(
      params.get("status"),
      ["active", "draft", "published", "archived", "all"],
      "active",
    ),
    sort: option(params.get("sort"), ["recent", "title_asc", "title_desc"], "recent"),
    favorites: params.get("favorites") === "true",
    folder: folder === "unfiled" || (folder && uuid.test(folder)) ? folder : "all",
    progress: option(params.get("progress"), ["all", "new", "in_progress", "done"], "all"),
    permission: option(params.get("permission"), ["all", "view", "use"], "all"),
    organizationId: organization && uuid.test(organization) ? organization : "",
  };
}

export function libraryDiscoveryParams(query: LibraryDiscoveryQuery, shared = false) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.kind !== "all") params.set("kind", query.kind);
  if (query.sort !== "recent") params.set("sort", query.sort);
  if (shared) {
    if (query.progress !== "all") params.set("progress", query.progress);
    if (query.permission !== "all") params.set("permission", query.permission);
    if (query.organizationId) params.set("organizationId", query.organizationId);
  } else {
    if (query.status !== "active") params.set("status", query.status);
    if (query.favorites) params.set("favorites", "true");
    if (query.folder !== "all") params.set("folder", query.folder);
  }
  return params;
}

export function libraryDiscoveryHref(
  query: LibraryDiscoveryQuery,
  scope = "workspace",
  type = "all",
) {
  const params = libraryDiscoveryParams(query, scope !== "workspace");
  if (scope !== "workspace") params.set("scope", scope);
  if (["rounds", "presentations", "surveys"].includes(type)) {
    params.set("type", type);
    params.delete("kind");
  }
  return `/library${params.size ? `?${params}` : ""}`;
}
