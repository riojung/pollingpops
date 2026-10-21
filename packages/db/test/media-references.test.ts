import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PresentationDraft, QuizDraft } from "@openround/contracts";
import { createPresentationRepository, MemoryRepository } from "../src/index.js";
import {
  expectPresentationPackHistoryMediaConformance,
  expectPresentationPackInvalidMediaConformance,
  expectPresentationPackMediaConformance,
} from "./support/presentation-pack-media-conformance.js";

async function owner(repository: MemoryRepository) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `presentation-pack-media-${randomUUID()}@example.com`,
    segment: "education",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}

function media(workspaceId: string, id: string, createdAt: Date) {
  return {
    id,
    workspaceId,
    objectKey: `media/${workspaceId}/${id}.png`,
    mimeType: "image/png" as const,
    sizeBytes: 128,
    scanStatus: "clean" as const,
    altText: "Source file description",
    createdAt,
  };
}

function roundDraft(mediaId: string | null): QuizDraft {
  return {
    title: "Referenced media",
    description: "",
    category: "education",
    experiencePreset: { id: "focus", version: 1 },
    questions: [
      {
        id: randomUUID(),
        type: "single_select",
        prompt: "Which option is supported?",
        purpose: "diagnostic",
        confidence: "optional",
        delivery: "main",
        conceptKeys: ["evidence"],
        linkedRecheckQuestionId: null,
        choices: [
          { id: randomUUID(), label: "A", isCorrect: true },
          { id: randomUUID(), label: "B", isCorrect: false },
        ],
        timeLimitSeconds: 20,
        basePoints: 1_000,
        explanation: "A is supported.",
        mediaId,
        mediaAlt: mediaId ? "Placement-specific diagram description" : null,
      },
    ],
  };
}

function presentationDraft(mediaId: string | null): PresentationDraft {
  return {
    title: "Referenced presentation media",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    blocks: [
      {
        id: randomUUID(),
        kind: "content",
        layout: "media",
        textElements: [
          { id: "evidence:title", role: "title", text: "Evidence", region: "top_center", order: 0 },
          {
            id: "evidence:body",
            role: "body",
            text: "Review the diagram.",
            region: "middle_center",
            order: 0,
          },
        ],
        mediaId,
        mediaAlt: mediaId ? "Placement-specific slide description" : null,
        speakerNotes: "",
      },
    ],
  };
}

