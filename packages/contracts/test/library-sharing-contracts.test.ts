import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LibraryShareCreateSchema,
  LibraryShareSummarySchema,
  LibraryShareListQuerySchema,
  LibraryShareListSchema,
} from "../src/index.js";
describe("published Library sharing contracts", () => {
  const create = () => ({
    requestId: randomUUID(),
    artifactType: "round",
    artifactId: randomUUID(),
    versionId: randomUUID(),
    audience: "people",
    recipientIds: [randomUUID()],
    permission: "view",
    message: "Please read",
    dueAt: null,
  });
  it("requires explicit recipient scope and bounds private message/direct recipients", () => {
    const value = create();
    expect(LibraryShareCreateSchema.parse(value)).toEqual(value);
    expect(LibraryShareCreateSchema.safeParse({ ...value, audience: "organization" }).success).toBe(
      false,
    );
    expect(LibraryShareCreateSchema.safeParse({ ...value, recipientIds: [] }).success).toBe(false);
    expect(
      LibraryShareCreateSchema.safeParse({
        ...value,
        recipientIds: [value.recipientIds[0], value.recipientIds[0]],
      }).success,
    ).toBe(false);
    expect(
      LibraryShareCreateSchema.safeParse({ ...value, message: "x".repeat(1001) }).success,
    ).toBe(false);
    expect(
      LibraryShareCreateSchema.safeParse({
        ...value,
        recipientIds: Array.from({ length: 51 }, () => randomUUID()),
      }).success,
    ).toBe(false);
    expect(
      LibraryShareCreateSchema.safeParse({ ...value, audience: "organization", recipientIds: [] })
        .success,
    ).toBe(true);
    expect(
      LibraryShareCreateSchema.safeParse({ ...value, workspaceId: randomUUID() }).success,
    ).toBe(false);
  });
  it("bounds discovery input and preserves additive facet compatibility", () => {
    expect(LibraryShareListQuerySchema.parse({})).toEqual({
      scope: "organization",
      q: "",
      kind: "all",
      sort: "recent",
      progress: "all",
      permission: "all",
      includeFacets: false,
      limit: 50,
    });
    expect(LibraryShareListQuerySchema.parse({ q: "  literal%_  ", limit: "3" }).q).toBe(
      "literal%_",
    );
    expect(LibraryShareListQuerySchema.parse({ includeFacets: "true" }).includeFacets).toBe(true);
    expect(LibraryShareListQuerySchema.parse({ includeFacets: "false" }).includeFacets).toBe(false);
    for (const input of [
      { includeFacets: "1" },
      { includeFacets: "TRUE" },
      { includeFacets: "" },
      { includeFacets: true },
      { q: "x".repeat(161) },
      { q: "invalid\0text" },
      { kind: "board" },
      { progress: "started" },
      { permission: "edit" },
      { sort: "title" },
      { limit: 101 },
      { arbitrary: true },
    ])
      expect(LibraryShareListQuerySchema.safeParse(input).success).toBe(false);
    expect(LibraryShareListSchema.safeParse({ shares: [], nextCursor: null }).success).toBe(true);
    expect(
      LibraryShareListSchema.safeParse({
        shares: [],
        nextCursor: null,
        facets: {
          kinds: { round: 0, presentation: 0, survey: 0 },
          progress: { new: 0, in_progress: 0, done: 0 },
          permissions: { view: 0, use: 0 },
          total: 0,
        },
      }).success,
    ).toBe(true);
    expect(
      LibraryShareListSchema.safeParse({ shares: [], nextCursor: null, facets: { total: -1 } })
        .success,
    ).toBe(false);
  });
  it("does not accept private snapshot bodies in metadata summaries", () => {
    const value = {
      id: randomUUID(),
      organizationId: randomUUID(),
      organizationName: "Company",
      sourceWorkspaceId: randomUUID(),
      sourceWorkspaceName: "Team",
      artifactType: "round",
      artifactId: randomUUID(),
      versionId: randomUUID(),
      title: "Title",
      description: "",
      sharedAt: new Date().toISOString(),
      permission: "view",
      audience: "organization",
      message: "",
      dueAt: null,
      progress: "new",
      capabilities: { view: true, copy: false, manage: false },
    };
    expect(LibraryShareSummarySchema.safeParse(value).success).toBe(true);
    expect(
      LibraryShareSummarySchema.safeParse({ ...value, snapshot: { correctValue: "secret" } })
        .success,
    ).toBe(false);
  });
});
