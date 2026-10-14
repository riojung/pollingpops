import { randomUUID } from "node:crypto";
import { deriveRoundProtocol, type QuizDraft } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
  evaluateResponse,
  moderateTextResponse,
  approvedTextResponseDistribution,
  responseDistributionFor,
  snapshotForRole,
  upgradeGameState,
  type GameState,
} from "../src/index.js";

const host = { kind: "host" as const, userId: randomUUID() };
function fixture(type: "open_text" | "word_cloud" = "open_text", audienceLimit = 250) {
  const question = {
    id: randomUUID(),
    type,
    prompt: "What should change?",
    timeLimitSeconds: 60,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  const quiz: QuizDraft = {
    title: "Feedback",
    description: "",
    questions: [question, { ...question, id: randomUUID() }],
  };
  let state = createGameState({
    sessionId: randomUUID(),
    code: "1234567",
    quiz,
    roundProtocol: deriveRoundProtocol(quiz),
    settings: {
      audienceLimit,
      scoringMode: "speed",
      resultVisibility: "private",
      nicknamePolicy: "custom",
      allowLateJoin: true,
    },
  });
  state = command(state, "start", 1000);
  return { question, state };
}
function command(
  state: GameState,
  action: "start" | "lock" | "reveal" | "next" | "end",
  nowMs: number,
) {
  return applyHostCommand(state, {
    action,
    commandId: randomUUID(),
    expectedVersion: state.version,
    nowMs,
    newRoundId: randomUUID,
  }).state;
}
function respond(state: GameState, value = "private body") {
  const id = randomUUID();
  const joined = addParticipant(state, {
    id,
    nickname: "Respondent",
    score: 0,
    correctCount: 0,
    acceptedResponseMs: 0,
    connected: true,
    kicked: false,
  }).state;
  const input = {
    answerId: randomUUID(),
    participantId: id,
    roundId: joined.roundId!,
    response: { kind: "text" as const, value },
    idempotencyKey: randomUUID(),
    nowMs: 1100,
  };
  return { ...acceptAnswer(joined, input), input };
}
function moderate(state: GameState, answerId: string, status: "approved" | "removed" = "approved") {
  const input = {
    commandId: randomUUID(),
    expectedVersion: state.version,
    answerId,
    status,
    actor: host,
    nowMs: 1200,
  };
  return { ...moderateTextResponse(state, input), input };
}
describe("moderated text opinion engine", () => {
  it("requires complete bounded state9 metadata and never invents approval during recovery", () => {
    const { state } = fixture();
    expect(state.stateSchemaVersion).toBe(9);
    expect(upgradeGameState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    for (const stateSchemaVersion of [5, 6, 7, 8])
      expect(() => upgradeGameState({ ...state, stateSchemaVersion })).toThrow("schema 9");
    expect(() => upgradeGameState({ ...state, responseModeration: undefined })).toThrow();
    expect(() => upgradeGameState({ ...state, responseModerationReceipts: undefined })).toThrow();
    expect(() => fixture("open_text", 251)).toThrow();
    const accepted = respond(state);
    const entry = accepted.state.responseModeration![accepted.answer.answerId]!;
    for (const stateSchemaVersion of [5, 6, 7, 8]) {
      const legacyQuiz: QuizDraft = {
        ...state.quiz,
        questions: state.quiz.questions.map((item) => ({
          ...item,
          type: "rating",
          maxSelections: undefined,
          rankCount: undefined,
          min: 1,
          max: 5,
          minLabel: "Low",
          maxLabel: "High",
        })),
      };
      expect(() =>
        upgradeGameState({
          ...accepted.state,
          quiz: legacyQuiz,
          stateSchemaVersion,
          roundProtocol: stateSchemaVersion >= 7 ? deriveRoundProtocol(legacyQuiz) : undefined,
          responseModeration: undefined,
          responseModerationReceipts: undefined,
        }),
      ).toThrow("schema 9");
    }
    expect(entry).toEqual({
      roundId: accepted.answer.roundId,
      questionId: state.quiz.questions[0]!.id,
      status: "pending",
      acceptedAtMs: 1100,
    });
    expect(() =>
      upgradeGameState({
        ...accepted.state,
        responseModeration: { [accepted.answer.answerId]: { ...entry, body: "hidden" } } as never,
      }),
    ).toThrow();
  });
  it("normalizes a single unscored answer and keeps every live projection body-free", () => {
    const { state, question } = fixture();
    const accepted = respond(state, "  Cafe\u0301 feedback  ");
    expect(accepted.answer.response).toEqual({ kind: "text", value: "Café feedback" });
    expect(accepted.answer).toMatchObject({ score: 0, correct: false, choiceId: null });
    expect(acceptAnswer(accepted.state, accepted.input)).toEqual({
      state: accepted.state,
      answer: accepted.answer,
    });
    expect(
      acceptAnswer(accepted.state, {
        ...accepted.input,
        idempotencyKey: randomUUID(),
        response: { kind: "text", value: "changed body" },
      }).answer,
    ).toEqual(accepted.answer);
    for (const role of ["host", "presenter", "participant"] as const) {
      const snapshot = snapshotForRole(accepted.state, {
        role,
        participantId: accepted.answer.participantId,
      });
      expect(snapshot.myResponse).toBeNull();
      expect(JSON.stringify(snapshot)).not.toContain("Café feedback");
      expect(snapshot.responseDistribution).toBeUndefined();
      if (role === "participant")
        expect(snapshot).toMatchObject({
          myResponseAccepted: true,
          myResponseModerationStatus: "pending",
        });
    }
    const revealed = command(command(accepted.state, "lock", 1200), "reveal", 1250);
    for (const role of ["host", "presenter", "participant"] as const) {
      const snapshot = snapshotForRole(revealed, {
        role,
        participantId: accepted.answer.participantId,
      });
      expect(snapshot.myCorrect).toBeNull();
      expect(snapshot.myResponse).toBeNull();
      expect(JSON.stringify(snapshot)).not.toContain("Café feedback");
    }
    for (const recheckMode of ["linked", "revote"] as const)
      expect(() =>
        applyHostCommand(revealed, {
          action: "recheck.open",
          recheckMode,
          commandId: randomUUID(),
          expectedVersion: revealed.version,
          nowMs: 1300,
          newRoundId: randomUUID,
        }),
      ).toThrow("cannot be rechecked or revoted");
    expect(responseDistributionFor(question, [accepted.answer])).toBeUndefined();
    expect(() => evaluateResponse(question, { kind: "text", value: "a\u0000b" })).toThrow();
    expect(() =>
      evaluateResponse(
        { ...question, type: "word_cloud" },
        { kind: "text", value: "x".repeat(81) },
      ),
    ).toThrow();
    expect(() =>
      applyHostCommand(accepted.state, {
        action: "recheck.open",
        commandId: randomUUID(),
        expectedVersion: accepted.state.version,
        nowMs: 1200,
        newRoundId: randomUUID,
      }),
    ).toThrow();
  });
  it("matches moderation intent before generic retries and permits only terminal-safe transitions", () => {
    const accepted = respond(fixture().state);
    const approved = moderate(accepted.state, accepted.answer.answerId);
    expect(approved.events.map((event) => event.type)).toEqual(["response.moderated"]);
    expect(JSON.stringify(approved.receipt)).not.toContain("private body");
    expect(moderateTextResponse(approved.state, { ...approved.input, nowMs: 9000 })).toMatchObject({
      state: approved.state,
      duplicate: true,
      events: [],
    });
    for (const patch of [
      { status: "removed" as const },
      { answerId: randomUUID() },
      { expectedVersion: approved.state.version },
      { actor: { kind: "cohost" as const, credentialId: randomUUID() } },
    ])
      expect(() => moderateTextResponse(approved.state, { ...approved.input, ...patch })).toThrow(
        "different intent",
      );
    expect(() =>
      applyHostCommand(approved.state, {
        commandId: approved.input.commandId,
        expectedVersion: approved.state.version,
        action: "lock",
        nowMs: 1300,
        newRoundId: randomUUID,
      }),
    ).toThrow("moderation");
    expect(() =>
      moderateTextResponse(accepted.state, {
        ...approved.input,
        commandId: Object.keys(accepted.state.processedCommands)[0]!,
      }),
    ).toThrow("another session action");
    expect(() => moderate(approved.state, accepted.answer.answerId)).toThrow("already approved");
    const removed = moderate(approved.state, accepted.answer.answerId, "removed");
    expect(() => moderate(removed.state, accepted.answer.answerId)).toThrow("not found");
    const finished = command(removed.state, "end", 1400);
    expect(moderateTextResponse(finished, removed.input)).toMatchObject({ duplicate: true });
    expect(() => moderate(finished, randomUUID())).toThrow("read-only");
  });
  it("retains reveal and moderation proof after answers clear and aggregates only five valid approved authors", () => {
    const { question } = fixture("word_cloud");
    let state = fixture("word_cloud").state;
    const authoredQuestion = state.quiz.questions[0]!;
    const answers = [];
    for (const value of [
      " BETTER feedback ",
      "better  feedback",
      "Better\u00a0feedback",
      "Cafe\u0301",
      "CAFÉ",
      "pending-marker",
      "removed-marker",
    ]) {
      const accepted = respond(state, value);
      answers.push(accepted.answer);
      state = accepted.state;
    }
    for (const answer of answers.slice(0, 5)) state = moderate(state, answer.answerId).state;
    state = moderate(state, answers[6]!.answerId, "removed").state;
    const aggregate = approvedTextResponseDistribution(
      authoredQuestion,
      answers,
      state.responseModeration,
    );
    expect(aggregate).toEqual({
      kind: "word_cloud",
      respondents: 5,
      buckets: [
        { value: "better feedback", label: "better feedback", count: 3, percent: 60 },
        { value: "café", label: "café", count: 2, percent: 40 },
      ],
    });
    expect(
      approvedTextResponseDistribution(question, answers, state.responseModeration),
    ).toBeUndefined();
    expect(
      approvedTextResponseDistribution(
        authoredQuestion,
        answers.slice(0, 4),
        state.responseModeration,
      ),
    ).toBeUndefined();
    expect(
      approvedTextResponseDistribution(
        authoredQuestion,
        [...answers.slice(0, 4), { ...answers[4]!, participantId: answers[0]!.participantId }],
        state.responseModeration,
      ),
    ).toBeUndefined();
    expect(
      approvedTextResponseDistribution(
        authoredQuestion,
        [
          ...answers.slice(0, 4),
          { ...answers[4]!, response: { kind: "text", value: "\u0000corrupt" } },
        ],
        state.responseModeration,
      ),
    ).toBeUndefined();
    state = command(state, "lock", 1250);
    state = command(state, "reveal", 1300);
    const roundId = state.roundId!;
    expect(state.rounds[roundId]!.revealedAtMs).toBe(1300);
    state = command(state, "next", 1400);
    expect(Object.keys(state.answers)).toHaveLength(0);
    expect(state.rounds[roundId]!.revealedAtMs).toBe(1300);
    expect(
      approvedTextResponseDistribution(authoredQuestion, answers, state.responseModeration),
    ).toEqual(aggregate);
    state = moderate(state, answers[0]!.answerId, "removed").state;
    expect(
      approvedTextResponseDistribution(authoredQuestion, answers, state.responseModeration),
    ).toBeUndefined();
  });
  it("caps accepted text respondents per checkpoint despite departures and rejoins", () => {
    let state = fixture().state;
    let first: ReturnType<typeof respond> | undefined;
    for (let index = 0; index < 250; index++) {
      const accepted = respond(state, `feedback ${index}`);
      first ??= accepted;
      state = {
        ...accepted.state,
        participants: {
          ...accepted.state.participants,
          [accepted.answer.participantId]: {
            ...accepted.state.participants[accepted.answer.participantId]!,
            kicked: true,
          },
        },
      };
    }
    expect(() => respond(state)).toThrow("limit for this checkpoint");
    expect(acceptAnswer(state, first!.input).answer).toEqual(first!.answer);
    expect(Object.keys(state.responseModeration!)).toHaveLength(250);
  });
});
