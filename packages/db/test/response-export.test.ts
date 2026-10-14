import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveRoundProtocol, type QuizDraft } from "@openround/contracts";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
  moderateTextResponse,
} from "@openround/game-engine";
import { MemoryRepository } from "../src/index.js";
import { roundAnswerExportAllowed, roundStateForExport } from "../src/response-export.js";

describe("moderated text account exports", () => {
  it("exports approved text only, without changing accepted records in storage", async () => {
    const repository = new MemoryRepository();
    const now = new Date();
    const tokenHash = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: `${randomUUID()}@example.com`,
      segment: "workplace",
      tokenHash,
      policyVersion: "test",
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
    });
    const owner = (await repository.consumeMagicToken(tokenHash, now))!;
    expect(owner).not.toBeNull();
    const draft: QuizDraft = {
      title: "Feedback",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "open_text",
          prompt: "What should change?",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 60,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    };
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: "",
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        quizId: quiz.id,
        version: 1,
        content: draft,
        contentHash: "test",
        publishedAt: now,
      },
      null,
      0,
    );
    const initial = createGameState({
      sessionId: randomUUID(),
      code: "8765432",
      quiz: draft,
      uxBeta: false,
      roundProtocol: deriveRoundProtocol(draft),
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        nicknamePolicy: "custom",
        allowLateJoin: true,
      },
    });
    const session = {
      id: initial.sessionId,
      workspaceId: owner.workspaceId,
      quizVersionId: version.id,
      hostId: owner.userId,
      hostTokenHash: randomUUID(),
      state: initial,
      expiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    };
    await repository.createSession(session);
    let state = initial;
    const participantIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of participantIds)
      state = addParticipant(state, {
        id,
        nickname: id,
        score: 0,
        correctCount: 0,
        acceptedResponseMs: 0,
        connected: true,
        kicked: false,
      }).state;
    await repository.commitParticipants(
      { ...session, state },
      participantIds.map((id) => ({
        id,
        sessionId: session.id,
        nickname: id,
        tokenHash: randomUUID(),
        status: "active" as const,
        joinedAt: now,
      })),
      initial.version,
    );
    const opened = applyHostCommand(state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: state.version,
      nowMs: now.getTime(),
      newRoundId: randomUUID,
    }).state;
    await repository.saveSession({ ...session, state: opened }, state.version);
    state = opened;
    const markers = ["approved-export-marker", "pending-export-marker", "removed-export-marker"];
    const answerIds: string[] = [];
    for (const [index, participantId] of participantIds.entries()) {
      const accepted = acceptAnswer(state, {
        answerId: randomUUID(),
        participantId,
        roundId: state.roundId!,
        idempotencyKey: randomUUID(),
        response: { kind: "text", value: markers[index]! },
        nowMs: now.getTime() + index + 1,
      });
      await repository.commitAnswer(
        { ...session, state: accepted.state },
        accepted.answer,
        state.version,
      );
      state = accepted.state;
      answerIds.push(accepted.answer.answerId);
    }
    for (const [index, status] of [
      [0, "approved"],
      [2, "removed"],
    ] as const) {
      const result = moderateTextResponse(state, {
        commandId: randomUUID(),
        expectedVersion: state.version,
        answerId: answerIds[index]!,
        status,
        actor: { kind: "host", userId: owner.userId },
        nowMs: now.getTime() + 10,
      });
      await repository.saveSession({ ...session, state: result.state }, state.version);
      state = result.state;
    }
    const exported = JSON.stringify(await repository.exportAccount(owner.userId));
    expect(exported).toContain(markers[0]);
    expect(exported).not.toContain(markers[1]);
    expect(exported).not.toContain(markers[2]);
    const durable = await repository.getSessionEvidence(owner.workspaceId, session.id);
    expect(durable.answers.map((answer) => answer.response)).toEqual(
      markers.map((value) => ({ kind: "text", value })),
    );
    expect(Object.keys((await repository.getSessionById(session.id))!.state.answers)).toHaveLength(
      3,
    );
    const copied = roundStateForExport(state);
    expect(Object.keys(copied.answers)).toHaveLength(1);
    const approved = durable.answers[0]!;
    expect(roundAnswerExportAllowed({ ...state, responseModeration: undefined }, approved)).toBe(
      false,
    );
    expect(
      roundAnswerExportAllowed(state, { ...approved, acceptedAtMs: approved.acceptedAtMs + 1 }),
    ).toBe(false);
    expect(roundAnswerExportAllowed({ ...state, rounds: {} }, approved)).toBe(false);
    copied.answers[answerIds[0]!]!.response = { kind: "text", value: "changed-export-copy" };
    expect(JSON.stringify(state.answers)).toContain(markers[0]);
  });
});
