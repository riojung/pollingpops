import { randomUUID } from "node:crypto";
import {
  CompetitionStandingsSchema,
  SessionSnapshotSchema,
  type QuizDraft,
} from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  competitionStandings,
  createGameState,
  snapshotForRole,
  upgradeGameState,
  type GameState,
} from "../src/index.js";

function fixture(
  options: { private?: boolean; flex?: boolean; opinion?: boolean; speed?: boolean } = {},
) {
  const correctId = randomUUID();
  const wrongId = randomUUID();
  const question = (delivery: "main" | "recheck" = "main"): QuizDraft["questions"][number] => ({
    id: randomUUID(),
    type: options.opinion ? "poll" : "single_select",
    purpose: options.opinion ? "opinion" : "diagnostic",
    delivery,
    prompt: "Choose an answer",
    choices: [
      { id: correctId, label: "A", isCorrect: !options.opinion },
      { id: wrongId, label: "B", isCorrect: false },
    ],
    timeLimitSeconds: 20,
    basePoints: options.opinion ? 0 : 1_000,
    explanation: "Explanation",
    mediaId: null,
    mediaAlt: null,
  });
  const first = question();
  const second = question();
  const recheck = question("recheck");
  first.linkedRecheckQuestionId = recheck.id;
  let state = createGameState({
    sessionId: randomUUID(),
    code: "1234567",
    quiz: { title: "Competition", description: "", questions: [first, second, recheck] },
    settings: {
      audienceLimit: 20,
      resultVisibility: options.private ? "private" : "leaderboard",
      scoringMode: options.speed ? "speed" : "accuracy",
      timeMode: options.flex ? "flex" : "timed",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    },
  });
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) {
    state = addParticipant(state, {
      id,
      nickname: index === 0 ? "River" : "Sky",
      avatarId: index === 0 ? "fox" : "owl",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
  }
  return { state, ids, correctId, wrongId };
}

function command(
  state: GameState,
  action: Parameters<typeof applyHostCommand>[1]["action"],
  nowMs = (state.openedAtMs ?? 0) + 10_000,
) {
  return applyHostCommand(state, {
    action,
    commandId: randomUUID(),
    expectedVersion: state.version,
    nowMs,
    newRoundId: randomUUID,
  }).state;
}

function answer(state: GameState, participantId: string, choiceId: string, elapsedMs = 100) {
  return acceptAnswer(state, {
    answerId: randomUUID(),
    participantId,
    roundId: state.roundId!,
    ...(state.quiz.questions[state.questionIndex!]!.type === "poll"
      ? { response: { kind: "poll" as const, choiceIds: [choiceId] } }
      : { choiceId }),
    nowMs: state.openedAtMs! + elapsedMs,
    idempotencyKey: randomUUID(),
  }).state;
}

function reveal(state: GameState) {
  return command(command(state, "lock"), "reveal");
}

describe("released competition standings", () => {
  it("retains a correct deadline speed score through final results, retries and reconnect", () => {
    const f = fixture({ speed: true });
    const learnerId = f.ids[0]!;
    let state = command(
      {
        ...f.state,
        quiz: {
          ...f.state.quiz,
          questions: [{ ...f.state.quiz.questions[0]!, confidence: "required" }],
        },
        participants: { [learnerId]: f.state.participants[learnerId]! },
      },
      "start",
    );
    const submission = {
      answerId: randomUUID(),
      participantId: learnerId,
      roundId: state.roundId!,
      choiceId: f.correctId,
      confidence: 3 as const,
      nowMs: state.deadlineMs!,
      idempotencyKey: randomUUID(),
    };
    const accepted = acceptAnswer(state, submission);
    expect(accepted.answer).toMatchObject({ correct: true, score: 600, responseMs: 20_000 });
    state = upgradeGameState(JSON.parse(JSON.stringify(accepted.state)) as GameState);
    const retry = acceptAnswer(state, { ...submission, nowMs: submission.nowMs + 1 });
    expect(retry.answer.answerId).toBe(accepted.answer.answerId);
    expect(retry.state.participants[learnerId]?.score).toBe(600);
    expect(Object.keys(retry.state.answers)).toHaveLength(1);
    expect(competitionStandings(retry.state)!.entries).toEqual([]);

    state = command(retry.state, "lock", submission.nowMs);
    state = command(state, "reveal", submission.nowMs + 1_000);
    state = command(state, "next", submission.nowMs + 2_000);
    expect(state.phase).toBe("finished");
    const restored = upgradeGameState(JSON.parse(JSON.stringify(state)) as GameState);
    for (const role of ["host", "participant", "presenter"] as const) {
      expect(
        snapshotForRole(restored, { role, participantId: learnerId }).competitionStandings,
      ).toMatchObject({
        status: "final",
        completedScoredQuestions: 1,
        totalScoredQuestions: 1,
        totalParticipants: 1,
        entries: [{ id: learnerId, score: 600, lastScoreDelta: 600, correctStreak: 1 }],
      });
    }
    expect(restored.competitionState?.releasedRoundIds).toEqual([submission.roundId]);
  });

  it("releases point gains and correct streaks without bonus points and resets a missed question", () => {
    const f = fixture();
    let state = command(f.state, "start");
    for (const id of f.ids) state = answer(state, id, f.correctId);
    expect(competitionStandings(state)!.entries).toEqual([]);
    state = reveal(state);
    const first = competitionStandings(state)!;
    expect(
      first.entries.every((entry) => entry.lastScoreDelta === 1_000 && entry.correctStreak === 1),
    ).toBe(true);
    state = command(state, "next");
    state = answer(state, f.ids[0]!, f.correctId);
    expect(competitionStandings(state)).toEqual(first);
    state = reveal(upgradeGameState(JSON.parse(JSON.stringify(state)) as GameState));
    const entries = competitionStandings(state)!.entries;
    expect(entries.find((entry) => entry.id === f.ids[0])).toMatchObject({
      score: 2_000,
      lastScoreDelta: 1_000,
      correctStreak: 2,
    });
    expect(entries.find((entry) => entry.id === f.ids[1])).toMatchObject({
      score: 1_000,
      lastScoreDelta: 0,
      correctStreak: 0,
    });
    expect(competitionStandings(command(state, "next"))!.entries).toEqual(entries);
  });

  it("breaks recognition streaks on a wrong scored answer without changing earlier points", () => {
    const f = fixture();
    let state = reveal(answer(command(f.state, "start"), f.ids[0]!, f.correctId));
    state = answer(command(state, "next"), f.ids[0]!, f.wrongId);
    const entry = competitionStandings(reveal(state))!.entries.find(
      (entry) => entry.id === f.ids[0],
    );
    expect(entry).toMatchObject({ score: 1_000, lastScoreDelta: 0, correctStreak: 0 });
  });
  it("withholds current scores, ordering and rank until reveal, including pause and lock", () => {
    const f = fixture();
    let state = command(f.state, "start");
    state = answer(state, f.ids[1]!, f.correctId);
    expect(state.participants[f.ids[1]!]!.score).toBe(1_000);
    for (const phase of [state, command(state, "pause"), command(state, "lock")]) {
      for (const role of ["participant", "presenter"] as const) {
        const snapshot = snapshotForRole(phase, { role, participantId: f.ids[1] });
        expect(snapshot.competitionStandings).toMatchObject({ status: "waiting", entries: [] });
        expect(
          snapshot.participants.every((entry) => entry.score === 0 && entry.rank === null),
        ).toBe(true);
      }
    }
    const released = competitionStandings(reveal(state))!;
    expect(CompetitionStandingsSchema.parse(released)).toEqual(released);
    expect(released).toMatchObject({
      status: "live",
      completedScoredQuestions: 1,
      totalScoredQuestions: 2,
      totalParticipants: 2,
      tieBreak: "score_correct_time",
    });
    expect(released.entries[0]).toMatchObject({
      id: f.ids[1],
      rank: 1,
      score: 1_000,
      previousRank: null,
      pointsToLeader: 0,
      pointsToNextRank: null,
    });
    expect(released.entries[1]).toMatchObject({ pointsToLeader: 1_000, pointsToNextRank: 1_000 });
  });

  it("persists rank movement and freezes the last released checkpoint across reconnect and next", () => {
    const f = fixture();
    let state = command(f.state, "start");
    state = answer(state, f.ids[0]!, f.wrongId, 100);
    state = answer(state, f.ids[1]!, f.correctId, 200);
    state = reveal(state);
    const first = competitionStandings(state)!;
    expect(first.entries.map((entry) => entry.id)).toEqual([f.ids[1], f.ids[0]]);
    state = command(state, "next");
    state = answer(state, f.ids[0]!, f.correctId, 100);
    state = answer(state, f.ids[1]!, f.wrongId, 200);
    const restored = upgradeGameState(JSON.parse(JSON.stringify(state)) as GameState);
    expect(competitionStandings(restored)).toEqual(first);
    state = reveal(restored);
    const second = competitionStandings(state)!;
    expect(second.entries).toMatchObject([
      { id: f.ids[0], rank: 1, previousRank: 2, score: 1_000, tied: false },
      { id: f.ids[1], rank: 2, previousRank: 1, score: 1_000, pointsToNextRank: 0, tied: false },
    ]);
    const finished = command(state, "next");
    expect(competitionStandings(finished)).toEqual({ ...second, status: "final" });
    expect(finished.answers).toEqual({});
  });

  it("does not publish an unrevealed answer when the host ends a room early", () => {
    const f = fixture();
    let state = command(f.state, "start");
    state = answer(state, f.ids[1]!, f.correctId);
    state = reveal(state);
    const released = competitionStandings(state)!;
    state = answer(command(state, "next"), f.ids[0]!, f.correctId);
    const finished = command(state, "end");
    expect(competitionStandings(finished)).toEqual({ ...released, status: "final" });
    expect(
      competitionStandings(finished)!.entries.find((entry) => entry.id === f.ids[0])!.score,
    ).toBe(0);
  });

  it("handles late admission, disconnection and removal without inventing movement or ghost leaders", () => {
    const f = fixture();
    let state = reveal(answer(command(f.state, "start"), f.ids[1]!, f.correctId));
    const lateId = randomUUID();
    state = addParticipant(state, {
      id: lateId,
      nickname: "Late arrival",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: false,
      kicked: false,
    }).state;
    expect(competitionStandings(state)!.entries.find((entry) => entry.id === lateId)).toMatchObject(
      {
        score: 0,
        previousRank: null,
        connected: false,
        pointsToLeader: 1_000,
      },
    );
    state = applyHostCommand(state, {
      action: "kick",
      participantId: f.ids[1],
      commandId: randomUUID(),
      expectedVersion: state.version,
      nowMs: 25_000,
      newRoundId: randomUUID,
    }).state;
    const remaining = competitionStandings(state)!;
    expect(remaining.totalParticipants).toBe(2);
    expect(remaining.entries.map((entry) => entry.rank)).toEqual([1, 2]);
    expect(remaining.entries.some((entry) => entry.id === f.ids[1])).toBe(false);
    expect(remaining.entries.every((entry) => entry.pointsToLeader === 0)).toBe(true);
    for (const id of [f.ids[0]!, lateId]) state.participants[id]!.kicked = true;
    expect(competitionStandings(state)).toMatchObject({
      status: "waiting",
      entries: [],
      totalParticipants: 0,
    });
  });

  it("never adds recheck scores or advances scored progress for a recovery branch", () => {
    const f = fixture();
    let state = answer(command(f.state, "start"), f.ids[0]!, f.wrongId);
    state = reveal(state);
    const before = competitionStandings(state);
    state = applyHostCommand(state, {
      action: "recheck.open",
      recheckMode: "linked",
      commandId: randomUUID(),
      expectedVersion: state.version,
      nowMs: 20_000,
      newRoundId: randomUUID,
    }).state;
    state = answer(state, f.ids[0]!, f.correctId);
    expect(competitionStandings(reveal(state))).toEqual(before);
  });

  it("discloses exact merit ties while retaining deterministic ordering and ignores speed in flex", () => {
    const f = fixture({ flex: true });
    let state = answer(command(f.state, "start"), f.ids[0]!, f.correctId, 100);
    state = answer(state, f.ids[1]!, f.correctId, 2_000);
    const standings = competitionStandings(reveal(state))!;
    expect(standings.tieBreak).toBe("score_correct");
    expect(standings.entries.map((entry) => entry.id)).toEqual([...f.ids].sort());
    expect(standings.entries.map((entry) => entry.tied)).toEqual([true, true]);
    expect(standings.entries.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  it("omits competition data in private rooms and safely supports legacy rooms without a ledger", () => {
    const f = fixture({ private: true });
    const privateState = reveal(answer(command(f.state, "start"), f.ids[0]!, f.correctId));
    for (const role of ["host", "participant", "presenter"] as const) {
      const snapshot = snapshotForRole(privateState, { role, participantId: f.ids[0] });
      expect(snapshot).not.toHaveProperty("competitionStandings");
      expect(snapshot).not.toHaveProperty("competitionState");
    }
    const legacy = { ...fixture().state };
    delete legacy.competitionState;
    expect(snapshotForRole(legacy, { role: "host" })).not.toHaveProperty("competitionStandings");
  });

  it("treats opinion-only rooms as unscored instead of declaring zero-point winners", () => {
    const f = fixture({ opinion: true });
    const state = reveal(answer(command(f.state, "start"), f.ids[0]!, f.correctId));
    expect(competitionStandings(state)).toMatchObject({
      status: "unscored",
      entries: [],
      totalScoredQuestions: 0,
      completedScoredQuestions: 0,
    });
  });
});

describe("private revealed scored response summaries", () => {
  const summary = (state: GameState, participantId: string) =>
    snapshotForRole(state, { role: "participant", participantId }).myScoredResponseSummary;

  it.each([false, true])(
    "distinguishes correct, incorrect and unanswered only after reveal (private=%s)",
    (privateRoom) => {
      const f = fixture({ private: privateRoom });
      const unansweredId = randomUUID();
      let state = addParticipant(f.state, {
        ...f.state.participants[f.ids[0]!]!,
        id: unansweredId,
        nickname: "Unanswered",
      }).state;
      state = command(state, "start");
      const empty = {
        answeredScoredQuestions: 0,
        correctScoredQuestions: 0,
        revealedScoredQuestions: 0,
      };
      expect(summary(state, f.ids[0]!)).toEqual(empty);
      state = answer(state, f.ids[0]!, f.correctId);
      state = answer(state, f.ids[1]!, f.wrongId);
      for (const phase of [state, command(state, "pause"), command(state, "lock")]) {
        for (const id of [...f.ids, unansweredId]) expect(summary(phase, id)).toEqual(empty);
      }

      state = reveal(state);
      expect(summary(state, f.ids[0]!)).toEqual({
        answeredScoredQuestions: 1,
        correctScoredQuestions: 1,
        revealedScoredQuestions: 1,
        lastResponseStatus: "correct",
      });
      expect(summary(state, f.ids[1]!)).toEqual({
        answeredScoredQuestions: 1,
        correctScoredQuestions: 0,
        revealedScoredQuestions: 1,
        lastResponseStatus: "incorrect",
      });
      expect(summary(state, unansweredId)).toEqual({
        answeredScoredQuestions: 0,
        correctScoredQuestions: 0,
        revealedScoredQuestions: 1,
        lastResponseStatus: "unanswered",
      });
      for (const role of ["host", "presenter"] as const) {
        expect(snapshotForRole(state, { role, participantId: f.ids[0] })).not.toHaveProperty(
          "myScoredResponseSummary",
        );
      }
      const participantSnapshot = snapshotForRole(state, {
        role: "participant",
        participantId: f.ids[0],
      });
      expect(SessionSnapshotSchema.parse(participantSnapshot).myScoredResponseSummary).toEqual(
        summary(state, f.ids[0]!),
      );
      for (const participant of participantSnapshot.participants) {
        expect(participant).not.toHaveProperty("answeredCount");
        expect(participant).not.toHaveProperty("lastResponseStatus");
      }
      for (const participant of participantSnapshot.competitionStandings?.entries ?? []) {
        expect(participant).not.toHaveProperty("answeredCount");
        expect(participant).not.toHaveProperty("lastResponseStatus");
      }
    },
  );

  it("persists revealed counts across final results and reconnect and releases each question once", () => {
    const f = fixture();
    let state = command(f.state, "start");
    state = answer(state, f.ids[0]!, f.wrongId);
    state = command(state, "lock");
    const revealCommand = {
      action: "reveal" as const,
      commandId: randomUUID(),
      expectedVersion: state.version,
      nowMs: state.openedAtMs! + 10_000,
      newRoundId: randomUUID,
    };
    state = applyHostCommand(state, revealCommand).state;
    const first = summary(state, f.ids[0]!);
    state = applyHostCommand(state, revealCommand).state;
    expect(summary(state, f.ids[0]!)).toEqual(first);
    state = answer(command(state, "next"), f.ids[0]!, f.correctId);
    expect(summary(state, f.ids[0]!)).toEqual(first);
    state = reveal(state);
    state = command(state, "next");
    expect(state.phase).toBe("finished");
    expect(state.answers).toEqual({});
    const restored = upgradeGameState(JSON.parse(JSON.stringify(state)) as GameState);
    expect(summary(restored, f.ids[0]!)).toEqual({
      answeredScoredQuestions: 2,
      correctScoredQuestions: 1,
      revealedScoredQuestions: 2,
      lastResponseStatus: "correct",
    });
    expect(summary(restored, f.ids[1]!)).toEqual({
      answeredScoredQuestions: 0,
      correctScoredQuestions: 0,
      revealedScoredQuestions: 2,
      lastResponseStatus: "unanswered",
    });
  });

  it("omits unknown legacy counts even after another scored reveal", () => {
    const f = fixture();
    let state = reveal(answer(command(f.state, "start"), f.ids[0]!, f.correctId));
    const legacy = JSON.parse(JSON.stringify(state)) as GameState;
    for (const score of Object.values(legacy.competitionState!.scores)) {
      delete score.answeredCount;
      delete score.lastResponseStatus;
    }
    state = upgradeGameState(legacy);
    expect(summary(state, f.ids[0]!)).toBeUndefined();
    state = reveal(answer(command(state, "next"), f.ids[0]!, f.wrongId));
    expect(summary(state, f.ids[0]!)).toBeUndefined();
    expect(state.competitionState!.scores[f.ids[0]!]!.answeredCount).toBeUndefined();
    delete state.competitionState;
    expect(summary(state, f.ids[0]!)).toBeUndefined();
  });

  it("keeps unrevealed answers out of counts when a room ends early", () => {
    const f = fixture();
    const opened = answer(command(f.state, "start"), f.ids[0]!, f.correctId);
    expect(summary(command(opened, "end"), f.ids[0]!)).toEqual({
      answeredScoredQuestions: 0,
      correctScoredQuestions: 0,
      revealedScoredQuestions: 0,
    });
    let state = reveal(opened);
    const released = summary(state, f.ids[0]!);
    state = answer(command(state, "next"), f.ids[0]!, f.wrongId);
    expect(summary(command(state, "end"), f.ids[0]!)).toEqual(released);
  });

  it("starts newly admitted participants at known zero without inventing earlier response status", () => {
    const f = fixture();
    let state = reveal(answer(command(f.state, "start"), f.ids[0]!, f.correctId));
    const lateId = randomUUID();
    state = addParticipant(state, {
      ...f.state.participants[f.ids[0]!]!,
      id: lateId,
      nickname: "Late arrival",
    }).state;
    expect(summary(state, lateId)).toEqual({
      answeredScoredQuestions: 0,
      correctScoredQuestions: 0,
      revealedScoredQuestions: 1,
    });
    state = reveal(answer(command(state, "next"), lateId, f.correctId));
    expect(summary(state, lateId)).toEqual({
      answeredScoredQuestions: 1,
      correctScoredQuestions: 1,
      revealedScoredQuestions: 2,
      lastResponseStatus: "correct",
    });
  });

  it("can establish known zero for legacy entries before their first scored reveal", () => {
    const f = fixture();
    for (const score of Object.values(f.state.competitionState!.scores)) delete score.answeredCount;
    const state = reveal(answer(command(f.state, "start"), f.ids[0]!, f.correctId));
    expect(summary(state, f.ids[0]!)).toEqual({
      answeredScoredQuestions: 1,
      correctScoredQuestions: 1,
      revealedScoredQuestions: 1,
      lastResponseStatus: "correct",
    });
    expect(summary(state, f.ids[1]!)).toEqual({
      answeredScoredQuestions: 0,
      correctScoredQuestions: 0,
      revealedScoredQuestions: 1,
      lastResponseStatus: "unanswered",
    });
  });

  it("excludes opinion questions and recovery rechecks from the private summary", () => {
    const opinion = fixture({ opinion: true });
    const opinionState = reveal(
      answer(command(opinion.state, "start"), opinion.ids[0]!, opinion.correctId),
    );
    expect(summary(opinionState, opinion.ids[0]!)).toEqual({
      answeredScoredQuestions: 0,
      correctScoredQuestions: 0,
      revealedScoredQuestions: 0,
    });
    const f = fixture();
    let state = reveal(answer(command(f.state, "start"), f.ids[0]!, f.wrongId));
    const mainSummary = summary(state, f.ids[0]!);
    state = applyHostCommand(state, {
      action: "recheck.open",
      recheckMode: "linked",
      commandId: randomUUID(),
      expectedVersion: state.version,
      nowMs: 20_000,
      newRoundId: randomUUID,
    }).state;
    state = reveal(answer(state, f.ids[0]!, f.correctId));
    expect(summary(state, f.ids[0]!)).toEqual(mainSummary);
  });
});