describe("media references", () => {
  it("retains Presentation Pack originals and accepted baselines after source deletion and local edits", async () => {
    const repository = new MemoryRepository();
    const creator = await owner(repository);
    await expectPresentationPackMediaConformance({
      repository,
      workspaceId: creator.workspaceId,
      editorId: creator.userId,
    });
  });

  it("rejects invalid private media in both Presentation Pack snapshots atomically", async () => {
    const repository = new MemoryRepository();
    const creator = await owner(repository);
    const other = await owner(repository);
    await expectPresentationPackInvalidMediaConformance({
      repository,
      workspaceId: creator.workspaceId,
      otherWorkspaceId: other.workspaceId,
      editorId: creator.userId,
    });
  });

  it("releases Presentation Pack media when the last retained history snapshot is pruned", async () => {
    const repository = new MemoryRepository();
    const creator = await owner(repository);
    await expectPresentationPackHistoryMediaConformance({
      repository,
      workspaceId: creator.workspaceId,
      editorId: creator.userId,
    });
  });

  it("protects draft, history, and immutable-version assets while finding old orphans", async () => {
    const repository = new MemoryRepository();
    const presentations = createPresentationRepository(repository);
    const workspaceId = randomUUID();
    const userId = randomUUID();
    const now = new Date();
    const referencedId = randomUUID();
    const orphanId = randomUUID();
    await repository.createMediaAsset(
      media(workspaceId, referencedId, new Date(now.getTime() - 10 * 86_400_000)),
    );
    await repository.createMediaAsset(
      media(workspaceId, orphanId, new Date(now.getTime() - 8 * 86_400_000)),
    );

    const quizId = randomUUID();
    const draft = roundDraft(referencedId);
    await repository.createQuiz({
      id: quizId,
      workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const versionId = randomUUID();
    await repository.publishQuiz({
      id: versionId,
      workspaceId,
      quizId,
      version: 1,
      content: draft,
      contentHash: "round-version-with-media",
      publishedAt: now,
    });

    const presentationId = randomUUID();
    const presentation = presentationDraft(referencedId);
    await presentations.createPresentation({
      id: presentationId,
      workspaceId,
      title: presentation.title,
      description: presentation.description,
      status: "draft",
      draft: presentation,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await presentations.updatePresentationDraft({
      workspaceId,
      presentationId,
      draft: presentationDraft(null),
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: userId,
      draftHash: "without-media",
    });

    expect(await repository.deleteMediaAsset(workspaceId, referencedId)).toBe(false);
    expect((await repository.listUnattachedMedia(now)).map(({ id }) => id)).toEqual([orphanId]);
    expect(await repository.listMediaReferences(workspaceId, referencedId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "quiz_draft", ownerId: quizId }),
        expect.objectContaining({ ownerType: "quiz_version", ownerId: versionId }),
        expect.objectContaining({ ownerType: "presentation_history" }),
      ]),
    );
  });

  it("rejects cross-workspace or missing media references without replacing valid edges", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const assetId = randomUUID();
    const ownerId = randomUUID();
    await repository.createMediaAsset(media(workspaceId, assetId, new Date()));
    await repository.replaceMediaReferences(workspaceId, "quiz_draft", ownerId, [assetId]);

    await expect(
      repository.replaceMediaReferences(workspaceId, "quiz_draft", ownerId, [randomUUID()]),
    ).rejects.toThrow("unavailable in this workspace");
    expect(await repository.listMediaReferences(workspaceId, assetId)).toHaveLength(1);
  });

  it("does not mutate Memory drafts when media validation fails", async () => {
    const repository = new MemoryRepository();
    const presentations = createPresentationRepository(repository);
    const workspaceId = randomUUID();
    const editorId = randomUUID();
    const now = new Date();
    const quizId = randomUUID();
    const originalRound = roundDraft(null);
    await repository.createQuiz({
      id: quizId,
      workspaceId,
      title: originalRound.title,
      description: originalRound.description,
      status: "draft",
      draft: originalRound,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      repository.updateQuizDraft({
        workspaceId,
        quizId,
        draft: roundDraft(randomUUID()),
        expectedRevision: 0,
        mutationId: randomUUID(),
        editorId,
        schemaVersion: 1,
        draftHash: "invalid-round-media",
      }),
    ).rejects.toThrow("unavailable in this workspace");
    await expect(repository.getQuiz(workspaceId, quizId)).resolves.toMatchObject({
      draftRevision: 0,
      draft: { questions: [expect.objectContaining({ mediaId: null })] },
    });
    await expect(repository.listQuizDraftHistory(workspaceId, quizId, 20)).resolves.toHaveLength(1);

    const presentationId = randomUUID();
    const originalPresentation = presentationDraft(null);
    await presentations.createPresentation({
      id: presentationId,
      workspaceId,
      title: originalPresentation.title,
      description: originalPresentation.description,
      status: "draft",
      draft: originalPresentation,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: editorId,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      presentations.updatePresentationDraft({
        workspaceId,
        presentationId,
        draft: presentationDraft(randomUUID()),
        expectedRevision: 0,
        mutationId: randomUUID(),
        editorId,
        draftHash: "invalid-presentation-media",
      }),
    ).rejects.toThrow("unavailable in this workspace");
    await expect(presentations.getPresentation(workspaceId, presentationId)).resolves.toMatchObject(
      {
        draftRevision: 0,
        draft: { blocks: [expect.objectContaining({ mediaId: null })] },
      },
    );
    await expect(
      presentations.listPresentationHistory(workspaceId, presentationId, 20),
    ).resolves.toHaveLength(1);
  });

  it("includes reference metadata in account exports and removes it with owned workspaces", async () => {
    const repository = new MemoryRepository();
    const now = new Date("2026-09-20T12:00:00.000Z");
    const tokenHash = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: `media-owner-${randomUUID()}@example.com`,
      segment: "education",
      tokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
    });
    const owner = await repository.consumeMagicToken(tokenHash, now);
    expect(owner).not.toBeNull();
    const mediaId = randomUUID();
    await repository.createMediaAsset(media(owner!.workspaceId, mediaId, now));
    const quizId = randomUUID();
    const draft = roundDraft(mediaId);
    await repository.createQuiz({
      id: quizId,
      workspaceId: owner!.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(repository.exportAccount(owner!.userId)).resolves.toMatchObject({
      mediaReferences: expect.arrayContaining([
        expect.objectContaining({ mediaId, ownerType: "quiz_draft", ownerId: quizId }),
        expect.objectContaining({ mediaId, ownerType: "quiz_history" }),
      ]),
    });
    await repository.deleteAccount(owner!.userId);
    expect(repository.mediaReferences.size).toBe(0);
    expect(repository.mediaAssets.size).toBe(0);
  });
});
