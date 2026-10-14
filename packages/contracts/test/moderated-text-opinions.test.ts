import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  QuestionDraftSchema,
  QuestionSchema,
  QuizDraftSchema,
  PresentationDraftSchema,
  OpenRoundCheckpointSetExportSchema,
  RoundDraftMutationSchema,
  ResponsePayloadSchema,
  ReportV6Schema,
  ReportV7Schema,
  SessionSnapshotSchema,
  TextResponseModerationEntrySchema,
  TextResponseModerationReceiptSchema,
  RoundTextResponseResultsSchema,
  normalizeTextResponse,
  wordCloudGroupKey,
  deriveRoundProtocol,
  currentRoundClientCapabilities,
  canUseRoundProtocol,
} from "../src/index.js";
import { SurveyDraftSchema } from "../src/surveys.js";

function question(type: "open_text" | "word_cloud" = "open_text") {
  return {
    id: randomUUID(),
    type,
    prompt: "What could improve?",
    timeLimitSeconds: 60,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
    purpose: "opinion" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    linkedRecheckQuestionId: null,
    conceptKeys: [],
  };
}
describe("moderated text opinion contracts", () => {
  it.each(["open_text", "word_cloud"] as const)(
    "limits %s to unscored live main checkpoints",
    (type) => {
      const q = question(type);
      expect(QuestionSchema.parse(q)).toMatchObject(q);
      for (const patch of [
        { basePoints: 100 },
        { purpose: "diagnostic" },
        { confidence: "required" },
        { delivery: "recheck" },
        { linkedRecheckQuestionId: randomUUID() },
        { choices: [] },
        { rankCount: 2 },
        { maxSelections: 2 },
      ]) {
        expect(QuestionDraftSchema.safeParse({ ...q, ...patch }).success).toBe(false);
        expect(QuestionSchema.safeParse({ ...q, ...patch }).success).toBe(false);
      }
      expect(
        PresentationDraftSchema.safeParse({
          title: "Feedback",
          schemaVersion: 2,
          blocks: [{ id: randomUUID(), kind: "question", question: q }],
        }).success,
      ).toBe(false);
      expect(
        SurveyDraftSchema.safeParse({
          schemaVersion: 2,
          title: "Feedback",
          items: [{ required: true, question: q }],
        }).success,
      ).toBe(false);
    },
  );
  it("normalizes Unicode before UTF-16 bounds and rejects empty/control characters", () => {
    expect(normalizeTextResponse("  Cafe\u0301\n\tideas  ")).toBe("Café\n\tideas");
    expect(ResponsePayloadSchema.parse({ kind: "text", value: "  Cafe\u0301  " })).toEqual({
      kind: "text",
      value: "Café",
    });
    expect(wordCloudGroupKey("  BETTER\u00a0  Feedback ")).toBe("better feedback");
    expect(wordCloudGroupKey("Cafe\u0301")).toBe("café");
    expect(normalizeTextResponse("😀".repeat(40), "word_cloud").length).toBe(80);
    expect(normalizeTextResponse("x".repeat(1000))).toHaveLength(1000);
    for (const value of ["", "   ", "a\u0000b", "a\u007fb", "a\u0085b", "x".repeat(1001)])
      expect(() => normalizeTextResponse(value)).toThrow();
    for (const value of ["a\nb", "a\tb", "😀".repeat(41), "x".repeat(81)])
      expect(() => normalizeTextResponse(value, "word_cloud")).toThrow();
  });
  it("requires native7/draft4 and freezes both text capabilities while bounding text checkpoints", () => {
    const draft = {
      title: "Feedback",
      description: "",
      questions: [question(), question("word_cloud")],
    };
    const mutation = { draft, expectedRevision: 0, mutationId: randomUUID() };
    for (const schemaVersion of [1, 2, 3])
      expect(RoundDraftMutationSchema.safeParse({ ...mutation, schemaVersion }).success).toBe(
        false,
      );
    expect(RoundDraftMutationSchema.parse({ ...mutation, schemaVersion: 4 }).schemaVersion).toBe(4);
    const exported = {
      format: "openround.checkpoint-set",
      exportedAt: "2026-10-13T12:00:00.000Z",
      checkpointSet: draft,
    };
    for (const version of [1, 2, 3, 4, 5, 6, 8])
      expect(OpenRoundCheckpointSetExportSchema.safeParse({ ...exported, version }).success).toBe(
        false,
      );
    expect(
      OpenRoundCheckpointSetExportSchema.parse({ ...exported, version: 7 }).checkpointSet.questions,
    ).toHaveLength(2);
    const protocol = deriveRoundProtocol(draft);
    expect(protocol.requiredCapabilities).toEqual(["response.open_text", "response.word_cloud"]);
    expect(canUseRoundProtocol(protocol, undefined)).toBe(false);
    expect(
      canUseRoundProtocol(protocol, { protocolVersion: 3, capabilities: ["response.open_text"] }),
    ).toBe(false);
    expect(canUseRoundProtocol(protocol, currentRoundClientCapabilities())).toBe(true);
    expect(
      QuizDraftSchema.safeParse({
        ...draft,
        questions: Array.from({ length: 11 }, () => question()),
      }).success,
    ).toBe(false);
  });
  it("keeps bodies outside old reports and every snapshot response projection", () => {
    const distribution = {
      kind: "open_text",
      respondents: 5,
      entries: Array.from({ length: 5 }, () => ({ value: "approved body" })),
    };
    const questions = [
      {
        questionId: randomUUID(),
        prompt: "Feedback",
        responses: 6,
        correct: null,
        accuracyPercent: null,
        difficult: false,
        responseDistribution: distribution,
      },
    ];
    expect(ReportV7Schema.shape.questions.parse(questions)).toEqual(questions);
    expect(ReportV6Schema.shape.questions.safeParse(questions).success).toBe(false);
    expect(
      SessionSnapshotSchema.shape.myResponse.safeParse({ kind: "text", value: "private body" })
        .success,
    ).toBe(false);
    expect(
      SessionSnapshotSchema.shape.correctResponse.safeParse({ kind: "text", value: "private body" })
        .success,
    ).toBe(false);
    expect(SessionSnapshotSchema.shape.responseDistribution.safeParse(distribution).success).toBe(
      false,
    );
    expect(
      RoundTextResponseResultsSchema.safeParse({
        sessionId: randomUUID(),
        roundId: randomUUID(),
        version: 1,
        type: "open_text",
        visible: false,
        approvedRespondents: 4,
        items: [{ answerId: randomUUID(), body: "leak" }],
        terms: [],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
  it("requires body-free moderation metadata and coherent immutable audit receipts", () => {
    const entry = {
      roundId: randomUUID(),
      questionId: randomUUID(),
      status: "pending",
      acceptedAtMs: 1,
    };
    expect(
      TextResponseModerationEntrySchema.safeParse({ ...entry, value: "private body" }).success,
    ).toBe(false);
    const receipt = {
      intentHash: "a".repeat(64),
      answerId: randomUUID(),
      actor: { kind: "host", userId: randomUUID() },
      previousStatus: "pending",
      status: "approved",
      expectedVersion: 4,
      resultingVersion: 5,
      occurredAtMs: 100,
    };
    expect(TextResponseModerationReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(
      TextResponseModerationReceiptSchema.safeParse({ ...receipt, resultingVersion: 6 }).success,
    ).toBe(false);
    expect(
      TextResponseModerationReceiptSchema.safeParse({ ...receipt, previousStatus: "approved" })
        .success,
    ).toBe(false);
    expect(
      TextResponseModerationReceiptSchema.safeParse({ ...receipt, body: "private body" }).success,
    ).toBe(false);
  });
});
