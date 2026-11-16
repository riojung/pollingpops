import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  QuestionDraftSchema,
  type QuestionDraft,
} from "@openround/contracts";
import type { PresentationSessionRecord, PresentationSessionResponseRecord } from "@openround/db";
import {
  presentationResponseCorrect,
  presentationResponseRequestHash,
  presentationResponseScore,
  presentationResponseTiming,
  presentationResponseValidationMessage,
} from "../src/presentation-session-response-policy.js";
import {
  buildPresentationHostSnapshot,
  buildPresentationStageSnapshot,
  buildPresentationCompanionSnapshot,
  buildPresentationParticipantSnapshot,
  buildPresentationProjectionData,
  buildTargetedPresentationParticipantSnapshot,
  presentationParticipantBlock,
} from "../src/presentation-session-projections.js";
import { generatePresentationReport } from "../src/presentation-reporting.js";
import { designSceneBlock } from "./support/presentation-native-scene.js";

const correctChoiceId = randomUUID();
const alternateChoiceId = randomUUID();

function choiceQuestion(
  overrides: Partial<QuestionDraft> = {},
): Extract<QuestionDraft, { type: "single_select" | "true_false" | "multi_select" | "poll" }> {
  return QuestionDraftSchema.parse({
    id: randomUUID(),
    type: "single_select",
    prompt: "Choose the correct option",
    purpose: "diagnostic",
    confidence: "optional",
    delivery: "main",
    conceptKeys: ["response-policy"],
    linkedRecheckQuestionId: null,
    choices: [
      { id: correctChoiceId, label: "Correct", isCorrect: true },
      { id: alternateChoiceId, label: "Alternate", isCorrect: false },
    ],
    timeLimitSeconds: 60,
    basePoints: 1_000,
    explanation: "Because it is correct.",
    mediaId: null,
    mediaAlt: null,
    ...overrides,
  }) as Extract<QuestionDraft, { type: "single_select" | "true_false" | "multi_select" | "poll" }>;
}

function sessionFor(question: QuestionDraft, timeMode: "timed" | "flex") {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const content = PresentationContentSchema.parse({
    title: "Response policy",
    schemaVersion: 2,
    blocks: [{ id: randomUUID(), kind: "question", question }],
  });
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: content.title,
    content,
    code: "1234567",
    status: "active",
    phase: "question_open",
    currentBlockIndex: 0,
    revision: 1,
    settings: { timeMode },
    trustMode: "learning",
    eventSeq: 1,
    questionOpenedAt: now,
    questionClosesAt: new Date(now.getTime() + 60_000),
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 3_600_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  } satisfies PresentationSessionRecord;
}

