import {
  LibraryItemsResponseSchema,
  LibraryShareListSchema,
  type LibraryItemsResponse,
  type LibraryShareSummary,
  type LibraryShareListFacets,
} from "@openround/contracts";
import { apiFetch } from "../../../lib/api";
import {
  libraryDateRangeBounds,
  libraryDiscoveryParams,
  type LibraryDiscoveryQuery,
} from "../../../lib/library-controls";
import type { LibraryScope } from "../library-sharing/client";

export type WorkspaceLibraryItem = LibraryItemsResponse["items"][number];
export type DiscoveryItem = WorkspaceLibraryItem | LibraryShareSummary;
export interface DiscoveryPage {
  items: DiscoveryItem[];
  nextCursor: string | null;
  facets?: LibraryItemsResponse["facets"] | LibraryShareListFacets;
}

export async function readLibraryDiscovery(
  scope: LibraryScope,
  query: LibraryDiscoveryQuery,
  cursor: string | null,
  signal: AbortSignal,
): Promise<DiscoveryPage> {
  const shared = scope !== "workspace";
  const params = libraryDiscoveryParams(query, shared);
  const bounds = libraryDateRangeBounds(query);
  params.delete("dateFrom");
  params.delete("dateTo");
  if (bounds.from) params.set("from", bounds.from.toISOString());
  if (bounds.to) params.set("to", bounds.to.toISOString());
  params.set("limit", "30");
  if (cursor) params.set("cursor", cursor);
  if (shared) {
    params.set("scope", scope);
    params.set("includeFacets", "true");
    const result = LibraryShareListSchema.parse(
      await apiFetch(`/v1/library/shares?${params}`, { signal, cache: "no-store" }),
    );
    return { items: result.shares, nextCursor: result.nextCursor, facets: result.facets };
  }
  const result = LibraryItemsResponseSchema.parse(
    await apiFetch(`/v1/library/items?${params}`, { signal, cache: "no-store" }),
  );
  return result;
}

export function discoveryItemKey(item: DiscoveryItem) {
  return "capabilities" in item ? item.id : `${item.artifactType}:${item.id}`;
}

export interface DiscoverySnapshot extends DiscoveryPage {
  key: string;
  phase: "loading" | "ready" | "error" | "more" | "page-error";
}
export const emptyDiscoverySnapshot: DiscoverySnapshot = {
  key: "",
  items: [],
  nextCursor: null,
  phase: "loading",
};
type Loader = (cursor: string | null, signal: AbortSignal) => Promise<DiscoveryPage>;

/** One active query and one request at a time, including stale event callbacks. */
export class LibraryDiscoveryPager {
  private generation = 0;
  private controller: AbortController | null = null;
  private loader: Loader | null = null;
  private inFlight = false;
  private snapshot = emptyDiscoverySnapshot;
  constructor(private readonly publish: (snapshot: DiscoverySnapshot) => void) {}

  clear() {
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
    this.loader = null;
    this.inFlight = false;
    this.set(emptyDiscoverySnapshot);
  }

  start(key: string, loader: Loader) {
    this.clear();
    this.loader = loader;
    this.controller = new AbortController();
    this.set({ ...emptyDiscoverySnapshot, key });
    void this.request(null);
  }

  refresh(key: string) {
    if (this.snapshot.key !== key || !this.loader) return;
    this.start(key, this.loader);
  }

  more(key: string, cursor: string | null) {
    if (this.snapshot.key !== key || !cursor || cursor !== this.snapshot.nextCursor) return;
    if (this.snapshot.phase !== "ready" && this.snapshot.phase !== "page-error") return;
    void this.request(cursor);
  }

  private set(snapshot: DiscoverySnapshot) {
    this.snapshot = snapshot;
    this.publish(snapshot);
  }

  private async request(cursor: string | null) {
    const loader = this.loader;
    const active = this.controller;
    if (this.inFlight || !loader || !active || active.signal.aborted) return;
    this.inFlight = true;
    const generation = this.generation;
    const key = this.snapshot.key;
    this.set({ ...this.snapshot, phase: cursor ? "more" : "loading" });
    try {
      const page = await loader(cursor, active.signal);
      if (generation !== this.generation || active.signal.aborted) return;
      const items = [
        ...new Map(
          [...(cursor ? this.snapshot.items : []), ...page.items].map((item) => [
            discoveryItemKey(item),
            item,
          ]),
        ).values(),
      ];
      this.set({ ...page, key, items, phase: "ready" });
    } catch (error) {
      if (generation !== this.generation || active.signal.aborted) return;
      const status = (error as { status?: number }).status;
      if (cursor && (status === 401 || status === 403 || status === 404)) {
        // Revalidate the whole authorized collection after an access failure.
        this.start(key, loader);
        return;
      }
      this.set({ ...this.snapshot, phase: cursor ? "page-error" : "error" });
    } finally {
      if (generation === this.generation) this.inFlight = false;
    }
  }
}
