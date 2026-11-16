import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LibraryShareCreateSchema, LibraryShareSummarySchema } from "../src/index.js";
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
