import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationOpinionResultSummarySchema,
  PresentationParticipantQuestionSchema,
  PresentationSessionResponseSchema,
  PresentationStageSnapshotSchema,
  PresentationRestV1SessionListItemSchema,
  requiresPresentationOpinionFormats,
  migratePresentationV1,
} from "../src/index";

function uuidWithLetter() {
  return randomUUID().replace(/^./, "a");
}

function opinion(type: "poll" | "ranking" = "ranking") {
  return {
    id: uuidWithLetter(),
    type,
    prompt: "Choose your priorities",
    purpose: "opinion",
    confidence: "off",
    delivery: "main",
    linkedRecheckQuestionId: null,
    choices: ["One", "Two", "Three"].map((label) => ({
      id: uuidWithLetter(),
      label,
      isCorrect: false,
    })),
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
    ...(type === "poll" ? { maxSelections: 2 } : { rankCount: 2 }),
  };
}

function document(type: "poll" | "ranking" = "ranking") {
  return {
    title: "Priorities",
    schemaVersion: 9,
    blocks: [{ id: uuidWithLetter(), kind: "question", question: opinion(type) }],
  };
}

describe("Presentation E04 opinion format contracts", () => {
  it.each(["poll", "ranking"] as const)(
    "requires explicit v9 for %s without changing the default",
    (type) => {
      const value = document(type);
      expect(PresentationDraftSchema.parse({ title: "Old deck", blocks: [] }).schemaVersion).toBe(
        2,
      );
      expect(requiresPresentationOpinionFormats(PresentationDraftSchema.parse(value))).toBe(true);
      expect(PresentationContentSchema.parse(value).schemaVersion).toBe(9);
      expect(migratePresentationV1(value)).toBe(value);
      for (const schemaVersion of [2, 3, 4, 5, 6, 7, 8]) {
        expect(PresentationDraftSchema.safeParse({ ...value, schemaVersion }).success).toBe(false);
        expect(PresentationContentSchema.safeParse({ ...value, schemaVersion }).success).toBe(
          false,
        );
      }
      for (const extra of [
        { basePoints: 1 },
        { confidence: "required" },
        { purpose: "diagnostic" },
        { delivery: "recheck" },
        { linkedRecheckQuestionId: randomUUID() },
        {
          choices: value.blocks[0]!.question.choices.map((choice) => ({
            ...choice,
            isCorrect: true,
          })),
        },
      ]) {
        const invalid = {
          ...value,
          blocks: [{ ...value.blocks[0], question: { ...value.blocks[0]!.question, ...extra } }],
        };
        expect(PresentationDraftSchema.safeParse(invalid).success).toBe(false);
        expect(PresentationContentSchema.safeParse(invalid).success).toBe(false);
      }
    },
  );

  it.each(["poll", "ranking"] as const)(
    "accepts uppercase %s IDs and rejects choices differing only by UUID case",
    (type) => {
      const value = document(type);
      const block = value.blocks[0]!;
      block.id = block.id.toUpperCase();
      block.question.id = block.question.id.toUpperCase();
      block.question.choices = block.question.choices.map((choice) => ({
        ...choice,
        id: choice.id.toUpperCase(),
      }));
      const valid = {
        ...value,
        blocks: [{ ...block, question: { ...block.question, rankCount: undefined } }],
      };
      for (const schema of [PresentationDraftSchema, PresentationContentSchema]) {
        expect(schema.safeParse(valid).success).toBe(true);
        const duplicate = {
          ...valid,
          blocks: [
            {
              ...valid.blocks[0]!,
              question: {
                ...valid.blocks[0]!.question,
                choices: [
                  block.question.choices[0]!,
                  {
                    ...block.question.choices[1]!,
                    id: block.question.choices[0]!.id.toLowerCase(),
                  },
                ],
              },
            },
          ],
        };
        expect(schema.safeParse(duplicate).success).toBe(false);
      }
    },
  );

  it.each(["poll", "ranking"] as const)(
    "rejects logical block, question and choice collisions involving an E04 %s in either deck order",
    (type) => {
      const value = document(type);
      const opinionBlock = value.blocks[0]!;
      opinionBlock.id = opinionBlock.id.toUpperCase();
      opinionBlock.question.id = opinionBlock.question.id.toUpperCase();
      opinionBlock.question.choices = opinionBlock.question.choices.map((choice) => ({
        ...choice,
        id: choice.id.toUpperCase(),
      }));
      for (const collision of ["block", "question", "choice"]) {
        const legacyBlock = {
          id: collision === "block" ? opinionBlock.id.toLowerCase() : randomUUID(),
          kind: "question",
          question: {
            ...opinion(),
            id: collision === "question" ? opinionBlock.question.id.toLowerCase() : randomUUID(),
            type: "single_select",
            purpose: "diagnostic",
            basePoints: 1000,
            maxSelections: undefined,
            rankCount: undefined,
            choices: [
              {
                id:
                  collision === "choice"
                    ? opinionBlock.question.choices[0]!.id.toLowerCase()
                    : randomUUID(),
                label: "Correct",
                isCorrect: true,
              },
              { id: randomUUID(), label: "Other", isCorrect: false },
            ],
          },
        };
        for (const blocks of [
          [opinionBlock, legacyBlock],
          [legacyBlock, opinionBlock],
        ]) {
          expect(PresentationDraftSchema.safeParse({ ...value, blocks }).success).toBe(false);
          expect(PresentationContentSchema.safeParse({ ...value, blocks }).success).toBe(false);
        }
      }
    },
  );

  it.each([2, 3, 4, 5, 6, 7, 8, 9])(
    "preserves legacy UUID spelling semantics in document version %s",
    (schemaVersion) => {
      const blockId = uuidWithLetter();
      const questionId = uuidWithLetter();
      const choiceIds = [uuidWithLetter(), uuidWithLetter()];
      const legacyBlock = (uppercase: boolean) => {
        const spelling = (id: string) => (uppercase ? id.toUpperCase() : id.toLowerCase());
        return {
          id: spelling(blockId),
          kind: "question",
          question: {
            ...opinion(),
            id: spelling(questionId),
            type: "single_select",
            purpose: "diagnostic",
            basePoints: 1000,
            rankCount: undefined,
            choices: choiceIds.map((id, index) => ({
              id: spelling(id),
              label: `Choice ${index}`,
              isCorrect: index === 0,
            })),
          },
        };
      };
      const value = {
        title: "Legacy spelling",
        schemaVersion,
        blocks: [
          legacyBlock(true),
          legacyBlock(false),
          ...(schemaVersion === 9 ? document().blocks : []),
        ],
      };
      expect(PresentationDraftSchema.safeParse(value).success).toBe(true);
      expect(PresentationContentSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(["open_text", "word_cloud"])(
    "keeps %s unsupported in every Presentation document and projection",
    (type) => {
      const question = { ...opinion(), type, choices: undefined, rankCount: undefined };
      for (const schemaVersion of [2, 3, 4, 5, 6, 7, 8, 9]) {
        const value = {
          title: "Text",
          schemaVersion,
          blocks: [{ id: randomUUID(), kind: "question", question }],
        };
        expect(PresentationDraftSchema.safeParse(value).success).toBe(false);
        expect(PresentationContentSchema.safeParse(value).success).toBe(false);
      }
      expect(
        PresentationParticipantQuestionSchema.safeParse({
          id: question.id,
          type,
          prompt: question.prompt,
          confidence: "off",
          choices: [],
          timeLimitSeconds: 30,
          basePoints: 0,
          mediaId: null,
          mediaAlt: null,
        }).success,
      ).toBe(false);
    },
  );

  it("retains semantic ranking order and rejects ambiguous or repeated ordered selections", () => {
    const [first, second] = [randomUUID(), randomUUID()];
    expect(PresentationSessionResponseSchema.parse({ orderedChoiceIds: [second, first] })).toEqual({
      orderedChoiceIds: [second, first],
    });
    for (const response of [
      { orderedChoiceIds: [] },
      { orderedChoiceIds: [first, first] },
      { orderedChoiceIds: [first], choiceIds: [first] },
      { orderedChoiceIds: [first], numericValue: "1" },
      { orderedChoiceIds: [first], ratingValue: 1 },
      { orderedChoiceIds: [first], confidence: "high" },
    ])
      expect(PresentationSessionResponseSchema.safeParse(response).success).toBe(false);
  });

  it("validates anonymous rank positions using the same full-choice weights as Rounds", () => {
    const value = document();
    const block = value.blocks[0]!;
    const [one, two, three] = block.question.choices;
    const opinionSummary = {
      blockId: block.id,
      kind: "ranking",
      responseCount: 2,
      rankCount: 2,
      totalRankings: 4,
      choices: [
        {
          choiceId: one!.id,
          label: "One",
          weightedScore: 5,
          rankedRespondents: 2,
          averageRank: 1.5,
          rankCounts: [1, 1],
        },
        {
          choiceId: two!.id,
          label: "Two",
          weightedScore: 3,
          rankedRespondents: 1,
          averageRank: 1,
          rankCounts: [1, 0],
        },
        {
          choiceId: three!.id,
          label: "Three",
          weightedScore: 2,
          rankedRespondents: 1,
          averageRank: 2,
          rankCounts: [0, 1],
        },
      ],
    };
    expect(PresentationOpinionResultSummarySchema.parse(opinionSummary)).toEqual(opinionSummary);
    const question = {
      id: block.question.id,
      type: "ranking",
      prompt: block.question.prompt,
      confidence: "off",
      rankCount: 2,
      choices: block.question.choices.map(({ id, label }) => ({ id, label })),
      timeLimitSeconds: 30,
      basePoints: 0,
      mediaId: null,
      mediaAlt: null,
    };
    const snapshot = {
      sessionId: randomUUID(),
      artifactType: "presentation",
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: "Priorities",
      code: "1234567",
      status: "active",
      phase: "question_reveal",
      currentBlockIndex: 0,
      blockCount: 1,
      revision: 2,
      seq: 4,
      serverTime: "2026-11-04T12:00:00.000Z",
      questionOpenedAt: null,
      questionClosesAt: null,
      acceptingResponses: false,
      settings: { timeMode: "flex" },
      projection: "stage",
      currentBlock: { id: block.id, kind: "question", question },
      revealedAnswer: null,
      participantCount: 2,
      responseCount: 2,
      finishedAt: null,
      opinionSummary,
    };
    expect(PresentationStageSnapshotSchema.parse(snapshot).opinionSummary).toEqual(opinionSummary);
    const list: Record<string, unknown> = { ...snapshot };
    for (const key of ["projection", "sessionId", "seq", "serverTime", "revealedAnswer"])
      delete list[key];
    Object.assign(list, {
      id: snapshot.sessionId,
      eventSeq: snapshot.seq,
      trustMode: "learning",
      settings: { timeMode: "flex", trustMode: "learning" },
      participants: [],
      leaderboard: [],
      createdAt: snapshot.serverTime,
      updatedAt: snapshot.serverTime,
      currentBlock: {
        ...snapshot.currentBlock,
        question: { ...question, purpose: "opinion", linkedRecheckAvailable: false },
        revealedAnswer: null,
      },
    });
    expect(PresentationRestV1SessionListItemSchema.parse(list).opinionSummary).toEqual(
      opinionSummary,
    );
    expect(
      PresentationRestV1SessionListItemSchema.safeParse({ ...list, phase: "question_open" })
        .success,
    ).toBe(false);
    for (const extra of [
      { phase: "question_open" },
      { acceptingResponses: true },
      { opinionSummary: { ...opinionSummary, blockId: randomUUID() } },
    ]) {
      expect(PresentationStageSnapshotSchema.safeParse({ ...snapshot, ...extra }).success).toBe(
        false,
      );
    }
    expect(
      PresentationOpinionResultSummarySchema.safeParse({
        ...opinionSummary,
        choices: opinionSummary.choices.map((choice) => ({
          ...choice,
          weightedScore: choice.weightedScore + 1,
        })),
      }).success,
    ).toBe(false);
  });
});
