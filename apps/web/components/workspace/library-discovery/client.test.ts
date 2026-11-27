import { beforeEach, describe, expect, it, vi } from "vitest";
import { readLibraryDiscoveryQuery } from "../../../lib/library-controls";
import {
  LibraryDiscoveryPager,
  readLibraryDiscovery,
  type DiscoveryPage,
  type DiscoverySnapshot,
  type WorkspaceLibraryItem,
} from "./client";

const mocked = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../../lib/api", () => ({ apiFetch: mocked.fetch }));
const id = "00000000-0000-4000-8000-000000000001";
function item(
  artifactType: WorkspaceLibraryItem["artifactType"] = "round",
  title = "Readiness",
): WorkspaceLibraryItem {
  return {
    id,
    artifactType,
    title,
    description: "",
    status: "draft",
    updatedAt: "2026-11-17T12:00:00.000Z",
    folderId: null,
    favorite: false,
    currentVersionId: null,
    itemCount: 3,
  };
}
const facets = {
  kinds: { round: 80, presentation: 40, survey: 20 },
  statuses: { draft: 100, published: 40, archived: 0 },
  total: 140,
};
function page(items = [item()], nextCursor: string | null = null): DiscoveryPage {
  return { items, nextCursor, facets };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}
beforeEach(() => mocked.fetch.mockReset());

describe("metadata Library client", () => {
  it("requests one bounded server query and rejects eager private snapshots", async () => {
    const query = readLibraryDiscoveryQuery(
      new URLSearchParams(
        "q= readiness &kind=survey&status=published&sort=title_desc&favorites=true&folder=unfiled&dateFrom=2026-03-08&dateTo=2026-03-08",
      ),
    );
    mocked.fetch.mockResolvedValue(page());
    const active = new AbortController();
    await readLibraryDiscovery("workspace", query, "next-page", active.signal);
    const [url, options] = mocked.fetch.mock.calls[0]!;
    const params = new URL(url, "https://example.test").searchParams;
    expect(params.get("q")).toBe("readiness");
    expect(params.get("kind")).toBe("survey");
    expect(params.get("status")).toBe("published");
    expect(params.get("sort")).toBe("title_desc");
    expect(params.get("favorites")).toBe("true");
    expect(params.get("folder")).toBe("unfiled");
    expect(params.get("from")).toBe(new Date("2026-03-08T00:00:00").toISOString());
    expect(params.get("to")).toBe(new Date("2026-03-08T23:59:59.999").toISOString());
    expect(params.has("dateFrom")).toBe(false);
    expect(params.has("dateTo")).toBe(false);
    expect(params.get("limit")).toBe("30");
    expect(params.get("cursor")).toBe("next-page");
    expect(options).toEqual({ signal: active.signal, cache: "no-store" });
    mocked.fetch.mockResolvedValue({
      ...page(),
      items: [{ ...item(), draft: { answers: ["private"] } }],
    });
    await expect(readLibraryDiscovery("workspace", query, null, active.signal)).rejects.toThrow();
    expect(mocked.fetch).toHaveBeenCalledTimes(2);
  });

  it("forwards shared search and authority filters without workspace status/folder filters", async () => {
    mocked.fetch.mockResolvedValue({ shares: [], nextCursor: null });
    const query = readLibraryDiscoveryQuery(
      new URLSearchParams(
        `q=team&kind=presentation&sort=title_asc&progress=done&permission=view&organizationId=${id}&favorites=true&status=draft&dateTo=2026-10-01`,
      ),
    );
    await readLibraryDiscovery("organization", query, null, new AbortController().signal);
    const params = new URL(mocked.fetch.mock.calls[0]![0], "https://example.test").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      q: "team",
      kind: "presentation",
      sort: "title_asc",
      progress: "done",
      permission: "view",
      organizationId: id,
      to: new Date("2026-10-01T23:59:59.999").toISOString(),
      limit: "30",
      scope: "organization",
      includeFacets: "true",
    });
  });
});

