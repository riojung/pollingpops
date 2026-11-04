import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { ScopedQnaCommand } from "@openround/contracts";
import { ScopedQnaPageSchema } from "@openround/contracts";
import type {
  Repository,
  PresentationSessionRepository,
  AudienceScopeRepository,
  ScopedQnaRepository,
} from "../../src/index.js";
import { presentationSessionConformanceContent } from "./presentation-session-conformance.js";

export async function expectScopedQnaConformance(input: {
  repository: Repository;
  sessions: PresentationSessionRepository;
  scopes: AudienceScopeRepository;
  qna: ScopedQnaRepository;
  workspaceId: string;
  presentationId: string;
  presentationVersionId: string;
  createdBy: string;
  beforeDelete?: (scopeId: string) => Promise<void>;
}) {
  const now = new Date();
  const session = await input.sessions.createSession({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    presentationId: input.presentationId,
    presentationVersionId: input.presentationVersionId,
    title: "Shared Q&A",
    content: presentationSessionConformanceContent(),
    code: String(randomInt(1_000_000, 10_000_000)),
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    revision: 0,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 600_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  });
  const hashes = {
    host: createHash("sha256").update(randomUUID()).digest("hex"),
    companion: createHash("sha256").update(randomUUID()).digest("hex"),
    stage: createHash("sha256").update(randomUUID()).digest("hex"),
    participant: createHash("sha256").update(randomUUID()).digest("hex"),
    other: createHash("sha256").update(randomUUID()).digest("hex"),
  };
  const credentialIds: Record<string, string> = {};
  for (const role of ["host", "companion", "stage"] as const) {
    credentialIds[role] = randomUUID();
    await input.sessions.createCredential({
      id: credentialIds[role]!,
      workspaceId: input.workspaceId,
      sessionId: session.id,
      role,
      tokenHash: hashes[role],
      createdAt: now,
      expiresAt: session.liveExpiresAt,
      revokedAt: null,
    });
  }
  for (const role of ["participant", "other"] as const)
    await input.sessions.addParticipant({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      sessionId: session.id,
      nickname: role === "participant" ? "PRIVATE ALIAS" : "Other",
      tokenHash: hashes[role],
      joinedAt: now,
      lastSeenAt: now,
    });
  await input.scopes.activatePresentation({
    workspaceId: input.workspaceId,
    sessionId: session.id,
    idempotencyKey: randomUUID(),
    now,
  });
  const baseline = (await input.sessions.getSessionById(session.id))!;
  const context = (role: keyof typeof hashes) => ({
    workspaceId: input.workspaceId,
    scopeId: session.id,
    tokenHash: hashes[role],
    now,
  });
  const page = (role: keyof typeof hashes, limit = 50, cursor?: string) =>
    input.qna.page({ ...context(role), limit, ...(cursor ? { cursor } : {}) });
  const command = (role: keyof typeof hashes, command: ScopedQnaCommand) =>
    input.qna.mutate({ ...context(role), command });
  await expect(page("stage")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    command("stage", { type: "question.create", body: "No", idempotencyKey: randomUUID() }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(ScopedQnaPageSchema.parse(await page("host"))).toMatchObject({
    schemaVersion: 1,
    audienceSeq: 1,
    lifecycle: "open",
    questions: [],
    settings: { participantReplies: false },
  });
  await expect(
    command("companion", { type: "question.create", body: "No", idempotencyKey: randomUUID() }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    input.qna.page({ ...context("host"), workspaceId: randomUUID(), limit: 50 }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(input.qna.page({ ...context("host"), limit: 51 })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    input.qna.page({ ...context("host"), limit: 50, cursor: "broken" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  for (const invalidId of [
    "-".repeat(36),
    "0".repeat(36),
    "12345678-1234-1234-1234-12345678901-",
  ]) {
    const cursor = Buffer.from(JSON.stringify([now.toISOString(), invalidId])).toString(
      "base64url",
    );
    await expect(input.qna.page({ ...context("host"), limit: 50, cursor })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "The Q&A pagination cursor is invalid; refresh the list",
    });
  }
  for (const invalidDate of [
    "-271821-04-20T00:00:00.000Z",
    "-004713-11-23T23:59:59.999Z",
    "+275760-09-13T00:00:00.001Z",
    "not-a-date",
  ]) {
    const cursor = Buffer.from(JSON.stringify([invalidDate, randomUUID()])).toString("base64url");
    await expect(input.qna.page({ ...context("host"), limit: 50, cursor })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "The Q&A pagination cursor is invalid; refresh the list",
    });
  }
  for (const validDate of [
    "-004713-11-24T00:00:00.000Z",
    "-004713-11-24T00:00:00.001Z",
    "0000-01-01T00:00:00.000Z",
    "+275760-09-13T00:00:00.000Z",
  ]) {
    const cursor = Buffer.from(JSON.stringify([validDate, randomUUID()])).toString("base64url");
    expect(await input.qna.page({ ...context("host"), limit: 50, cursor })).toMatchObject({
      questions: [],
      nextCursor: null,
    });
  }
  const settings = {
    enabled: true,
    displayMode: "anonymous_public" as const,
    moderationMode: "pre" as const,
    participantReplies: false as const,
  };
  await expect(
    command("companion", {
      type: "settings.update",
      settings,
      expectedAudienceSeq: 1,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await command("host", {
    type: "settings.update",
    settings,
    expectedAudienceSeq: 1,
    idempotencyKey: randomUUID(),
  });
  const creation: ScopedQnaCommand = {
    type: "question.create",
    body: "MODERATED TEXT",
    idempotencyKey: randomUUID(),
  };
  const [first, duplicate] = await Promise.all([
    command("participant", creation),
    command("participant", creation),
  ]);
  expect([first.duplicate, duplicate.duplicate].filter(Boolean)).toHaveLength(1);
  expect(first.receipt).toEqual(duplicate.receipt);
  expect(first.receipt.audienceSeq).toBe(3);
  expect(await page("other")).toMatchObject({ questions: [] });
  expect(await page("companion")).toMatchObject({ questions: [] });
  expect(await page("participant")).toMatchObject({
    questions: [{ body: "MODERATED TEXT", author: { displayName: "You" }, status: "pending" }],
  });
  expect(await page("host")).toMatchObject({
    questions: [{ author: { displayName: "PRIVATE ALIAS" } }],
  });
  await expect(command("participant", { ...creation, body: "different" })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const questionId = first.receipt.resourceId;
  const vote: ScopedQnaCommand = {
    type: "vote.set",
    questionId,
    voted: true,
    idempotencyKey: randomUUID(),
  };
  await expect(command("other", vote)).rejects.toMatchObject({ code: "MODERATION_REQUIRED" });
  const publish: ScopedQnaCommand = {
    type: "question.moderate",
    questionId,
    status: "published",
    label: null,
    banAuthor: false,
    expectedAudienceSeq: 3,
    idempotencyKey: randomUUID(),
  };
  await expect(command("host", { ...publish, expectedAudienceSeq: 2 })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(command("companion", publish)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await command("host", publish);
  for (const role of ["other", "companion"] as const) {
    const view = await page(role);
    expect(view.questions[0]!.author.displayName).toBe("Anonymous");
    expect(JSON.stringify(view)).not.toContain("PRIVATE ALIAS");
    expect(view.questions[0]).not.toHaveProperty("participantId");
    expect(view.questions[0]).not.toHaveProperty("moderationParticipantId");
  }
  await command("other", vote);
  expect((await command("other", vote)).duplicate).toBe(true);
  await command("other", { ...vote, idempotencyKey: randomUUID() });
  expect((await page("other")).questions[0]).toMatchObject({ voteCount: 1, votedByMe: true });
  expect((await page("host")).questions[0]!.votedByMe).toBe(false);
  await command("participant", {
    type: "question.create",
    body: "Second",
    idempotencyKey: randomUUID(),
  });
  const firstPage = await page("host", 1);
  const secondPage = await page("host", 1, firstPage.nextCursor!);
  expect(secondPage.questions).toHaveLength(1);
  expect(secondPage.questions[0]!.id).not.toBe(firstPage.questions[0]!.id);
  expect(secondPage.nextCursor).toBeNull();
  const removing: ScopedQnaCommand = {
    ...publish,
    status: "removed",
    banAuthor: true,
    expectedAudienceSeq: (await page("host")).audienceSeq,
    idempotencyKey: randomUUID(),
  };
  await command("host", removing);
  expect((await page("host")).questions.find((q) => q.id === questionId)!.body).toBe("");
  expect((await page("participant")).questions.find((q) => q.id === questionId)!.body).toBe("");
  expect((await page("other")).questions).toEqual([]);
  await expect(
    command("participant", {
      type: "question.create",
      body: "Banned",
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect((await command("participant", creation)).receipt).toEqual(first.receipt);
  await expect(
    command("host", {
      ...publish,
      idempotencyKey: randomUUID(),
      expectedAudienceSeq: (await page("host")).audienceSeq,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await input.sessions.getSessionById(session.id)).toMatchObject({
    revision: baseline.revision,
    eventSeq: baseline.eventSeq,
  });
  // All committed notices are strict metadata; process restart reclaims the same event.
  let events = 0;
  while (true) {
    const event = await input.scopes.claimOutbox(now, new Date(now.getTime() + 10_000));
    if (!event) break;
    expect(event.event.payload).toEqual({ kind: "presentation" });
    expect(JSON.stringify(event.event)).not.toContain("MODERATED TEXT");
    expect(event.event.audienceSeq).toBeGreaterThan(0);
    expect(
      await input.scopes.completeOutbox(
        input.workspaceId,
        event.event.eventId,
        event.leaseToken!,
        now,
      ),
    ).toBe(true);
    events++;
  }
  expect(events).toBe((await page("host")).audienceSeq);
  await input.sessions.revokeCredential(
    input.workspaceId,
    session.id,
    credentialIds.companion!,
    now,
  );
  await expect(page("companion")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await input.sessions.transitionSession({
    workspaceId: input.workspaceId,
    sessionId: session.id,
    expectedRevision: baseline.revision,
    phase: "finished",
    status: "finished",
    currentBlockIndex: -1,
    occurredAt: now,
    event: { type: "presentation.finished", blockId: null, blockIndex: -1 },
  });
  expect(await page("host")).toMatchObject({ lifecycle: "closed" });
  expect((await command("participant", creation)).duplicate).toBe(true);
  await expect(
    command("other", { type: "question.create", body: "Closed", idempotencyKey: randomUUID() }),
  ).rejects.toMatchObject({ code: "ROOM_CLOSED" });
  const account = await input.repository.exportAccount(input.createdBy);
  expect(JSON.stringify(account)).not.toContain(hashes.host);
  expect(JSON.stringify(account)).not.toContain("MODERATED TEXT");
  await input.beforeDelete?.(session.id);
  await input.sessions.deleteSession(input.workspaceId, session.id, now);
  await expect(page("host")).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await input.scopes.claimOutbox(now, new Date(now.getTime() + 10_000))).toBeNull();
  return { sessionId: session.id };
}
