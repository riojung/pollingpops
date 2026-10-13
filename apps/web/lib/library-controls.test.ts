import { describe, expect, it } from "vitest";
import {
  filterLibraryItems,
  libraryBulkActionIds,
  roundBulkActionIds,
  librarySearchHref,
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
