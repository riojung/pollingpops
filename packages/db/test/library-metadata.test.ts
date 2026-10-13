import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLibraryMetadataRepository,
  createPresentationRepository,
  MemoryRepository,
} from "../src/index.js";

async function createOwner(repository: MemoryRepository, email: string) {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email,
    segment: "workplace",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const owner = await repository.consumeMagicToken(tokenHash, now);
  if (!owner) throw new Error("Expected owner context");
  return { owner, now };
}

describe("Library metadata", () => {
  it("keeps favorites durable and private to each workspace member", async () => {
    const repository = new MemoryRepository();
    const metadata = createLibraryMetadataRepository(repository);
    expect(createLibraryMetadataRepository(repository)).toBe(metadata);
    const { owner, now } = await createOwner(repository, "favorite-owner@example.com");
    const otherUserId = randomUUID();
    const roundId = randomUUID();
    await repository.createQuiz({
      id: roundId,
      workspaceId: owner.workspaceId,
      title: "Favorite Round",
      description: "",
      status: "draft",
      draft: { title: "Favorite Round", description: "", questions: [] },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });

    await metadata.setFavorite({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      artifactType: "round",
      artifactId: roundId,
      favorite: true,
      now,
    });
    await metadata.setFavorite({
      workspaceId: owner.workspaceId,
      userId: otherUserId,
      artifactType: "round",
      artifactId: roundId,
      favorite: true,
      now,
    });

    await expect(metadata.listFavorites(owner.workspaceId, owner.userId)).resolves.toMatchObject([
      { artifactType: "round", artifactId: roundId, userId: owner.userId },
    ]);
    await expect(metadata.listFavorites(owner.workspaceId, randomUUID())).resolves.toEqual([]);

    const exported = await repository.exportAccount(owner.userId);
    expect(exported.libraryFavorites).toMatchObject([
      { artifactType: "round", artifactId: roundId, userId: owner.userId },
    ]);

    await metadata.setFavorite({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      artifactType: "round",
      artifactId: roundId,
      favorite: false,
      now,
    });
    await expect(metadata.listFavorites(owner.workspaceId, owner.userId)).resolves.toEqual([]);
  });

  it("organizes Presentations in workspace folders and restores their prior publish state", async () => {
    const repository = new MemoryRepository();
    const presentations = createPresentationRepository(repository);
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const now = new Date("2026-09-20T12:00:00.000Z");
    const folderId = randomUUID();
    const foreignFolderId = randomUUID();
    await repository.createFolder({
      id: folderId,
      workspaceId,
      name: "Executive briefings",
      artifactType: "presentation",
      createdAt: now,
      updatedAt: now,
    });
    await repository.createFolder({
      id: foreignFolderId,
      workspaceId: otherWorkspaceId,
      name: "Foreign folder",
      artifactType: "presentation",
      createdAt: now,
      updatedAt: now,
    });
    const presentationId = randomUUID();
    await presentations.createPresentation({
      id: presentationId,
      workspaceId,
      title: "Operations review",
      description: "",
      status: "draft",
      draft: {
        title: "Operations review",
        description: "",
        experiencePreset: { id: "focus", version: 1 },
        schemaVersion: 2,
        blocks: [],
      },
      draftRevision: 0,
      draftSchemaVersion: 1,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      presentations.organizePresentation(workspaceId, presentationId, foreignFolderId),
    ).resolves.toBeNull();
    await expect(
      presentations.organizePresentation(workspaceId, presentationId, folderId),
    ).resolves.toMatchObject({ folderId });
    await repository.deleteFolder(workspaceId, folderId);
    await expect(presentations.getPresentation(workspaceId, presentationId)).resolves.toMatchObject(
      { folderId: null },
    );
    await expect(
      presentations.archivePresentation(workspaceId, presentationId, true),
    ).resolves.toMatchObject({ status: "archived" });
    await expect(
      presentations.archivePresentation(workspaceId, presentationId, false),
    ).resolves.toMatchObject({ status: "draft" });
  });
});
