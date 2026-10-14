import { randomUUID } from "node:crypto";
import { deriveRoundProtocol } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
  evaluateResponse,
  responseDistributionFor,
  snapshotForRole,
  upgradeGameState,
} from "../src/index.js";

function fixture() {
  const question = {
    id: randomUUID(),
    type: "ranking" as const,
    prompt: "Order the priorities",
    rankCount: 2,
    choices: ["First", "Second", "Third"].map((label) => ({
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
  const quiz = { title: "Rankings", description: "", questions: [question] };
  const state = createGameState({
    sessionId: randomUUID(),
    code: "1234567",
    quiz,
    roundProtocol: deriveRoundProtocol(quiz),
    settings: {
      audienceLimit: 20,
      scoringMode: "speed",
      resultVisibility: "private",
      nicknamePolicy: "custom",
      allowLateJoin: true,
    },
  });
  return { question, state };
}
describe("ranking opinion engine", () => {
  it("fences ranking snapshots with state version 8 and exposes the exact ordering limit", () => {
    const { state } = fixture();
    expect(state.stateSchemaVersion).toBe(8);
    expect(upgradeGameState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    for (const stateSchemaVersion of [5, 6, 7])
      expect(() => upgradeGameState({ ...state, stateSchemaVersion })).toThrow("schema 8");
    const opened = applyHostCommand(state, {
      commandId: randomUUID(),
      expectedVersion: state.version,
      action: "start",
      nowMs: 1000,
      newRoundId: randomUUID,
    }).state;
    for (const role of ["host", "participant", "presenter"] as const)
      expect(snapshotForRole(opened, { role }).question).toMatchObject({
        type: "ranking",
        rankCount: 2,
      });
  });
  it("accepts one exact ordered response without a learning score", () => {
    const { question, state } = fixture();
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
    const opened = applyHostCommand(joined, {
      commandId: randomUUID(),
      expectedVersion: joined.version,
      action: "start",
      nowMs: 1000,
      newRoundId: randomUUID,
    }).state;
    const response = {
      kind: "ranking" as const,
      choiceIds: [question.choices[1]!.id, question.choices[0]!.id],
    };
    const input = {
      answerId: randomUUID(),
      participantId,
      roundId: opened.roundId!,
      response,
      idempotencyKey: randomUUID(),
      nowMs: 1100,
    };
    const accepted = acceptAnswer(opened, input);
    expect(accepted.answer).toMatchObject({ response, score: 0, correct: false, choiceId: null });
    expect(accepted.state.participants[participantId]).toMatchObject({
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
    });
    expect(acceptAnswer(accepted.state, input)).toEqual(accepted);
    for (const choiceIds of [
      [],
      [question.choices[0]!.id],
      question.choices.map((choice) => choice.id),
      [randomUUID(), question.choices[0]!.id],
      [question.choices[0]!.id, question.choices[0]!.id],
    ])
      expect(() => evaluateResponse(question, { kind: "ranking", choiceIds })).toThrow();
    expect(
      evaluateResponse(
        { ...question, rankCount: undefined },
        { kind: "ranking", choiceIds: question.choices.map((choice) => choice.id) },
      ).response,
    ).toEqual({ kind: "ranking", choiceIds: question.choices.map((choice) => choice.id) });
  });
  it("uses available-choice weights, zero for unranked options and authored-order ties", () => {
    const { question } = fixture();
    const [a, b] = question.choices.map((choice) => choice.id);
    const answers = [a, a, a, b, b].map((first) => ({
      correct: false,
      response: { kind: "ranking" as const, choiceIds: first === a ? [a!, b!] : [b!, a!] },
    }));
    expect(responseDistributionFor(question, answers.slice(0, 4))).toBeUndefined();
    const result = responseDistributionFor(question, answers);
    expect(result).toMatchObject({
      kind: "ranking",
      respondents: 5,
      rankCount: 2,
      totalRankings: 10,
    });
    if (result?.kind !== "ranking") throw new Error("Expected a ranking distribution");
    expect(
      result.buckets.map((bucket) => [
        bucket.label,
        bucket.weightedScore,
        bucket.rankedRespondents,
        bucket.averageRank,
      ]),
    ).toEqual([
      ["First", 13, 5, 1.4],
      ["Second", 12, 5, 1.6],
      ["Third", 0, 0, null],
    ]);
    const tied = responseDistributionFor(question, [
      ...answers,
      { correct: false, response: { kind: "ranking", choiceIds: [b!, a!] } },
    ]);
    if (tied?.kind !== "ranking") throw new Error("Expected a ranking distribution");
    expect(tied.buckets.slice(0, 2).map((bucket) => bucket.label)).toEqual(["First", "Second"]);
    expect(tied.buckets.slice(0, 2).map((bucket) => bucket.weightedScore)).toEqual([15, 15]);
  });
});
