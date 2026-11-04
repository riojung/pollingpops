import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { PresentationContentSchema } from "@openround/contracts";
import type { PresentationSessionRepositoryConformanceInput } from "./presentation-session-conformance.js";
import type { PresentationSessionResponseRecord } from "../../src/index.js";

/** Exercises the same frozen payload, receipt and reveal fences on memory and PostgreSQL. */
export async function expectPresentationOpinionResponseConformance(
  input: PresentationSessionRepositoryConformanceInput,
) {
  for (const format of [
    "poll",
    "top_ranking",
    "full_ranking",
    "upper_poll",
    "upper_top_ranking",
  ] as const) {
    const poll = format.endsWith("poll");
    const upper = format.startsWith("upper");
    const id = () => (upper ? randomUUID().toUpperCase() : randomUUID());
    const now = new Date();
    const choices = ["First", "Second", "Third"].map((label) => ({
      id: id(),
      label,
      isCorrect: false,
    }));
    const blockId = id();
    const questionId = id();
    const content = PresentationContentSchema.parse({
      title: "Frozen opinions",
      schemaVersion: 9,
      blocks: [
        {
          id: blockId,
          kind: "question",
          question: {
            id: questionId,
            type: poll ? "poll" : "ranking",
            prompt: "Choose priorities",
            choices,
            purpose: "opinion",
            confidence: "off",
            delivery: "main",
            linkedRecheckQuestionId: null,
            timeLimitSeconds: 30,
            basePoints: 0,
            explanation: "",
            mediaId: null,
            mediaAlt: null,
            ...(poll ? { maxSelections: 2 } : format !== "full_ranking" ? { rankCount: 2 } : {}),
          },
        },
      ],
    });
    const session = await input.repository.createSession({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      presentationId: input.presentationId,
      presentationVersionId: input.presentationVersionId,
      title: content.title,
      content,
      code: String(randomInt(1_000_000, 10_000_000)),
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 1,
      settings: { timeMode: "flex" },
      trustMode: "learning",
      eventSeq: 1,
      questionOpenedAt: now,
      questionClosesAt: null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 3_600_000),
      retentionExpiresAt: new Date(now.getTime() + 86_400_000),
    });
    // Repository input and output must not become mutable aliases of the frozen snapshot.
    const originalBlock = content.blocks[0]!;
    if (originalBlock.kind !== "question") throw new Error("Expected opinion question");
    originalBlock.question.prompt = "Unpublished caller edit";
    expect((await input.repository.getSessionById(session.id))?.content.blocks[0]).toMatchObject({
      question: { prompt: "Choose priorities" },
    });
    const participantId = randomUUID();
    const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
    await input.repository.addParticipant({
      id: participantId,
      workspaceId: input.workspaceId,
      sessionId: session.id,
      nickname: "Opinion participant",
      tokenHash,
      joinedAt: now,
      lastSeenAt: now,
    });
    const selected = (
      format === "full_ranking"
        ? [choices[2]!.id, choices[0]!.id, choices[1]!.id]
        : [choices[2]!.id, choices[0]!.id]
    ).map((value) => (upper ? value.toLowerCase() : value));
    const response = poll ? { choiceIds: selected } : { orderedChoiceIds: selected };
    const record: PresentationSessionResponseRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      sessionId: session.id,
      participantId,
      blockId: upper ? blockId.toLowerCase() : blockId,
      questionId: upper ? questionId.toLowerCase() : questionId,
      response,
      responseSchemaVersion: 2,
      correct: null,
      score: 0,
      responseMs: 1000,
      submittedAt: new Date(now.getTime() + 1000),
      idempotencyKey: randomUUID(),
      requestHash: createHash("sha256").update(JSON.stringify(response)).digest("hex"),
    };
    await expect(
      input.repository.acceptResponse(
        {
          ...record,
          questionId: randomUUID(),
          idempotencyKey: randomUUID(),
        },
        1,
      ),
    ).resolves.toEqual({ status: "phase_closed" });
    const outOfBounds = poll
      ? { choiceIds: choices.map((choice) => choice.id) }
      : { orderedChoiceIds: selected.slice(1) };
    await expect(
      input.repository.acceptResponse(
        { ...record, idempotencyKey: randomUUID(), response: outOfBounds },
        1,
      ),
    ).rejects.toThrow();
    await expect(
      input.repository.acceptResponse(
        { ...record, idempotencyKey: randomUUID(), responseSchemaVersion: 1 },
        1,
      ),
    ).rejects.toThrow();
    await expect(input.repository.listResponses(session.id)).resolves.toEqual([]);
    await expect(input.repository.acceptResponse(record, 1)).resolves.toMatchObject({
      status: "accepted",
      response: { response, responseSchemaVersion: 2, correct: null, score: 0 },
    });
    if (upper) {
      await expect(
        input.repository.acceptResponse(
          {
            ...record,
            id: randomUUID(),
            blockId,
            questionId,
            idempotencyKey: randomUUID(),
          },
          1,
        ),
      ).resolves.toMatchObject({ status: "already_responded", response: { id: record.id } });
      await expect(
        input.repository.saveResponse({
          ...record,
          id: randomUUID(),
          blockId,
          questionId,
          idempotencyKey: randomUUID(),
        }),
      ).resolves.toMatchObject({ id: record.id, response });
      for (const currentBlockId of [blockId, blockId.toLowerCase()]) {
        await expect(
          input.repository.getParticipantSnapshotProjection(
            session.id,
            participantId,
            currentBlockId,
            true,
          ),
        ).resolves.toMatchObject({ currentResponse: { id: record.id, response } });
      }
      await expect(
        input.repository.getResponseContext(session.id, tokenHash, record.idempotencyKey!),
      ).resolves.toMatchObject({
        priorResponse: { id: record.id, requestHash: record.requestHash, response },
      });
      await expect(input.repository.listResponses(session.id)).resolves.toHaveLength(1);
    }
    const retry = await input.repository.acceptResponse({ ...record, id: randomUUID() }, 0);
    expect(retry).toMatchObject({
      status: "duplicate",
      response: { id: record.id, response, idempotencyKey: record.idempotencyKey },
      acknowledgement: { projection: { currentResponse: { id: record.id, response } } },
    });
    await expect(
      input.repository.acceptResponse(
        {
          ...record,
          id: randomUUID(),
          requestHash: "f".repeat(64),
          response: poll
            ? { choiceIds: [choices[1]!.id] }
            : { orderedChoiceIds: [...selected].reverse() },
        },
        1,
      ),
    ).resolves.toMatchObject({ status: "idempotency_conflict" });
    await expect(
      input.repository.acceptResponse(
        { ...record, id: randomUUID(), idempotencyKey: randomUUID() },
        1,
      ),
    ).resolves.toMatchObject({ status: "already_responded" });
    await input.repository.transitionSession({
      workspaceId: input.workspaceId,
      sessionId: session.id,
      expectedRevision: 1,
      phase: "question_reveal",
      currentBlockIndex: 0,
      status: "active",
      occurredAt: new Date(now.getTime() + 2000),
      event: { type: "question.revealed", blockIndex: 0, blockId },
    });
    await expect(input.repository.acceptResponse(record, 1)).resolves.toMatchObject({
      status: "duplicate",
      response: { response },
    });
    await expect(
      input.repository.getResponseContext(session.id, tokenHash, record.idempotencyKey!),
    ).resolves.toMatchObject({
      session: { phase: "question_reveal", content: { schemaVersion: 9 } },
      priorResponse: { response, responseSchemaVersion: 2 },
    });
    const stored = await input.repository.listResponses(session.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.response).toEqual(response);
    if (stored[0]!.response.orderedChoiceIds) stored[0]!.response.orderedChoiceIds.reverse();
    expect((await input.repository.listResponses(session.id))[0]!.response).toEqual(response);
    expect(
      (
        await input.repository.getParticipantSnapshotProjection(
          session.id,
          participantId,
          blockId,
          true,
        )
      )?.standing?.score,
    ).toBe(0);
  }
}
