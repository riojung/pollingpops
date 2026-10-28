import { randomUUID } from "node:crypto";
import { type QuizDraft } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  avatarIdForSeed,
  calculateScore,
  createGameState,
  EngineError,
  leaderboard,
  snapshotForRole,
  upgradeGameState,
} from "../src/index.js";

function fixture() {
  const correctId = randomUUID();
  const wrongId = randomUUID();
  return {
    correctId,
    wrongId,
    state: createGameState({
      sessionId: randomUUID(),
      code: "1234567",
      quiz: {
        title: "Demo",
        description: "",
        questions: [
          {
            id: randomUUID(),
            type: "single_select",
            prompt: "What is two plus two?",
            choices: [
              { id: correctId, label: "Four", isCorrect: true },
              { id: wrongId, label: "Five", isCorrect: false },
            ],
            timeLimitSeconds: 10,
            basePoints: 1_000,
            explanation: "Two pairs make four.",
            mediaId: null,
            mediaAlt: null,
            sourceCitations: [
              {
                sourceName: "Private facilitator guide.pdf",
                sourceDigest: "a".repeat(64),
                locator: "page 2",
                excerpt: "Two pairs make four.",
              },
            ],
          },
        ],
      },
      settings: {
        audienceLimit: 20,
        scoringMode: "speed",
        resultVisibility: "leaderboard",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    }),
  };
}

function stateForQuestions(questions: QuizDraft["questions"], confidenceEnabled = false) {
  return createGameState({
    sessionId: randomUUID(),
    code: "1234567",
    quiz: { title: "Response types", description: "", questions },
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
      confidenceEnabled,
    },
  });
}

function participant(id = randomUUID()) {
  return {
    id,
    nickname: "Learner",
    score: 0,
    correctCount: 0,
    acceptedResponseMs: 0,
    connected: true,
    kicked: false,
  };
}