describe("Library pagination authority", () => {
  it("retains rows, totals and failed cursor for one retry, deduplicating by kind plus id", async () => {
    let snapshot!: DiscoverySnapshot;
    const pager = new LibraryDiscoveryPager((next) => (snapshot = next));
    const pending = deferred<DiscoveryPage>();
    const loader = vi
      .fn()
      .mockResolvedValueOnce(page([item()], "next"))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page([item("round", "Fresh"), item("survey")], null));
    pager.start("query", loader);
    await settle();
    expect(snapshot.facets?.total).toBe(140);
    pager.more("query", "next");
    pager.more("query", "next");
    expect(loader).toHaveBeenCalledTimes(2);
    pending.reject(new TypeError("offline"));
    await settle();
    expect(snapshot.phase).toBe("page-error");
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.nextCursor).toBe("next");
    pager.more("query", "next");
    await settle();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.items.map((row) => row.artifactType)).toEqual(["round", "survey"]);
    expect(snapshot.items[0]?.title).toBe("Fresh");
    expect(loader.mock.calls.map(([cursor]) => cursor)).toEqual([null, "next", "next"]);
  });

  it.each(["success", "error"])(
    "aborts old pages, ignores late %s and rejects stale callbacks after query changes",
    async (outcome) => {
      let snapshot!: DiscoverySnapshot;
      const pager = new LibraryDiscoveryPager((next) => (snapshot = next));
      const late = deferred<DiscoveryPage>();
      const first = vi
        .fn()
        .mockResolvedValueOnce(page([item()], "old-cursor"))
        .mockReturnValueOnce(late.promise);
      pager.start("actor-a/workspace-a/q-a", first);
      await settle();
      pager.more("actor-a/workspace-a/q-a", "old-cursor");
      const oldSignal = first.mock.calls[1]![1] as AbortSignal;
      const second = vi.fn().mockResolvedValue(page([item("survey", "Other workspace")], null));
      pager.start("actor-b/workspace-b/q-b", second);
      expect(oldSignal.aborted).toBe(true);
      expect(snapshot.items).toEqual([]);
      pager.more("actor-a/workspace-a/q-a", "old-cursor");
      pager.refresh("actor-a/workspace-a/q-a");
      if (outcome === "success")
        late.resolve(page([item("round", "Private old content")], "leaked"));
      else late.reject(new TypeError("late offline"));
      await settle();
      expect(snapshot.items.map((row) => row.title)).toEqual(["Other workspace"]);
      expect(snapshot.nextCursor).toBeNull();
      expect(first).toHaveBeenCalledTimes(2);
      expect(second).toHaveBeenCalledTimes(1);
      pager.clear();
      expect(snapshot.items).toEqual([]);
      expect(snapshot.facets).toBeUndefined();
    },
  );

  it.each([401, 403, 404])(
    "refreshes authoritative rows after page access failure %i",
    async (status) => {
      let snapshot!: DiscoverySnapshot;
      const pager = new LibraryDiscoveryPager((next) => (snapshot = next));
      const refreshed = deferred<DiscoveryPage>();
      const loader = vi
        .fn()
        .mockResolvedValueOnce(page([item()], "old"))
        .mockRejectedValueOnce({ status })
        .mockReturnValueOnce(refreshed.promise);
      pager.start("query", loader);
      await settle();
      pager.more("query", "old");
      await settle();
      expect(snapshot.items).toEqual([]);
      expect(snapshot.facets).toBeUndefined();
      expect(loader.mock.calls.map(([cursor]) => cursor)).toEqual([null, "old", null]);
      refreshed.resolve(page([], null));
      await settle();
      expect(snapshot.phase).toBe("ready");
    },
  );

  it("distinguishes initial error and fresh retry without retaining prior rows", async () => {
    let snapshot!: DiscoverySnapshot;
    const pager = new LibraryDiscoveryPager((next) => (snapshot = next));
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(page());
    pager.start("query", loader);
    await settle();
    expect(snapshot.phase).toBe("error");
    expect(snapshot.items).toEqual([]);
    pager.refresh("query");
    await settle();
    expect(snapshot.phase).toBe("ready");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