describe("Presentation response policy", () => {
  it("carries only explicit frozen motion design to inherited question projections and preserves static omission", () => {
    for (const motionBackground of ["mesh", undefined] as const) {
      const session = sessionFor(choiceQuestion(), "timed");
      const slide = designSceneBlock();
      session.content = PresentationContentSchema.parse({
        ...session.content,
        schemaVersion: 17,
        blocks: [
          {
            ...slide,
            scene: {
              ...slide.scene,
              schemaVersion: 8,
              design: { ...slide.scene.design, ...(motionBackground ? { motionBackground } : {}) },
            },
          },
          ...session.content.blocks,
        ],
      });
      session.currentBlockIndex = 1;
      const data = buildPresentationProjectionData(session, [], []);
      const participant = presentationParticipantBlock(session.content.blocks[1]!, session);
      const host = buildPresentationHostSnapshot(session, data);
      const stage = buildPresentationStageSnapshot(session, data);
      const companion = buildPresentationCompanionSnapshot(session, data);
      const expected = {
        theme: "midnight",
        font: "serif",
        spacing: "relaxed",
        ...(motionBackground ? { motionBackground } : {}),
      };
      for (const block of [
        participant,
        host.currentBlock,
        stage.currentBlock,
        companion.currentBlock,
      ]) {
        expect(block?.design).toEqual(expected);
        expect(JSON.stringify(block)).not.toContain("PRIVATE");
        if (!motionBackground) expect(block?.design).not.toHaveProperty("motionBackground");
      }
    }
  });

  it("retains the legacy single-poll payload validation behavior", () => {
    const question = choiceQuestion({
      type: "poll",
      purpose: "opinion",
      confidence: "off",
      basePoints: 0,
      choices: [
        { id: correctChoiceId, label: "One", isCorrect: false },
        { id: alternateChoiceId, label: "Two", isCorrect: false },
      ],
    });
    for (const poll of [question, { ...question, maxSelections: 1 }]) {
      expect(
        presentationResponseValidationMessage(poll, {
          choiceIds: [correctChoiceId],
          numericValue: "12",
          ratingValue: 3,
        }),
      ).toBeNull();
    }
  });

  it.each(["poll", "rating"] as const)(
    "preserves legacy %s response result projections",
    (type) => {
      const poll = choiceQuestion({
        type: "poll",
        purpose: "opinion",
        confidence: "off",
        basePoints: 0,
        choices: [
          { id: correctChoiceId, label: "One", isCorrect: false },
          { id: alternateChoiceId, label: "Two", isCorrect: false },
        ],
      });
      const question =
        type === "poll"
          ? poll
          : QuestionDraftSchema.parse({
              ...poll,
              type: "rating",
              min: 1,
              max: 5,
              minLabel: "Low",
              maxLabel: "High",
            });
      const initial = sessionFor(question, "flex");
      const participant = {
        id: randomUUID(),
        workspaceId: initial.workspaceId,
        sessionId: initial.id,
        nickname: "Legacy opinion",
        tokenHash: "legacy-opinion",
        joinedAt: initial.createdAt,
        lastSeenAt: initial.createdAt,
      };
      const response: PresentationSessionResponseRecord = {
        id: randomUUID(),
        workspaceId: initial.workspaceId,
        sessionId: initial.id,
        participantId: participant.id,
        blockId: initial.content.blocks[0]!.id,
        questionId: question.id,
        response: type === "poll" ? { choiceIds: [correctChoiceId] } : { ratingValue: 3 },
        responseSchemaVersion: 1,
        correct: null,
        score: 0,
        responseMs: 0,
        submittedAt: initial.createdAt,
      };
      for (const phase of ["question_reveal", "intervention", "finished"] as const) {
        const session = {
          ...initial,
          phase,
          status: phase === "finished" ? ("finished" as const) : ("active" as const),
          finishedAt: phase === "finished" ? initial.updatedAt : null,
        };
        const full = buildPresentationParticipantSnapshot(
          session,
          participant.id,
          buildPresentationProjectionData(session, [participant], [response]),
        );
        const targeted = buildTargetedPresentationParticipantSnapshot(
          session,
          participant.id,
          { participantCount: 1, currentResponse: response, standing: null },
          response,
        );
        for (const snapshot of [full, targeted])
          expect(snapshot.responseResult).toEqual({ correct: null, score: 0 });
      }
    },
  );

  it.each([2, 8, 9] as const)(
    "preserves frozen legacy diagnostic semantics for purpose opinion in v%s",
    (schemaVersion) => {
      const answerId = "11111111-1111-4111-8111-111111111111";
      const legacyChoice = choiceQuestion({
        purpose: "opinion",
        confidence: "required",
        basePoints: 1_000,
        choices: [
          { id: answerId, label: "Expected answer", isCorrect: true },
          { id: alternateChoiceId, label: "Other answer", isCorrect: false },
        ],
      });
      const legacyNumeric = QuestionDraftSchema.parse({
        id: randomUUID(),
        type: "numeric",
        prompt: "Enter ten",
        purpose: "opinion",
        confidence: "required",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        correctValue: "10",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 60,
        basePoints: 1_000,
        explanation: "Ten is correct",
        mediaId: null,
        mediaAlt: null,
      });
      const ranking = QuestionDraftSchema.parse({
        ...legacyChoice,
        id: randomUUID(),
        type: "ranking",
        confidence: "off",
        basePoints: 0,
        choices: [
          { id: randomUUID(), label: "First", isCorrect: false },
          { id: randomUUID(), label: "Second", isCorrect: false },
        ],
      });
      const content = PresentationContentSchema.parse({
        title: "Frozen legacy opinions",
        schemaVersion,
        blocks: [legacyChoice, legacyNumeric, ...(schemaVersion === 9 ? [ranking] : [])].map(
          (question) => ({ id: randomUUID(), kind: "question", question }),
        ),
      });
      const frozenJson = JSON.stringify(content);
      const session = {
        ...sessionFor(legacyChoice, "flex"),
        content,
        phase: "question_reveal" as const,
      };
      const participant = {
        id: randomUUID(),
        workspaceId: session.workspaceId,
        sessionId: session.id,
        nickname: "Legacy",
        tokenHash: "legacy-token",
        joinedAt: session.createdAt,
        lastSeenAt: session.createdAt,
      };
      const payloads = [
        { choiceIds: [answerId], confidence: 2 as const },
        { numericValue: "10.0", confidence: 2 as const },
      ];
      const responses: PresentationSessionResponseRecord[] = [legacyChoice, legacyNumeric].map(
        (question, index) => {
          const response = payloads[index]!;
          expect(
            presentationResponseValidationMessage(
              question,
              index ? { numericValue: "10.0" } : { choiceIds: [answerId] },
            ),
          ).toBe("Choose a confidence level before submitting");
          expect(presentationResponseValidationMessage(question, response)).toBeNull();
          expect(presentationResponseCorrect(question, response)).toBe(true);
          expect(presentationResponseScore(question, true, 1)).toBe(1_000);
          expect(presentationParticipantBlock(content.blocks[index]!)).toMatchObject({
            question: { confidence: "required" },
          });
          return {
            id: randomUUID(),
            workspaceId: session.workspaceId,
            sessionId: session.id,
            participantId: participant.id,
            blockId: content.blocks[index]!.id,
            questionId: question.id,
            response,
            responseSchemaVersion: 1,
            correct: true,
            score: 1_000,
            responseMs: 0,
            submittedAt: session.createdAt,
            idempotencyKey: `legacy-${index}`,
            requestHash: "a".repeat(64),
          };
        },
      );
      const data = buildPresentationProjectionData(session, [participant], responses);
      const host = buildPresentationHostSnapshot(session, data);
      expect(host.currentBlock).toMatchObject({
        question: { confidence: "required", basePoints: 1_000 },
        revealedAnswer: { kind: "choice", correctChoiceIds: [answerId] },
      });
      expect(
        buildPresentationHostSnapshot({ ...session, currentBlockIndex: 1 }, data).currentBlock,
      ).toMatchObject({
        question: { type: "numeric", confidence: "required", basePoints: 1_000 },
        revealedAnswer: { kind: "numeric", correctValue: "10" },
      });
      // The existing competition-purpose exclusion remains separate from legacy response scoring.
      expect(host.competitionStandings).toMatchObject({ status: "unscored", entries: [] });
      expect(buildPresentationParticipantSnapshot(session, participant.id, data)).toMatchObject({
        responseSubmitted: true,
        standing: { rank: 1, score: 2_000 },
        responseResult: { correct: true, score: 1_000 },
      });
      const report = generatePresentationReport({
        session: {
          ...session,
          status: "finished",
          phase: "finished",
          finishedAt: session.updatedAt,
        },
        participants: [participant],
        responses,
        timeline: [],
      });
      expect(report.schemaVersion).toBe(schemaVersion === 9 ? 4 : 1);
      expect(report.leaderboard).toMatchObject([{ score: 2_000 }]);
      expect(report.evidence.slice(0, 2)).toMatchObject([
        { correct: 1, accuracyPercent: 100, totalScore: 1_000 },
        { correct: 1, accuracyPercent: 100, totalScore: 1_000 },
      ]);
      expect(JSON.stringify(content)).toBe(frozenJson);
      expect(
        presentationResponseRequestHash({
          blockId: "block-1",
          expectedRevision: 4,
          response: payloads[0]!,
        }),
      ).toBe("c6d83d442a37a3786cefc1a3c85b3c2e7cae8fa846e7996c8e50cf4b4220fbdc");
      expect(
        presentationResponseRequestHash({
          blockId: "block-1",
          expectedRevision: 4,
          response: payloads[1]!,
        }),
      ).toBe("404b6cf5c3c7cbdf2f58aa2ab112b8e36db724e08589f7f23baeb9d9c64ad724");
    },
  );

  it.each(["open_text", "word_cloud"] as const)(
    "requires an exclusive text response for %s and exposes only its public prompt",
    (type) => {
      const common: Record<string, unknown> = { ...choiceQuestion() };
      delete common.choices;
      const question = QuestionDraftSchema.parse({
        ...common,
        type,
        purpose: "opinion",
        confidence: "off",
        basePoints: 0,
        conceptKeys: [],
        linkedRecheckQuestionId: null,
      });
      const response = { choiceIds: [correctChoiceId] };
      expect(presentationResponseValidationMessage(question, response)).toBe(
        "Enter a valid text response",
      );
      expect(presentationResponseCorrect(question, response)).toBeNull();
      expect(presentationResponseScore(question, true, 1)).toBe(0);
      expect(
        presentationParticipantBlock({ id: randomUUID(), kind: "question", question }),
      ).toMatchObject({
        question: { type, confidence: "off", prompt: question.prompt },
      });
    },
  );
  it("canonicalizes multi-select choice order without weakening the revision or payload fence", () => {
    const first = presentationResponseRequestHash({
      blockId: "block-1",
      expectedRevision: 4,
      response: { choiceIds: [correctChoiceId, alternateChoiceId], confidence: 2 },
    });
    const reordered = presentationResponseRequestHash({
      blockId: "block-1",
      expectedRevision: 4,
      response: { choiceIds: [alternateChoiceId, correctChoiceId], confidence: 2 },
    });

    expect(reordered).toBe(first);
    expect(
      presentationResponseRequestHash({
        blockId: "block-1",
        expectedRevision: 5,
        response: { choiceIds: [correctChoiceId, alternateChoiceId], confidence: 2 },
      }),
    ).not.toBe(first);
    expect(
      presentationResponseRequestHash({
        blockId: "block-1",
        expectedRevision: 4,
        response: { choiceIds: [correctChoiceId, alternateChoiceId], confidence: 3 },
      }),
    ).not.toBe(first);
  });

  it("preserves participant-facing validation for confidence, choice, numeric, and rating input", () => {
    expect(
      presentationResponseValidationMessage(choiceQuestion({ confidence: "required" }), {
        choiceIds: [correctChoiceId],
      }),
    ).toBe("Choose a confidence level before submitting");
    expect(presentationResponseValidationMessage(choiceQuestion(), { choiceIds: [] })).toBe(
      "Choose a valid response option",
    );
    expect(
      presentationResponseValidationMessage(choiceQuestion(), {
        choiceIds: [correctChoiceId, alternateChoiceId],
      }),
    ).toBe("Choose one response option");

    const numeric = QuestionDraftSchema.parse({
      id: randomUUID(),
      type: "numeric",
      prompt: "Enter a value",
      purpose: "diagnostic",
      confidence: "optional",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      correctValue: "10",
      tolerance: "0.5",
      unit: null,
      timeLimitSeconds: 60,
      basePoints: 1_000,
      explanation: "Ten is expected.",
      mediaId: null,
      mediaAlt: null,
    });
    expect(presentationResponseValidationMessage(numeric, { numericValue: " " })).toBe(
      "Enter a valid numeric response",
    );
    expect(presentationResponseValidationMessage(numeric, { numericValue: "10.25" })).toBeNull();

    const rating = QuestionDraftSchema.parse({
      id: randomUUID(),
      type: "rating",
      prompt: "Rate this",
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      min: 1,
      max: 5,
      minLabel: "Low",
      maxLabel: "High",
      timeLimitSeconds: 60,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    });
    expect(presentationResponseValidationMessage(rating, { ratingValue: 6 })).toBe(
      "Choose a rating from 1 to 5",
    );
    expect(presentationResponseValidationMessage(rating, { ratingValue: 5 })).toBeNull();
  });

  it("keeps exact-set and numeric-tolerance correctness semantics", () => {
    const multiSelect = choiceQuestion({
      type: "multi_select",
      choices: [
        { id: correctChoiceId, label: "Correct A", isCorrect: true },
        { id: alternateChoiceId, label: "Correct B", isCorrect: true },
      ],
    });
    expect(
      presentationResponseCorrect(multiSelect, {
        choiceIds: [alternateChoiceId, correctChoiceId],
      }),
    ).toBe(true);
    expect(presentationResponseCorrect(multiSelect, { choiceIds: [correctChoiceId] })).toBe(false);

    const numeric = QuestionDraftSchema.parse({
      id: randomUUID(),
      type: "numeric",
      prompt: "Enter a value",
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      correctValue: "10",
      tolerance: "0.5",
      unit: null,
      timeLimitSeconds: 60,
      basePoints: 1_000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    });
    expect(presentationResponseCorrect(numeric, { numericValue: "10.5" })).toBe(true);
    expect(presentationResponseCorrect(numeric, { numericValue: "10.51" })).toBe(false);
  });

  it("freezes receipt-time scoring while disabling speed scoring in flex mode", () => {
    const question = choiceQuestion();
    const timed = sessionFor(question, "timed");
    const receivedAt = new Date(timed.questionOpenedAt!.getTime() + 15_000);
    const timedResult = presentationResponseTiming(timed, receivedAt);
    const flexResult = presentationResponseTiming(
      { ...timed, settings: { timeMode: "flex" } },
      receivedAt,
    );

    expect(timedResult).toEqual({ responseMs: 15_000, remainingRatio: 0.75 });
    expect(presentationResponseScore(question, true, timedResult.remainingRatio)).toBe(875);
    expect(flexResult).toEqual({ responseMs: 15_000, remainingRatio: 1 });
    expect(presentationResponseScore(question, true, flexResult.remainingRatio)).toBe(1_000);
    expect(presentationResponseScore(question, false, flexResult.remainingRatio)).toBe(0);
    expect(
      presentationResponseTiming(
        { ...timed, settings: { timeMode: "flex" }, questionClosesAt: null },
        new Date(timed.questionOpenedAt!.getTime() + 90_000),
      ),
    ).toEqual({ responseMs: 90_000, remainingRatio: 1 });
  });

  it("clamps timing at both boundaries and keeps the missing-open fallback", () => {
    const question = choiceQuestion();
    const session = sessionFor(question, "timed");

    expect(
      presentationResponseTiming(session, new Date(session.questionOpenedAt!.getTime() - 1_000)),
    ).toEqual({ responseMs: 0, remainingRatio: 1 });
    expect(
      presentationResponseTiming(session, new Date(session.questionOpenedAt!.getTime() + 90_000)),
    ).toEqual({ responseMs: 60_000, remainingRatio: 0 });
    expect(presentationResponseTiming({ ...session, questionOpenedAt: null }, new Date())).toEqual({
      responseMs: 60_000,
      remainingRatio: 0,
    });
  });
});
