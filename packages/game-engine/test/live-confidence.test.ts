import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
  snapshotForRole,
  upgradeGameState,
  type GameState,
} from "../src/index.js";

function fixture(
  visibility: "private" | "leaderboard",
  confidence: "off" | "required" = "required",
  confidenceEnabled?: boolean,
) {
  const correctId = randomUUID();
  const participantIds = [randomUUID(), randomUUID(), randomUUID()];
  let state = createGameState({
    sessionId: randomUUID(),
    code: "1234567",
    quiz: {
      title: "Optional live confidence",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          purpose: "diagnostic",
          prompt: "Choose an answer",
          confidence,
          choices: [
            { id: correctId, label: "Correct", isCorrect: true },
            { id: randomUUID(), label: "Incorrect", isCorrect: false },
          ],
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    },
    settings: {
      audienceLimit: 20,
      resultVisibility: visibility,
      scoringMode: "accuracy",
      timeMode: "timed",
      allowLateJoin: true,
      nicknamePolicy: "custom",
      ...(confidenceEnabled === undefined ? {} : { confidenceEnabled }),
    },
  });
  for (const id of participantIds) {
    state = addParticipant(state, {
      id,
      nickname: "Learner",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
  }
  return { state: command(state, "start"), correctId, participantIds };
}

function command(
  state: GameState,
  action: Parameters<typeof applyHostCommand>[1]["action"],
  confidenceEnabled?: boolean,
) {
  return applyHostCommand(state, {
    action,
    confidenceEnabled,
    commandId: randomUUID(),
    expectedVersion: state.version,
    nowMs: 1_000,
    newRoundId: randomUUID,
  }).state;
}

function submit(state: GameState, participantId: string, choiceId: string, confidence?: 1 | 2 | 3) {
  return acceptAnswer(state, {
    answerId: randomUUID(),
    participantId,
    roundId: state.roundId!,
    choiceId,
    confidence,
    idempotencyKey: randomUUID(),
    nowMs: 2_000,
  });
}

describe("optional live Round confidence collection", () => {
  it.each(["private", "leaderboard"] as const)(
    "accepts legacy-required answers without confidence and preserves authored content (%s)",
    (visibility) => {
      const f = fixture(visibility);
      // Already-saved legacy rooms keep their authored fallback; new creation is tested below.
      delete f.state.settings.confidenceEnabled;
      const accepted = submit(f.state, f.participantIds[0]!, f.correctId);
      expect(accepted.answer).toMatchObject({ correct: true, score: 1_000, confidence: null });
      for (const role of ["host", "participant", "presenter"] as const) {
        const snapshot = snapshotForRole(accepted.state, {
          role,
          participantId: f.participantIds[0],
        });
        expect(snapshot.question?.confidence).toBe("optional");
        expect(snapshot.settings).not.toHaveProperty("confidenceEnabled");
      }
      expect(accepted.state.quiz.questions[0]!.confidence).toBe("required");
    },
  );

  it.each(["private", "leaderboard"] as const)(
    "starts new authored-required rooms off unless explicitly enabled (%s)",
    (visibility) => {
      for (const enabled of [undefined, true]) {
        const f = fixture(visibility, "required", enabled);
        const accepted = submit(f.state, f.participantIds[0]!, f.correctId);
        expect(accepted.answer).toMatchObject({ correct: true, score: 1_000, confidence: null });
        const restored = upgradeGameState(JSON.parse(JSON.stringify(accepted.state)) as GameState);
        expect(restored.settings.confidenceEnabled).toBe(enabled ?? false);
        for (const role of ["host", "participant", "presenter"] as const) {
          const snapshot = snapshotForRole(restored, { role });
          expect(snapshot.settings.confidenceEnabled).toBe(enabled ?? false);
          expect(snapshot.question?.confidence).toBe(enabled ? "optional" : "off");
        }
        expect(restored.quiz.questions[0]!.confidence).toBe("required");
      }
    },
  );

  it.each(["private", "leaderboard"] as const)(
    "toggles the same live question without resetting answers, timing or scoring (%s)",
    (visibility) => {
      const f = fixture(visibility, "off");
      let state = command(f.state, "confidence.set", true);
      const accepted = submit(state, f.participantIds[0]!, f.correctId, 3);
      expect(accepted.answer.confidence).toBe(3);
      state = accepted.state;
      const prior = state;
      const toggle = {
        action: "confidence.set" as const,
        confidenceEnabled: false,
        commandId: randomUUID(),
        expectedVersion: state.version,
        nowMs: 4_000,
        newRoundId: randomUUID,
      };
      const result = applyHostCommand(state, toggle);
      state = result.state;
      expect(result.events.map((event) => event.type)).toEqual(["session.snapshot"]);
      expect(state).toMatchObject({
        roundId: prior.roundId,
        openedAtMs: prior.openedAtMs,
        deadlineMs: prior.deadlineMs,
        answers: prior.answers,
        participants: prior.participants,
        rounds: prior.rounds,
        phase: prior.phase,
      });
      expect(applyHostCommand(state, toggle)).toMatchObject({ state, duplicate: true, events: [] });
      expect(() => applyHostCommand(state, { ...toggle, commandId: randomUUID() })).toThrow(
        /synchronize/,
      );
      const raced = submit(state, f.participantIds[1]!, f.correctId, 2);
      expect(raced.answer).toMatchObject({ score: 1_000, correct: true, confidence: null });
      state = raced.state;
      for (const role of ["host", "participant", "presenter"] as const) {
        expect(snapshotForRole(state, { role }).question?.confidence).toBe("off");
      }
      state = upgradeGameState(JSON.parse(JSON.stringify(state)) as GameState);
      expect(state.settings.confidenceEnabled).toBe(false);
      expect(state.answers[accepted.answer.answerId]?.confidence).toBe(3);
      expect(state.answers[raced.answer.answerId]?.confidence).toBeNull();
      state = command(state, "confidence.set", true);
      const noConfidence = submit(state, f.participantIds[2]!, f.correctId);
      expect(noConfidence.answer).toMatchObject({ confidence: null, correct: true, score: 1_000 });
      expect(
        snapshotForRole(noConfidence.state, { role: "participant" }).question?.confidence,
      ).toBe("optional");
      state = command(noConfidence.state, "end");
      expect(() => command(state, "confidence.set", false)).toThrow(/active room/);
    },
  );

  it("keeps opinion confidence off even when room collection is enabled", () => {
    const f = fixture("private", "off");
    const question = f.state.quiz.questions[0]!;
    if (!("choices" in question)) throw new Error("Expected choice question");
    const state = command(
      {
        ...f.state,
        quiz: {
          ...f.state.quiz,
          questions: [{ ...question, type: "poll", purpose: "opinion", basePoints: 0 }],
        },
      },
      "confidence.set",
      true,
    );
    for (const role of ["host", "participant", "presenter"] as const) {
      expect(snapshotForRole(state, { role }).question?.confidence).toBe("off");
    }
    const accepted = acceptAnswer(state, {
      answerId: randomUUID(),
      participantId: f.participantIds[0]!,
      roundId: state.roundId!,
      response: { kind: "poll", choiceIds: [f.correctId] },
      confidence: 3,
      idempotencyKey: randomUUID(),
      nowMs: 2_000,
    });
    expect(accepted.answer).toMatchObject({ confidence: null, score: 0 });
  });
});
