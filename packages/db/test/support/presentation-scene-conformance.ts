import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  type PresentationDraft,
} from "@openround/contracts";
import {
  MEDIA_DELETION_TOMBSTONE_HOLD_MS,
  createPresentationRepository,
  createPresentationSessionRepository,
  presentationMediaIds,
  PresentationMutationConflictError,
  type Repository,
} from "../../src/index.js";
import {
  presentationPackContent,
  presentationPackMediaDraft,
} from "./presentation-pack-media-conformance.js";

export function presentationSceneBlock(mediaIds: string[]) {
  const nodes = [
    {
      id: "title",
      type: "text" as const,
      role: "title" as const,
      text: "Native evidence",
      frame: { x: 5, y: 5, width: 90, height: 15 },
    },
    ...mediaIds.map((mediaId, index) => ({
      id: `image-${index}`,
      type: "image" as const,
      mediaId,
      altText: `Evidence diagram ${index + 1}`,
      frame: { x: 5 + index * 40, y: 25, width: 35, height: 45 },
    })),
    {
      id: "shape",
      type: "shape" as const,
      shape: "rectangle" as const,
      color: "blue" as const,
      label: "Discuss the result",
      frame: { x: 10, y: 80, width: 70, height: 15 },
    },
    {
      id: "connector",
      type: "connector" as const,
      from: { nodeId: "title", anchor: "bottom" as const },
      to: { nodeId: "shape", anchor: "top" as const },
      label: "supports",
      color: "blue" as const,
    },
  ];
  return {
    id: randomUUID(),
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "Private native presenter note",
    scene: {
      schemaVersion: 1 as const,
      aspectRatio: "16:9" as const,
      nodes,
      readingOrder: nodes.map(({ id }) => id),
    },
  };
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Run against memory and the restricted PostgreSQL runtime to exercise real reference triggers. */
export async function expectPresentationSceneConformance(input: {
  repository: Repository;
  workspaceId: string;
  otherWorkspaceId: string;
  editorId: string;
}) {
  const { repository, workspaceId, otherWorkspaceId, editorId } = input;
  const presentations = createPresentationRepository(repository);
  const sessions = createPresentationSessionRepository(repository);
  const now = new Date();
  // Native UUID admission includes modern v7 and nil values; SQL must retain both too.
  const v7Source = randomUUID();
  const sceneIds = [
    `${v7Source.slice(0, 14)}7${v7Source.slice(15)}`,
    "00000000-0000-0000-0000-000000000000",
  ];
  const originalIds = Array.from({ length: 3 }, () => randomUUID());
  const baselineIds = Array.from({ length: 3 }, () => randomUUID());
  const foreignId = randomUUID();
  const deletingId = randomUUID();
  for (const id of [...sceneIds, ...originalIds, ...baselineIds, foreignId, deletingId])
    await repository.createMediaAsset({
      id,
      workspaceId: id === foreignId ? otherWorkspaceId : workspaceId,
      objectKey: `native/${id}.png`,
      mimeType: "image/png",
      sizeBytes: 128,
      scanStatus: "clean",
      altText: "Native diagram",
      createdAt: now,
    });
  expect(await repository.claimMediaAssetDeletion(workspaceId, deletingId, now)).not.toBeNull();
  const packDraft = presentationPackMediaDraft(presentationPackContent(originalIds));
  const baseline = presentationPackContent(baselineIds);
  const draft = PresentationDraftSchema.parse({
    ...packDraft,
    schemaVersion: 4,
    blocks: [presentationSceneBlock(sceneIds), ...packDraft.blocks],
    recoveryPackInsertions: [
      {
        ...packDraft.recoveryPackInsertions![0]!,
        updateBaseline: {
          packVersionId: randomUUID(),
          packVersion: 2,
          contentHash: hash(baseline),
          content: baseline,
        },
      },
    ],
  });
  const expectedMediaIds = [...sceneIds, ...originalIds, ...baselineIds].sort();
  expect(presentationMediaIds(draft).sort()).toEqual(expectedMediaIds);
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: 4,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: editorId,
    createdAt: now,
    updatedAt: now,
  });
  const content = PresentationContentSchema.parse(draft);
  const version = await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId,
      presentationId: presentation.id,
      version: 1,
      content,
      contentSchemaVersion: 4,
      contentHash: hash(content),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  for (const mediaId of expectedMediaIds) {
    const references = await repository.listMediaReferences(workspaceId, mediaId);
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "presentation_draft", ownerId: presentation.id }),
        expect.objectContaining({ ownerType: "presentation_version", ownerId: version.id }),
        expect.objectContaining({ ownerType: "presentation_history" }),
      ]),
    );
    await expect(repository.deleteMediaAsset(workspaceId, mediaId)).resolves.toBe(false);
  }
  for (const mediaId of [foreignId, deletingId, randomUUID()]) {
    const invalid = structuredClone(draft);
    invalid.blocks[0] = presentationSceneBlock([mediaId]);
    await expect(
      presentations.updatePresentationDraft({
        workspaceId,
        presentationId: presentation.id,
        draft: invalid,
        expectedRevision: 0,
        mutationId: randomUUID(),
        editorId,
        draftHash: hash(invalid),
      }),
    ).rejects.toThrow(/unavailable|media asset/i);
    expect((await presentations.getPresentation(workspaceId, presentation.id))?.draft).toEqual(
      draft,
    );
    expect(await presentations.listPresentationHistory(workspaceId, presentation.id)).toHaveLength(
      1,
    );
  }
  const changed = structuredClone(draft);
  changed.blocks[0] = presentationSceneBlock([sceneIds[1]!]);
  const mutation = {
    workspaceId,
    presentationId: presentation.id,
    draft: changed,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    draftHash: hash(changed),
  };
  const saved = await presentations.updatePresentationDraft(mutation);
  expect(saved).toMatchObject({ draftRevision: 1, draftSchemaVersion: 4, draft: changed });
  const removedImageReferences = await repository.listMediaReferences(workspaceId, sceneIds[0]!);
  expect(removedImageReferences).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ownerType: "presentation_version", ownerId: version.id }),
      expect.objectContaining({ ownerType: "presentation_history" }),
    ]),
  );
  expect(
    removedImageReferences.some((reference) => reference.ownerType === "presentation_draft"),
  ).toBe(false);
  expect(await repository.claimMediaAssetDeletion(workspaceId, sceneIds[0]!, now)).toBeNull();
  const altered = structuredClone(changed);
  altered.description = "A different accepted request";
  await expect(
    presentations.updatePresentationDraft({
      ...mutation,
      draft: altered,
      draftHash: hash(altered),
    }),
  ).rejects.toBeInstanceOf(PresentationMutationConflictError);
  const restored = await presentations.restorePresentationHistory({
    workspaceId,
    presentationId: presentation.id,
    historyRevision: 0,
    expectedRevision: 1,
    mutationId: randomUUID(),
    editorId,
  });
  expect(restored).toMatchObject({ draftRevision: 2, draftSchemaVersion: 4, draft });
  expect(await presentations.updatePresentationDraft(mutation)).toMatchObject({
    draftRevision: 1,
    draft: changed,
  });
  expect(await presentations.getPresentationVersion(workspaceId, version.id)).toMatchObject({
    content,
    contentHash: hash(content),
  });
  const session = await sessions.createSession({
    id: randomUUID(),
    workspaceId,
    presentationId: presentation.id,
    presentationVersionId: version.id,
    title: content.title,
    content,
    code: String(randomInt(1_000_000, 10_000_000)),
    status: "finished",
    phase: "finished",
    currentBlockIndex: 0,
    revision: 0,
    createdBy: editorId,
    createdAt: now,
    updatedAt: now,
    finishedAt: now,
    liveExpiresAt: new Date(now.getTime() + 3_600_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  });
  expect((await sessions.getSessionForWorkspace(workspaceId, session.id))?.content).toEqual(
    content,
  );
  const exported = await repository.exportAccount(editorId);
  for (const key of [
    "presentations",
    "presentationVersions",
    "presentationDraftHistory",
    "presentationSessions",
  ]) {
    const scenes = (exported[key] as Array<Record<string, unknown>>).flatMap((row) => {
      const document = (row.draft ?? row.content ?? row.content_snapshot) as
        PresentationDraft | undefined;
      return (
        document?.blocks.flatMap((block) =>
          block.kind === "content" && block.scene ? [block.scene] : [],
        ) ?? []
      );
    });
    const firstBlock = content.blocks[0]!;
    if (firstBlock.kind !== "content") throw new Error("Expected native content");
    expect(scenes).toContainEqual(firstBlock.scene);
  }
  await expect(presentations.deletePresentation(workspaceId, presentation.id)).resolves.toBe(
    "not_archived",
  );
  await sessions.deleteSession(workspaceId, session.id);
  await presentations.archivePresentation(workspaceId, presentation.id, true);
  await expect(presentations.deletePresentation(workspaceId, presentation.id)).resolves.toBe(
    "deleted",
  );
  for (const mediaId of expectedMediaIds) {
    expect(await repository.listMediaReferences(workspaceId, mediaId)).toEqual([]);
    const claimed = await repository.claimMediaAssetDeletion(workspaceId, mediaId, now);
    expect(claimed).not.toBeNull();
    await expect(
      repository.deleteMediaAsset(
        workspaceId,
        mediaId,
        new Date(now.getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS + 1),
      ),
    ).resolves.toBe(true);
  }
  return { draft, expectedMediaIds };
}
