import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationResponseAckSchema,
} from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
} from "@openround/db";
import { ConfigSchema } from "../src/config.js";
import {
  PresentationSessionService,
  presentationParticipantTokenHash,
} from "../src/presentation-session-service.js";
import type {
  PresentationBroadcastConsistencyError,
  PresentationSessionServiceError,
} from "../src/presentation-session-service.js";
import { StorageService } from "../src/storage.js";

const config = ConfigSchema.parse({
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  COMMUNITY_MODE: "false",
  WEB_ORIGIN: "http://localhost:3000",
  PUBLIC_API_URL: "http://localhost:4000",
  FEATURE_PRESENTATIONS: "true",
  LOG_LEVEL: "silent",
});

const AUTHORING_SECRETS = [
  "facilitator-only speaker note",
  "private slide citation",
  "correct-answer feedback",
  "misconception-secret",
  "private answer explanation",
  "private question citation",
  "private source disclosure",
] as const;

async function fixture(options: { failCreateAudit?: boolean } = {}) {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const presentations = createPresentationRepository(repository);
  const sessions = createPresentationSessionRepository(repository);
  const service = new PresentationSessionService({
    repository,
    presentations,
    sessions,
    config,
    storage: new StorageService(config, null),
  });
  const userId = randomUUID();
  const presentationId = randomUUID();
  const presentationVersionId = randomUUID();
  const contentBlockId = randomUUID();
  const questionBlockId = randomUUID();
  const questionId = randomUUID();
  const correctChoiceId = randomUUID();
  const distractorChoiceId = randomUUID();
  const now = new Date("2026-09-23T12:00:00.000Z");
  const draft = PresentationDraftSchema.parse({
    title: "Realtime service integration",
    description: "Exercises durable role-safe synchronization.",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    sourceDisclosure: {
      sourceName: AUTHORING_SECRETS[6],
      sourceDigest: "a".repeat(64),
      provider: "private-provider",
      model: "private-model",
    },
    blocks: [
      {
        id: contentBlockId,
        kind: "content",
        layout: "title_body",
        textElements: [
          {
            id: `${contentBlockId}:title`,
            role: "title",
            text: "Safe live title",
            region: "top_center",
            order: 0,
          },
          {
            id: `${contentBlockId}:body`,
            role: "body",
            text: "Safe live body",
            region: "middle_center",
            order: 0,
          },
        ],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: AUTHORING_SECRETS[0],
        citations: [{ locator: "internal-1", excerpt: AUTHORING_SECRETS[1] }],
      },
      {
        id: questionBlockId,
        kind: "question",
        citations: [{ locator: "internal-2", excerpt: AUTHORING_SECRETS[5] }],
        question: {
          id: questionId,
          type: "single_select",
          prompt: "Which option is safe to show?",
          purpose: "diagnostic",
          confidence: "optional",
          delivery: "main",
          conceptKeys: ["role-safety"],
          linkedRecheckQuestionId: null,
          choices: [
            {
              id: correctChoiceId,
              label: "Visible option A",
              isCorrect: true,
              feedback: AUTHORING_SECRETS[2],
            },
            {
              id: distractorChoiceId,
              label: "Visible option B",
              isCorrect: false,
              misconceptionKey: AUTHORING_SECRETS[3],
            },
          ],
          timeLimitSeconds: 60,
          basePoints: 1_000,
          explanation: AUTHORING_SECRETS[4],
          mediaId: null,
          mediaAlt: null,
          sourceCitations: [
            {
              sourceName: "private-source",
              sourceDigest: "b".repeat(64),
              locator: "internal-3",
              excerpt: AUTHORING_SECRETS[5],
            },
          ],
        },
      },
    ],
  });
  const content = PresentationContentSchema.parse(draft);
  await presentations.createPresentation({
    id: presentationId,
    workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: 2,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await presentations.publishPresentation(
    {
      id: presentationVersionId,
      workspaceId,
      presentationId,
      version: 1,
      content,
      contentSchemaVersion: 1,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  if (options.failCreateAudit) {
    vi.spyOn(repository, "recordAudit").mockRejectedValueOnce(new Error("audit unavailable"));
  }
  const hosted = await service.createSession({
    workspaceId,
    userId,
    presentationId,
    requestId: randomUUID(),
  });
  const joined = await service.join(hosted.snapshot.code, "River");
  return {
    repository,
    sessions,
    service,
    hosted,
    joined,
    ids: {
      workspaceId,
      userId,
      presentationId,
      contentBlockId,
      questionBlockId,
      correctChoiceId,
      distractorChoiceId,
    },
  };
}

function expectNoAuthoringSecrets(snapshot: unknown) {
  const serialized = JSON.stringify(snapshot);
  for (const secret of AUTHORING_SECRETS) expect(serialized).not.toContain(secret);
  for (const privateField of [
    "speakerNotes",
    "citations",
    "sourceDisclosure",
    "sourceCitations",
    "isCorrect",
    "feedback",
    "misconceptionKey",
    "explanation",
    "conceptKeys",
  ]) {
    expect(serialized).not.toContain(`"${privateField}"`);
  }
}

describe("PresentationSessionService realtime integration", () => {
  // Four real scrypt derivations retain production password checks on shared CI CPUs.
  it("requires paid protection and checks passwords only for new Presentation admissions", async () => {
    const { repository, sessions, service, ids, hosted: open, joined: openJoin } = await fixture();
    const input = {
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      presentationId: ids.presentationId,
      requestId: randomUUID(),
    };
    const password = " Case-sensitive room ";
    const create = vi.spyOn(sessions, "createSessionWithCredential");
    await expect(service.createSession({ ...input, joinPassword: password })).rejects.toMatchObject(
      { code: "ENTITLEMENT_LIMIT", status: 402 },
    );
    expect(create).not.toHaveBeenCalled();
    await repository.setPlan(ids.workspaceId, "pro");
    const hosted = await service.createSession({ ...input, joinPassword: password });
    const stored = await sessions.getSessionById(hosted.snapshot.sessionId);
    expect(stored?.joinPasswordHash).toBeTruthy();
    await expect(service.join(hosted.snapshot.code, "River")).rejects.toMatchObject({
      code: "PASSWORD_REQUIRED",
    });
    await expect(
      service.join(hosted.snapshot.code, "River", password.trim()),
    ).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await expect(
      service.join(hosted.snapshot.code, "River", password.toLowerCase()),
    ).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    expect(await sessions.listParticipants(hosted.snapshot.sessionId)).toHaveLength(0);
    const joined = await service.join(hosted.snapshot.code, "River", password);
    await repository.setPlan(ids.workspaceId, "free");
    await expect(service.join(hosted.snapshot.code, "Next")).rejects.toMatchObject({
      code: "PASSWORD_REQUIRED",
    });
    const recovered = await service.sync({
      sessionId: hosted.snapshot.sessionId,
      projection: "participant",
      participantToken: joined.participantToken,
    });
    expect(recovered.snapshot.projection).toBe("participant");
    const openRecovered = await service.getParticipantSnapshot(
      open.snapshot.sessionId,
      openJoin.participantToken,
    );
    for (const value of [hosted, joined, recovered, openRecovered]) {
      expect(JSON.stringify(value)).not.toContain(password);
      expect(JSON.stringify(value)).not.toContain(stored!.joinPasswordHash!);
      expect(JSON.stringify(value)).not.toContain("joinPasswordHash");
    }
  }, 15_000);

  it("returns a usable rotated companion pass when its audit fails without revoking the host", async () => {
    const { repository, service, hosted, ids } = await fixture();
    const sessionId = hosted.snapshot.sessionId;
    const input = {
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      sessionId,
      requestId: randomUUID(),
    };
    const previousPass = await service.createCompanionPass(input);
    const audit = vi
      .spyOn(repository, "recordAudit")
      .mockRejectedValueOnce(new Error("audit unavailable"));
    const rotated = await service.createCompanionPass({ ...input, requestId: randomUUID() });

    expect(rotated.credentialId).not.toBe(previousPass.credentialId);
    await expect(
      service.getCompanionSnapshot(sessionId, rotated.companionToken),
    ).resolves.toMatchObject({ projection: "companion" });
    await expect(
      service.getCompanionSnapshot(sessionId, previousPass.companionToken),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      service.companionCommand({
        sessionId,
        companionToken: rotated.companionToken,
        commandId: randomUUID(),
        expectedRevision: 0,
        action: "advance",
      }),
    ).resolves.toMatchObject({ projection: "companion", revision: 1 });
    await expect(
      service.sync({ sessionId, projection: "host", controlToken: hosted.controlToken }),
    ).resolves.toMatchObject({ snapshot: { projection: "host", revision: 1 } });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "presentation.session.companion_pass.create",
        metadata: { credentialId: rotated.credentialId },
      }),
    );
    const auditPayload = JSON.stringify(audit.mock.calls);
    for (const token of [rotated.companionToken, previousPass.companionToken, hosted.controlToken])
      expect(auditPayload).not.toContain(token);
  });

  it("rotates and revokes only companion credentials, with tenant and role fences", async () => {
    const { repository, sessions, service, hosted, joined, ids } = await fixture();
    const sessionId = hosted.snapshot.sessionId;
    const updated = vi.fn();
    service.setSessionUpdatedHandler(updated);
    const input = {
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      sessionId,
      requestId: randomUUID(),
    };
    await expect(
      service.createCompanionPass({ ...input, workspaceId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const pass = await service.createCompanionPass(input);
    expect(Date.parse(pass.expiresAt) - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(Date.parse(pass.expiresAt) - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    expect(
      await sessions.findValidCredential(sessionId, pass.companionToken, "companion"),
    ).toBeNull();
    expect(
      await sessions.findValidCredential(
        sessionId,
        presentationParticipantTokenHash(pass.companionToken),
        "companion",
      ),
    ).toMatchObject({ id: pass.credentialId });
    await expect(
      service.getCompanionSnapshot(sessionId, pass.companionToken),
    ).resolves.toMatchObject({ projection: "companion", resultSummary: null });
    await expect(
      service.getCompanionSnapshot(sessionId, hosted.controlToken),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      service.getCompanionSnapshot(sessionId, joined.participantToken),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      service.getCompanionSnapshot(randomUUID(), pass.companionToken),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      service.command({
        sessionId,
        controlToken: pass.companionToken,
        commandId: randomUUID(),
        expectedRevision: 0,
        action: "advance",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      service.revokeCompanionPass({ ...input, credentialId: hosted.controlCredentialId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const rotated = await service.createCompanionPass({ ...input, requestId: randomUUID() });
    await expect(
      service.getCompanionSnapshot(sessionId, pass.companionToken),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      service.sync({ sessionId, projection: "host", controlToken: hosted.controlToken }),
    ).resolves.toMatchObject({ snapshot: { projection: "host" } });
    await expect(
      service.revokeCompanionPass({
        ...input,
        workspaceId: randomUUID(),
        credentialId: rotated.credentialId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const audit = vi.spyOn(repository, "recordAudit");
    await service.revokeCompanionPass({ ...input, credentialId: rotated.credentialId });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "presentation.session.companion_pass.revoke",
        metadata: { credentialId: rotated.credentialId },
      }),
    );
    expect(updated).toHaveBeenCalledTimes(3);
    await expect(
      service.getCompanionSnapshot(sessionId, rotated.companionToken),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      service.sync({ sessionId, projection: "host", controlToken: hosted.controlToken }),
    ).resolves.toMatchObject({ snapshot: { projection: "host" } });
  });

  it("expires companion passes at one hour or the live deadline and refuses finished rooms", async () => {
    const { service, hosted, sessions, ids } = await fixture();
    const sessionId = hosted.snapshot.sessionId;
    const input = {
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      sessionId,
      requestId: randomUUID(),
    };
    const pass = await service.createCompanionPass(input);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.parse(pass.expiresAt)));
      await expect(
        service.getCompanionSnapshot(sessionId, pass.companionToken),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const session = (await sessions.getSessionById(sessionId))!;
      const nearDeadline = new Date(session.liveExpiresAt.getTime() - 30_000);
      vi.setSystemTime(nearDeadline);
      const nearExpiryPass = await service.createCompanionPass(input);
      expect(nearExpiryPass.expiresAt).toBe(session.liveExpiresAt.toISOString());
      vi.setSystemTime(session.liveExpiresAt);
      await expect(service.createCompanionPass(input)).rejects.toMatchObject({
        code: "PHASE_CLOSED",
      });
    } finally {
      vi.useRealTimers();
    }
    for (let revision = 0; revision < 4; revision += 1) {
      await service.command({
        sessionId,
        controlToken: hosted.controlToken,
        commandId: randomUUID(),
        expectedRevision: revision,
        action: "advance",
      });
    }
    await expect(service.createCompanionPass(input)).rejects.toMatchObject({
      code: "PHASE_CLOSED",
    });
  });

  it("advances with companion receipts after lost acknowledgements and returns safe summaries only after reveal", async () => {
    const { service, hosted, joined, ids } = await fixture();
    const sessionId = hosted.snapshot.sessionId;
    const pass = await service.createCompanionPass({
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      sessionId,
      requestId: randomUUID(),
    });
    const firstCommand = {
      sessionId,
      companionToken: pass.companionToken,
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "advance" as const,
    };
    await expect(service.companionCommand(firstCommand)).resolves.toMatchObject({
      projection: "companion",
      phase: "content",
      revision: 1,
    });
    const opened = await service.command({
      sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });
    await expect(service.companionCommand(firstCommand)).resolves.toMatchObject({
      projection: "companion",
      phase: "question_open",
      revision: 2,
    });
    await expect(
      service.companionCommand({ ...firstCommand, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      service.companionCommand({ ...firstCommand, commandId: randomUUID() }),
    ).rejects.toMatchObject({ code: "STALE_SESSION" });
    await expect(
      service.companionCommand({ ...firstCommand, action: "start_recovery_card" } as never),
    ).rejects.toMatchObject({ name: "ZodError" });
    await expect(
      service.companionCommand({ ...firstCommand, controlToken: hosted.controlToken } as never),
    ).rejects.toMatchObject({ name: "ZodError" });
    await service.submitResponse({
      sessionId,
      participantToken: joined.participantToken,
      blockId: ids.questionBlockId,
      expectedRevision: opened.revision,
      idempotencyKey: randomUUID(),
      response: { choiceIds: [ids.correctChoiceId], confidence: 3 },
    });
    const openSnapshot = await service.getCompanionSnapshot(sessionId, pass.companionToken);
    expect(openSnapshot.resultSummary).toBeNull();
    expectNoAuthoringSecrets(openSnapshot);
    const revealed = await service.companionCommand({
      ...firstCommand,
      commandId: randomUUID(),
      expectedRevision: 2,
    });
    expect(revealed.resultSummary).toEqual({
      blockId: ids.questionBlockId,
      responseCount: 1,
      choiceCounts: [
        { choiceId: ids.correctChoiceId, count: 1 },
        { choiceId: ids.distractorChoiceId, count: 0 },
      ],
    });
    expectNoAuthoringSecrets(revealed);
    for (const field of [
      "participants",
      "participantId",
      "correct",
      "score",
      "revealedAnswer",
      "choiceIds",
      "responseMs",
    ])
      expect(JSON.stringify(revealed)).not.toContain(`"${field}"`);
  });

  it("deletes finished room data and fences an already claimed report job", async () => {
    const { repository, sessions, service, hosted, joined, ids } = await fixture();
    const sessionId = hosted.snapshot.sessionId;
    const deleted = vi.fn();
    service.setSessionDeletedHandler(deleted);
    const companionToken = randomUUID();
    const currentSession = (await sessions.getSessionById(sessionId))!;
    await sessions.createCredential({
      id: randomUUID(),
      workspaceId: ids.workspaceId,
      sessionId,
      role: "companion",
      tokenHash: presentationParticipantTokenHash(companionToken),
      createdAt: new Date(),
      expiresAt: currentSession.liveExpiresAt,
      revokedAt: null,
    });
    for (let expectedRevision = 0; expectedRevision < 2; expectedRevision += 1) {
      await service.command({
        sessionId,
        controlToken: hosted.controlToken,
        commandId: randomUUID(),
        expectedRevision,
        action: "advance",
      });
    }
    await service.submitResponse({
      sessionId,
      participantToken: joined.participantToken,
      blockId: ids.questionBlockId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      response: { choiceIds: [ids.correctChoiceId], confidence: 3 },
    });
    for (let expectedRevision = 2; expectedRevision < 4; expectedRevision += 1) {
      await service.command({
        sessionId,
        controlToken: hosted.controlToken,
        commandId: randomUUID(),
        expectedRevision,
        action: "advance",
      });
    }
    expect(await sessions.getSessionById(sessionId)).toMatchObject({ status: "finished" });
    expect(await sessions.listParticipants(sessionId)).toHaveLength(1);
    expect(await sessions.listResponses(sessionId)).toHaveLength(1);
    expect(await sessions.listTimeline(sessionId)).toHaveLength(4);
    const now = new Date();
    const job = (await sessions.claimReportJob(now, new Date(now.getTime() + 60_000)))!;
    expect(job).toMatchObject({ sessionId, workspaceId: ids.workspaceId });

    await service.deleteSession({
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      sessionId,
      requestId: randomUUID(),
    });
    expect(deleted).toHaveBeenCalledExactlyOnceWith(sessionId);
    expect(await sessions.getSessionById(sessionId)).toBeNull();
    expect(await sessions.listParticipants(sessionId)).toEqual([]);
    expect(await sessions.listResponses(sessionId)).toEqual([]);
    expect(await sessions.listTimeline(sessionId)).toEqual([]);
    expect(await sessions.getReport(ids.workspaceId, sessionId)).toBeNull();
    expect(
      await sessions.findParticipant(
        sessionId,
        presentationParticipantTokenHash(joined.participantToken),
      ),
    ).toBeNull();
    expect(
      await sessions.findValidCredential(
        sessionId,
        presentationParticipantTokenHash(hosted.controlToken),
      ),
    ).toBeNull();
    expect(
      await sessions.findValidCredential(
        sessionId,
        presentationParticipantTokenHash(companionToken),
      ),
    ).toBeNull();
    expect(await repository.getLiveRoomCode(hosted.snapshot.code)).toBeNull();
    expect(
      repository.isLibraryArtifactReferenced(ids.workspaceId, "presentation", ids.presentationId),
    ).toBe(false);
    expect(
      await createPresentationRepository(repository).getPresentation(
        ids.workspaceId,
        ids.presentationId,
      ),
    ).not.toBeNull();

    await expect(
      sessions.completeReportJob(job, {
        reportId: job.reportId,
        sessionId,
        schemaVersion: 1,
        payload: { staleWorker: true },
        generatedAt: now,
      }),
    ).rejects.toThrow("no longer pending");
    await sessions.retryReportJob(job, "stale worker", now, false);
    expect(await sessions.getReport(ids.workspaceId, sessionId)).toBeNull();
    expect(await sessions.claimReportJob(now, new Date(now.getTime() + 60_000))).toBeNull();
    for (const input of [
      { sessionId, projection: "participant" as const, participantToken: joined.participantToken },
      { sessionId, projection: "host" as const, controlToken: hosted.controlToken },
      { sessionId, projection: "companion" as const, companionToken },
    ]) {
      await expect(service.sync(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(service.join(hosted.snapshot.code, "Late participant")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("keeps creation usable when audit delivery fails after the atomic session credential", async () => {
    const { service, sessions, hosted, ids } = await fixture({ failCreateAudit: true });

    await expect(sessions.listSessions(ids.workspaceId)).resolves.toHaveLength(1);
    await expect(
      service.sync({
        sessionId: hosted.snapshot.sessionId,
        projection: "host",
        controlToken: hosted.controlToken,
        afterSeq: 0,
      }),
    ).resolves.toMatchObject({ snapshot: { sessionId: hosted.snapshot.sessionId } });
  });

  it("derives REST fallback presence from recent participant heartbeats", async () => {
    const { service, sessions, hosted, ids } = await fixture();
    const staleAt = new Date(Date.now() - 60_000);
    await sessions.addParticipant({
      id: randomUUID(),
      workspaceId: ids.workspaceId,
      sessionId: hosted.snapshot.sessionId,
      nickname: "Disconnected",
      tokenHash: presentationParticipantTokenHash(randomUUID()),
      joinedAt: staleAt,
      lastSeenAt: staleAt,
    });

    await expect(
      service.getHostSnapshot(ids.workspaceId, hosted.snapshot.sessionId),
    ).resolves.toMatchObject({
      roomStatus: {
        joinedCount: 2,
        connectedCount: 1,
        notCurrentlyConnectedCount: 1,
      },
    });
  });

  it("issues a host credential and returns role-safe canonical snapshots", async () => {
    const { service, hosted, joined } = await fixture();
    expect(hosted.controlToken).toMatch(/^[^.]+\.[^.]+$/);
    expect(hosted.controlToken.length).toBeGreaterThanOrEqual(32);
    expect(hosted.snapshot).toMatchObject({
      projection: "host",
      phase: "lobby",
      revision: 0,
      seq: 0,
      settings: { timeMode: "timed", trustMode: "learning" },
    });

    const firstCommandId = randomUUID();
    const content = await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: firstCommandId,
      expectedRevision: 0,
      action: "advance",
    });
    expect(content).toMatchObject({
      projection: "host",
      phase: "content",
      currentBlock: {
        kind: "content",
        textElements: expect.arrayContaining([
          expect.objectContaining({ role: "title", text: "Safe live title" }),
        ]),
      },
      settings: { timeMode: "timed", trustMode: "learning" },
    });
    expectNoAuthoringSecrets(content);

    const question = await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });
    expect(question).toMatchObject({
      phase: "question_open",
      revision: 2,
      seq: 3,
      currentBlock: {
        kind: "question",
        question: { purpose: "diagnostic" },
      },
    });
    expect(question.currentBlock?.kind).toBe("question");
    if (question.currentBlock?.kind === "question") {
      expect(question.currentBlock.question.choices[0]).toMatchObject({
        label: "Visible option A",
      });
    }

    const hostSync = await service.sync({
      sessionId: hosted.snapshot.sessionId,
      projection: "host",
      controlToken: hosted.controlToken,
      afterSeq: 0,
    });
    const participantSync = await service.sync({
      sessionId: hosted.snapshot.sessionId,
      projection: "participant",
      participantToken: joined.participantToken,
      afterSeq: 0,
    });
    expect(hostSync.snapshot).toMatchObject({
      projection: "host",
      settings: { timeMode: "timed", trustMode: "learning" },
      participants: [{ nickname: "River" }],
    });
    expect(participantSync.snapshot).toMatchObject({
      projection: "participant",
      settings: { timeMode: "timed", trustMode: "learning" },
      participantCount: 1,
    });
    expect(participantSync.snapshot).not.toHaveProperty("participants");
    expect(participantSync.snapshot).not.toHaveProperty("roomStatus");
    expect(participantSync.snapshot).not.toHaveProperty("currentBlock.question.purpose");
    expectNoAuthoringSecrets(hostSync.snapshot);
    expectNoAuthoringSecrets(participantSync.snapshot);

    await expect(
      service.sync({
        sessionId: hosted.snapshot.sessionId,
        projection: "host",
        controlToken: joined.participantToken,
        afterSeq: 0,
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    } satisfies Partial<PresentationSessionServiceError>);
    await expect(
      service.sync({
        sessionId: hosted.snapshot.sessionId,
        projection: "participant",
        participantToken: hosted.controlToken,
        afterSeq: 0,
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    } satisfies Partial<PresentationSessionServiceError>);
  });

  it("rotates and explicitly revokes host control passes", async () => {
    const { service, hosted, ids } = await fixture();
    const pass = await service.createControlPass({
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      sessionId: hosted.snapshot.sessionId,
      requestId: randomUUID(),
    });

    await expect(
      service.sync({
        sessionId: hosted.snapshot.sessionId,
        projection: "host",
        controlToken: hosted.controlToken,
        afterSeq: 0,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await expect(
      service.sync({
        sessionId: hosted.snapshot.sessionId,
        projection: "host",
        controlToken: pass.controlToken,
        afterSeq: 0,
      }),
    ).resolves.toMatchObject({ snapshot: { projection: "host" } });

    await service.revokeControlPass({
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      sessionId: hosted.snapshot.sessionId,
      credentialId: pass.credentialId,
      requestId: randomUUID(),
    });

    await expect(
      service.sync({
        sessionId: hosted.snapshot.sessionId,
        projection: "host",
        controlToken: pass.controlToken,
        afterSeq: 0,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("resolves command and response idempotency before stale-state rejection", async () => {
    const { service, sessions, hosted, joined, ids } = await fixture();
    const contentCommandId = randomUUID();
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: contentCommandId,
      expectedRevision: 0,
      action: "advance",
    });
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });

    const commandRetry = await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: contentCommandId,
      expectedRevision: 0,
      action: "advance",
    });
    expect(commandRetry).toMatchObject({ phase: "question_open", revision: 2, seq: 3 });
    await expect(
      service.command({
        sessionId: hosted.snapshot.sessionId,
        controlToken: hosted.controlToken,
        commandId: contentCommandId,
        expectedRevision: 2,
        action: "advance",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const idempotencyKey = randomUUID();
    const submitted = await service.submitResponse({
      sessionId: hosted.snapshot.sessionId,
      participantToken: joined.participantToken,
      blockId: ids.questionBlockId,
      expectedRevision: 2,
      idempotencyKey,
      response: { choiceIds: [ids.correctChoiceId], confidence: 2 as const },
    });
    expect(submitted).toMatchObject({
      accepted: true,
      duplicate: false,
      blockId: ids.questionBlockId,
      idempotencyKey,
      snapshot: { revision: 2, seq: 4, responseSubmitted: true },
    });

    const openHost = await service.sync({
      sessionId: hosted.snapshot.sessionId,
      projection: "host",
      controlToken: hosted.controlToken,
      afterSeq: 2,
    });
    expect(openHost.snapshot).toMatchObject({
      projection: "host",
      phase: "question_open",
      seq: 4,
      participants: [{ nickname: "River", score: 0 }],
    });
    expect(openHost.snapshot.seq).toBe(submitted.snapshot.seq);

    const revealed = await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 2,
      action: "advance",
    });
    expect(revealed).toMatchObject({
      phase: "question_reveal",
      participants: [{ nickname: "River", score: 1_000 }],
    });
    const recoveredAck = await service.submitResponse({
      sessionId: hosted.snapshot.sessionId,
      participantToken: joined.participantToken,
      blockId: ids.questionBlockId,
      expectedRevision: 2,
      idempotencyKey,
      response: { choiceIds: [ids.correctChoiceId], confidence: 2 },
    });
    expect(recoveredAck).toMatchObject({
      accepted: true,
      duplicate: true,
      responseId: submitted.responseId,
      acceptedAt: submitted.acceptedAt,
      snapshot: {
        phase: "question_reveal",
        revision: 3,
        seq: 5,
        responseSubmitted: true,
        standing: { rank: 1, score: 1_000 },
        responseResult: { correct: true, score: 1_000 },
      },
    });
    await expect(
      service.submitResponse({
        sessionId: hosted.snapshot.sessionId,
        participantToken: joined.participantToken,
        blockId: ids.questionBlockId,
        expectedRevision: 2,
        idempotencyKey,
        response: { choiceIds: [], confidence: 3 },
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    } satisfies Partial<PresentationSessionServiceError>);
    const getResponseContext = sessions.getResponseContext.bind(sessions);
    vi.spyOn(sessions, "getResponseContext").mockImplementationOnce(async (...args) => {
      const context = await getResponseContext(...args);
      return context ? { ...context, priorResponse: null } : null;
    });
    await expect(
      service.submitResponse({
        sessionId: hosted.snapshot.sessionId,
        participantToken: joined.participantToken,
        blockId: randomUUID(),
        expectedRevision: 2,
        idempotencyKey,
        response: { choiceIds: [ids.correctChoiceId], confidence: 2 as const },
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    } satisfies Partial<PresentationSessionServiceError>);
  });

  it("closes new live mutations during workspace deletion while replaying durable receipts", async () => {
    const { repository, service, hosted, joined, ids } = await fixture();
    const contentCommandId = randomUUID();
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: contentCommandId,
      expectedRevision: 0,
      action: "advance",
    });
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });
    const responseInput = {
      sessionId: hosted.snapshot.sessionId,
      participantToken: joined.participantToken,
      blockId: ids.questionBlockId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      response: { choiceIds: [ids.correctChoiceId], confidence: 2 as const },
    };
    const accepted = await service.submitResponse(responseInput);

    await repository.claimWorkspaceMediaDeletion(ids.workspaceId);

    await expect(
      service.command({
        sessionId: hosted.snapshot.sessionId,
        controlToken: hosted.controlToken,
        commandId: contentCommandId,
        expectedRevision: 0,
        action: "advance",
      }),
    ).resolves.toMatchObject({ phase: "question_open", revision: 2 });
    await expect(service.submitResponse(responseInput)).resolves.toMatchObject({
      responseId: accepted.responseId,
      duplicate: true,
    });

    await expect(service.join(hosted.snapshot.code, "Late learner")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    } satisfies Partial<PresentationSessionServiceError>);
    await expect(
      service.command({
        sessionId: hosted.snapshot.sessionId,
        controlToken: hosted.controlToken,
        commandId: randomUUID(),
        expectedRevision: 2,
        action: "advance",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "PHASE_CLOSED",
    } satisfies Partial<PresentationSessionServiceError>);
    await expect(
      service.advance({
        workspaceId: ids.workspaceId,
        userId: ids.userId,
        sessionId: hosted.snapshot.sessionId,
        expectedRevision: 2,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "PHASE_CLOSED",
    } satisfies Partial<PresentationSessionServiceError>);
    await expect(
      service.submitResponse({ ...responseInput, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({
      status: 409,
      code: "PHASE_CLOSED",
    } satisfies Partial<PresentationSessionServiceError>);
  });

  it("recovers the original durable receipt when acknowledgement delivery fails after acceptance", async () => {
    const { service, sessions, hosted, joined, ids } = await fixture();
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "advance",
    });
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });
    const beforeResponse = await sessions.getSessionById(hosted.snapshot.sessionId);
    expect(beforeResponse).toMatchObject({ revision: 2, eventSeq: 3 });

    const acceptResponse = sessions.acceptResponse.bind(sessions);
    let failFirstAcceptedAcknowledgement = true;
    vi.spyOn(sessions, "acceptResponse").mockImplementation(async (...args) => {
      const acceptance = await acceptResponse(...args);
      if (failFirstAcceptedAcknowledgement && acceptance.status === "accepted") {
        failFirstAcceptedAcknowledgement = false;
        throw new Error("acknowledgement projection unavailable");
      }
      return acceptance;
    });
    const receivedAt = new Date();
    const input = {
      sessionId: hosted.snapshot.sessionId,
      participantToken: joined.participantToken,
      blockId: ids.questionBlockId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      response: { choiceIds: [ids.correctChoiceId], confidence: 2 as const },
      receivedAt,
    };

    await expect(service.submitResponse(input)).rejects.toThrow(
      "acknowledgement projection unavailable",
    );
    const durableResponses = await sessions.listResponses(hosted.snapshot.sessionId);
    expect(durableResponses).toEqual([
      expect.objectContaining({
        blockId: ids.questionBlockId,
        idempotencyKey: input.idempotencyKey,
        score: 1_000,
        submittedAt: receivedAt,
      }),
    ]);
    const durableReceipt = durableResponses[0]!;
    await expect(sessions.getSessionById(hosted.snapshot.sessionId)).resolves.toMatchObject({
      revision: beforeResponse!.revision,
      eventSeq: beforeResponse!.eventSeq + 1,
    });

    const recovered = await service.submitResponse(input);

    expect(recovered).toMatchObject({
      accepted: true,
      duplicate: true,
      responseId: durableReceipt.id,
      acceptedAt: receivedAt.toISOString(),
      snapshot: {
        revision: beforeResponse!.revision,
        seq: beforeResponse!.eventSeq + 1,
        responseSubmitted: true,
      },
    });
    const responsesAfterRetry = await sessions.listResponses(hosted.snapshot.sessionId);
    expect(responsesAfterRetry).toHaveLength(1);
    expect(responsesAfterRetry.reduce((total, response) => total + response.score, 0)).toBe(1_000);
    await expect(sessions.getSessionById(hosted.snapshot.sessionId)).resolves.toMatchObject({
      revision: beforeResponse!.revision,
      eventSeq: beforeResponse!.eventSeq + 1,
    });
  });

  it("does not move response fences for duplicate, conflict, already-responded, or stale attempts", async () => {
    const { service, sessions, hosted, joined, ids } = await fixture();
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "advance",
    });
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });
    const idempotencyKey = randomUUID();
    const acceptedInput = {
      sessionId: hosted.snapshot.sessionId,
      participantToken: joined.participantToken,
      blockId: ids.questionBlockId,
      expectedRevision: 2,
      idempotencyKey,
      response: { choiceIds: [ids.correctChoiceId], confidence: 2 as const },
    };
    await expect(service.submitResponse(acceptedInput)).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      snapshot: { revision: 2, seq: 4 },
    });
    const acceptedSession = await sessions.getSessionById(hosted.snapshot.sessionId);
    expect(acceptedSession).toMatchObject({ revision: 2, eventSeq: 4 });

    const attempts = [
      {
        name: "duplicate",
        run: () => service.submitResponse(acceptedInput),
        expected: { duplicate: true },
      },
      {
        name: "idempotency conflict",
        run: () =>
          service.submitResponse({
            ...acceptedInput,
            response: { choiceIds: [ids.distractorChoiceId], confidence: 3 as const },
          }),
        errorCode: "IDEMPOTENCY_CONFLICT",
      },
      {
        name: "different key for the same block",
        run: () => service.submitResponse({ ...acceptedInput, idempotencyKey: randomUUID() }),
        errorCode: "ALREADY_RESPONDED",
      },
      {
        name: "stale revision",
        run: () =>
          service.submitResponse({
            ...acceptedInput,
            expectedRevision: 1,
            idempotencyKey: randomUUID(),
          }),
        errorCode: "STALE_SESSION",
      },
    ];

    for (const attempt of attempts) {
      if ("errorCode" in attempt) {
        await expect(attempt.run(), attempt.name).rejects.toMatchObject({
          code: attempt.errorCode,
          status: 409,
        });
      } else {
        await expect(attempt.run(), attempt.name).resolves.toMatchObject(attempt.expected);
      }
      await expect(sessions.getSessionById(hosted.snapshot.sessionId)).resolves.toMatchObject({
        revision: acceptedSession!.revision,
        eventSeq: acceptedSession!.eventSeq,
      });
      await expect(sessions.listResponses(hosted.snapshot.sessionId)).resolves.toHaveLength(1);
    }
  });

  it("audits an accepted realtime finish once with the command identity", async () => {
    const { repository, service, hosted, ids } = await fixture();
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "advance",
    });
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 2,
      action: "advance",
    });
    const finishCommandId = randomUUID();
    const finishCommand = {
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: finishCommandId,
      expectedRevision: 3,
      action: "advance" as const,
    };

    await expect(service.command(finishCommand)).resolves.toMatchObject({ status: "finished" });
    await expect(service.command(finishCommand)).resolves.toMatchObject({ status: "finished" });

    expect(
      repository.audits.filter(({ action }) => action === "presentation.session.finish"),
    ).toEqual([
      expect.objectContaining({
        workspaceId: ids.workspaceId,
        actorId: null,
        targetType: "presentation_live_session",
        targetId: hosted.snapshot.sessionId,
        requestId: finishCommandId,
      }),
    ]);
  });

  it("acknowledges a cold response projection without loading participant or response history", async () => {
    const { repository, service, sessions, hosted, joined, ids } = await fixture();
    await service.join(hosted.snapshot.code, "Second learner");
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "advance",
    });
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });
    const coldService = new PresentationSessionService({
      repository,
      presentations: createPresentationRepository(repository),
      sessions,
      config,
      storage: new StorageService(config, null),
    });
    const participantReads = vi.spyOn(sessions, "listParticipants");
    const responseReads = vi.spyOn(sessions, "listResponses");
    const targetedReads = vi.spyOn(sessions, "getParticipantSnapshotProjection");
    const idempotencyKey = randomUUID();
    const input = {
      sessionId: hosted.snapshot.sessionId,
      participantToken: joined.participantToken,
      blockId: ids.questionBlockId,
      expectedRevision: 2,
      idempotencyKey,
      response: { choiceIds: [ids.correctChoiceId], confidence: 2 as const },
    };

    const accepted = await coldService.submitResponse(input);
    const duplicate = await coldService.submitResponse(input);

    expect(PresentationResponseAckSchema.parse(accepted)).toMatchObject({
      accepted: true,
      duplicate: false,
      snapshot: {
        participantCount: 2,
        responseSubmitted: true,
        responseReceipt: {
          responseId: accepted.responseId,
          blockId: ids.questionBlockId,
          idempotencyKey,
          acceptedAt: accepted.acceptedAt,
        },
      },
    });
    expect(duplicate).toMatchObject({
      duplicate: true,
      responseId: accepted.responseId,
      snapshot: { participantCount: 2, responseSubmitted: true },
    });
    expect(participantReads).not.toHaveBeenCalled();
    expect(responseReads).not.toHaveBeenCalled();
    expect(targetedReads).not.toHaveBeenCalled();
  });

  it("acknowledges a durable response while concurrent participant events advance the sequence", async () => {
    const { service, sessions, hosted, joined, ids } = await fixture();
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "advance",
    });
    await service.command({
      sessionId: hosted.snapshot.sessionId,
      controlToken: hosted.controlToken,
      commandId: randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });
    const originalAcceptance = sessions.acceptResponse.bind(sessions);
    let acceptedSequence: number | null = null;
    const acceptanceWrites = vi
      .spyOn(sessions, "acceptResponse")
      .mockImplementation(async (...args) => {
        const acceptance = await originalAcceptance(...args);
        if (acceptance.status === "accepted") {
          acceptedSequence = acceptance.acknowledgement.session.eventSeq;
        }
        const joinedAt = new Date();
        await sessions.addParticipant({
          id: randomUUID(),
          workspaceId: ids.workspaceId,
          sessionId: hosted.snapshot.sessionId,
          nickname: "Concurrent learner",
          tokenHash: presentationParticipantTokenHash(randomUUID()),
          joinedAt,
          lastSeenAt: joinedAt,
        });
        return acceptance;
      });

    const acknowledgement = await service.submitResponse({
      sessionId: hosted.snapshot.sessionId,
      participantToken: joined.participantToken,
      blockId: ids.questionBlockId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      response: { choiceIds: [ids.correctChoiceId], confidence: 2 },
    });
    expect(acknowledgement).toMatchObject({
      accepted: true,
      duplicate: false,
      snapshot: { participantCount: 1, responseSubmitted: true, revision: 2 },
    });
    const current = await sessions.getSessionById(hosted.snapshot.sessionId);
    expect(current).not.toBeNull();
    expect(acknowledgement.snapshot.seq).toBe(acceptedSequence);
    expect(acknowledgement.snapshot.seq).toBeLessThan(current?.eventSeq ?? 0);
    expect(acceptanceWrites).toHaveBeenCalledTimes(1);
  });

  it("builds a room broadcast from one participant and response aggregate read", async () => {
    const { service, sessions, hosted, joined } = await fixture();
    const participantReads = vi.spyOn(sessions, "listParticipants");
    const responseReads = vi.spyOn(sessions, "listResponses");
    const inputs = [
      {
        sessionId: hosted.snapshot.sessionId,
        projection: "host" as const,
        controlTokenHash: presentationParticipantTokenHash(hosted.controlToken),
        afterSeq: 0,
      },
      ...Array.from({ length: 25 }, () => ({
        sessionId: hosted.snapshot.sessionId,
        projection: "participant" as const,
        participantTokenHash: presentationParticipantTokenHash(joined.participantToken),
        afterSeq: 0,
      })),
    ];

    const synchronized = await service.syncManyByCredentialHash(inputs);

    expect(synchronized).toHaveLength(inputs.length);
    expect(synchronized.every(Boolean)).toBe(true);
    expect(participantReads).toHaveBeenCalledTimes(1);
    expect(responseReads).toHaveBeenCalledTimes(1);
  });

  it("rebuilds explicit sync projections when aggregate data crosses the sequence fence", async () => {
    const { service, sessions, hosted, ids } = await fixture();
    const originalListResponses = sessions.listResponses.bind(sessions);
    const responseReads = vi
      .spyOn(sessions, "listResponses")
      .mockImplementationOnce(async (sessionId) => {
        const responses = await originalListResponses(sessionId);
        const joinedAt = new Date();
        await sessions.addParticipant({
          id: randomUUID(),
          workspaceId: ids.workspaceId,
          sessionId,
          nickname: "Reconnect race",
          tokenHash: presentationParticipantTokenHash(randomUUID()),
          joinedAt,
          lastSeenAt: joinedAt,
        });
        return responses;
      });

    const synchronized = await service.sync({
      sessionId: hosted.snapshot.sessionId,
      projection: "host",
      controlToken: hosted.controlToken,
      afterSeq: 0,
    });

    expect(responseReads).toHaveBeenCalledTimes(2);
    expect(synchronized.snapshot).toMatchObject({
      projection: "host",
      participantCount: 2,
      seq: 2,
    });
  });

  it("rebuilds broadcast projections when aggregate data crosses an event-sequence fence", async () => {
    const { service, sessions, hosted, ids } = await fixture();
    const originalListResponses = sessions.listResponses.bind(sessions);
    const responseReads = vi
      .spyOn(sessions, "listResponses")
      .mockImplementationOnce(async (sessionId) => {
        const responses = await originalListResponses(sessionId);
        const joinedAt = new Date();
        await sessions.addParticipant({
          id: randomUUID(),
          workspaceId: ids.workspaceId,
          sessionId,
          nickname: "Late joiner",
          tokenHash: presentationParticipantTokenHash(randomUUID()),
          joinedAt,
          lastSeenAt: joinedAt,
        });
        return responses;
      });

    const synchronized = await service.syncManyByCredentialHash([
      {
        sessionId: hosted.snapshot.sessionId,
        projection: "host",
        controlTokenHash: presentationParticipantTokenHash(hosted.controlToken),
        afterSeq: 0,
      },
    ]);

    expect(responseReads).toHaveBeenCalledTimes(2);
    expect(synchronized[0]?.snapshot).toMatchObject({
      projection: "host",
      participantCount: 2,
      seq: 2,
    });
  });

  it("reports an exhausted broadcast fence as transient instead of rejecting every credential", async () => {
    const { service, sessions, hosted, ids } = await fixture();
    const originalListResponses = sessions.listResponses.bind(sessions);
    const responseReads = vi
      .spyOn(sessions, "listResponses")
      .mockImplementation(async (sessionId) => {
        const responses = await originalListResponses(sessionId);
        const joinedAt = new Date();
        await sessions.addParticipant({
          id: randomUUID(),
          workspaceId: ids.workspaceId,
          sessionId,
          nickname: "Concurrent joiner",
          tokenHash: presentationParticipantTokenHash(randomUUID()),
          joinedAt,
          lastSeenAt: joinedAt,
        });
        return responses;
      });

    await expect(
      service.syncManyByCredentialHash([
        {
          sessionId: hosted.snapshot.sessionId,
          projection: "host",
          controlTokenHash: presentationParticipantTokenHash(hosted.controlToken),
          afterSeq: 0,
        },
      ]),
    ).rejects.toMatchObject({
      name: "PresentationBroadcastConsistencyError",
      sessionId: hosted.snapshot.sessionId,
    } satisfies Partial<PresentationBroadcastConsistencyError>);
    expect(responseReads).toHaveBeenCalledTimes(3);
  });

  it("enforces institution identity at session creation and direct join boundaries", async () => {
    const { repository, service, hosted, ids } = await fixture();
    const policy = await repository.getInstitutionPolicy(ids.workspaceId);
    repository.institutionPolicies.set(ids.workspaceId, {
      ...policy,
      contractStatus: "pilot",
      identityRequirement: "institution",
      updatedAt: new Date(),
    });

    await expect(service.join(hosted.snapshot.code, "Anonymous learner")).rejects.toMatchObject({
      status: 403,
      code: "INSTITUTION_AUTH_REQUIRED",
    } satisfies Partial<PresentationSessionServiceError>);
    await expect(
      service.createSession({
        workspaceId: ids.workspaceId,
        userId: ids.userId,
        presentationId: ids.presentationId,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "INSTITUTION_AUTH_REQUIRED",
    } satisfies Partial<PresentationSessionServiceError>);
  });
});