describe("game engine", () => {
  it("persists trust mode in state and role snapshots without coupling it to result visibility", () => {
    const { state } = fixture();
    expect(state.settings).toMatchObject({
      trustMode: "learning",
      resultVisibility: "leaderboard",
    });
    expect(snapshotForRole(state, { role: "host" }).settings).toMatchObject({
      trustMode: "learning",
      resultVisibility: "leaderboard",
    });

    const verified = createGameState({
      sessionId: randomUUID(),
      code: "7654321",
      quiz: state.quiz,
      settings: {
        ...state.settings,
        trustMode: "verified",
        resultVisibility: "private",
      },
    });
    expect(verified.settings).toMatchObject({
      trustMode: "verified",
      resultVisibility: "private",
    });
  });

  it("preserves original fallback avatars and expanded explicit selections", () => {
    const { state } = fixture();
    const fallbackParticipant = participant("00000000-0000-4000-8000-000000000002");
    const joinedWithFallback = addParticipant(state, fallbackParticipant);
    const fallbackAvatar = avatarIdForSeed(fallbackParticipant.id);

    expect(fallbackAvatar).toBe("star");
    expect(joinedWithFallback.state.participants[fallbackParticipant.id]?.avatarId).toBe(
      fallbackAvatar,
    );
    expect(leaderboard(joinedWithFallback.state)[0]?.avatarId).toBe(fallbackAvatar);

    const upgradedCurrentState = upgradeGameState({
      ...state,
      participants: { [fallbackParticipant.id]: fallbackParticipant },
    });
    expect(upgradedCurrentState.stateSchemaVersion).toBe(5);
    expect(upgradedCurrentState.settings.trustMode).toBe("learning");
    expect(upgradedCurrentState.settings.timeMode).toBe("timed");
    expect(upgradedCurrentState.participants[fallbackParticipant.id]?.avatarId).toBe(
      fallbackAvatar,
    );

    const explicitParticipant = {
      ...participant(),
      nickname: "Hedgehog learner",
      avatarId: "hedgehog" as const,
    };
    const joinedExplicitly = addParticipant(joinedWithFallback.state, explicitParticipant);
    expect(joinedExplicitly.state.participants[explicitParticipant.id]?.avatarId).toBe("hedgehog");
    expect(
      snapshotForRole(joinedExplicitly.state, {
        role: "participant",
        participantId: explicitParticipant.id,
      }).participants.find(({ id }) => id === explicitParticipant.id),
    ).toMatchObject({ avatarId: "hedgehog" });
  });

  it("uses the independently specified scoring formula at its boundaries", () => {
    expect(
      calculateScore({
        correct: true,
        basePoints: 1_000,
        elapsedMs: 0,
        limitMs: 10_000,
        mode: "speed",
      }),
    ).toBe(1_000);
    expect(
      calculateScore({
        correct: true,
        basePoints: 1_000,
        elapsedMs: 5_000,
        limitMs: 10_000,
        mode: "speed",
      }),
    ).toBe(800);
    expect(
      calculateScore({
        correct: true,
        basePoints: 1_000,
        elapsedMs: 10_000,
        limitMs: 10_000,
        mode: "speed",
      }),
    ).toBe(600);
    expect(
      calculateScore({
        correct: true,
        basePoints: 1_000,
        elapsedMs: 20_000,
        limitMs: 10_000,
        mode: "speed",
      }),
    ).toBe(600);
    expect(
      calculateScore({
        correct: true,
        basePoints: 1_000,
        elapsedMs: 9_999,
        limitMs: 10_000,
        mode: "accuracy",
      }),
    ).toBe(1_000);
    expect(
      calculateScore({
        correct: false,
        basePoints: 1_000,
        elapsedMs: 0,
        limitMs: 10_000,
        mode: "speed",
      }),
    ).toBe(0);

    for (const basePoints of [0, 1, 999, 10_000]) {
      for (let elapsedMs = 0; elapsedMs <= 20_000; elapsedMs += 137) {
        const score = calculateScore({
          correct: true,
          basePoints,
          elapsedMs,
          limitMs: 10_000,
          mode: "speed",
        });
        expect(score).toBeGreaterThanOrEqual(Math.round(basePoints * 0.6));
        expect(score).toBeLessThanOrEqual(basePoints);
      }
    }
  });

  it("rejects stale host versions without changing state", () => {
    const { state } = fixture();
    const before = structuredClone(state);

    try {
      applyHostCommand(state, {
        action: "start",
        commandId: randomUUID(),
        expectedVersion: state.version + 1,
        nowMs: 1_000,
        newRoundId: randomUUID,
      });
      throw new Error("Expected a stale-version error");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe("STALE_VERSION");
    }

    expect(state).toEqual(before);
  });

  it("does not advance twice when a host command is retried", () => {
    const { state } = fixture();
    const commandId = randomUUID();
    const started = applyHostCommand(state, {
      action: "start",
      commandId,
      expectedVersion: 0,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    const retried = applyHostCommand(started.state, {
      action: "start",
      commandId,
      expectedVersion: 0,
      nowMs: 1_001,
      newRoundId: randomUUID,
    });

    expect(retried.duplicate).toBe(true);
    expect(retried.state.version).toBe(started.state.version);
  });

  it("accepts one durable effect for answer retries", () => {
    const { state, correctId } = fixture();
    const participantId = randomUUID();
    const joined = addParticipant(state, {
      id: participantId,
      nickname: "Robin",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    });
    const started = applyHostCommand(joined.state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    const idempotencyKey = randomUUID();
    const first = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId,
      roundId: started.state.roundId!,
      choiceId: correctId,
      idempotencyKey,
      nowMs: 2_000,
    });
    const retry = acceptAnswer(first.state, {
      answerId: randomUUID(),
      participantId,
      roundId: started.state.roundId!,
      choiceId: correctId,
      idempotencyKey,
      nowMs: 2_100,
    });

    expect(retry.answer.answerId).toBe(first.answer.answerId);
    expect(retry.state.participants[participantId]?.score).toBe(
      first.state.participants[participantId]?.score,
    );
  });

  it("accepts the deadline boundary and rejects an answer one millisecond late", () => {
    const startSession = () => {
      const { state, correctId } = fixture();
      const participantId = randomUUID();
      const joined = addParticipant(state, {
        id: participantId,
        nickname: "Deadline tester",
        score: 0,
        correctCount: 0,
        acceptedResponseMs: 0,
        connected: true,
        kicked: false,
      });
      const started = applyHostCommand(joined.state, {
        action: "start",
        commandId: randomUUID(),
        expectedVersion: joined.state.version,
        nowMs: 1_000,
        newRoundId: randomUUID,
      });
      return { correctId, participantId, started };
    };

    const onTime = startSession();
    const accepted = acceptAnswer(onTime.started.state, {
      answerId: randomUUID(),
      participantId: onTime.participantId,
      roundId: onTime.started.state.roundId!,
      choiceId: onTime.correctId,
      idempotencyKey: randomUUID(),
      nowMs: 11_000,
    });
    expect(accepted.answer.responseMs).toBe(10_000);
    expect(accepted.answer.score).toBe(600);

    const late = startSession();
    try {
      acceptAnswer(late.started.state, {
        answerId: randomUUID(),
        participantId: late.participantId,
        roundId: late.started.state.roundId!,
        choiceId: late.correctId,
        idempotencyKey: randomUUID(),
        nowMs: 11_001,
      });
      throw new Error("Expected a late-answer error");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe("ANSWER_LATE");
    }
  });

  it("preserves the remaining server deadline across pause and resume", () => {
    const { state, correctId } = fixture();
    const learner = participant();
    const joined = addParticipant(state, learner);
    const started = applyHostCommand(joined.state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    const paused = applyHostCommand(started.state, {
      action: "pause",
      commandId: randomUUID(),
      expectedVersion: started.state.version,
      nowMs: 4_000,
      newRoundId: randomUUID,
    });
    expect(paused.state.pausedRemainingMs).toBe(7_000);
    expect(paused.state.deadlineMs).toBeNull();

    const resumed = applyHostCommand(paused.state, {
      action: "resume",
      commandId: randomUUID(),
      expectedVersion: paused.state.version,
      nowMs: 20_000,
      newRoundId: randomUUID,
    });
    expect(resumed.state.phase).toBe("question_open");
    expect(resumed.state.deadlineMs).toBe(27_000);

    const restored = upgradeGameState(JSON.parse(JSON.stringify(resumed.state)));
    const accepted = acceptAnswer(restored, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: restored.roundId!,
      choiceId: correctId,
      idempotencyKey: randomUUID(),
      nowMs: 21_000,
    });
    expect(accepted.answer.responseMs).toBe(4_000);
    expect(accepted.answer.score).toBe(840);
    expect(accepted.state.participants[learner.id]?.acceptedResponseMs).toBe(4_000);
    expect(accepted.state.rounds[restored.roundId!]?.openedAtMs).toBe(1_000);
  });

  it("keeps flex questions open until host close without speed scoring or a countdown", () => {
    const { state: source, correctId } = fixture();
    const state = createGameState({
      sessionId: randomUUID(),
      code: "1234567",
      quiz: source.quiz,
      settings: { ...source.settings, timeMode: "flex", scoringMode: "speed" },
    });
    const slowerId = "00000000-0000-4000-8000-000000000001";
    const fasterId = "00000000-0000-4000-8000-000000000002";
    expect(
      leaderboard({
        ...state,
        participants: {
          [slowerId]: {
            ...participant(slowerId),
            score: 1_000,
            correctCount: 1,
            acceptedResponseMs: 50_000,
          },
          [fasterId]: {
            ...participant(fasterId),
            score: 1_000,
            correctCount: 1,
            acceptedResponseMs: 1_000,
          },
        },
      }).map(({ id }) => id),
    ).toEqual([slowerId, fasterId]);
    const learner = participant();
    const joined = addParticipant(state, learner);
    const started = applyHostCommand(joined.state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    expect(started.state.settings).toMatchObject({ timeMode: "flex", scoringMode: "accuracy" });
    expect(started.state.deadlineMs).toBeNull();
    expect(started.state.rounds[started.state.roundId!]?.deadlineMs).toBeNull();
    expect(
      snapshotForRole(started.state, { role: "participant", participantId: learner.id }),
    ).toMatchObject({
      deadline: null,
      settings: { timeMode: "flex", scoringMode: "accuracy" },
    });

    const paused = applyHostCommand(started.state, {
      action: "pause",
      commandId: randomUUID(),
      expectedVersion: started.state.version,
      nowMs: 11_000,
      newRoundId: randomUUID,
    });
    expect(paused.state.pausedRemainingMs).toBeNull();
    expect(() =>
      acceptAnswer(paused.state, {
        answerId: randomUUID(),
        participantId: learner.id,
        roundId: paused.state.roundId!,
        choiceId: correctId,
        idempotencyKey: randomUUID(),
        nowMs: 12_000,
      }),
    ).toThrow(EngineError);
    const resumed = applyHostCommand(paused.state, {
      action: "resume",
      commandId: randomUUID(),
      expectedVersion: paused.state.version,
      nowMs: 60_000,
      newRoundId: randomUUID,
    });
    expect(resumed.state.deadlineMs).toBeNull();
    const answered = acceptAnswer(resumed.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: resumed.state.roundId!,
      choiceId: correctId,
      idempotencyKey: randomUUID(),
      nowMs: 3_600_000,
    });
    expect(answered.answer.score).toBe(1_000);
    const locked = applyHostCommand(answered.state, {
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: answered.state.version,
      nowMs: 3_601_000,
      newRoundId: randomUUID,
    });
    expect(locked.state.rounds[locked.state.roundId!]?.lockedAtMs).toBe(3_601_000);
    expect(() =>
      acceptAnswer(locked.state, {
        answerId: randomUUID(),
        participantId: learner.id,
        roundId: locked.state.roundId!,
        choiceId: correctId,
        idempotencyKey: randomUUID(),
        nowMs: 3_602_000,
      }),
    ).toThrow(EngineError);
  });

  it("never exposes answer keys or facilitator metadata in participant questions", () => {
    const { state } = fixture();
    const started = applyHostCommand(state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: 0,
      nowMs: Date.now(),
      newRoundId: randomUUID,
    });
    const snapshot = snapshotForRole(started.state, { role: "participant" });

    expect(snapshot.correctChoiceId).toBeUndefined();
    expect(snapshot.correctResponse).toBeUndefined();
    expect(snapshot.question).not.toHaveProperty("purpose");
    expect(snapshot.question).not.toHaveProperty("linkedRecheckAvailable");
    expect(JSON.stringify(snapshot.question)).not.toContain("isCorrect");
    expect(JSON.stringify(snapshot.question)).not.toContain("Private facilitator guide");
    expect(JSON.stringify(snapshot.question)).not.toContain("sourceCitations");
  });

  it("only exposes aggregate distributions to staff after lock with at least five responses", () => {
    const answered = (count: number) => {
      const { state, correctId, wrongId } = fixture();
      const participantIds = Array.from({ length: count }, () => randomUUID());
      const joined = participantIds.reduce(
        (current, id, index) =>
          addParticipant(current, {
            ...participant(id),
            nickname: `Learner ${index + 1}`,
          }).state,
        state,
      );
      const started = applyHostCommand(joined, {
        action: "start",
        commandId: randomUUID(),
        expectedVersion: joined.version,
        nowMs: 1_000,
        newRoundId: randomUUID,
      });
      const withAnswers = participantIds.reduce(
        (current, participantId, index) =>
          acceptAnswer(current, {
            answerId: randomUUID(),
            participantId,
            roundId: current.roundId!,
            choiceId: index < 3 ? correctId : wrongId,
            idempotencyKey: randomUUID(),
            nowMs: 2_000 + index,
          }).state,
        started.state,
      );
      return { state: withAnswers, participantIds };
    };

    const five = answered(5);
    expect(snapshotForRole(five.state, { role: "host" }).responseDistribution).toBeUndefined();
    const locked = applyHostCommand(five.state, {
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: five.state.version,
      nowMs: 3_000,
      newRoundId: randomUUID,
    });
    expect(snapshotForRole(locked.state, { role: "host" }).responseDistribution).toMatchObject({
      kind: "choice",
      respondents: 5,
      totalSelections: 5,
      percentBasis: "responses",
      buckets: [
        { label: "Four", count: 3, percent: 60 },
        { label: "Five", count: 2, percent: 40 },
      ],
    });
    expect(
      snapshotForRole(locked.state, {
        role: "participant",
        participantId: five.participantIds[0],
      }).responseDistribution,
    ).toBeUndefined();

    const four = answered(4);
    const fourLocked = applyHostCommand(four.state, {
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: four.state.version,
      nowMs: 3_000,
      newRoundId: randomUUID,
    });
    expect(
      snapshotForRole(fourLocked.state, { role: "presenter" }).responseDistribution,
    ).toBeUndefined();
  });

  it("labels multi-select percentages by respondent and limits numeric evidence to totals", () => {
    const answerQuestion = (
      question: QuizDraft["questions"][number],
      responseAt: (index: number) => Parameters<typeof acceptAnswer>[1]["response"],
    ) => {
      const participantIds = Array.from({ length: 5 }, () => randomUUID());
      const joined = participantIds.reduce(
        (current, id, index) =>
          addParticipant(current, { ...participant(id), nickname: `Learner ${index + 1}` }).state,
        stateForQuestions([question]),
      );
      const started = applyHostCommand(joined, {
        action: "start",
        commandId: randomUUID(),
        expectedVersion: joined.version,
        nowMs: 1_000,
        newRoundId: randomUUID,
      });
      const answered = participantIds.reduce(
        (current, participantId, index) =>
          acceptAnswer(current, {
            answerId: randomUUID(),
            participantId,
            roundId: current.roundId!,
            response: responseAt(index),
            idempotencyKey: randomUUID(),
            nowMs: 2_000 + index,
          }).state,
        started.state,
      );
      return applyHostCommand(answered, {
        action: "lock",
        commandId: randomUUID(),
        expectedVersion: answered.version,
        nowMs: 3_000,
        newRoundId: randomUUID,
      }).state;
    };

    const first = randomUUID();
    const second = randomUUID();
    const multiSelect = answerQuestion(
      {
        id: randomUUID(),
        type: "multi_select",
        prompt: "Select both safe actions",
        choices: [
          { id: first, label: "Pause", isCorrect: true },
          { id: second, label: "Escalate", isCorrect: true },
          { id: randomUUID(), label: "Ignore", isCorrect: false },
        ],
        timeLimitSeconds: 10,
        basePoints: 1_000,
        explanation: "Pause and escalate.",
        mediaId: null,
        mediaAlt: null,
      },
      (index) => ({ kind: "choice", choiceIds: index < 3 ? [first, second] : [first] }),
    );
    expect(snapshotForRole(multiSelect, { role: "host" }).responseDistribution).toMatchObject({
      kind: "choice",
      respondents: 5,
      totalSelections: 8,
      percentBasis: "respondents",
      buckets: [
        { label: "Pause", count: 5, percent: 100 },
        { label: "Escalate", count: 3, percent: 60 },
        { label: "Ignore", count: 0, percent: 0 },
      ],
    });

    const numeric = answerQuestion(
      {
        id: randomUUID(),
        type: "numeric",
        prompt: "What is six times seven?",
        correctValue: "42",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 10,
        basePoints: 1_000,
        explanation: "Six groups of seven total 42.",
        mediaId: null,
        mediaAlt: null,
      },
      (index) => ({ kind: "numeric", value: index < 3 ? "42" : "41" }),
    );
    expect(snapshotForRole(numeric, { role: "host" }).responseDistribution).toEqual({
      kind: "numeric",
      respondents: 5,
      correct: 3,
      incorrect: 2,
    });
    expect(
      JSON.stringify(snapshotForRole(numeric, { role: "host" }).responseDistribution),
    ).not.toContain("41");
  });

  it("locks and unlocks the lobby and removes a kicked participant", () => {
    const { state } = fixture();
    const participantId = randomUUID();
    const joined = addParticipant(state, {
      id: participantId,
      nickname: "Casey",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    });
    const locked = applyHostCommand(joined.state, {
      action: "lock_lobby",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    expect(snapshotForRole(locked.state, { role: "host" }).lobbyLocked).toBe(true);

    const unlocked = applyHostCommand(locked.state, {
      action: "unlock_lobby",
      commandId: randomUUID(),
      expectedVersion: locked.state.version,
      nowMs: 1_001,
      newRoundId: randomUUID,
    });
    const kicked = applyHostCommand(unlocked.state, {
      action: "kick",
      participantId,
      commandId: randomUUID(),
      expectedVersion: unlocked.state.version,
      nowMs: 1_002,
      newRoundId: randomUUID,
    });

    expect(snapshotForRole(kicked.state, { role: "host" }).participants).toHaveLength(0);
    expect(kicked.state.participants[participantId]?.kicked).toBe(true);
  });

  it("orders ties by correctness, response time, then stable participant ID", () => {
    const { state } = fixture();
    const participants = [
      {
        id: "00000000-0000-4000-8000-000000000004",
        nickname: "Slower",
        score: 1_000,
        correctCount: 1,
        acceptedResponseMs: 1_000,
        connected: true,
        kicked: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        nickname: "More correct",
        score: 1_000,
        correctCount: 2,
        acceptedResponseMs: 9_000,
        connected: true,
        kicked: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        nickname: "Stable B",
        score: 1_000,
        correctCount: 1,
        acceptedResponseMs: 500,
        connected: true,
        kicked: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        nickname: "Stable A",
        score: 1_000,
        correctCount: 1,
        acceptedResponseMs: 500,
        connected: true,
        kicked: false,
      },
    ];
    const populated = participants.reduce(
      (current, participant) => addParticipant(current, participant).state,
      state,
    );

    expect(leaderboard(populated).map(({ id }) => id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ]);
  });

  it("redacts other participant identities and scores in private results", () => {
    const { state } = fixture();
    const viewerId = "00000000-0000-4000-8000-000000000001";
    const otherId = "00000000-0000-4000-8000-000000000002";
    const privateState = {
      ...state,
      settings: { ...state.settings, resultVisibility: "private" as const },
    };
    const withViewer = addParticipant(privateState, {
      id: viewerId,
      nickname: "Viewer",
      avatarId: "fox",
      score: 800,
      correctCount: 1,
      acceptedResponseMs: 2_000,
      connected: true,
      kicked: false,
    });
    const withOther = addParticipant(withViewer.state, {
      id: otherId,
      nickname: "Secret name",
      avatarId: "owl",
      score: 1_000,
      correctCount: 1,
      acceptedResponseMs: 1_000,
      connected: true,
      kicked: false,
    });

    const snapshot = snapshotForRole(withOther.state, {
      role: "participant",
      participantId: viewerId,
    });
    expect(snapshot.participants.find(({ id }) => id === viewerId)).toMatchObject({
      nickname: "Viewer",
      avatarId: "fox",
      score: 800,
      rank: 2,
    });
    expect(snapshot.participants.find(({ id }) => id === otherId)).toMatchObject({
      nickname: "Participant",
      score: 0,
      rank: null,
    });
    expect(snapshot.participants.find(({ id }) => id === otherId)?.avatarId).toBeUndefined();
    expect(
      snapshotForRole(withOther.state, { role: "host" }).participants.find(
        ({ id }) => id === otherId,
      ),
    ).toMatchObject({ nickname: "Secret name", avatarId: "owl" });
  });

  it("maintains monotonic version and sequence invariants across arbitrary command sequences", () => {
    const actions = [
      "start",
      "pause",
      "resume",
      "lock",
      "reveal",
      "show_leaderboard",
      "next",
      "end",
      "lock_lobby",
      "unlock_lobby",
    ] as const;
    const validPhases = new Set([
      "lobby",
      "question_open",
      "paused",
      "question_locked",
      "question_reveal",
      "leaderboard",
      "finished",
    ]);

    for (let seed = 1; seed <= 64; seed += 1) {
      let randomState = seed;
      const nextRandom = () => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0;
        return randomState;
      };
      let current = fixture().state;

      for (let step = 0; step < 80; step += 1) {
        const before = current;
        const action = actions[nextRandom() % actions.length]!;
        try {
          const result = applyHostCommand(current, {
            action,
            commandId: `seed-${seed}-step-${step}`,
            expectedVersion: current.version,
            nowMs: 1_000 + step * 100,
            newRoundId: randomUUID,
          });
          expect(result.state.version).toBe(before.version + 1);
          expect(result.state.seq).toBe(before.seq + result.events.length);
          expect(result.events.map(({ seq }) => seq)).toEqual(
            result.events.map((_, index) => before.seq + index + 1),
          );
          expect(validPhases.has(result.state.phase)).toBe(true);
          expect(before.version).toBeLessThan(result.state.version);
          current = result.state;
        } catch (error) {
          expect(error).toBeInstanceOf(EngineError);
          expect(current).toBe(before);
        }
      }
    }
  });

  it("keeps legacy-required confidence optional and scores multi-select only for an exact set", () => {
    const first = randomUUID();
    const second = randomUUID();
    const distractor = randomUUID();
    const learner = participant();
    const joined = addParticipant(
      stateForQuestions(
        [
          {
            id: randomUUID(),
            type: "multi_select",
            prompt: "Select both prime numbers",
            purpose: "diagnostic",
            confidence: "required",
            delivery: "main",
            conceptKeys: ["prime-numbers"],
            linkedRecheckQuestionId: null,
            choices: [
              { id: first, label: "2", isCorrect: true },
              { id: second, label: "3", isCorrect: true },
              { id: distractor, label: "4", isCorrect: false },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "Two and three are prime.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
        true,
      ),
      learner,
    );
    const started = applyHostCommand(joined.state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });

    const withoutConfidence = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: started.state.roundId!,
      response: { kind: "choice", choiceIds: [first, second] },
      idempotencyKey: randomUUID(),
      nowMs: 2_000,
    });
    expect(withoutConfidence.answer).toMatchObject({
      correct: true,
      score: 1_000,
      confidence: null,
    });

    const partial = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: started.state.roundId!,
      response: { kind: "choice", choiceIds: [first] },
      confidence: 2,
      idempotencyKey: randomUUID(),
      nowMs: 2_000,
    });
    expect(partial.answer.correct).toBe(false);
    expect(partial.answer.score).toBe(0);

    const exact = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: started.state.roundId!,
      response: { kind: "choice", choiceIds: [second, first] },
      confidence: 3,
      idempotencyKey: randomUUID(),
      nowMs: 2_000,
    });
    expect(exact.answer.response).toEqual({ kind: "choice", choiceIds: [first, second].sort() });
    expect(exact.answer.correct).toBe(true);
    expect(exact.answer.score).toBe(1_000);
  });

  it("compares normalized numeric responses with decimal tolerance and units", () => {
    const learner = participant();
    const joined = addParticipant(
      stateForQuestions(
        [
          {
            id: randomUUID(),
            type: "numeric",
            prompt: "How many metres?",
            purpose: "practice",
            confidence: "optional",
            delivery: "main",
            conceptKeys: ["measurement"],
            linkedRecheckQuestionId: null,
            correctValue: "0.3",
            tolerance: "0.0000000000000000001",
            unit: "m",
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "Three tenths of a metre.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
        true,
      ),
      learner,
    );
    const started = applyHostCommand(joined.state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    const accepted = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: started.state.roundId!,
      response: { kind: "numeric", value: "0.3000000000000000001", unit: "M" },
      confidence: 1,
      idempotencyKey: randomUUID(),
      nowMs: 2_000,
    });
    expect(accepted.answer.correct).toBe(true);
    expect(accepted.answer.score).toBe(1_000);

    expect(() =>
      acceptAnswer(started.state, {
        answerId: randomUUID(),
        participantId: learner.id,
        roundId: started.state.roundId!,
        response: { kind: "numeric", value: "0.3", unit: "cm" },
        idempotencyKey: randomUUID(),
        nowMs: 2_000,
      }),
    ).toThrowError(/expected unit/);
  });

  it("restores an intervention and opens an unscored linked recheck", () => {
    const mainCorrect = randomUUID();
    const mainWrong = randomUUID();
    const recheckId = randomUUID();
    const recheckCorrect = randomUUID();
    const learner = participant();
    const joined = addParticipant(
      stateForQuestions(
        [
          {
            id: randomUUID(),
            type: "single_select",
            prompt: "Main checkpoint",
            purpose: "diagnostic",
            confidence: "required",
            delivery: "main",
            conceptKeys: ["safe-work"],
            linkedRecheckQuestionId: recheckId,
            choices: [
              { id: mainCorrect, label: "Safe", isCorrect: true },
              {
                id: mainWrong,
                label: "Unsafe",
                isCorrect: false,
                misconceptionKey: "unsafe-default",
              },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "Use the safe procedure.",
            mediaId: null,
            mediaAlt: null,
          },
          {
            id: recheckId,
            type: "true_false",
            prompt: "Apply the procedure in a new scenario",
            purpose: "practice",
            confidence: "off",
            delivery: "recheck",
            conceptKeys: ["safe-work"],
            linkedRecheckQuestionId: null,
            choices: [
              { id: recheckCorrect, label: "True", isCorrect: true },
              { id: randomUUID(), label: "False", isCorrect: false },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "The procedure still applies.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
        true,
      ),
      learner,
    );
    const started = applyHostCommand(joined.state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    const answered = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: started.state.roundId!,
      response: { kind: "choice", choiceIds: [mainWrong] },
      confidence: 3,
      idempotencyKey: randomUUID(),
      nowMs: 2_000,
    });
    const locked = applyHostCommand(answered.state, {
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: answered.state.version,
      nowMs: 3_000,
      newRoundId: randomUUID,
    });
    const intervention = applyHostCommand(locked.state, {
      action: "intervention.start",
      interventionType: "peer_discussion",
      commandId: randomUUID(),
      expectedVersion: locked.state.version,
      nowMs: 4_000,
      newRoundId: randomUUID,
      newInterventionId: randomUUID,
    });
    const preRevealSnapshot = snapshotForRole(intervention.state, {
      role: "participant",
      participantId: learner.id,
    });
    expect(preRevealSnapshot).toMatchObject({
      phase: "intervention",
      answerRevealed: false,
      intervention: { type: "peer_discussion", finishedAt: null },
    });
    expect(preRevealSnapshot.correctResponse).toBeUndefined();
    expect(preRevealSnapshot.myCorrect).toBeUndefined();

    const revealed = applyHostCommand(locked.state, {
      action: "reveal",
      commandId: randomUUID(),
      expectedVersion: locked.state.version,
      nowMs: 4_000,
      newRoundId: randomUUID,
    });
    const explaining = applyHostCommand(revealed.state, {
      action: "intervention.start",
      interventionType: "explain",
      commandId: randomUUID(),
      expectedVersion: revealed.state.version,
      nowMs: 4_500,
      newRoundId: randomUUID,
      newInterventionId: randomUUID,
    });
    const participantReveal = snapshotForRole(explaining.state, {
      role: "participant",
      participantId: learner.id,
    });
    expect(participantReveal).toMatchObject({
      phase: "intervention",
      answerRevealed: true,
      questionPosition: 0,
      myCorrect: false,
      explanation: "Use the safe procedure.",
    });
    expect(participantReveal).not.toHaveProperty("correctChoiceId");
    expect(participantReveal).not.toHaveProperty("correctResponse");
    expect(participantReveal.question).not.toHaveProperty("purpose");
    expect(participantReveal.question).not.toHaveProperty("linkedRecheckAvailable");

    const presenterReveal = snapshotForRole(explaining.state, { role: "presenter" });
    expect(presenterReveal).not.toHaveProperty("correctChoiceId");
    expect(presenterReveal).not.toHaveProperty("correctResponse");
    expect(presenterReveal.question).toMatchObject({
      purpose: "diagnostic",
      linkedRecheckAvailable: true,
    });

    expect(snapshotForRole(explaining.state, { role: "host" })).toMatchObject({
      answerRevealed: true,
      correctChoiceId: mainCorrect,
      correctResponse: { kind: "choice", choiceIds: [mainCorrect] },
      question: { purpose: "diagnostic", linkedRecheckAvailable: true },
    });

    const discussed = applyHostCommand(intervention.state, {
      action: "intervention.finish",
      commandId: randomUUID(),
      expectedVersion: intervention.state.version,
      nowMs: 5_000,
      newRoundId: randomUUID,
    });
    const recheck = applyHostCommand(discussed.state, {
      action: "recheck.open",
      recheckMode: "linked",
      commandId: randomUUID(),
      expectedVersion: discussed.state.version,
      nowMs: 6_000,
      newRoundId: randomUUID,
    });
    expect(snapshotForRole(recheck.state, { role: "participant" })).toMatchObject({
      phase: "question_open",
      roundKind: "linked_recheck",
      sourceRoundId: started.state.roundId,
      questionPosition: 0,
      questionCount: 1,
      question: { id: recheckId },
      intervention: { type: "peer_discussion" },
    });

    const recovered = acceptAnswer(recheck.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: recheck.state.roundId!,
      response: { kind: "choice", choiceIds: [recheckCorrect] },
      idempotencyKey: randomUUID(),
      nowMs: 7_000,
    });
    expect(recovered.answer.correct).toBe(true);
    expect(recovered.answer.score).toBe(0);
    expect(recovered.state.participants[learner.id]?.score).toBe(0);
  });

  it("upgrades a persisted P0 state without losing accepted answers", () => {
    const { state, correctId } = fixture();
    const answerId = randomUUID();
    const participantId = randomUUID();
    const legacy = structuredClone(state) as unknown as Record<string, unknown>;
    delete legacy.stateSchemaVersion;
    delete legacy.roundKind;
    delete legacy.sourceRoundId;
    delete legacy.intervention;
    delete legacy.interventionReturnPhase;
    delete legacy.experienceTheme;
    legacy.participants = { [participantId]: participant(participantId) };
    legacy.answers = {
      [answerId]: {
        answerId,
        participantId: randomUUID(),
        roundId: randomUUID(),
        choiceId: correctId,
        acceptedAtMs: 1_000,
        responseMs: 500,
        score: 1_000,
        correct: true,
        idempotencyKey: randomUUID(),
      },
    };

    const upgraded = upgradeGameState(legacy as unknown as typeof state);
    expect(upgraded.stateSchemaVersion).toBe(5);
    expect(upgraded.settings).toMatchObject({
      trustMode: "learning",
      timeMode: "timed",
      resultVisibility: "leaderboard",
    });
    expect(upgraded.experienceTheme).toMatchObject({
      preset: { id: "focus", version: 1 },
      category: "general",
    });
    expect(upgraded.answers[answerId]).toMatchObject({
      choiceId: correctId,
      response: { kind: "choice", choiceIds: [correctId] },
      confidence: null,
    });
    expect(upgraded.participants[participantId]?.avatarId).toBe(avatarIdForSeed(participantId));
  });

  it("resolves a version 5 session without an explicit time mode as timed", () => {
    const { state } = fixture();
    const legacy = structuredClone(state) as typeof state;
    legacy.stateSchemaVersion = 5;
    delete (legacy.settings as Partial<typeof legacy.settings>).timeMode;

    const upgraded = upgradeGameState(legacy);
    expect(upgraded.stateSchemaVersion).toBe(5);
    expect(upgraded.settings.timeMode).toBe("timed");
    expect(upgraded.settings.scoringMode).toBe("speed");
  });
});
