import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OpenRoundCheckpointSetExportSchema,
  QuestionDraftSchema,
  QuestionSchema,
  PresentationDraftSchema,
  RecoveryPackDraftSchema,
  ReportV5Schema,
  ReportV6Schema,
  ResponsePayloadSchema,
  RoundDraftMutationSchema,
  canUseRoundProtocol,
  canonicalizeResponse,
  currentRoundClientCapabilities,
  deriveRoundProtocol,
} from "../src/index.js";
import { SurveyDraftSchema } from "../src/surveys.js";

function ranking() {
  return {
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
    purpose: "opinion" as const,
    confidence: "off" as const,
    delivery: "main" as const,
  };
}
describe("ranking opinion contracts", () => {
  it("supports a full list or a bounded exact rank count and rejects learning settings", () => {
    const question = ranking();
    expect(QuestionSchema.parse(question)).toMatchObject({ rankCount: 2 });
    const full = { ...question, rankCount: undefined };
    expect(QuestionSchema.parse(full).rankCount).toBeUndefined();
    for (const patch of [
      { rankCount: 0 },
      { rankCount: 4 },
      { rankCount: 1.5 },
      { maxSelections: 2 },
      { basePoints: 100 },
      { purpose: "diagnostic" },
      { confidence: "required" },
      { delivery: "recheck" },
      { linkedRecheckQuestionId: randomUUID() },
      { choices: [{ ...question.choices[0]!, isCorrect: true }, ...question.choices.slice(1)] },
    ]) {
      expect(QuestionDraftSchema.safeParse({ ...question, ...patch }).success).toBe(false);
      expect(QuestionSchema.safeParse({ ...question, ...patch }).success).toBe(false);
    }
    expect(QuestionDraftSchema.safeParse({ ...question, type: "poll" }).success).toBe(false);
  });

  it("preserves ordered response meaning and requires the ranking capability", () => {
    const question = ranking();
    const choiceIds = question.choices.slice(0, 2).map((choice) => choice.id);
    expect(canonicalizeResponse({ kind: "ranking", choiceIds })).toEqual({
      kind: "ranking",
      choiceIds,
    });
    const canonical = canonicalizeResponse({ kind: "ranking", choiceIds });
    if (canonical.kind !== "ranking") throw new Error("Expected ordered ranking response");
    expect(canonical.choiceIds).not.toBe(choiceIds);
    expect(
      canonicalizeResponse({ kind: "ranking", choiceIds: [...choiceIds].reverse() }),
    ).not.toEqual({ kind: "ranking", choiceIds });
    expect(
      ResponsePayloadSchema.safeParse({ kind: "ranking", choiceIds: [choiceIds[0], choiceIds[0]] })
        .success,
    ).toBe(false);
    const protocol = deriveRoundProtocol({ questions: [question] });
    expect(protocol.requiredCapabilities).toEqual(["response.ranking"]);
    expect(
      canUseRoundProtocol(protocol, { protocolVersion: 3, capabilities: ["poll.multiselect"] }),
    ).toBe(false);
    expect(canUseRoundProtocol(protocol, currentRoundClientCapabilities())).toBe(true);
    expect(canUseRoundProtocol(protocol, undefined)).toBe(false);
    expect(
      deriveRoundProtocol({ questions: [question, { type: "poll", maxSelections: 2 }] })
        .requiredCapabilities,
    ).toEqual(["poll.multiselect", "response.ranking"]);
  });

  it("declares new draft/native versions and rejects unsupported artifact families", () => {
    const question = ranking();
    const draft = { title: "Rankings", description: "", questions: [question] };
    const mutation = { draft, expectedRevision: 0, mutationId: randomUUID() };
    for (const schemaVersion of [1, 2])
      expect(RoundDraftMutationSchema.safeParse({ ...mutation, schemaVersion }).success).toBe(
        false,
      );
    expect(RoundDraftMutationSchema.safeParse({ ...mutation, schemaVersion: 3 }).success).toBe(
      true,
    );
    const exported = {
      format: "openround.checkpoint-set",
      exportedAt: "2026-10-13T12:00:00.000Z",
      checkpointSet: draft,
    };
    for (const version of [1, 2, 3, 4, 5])
      expect(OpenRoundCheckpointSetExportSchema.safeParse({ ...exported, version }).success).toBe(
        false,
      );
    expect(
      OpenRoundCheckpointSetExportSchema.parse({ ...exported, version: 6 }).checkpointSet,
    ).toMatchObject(draft);
    expect(
      PresentationDraftSchema.safeParse({
        title: "Rankings",
        schemaVersion: 2,
        blocks: [{ id: randomUUID(), kind: "question", question }],
      }).success,
    ).toBe(false);
    expect(
      SurveyDraftSchema.safeParse({
        schemaVersion: 2,
        title: "Rankings",
        items: [{ required: true, question }],
      }).success,
    ).toBe(false);
    expect(
      RecoveryPackDraftSchema.safeParse({
        title: "Rankings",
        diagnostic: question,
        recheck: question,
        interventions: [],
        conceptKeys: [],
      }).success,
    ).toBe(false);
  });

  it("keeps ranking summaries out of previous report versions", () => {
    const question = ranking();
    const questions = [
      {
        questionId: question.id,
        prompt: question.prompt,
        responses: 5,
        correct: null,
        accuracyPercent: null,
        difficult: false,
        responseDistribution: {
          kind: "ranking",
          respondents: 5,
          rankCount: 2,
          totalRankings: 10,
          buckets: question.choices.map((choice) => ({
            value: choice.id,
            label: choice.label,
            weightedScore: 0,
            rankedRespondents: 0,
            averageRank: null,
          })),
        },
      },
    ];
    expect(ReportV6Schema.shape.questions.parse(questions)).toEqual(questions);
    expect(ReportV5Schema.shape.questions.safeParse(questions).success).toBe(false);
  });
});
