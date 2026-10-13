import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreateFolderSchema,
  FolderListQuerySchema,
  FolderSchema,
  OrganizeQuizSchema,
  UpdateFolderSchema,
} from "../src/index.js";

describe("scoped folder contracts", () => {
  it("distinguishes folder-only Round moves from explicit tag edits and clearing", () => {
    const folderId = randomUUID();
    expect(OrganizeQuizSchema.parse({ folderId })).toEqual({ folderId });
    expect(OrganizeQuizSchema.parse({ folderId, tags: [] })).toEqual({ folderId, tags: [] });
    expect(
      OrganizeQuizSchema.parse({ folderId, tags: [" Training ", "training", "New   hires"] }),
    ).toEqual({ folderId, tags: ["Training", "New hires"] });
    expect(OrganizeQuizSchema.safeParse({ folderId, tags: [" "] }).success).toBe(false);
  });
  it("keeps untyped creation and listing compatible with Rounds", () => {
    expect(CreateFolderSchema.parse({ name: " Training " })).toEqual({
      name: "Training",
      artifactType: "round",
      parentId: null,
    });
    expect(FolderListQuerySchema.parse({})).toEqual({ artifactType: "round" });
  });
  it("accepts explicit type/nesting and independent rename, move and insertion position", () => {
    const parentId = randomUUID();
    expect(
      CreateFolderSchema.parse({ name: "Feedback", artifactType: "survey", parentId }).parentId,
    ).toBe(parentId);
    for (const input of [
      { name: "Renamed" },
      { parentId },
      { parentId: null },
      { position: 0 },
      { parentId, position: 2 },
    ])
      expect(UpdateFolderSchema.parse(input)).toEqual(input);
    expect(
      FolderSchema.parse({
        id: randomUUID(),
        name: "Feedback",
        artifactType: "presentation",
        parentId,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).artifactType,
    ).toBe("presentation");
  });
  it("rejects empty patches, invalid types and invalid ordering", () => {
    for (const input of [
      {},
      { position: -1 },
      { position: 0.5 },
      { name: " " },
      { parentId: "invalid" },
    ])
      expect(UpdateFolderSchema.safeParse(input).success).toBe(false);
    expect(CreateFolderSchema.safeParse({ name: "Bad", artifactType: "quiz" }).success).toBe(false);
  });
});
