import { randomUUID } from "node:crypto";
import {
  deriveRoundProtocol,
  RoundLiveWordCloudResultsSchema,
  type QuizDraft,
} from "@openround/contracts";
import { applyHostCommand, createGameState, type EngineAnswer } from "@openround/game-engine";
import { describe, expect, it } from "vitest";
import { liveWordCloudResults, textResults } from "../src/response-moderation.js";

function fixture(wordCloudMode?: "live" | "moderated") {
  const quiz: QuizDraft = {
    title: "Cloud",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "word_cloud",
        prompt: "Share a short phrase",
        timeLimitSeconds: 60,
        basePoints: 0,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  const settings = {
    audienceLimit: 250,
    scoringMode: "accuracy" as const,
    resultVisibility: "private" as const,
    nicknamePolicy: "custom" as const,
    allowLateJoin: true,
    ...(wordCloudMode ? { wordCloudMode } : {}),
  };
  const initial = createGameState({
    sessionId: randomUUID(),
    code: "1234567",
    quiz,
    settings,
    roundProtocol: deriveRoundProtocol(quiz, settings),
  });
  return applyHostCommand(initial, {
    action: "start",
    commandId: randomUUID(),
    expectedVersion: initial.version,
    nowMs: 1000,
    newRoundId: randomUUID,
  }).state;
}

describe("live word cloud aggregates", () => {
  it("includes the full 250-person cohort without pagination and deduplicates retained participant rows", () => {
    const state = fixture("live");
    const answers: EngineAnswer[] = Array.from({ length: 250 }, (_, index) => ({
      answerId: randomUUID(),
      participantId: randomUUID(),
      roundId: state.roundId!,
      response: { kind: "text", value: `Phrase ${String(index).padStart(3, "0")}` },
      confidence: null,
      choiceId: null,
      acceptedAtMs: 1100 + index,
      responseMs: 100 + index,
      score: 0,
      correct: false,
      idempotencyKey: randomUUID(),
    }));
    state.responseModeration = Object.fromEntries(
      answers.map((answer) => [
        answer.answerId,
        {
          roundId: state.roundId!,
          questionId: state.quiz.questions[0]!.id,
          status: "approved",
          acceptedAtMs: answer.acceptedAtMs,
        },
      ]),
    );
    const result = liveWordCloudResults(state, state.roundId!, answers);
    expect(RoundLiveWordCloudResultsSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ respondents: 250, totalTerms: 250, truncated: false });
    expect(result.terms).toHaveLength(250);
    expect(result.terms[249]).toEqual({ value: "phrase 249", label: "phrase 249", count: 1 });
    expect(textResults(state, state.roundId!, { limit: 50 }, answers)).toMatchObject({
      visible: false,
      terms: [],
    });
    const duplicate = {
      ...answers[0]!,
      answerId: randomUUID(),
      acceptedAtMs: 2000,
      response: { kind: "text" as const, value: "Duplicate phrase" },
    };
    state.responseModeration[duplicate.answerId] = {
      roundId: state.roundId!,
      questionId: state.quiz.questions[0]!.id,
      status: "approved",
      acceptedAtMs: duplicate.acceptedAtMs,
    };
    expect(liveWordCloudResults(state, state.roundId!, [...answers, duplicate])).toEqual(result);
    state.responseModeration[answers[0]!.answerId]!.status = "removed";
    const removed = liveWordCloudResults(state, state.roundId!, answers);
    expect(removed.respondents).toBe(249);
    expect(removed.terms.some((term) => term.value === "phrase 000")).toBe(false);
  });

  it("rejects live visibility for omitted and explicitly moderated legacy policy", () => {
    for (const mode of [undefined, "moderated"] as const) {
      const state = fixture(mode);
      expect(() => liveWordCloudResults(state, state.roundId!, [])).toThrow("moderated word cloud");
    }
  });
});
