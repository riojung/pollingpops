import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PresentationDraft } from "@openround/contracts";
import {
  createCollaborationGroupRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
  MemoryRepository,
} from "../src/index.js";

async function createOwner(repository: MemoryRepository) {
  const now = new Date("2026-09-20T12:00:00.000Z");
  await repository.createMagicToken({
    id: randomUUID(),
    email: `lifecycle-${randomUUID()}@example.com`,
    segment: "workplace",
    tokenHash: randomUUID(),
    policyVersion: "test-v1",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const token = [...repository.magicTokens.keys()][0]!;
  const owner = await repository.consumeMagicToken(token, now);
  expect(owner).not.toBeNull();
  return { owner: owner!, now };
}

function presentationDraft(blockId: string): PresentationDraft {
  return {
    title: "Lifecycle briefing",
    description: "Portable Presentation data",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    blocks: [
      {
        id: blockId,
        kind: "content",
        layout: "title_body",
        textElements: [
          {
            id: `${blockId}:title`,
            role: "title",
            text: "Evidence",
            region: "top_center",
            order: 0,
          },
          {
            id: `${blockId}:body`,
            role: "body",
            text: "Review the source.",
            region: "middle_center",
            order: 0,
          },
        ],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "Facilitator note",
      },
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: randomUUID(),
          type: "numeric",
          prompt: "How many evidence sources were reviewed?",
          correctValue: "1",
          tolerance: "0",
          unit: null,
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "One source was reviewed.",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  };
}

describe("new artifact data lifecycle", () => {
  it("exports attached memory stores, redacts participant tokens, and deletes workspace data", async () => {
    const repository = new MemoryRepository();
    const presentations = createPresentationRepository(repository);
    const sessions = createPresentationSessionRepository(repository);
    const groups = createCollaborationGroupRepository(repository);
    expect(createPresentationRepository(repository)).toBe(presentations);
    expect(createPresentationSessionRepository(repository)).toBe(sessions);
    expect(createCollaborationGroupRepository(repository)).toBe(groups);

    const { owner, now } = await createOwner(repository);
    const presentationId = randomUUID();
    const versionId = randomUUID();
    const blockId = randomUUID();
    const draft = presentationDraft(blockId);
    await presentations.createPresentation({
      id: presentationId,
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: owner.userId,
      createdAt: now,
      updatedAt: now,
    });
    await presentations.publishPresentation(
      {
        id: versionId,
        workspaceId: owner.workspaceId,
        presentationId,
        version: 1,
        content: draft,
        contentHash: "published-content",
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );

    const sessionId = randomUUID();
    const participantId = randomUUID();
    await sessions.createSession({
      id: sessionId,
      workspaceId: owner.workspaceId,
      presentationId,
      presentationVersionId: versionId,
      title: draft.title,
      content: draft,
      code: "1234567",
      joinPasswordHash: "private-presentation-verifier",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });
    await sessions.addParticipant({
      id: participantId,
      workspaceId: owner.workspaceId,
      sessionId,
      nickname: "River",
      tokenHash: "participant-token-must-not-export",
      joinedAt: now,
      lastSeenAt: now,
    });
    const credential = await sessions.createCredential({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId,
      role: "host",
      tokenHash: "b".repeat(64),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    });
    const commandId = randomUUID();
    await sessions.transitionSessionCommand({
      workspaceId: owner.workspaceId,
      sessionId,
      commandId,
      expectedRevision: 0,
      phase: "content",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "content.presented", blockIndex: 0, blockId },
    });

    const groupId = randomUUID();
    await groups.createGroup(
      {
        id: groupId,
        workspaceId: owner.workspaceId,
        name: "Facilitators",
        description: "Review team",
        createdBy: owner.userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId: owner.workspaceId,
        groupId,
        userId: owner.userId,
        role: "owner",
        joinedAt: now,
      },
    );
    await groups.addArtifact({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      groupId,
      artifactType: "presentation",
      artifactId: presentationId,
      addedBy: owner.userId,
      createdAt: now,
    });
    await groups.addMessage({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      groupId,
      authorId: owner.userId,
      body: "Review before the session.",
      createdAt: now,
    });

    const exported = await repository.exportAccount(owner.userId);
    expect(JSON.stringify(exported)).not.toContain("private-presentation-verifier");
    expect(JSON.stringify(exported)).not.toContain("joinPasswordHash");
    expect(exported).toMatchObject({
      presentations: [{ id: presentationId }],
      presentationVersions: [{ id: versionId }],
      presentationSessions: [{ id: sessionId }],
      presentationSessionParticipants: [{ id: participantId, nickname: "River" }],
      presentationSessionTimeline: [{ sessionId, type: "content.presented" }],
      presentationSessionCommandReceipts: [{ sessionId, commandId }],
      presentationSessionCredentials: [{ id: credential.id, role: "host" }],
      collaborationGroups: [{ id: groupId }],
      collaborationGroupArtifacts: [{ artifactId: presentationId }],
      collaborationGroupMessages: [{ body: "Review before the session." }],
    });
    expect((exported as Record<string, unknown>).presentationSessionParticipants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ tokenHash: expect.anything() })]),
    );
    expect((exported as Record<string, unknown>).presentationSessionCredentials).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ tokenHash: expect.anything() })]),
    );

    await sessions.transitionSession({
      workspaceId: owner.workspaceId,
      sessionId,
      expectedRevision: 1,
      phase: "finished",
      currentBlockIndex: 0,
      status: "finished",
      occurredAt: now,
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });
    await expect(sessions.getReport(owner.workspaceId, sessionId)).resolves.toMatchObject({
      id: sessionId,
      status: "pending",
    });
    await expect(repository.exportAccount(owner.userId)).resolves.toMatchObject({
      presentationSessionReports: [{ id: sessionId, status: "pending", payload: null }],
    });

    await repository.deleteAccount(owner.userId);
    await expect(presentations.listPresentations(owner.workspaceId, true)).resolves.toEqual([]);
    await expect(sessions.listSessions(owner.workspaceId)).resolves.toEqual([]);
    await expect(sessions.getReport(owner.workspaceId, sessionId)).resolves.toBeNull();
    await expect(groups.listGroups(owner.workspaceId, owner.userId)).resolves.toEqual([]);
  });

  it("purges Presentation sessions at their retention boundary with child records", async () => {
    const repository = new MemoryRepository();
    const sessions = createPresentationSessionRepository(repository);
    const { owner, now } = await createOwner(repository);
    const expiredId = randomUUID();
    const retainedId = randomUUID();
    const content = presentationDraft(randomUUID());

    for (const [id, retentionExpiresAt, code] of [
      [expiredId, now, "7654321"],
      [retainedId, new Date(now.getTime() + 1), "7654322"],
    ] as const) {
      await sessions.createSession({
        id,
        workspaceId: owner.workspaceId,
        presentationId: randomUUID(),
        presentationVersionId: randomUUID(),
        title: content.title,
        content,
        code,
        status: "finished",
        phase: "finished",
        currentBlockIndex: 0,
        revision: 1,
        createdBy: owner.userId,
        createdAt: now,
        updatedAt: now,
        finishedAt: now,
        liveExpiresAt: now,
        retentionExpiresAt,
      });
    }
    await sessions.addParticipant({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: expiredId,
      nickname: "Expired",
      tokenHash: "expired-token",
      joinedAt: now,
      lastSeenAt: now,
    });

    await expect(repository.purgeExpired(now)).resolves.toContain(expiredId);
    await expect(sessions.getSessionById(expiredId)).resolves.toBeNull();
    await expect(sessions.listParticipants(expiredId)).resolves.toEqual([]);
    await expect(sessions.getReport(owner.workspaceId, expiredId)).resolves.toBeNull();
    await expect(sessions.getSessionById(retainedId)).resolves.toMatchObject({ id: retainedId });
    await expect(sessions.getReport(owner.workspaceId, retainedId)).resolves.toMatchObject({
      id: retainedId,
      status: "pending",
    });
  });
});
