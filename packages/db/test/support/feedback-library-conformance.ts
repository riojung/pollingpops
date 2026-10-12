import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  createFeedbackRepository,
  createLibraryMetadataRepository,
  createSurveyRepository,
  type CreatorContext,
  type Repository,
} from "../../src/index.js";
import { surveyFixture } from "./survey-conformance.js";

export async function expectSurveyLibraryConformance(
  repository: Repository,
  actor: CreatorContext,
) {
  const surveys = createSurveyRepository(repository);
  const favorites = createLibraryMetadataRepository(repository);
  const id = randomUUID();
  const folderId = randomUUID();
  const now = new Date();
  await repository.createFolder({
    id: folderId,
    workspaceId: actor.workspaceId,
    name: "Survey feedback",
    createdAt: now,
    updatedAt: now,
  });
  const created = await surveys.create(actor.workspaceId, id, surveyFixture(), randomUUID());
  expect(created.folderId).toBeNull();
  expect(created.updatedAt).toBeTruthy();
  await surveys.publish(actor.workspaceId, id, 0, randomUUID(), null);
  const key = randomUUID();
  const moved = await surveys.organize(actor.workspaceId, id, folderId, 0, key);
  expect(moved).toMatchObject({ folderId, revision: 1, publishedRevision: 1 });
  expect(await surveys.organize(actor.workspaceId, id, folderId, 0, key)).toEqual(moved);
  expect(await surveys.get(actor.workspaceId, id)).toEqual(moved);
  await expect(
    surveys.organize(actor.workspaceId, id, null, 0, randomUUID()),
  ).rejects.toMatchObject({ code: "STALE_DRAFT" });
  await expect(
    surveys.organize(actor.workspaceId, id, randomUUID(), 1, randomUUID()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await favorites.setFavorite({
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      artifactType: "survey",
      artifactId: id,
      favorite: true,
      now,
    }),
  ).toMatchObject({ artifactId: id });
  expect(await favorites.listFavorites(actor.workspaceId, randomUUID())).toEqual([]);
  expect(
    await favorites.setFavorite({
      workspaceId: randomUUID(),
      userId: actor.userId,
      artifactType: "survey",
      artifactId: id,
      favorite: true,
      now,
    }),
  ).toBeNull();
  await repository.deleteFolder(actor.workspaceId, folderId);
  expect((await surveys.get(actor.workspaceId, id))!.folderId).toBeNull();
  // A metadata-only move must not require a new publish before sharing.
  expect(
    await surveys.createRoom(actor.workspaceId, id, 1, randomUUID(), {
      code: String(1000000 + Math.floor(Math.random() * 9000000)),
      closesAt: new Date(now.getTime() + 86400000).toISOString(),
      expiresAt: new Date(now.getTime() + 2 * 86400000).toISOString(),
      participantLimit: 20,
      windowDays: 1,
    }),
  ).toMatchObject({ surveyId: id });
}
export async function expectFeedbackConformance(repository: Repository, actor: CreatorContext) {
  const feedback = createFeedbackRepository(repository);
  const now = new Date();
  const input = {
    idempotencyKey: randomUUID(),
    category: "bug" as const,
    message: "Synthetic feedback persistence test",
    page: "/library",
    allowContact: false,
  };
  const [first, retry] = await Promise.all([
    feedback.submit(actor.workspaceId, actor.userId, input, now),
    feedback.submit(actor.workspaceId, actor.userId, input, now),
  ]);
  expect(first).toEqual(retry);
  expect(await feedback.find(randomUUID(), actor.userId, input.idempotencyKey)).toBeNull();
  expect(await feedback.find(actor.workspaceId, randomUUID(), input.idempotencyKey)).toBeNull();
  await expect(
    feedback.submit(
      actor.workspaceId,
      actor.userId,
      { ...input, message: "Changed feedback" },
      now,
    ),
  ).rejects.toThrow("retry key");
  expect((await feedback.list()).find((row) => row.id === first.id)?.contactEmail).toBeNull();
  const contact = await feedback.submit(
    actor.workspaceId,
    actor.userId,
    { ...input, idempotencyKey: randomUUID(), allowContact: true },
    now,
  );
  expect((await feedback.list()).find((row) => row.id === contact.id)?.contactEmail).toBe(
    actor.email,
  );
  expect((await repository.exportAccount(actor.userId)).productFeedback).toHaveLength(2);
  await feedback.purge(new Date(now.getTime() + 90 * 86400000));
  expect(await feedback.find(actor.workspaceId, actor.userId, input.idempotencyKey)).toBeNull();
  await feedback.submit(
    actor.workspaceId,
    actor.userId,
    { ...input, idempotencyKey: randomUUID() },
    now,
  );
  await repository.deleteAccount(actor.userId);
  expect((await feedback.list()).some((row) => row.userId === actor.userId)).toBe(false);
}
