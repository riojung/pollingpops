import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { PresentationContentSchema, type PresentationContent } from "@openround/contracts";
import { interactionDocument } from "./presentation-interaction-fixture.js";
import type {
  PresentationSessionRepository,
  PresentationSessionResponseRecord,
} from "../../src/index.js";
export async function expectPresentationTextConformance(input: {
  repository: PresentationSessionRepository;
  workspaceId: string;
  presentationId: string;
  presentationVersionId: string;
  createdBy: string;
  schemaVersion?: 10 | 11 | 17;
  additionalBlocks?: PresentationContent["blocks"];
}) {
  const { repository, workspaceId } = input;
  for (const type of ["open_text", "word_cloud"] as const) {
    const now = new Date();
    const blockId = randomUUID().toUpperCase(),
      questionId = randomUUID().toUpperCase();
    const content = PresentationContentSchema.parse({
      title: "Moderated text",
      schemaVersion: input.schemaVersion ?? 10,
      blocks: [
        {
          id: blockId,
          kind: "question",
          question: {
            id: questionId,
            type,
            prompt: "Share a thought",
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
        ...(input.schemaVersion === 11 ? interactionDocument().blocks : []),
        ...(input.additionalBlocks ?? []),
      ],
    });
    const session = await repository.createSession({
      id: randomUUID(),
      workspaceId,
      presentationId: input.presentationId,
      presentationVersionId: input.presentationVersionId,
      title: content.title,
      content,
      code: String(randomInt(1000000, 10000000)),
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
      liveExpiresAt: new Date(now.getTime() + 3600000),
      retentionExpiresAt: new Date(now.getTime() + 86400000),
    });
    const credential = await repository.createCredential({
      id: randomUUID(),
      workspaceId,
      sessionId: session.id,
      role: "host",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      createdAt: now,
      expiresAt: session.liveExpiresAt,
      revokedAt: null,
    });
    const companion = await repository.createCredential({
      ...credential,
      id: randomUUID(),
      role: "companion",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    });
    const rows: PresentationSessionResponseRecord[] = [];
    for (let index = 0; index < 6; index++) {
      const participantId = randomUUID();
      await repository.addParticipant({
        id: participantId,
        workspaceId,
        sessionId: session.id,
        nickname: `Person ${index}`,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        joinedAt: now,
        lastSeenAt: now,
      });
      const textValue =
        index === 0
          ? "removed-private-marker"
          : type === "word_cloud"
            ? index % 2
              ? "  Shared   Idea "
              : "shared idea"
            : `Approved thought ${index}`;
      const response = { textValue };
      const row: PresentationSessionResponseRecord = {
        id: randomUUID(),
        workspaceId,
        sessionId: session.id,
        participantId,
        blockId: blockId.toLowerCase(),
        questionId: questionId.toLowerCase(),
        response,
        responseSchemaVersion: 3,
        correct: null,
        score: 0,
        responseMs: 1,
        submittedAt: new Date(now.getTime() + index + 1),
        idempotencyKey: randomUUID(),
        requestHash: createHash("sha256").update(JSON.stringify(response)).digest("hex"),
      };
      if (index === 0) {
        for (const invalid of [
          { idempotencyKey: undefined },
          { idempotencyKey: "" },
          { requestHash: undefined },
          { requestHash: "A".repeat(64) },
        ]) {
          await expect(repository.acceptResponse({ ...row, ...invalid }, 1)).rejects.toThrow(
            "complete retry receipt",
          );
        }
      }
      const accepted = await repository.acceptResponse(row, 1);
      expect(accepted.status).toBe("accepted");
      if (accepted.status !== "accepted") throw new Error("Expected text acceptance");
      expect(accepted.response).toMatchObject({
        response: {},
        moderationStatus: "pending",
        moderationVersion: 0,
      });
      expect(JSON.stringify(accepted)).not.toContain(textValue.trim());
      expect(accepted.acknowledgement.projection.currentResponse).toMatchObject({
        id: row.id,
        moderationStatus: "pending",
      });
      rows.push(row);
    }
    const read = {
      workspaceId,
      sessionId: session.id,
      blockId,
      limit: 50,
      actor: { role: "companion" as const, credentialId: companion.id },
    };
    expect((await repository.getTextResponseResults(read)).visible).toBe(false);
    const page = await repository.getTextModerationPage({
      workspaceId,
      sessionId: session.id,
      hostCredentialId: credential.id,
      status: "pending",
      limit: 1,
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const rejected = await repository.moderateTextResponse({
      workspaceId,
      sessionId: session.id,
      hostCredentialId: companion.id,
      commandId: randomUUID(),
      responseId: rows[0]!.id,
      expectedRevision: 1,
      expectedModerationVersion: 0,
      status: "approved",
      requestHash: "a".repeat(64),
      occurredAt: new Date(now.getTime() + 100),
    });
    expect(rejected.status).toBe("unauthorized");
    const commands = rows.slice(0, 5).map((row) => ({
      workspaceId,
      sessionId: session.id,
      hostCredentialId: credential.id,
      commandId: randomUUID(),
      responseId: row.id,
      expectedRevision: 1,
      expectedModerationVersion: 0,
      status: "approved" as const,
      requestHash: createHash("sha256").update(row.id).digest("hex"),
      occurredAt: new Date(now.getTime() + 100),
    }));
    const sameCommandRace = await Promise.all([
      repository.moderateTextResponse(commands[0]!),
      repository.moderateTextResponse(commands[0]!),
    ]);
    expect(sameCommandRace.map((result) => result.status).sort()).toEqual([
      "accepted",
      "duplicate",
    ]);
    const versionRace = await Promise.all([
      repository.moderateTextResponse(commands[1]!),
      repository.moderateTextResponse({
        ...commands[1]!,
        commandId: randomUUID(),
        requestHash: "e".repeat(64),
      }),
    ]);
    expect(versionRace.map((result) => result.status).sort()).toEqual(["accepted", "stale"]);
    for (const command of commands.slice(2))
      expect((await repository.moderateTextResponse(command)).status).toBe("accepted");
    const after = await repository.getSessionById(session.id);
    expect(after).toMatchObject({
      revision: 1,
      questionOpenedAt: now,
      questionClosesAt: null,
      textModerationSeq: 5,
    });
    const lateParticipantId = randomUUID();
    await repository.addParticipant({
      id: lateParticipantId,
      workspaceId,
      sessionId: session.id,
      nickname: "After moderation",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      joinedAt: now,
      lastSeenAt: now,
    });
    const lateResponse = { textValue: "pending-private-marker-extra" };
    expect(
      (
        await repository.acceptResponse(
          {
            ...rows[0]!,
            id: randomUUID(),
            participantId: lateParticipantId,
            response: lateResponse,
            idempotencyKey: randomUUID(),
            requestHash: createHash("sha256").update(JSON.stringify(lateResponse)).digest("hex"),
            submittedAt: new Date(now.getTime() + 150),
          },
          1,
        )
      ).status,
    ).toBe("accepted");

    await expect(
      repository.getTextModerationPage({
        workspaceId,
        sessionId: session.id,
        hostCredentialId: credential.id,
        status: "pending",
        limit: 1,
        cursor: page.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.getTextResponseResults(read)).visible).toBe(false);
    await repository.transitionSession({
      workspaceId,
      sessionId: session.id,
      expectedRevision: 1,
      phase: "question_reveal",
      currentBlockIndex: 0,
      status: "active",
      occurredAt: new Date(now.getTime() + 200),
      event: { type: "question.revealed", blockIndex: 0, blockId },
    });
    const visible = await repository.getTextResponseResults(read);
    expect(visible).toMatchObject({ visible: true, approvedRespondents: 5 });
    expect(JSON.stringify(visible)).not.toContain(rows[0]!.id);
    const removal = {
      ...commands[0]!,
      commandId: randomUUID(),
      expectedRevision: 2,
      expectedModerationVersion: 1,
      status: "removed" as const,
      requestHash: "b".repeat(64),
    };
    expect((await repository.moderateTextResponse(removal)).status).toBe("accepted");
    expect((await repository.getTextResponseResults(read)).visible).toBe(false);
    const removed = await repository.getTextModerationPage({
      workspaceId,
      sessionId: session.id,
      hostCredentialId: credential.id,
      status: "removed",
      limit: 50,
    });
    expect(removed.items).toMatchObject([
      { responseId: rows[0]!.id, textValue: null, moderationVersion: 2 },
    ]);
    const replay = await repository.moderateTextResponse(commands[0]!);
    expect(replay.status).toBe("duplicate");
    if (replay.status !== "duplicate") throw new Error("Expected moderation replay");
    expect(replay.receipt.status).toBe("approved");
    expect(replay.response.moderationStatus).toBe("removed");
    expect(JSON.stringify(replay)).not.toContain("removed-private-marker");
    expect((await repository.acceptResponse(rows[0]!, 1)).status).toBe("duplicate");
    const sixth = {
      ...commands[0]!,
      responseId: rows[5]!.id,
      commandId: randomUUID(),
      expectedRevision: 2,
      requestHash: "c".repeat(64),
    };
    expect((await repository.moderateTextResponse(sixth)).status).toBe("accepted");
    expect((await repository.getTextResponseResults(read)).visible).toBe(true);
    await expect(
      repository.transitionSessionCommand({
        workspaceId,
        sessionId: session.id,
        commandId: commands[0]!.commandId,
        expectedRevision: 2,
        requestHash: "d".repeat(64),
        phase: "question_reveal",
        currentBlockIndex: 0,
        status: "active",
        event: { type: "question.revealed", blockIndex: 0, blockId },
      }),
    ).resolves.toMatchObject({ status: "idempotency_conflict" });
    await repository.transitionSession({
      workspaceId,
      sessionId: session.id,
      expectedRevision: 2,
      phase: "finished",
      currentBlockIndex: 0,
      status: "finished",
      occurredAt: new Date(now.getTime() + 300),
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });
    const evidence = await repository.getTextReportEvidence({ workspaceId, sessionId: session.id });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.textResults.respondents).toBe(5);
    expect(JSON.stringify(evidence)).not.toContain("removed-private-marker");
    expect(JSON.stringify(evidence)).not.toContain("pending-private-marker-extra");
    expect(
      (
        await repository.moderateTextResponse({
          ...sixth,
          commandId: randomUUID(),
          expectedRevision: 3,
          expectedModerationVersion: 1,
          status: "removed",
        })
      ).status,
    ).toBe("phase_closed");
    expect((await repository.moderateTextResponse(commands[0]!)).status).toBe("duplicate");
    await repository.deleteSession(workspaceId, session.id);
    expect(
      await repository.findTextModerationReceipt(workspaceId, session.id, commands[0]!.commandId),
    ).toBeNull();
    expect(await repository.listResponses(session.id)).toEqual([]);
  }
}
