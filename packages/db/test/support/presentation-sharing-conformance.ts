import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { PresentationContentSchema } from "@openround/contracts";
import {
  createPresentationRepository,
  createPresentationShareRepository,
  type Repository,
} from "../../src/index.js";
export async function presentationSharingFixture(
  repository: Repository,
  label = "share",
  mediaId: string | null = null,
) {
  const tokenHash = `${label}-${randomUUID()}`;
  await repository.createMagicToken({
    id: randomUUID(),
    email: `${tokenHash}@example.test`,
    segment: "education",
    tokenHash,
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  const actor = (await repository.consumeMagicToken(tokenHash, new Date()))!;
  const presentations = createPresentationRepository(repository),
    shares = createPresentationShareRepository(repository),
    now = new Date();
  if (mediaId)
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId: actor.workspaceId,
      objectKey: `media/${actor.workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 8,
      scanStatus: "clean",
      altText: "Public diagram",
      createdAt: now,
    });
  const content = PresentationContentSchema.parse({
    schemaVersion: 2,
    title: "Frozen private review",
    blocks: [
      {
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        textElements: [
          { id: randomUUID(), role: "title", text: "Public title", region: "top_center", order: 0 },
        ],
        mediaId,
        mediaAlt: mediaId ? "Public diagram" : null,
        speakerNotes: "PRIVATE_SPEAKER_NOTES",
      },
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: randomUUID(),
          type: "numeric",
          prompt: "Public prompt",
          correctValue: "917",
          tolerance: "0",
          unit: null,
          timeLimitSeconds: 30,
          basePoints: 1000,
          explanation: "PRIVATE_EXPLANATION",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  });
  // Numeric answer syntax is validated at publication; retain a recognizable numeric answer sentinel.
  const question = content.blocks[1]!;
  if (question.kind === "question" && question.question.type === "numeric")
    question.question.correctValue = "917";
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    title: content.title,
    description: content.description,
    status: "draft",
    draft: content,
    draftRevision: 0,
    draftSchemaVersion: 2,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  const version = await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      presentationId: presentation.id,
      version: 1,
      content,
      contentSchemaVersion: 2,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  const request = () => ({
    workspaceId: actor.workspaceId,
    presentationId: presentation.id,
    versionId: version.id,
    actorId: actor.userId,
    requestId: randomUUID(),
    intentHash: createHash("sha256").update(randomUUID()).digest("hex"),
    tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
    expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    now,
  });
  return { actor, presentations, shares, presentation, version, content, now, request };
}
export async function expectPresentationSharingConformance(repository: Repository) {
  const f = await presentationSharingFixture(repository);
  const input = f.request();
  const concurrent = await Promise.all([f.shares.createShare(input), f.shares.createShare(input)]);
  expect(concurrent.map((result) => result.replayed).sort()).toEqual([false, true]);
  const share = concurrent[0]!.share;
  expect(
    (await f.shares.getPublicShare(share.id, input.tokenHash, f.now))?.version.content,
  ).toEqual(f.content);
  expect(await f.shares.getPublicShare(share.id, "f".repeat(64), f.now)).toBeNull();
  expect(
    await f.shares.getPublicShare(share.id, input.tokenHash, new Date(input.expiresAt)),
  ).toBeNull();
  await expect(
    f.shares.createShare({ ...input, intentHash: "b".repeat(64) }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(f.shares.createShare({ ...input, versionId: randomUUID() })).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  const other = await presentationSharingFixture(repository, "other");
  expect(
    await other.shares.revokeShare(
      other.actor.workspaceId,
      other.presentation.id,
      share.id,
      other.actor.userId,
      f.now,
    ),
  ).toBe(false);
  await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
  expect(await f.shares.getPublicShare(share.id, input.tokenHash, f.now)).not.toBeNull();
  await expect(f.shares.createShare(f.request())).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect((await f.shares.createShare(input)).replayed).toBe(true);
  await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, false);
  for (let i = 1; i < 19; i++) await f.shares.createShare(f.request());
  const capacity = await Promise.allSettled(
    Array.from({ length: 4 }, () => f.shares.createShare(f.request())),
  );
  expect(capacity.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(capacity.filter((result) => result.status === "rejected")).toHaveLength(3);
  expect(
    await f.shares.revokeShare(
      f.actor.workspaceId,
      f.presentation.id,
      share.id,
      f.actor.userId,
      f.now,
    ),
  ).toBe(true);
  expect(
    await f.shares.revokeShare(
      f.actor.workspaceId,
      f.presentation.id,
      share.id,
      f.actor.userId,
      new Date(f.now.getTime() + 1000),
    ),
  ).toBe(true);
  expect(await f.shares.getPublicShare(share.id, input.tokenHash, f.now)).toBeNull();
  expect(
    (await f.shares.listShares(f.actor.workspaceId, f.presentation.id, f.actor.userId)).find(
      (value) => value.id === share.id,
    )?.revokedAt,
  ).toEqual(f.now);
  await expect(
    f.shares.createShare({
      ...f.request(),
      expiresAt: new Date(f.now.getTime() - 1).toISOString(),
    }),
  ).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
  await expect(
    f.shares.createShare({
      ...f.request(),
      expiresAt: new Date(f.now.getTime() + 31 * 86_400_000).toISOString(),
    }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  return f;
}

export async function expectPresentationShareExpiryConformance(repository: Repository) {
  const f = await presentationSharingFixture(repository, "share-expiry"),
    original = { ...f.request(), expiresAt: new Date(f.now.getTime() + 86_400_000).toISOString() };
  const accepted = await f.shares.createShare(original),
    later = new Date(Date.parse(original.expiresAt) + 1);
  const replayed = await f.shares.createShare({ ...original, now: later });
  expect(replayed).toEqual({ share: accepted.share, replayed: true });
  expect(
    await f.shares.getPublicShareAccess(accepted.share.id, original.tokenHash, later),
  ).toBeNull();
  await expect(
    f.shares.createShare({ ...original, intentHash: "f".repeat(64), now: later }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const unaccepted = { ...f.request(), expiresAt: original.expiresAt, now: later };
  await expect(f.shares.createShare(unaccepted)).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
  await expect(
    f.shares.createShare({ ...unaccepted, now: new Date(original.expiresAt) }),
  ).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
  await expect(
    f.shares.createShare({ ...unaccepted, actorId: randomUUID() }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(
    f.shares.createShare({ ...unaccepted, versionId: randomUUID() }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(await f.shares.listShares(f.actor.workspaceId, f.presentation.id, f.actor.userId)).toEqual(
    [accepted.share],
  );
  const afterPrune = new Date(Date.parse(original.expiresAt) + 8 * 86_400_000);
  await repository.purgeExpired(afterPrune);
  await expect(f.shares.createShare({ ...original, now: afterPrune })).rejects.toMatchObject({
    code: "REQUEST_EXPIRED",
  });
  expect(await f.shares.listShares(f.actor.workspaceId, f.presentation.id, f.actor.userId)).toEqual(
    [],
  );
  expect(
    (await f.presentations.getPresentationVersion(f.actor.workspaceId, f.version.id))?.contentHash,
  ).toBe(f.version.contentHash);
}
