import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  PresentationDraftSchema,
  PresentationContentSchema,
  PresentationSessionResponseSchema,
  PresentationTextResponseResultsSchema,
  PresentationTextModerationAckSchema,
  requiresPresentationTextOpinions,
  PresentationParticipantQuestionSchema,
  PresentationHostSnapshotSchema,
  PresentationParticipantSnapshotSchema,
  PresentationCompanionSnapshotSchema,
  PresentationStageSnapshotSchema,
} from "../src/index.js";
function doc(type = "open_text") {
  return {
    title: "Text",
    schemaVersion: 10,
    blocks: [
      {
        id: randomUUID().toUpperCase(),
        kind: "question",
        question: {
          id: randomUUID().toUpperCase(),
          type,
          prompt: "Share",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  };
}
describe("Presentation document10 text contracts", () => {
  it("keeps text moderation capability optional and host-only", () => {
    const sessionId = randomUUID();
    const base = {
      sessionId,
      artifactType: "presentation",
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: "Optional host moderation",
      code: "1234567",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      blockCount: 1,
      revision: 0,
      seq: 0,
      serverTime: "2026-11-04T12:00:00.000Z",
      questionOpenedAt: null,
      questionClosesAt: null,
      acceptingResponses: false,
      settings: { timeMode: "timed" },
      currentBlock: null,
      finishedAt: null,
    };
    const roomStatus = {
      sessionId,
      joinedCount: 0,
      connectedCount: 0,
      notCurrentlyConnectedCount: 0,
      responseCount: 0,
      sampledAt: base.serverTime,
    };
    const host = {
      ...base,
      projection: "host",
      participantCount: 0,
      responseCount: 0,
      participants: [],
      roomStatus,
    };
    expect(PresentationHostSnapshotSchema.parse(host)).not.toHaveProperty(
      "textModerationAvailable",
    );
    expect(
      PresentationHostSnapshotSchema.parse({ ...host, textModerationAvailable: true }),
    ).toHaveProperty("textModerationAvailable", true);
    expect(
      PresentationHostSnapshotSchema.safeParse({ ...host, textModerationAvailable: false }).success,
    ).toBe(false);
    for (const [schema, snapshot] of [
      [
        PresentationParticipantSnapshotSchema,
        {
          ...base,
          projection: "participant",
          participantId: randomUUID(),
          participantCount: 0,
          responseSubmitted: false,
          standing: null,
          responseResult: null,
        },
      ],
      [
        PresentationStageSnapshotSchema,
        {
          ...base,
          projection: "stage",
          revealedAnswer: null,
          participantCount: 0,
          responseCount: 0,
        },
      ],
      [
        PresentationCompanionSnapshotSchema,
        { ...base, projection: "companion", primaryAction: "advance", roomStatus },
      ],
    ] as const) {
      expect(schema.safeParse(snapshot).success).toBe(true);
      expect(schema.safeParse({ ...snapshot, textModerationAvailable: true }).success).toBe(false);
    }
  });
  it.each(["open_text", "word_cloud"])("gates %s without upgrading legacy formats", (type) => {
    const value = doc(type);
    for (const schema of [PresentationDraftSchema, PresentationContentSchema]) {
      expect(schema.parse(value).schemaVersion).toBe(10);
      expect(schema.parse({ ...value, schemaVersion: 11 }).schemaVersion).toBe(11);
      expect(schema.parse({ ...value, schemaVersion: 12 }).blocks).toEqual(
        schema.parse(value).blocks,
      );
      expect(schema.parse({ ...value, schemaVersion: 13 }).schemaVersion).toBe(13);
      expect(schema.parse({ ...value, schemaVersion: 14 }).schemaVersion).toBe(14);
      for (const schemaVersion of [2, 3, 4, 5, 6, 7, 8, 9, 15])
        expect(schema.safeParse({ ...value, schemaVersion }).success).toBe(false);
      for (const bad of [
        { basePoints: 1 },
        { confidence: "required" },
        { delivery: "recheck" },
        { linkedRecheckQuestionId: randomUUID() },
        { purpose: "diagnostic" },
      ])
        expect(
          schema.safeParse({
            ...value,
            blocks: [{ ...value.blocks[0]!, question: { ...value.blocks[0]!.question, ...bad } }],
          }).success,
        ).toBe(false);
    }
    expect(requiresPresentationTextOpinions(PresentationDraftSchema.parse(value))).toBe(true);
    expect(PresentationDraftSchema.parse({ title: "Old", blocks: [] }).schemaVersion).toBe(2);
    const block = value.blocks[0]!;
    expect(
      PresentationParticipantQuestionSchema.parse({
        id: block.question.id,
        type,
        prompt: "Share",
        confidence: "off",
        timeLimitSeconds: 30,
        basePoints: 0,
        mediaId: null,
        mediaAlt: null,
        choices: [],
      }),
    ).not.toHaveProperty("textValue");
  });
  it("caps text blocks at ten and retains logical UUID uniqueness", () => {
    const value = doc();
    const blocks = Array.from({ length: 10 }, () => doc().blocks[0]!);
    expect(PresentationDraftSchema.safeParse({ ...value, blocks }).success).toBe(true);
    expect(
      PresentationDraftSchema.safeParse({ ...value, blocks: [...blocks, doc().blocks[0]!] })
        .success,
    ).toBe(false);
    const first = blocks[0]!;
    expect(
      PresentationDraftSchema.safeParse({
        ...value,
        blocks: [first, { ...doc().blocks[0]!, id: first.id.toLowerCase() }],
      }).success,
    ).toBe(false);
  });
  it("normalizes text but never accepts empty/mixed transport payloads", () => {
    expect(PresentationSessionResponseSchema.parse({ textValue: "  e\u0301  " })).toEqual({
      textValue: "é",
    });
    for (const response of [
      {},
      { textValue: " " },
      { textValue: "a\u0001b" },
      { textValue: "x", choiceIds: [] },
      { textValue: "x", orderedChoiceIds: [randomUUID()] },
      { textValue: "x", confidence: "high" },
    ])
      expect(PresentationSessionResponseSchema.safeParse(response).success).toBe(false);
  });
  it("rejects body-bearing results below sample threshold or outside format", () => {
    const value = {
      sessionId: randomUUID(),
      blockId: randomUUID(),
      revision: 1,
      seq: 10,
      type: "open_text",
      visible: false,
      approvedRespondents: 4,
      items: [],
      terms: [],
      nextCursor: null,
    };
    expect(PresentationTextResponseResultsSchema.safeParse(value).success).toBe(true);
    expect(
      PresentationTextResponseResultsSchema.safeParse({
        ...value,
        items: [{ textValue: "private" }],
      }).success,
    ).toBe(false);
    expect(
      PresentationTextResponseResultsSchema.safeParse({ ...value, visible: true }).success,
    ).toBe(false);
  });
  it("preserves original moderation receipts alongside newer removed metadata", () => {
    const responseId = randomUUID(),
      blockId = randomUUID();
    const value = {
      sessionId: randomUUID(),
      revision: 3,
      seq: 20,
      accepted: true,
      duplicate: true,
      receipt: {
        commandId: randomUUID(),
        responseId,
        blockId,
        previousStatus: "pending",
        status: "approved",
        expectedRevision: 1,
        expectedModerationVersion: 0,
        resultingModerationVersion: 1,
        acceptedAt: new Date().toISOString(),
      },
      response: { responseId, blockId, status: "removed", moderationVersion: 2 },
    };
    expect(PresentationTextModerationAckSchema.parse(value)).toEqual(value);
  });
});
