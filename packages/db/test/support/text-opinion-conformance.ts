import { createHash, randomUUID } from "node:crypto";
import { deriveRoundProtocol, type QuizDraft } from "@openround/contracts";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
  moderateTextResponse,
  approvedTextResponseDistribution,
  type EngineAnswer,
} from "@openround/game-engine";
import { expect } from "vitest";
import type { Repository } from "../../src/index.js";

/** Exercise real acknowledged bodies, immutable moderation receipts, CAS races and account copies. */
export async function expectTextOpinionPersistenceConformance(input: {
  repository: Repository;
  workspaceId: string;
  editorId: string;
  otherWorkspaceId: string;
  code: string;
}) {
  const { repository, workspaceId, editorId, otherWorkspaceId, code } = input;
  const now = new Date();
  const question = {
    id: randomUUID(),
    type: "open_text" as const,
    prompt: "What should change?",
    timeLimitSeconds: 60,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  const draft: QuizDraft = {
    title: "Moderated feedback",
    description: "",
    questions: [question, { ...question, id: randomUUID(), type: "word_cloud" }],
  };
  const quiz = await repository.createQuiz({
    id: randomUUID(),
    workspaceId,
    title: draft.title,
    description: "",
    status: "draft",
    draft,
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  expect(quiz.draftSchemaVersion).toBe(4);
  const saved = (await repository.updateQuiz(workspaceId, quiz.id, draft, 0, editorId))!;
  expect(saved.draftSchemaVersion).toBe(4);
  expect(await repository.getQuizDraftHistory(workspaceId, quiz.id, 1)).toMatchObject({
    draftSchemaVersion: 4,
  });
  await expect(
    repository.updateQuizDraft({
      workspaceId,
      quizId: quiz.id,
      draft,
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId,
      schemaVersion: 3,
      draftHash: "wrong-version",
    }),
  ).rejects.toThrow("schema version 4");
  const version = await repository.publishQuiz(
    {
      id: randomUUID(),
      workspaceId,
      quizId: quiz.id,
      version: 1,
      content: draft,
      contentHash: createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
      publishedAt: now,
    },
    null,
    1,
  );
  expect(version.contentSchemaVersion).toBe(4);
  expect(
    (await repository.getQuizVersion(workspaceId, version.id))?.content.questions,
  ).toMatchObject(draft.questions);
  expect(await repository.listPublishedQuizQuestionMetadata(workspaceId, question.prompt)).toEqual({
    questions: [],
    hasMore: false,
  });
  const initial = createGameState({
    sessionId: randomUUID(),
    code,
    quiz: draft,
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
    workspaceId,
    quizVersionId: version.id,
    hostId: editorId,
    hostTokenHash: randomUUID(),
    state: initial,
    expiresAt: new Date(now.getTime() + 60000),
    retentionExpiresAt: new Date(now.getTime() + 86400000),
    createdAt: now,
    updatedAt: now,
  };
  await repository.createSession(session);
  const ids = Array.from({ length: 8 }, () => randomUUID());
  let state = initial;
  for (const id of ids)
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
    ids.map((id) => ({
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
  const markers = ids.map((_, index) =>
    index === 5
      ? "pending-pg-private-marker"
      : index === 6
        ? "removed-pg-private-marker"
        : `approved-pg-feedback-${index}`,
  );
  const answers: EngineAnswer[] = [];
  for (const [index, participantId] of ids.entries()) {
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
    answers.push(accepted.answer);
  }
  const actor = { kind: "host" as const, userId: editorId };
  for (const [index, status] of [
    [0, "approved"],
    [1, "approved"],
    [2, "approved"],
    [3, "approved"],
    [4, "approved"],
    [6, "removed"],
  ] as const) {
    const result = moderateTextResponse(state, {
      commandId: randomUUID(),
      expectedVersion: state.version,
      answerId: answers[index]!.answerId,
      status,
      actor,
      nowMs: now.getTime() + 20,
    });
    await repository.saveSession({ ...session, state: result.state }, state.version);
    state = result.state;
  }
  const racing = ["approved", "removed"].map((status) =>
    moderateTextResponse(state, {
      commandId: randomUUID(),
      expectedVersion: state.version,
      answerId: answers[7]!.answerId,
      status: status as "approved" | "removed",
      actor,
      nowMs: now.getTime() + 21,
    }),
  );
  const commits = await Promise.allSettled(
    racing.map((result) =>
      repository.saveSession({ ...session, state: result.state }, state.version),
    ),
  );
  expect(commits.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(commits.filter((result) => result.status === "rejected")).toHaveLength(1);
  const winner = commits.findIndex((result) => result.status === "fulfilled");
  state = (await repository.getSessionById(session.id))!.state;
  expect(state).toEqual(racing[winner]!.state);
  expect(Object.keys(state.responseModerationReceipts!)).toHaveLength(7);
  const invalidState = { ...state, responseModeration: undefined };
  await expect(
    repository.saveSession({ ...session, state: invalidState }, state.version),
  ).rejects.toThrow("metadata is required");
  await expect(
    repository.commitParticipants({ ...session, state: invalidState }, [], state.version),
  ).rejects.toThrow("metadata is required");
  await expect(
    repository.commitAnswers({ ...session, state: invalidState }, [], state.version),
  ).rejects.toThrow("metadata is required");
  await expect(
    repository.createSession({
      ...session,
      id: randomUUID(),
      state: { ...initial, sessionId: randomUUID(), responseModeration: undefined },
    }),
  ).rejects.toThrow("metadata is required");
  expect((await repository.getSessionById(session.id))!.state).toEqual(state);
  const requested = await repository.getSessionAnswersByIds(
    workspaceId,
    session.id,
    [...answers].reverse().map((answer) => answer.answerId),
  );
  expect(requested).toEqual(answers);
  expect(
    await repository.getSessionAnswersByIds(
      otherWorkspaceId,
      session.id,
      answers.map((answer) => answer.answerId),
    ),
  ).toEqual([]);
  expect(
    await repository.getSessionAnswersByIds(
      workspaceId,
      randomUUID(),
      answers.map((answer) => answer.answerId),
    ),
  ).toEqual([]);
  await expect(
    repository.getSessionAnswersByIds(
      workspaceId,
      session.id,
      Array.from({ length: 101 }, () => randomUUID()),
    ),
  ).rejects.toThrow();
  await expect(
    repository.getSessionAnswersByIds(workspaceId, session.id, [
      answers[0]!.answerId,
      answers[0]!.answerId,
    ]),
  ).rejects.toThrow();
  const exported = JSON.stringify(await repository.exportAccount(editorId));
  expect(exported).toContain(markers[0]);
  expect(exported).not.toContain(markers[5]);
  expect(exported).not.toContain(markers[6]);
  expect(
    await repository.getSessionAnswersByIds(
      workspaceId,
      session.id,
      answers.map((answer) => answer.answerId),
    ),
  ).toEqual(answers);
  expect(Object.keys((await repository.getSessionById(session.id))!.state.answers)).toHaveLength(8);
  const revealed = applyHostCommand(
    applyHostCommand(state, {
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: state.version,
      nowMs: now.getTime() + 30,
      newRoundId: randomUUID,
    }).state,
    {
      action: "reveal",
      commandId: randomUUID(),
      expectedVersion: state.version + 1,
      nowMs: now.getTime() + 31,
      newRoundId: randomUUID,
    },
  ).state;
  await repository.saveSession({ ...session, state: revealed }, state.version);
  const next = applyHostCommand(revealed, {
    action: "next",
    commandId: randomUUID(),
    expectedVersion: revealed.version,
    nowMs: now.getTime() + 32,
    newRoundId: randomUUID,
  }).state;
  await repository.saveSession({ ...session, state: next }, revealed.version);
  expect(Object.keys(next.answers)).toHaveLength(0);
  expect(next.rounds[opened.roundId!]!.revealedAtMs).toBe(now.getTime() + 31);
  const durable = await repository.getSessionEvidence(workspaceId, session.id);
  expect(durable.answers).toEqual(answers);
  const distribution = approvedTextResponseDistribution(
    question,
    durable.answers,
    next.responseModeration,
  );
  expect(distribution?.respondents).toBe(winner === 0 ? 6 : 5);
  expect(JSON.stringify(distribution)).not.toContain(markers[5]);
  expect(JSON.stringify(distribution)).not.toContain(markers[6]);
  return {
    quizId: quiz.id,
    versionId: version.id,
    sessionId: session.id,
    answers,
    state: next,
    initialAnsweredState: state,
    question,
    exported,
  };
}
