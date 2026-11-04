import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { MemoryRepository, createPresentationSessionRepository } from "../src/index.js";
import { expectPresentationTextConformance } from "./support/presentation-text-conformance.js";
describe("Presentation private text persistence", () => {
  it("moderates private text with erasure, independent row versions, reveal privacy and replay", async () => {
    await expectPresentationTextConformance({
      repository: createPresentationSessionRepository(new MemoryRepository()),
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
    });
  });
});

import { expect } from "vitest";
import { PresentationContentSchema } from "@openround/contracts";
function textContent() {
  return PresentationContentSchema.parse({
    title: "Private text",
    schemaVersion: 10,
    blocks: [
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: randomUUID(),
          type: "open_text",
          prompt: "Share",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  });
}
it("never exports private text bodies from memory, even after approval", async () => {
  const memory = new MemoryRepository();
  const tokenHash = randomUUID();
  const now = new Date();
  await memory.createMagicToken({
    id: randomUUID(),
    email: `text-${randomUUID()}@example.com`,
    segment: "education",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(now.getTime() + 60000),
    consumedAt: null,
  });
  const owner = (await memory.consumeMagicToken(tokenHash, now))!;
  const repository = createPresentationSessionRepository(memory);
  const content = textContent();
  const block = content.blocks[0]!;
  if (block.kind !== "question") throw new Error("Expected text");
  const session = await repository.createSession({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: content.title,
    content,
    code: "1234567",
    status: "active",
    phase: "question_open",
    currentBlockIndex: 0,
    revision: 1,
    settings: { timeMode: "flex" },
    questionOpenedAt: now,
    questionClosesAt: null,
    createdBy: owner.userId,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 3600000),
    retentionExpiresAt: new Date(now.getTime() + 86400000),
  });
  const participantId = randomUUID();
  await repository.addParticipant({
    id: participantId,
    workspaceId: owner.workspaceId,
    sessionId: session.id,
    nickname: "Private person",
    tokenHash: randomUUID(),
    joinedAt: now,
    lastSeenAt: now,
  });
  const responseId = randomUUID();
  const marker = "memory-private-body-marker";
  await repository.acceptResponse(
    {
      id: responseId,
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      participantId,
      blockId: block.id,
      questionId: block.question.id,
      response: { textValue: marker },
      responseSchemaVersion: 3,
      correct: null,
      score: 0,
      responseMs: 1,
      submittedAt: new Date(now.getTime() + 1),
      idempotencyKey: randomUUID(),
      requestHash: "a".repeat(64),
    },
    1,
  );
  expect(JSON.stringify(await memory.exportAccount(owner.userId))).not.toContain(marker);
  const credential = await repository.createCredential({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    sessionId: session.id,
    role: "host",
    tokenHash: randomUUID(),
    createdAt: now,
    expiresAt: session.liveExpiresAt,
    revokedAt: null,
  });
  expect(
    (
      await repository.moderateTextResponse({
        workspaceId: owner.workspaceId,
        sessionId: session.id,
        hostCredentialId: credential.id,
        commandId: randomUUID(),
        responseId,
        expectedRevision: 1,
        expectedModerationVersion: 0,
        status: "approved",
        requestHash: "b".repeat(64),
        occurredAt: new Date(now.getTime() + 10),
      })
    ).status,
  ).toBe("accepted");
  expect(JSON.stringify(await memory.exportAccount(owner.userId))).not.toContain(marker);
});
it("caps text joins at 250 and rejects promotion of an already larger memory room", async () => {
  const repository = createPresentationSessionRepository(new MemoryRepository());
  const now = new Date();
  const workspaceId = randomUUID();
  const text = textContent();
  const base = {
    workspaceId,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: "Capacity",
    status: "active" as const,
    phase: "lobby" as const,
    currentBlockIndex: -1,
    revision: 0,
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 3600000),
    retentionExpiresAt: new Date(now.getTime() + 86400000),
  };
  const session = await repository.createSession({
    ...base,
    id: randomUUID(),
    code: "1234567",
    content: text,
  });
  const participant = (sessionId: string) => ({
    id: randomUUID(),
    workspaceId,
    sessionId,
    nickname: "Capacity",
    tokenHash: randomUUID(),
    joinedAt: now,
    lastSeenAt: now,
  });
  for (let index = 0; index < 250; index++)
    await repository.addParticipant(participant(session.id));
  expect((await repository.joinParticipantWithinLimit(participant(session.id), 500)).status).toBe(
    "full",
  );
  await expect(repository.addParticipant(participant(session.id))).rejects.toMatchObject({
    code: "PRESENTATION_TEXT_CAPACITY",
  });
  const oldContent = PresentationContentSchema.parse({
    title: "Old room",
    schemaVersion: 2,
    blocks: [
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: randomUUID(),
          type: "numeric",
          prompt: "One?",
          correctValue: "1",
          tolerance: "0",
          unit: null,
          timeLimitSeconds: 30,
          basePoints: 1000,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  });
  const old = await repository.createSession({
    ...base,
    id: randomUUID(),
    code: "1234568",
    content: oldContent,
  });
  for (let index = 0; index < 251; index++) await repository.addParticipant(participant(old.id));
  await expect(
    repository.transitionSession({
      workspaceId,
      sessionId: old.id,
      expectedRevision: 0,
      phase: "lobby",
      currentBlockIndex: -1,
      status: "active",
      content: text,
      event: { type: "presentation.started", blockIndex: null, blockId: null },
    }),
  ).rejects.toMatchObject({ code: "PRESENTATION_TEXT_CAPACITY" });
  expect((await repository.getSessionById(old.id))?.content.schemaVersion).toBe(2);
});
