import { describe, expect, it } from "vitest";
import {
  filterLibraryItems,
  libraryBulkActionIds,
  roundBulkActionIds,
  librarySearchHref,
  readLibraryDiscoveryQuery,
  libraryDiscoveryHref,
} from "./library-controls";

const items = [
  {
    id: "round-1",
    workspaceId: "workspace-a",
    title: "Incident response",
    description: "A live readiness check",
    status: "published" as const,
    searchTerms: ["safety", "onboarding"],
    folderId: "folder-a",
    favorite: true,
  },
  {
    id: "round-2",
    workspaceId: "workspace-a",
    title: "Recovery check",
    description: "Follow-up practice",
    status: "draft" as const,
    folderId: null,
    favorite: false,
  },
  {
    id: "round-3",
    workspaceId: "workspace-b",
    title: "Archived handbook",
    description: "Historical material",
    status: "archived" as const,
  },
];

describe("Library controls", () => {
  it("keeps Discovery header searches in the selected category and explicit management in its own view", () => {
    expect(librarySearchHref("readiness", "/library", "")).toBe("/library?q=readiness");
    expect(
      librarySearchHref("readiness", "/library", "?kind=survey&status=draft&cursor=private"),
    ).toBe("/library?kind=survey&q=readiness");
    expect(librarySearchHref("readiness", "/library", "?type=rounds&kind=survey")).toBe(
      "/library?type=rounds&q=readiness",
    );
    expect(librarySearchHref("readiness", "/library", "?kind=unknown")).toBe(
      "/library?q=readiness",
    );
  });
  it("roundtrips authoritative discovery filters without carrying cursors or access tokens", () => {
    const params = new URLSearchParams(
      "q=%20north%20&kind=survey&status=published&sort=title_desc&favorites=true&folder=unfiled&cursor=private&token=secret",
    );
    const query = readLibraryDiscoveryQuery(params);
    const href = libraryDiscoveryHref(query);
    expect(href).toBe(
      "/library?q=north&kind=survey&sort=title_desc&status=published&favorites=true&folder=unfiled",
    );
    expect(readLibraryDiscoveryQuery(new URLSearchParams(href.split("?")[1]))).toEqual(query);
    expect(libraryDiscoveryHref(query, "shared", "rounds")).toBe(
      "/library?q=north&sort=title_desc&scope=shared&type=rounds",
    );
  });
  it("bounds search and canonicalizes invalid discovery controls", () => {
    const query = readLibraryDiscoveryQuery(
      new URLSearchParams(
        `q=${"x".repeat(200)}&kind=boards&status=secret&sort=random&folder=private&permission=admin&progress=bad&organizationId=bad`,
      ),
    );
    expect(query.q).toHaveLength(160);
    expect(query).toMatchObject({
      kind: "all",
      status: "active",
      sort: "recent",
      folder: "all",
      permission: "all",
      progress: "all",
      organizationId: "",
    });
  });
  it("keeps board searches on their own library without forwarding creation or access context", () => {
    expect(librarySearchHref("  project & retro  ", "/boards", "?create=1&token=private")).toBe(
      "/boards?q=project+%26+retro",
    );
    expect(librarySearchHref("", "/canvas/board-id", "?token=private")).toBe("/boards");
    expect(
      new URL(
        librarySearchHref("a".repeat(200), "/boards", ""),
        "https://example.test",
      ).searchParams.get("q"),
    ).toHaveLength(160);
  });
  it("keeps header searches on Surveys or the selected Library type without copying private queries", () => {
    expect(librarySearchHref("  feedback  ", "/library", "?type=surveys&token=secret")).toBe(
      "/library?type=surveys&q=feedback",
    );
    expect(librarySearchHref("", "/surveys/survey-id", "?token=secret")).toBe(
      "/library?type=surveys",
    );
    expect(librarySearchHref("x & y", "/library", "?type=presentations")).toBe(
      "/library?type=presentations&q=x+%26+y",
    );
    expect(librarySearchHref("", "/home", "?type=unknown")).toBe("/library");
  });
  it("preserves the shared Library surface without forwarding private or unrelated context", () => {
    expect(
      librarySearchHref(
        " workshop ",
        "/library",
        "?scope=shared&kind=presentation&permission=use&organizationId=private",
      ),
    ).toBe("/library?kind=presentation&scope=shared&q=workshop");
    expect(
      librarySearchHref(
        " workshop ",
        "/library",
        "?scope=shared&type=presentations&token=private&folder=hidden",
      ),
    ).toBe("/library?type=presentations&scope=shared&q=workshop");
    expect(librarySearchHref("", "/library", "?scope=organization&type=surveys")).toBe(
      "/library?type=surveys&scope=organization",
    );
    expect(librarySearchHref("", "/library", "?scope=managed")).toBe("/library?scope=managed");
    expect(librarySearchHref("x", "/library", "?scope=unknown&organizationId=private")).toBe(
      "/library?q=x",
    );
    expect(librarySearchHref("", "/sessions", "?scope=shared&type=presentations")).toBe(
      "/sessions?type=presentations",
    );
    expect(librarySearchHref("", "/home", "?scope=shared")).toBe("/library");
  });
  it("searches the selected Sessions type without forwarding control credentials or stale filters", () => {
    expect(
      librarySearchHref("  workshop  ", "/sessions", "?type=surveys&source=old&token=secret"),
    ).toBe("/sessions?type=surveys&q=workshop");
    expect(librarySearchHref("room 123", "/sessions", "?type=presentations&status=active")).toBe(
      "/sessions?type=presentations&q=room+123",
    );
    expect(librarySearchHref("", "/sessions", "?type=rounds")).toBe("/sessions");
    expect(librarySearchHref("ready", "/sessions", "?type=unknown")).toBe("/sessions?q=ready");
  });
  it("searches titles, descriptions, and supplied metadata without showing archives by default", () => {
    expect(
      filterLibraryItems(items, {
        query: "SAFETY",
        status: "active",
        ownership: "all",
        workspaceId: "workspace-a",
      }).map((item) => item.id),
    ).toEqual(["round-1"]);

    expect(
      filterLibraryItems(items, {
        query: "",
        status: "active",
        ownership: "all",
        workspaceId: "workspace-a",
      }).map((item) => item.id),
    ).toEqual(["round-1", "round-2"]);
  });

  it("combines status and workspace ownership filters", () => {
    expect(
      filterLibraryItems(items, {
        query: "",
        status: "archived",
        ownership: "workspace",
        workspaceId: "workspace-a",
      }),
    ).toEqual([]);

    expect(
      filterLibraryItems(items, {
        query: "",
        status: "archived",
        ownership: "workspace",
        workspaceId: "workspace-b",
      }).map((item) => item.id),
    ).toEqual(["round-3"]);
  });

  it("derives safe bulk targets from the selected Round statuses", () => {
    expect(roundBulkActionIds(items, new Set(["round-1", "round-3", "missing"]))).toEqual({
      duplicate: ["round-1", "round-3"],
      archive: ["round-1"],
      restore: ["round-3"],
    });
  });

  it("filters shared artifact metadata by folder and personal favorite state", () => {
    expect(
      filterLibraryItems(items, {
        query: "",
        status: "all",
        ownership: "all",
        workspaceId: "workspace-a",
        folderId: "folder-a",
      }).map((item) => item.id),
    ).toEqual(["round-1"]);
    expect(
      filterLibraryItems(items, {
        query: "",
        status: "all",
        ownership: "all",
        workspaceId: "workspace-a",
        folderId: "unfiled",
      }).map((item) => item.id),
    ).toEqual(["round-2", "round-3"]);
    expect(
      filterLibraryItems(items, {
        query: "",
        status: "all",
        ownership: "all",
        workspaceId: "workspace-a",
        favoritesOnly: true,
      }).map((item) => item.id),
    ).toEqual(["round-1"]);
    expect(libraryBulkActionIds(items, new Set(["round-1"]))).toEqual(
      roundBulkActionIds(items, new Set(["round-1"])),
    );
  });
});
