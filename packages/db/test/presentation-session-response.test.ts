import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PresentationContent } from "@openround/contracts";
import {
  MemoryPresentationSessionRepository,
  MemoryRepository,
  createPresentationSessionRepository,
  type PresentationSessionRepository,
  type PresentationSessionResponseRecord,
} from "../src/index.js";
import { mapSession, mapTimeline } from "../src/presentation-session-postgres-support.js";
import {
  expectPresentationSessionRepositoryConformance,
  presentationSessionConformanceContent,
} from "./support/presentation-session-conformance.js";

describe("legacy Presentation session snapshots", () => {
  it("maps internal reveal rosters and preserves missing legacy roster history", () => {
    const participantId = randomUUID();
    const row = {
      id: randomUUID(),
      workspace_id: randomUUID(),
      session_id: randomUUID(),
      sequence: 1,
      event_type: "question.revealed",
      block_index: 0,
      block_id: randomUUID(),
      occurred_at: new Date(),
    };
    expect(mapTimeline(row).revealedParticipantIds).toBeNull();
    expect(mapTimeline({ ...row, revealed_participant_ids: [] }).revealedParticipantIds).toEqual(
      [],
    );
    expect(
      mapTimeline({ ...row, revealed_participant_ids: [participantId] }).revealedParticipantIds,
    ).toEqual([participantId]);
  });

  it("upcasts v1 slide text before returning a stored live session", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const legacySlideId = randomUUID();
    const baseContent = presentationSessionConformanceContent();
    const legacyContent = {
      ...baseContent,
      schemaVersion: 1,
      blocks: [
        {
          id: legacySlideId,
          kind: "content",
          layout: "title_body",
          title: "Legacy session title",
          body: "Legacy session body",
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "Private facilitator note",
        },
        ...baseContent.blocks,
      ],
    };
    const session = mapSession({
      id: randomUUID(),
      workspace_id: randomUUID(),
      presentation_id: randomUUID(),
      presentation_version_id: randomUUID(),
      title: "Legacy session",
      content_snapshot: legacyContent,
      join_code: "1234567",
      status: "active",
      phase: "content",
      current_block_index: 0,
      revision: 1,
      settings: { timeMode: "timed" },
      trust_mode: "learning",
      event_seq: 1,
      question_opened_at: null,
      question_closes_at: null,
      created_by: randomUUID(),
      created_at: now,
      updated_at: now,
      finished_at: null,
      live_expires_at: new Date(now.getTime() + 60_000),
      retention_expires_at: new Date(now.getTime() + 86_400_000),
    } as never);

    expect(session.content.schemaVersion).toBe(2);
    expect(session.joinPasswordHash).toBeNull();
    expect(session.content.blocks[0]).toMatchObject({
      id: legacySlideId,
      textElements: [
        { id: `${legacySlideId}:title`, role: "title", text: "Legacy session title" },
        { id: `${legacySlideId}:body`, role: "body", text: "Legacy session body" },
      ],
    });
  });
});

