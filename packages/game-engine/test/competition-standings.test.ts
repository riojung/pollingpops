import { randomUUID } from "node:crypto";
import { CompetitionStandingsSchema, type QuizDraft } from "@openround/contracts";
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

function fixture(options: { private?: boolean; flex?: boolean; opinion?: boolean } = {}) {
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
      scoringMode: "accuracy",
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

function command(state: GameState, action: Parameters<typeof applyHostCommand>[1]["action"]) {
  return applyHostCommand(state, {
    action,
    commandId: randomUUID(),
    expectedVersion: state.version,
    nowMs: (state.openedAtMs ?? 0) + 10_000,
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
