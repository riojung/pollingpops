import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationDraftSchema,
  PresentationContentSchema,
  PresentationCommandSchema,
  PresentationCompanionCommandSchema,
  preparePresentationPublication,
  PresentationNavigationStateSchema,
  PresentationReportV6Schema,
  PresentationReportV5Schema,
  migratePresentationV1,
} from "../src/index.js";
const block = () => ({
  id: randomUUID(),
  kind: "content",
  layout: "title_body",
  title: "Slide",
  textElements: [
    { id: randomUUID(), role: "title", text: "Slide", region: "top_center", order: 0 },
  ],
  mediaId: null,
  mediaAlt: null,
  speakerNotes: "",
});
describe("Presentation navigation contracts", () => {
  it("keeps grouping independent of sequence and removes hidden publication members", () => {
    const blocks = [block(), { ...block(), hidden: true }, block()];
    const sections = [
      { id: randomUUID(), title: "Named section", blockIds: [blocks[2]!.id, blocks[0]!.id] },
      { id: randomUUID(), title: "Hidden only", blockIds: [blocks[1]!.id] },
    ];
    const draft = PresentationDraftSchema.parse({
      schemaVersion: 12,
      title: "Sections",
      blocks,
      sections,
    });
    expect(draft.blocks.map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    expect(migratePresentationV1(draft)).toBe(draft);
    const published = PresentationContentSchema.parse(preparePresentationPublication(draft));
    expect(published.sections).toEqual([sections[0]]);
    expect(published.blocks.map((b) => b.id)).toEqual([blocks[0]!.id, blocks[2]!.id]);
    expect(PresentationDraftSchema.safeParse({ ...draft, schemaVersion: 11 }).success).toBe(false);
    expect(
      PresentationDraftSchema.safeParse({
        ...draft,
        sections: [
          ...sections,
          { id: randomUUID(), title: "Duplicate member", blockIds: [blocks[0]!.id.toUpperCase()] },
        ],
      }).success,
    ).toBe(false);
    expect(
      PresentationDraftSchema.safeParse({
        ...draft,
        sections: [{ id: randomUUID(), title: "", blockIds: [] }],
      }).success,
    ).toBe(true);
    expect(
      PresentationContentSchema.safeParse({
        ...draft,
        blocks: [blocks[0]],
        sections: [{ id: randomUUID(), title: "", blockIds: [blocks[0]!.id] }],
      }).success,
    ).toBe(false);
    expect(
      PresentationDraftSchema.safeParse({
        ...draft,
        sections: undefined,
        blocks: [blocks[0], { ...blocks[0], id: blocks[0]!.id.toUpperCase() }],
      }).success,
    ).toBe(false);
  });
  it("requires semantic UUID uniqueness only in v12 and retains literal linked references", () => {
    const question = {
      id: randomUUID(),
      kind: "question",
      question: {
        id: randomUUID(),
        type: "numeric",
        prompt: "How many?",
        purpose: "diagnostic",
        confidence: "off",
        delivery: "main",
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 30,
        basePoints: 1000,
        explanation: "One",
        mediaId: null,
        mediaAlt: null,
        correctValue: "1",
        tolerance: "0",
        unit: null,
      },
    };
    const duplicate = {
      ...question,
      id: randomUUID(),
      question: { ...question.question, id: question.question.id.toUpperCase() },
    };
    expect(
      PresentationContentSchema.safeParse({
        schemaVersion: 11,
        title: "Legacy",
        blocks: [question, duplicate],
      }).success,
    ).toBe(true);
    expect(
      PresentationContentSchema.safeParse({
        schemaVersion: 12,
        title: "Stable UUIDs",
        blocks: [question, duplicate],
      }).success,
    ).toBe(false);
    const recheck = {
      ...question,
      id: randomUUID(),
      question: { ...question.question, id: randomUUID(), delivery: "recheck" },
    };
    expect(
      PresentationContentSchema.safeParse({
        schemaVersion: 12,
        title: "Literal links",
        blocks: [
          {
            ...question,
            question: {
              ...question.question,
              linkedRecheckQuestionId: recheck.question.id.toUpperCase(),
            },
          },
          recheck,
        ],
      }).success,
    ).toBe(false);
    expect(
      PresentationContentSchema.safeParse({
        schemaVersion: 12,
        title: "Literal links",
        blocks: [
          {
            ...question,
            question: { ...question.question, linkedRecheckQuestionId: recheck.question.id },
          },
          recheck,
        ],
      }).success,
    ).toBe(true);
  });
  it("keeps V6 navigation evidence honest while older reports reject navigation events", () => {
    const id = randomUUID();
    const report = {
      schemaVersion: 6,
      sessionId: randomUUID(),
      artifactType: "presentation",
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: "Skipped checkpoint",
      status: "finished",
      trustMode: "learning",
      participantCount: 0,
      responseCount: 0,
      leaderboard: [],
      evidence: [
        {
          blockId: id,
          blockIndex: 0,
          kind: "question",
          questionId: randomUUID(),
          prompt: "Question",
          questionType: "numeric",
          questionTypeLabel: "Numeric",
          delivery: "main",
          respondents: 0,
          correct: null,
          accuracyPercent: null,
          totalScore: 0,
          averageResponseMs: null,
        },
      ],
      recovery: [],
      timeline: [],
      navigation: {
        blocks: [
          { blockId: id, sectionId: null, sectionTitle: null, status: "skipped", phase: null },
        ],
        jumpCount: 0,
        returnCount: 0,
      },
      evidenceNote: "Only presented blocks carry results",
      createdAt: "2026-11-04T12:00:00.000Z",
      finishedAt: "2026-11-04T12:00:00.000Z",
    };
    expect(PresentationReportV6Schema.safeParse(report).success).toBe(true);
    expect(
      PresentationReportV6Schema.safeParse({
        ...report,
        evidence: [{ ...report.evidence[0], respondents: 1, correct: 0 }],
      }).success,
    ).toBe(false);
    expect(
      PresentationReportV6Schema.safeParse({
        ...report,
        navigation: {
          ...report.navigation,
          blocks: [...report.navigation.blocks, ...report.navigation.blocks],
        },
      }).success,
    ).toBe(false);
    const legacy = Object.fromEntries(
      Object.entries(report).filter(([key]) => key !== "navigation"),
    );
    expect(
      PresentationReportV5Schema.safeParse({
        ...legacy,
        schemaVersion: 5,
        timeline: [
          {
            sequence: 1,
            type: "navigation.jumped",
            blockIndex: 0,
            blockId: id,
            occurredAt: "2026-11-04T12:00:00.000Z",
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("validates scoped stable-target commands and unique progress", () => {
    const shared = { sessionId: randomUUID(), commandId: randomUUID(), expectedRevision: 4 };
    expect(
      PresentationCommandSchema.parse({
        ...shared,
        controlToken: "a".repeat(32),
        action: "jump_to_block",
        targetBlockId: randomUUID(),
      }).action,
    ).toBe("jump_to_block");
    expect(
      PresentationCompanionCommandSchema.parse({
        ...shared,
        companionToken: "b".repeat(32),
        action: "return_to_path",
      }).action,
    ).toBe("return_to_path");
    expect(
      PresentationCommandSchema.safeParse({
        ...shared,
        controlToken: "a".repeat(32),
        action: "return_to_path",
        targetBlockId: randomUUID(),
      }).success,
    ).toBe(false);
    const progress = {
      blockId: randomUUID(),
      phase: "content",
      questionOpenedAt: null,
      questionClosesAt: null,
    };
    expect(
      PresentationNavigationStateSchema.safeParse({
        returnBlockId: null,
        blocks: [progress, { ...progress, blockId: progress.blockId.toUpperCase() }],
      }).success,
    ).toBe(false);
  });
});