function fixture() {
  const workspaceId = randomUUID();
  const sessionId = randomUUID();
  const participantId = randomUUID();
  const blockId = randomUUID();
  const questionId = randomUUID();
  const correctChoiceId = randomUUID();
  const now = new Date("2026-09-20T12:00:00.000Z");
  const content: PresentationContent = {
    title: "Atomic response check",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    blocks: [
      {
        id: blockId,
        kind: "question",
        question: {
          id: questionId,
          type: "single_select",
          prompt: "Which response is accepted?",
          choices: [
            { id: correctChoiceId, label: "The in-window response", isCorrect: true },
            { id: randomUUID(), label: "A response after reveal", isCorrect: false },
          ],
          purpose: "diagnostic",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "The session row is the authority.",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  };
  const response = (
    participant: string,
    submittedAt = new Date(now.getTime() + 1_000),
    idempotencyKey?: string,
    requestHash?: string,
  ) =>
    ({
      id: randomUUID(),
      workspaceId,
      sessionId,
      participantId: participant,
      blockId,
      questionId,
      response: { choiceIds: [correctChoiceId] },
      correct: true,
      score: 975,
      responseMs: 1_000,
      submittedAt,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(requestHash ? { requestHash } : {}),
    }) satisfies PresentationSessionResponseRecord;
  return { workspaceId, sessionId, participantId, blockId, now, content, response };
}

async function addFixtureParticipant(
  repository: PresentationSessionRepository,
  setup: ReturnType<typeof fixture>,
) {
  await repository.addParticipant({
    id: setup.participantId,
    workspaceId: setup.workspaceId,
    sessionId: setup.sessionId,
    nickname: "Learner",
    tokenHash: "a".repeat(64),
    joinedAt: setup.now,
    lastSeenAt: setup.now,
  });
}

describe("presentation response acceptance", () => {
  it("keeps the memory repository on the shared Presentation conformance contract", async () => {
    const memory = new MemoryRepository();
    const workspaceId = randomUUID();
    await expectPresentationSessionRepositoryConformance({
      repository: new MemoryPresentationSessionRepository(memory),
      workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
      content: presentationSessionConformanceContent(),
      beginWorkspaceDeletion: async () => {
        await memory.claimWorkspaceMediaDeletion(workspaceId);
      },
    });
  });

  it("defaults legacy sessions to timed learning semantics and explicit timestamps", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    const session = await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "5555554",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 0,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    expect(session).toMatchObject({
      settings: { timeMode: "timed" },
      trustMode: "learning",
      eventSeq: 0,
      questionOpenedAt: setup.now,
    });
    expect(session.questionClosesAt).toEqual(new Date(setup.now.getTime() + 20_000));
  });

  it("persists and leases Presentation report jobs through ready and failed states", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    const expiresAt = new Date(setup.now.getTime() + 30 * 86_400_000);
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "5555553",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: expiresAt,
    });
    await repository.transitionSession({
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: -1,
      status: "finished",
      occurredAt: setup.now,
      retentionExpiresAt: expiresAt,
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });

    await expect(repository.getReport(randomUUID(), setup.sessionId)).resolves.toBeNull();
    await expect(repository.getReport(setup.workspaceId, setup.sessionId)).resolves.toMatchObject({
      id: setup.sessionId,
      status: "pending",
      schemaVersion: 1,
      payload: null,
      generatedAt: null,
      expiresAt,
    });

    const firstLeaseEnd = new Date(setup.now.getTime() + 60_000);
    const firstJob = await repository.claimReportJob(setup.now, firstLeaseEnd);
    expect(firstJob).toMatchObject({
      reportId: setup.sessionId,
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      attempts: 1,
      expiresAt,
    });
    await expect(repository.claimReportJob(setup.now, firstLeaseEnd)).resolves.toBeNull();

    const retryAt = new Date(setup.now.getTime() + 1_000);
    await repository.retryReportJob(firstJob!, "temporary failure", retryAt, false);
    await expect(
      repository.claimReportJob(new Date(retryAt.getTime() - 1), firstLeaseEnd),
    ).resolves.toBeNull();
    const retriedJob = await repository.claimReportJob(retryAt, firstLeaseEnd);
    expect(retriedJob).toMatchObject({ reportId: setup.sessionId, attempts: 2 });

    const payload = { artifactType: "presentation", participantCount: 0 };
    await repository.completeReportJob(retriedJob!, {
      reportId: setup.sessionId,
      sessionId: setup.sessionId,
      schemaVersion: 2,
      payload,
      generatedAt: retryAt,
    });
    await expect(repository.getReport(setup.workspaceId, setup.sessionId)).resolves.toMatchObject({
      status: "ready",
      schemaVersion: 2,
      payload,
      generatedAt: retryAt,
    });

    const failedSessionId = randomUUID();
    await repository.createSession({
      id: failedSessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "5555552",
      status: "finished",
      phase: "finished",
      currentBlockIndex: 0,
      revision: 1,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: setup.now,
      liveExpiresAt: setup.now,
      retentionExpiresAt: expiresAt,
    });
    const failedJob = await repository.claimReportJob(setup.now, firstLeaseEnd);
    expect(failedJob).toMatchObject({ reportId: failedSessionId, attempts: 1 });
    await repository.retryReportJob(failedJob!, "terminal failure", retryAt, true);
    await expect(repository.getReport(setup.workspaceId, failedSessionId)).resolves.toMatchObject({
      status: "failed",
      payload: null,
      generatedAt: null,
    });
  });

  it("fences an expired Presentation report worker after another worker reclaims its job", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    const expiresAt = new Date(setup.now.getTime() + 30 * 86_400_000);
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "5555551",
      status: "finished",
      phase: "finished",
      currentBlockIndex: 0,
      revision: 1,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: setup.now,
      liveExpiresAt: setup.now,
      retentionExpiresAt: expiresAt,
    });

    const firstLeaseUntil = new Date(setup.now.getTime() + 1_000);
    const firstWorkerJob = await repository.claimReportJob(setup.now, firstLeaseUntil);
    const secondClaimAt = new Date(firstLeaseUntil.getTime() + 1);
    const secondLeaseUntil = new Date(secondClaimAt.getTime() + 60_000);
    const secondWorkerJob = await repository.claimReportJob(secondClaimAt, secondLeaseUntil);

    expect(firstWorkerJob).toMatchObject({ reportId: setup.sessionId, attempts: 1 });
    expect(secondWorkerJob).toMatchObject({ reportId: setup.sessionId, attempts: 2 });
    expect(secondWorkerJob!.leaseToken).not.toBe(firstWorkerJob!.leaseToken);

    await repository.retryReportJob(firstWorkerJob!, "stale retry", secondClaimAt, false);
    await repository.retryReportJob(firstWorkerJob!, "stale terminal failure", secondClaimAt, true);
    await expect(
      repository.completeReportJob(firstWorkerJob!, {
        reportId: setup.sessionId,
        sessionId: setup.sessionId,
        schemaVersion: 1,
        payload: { worker: "stale" },
        generatedAt: secondClaimAt,
      }),
    ).rejects.toThrow("no longer pending");
    await expect(repository.getReport(setup.workspaceId, setup.sessionId)).resolves.toMatchObject({
      status: "pending",
      payload: null,
    });
    await expect(repository.claimReportJob(secondClaimAt, secondLeaseUntil)).resolves.toBeNull();

    const payload = { worker: "current" };
    await repository.completeReportJob(secondWorkerJob!, {
      reportId: setup.sessionId,
      sessionId: setup.sessionId,
      schemaVersion: 1,
      payload,
      generatedAt: secondClaimAt,
    });
    await expect(repository.getReport(setup.workspaceId, setup.sessionId)).resolves.toMatchObject({
      status: "ready",
      payload,
    });
  });

  it("enforces the participant limit inside the session mutation", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = { ...fixture(), now: new Date() };
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "5555555",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    const participant = (nickname: string) => ({
      id: randomUUID(),
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      nickname,
      tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      joinedAt: setup.now,
      lastSeenAt: setup.now,
    });
    const results = await Promise.all([
      repository.joinParticipantWithinLimit(participant("First"), 1),
      repository.joinParticipantWithinLimit(participant("Second"), 1),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(["accepted", "full"]);
    expect(await repository.listParticipants(setup.sessionId)).toHaveLength(1);
    await expect(repository.getSessionById(setup.sessionId)).resolves.toMatchObject({
      revision: 0,
      eventSeq: 1,
    });

    const reportExpiresAt = new Date(setup.now.getTime() + 30 * 86_400_000);
    const finished = await repository.transitionSession({
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: -1,
      status: "finished",
      retentionExpiresAt: reportExpiresAt,
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });
    expect(finished?.retentionExpiresAt).toEqual(reportExpiresAt);
    await expect(repository.joinParticipantWithinLimit(participant("Late"), 2)).resolves.toEqual({
      status: "closed",
    });
  });

  it("atomically rejects duplicates and stale phases", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "1234567",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 3,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    await addFixtureParticipant(repository, setup);

    const first = await repository.acceptResponse(setup.response(setup.participantId), 3);
    expect(first.status).toBe("accepted");
    const duplicate = await repository.acceptResponse(setup.response(setup.participantId), 3);
    expect(duplicate.status).toBe("duplicate");
    await expect(repository.getSessionById(setup.sessionId)).resolves.toMatchObject({
      revision: 3,
      eventSeq: 2,
    });

    await repository.transitionSession({
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      expectedRevision: 3,
      phase: "question_reveal",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "question.revealed", blockIndex: 0, blockId: setup.blockId },
    });
    const afterReveal = await repository.acceptResponse(setup.response(randomUUID()), 3);
    expect(afterReveal).toEqual({ status: "phase_closed" });
    await expect(repository.getSessionById(setup.sessionId)).resolves.toMatchObject({
      revision: 4,
      eventSeq: 3,
    });
  });

  it("resolves an idempotent retry before stale phase checks", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "1234566",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 3,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    await addFixtureParticipant(repository, setup);
    const idempotencyKey = randomUUID();
    const requestHash = "a".repeat(64);
    const accepted = await repository.acceptResponse(
      setup.response(setup.participantId, undefined, idempotencyKey, requestHash),
      3,
    );
    expect(accepted.status).toBe("accepted");
    await repository.transitionSession({
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      expectedRevision: 3,
      phase: "question_reveal",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "question.revealed", blockIndex: 0, blockId: setup.blockId },
    });
    const retry = await repository.acceptResponse(
      setup.response(setup.participantId, undefined, idempotencyKey, requestHash),
      3,
    );
    expect(retry.status).toBe("duplicate");
    const conflictingRetry = await repository.acceptResponse(
      setup.response(setup.participantId, undefined, idempotencyKey, "b".repeat(64)),
      3,
    );
    expect(conflictingRetry.status).toBe("idempotency_conflict");
    const secondAttempt = await repository.acceptResponse(
      setup.response(setup.participantId, undefined, randomUUID()),
      4,
    );
    expect(secondAttempt).toEqual({ status: "phase_closed" });
  });

  it("uses participant ID as the final acknowledgement standing tie-breaker", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "1234559",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 0,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    for (const id of [secondId, firstId]) {
      await repository.addParticipant({
        id,
        workspaceId: setup.workspaceId,
        sessionId: setup.sessionId,
        nickname: "Same nickname",
        tokenHash: id.replaceAll("-", "").padEnd(64, "0"),
        joinedAt: setup.now,
        lastSeenAt: setup.now,
      });
    }
    const firstResponse = setup.response(firstId, undefined, randomUUID(), "a".repeat(64));
    const secondResponse = setup.response(secondId, undefined, randomUUID(), "b".repeat(64));
    await expect(repository.acceptResponse(firstResponse, 0)).resolves.toMatchObject({
      status: "accepted",
    });
    await expect(repository.acceptResponse(secondResponse, 0)).resolves.toMatchObject({
      status: "accepted",
    });
    await repository.transitionSession({
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      expectedRevision: 0,
      phase: "question_reveal",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "question.revealed", blockIndex: 0, blockId: setup.blockId },
    });

    await expect(
      repository.acceptResponse({ ...firstResponse, id: randomUUID() }, 0),
    ).resolves.toMatchObject({
      status: "duplicate",
      acknowledgement: { projection: { standing: { rank: 1, score: 975 } } },
    });
    await expect(
      repository.acceptResponse({ ...secondResponse, id: randomUUID() }, 0),
    ).resolves.toMatchObject({
      status: "duplicate",
      acknowledgement: { projection: { standing: { rank: 2, score: 975 } } },
    });
  });

  it("distinguishes a second response key from an idempotent retry", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "1234565",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 1,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    await addFixtureParticipant(repository, setup);
    await expect(
      repository.acceptResponse(
        { ...setup.response(randomUUID(), undefined, randomUUID()), blockId: randomUUID() },
        1,
      ),
    ).resolves.toEqual({ status: "phase_closed" });
    await expect(
      repository.acceptResponse(
        { ...setup.response(randomUUID(), undefined, randomUUID()), questionId: randomUUID() },
        1,
      ),
    ).resolves.toEqual({ status: "phase_closed" });
    await expect(
      repository.acceptResponse(setup.response(randomUUID(), undefined, randomUUID()), 0),
    ).resolves.toEqual({ status: "phase_closed" });
    await repository.acceptResponse(
      setup.response(setup.participantId, undefined, randomUUID()),
      1,
    );
    const second = await repository.acceptResponse(
      setup.response(setup.participantId, undefined, randomUUID()),
      1,
    );
    expect(second.status).toBe("already_responded");
  });

  it("supports flex windows and idempotent transition commands", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "1234564",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      settings: { timeMode: "flex" },
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    await addFixtureParticipant(repository, setup);
    const commandId = randomUUID();
    const opened = await repository.transitionSessionCommand({
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      commandId,
      expectedRevision: 0,
      phase: "question_open",
      currentBlockIndex: 0,
      status: "active",
      occurredAt: setup.now,
      event: { type: "question.launched", blockIndex: 0, blockId: setup.blockId },
    });
    expect(opened.status).toBe("accepted");
    if (opened.status !== "accepted") throw new Error("Expected accepted transition");
    expect(opened.session).toMatchObject({ eventSeq: 2, questionClosesAt: null });

    const retry = await repository.transitionSessionCommand({
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      commandId,
      expectedRevision: 0,
      phase: "question_open",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "question.launched", blockIndex: 0, blockId: setup.blockId },
    });
    expect(retry.status).toBe("duplicate");
    const conflictingReuse = await repository.transitionSessionCommand({
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      commandId,
      expectedRevision: 1,
      phase: "question_reveal",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "question.revealed", blockIndex: 0, blockId: setup.blockId },
    });
    expect(conflictingReuse.status).toBe("idempotency_conflict");
    expect(await repository.listTimeline(setup.sessionId)).toHaveLength(1);
    const accepted = await repository.acceptResponse(
      setup.response(setup.participantId, new Date(setup.now.getTime() + 60_000), randomUUID()),
      1,
    );
    expect(accepted.status).toBe("accepted");
  });

  it("expires and revokes scoped presentation credentials", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "1234563",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    const credential = await repository.createCredential({
      id: randomUUID(),
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      role: "companion",
      tokenHash: "a".repeat(64),
      createdAt: setup.now,
      expiresAt: new Date(setup.now.getTime() + 60_000),
      revokedAt: null,
    });
    await expect(
      repository.findValidCredential(setup.sessionId, credential.tokenHash, "host", setup.now),
    ).resolves.toBeNull();
    await expect(
      repository.findValidCredential(setup.sessionId, credential.tokenHash, "companion", setup.now),
    ).resolves.toMatchObject({ id: credential.id });
    await repository.revokeCredential(
      setup.workspaceId,
      setup.sessionId,
      credential.id,
      new Date(setup.now.getTime() + 1_000),
    );
    await expect(
      repository.findValidCredential(
        setup.sessionId,
        credential.tokenHash,
        "companion",
        new Date(setup.now.getTime() + 2_000),
      ),
    ).resolves.toBeNull();
  });

  it("rolls back the room when its initial credential cannot be created", async () => {
    const memory = new MemoryRepository();
    const repository = createPresentationSessionRepository(memory);
    const setup = fixture();
    const sessionInput = (id: string, code: string) => ({
      id,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code,
      status: "active" as const,
      phase: "lobby" as const,
      currentBlockIndex: -1,
      revision: 0,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    const firstId = randomUUID();
    const sharedTokenHash = "c".repeat(64);
    await repository.createSessionWithCredential(sessionInput(firstId, "7654310"), {
      id: randomUUID(),
      workspaceId: setup.workspaceId,
      sessionId: firstId,
      role: "host",
      tokenHash: sharedTokenHash,
      createdAt: setup.now,
      expiresAt: new Date(setup.now.getTime() + 60_000),
      revokedAt: null,
    });

    const failedId = randomUUID();
    await expect(
      repository.createSessionWithCredential(sessionInput(failedId, "7654311"), {
        id: randomUUID(),
        workspaceId: setup.workspaceId,
        sessionId: failedId,
        role: "host",
        tokenHash: sharedTokenHash,
        createdAt: setup.now,
        expiresAt: new Date(setup.now.getTime() + 60_000),
        revokedAt: null,
      }),
    ).rejects.toThrow("credential already exists");
    await expect(repository.getSessionById(failedId)).resolves.toBeNull();
    await expect(memory.getLiveRoomCode("7654311")).resolves.toBeNull();
    await expect(
      repository.createSession(sessionInput(failedId, "7654311")),
    ).resolves.toMatchObject({ id: failedId });
  });

  it("rejects an otherwise current response after the server deadline", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "7654321",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 1,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    const late = await repository.acceptResponse(
      setup.response(setup.participantId, new Date(setup.now.getTime() + 20_001)),
      1,
    );
    expect(late).toEqual({ status: "phase_closed" });
  });

  it("rejects joins and responses after the live expiry", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "7654322",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 1,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(0),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    const participant = {
      id: randomUUID(),
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      nickname: "Late",
      tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      joinedAt: new Date(),
      lastSeenAt: new Date(),
    };
    await expect(repository.joinParticipantWithinLimit(participant, 20)).resolves.toEqual({
      status: "closed",
    });
    await expect(
      repository.acceptResponse(setup.response(setup.participantId), 1),
    ).resolves.toEqual({ status: "phase_closed" });
  });
});
