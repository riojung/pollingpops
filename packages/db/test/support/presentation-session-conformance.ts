import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import type {
  PresentationContent,
  PresentationRecoveryPackIntervention,
} from "@openround/contracts";
import {
  WorkspaceDeletionInProgressError,
  type PresentationSessionRepository,
  type PresentationSessionCommandInput,
  type PresentationSessionResponseRecord,
} from "../../src/index.js";
/*
 * This suite intentionally exercises both durable backends through their public repository
 * contract. The deletion hook is supplied by the owning repository because Presentation session
 * repositories do not own account lifecycle state.
 */
export interface PresentationSessionRepositoryConformanceInput {
  repository: PresentationSessionRepository;
  workspaceId: string;
  presentationId: string;
  presentationVersionId: string;
  createdBy: string;
  content: PresentationContent;
  beginWorkspaceDeletion(): Promise<void>;
}

export function presentationSessionConformanceContent(): PresentationContent {
  return {
    title: "Presentation repository conformance",
    description: "Shared memory and PostgreSQL behavior",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    blocks: [
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: randomUUID(),
          type: "numeric",
          prompt: "How many accepted responses should one participant create per block?",
          correctValue: "1",
          tolerance: "0",
          unit: null,
          purpose: "diagnostic",
          confidence: "off",
          delivery: "main",
          conceptKeys: ["repository.conformance"],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "Only the first valid response is accepted.",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  };
}

export async function expectPresentationSessionRepositoryConformance(
  input: PresentationSessionRepositoryConformanceInput,
) {
  const questionBlock = input.content.blocks.find((block) => block.kind === "question");
  if (!questionBlock || questionBlock.question.type !== "numeric") {
    throw new Error("Presentation repository conformance requires one numeric question");
  }

  const now = new Date();
  const sessionId = randomUUID();
  const participantId = randomUUID();
  const openCommandId = randomUUID();
  const responseIdempotencyKey = randomUUID();
  const responseRequestHash = "a".repeat(64);
  const session = await input.repository.createSession({
    id: sessionId,
    workspaceId: input.workspaceId,
    presentationId: input.presentationId,
    presentationVersionId: input.presentationVersionId,
    title: input.content.title,
    content: input.content,
    code: String(randomInt(1_000_000, 10_000_000)),
    joinPasswordHash: "salted-presentation-verifier",
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    revision: 0,
    settings: { timeMode: "flex" },
    trustMode: "learning",
    eventSeq: 0,
    questionOpenedAt: null,
    questionClosesAt: null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 60 * 60_000),
    retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
  });
  expect(session).toMatchObject({
    phase: "lobby",
    revision: 0,
    eventSeq: 0,
    recoveryPackCardsEnabled: false,
    recoveryPackIntervention: null,
    joinPasswordHash: "salted-presentation-verifier",
  });
  expect((await input.repository.getSessionByCode(session.code))?.joinPasswordHash).toBe(
    "salted-presentation-verifier",
  );
  expect(session.settings).not.toHaveProperty("joinPasswordHash");

  const openCommand = {
    workspaceId: input.workspaceId,
    sessionId,
    commandId: openCommandId,
    expectedRevision: 0,
    phase: "question_open" as const,
    currentBlockIndex: 0,
    status: "active" as const,
    occurredAt: now,
    questionOpenedAt: now,
    questionClosesAt: new Date(now.getTime() + 30_000),
    event: {
      type: "question.launched" as const,
      blockIndex: 0,
      blockId: questionBlock.id,
    },
  };
  const opened = await input.repository.transitionSessionCommand(openCommand);
  expect(opened).toMatchObject({
    status: "accepted",
    session: {
      phase: "question_open",
      revision: 1,
      eventSeq: 1,
      settings: { timeMode: "flex" },
      questionOpenedAt: now,
      questionClosesAt: null,
    },
  });
  await expect(input.repository.transitionSessionCommand(openCommand)).resolves.toMatchObject({
    status: "duplicate",
    session: { revision: 1, eventSeq: 1, questionClosesAt: null },
  });

  const participant = {
    id: participantId,
    workspaceId: input.workspaceId,
    sessionId,
    nickname: "Conformance learner",
    tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    joinedAt: new Date(now.getTime() + 100),
    lastSeenAt: new Date(now.getTime() + 100),
  };
  await expect(input.repository.joinParticipantWithinLimit(participant, 20)).resolves.toEqual({
    status: "accepted",
    participant,
  });
  await expect(
    input.repository.getSessionForWorkspace(input.workspaceId, sessionId),
  ).resolves.toMatchObject({ revision: 1, eventSeq: 2 });

  const response = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    sessionId,
    participantId,
    blockId: questionBlock.id,
    questionId: questionBlock.question.id,
    response: { numericValue: "1" },
    correct: true,
    score: 1_000,
    responseMs: 1_000,
    submittedAt: new Date(now.getTime() + 1_000),
    idempotencyKey: responseIdempotencyKey,
    requestHash: responseRequestHash,
  } satisfies PresentationSessionResponseRecord;
  const accepted = await input.repository.acceptResponse(response, 1);
  expect(accepted).toMatchObject({
    status: "accepted",
    response: { id: response.id, requestHash: responseRequestHash },
    acknowledgement: {
      session: { phase: "question_open", revision: 1, eventSeq: 3 },
      projection: {
        participantCount: 1,
        standing: null,
        currentResponse: { id: response.id },
      },
    },
  });

  await expect(
    input.repository.acceptResponse({ ...response, id: randomUUID() }, 0),
  ).resolves.toMatchObject({
    status: "duplicate",
    response: { id: response.id },
    acknowledgement: { session: { revision: 1, eventSeq: 3 } },
  });
  await expect(
    input.repository.acceptResponse(
      { ...response, id: randomUUID(), requestHash: "b".repeat(64) },
      0,
    ),
  ).resolves.toMatchObject({ status: "idempotency_conflict", response: { id: response.id } });
  await expect(
    input.repository.acceptResponse(
      {
        ...response,
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        requestHash: "c".repeat(64),
      },
      1,
    ),
  ).resolves.toMatchObject({ status: "already_responded", response: { id: response.id } });
  await expect(
    input.repository.getSessionForWorkspace(input.workspaceId, sessionId),
  ).resolves.toMatchObject({ revision: 1, eventSeq: 3 });

  const revealed = await input.repository.transitionSessionCommand({
    workspaceId: input.workspaceId,
    sessionId,
    commandId: randomUUID(),
    expectedRevision: 1,
    phase: "question_reveal",
    currentBlockIndex: 0,
    status: "active",
    occurredAt: new Date(now.getTime() + 2_000),
    event: { type: "question.revealed", blockIndex: 0, blockId: questionBlock.id },
  });
  expect(revealed).toMatchObject({
    status: "accepted",
    session: {
      phase: "question_reveal",
      revision: 2,
      eventSeq: 4,
      questionOpenedAt: null,
      questionClosesAt: null,
    },
  });

  await expect(
    input.repository.acceptResponse({ ...response, id: randomUUID() }, 1),
  ).resolves.toMatchObject({
    status: "duplicate",
    acknowledgement: {
      session: { phase: "question_reveal", revision: 2, eventSeq: 4 },
      projection: {
        participantCount: 1,
        standing: { rank: 1, score: 1_000 },
        currentResponse: { id: response.id },
      },
    },
  });
  await expect(input.repository.listResponses(sessionId)).resolves.toEqual([
    expect.objectContaining({ id: response.id }),
  ]);
  await expect(input.repository.listTimeline(sessionId)).resolves.toEqual([
    expect.objectContaining({
      sequence: 1,
      type: "question.launched",
      revealedParticipantIds: null,
    }),
    expect.objectContaining({
      sequence: 4,
      type: "question.revealed",
      revealedParticipantIds: [participantId],
    }),
  ]);

  const rosterSession = await input.repository.createSession({
    ...session,
    id: randomUUID(),
    code: String(randomInt(1_000_000, 10_000_000)),
    phase: "question_open",
    currentBlockIndex: 0,
    questionOpenedAt: now,
  });
  const skippedParticipant = {
    ...participant,
    id: randomUUID(),
    sessionId: rosterSession.id,
    tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
  };
  await input.repository.joinParticipantWithinLimit(skippedParticipant, 20);
  await input.repository.transitionSession({
    workspaceId: input.workspaceId,
    sessionId: rosterSession.id,
    expectedRevision: 0,
    phase: "question_reveal",
    currentBlockIndex: 0,
    status: "active",
    occurredAt: new Date(now.getTime() + 2_000),
    event: { type: "question.revealed", blockIndex: 0, blockId: questionBlock.id },
  });
  await input.repository.joinParticipantWithinLimit(
    {
      ...skippedParticipant,
      id: randomUUID(),
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      joinedAt: new Date(now.getTime() - 1_000),
    },
    20,
  );
  // Capture includes a participant who skipped the question and remains frozen after a late
  // admission, even when that admission carries an earlier request-time join timestamp.
  await expect(input.repository.listTimeline(rosterSession.id)).resolves.toEqual([
    expect.objectContaining({ revealedParticipantIds: [skippedParticipant.id] }),
  ]);

  await input.beginWorkspaceDeletion();

  // Existing receipts remain recoverable after the deletion fence closes new mutations.
  await expect(input.repository.transitionSessionCommand(openCommand)).resolves.toMatchObject({
    status: "duplicate",
    session: { revision: 2, eventSeq: 4 },
  });
  await expect(
    input.repository.transitionSessionCommand({ ...openCommand, expectedRevision: 1 }),
  ).resolves.toMatchObject({
    status: "idempotency_conflict",
    session: { revision: 2, eventSeq: 4 },
  });
  await expect(
    input.repository.acceptResponse({ ...response, id: randomUUID() }, 0),
  ).resolves.toMatchObject({
    status: "duplicate",
    response: { id: response.id },
    acknowledgement: { session: { revision: 2, eventSeq: 4 } },
  });
  await expect(
    input.repository.acceptResponse(
      { ...response, id: randomUUID(), requestHash: "d".repeat(64) },
      0,
    ),
  ).resolves.toMatchObject({ status: "idempotency_conflict", response: { id: response.id } });

  await expect(
    input.repository.joinParticipantWithinLimit(
      {
        ...participant,
        id: randomUUID(),
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      },
      20,
    ),
  ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
  await expect(
    input.repository.transitionSessionCommand({
      workspaceId: input.workspaceId,
      sessionId,
      commandId: randomUUID(),
      expectedRevision: 2,
      phase: "finished",
      currentBlockIndex: 0,
      status: "finished",
      occurredAt: new Date(now.getTime() + 3_000),
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    }),
  ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
  await expect(
    input.repository.transitionSession({
      workspaceId: input.workspaceId,
      sessionId,
      expectedRevision: 2,
      phase: "finished",
      currentBlockIndex: 0,
      status: "finished",
      occurredAt: new Date(now.getTime() + 3_000),
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    }),
  ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
  await expect(
    input.repository.acceptResponse(
      {
        ...response,
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        requestHash: "e".repeat(64),
      },
      2,
    ),
  ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);

  await expect(input.repository.listParticipants(sessionId)).resolves.toHaveLength(1);
  await expect(input.repository.listResponses(sessionId)).resolves.toHaveLength(1);
  await expect(input.repository.listTimeline(sessionId)).resolves.toHaveLength(2);
}

export function presentationRecoveryPackIntervention(): PresentationRecoveryPackIntervention {
  return {
    type: "explain",
    reference: {
      insertionId: randomUUID(),
      packId: randomUUID(),
      packVersionId: randomUUID(),
      packVersion: 1,
      contentHash: "a".repeat(64),
      cardId: randomUUID(),
    },
  };
}

export const presentationRecoveryPackUuidCases = {
  accepted: [
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ...Array.from({ length: 8 }, (_, index) => `12345678-1234-${index + 1}123-8123-123456789abc`),
    "12345678-1234-4123-9123-123456789abc",
    "12345678-1234-4123-a123-123456789abc",
    "12345678-1234-4123-b123-123456789abc",
    "12345678-1234-4123-A123-123456789ABC",
    "12345678-1234-4123-B123-123456789ABC",
  ],
  rejected: [
    "12345678-1234-0000-8123-123456789abc",
    "12345678-1234-9123-8123-123456789abc",
    "12345678-1234-4123-7123-123456789abc",
    "12345678-1234-4123-c123-123456789abc",
    "12345678-1234-0000-0000-123456789abc",
    "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
  ],
};

export async function expectPresentationRecoveryPackLiveCardsConformance(
  input: PresentationSessionRepositoryConformanceInput,
) {
  const now = new Date();
  const sessionId = randomUUID();
  const block = input.content.blocks[0]!;
  const intervention = presentationRecoveryPackIntervention();
  const session = await input.repository.createSession({
    id: sessionId,
    workspaceId: input.workspaceId,
    presentationId: input.presentationId,
    presentationVersionId: input.presentationVersionId,
    title: input.content.title,
    content: input.content,
    code: String(randomInt(1_000_000, 10_000_000)),
    status: "active",
    phase: "question_reveal",
    currentBlockIndex: 0,
    revision: 0,
    recoveryPackCardsEnabled: true,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 60 * 60_000),
    retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
  });
  const command: PresentationSessionCommandInput = {
    workspaceId: input.workspaceId,
    sessionId,
    commandId: randomUUID(),
    expectedRevision: 0,
    requestHash: "a".repeat(64),
    phase: "intervention",
    currentBlockIndex: 0,
    status: "active",
    occurredAt: now,
    recoveryPackIntervention: intervention,
    // The repository derives the immutable timeline attribution from the active selection.
    event: { type: "intervention.presented", blockIndex: 0, blockId: block.id },
  };
  const legacySessionId = randomUUID();
  await input.repository.createSession({
    ...session,
    id: legacySessionId,
    code: String(randomInt(1_000_000, 10_000_000)),
  });
  const legacyAdvance = {
    ...command,
    sessionId: legacySessionId,
    commandId: randomUUID(),
    requestHash: null,
    recoveryPackIntervention: null,
  };
  await expect(input.repository.transitionSessionCommand(legacyAdvance)).resolves.toMatchObject({
    status: "accepted",
    session: { revision: 1, recoveryPackIntervention: null },
  });
  // A legacy writer may win after the service's preflight lookup and before its card command
  // acquires the parent lock. Its null-hash advance receipt must not acknowledge a card intent.
  await expect(
    input.repository.transitionSessionCommand({
      ...legacyAdvance,
      requestHash: command.requestHash,
      recoveryPackIntervention: intervention,
    }),
  ).resolves.toMatchObject({
    status: "idempotency_conflict",
    session: { revision: 1, recoveryPackIntervention: null },
  });
  await expect(
    input.repository.transitionSessionCommand({
      ...legacyAdvance,
      requestHash: "b".repeat(64),
    }),
  ).resolves.toMatchObject({ status: "duplicate", session: { revision: 1 } });
  await input.repository.deleteSession(input.workspaceId, legacySessionId, session.liveExpiresAt);
  const concurrent = await Promise.all([
    input.repository.transitionSessionCommand(command),
    input.repository.transitionSessionCommand(command),
  ]);
  expect(concurrent.map(({ status }) => status).sort()).toEqual(["accepted", "duplicate"]);
  for (const result of concurrent) {
    expect(result).toMatchObject({
      session: { revision: 1, eventSeq: 1, recoveryPackIntervention: intervention },
    });
  }
  await expect(
    input.repository.findCommandReceipt(input.workspaceId, sessionId, command.commandId),
  ).resolves.toMatchObject({
    expectedRevision: 0,
    resultingRevision: 1,
    requestHash: command.requestHash,
    eventType: "intervention.presented",
  });
  await expect(
    input.repository.findCommandReceipt(randomUUID(), sessionId, command.commandId),
  ).resolves.toBeNull();
  for (const changed of [
    { ...command, expectedRevision: 1 },
    {
      ...command,
      requestHash: "b".repeat(64),
      recoveryPackIntervention: { ...intervention, type: "example" as const },
    },
    { ...command, requestHash: "c".repeat(64), recoveryPackIntervention: null },
    { ...command, requestHash: null },
  ]) {
    await expect(input.repository.transitionSessionCommand(changed)).resolves.toMatchObject({
      status: "idempotency_conflict",
      session: { revision: 1, recoveryPackIntervention: intervention },
    });
  }
  const replacement = { ...intervention, type: "example" as const };
  await expect(
    input.repository.transitionSessionCommand({
      ...command,
      commandId: randomUUID(),
      expectedRevision: 1,
      requestHash: "d".repeat(64),
      recoveryPackIntervention: replacement,
    }),
  ).resolves.toMatchObject({
    status: "accepted",
    session: { revision: 2, recoveryPackIntervention: replacement },
  });
  const advance: PresentationSessionCommandInput = {
    workspaceId: input.workspaceId,
    sessionId,
    commandId: randomUUID(),
    expectedRevision: 2,
    requestHash: "e".repeat(64),
    phase: "question_open",
    currentBlockIndex: 0,
    status: "active",
    occurredAt: new Date(now.getTime() + 1_000),
    event: { type: "question.launched", blockIndex: 0, blockId: block.id },
  };
  await expect(input.repository.transitionSessionCommand(advance)).resolves.toMatchObject({
    status: "accepted",
    session: { revision: 3, recoveryPackCardsEnabled: true, recoveryPackIntervention: null },
  });
  await expect(input.repository.transitionSessionCommand(command)).resolves.toMatchObject({
    status: "duplicate",
    session: { revision: 3, recoveryPackIntervention: null },
  });
  await expect(
    input.repository.transitionSessionCommand({ ...command, requestHash: "f".repeat(64) }),
  ).resolves.toMatchObject({ status: "idempotency_conflict", session: { revision: 3 } });
  const finish: PresentationSessionCommandInput = {
    ...advance,
    commandId: randomUUID(),
    expectedRevision: 3,
    requestHash: "f".repeat(64),
    phase: "finished",
    status: "finished",
    event: { type: "presentation.finished", blockIndex: null, blockId: null },
  };
  await expect(input.repository.transitionSessionCommand(finish)).resolves.toMatchObject({
    status: "accepted",
    session: { revision: 4, recoveryPackIntervention: null },
  });
  await input.beginWorkspaceDeletion();
  await expect(input.repository.transitionSessionCommand(command)).resolves.toMatchObject({
    status: "duplicate",
    session: { phase: "finished", revision: 4, recoveryPackIntervention: null },
  });
  await expect(input.repository.transitionSessionCommand(finish)).resolves.toMatchObject({
    status: "duplicate",
    session: { phase: "finished", revision: 4 },
  });
  await expect(
    input.repository.findCommandReceipt(input.workspaceId, sessionId, command.commandId),
  ).resolves.toMatchObject({ requestHash: command.requestHash });
  await expect(input.repository.listTimeline(sessionId)).resolves.toEqual([
    expect.objectContaining({
      sequence: 1,
      type: "intervention.presented",
      recoveryPackIntervention: intervention,
    }),
    expect.objectContaining({
      sequence: 2,
      type: "intervention.presented",
      recoveryPackIntervention: replacement,
    }),
    expect.objectContaining({
      sequence: 3,
      type: "question.launched",
      recoveryPackIntervention: null,
    }),
    expect.objectContaining({
      sequence: 4,
      type: "presentation.finished",
      recoveryPackIntervention: null,
    }),
  ]);
  await expect(input.repository.listResponses(sessionId)).resolves.toEqual([]);
  await expect(input.repository.getReport(input.workspaceId, sessionId)).resolves.toMatchObject({
    status: "pending",
  });
  await expect(input.repository.deleteSession(input.workspaceId, sessionId)).resolves.toEqual({
    status: "deleted",
  });
  await expect(input.repository.getSessionById(sessionId)).resolves.toBeNull();
  await expect(input.repository.listTimeline(sessionId)).resolves.toEqual([]);
  await expect(
    input.repository.findCommandReceipt(input.workspaceId, sessionId, command.commandId),
  ).resolves.toBeNull();
  await expect(input.repository.getReport(input.workspaceId, sessionId)).resolves.toBeNull();
}
