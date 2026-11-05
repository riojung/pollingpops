import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { PresentationDraftSchema } from "@openround/contracts";
import {
  createPresentationRepository,
  createPresentationVisualImportRepository,
  type Repository,
  type PresentationVisualImportCreateInput,
  type PresentationVisualImportClaim,
} from "../../src/index.js";

export async function expectPresentationVisualImportConformance(
  repository: Repository,
  workspaceId: string,
  userId: string,
) {
  const now = new Date(),
    presentations = createPresentationRepository(repository),
    jobs = createPresentationVisualImportRepository(repository);
  const draft = PresentationDraftSchema.parse({ title: "Visual import persistence", blocks: [] });
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftSchemaVersion: 2,
    draftRevision: 0,
    currentVersionId: null,
    publishedDraftRevision: null,
    lastEditedBy: userId,
    folderId: null,
    createdAt: now,
    updatedAt: now,
  });
  const bytes = Buffer.from("private source marker");
  const input: PresentationVisualImportCreateInput = {
    id: randomUUID(),
    workspaceId,
    presentationId: presentation.id,
    createdBy: userId,
    requestId: randomUUID(),
    requestHash: "a".repeat(64),
    sourceDigest: createHash("sha256").update(bytes).digest("hex"),
    files: [{ name: "Private source.png", mimeType: "image/png", bytes }],
    now,
  };
  const created = await jobs.create(input);
  expect(created.status).toBe("created");
  expect(JSON.stringify(created)).not.toContain(bytes.toString("base64"));
  const pendingExport = JSON.stringify(await repository.exportAccount(userId));
  expect(pendingExport).toContain(input.id);
  expect(pendingExport).not.toContain(bytes.toString("base64"));
  expect((await jobs.findByRequest(workspaceId, presentation.id, input.requestId))?.job.id).toBe(
    input.id,
  );
  expect((await jobs.create({ ...input, id: randomUUID() })).job.id).toBe(input.id);
  await expect(jobs.create({ ...input, requestHash: "b".repeat(64) })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await jobs.get(randomUUID(), presentation.id, input.id)).toBeNull();
  expect(await jobs.get(workspaceId, randomUUID(), input.id)).toBeNull();
  const first = await jobs.claim(now, new Date(now.getTime() + 60_000));
  expect(first?.files[0]?.bytes).toEqual(bytes);
  const fence = (claim: PresentationVisualImportClaim, at = now) => ({
    jobId: claim.id,
    attempt: claim.attempt,
    leaseToken: claim.leaseToken,
    now: at,
  });
  const asset = {
    id: randomUUID(),
    workspaceId,
    objectKey: "",
    mimeType: "image/png" as const,
    sizeBytes: 20,
    scanStatus: "pending" as const,
    altText: "Visual source page",
    createdAt: now,
  };
  asset.objectKey = `quarantine/${workspaceId}/${asset.id}.png`;
  expect(await jobs.reservePageAssets({ ...fence(first!), assets: [asset] })).toBe(true);
  expect(
    (await repository.listMediaReferences(workspaceId, asset.id)).some(
      (reference) => reference.ownerType === "presentation_visual_import",
    ),
  ).toBe(true);
  const page = {
    pageNumber: 1,
    mediaId: asset.id,
    width: 100,
    height: 100,
    extractedText: "Private extracted text",
    warnings: [],
  };
  expect(await jobs.complete({ ...fence(first!), pages: [page], warnings: [] })).toBe(false);
  const reclaimAt = new Date(now.getTime() + 60_001),
    second = await jobs.claim(reclaimAt, new Date(reclaimAt.getTime() + 60_000));
  expect(second?.attempt).toBe(first!.attempt + 1);
  expect(await repository.listMediaReferences(workspaceId, asset.id)).toEqual([]);
  expect(
    await jobs.reservePageAssets({
      ...fence(first!, reclaimAt),
      assets: [{ ...asset, id: randomUUID() }],
    }),
  ).toBe(false);
  expect(await jobs.complete({ ...fence(first!, reclaimAt), pages: [page], warnings: [] })).toBe(
    false,
  );
  const secondAsset = { ...asset, id: randomUUID(), createdAt: reclaimAt };
  secondAsset.objectKey = `quarantine/${workspaceId}/${secondAsset.id}.png`;
  expect(
    await jobs.reservePageAssets({ ...fence(second!, reclaimAt), assets: [secondAsset] }),
  ).toBe(true);
  const token = randomUUID();
  await repository.claimMediaAssetFinalization(workspaceId, secondAsset.id, token, reclaimAt);
  await repository.updateMediaAsset(workspaceId, secondAsset.id, {
    scanStatus: "clean",
    objectKey: `media/${workspaceId}/${secondAsset.id}/${token}.png`,
    finalizationToken: token,
    finalizedAt: reclaimAt,
  });
  expect(
    await jobs.complete({
      ...fence(second!, reclaimAt),
      pages: [{ ...page, mediaId: secondAsset.id }],
      warnings: ["Visual images are not editable objects"],
    }),
  ).toBe(true);
  const ready = await jobs.get(workspaceId, presentation.id, input.id, reclaimAt);
  expect(ready).toMatchObject({ status: "ready", pageCount: 1 });
  expect(JSON.stringify(ready)).not.toContain("base64");
  expect(await jobs.claim(reclaimAt, new Date(reclaimAt.getTime() + 60_000))).toBeNull();
  const exported = await repository.exportAccount(userId);
  expect(JSON.stringify(exported)).not.toContain(bytes.toString("base64"));
  expect(await jobs.cancel(workspaceId, presentation.id, input.id, reclaimAt)).toMatchObject({
    status: "canceled",
    pages: [],
  });
  expect(await repository.listMediaReferences(workspaceId, secondAsset.id)).toEqual([]);
  expect((await jobs.create(input)).job.status).toBe("canceled");
  expect(
    await jobs.complete({
      ...fence(second!, reclaimAt),
      pages: [{ ...page, mediaId: secondAsset.id }],
      warnings: [],
    }),
  ).toBe(false);
  expect(await jobs.purgeExpired(new Date(now.getTime() + 86_400_001))).toContain(input.id);
  expect(await jobs.get(workspaceId, presentation.id, input.id)).toBeNull();
  const crashed = { ...input, id: randomUUID(), requestId: randomUUID() };
  await jobs.create(crashed);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const at = new Date(now.getTime() + (attempt - 1) * 1001),
      claim = await jobs.claim(at, new Date(at.getTime() + 1000));
    expect(claim?.attempt).toBe(attempt);
  }
  const exhaustedAt = new Date(now.getTime() + 3003);
  expect(await jobs.claim(exhaustedAt, new Date(exhaustedAt.getTime() + 1000))).toBeNull();
  expect(await jobs.get(workspaceId, presentation.id, crashed.id, exhaustedAt)).toMatchObject({
    status: "failed",
    attempts: 3,
    error: { code: "ATTEMPT_LIMIT" },
  });
  expect((await jobs.create(crashed)).job.status).toBe("failed");
  return { presentation, jobs, input };
}
