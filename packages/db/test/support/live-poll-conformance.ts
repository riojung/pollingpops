import { createHash, randomUUID } from "node:crypto";
import { deriveRoundProtocol, type QuizDraft } from "@openround/contracts";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
} from "@openround/game-engine";
import { expect } from "vitest";
import type { Repository } from "../../src/index.js";

/** The same immutable artifacts, history, atomic acknowledgement and privacy boundaries in both stores. */
export async function expectLivePollPersistenceConformance(input: {
  repository: Repository;
  workspaceId: string;
  editorId: string;
  otherWorkspaceId: string;
  code: string;
  ranking?: boolean;
}) {
  const { repository, workspaceId, editorId, otherWorkspaceId, code } = input;
  const now = new Date();
  const question = {
    id: randomUUID(),
    type: "poll" as const,
    prompt: "Choose priorities",
    choices: ["One", "Two", "Three"].map((label) => ({
      id: randomUUID(),
      label,
      isCorrect: false,
    })),
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  const legacy: QuizDraft = { title: "Opinion limits", description: "", questions: [question] };
  const quiz = await repository.createQuiz({
    id: randomUUID(),
    workspaceId,
    title: legacy.title,
    description: "",
    status: "draft",
    draft: legacy,
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  expect(quiz.draftSchemaVersion).toBe(1);
  const artifactVersion = input.ranking ? 3 : 2;
  const limit = input.ranking ? { rankCount: 2 } : { maxSelections: 2 };
  const extended: QuizDraft = {
    ...legacy,
    questions: [
      input.ranking
        ? { ...question, type: "ranking", rankCount: 2 }
        : { ...question, maxSelections: 2 },
    ],
  };
  const saved = (await repository.updateQuiz(workspaceId, quiz.id, extended, 0, editorId))!;
  expect(saved).toMatchObject({ draftSchemaVersion: artifactVersion, draftRevision: 1 });
  expect(await repository.getQuizDraftHistory(workspaceId, quiz.id, 1)).toMatchObject({
    draftSchemaVersion: artifactVersion,
    draft: { questions: [limit] },
  });
  expect(await repository.getQuizDraftHistory(otherWorkspaceId, quiz.id, 1)).toBeNull();
  await expect(
    repository.updateQuizDraft({
      workspaceId,
      quizId: quiz.id,
      draft: extended,
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId,
      schemaVersion: artifactVersion - 1,
      draftHash: "wrong-version",
    }),
  ).rejects.toThrow(`schema version ${artifactVersion}`);
  const version = await repository.publishQuiz(
    {
      id: randomUUID(),
      workspaceId,
      quizId: quiz.id,
      version: 1,
      content: extended,
      contentHash: createHash("sha256").update(JSON.stringify(extended)).digest("hex"),
      publishedAt: now,
    },
    null,
    1,
  );
  expect(version.contentSchemaVersion).toBe(artifactVersion);
  expect(
    (await repository.getQuizVersion(workspaceId, version.id))?.content.questions[0],
  ).toMatchObject(limit);
  expect(
    await repository.listPublishedQuizQuestionMetadata(workspaceId, "Choose priorities"),
  ).toEqual({ questions: [], hasMore: false });
  await repository.updateQuiz(workspaceId, quiz.id, legacy, 1, editorId);
  expect((await repository.getQuiz(workspaceId, quiz.id))?.draftSchemaVersion).toBe(1);
  const restoration = {
    workspaceId,
    quizId: quiz.id,
    historyRevision: 1,
    expectedRevision: 2,
    mutationId: randomUUID(),
    editorId,
  };
  expect(await repository.restoreQuizDraftHistory(restoration)).toMatchObject({
    draftRevision: 3,
    draftSchemaVersion: artifactVersion,
  });
  expect(await repository.restoreQuizDraftHistory(restoration)).toMatchObject({
    draftRevision: 3,
    draftSchemaVersion: artifactVersion,
  });

  const sessionId = randomUUID();
  const state = createGameState({
    sessionId,
    code,
    quiz: extended,
    uxBeta: false,
    roundProtocol: deriveRoundProtocol(extended),
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      nicknamePolicy: "custom",
      allowLateJoin: true,
    },
  });
  const session = {
    id: sessionId,
    workspaceId,
    quizVersionId: version.id,
    hostId: editorId,
    hostTokenHash: randomUUID(),
    state,
    expiresAt: new Date(now.getTime() + 60_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
    createdAt: now,
    updatedAt: now,
  };
  await repository.createSession(session);
  const participantId = randomUUID();
  const joined = addParticipant(state, {
    id: participantId,
    nickname: "Participant",
    score: 0,
    correctCount: 0,
    acceptedResponseMs: 0,
    connected: true,
    kicked: false,
  }).state;
  await repository.commitParticipants(
    { ...session, state: joined },
    [
      {
        id: participantId,
        sessionId,
        nickname: "Participant",
        tokenHash: randomUUID(),
        status: "active",
        joinedAt: now,
      },
    ],
    state.version,
  );
  const opened = applyHostCommand(joined, {
    action: "start",
    commandId: randomUUID(),
    expectedVersion: joined.version,
    nowMs: now.getTime(),
    newRoundId: randomUUID,
  }).state;
  await repository.saveSession({ ...session, state: opened }, joined.version);
  const accepted = acceptAnswer(opened, {
    answerId: randomUUID(),
    participantId,
    roundId: opened.roundId!,
    idempotencyKey: randomUUID(),
    response: {
      kind: input.ranking ? "ranking" : "poll",
      choiceIds: question.choices
        .slice(0, 2)
        .map((choice) => choice.id)
        .reverse(),
    },
    nowMs: now.getTime() + 100,
  });
  expect(
    await repository.commitAnswer(
      { ...session, state: accepted.state },
      accepted.answer,
      opened.version,
    ),
  ).toEqual(accepted.answer);
  expect(await repository.getSessionById(sessionId)).toMatchObject({ state: accepted.state });
  expect((await repository.getSessionEvidence(workspaceId, sessionId)).answers).toEqual([
    accepted.answer,
  ]);
  expect((await repository.getSessionEvidence(otherWorkspaceId, sessionId)).answers).toEqual([]);
  expect(
    await repository.findAnswers(workspaceId, sessionId, [
      { participantId, roundId: opened.roundId!, idempotencyKey: accepted.answer.idempotencyKey },
    ]),
  ).toEqual([accepted.answer]);
  expect(accepted.state.participants[participantId]).toMatchObject({ score: 0, correctCount: 0 });
  expect(accepted.state.stateSchemaVersion).toBe(input.ranking ? 8 : 7);
  return {
    quizId: quiz.id,
    versionId: version.id,
    sessionId,
    answer: accepted.answer,
    state: accepted.state,
  };
}
