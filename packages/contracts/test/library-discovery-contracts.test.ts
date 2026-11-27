import { describe, expect, it } from "vitest";
import {
  LibraryFilterDateSchema,
  LibraryItemsQuerySchema,
  LibraryItemSummarySchema,
} from "../src/library-discovery";

describe("Library discovery contracts", () => {
  it("normalizes bounded HTTP filters and parses false literally", () => {
    expect(LibraryItemsQuerySchema.parse({})).toEqual({
      q: "",
      kind: "all",
      status: "active",
      sort: "recent",
      folder: "all",
      limit: 30,
    });
    expect(
      LibraryItemsQuerySchema.parse({ q: "  100%_  ", favorites: "false", limit: "100" }),
    ).toMatchObject({ q: "100%_", favorites: false, limit: 100 });
    expect(LibraryItemsQuerySchema.parse({ favorites: "true" }).favorites).toBe(true);
    for (const invalid of [
      { limit: 0 },
      { limit: 101 },
      { q: "a".repeat(161) },
      { favorites: "0" },
      { folder: "elsewhere" },
      { cursor: "a=" },
      { cursor: "a".repeat(4097) },
      { workspaceId: "other" },
    ]) {
      expect(LibraryItemsQuerySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("validates calendar dates and canonicalizes inclusive timestamp bounds", () => {
    expect(LibraryFilterDateSchema.parse("2024-02-29")).toBe("2024-02-29");
    for (const date of ["2026-02-29", "2026-11-1", "0000-01-01"])
      expect(LibraryFilterDateSchema.safeParse(date).success).toBe(false);
    expect(
      LibraryItemsQuerySchema.parse({
        from: "2024-02-29T00:00:00Z",
        to: "2024-02-29T00:00:00.0Z",
      }),
    ).toMatchObject({
      from: "2024-02-29T00:00:00.000Z",
      to: "2024-02-29T00:00:00.000Z",
    });
    expect(LibraryItemsQuerySchema.safeParse({ from: "2024-02-29T00:00:00.0001Z" }).success).toBe(
      false,
    );
  });

  it("rejects content and private draft fields in metadata summaries", () => {
    const item = {
      id: "10000000-0000-4000-8000-000000000001",
      artifactType: "round",
      title: "Title",
      description: "Description",
      status: "draft",
      updatedAt: "2026-11-17T12:00:00.000Z",
      folderId: null,
      favorite: false,
      currentVersionId: null,
      itemCount: 1,
    };
    expect(LibraryItemSummarySchema.safeParse(item).success).toBe(true);
    expect(LibraryItemSummarySchema.safeParse({ ...item, draft: {} }).success).toBe(false);
    expect(LibraryItemSummarySchema.safeParse({ ...item, previewBlock: {} }).success).toBe(false);
  });
});
