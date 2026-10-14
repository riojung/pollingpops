import { randomUUID } from "node:crypto";
import { deriveRoundProtocol, type QuizDraft } from "@openround/contracts";
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
    type: "poll" as const,
    prompt: "Choose priorities",
    maxSelections: 2,
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
  const quiz: QuizDraft = { title: "Opinions", description: "", questions: [question] };
  const options = {
    sessionId: randomUUID(),
    code: "1234567",
    quiz,
    roundProtocol: deriveRoundProtocol(quiz),
    settings: {
      audienceLimit: 20,
      scoringMode: "speed" as const,
      resultVisibility: "private" as const,
      allowLateJoin: true,
      nicknamePolicy: "custom" as const,
    },
  };
  let state = createGameState(options);
  const participantId = randomUUID();
  state = addParticipant(state, {
    id: participantId,
    nickname: "Participant",
    score: 0,
    correctCount: 0,
    acceptedResponseMs: 0,
    connected: true,
    kicked: false,
  }).state;
  state = applyHostCommand(state, {
    commandId: randomUUID(),
    expectedVersion: state.version,
    action: "start",
    nowMs: 1000,
    newRoundId: randomUUID,
  }).state;
  return { question, options, state, participantId };
}

describe("multiple-selection live poll engine", () => {
  it("requires frozen capabilities and restores an extended room without losing its meaning", () => {
    const f = fixture();
    expect(() => createGameState({ ...f.options, roundProtocol: undefined })).toThrow(
      "frozen Round protocol",
    );
    expect(upgradeGameState(JSON.parse(JSON.stringify(f.state)))).toEqual(f.state);
    expect(() => upgradeGameState({ ...f.state, roundProtocol: undefined })).toThrow(
      "frozen Round protocol",
    );
    for (const role of ["host", "presenter", "participant"] as const)
      expect(snapshotForRole(f.state, { role }).question).toMatchObject({
        type: "poll",
        maxSelections: 2,
      });
  });

  it("accepts one canonical opinion set once and never changes learning score or correctness", () => {
    const f = fixture();
    const input = {
      answerId: randomUUID(),
      participantId: f.participantId,
      roundId: f.state.roundId!,
      response: {
        kind: "poll" as const,
        choiceIds: f.question.choices
          .slice(0, 2)
          .map((choice) => choice.id)
          .reverse(),
      },
      idempotencyKey: randomUUID(),
      nowMs: 1100,
    };
    const accepted = acceptAnswer(f.state, input);
    expect(accepted.answer).toMatchObject({ score: 0, correct: false, choiceId: null });
    expect(accepted.state.participants[f.participantId]).toMatchObject({
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
    });
    expect(acceptAnswer(accepted.state, input)).toEqual(accepted);
    const second = acceptAnswer(accepted.state, {
      ...input,
      answerId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    expect(second).toEqual(accepted);
    const locked = applyHostCommand(accepted.state, {
      commandId: randomUUID(),
      expectedVersion: accepted.state.version,
      action: "lock",
      nowMs: 1200,
      newRoundId: randomUUID,
    }).state;
    const revealed = applyHostCommand(locked, {
      commandId: randomUUID(),
      expectedVersion: locked.version,
      action: "reveal",
      nowMs: 1300,
      newRoundId: randomUUID,
    }).state;
    expect(
      snapshotForRole(revealed, { role: "participant", participantId: f.participantId }).myCorrect,
    ).toBeNull();
  });

  it("enforces authored limits, distinct permitted options and legacy single-choice behavior", () => {
    const { question } = fixture();
    for (const choiceIds of [
      [],
      [question.choices[0]!.id, question.choices[0]!.id],
      question.choices.map((choice) => choice.id),
      [randomUUID()],
    ])
      expect(() => evaluateResponse(question, { kind: "poll", choiceIds })).toThrow();
    const { maxSelections: _limit, ...legacy } = question;
    expect(_limit).toBe(2);
    expect(() =>
      evaluateResponse(legacy, {
        kind: "poll",
        choiceIds: question.choices.slice(0, 2).map((choice) => choice.id),
      }),
    ).toThrow();
    expect(
      evaluateResponse(legacy, { kind: "poll", choiceIds: [question.choices[0]!.id] }).choiceId,
    ).toBe(question.choices[0]!.id);
  });

  it("counts respondents per selected option and suppresses small samples", () => {
    const { question } = fixture();
    const answers = Array.from({ length: 5 }, () => ({
      response: {
        kind: "poll" as const,
        choiceIds: question.choices.slice(0, 2).map((choice) => choice.id),
      },
      correct: false,
    }));
    expect(responseDistributionFor(question, answers.slice(0, 4))).toBeUndefined();
    const distribution = responseDistributionFor(question, answers);
    expect(distribution).toMatchObject({
      kind: "choice",
      respondents: 5,
      totalSelections: 10,
      percentBasis: "respondents",
    });
    if (distribution?.kind === "choice")
      expect(distribution.buckets.map((bucket) => bucket.percent)).toEqual([100, 100, 0]);
  });
});
