import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  preparePresentationPublication,
  type PresentationDraft,
  type PresentationSceneNode,
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

export function presentationSceneBlock(
  mediaIds: string[],
  richText = false,
  design = false,
  composition = false,
) {
  design ||= composition;
  richText ||= design;
  const nodes: PresentationSceneNode[] = [
    {
      id: "title",
      type: "text" as const,
      role: "title" as const,
      text: "Native evidence",
      ...(richText
        ? {
            richText: {
              paragraphs: [
                {
                  kind: "paragraph" as const,
                  runs: [
                    { text: "Native ", bold: true as const },
                    { text: "evidence", italic: true as const },
                  ],
                },
              ],
            },
          }
        : {}),
      frame: { x: 5, y: 5, width: 90, height: 15 },
    },
    ...(richText
      ? [
          {
            id: "body",
            type: "text" as const,
            role: "body" as const,
            text: "Review evidence\nShare findings\nConfirm next step",
            richText: {
              paragraphs: [
                {
                  kind: "paragraph" as const,
                  runs: [{ text: "Review evidence", bold: true as const }],
                },
                {
                  kind: "bullet" as const,
                  runs: [
                    {
                      text: "Share findings",
                      italic: true as const,
                      href: "https://example.com/review",
                    },
                  ],
                },
                { kind: "numbered" as const, runs: [{ text: "Confirm next step" }] },
              ],
            },
            frame: { x: 5, y: 70, width: 90, height: 10 },
          },
        ]
      : []),
    ...mediaIds.map((mediaId, index) => ({
      id: `image-${index}`,
      type: "image" as const,
      mediaId,
      altText: `Evidence diagram ${index + 1}`,
      ...(design ? { fit: "cover" as const, focalPoint: { x: 25, y: 75 } } : {}),
      ...(composition ? { rotation: 12 } : {}),
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
    ...(composition
      ? [
          {
            id: "table",
            type: "table" as const,
            caption: "Evidence",
            headers: ["Stage", "Count"],
            rows: [
              ["Plan", "12"],
              ["Deliver", "18"],
            ],
            rotation: 10,
            frame: { x: 8, y: 33, width: 38, height: 28 },
          },
          {
            id: "chart",
            type: "chart" as const,
            chartType: "bar" as const,
            title: "Evidence",
            summary: "Deliveries increased from 12 to 18.",
            categories: ["Plan", "Deliver"],
            series: [{ name: "Count", values: [12, 18] }],
            frame: { x: 54, y: 33, width: 38, height: 28 },
          },
        ]
      : []),
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
      schemaVersion: composition
        ? (4 as const)
        : design
          ? (3 as const)
          : richText
            ? (2 as const)
            : (1 as const),
      ...(composition ? { groups: [{ id: "information", nodeIds: ["table", "chart"] }] } : {}),
      ...(design
        ? {
            design: {
              theme: "ocean" as const,
              font: "serif" as const,
              spacing: "compact" as const,
            },
          }
        : {}),
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
  richText?: boolean;
  visibility?: boolean;
  design?: boolean;
  composition?: boolean;
}) {
  const { repository, workspaceId, otherWorkspaceId, editorId, composition = false } = input;
  const design = input.design === true || composition;
  const visibility = input.visibility === true || design;
  const richText = input.richText === true || visibility;
  const schemaVersion = composition ? 8 : design ? 7 : visibility ? 6 : richText ? 5 : 4;
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
  const hiddenIds = visibility ? [randomUUID()] : [];
  const foreignId = randomUUID();
  const deletingId = randomUUID();
  for (const id of [
    ...sceneIds,
    ...originalIds,
    ...baselineIds,
    ...hiddenIds,
    foreignId,
    deletingId,
  ])
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
  const hiddenBlock = visibility
    ? { ...presentationSceneBlock(hiddenIds, richText, design, composition), hidden: true as const }
    : null;
  if (hiddenBlock) {
    const title = hiddenBlock.scene.nodes.find(
      (node) => node.type === "text" && node.role === "title",
    );
    if (!title || title.type !== "text") throw new Error("Expected hidden native title");
    title.text = "PRIVATE hidden source";
    title.richText = {
      paragraphs: [{ kind: "paragraph", runs: [{ text: title.text, bold: true }] }],
    };
  }
  const draft = PresentationDraftSchema.parse({
    ...packDraft,
    schemaVersion,
    blocks: [
      presentationSceneBlock(sceneIds, richText, design, composition),
      ...(hiddenBlock ? [hiddenBlock] : []),
      ...packDraft.blocks,
    ],
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
  const expectedPublishedMediaIds = [...sceneIds, ...originalIds, ...baselineIds].sort();
  const expectedMediaIds = [...expectedPublishedMediaIds, ...hiddenIds].sort();
  expect(presentationMediaIds(draft).sort()).toEqual(expectedMediaIds);
  if (design) {
    for (const block of draft.blocks) {
      if (block.kind !== "content" || !block.scene) continue;
      expect(block.scene).toMatchObject({
        schemaVersion: composition ? 4 : 3,
        design: { theme: "ocean", font: "serif", spacing: "compact" },
      });
      expect(block.scene.nodes.filter((node) => node.type === "image")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fit: "cover", focalPoint: { x: 25, y: 75 } }),
        ]),
      );
    }
  }
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: schemaVersion,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: editorId,
    createdAt: now,
    updatedAt: now,
  });
  const content = PresentationContentSchema.parse(preparePresentationPublication(draft));
  expect(presentationMediaIds(content).sort()).toEqual(expectedPublishedMediaIds);
  expect(content.schemaVersion).toBe(schemaVersion);
  expect(content.blocks).toEqual(
    draft.blocks.filter((block) => block.kind !== "content" || !block.hidden),
  );
  expect(content.recoveryPackInsertions).toEqual(draft.recoveryPackInsertions);
  if (hiddenBlock) {
    expect(JSON.stringify(content)).not.toContain("PRIVATE hidden source");
    expect(content.blocks.map((block) => block.id)).not.toContain(hiddenBlock.id);
  }
  const version = await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId,
      presentationId: presentation.id,
      version: 1,
      content,
      contentSchemaVersion: schemaVersion,
      contentHash: hash(content),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  for (const mediaId of expectedMediaIds) {
    expect(await repository.getMediaAsset(workspaceId, mediaId)).toMatchObject({
      scanStatus: "clean",
    });
    const references = await repository.listMediaReferences(workspaceId, mediaId);
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "presentation_draft", ownerId: presentation.id }),
        expect.objectContaining({ ownerType: "presentation_history" }),
      ]),
    );
    expect(
      references.some(
        (reference) =>
          reference.ownerType === "presentation_version" && reference.ownerId === version.id,
      ),
    ).toBe(expectedPublishedMediaIds.includes(mediaId));
    await expect(repository.deleteMediaAsset(workspaceId, mediaId)).resolves.toBe(false);
  }
  for (const mediaId of [foreignId, deletingId, randomUUID()]) {
    const invalid = structuredClone(draft);
    invalid.blocks[0] = presentationSceneBlock([mediaId], richText, design, composition);
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
  changed.blocks[0] = presentationSceneBlock([sceneIds[1]!], richText, design, composition);
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
  expect(saved).toMatchObject({
    draftRevision: 1,
    draftSchemaVersion: schemaVersion,
    draft: changed,
  });
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
  expect(restored).toMatchObject({ draftRevision: 2, draftSchemaVersion: schemaVersion, draft });
  expect(await presentations.updatePresentationDraft(mutation)).toMatchObject({
    draftRevision: 1,
    draft: changed,
  });
  expect(await presentations.getPresentationVersion(workspaceId, version.id)).toMatchObject({
    content,
    contentHash: hash(content),
  });
  if (hiddenBlock) {
    expect(restored).toMatchObject({ draftRevision: 2, draftSchemaVersion: schemaVersion, draft });
    expect(
      (await presentations.listPresentationHistory(workspaceId, presentation.id)).map(
        (entry) => entry.draft,
      ),
    ).toContainEqual(draft);
    const unhidden = structuredClone(draft);
    for (const block of unhidden.blocks) if (block.kind === "content") delete block.hidden;
    const visibleContent = PresentationContentSchema.parse(
      preparePresentationPublication(unhidden),
    );
    expect(visibleContent.schemaVersion).toBe(schemaVersion);
    expect(visibleContent.blocks.map((block) => block.id)).toContain(hiddenBlock.id);
    expect(presentationMediaIds(visibleContent).sort()).toEqual(expectedMediaIds);
    const unhiddenSaved = await presentations.updatePresentationDraft({
      workspaceId,
      presentationId: presentation.id,
      draft: unhidden,
      expectedRevision: 2,
      mutationId: randomUUID(),
      editorId,
      draftHash: hash(unhidden),
    });
    expect(unhiddenSaved).toMatchObject({
      draftRevision: 3,
      draftSchemaVersion: schemaVersion,
      draft: unhidden,
    });
    const visibleVersion = await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId,
        presentationId: presentation.id,
        version: 2,
        content: visibleContent,
        contentSchemaVersion: schemaVersion,
        contentHash: hash(visibleContent),
        sourceDraftRevision: 3,
        publishedAt: now,
      },
      3,
    );
    expect(visibleVersion).toMatchObject({ content: visibleContent, sourceDraftRevision: 3 });
    expect(await presentations.getPresentationVersion(workspaceId, version.id)).toMatchObject({
      content,
      contentHash: hash(content),
      sourceDraftRevision: 0,
    });
    const references = await repository.listMediaReferences(workspaceId, hiddenIds[0]!);
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "presentation_version", ownerId: visibleVersion.id }),
        expect.objectContaining({ ownerType: "presentation_history" }),
      ]),
    );
    expect(
      references.some(
        (reference) =>
          reference.ownerType === "presentation_version" && reference.ownerId === version.id,
      ),
    ).toBe(false);
  }
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
  if (hiddenBlock) {
    const history = exported.presentationDraftHistory as Array<Record<string, unknown>>;
    expect(history.some((entry) => JSON.stringify(entry.draft).includes('"hidden":true'))).toBe(
      true,
    );
    const versions = exported.presentationVersions as Array<Record<string, unknown>>;
    const firstVersion = versions.find((entry) => entry.id === version.id);
    expect(firstVersion).toBeDefined();
    expect(JSON.stringify(firstVersion)).not.toContain("PRIVATE hidden source");
    expect(JSON.stringify(firstVersion)).not.toContain(hiddenIds[0]!);
  }
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
  return { draft, content, expectedMediaIds, expectedPublishedMediaIds };
}
