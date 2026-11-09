import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  preparePresentationPublication,
  type PresentationSceneDesign,
} from "@openround/contracts";
import type {
  PresentationParticipantSnapshotProjection,
  PresentationSessionParticipantRecord,
  PresentationSessionRecord,
  PresentationSessionResponseRecord,
  PresentationSessionTimelineRecord,
} from "@openround/db";
import {
  buildPresentationCompanionSnapshot,
  buildPresentationHostSnapshot,
  buildPresentationListSnapshot,
  buildPresentationParticipantSnapshot,
  buildPresentationProjectionData,
  buildPresentationStageSnapshot,
  buildTargetedPresentationParticipantSnapshot,
  presentationAcceptingResponses,
  presentationParticipantBlock,
} from "../src/presentation-session-projections.js";
import { designSceneBlock } from "./support/presentation-native-scene.js";

const NOW = new Date("2026-09-24T18:00:30.000Z");

function themedSceneBlock(theme: PresentationSceneDesign["theme"]) {
  const block = designSceneBlock();
  return { ...block, scene: { ...block.scene, design: { ...block.scene.design, theme } } };
}

afterEach(() => {
  vi.useRealTimers();
});

it("keeps text geometry in the same role-safe live content block", () => {
  const content = PresentationContentSchema.parse({
    title: "Slide layout",
    description: "",
    schemaVersion: 2,
    blocks: [
      {
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        textElements: [
          {
            id: "title-element",
            role: "title",
            text: "Audience takeaway",
            region: "top_right",
            order: 0,
            frame: { x: 60, y: 10, width: 32, height: 20 },
          },
          {
            id: "body-element",
            role: "body",
            text: "Review the evidence.",
            region: "bottom_left",
            order: 0,
            frame: { x: 8, y: 70, width: 40, height: 22 },
          },
        ],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "Facilitator-only cue",
        citations: [{ locator: "Private page", excerpt: "Private excerpt" }],
      },
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: randomUUID(),
          type: "single_select",
          prompt: "Which point is supported?",
          choices: [
            { id: randomUUID(), label: "The evidence", isCorrect: true },
            { id: randomUUID(), label: "The assumption", isCorrect: false },
          ],
          purpose: "diagnostic",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "The evidence supports this point.",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  });
  const projected = presentationParticipantBlock(content.blocks[0]!);

  expect(projected).toMatchObject({
    kind: "content",
    textElements: [
      {
        id: "title-element",
        role: "title",
        region: "top_right",
        order: 0,
        frame: { x: 60, y: 10, width: 32, height: 20 },
      },
      {
        id: "body-element",
        role: "body",
        region: "bottom_left",
        order: 0,
        frame: { x: 8, y: 70, width: 40, height: 22 },
      },
    ],
  });
  expect(JSON.stringify(projected)).not.toContain("Facilitator-only cue");
  expect(JSON.stringify(projected)).not.toContain("Private excerpt");
});

function fixture() {
  const workspaceId = randomUUID();
  const sessionId = randomUUID();
  const presentationId = randomUUID();
  const presentationVersionId = randomUUID();
  const blockId = randomUUID();
  const questionId = randomUUID();
  const correctChoiceId = randomUUID();
  const distractorChoiceId = randomUUID();
  const participantId = randomUUID();
  const secondParticipantId = randomUUID();
  const thirdParticipantId = randomUUID();
  const content = PresentationContentSchema.parse({
    title: "Projection boundaries",
    description: "Role-safe Presentation snapshots",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    sourceDisclosure: {
      sourceName: "private source disclosure",
      sourceDigest: "a".repeat(64),
      provider: "private provider",
      model: "private model",
    },
    blocks: [
      {
        id: blockId,
        kind: "question",
        citations: [{ locator: "private locator", excerpt: "private block citation" }],
        question: {
          id: questionId,
          type: "single_select",
          prompt: "Which projection is safe?",
          purpose: "diagnostic",
          confidence: "optional",
          delivery: "main",
          conceptKeys: ["projection-safety"],
          linkedRecheckQuestionId: null,
          choices: [
            {
              id: correctChoiceId,
              label: "The allowlisted projection",
              isCorrect: true,
              feedback: "private correct feedback",
            },
            {
              id: distractorChoiceId,
              label: "The authoring record",
              isCorrect: false,
              misconceptionKey: "private-misconception",
            },
          ],
          timeLimitSeconds: 60,
          basePoints: 1_000,
          explanation: "private answer explanation",
          mediaId: null,
          mediaAlt: null,
          sourceCitations: [
            {
              sourceName: "private question source",
              sourceDigest: "b".repeat(64),
              locator: "private question locator",
              excerpt: "private question citation",
            },
          ],
        },
      },
    ],
  });
  const session: PresentationSessionRecord = {
    id: sessionId,
    workspaceId,
    presentationId,
    presentationVersionId,
    title: content.title,
    content,
    code: "1234567",
    status: "active",
    phase: "question_open",
    currentBlockIndex: 0,
    revision: 2,
    settings: { timeMode: "timed" },
    trustMode: "learning",
    eventSeq: 3,
    questionOpenedAt: new Date("2026-09-24T18:00:00.000Z"),
    questionClosesAt: new Date("2026-09-24T18:01:00.000Z"),
    createdBy: randomUUID(),
    createdAt: new Date("2026-09-24T17:59:00.000Z"),
    updatedAt: new Date("2026-09-24T18:00:00.000Z"),
    finishedAt: null,
    liveExpiresAt: new Date("2026-09-25T18:00:00.000Z"),
    retentionExpiresAt: new Date("2026-10-24T18:00:00.000Z"),
  };
  const participants: PresentationSessionParticipantRecord[] = [
    {
      id: participantId,
      workspaceId,
      sessionId,
      nickname: "River",
      tokenHash: "river-token-hash",
      joinedAt: new Date("2026-09-24T17:59:10.000Z"),
      lastSeenAt: new Date(NOW.getTime() - 15_000),
    },
    {
      id: secondParticipantId,
      workspaceId,
      sessionId,
      nickname: "Sky",
      tokenHash: "sky-token-hash",
      joinedAt: new Date("2026-09-24T17:59:20.000Z"),
      lastSeenAt: new Date(NOW.getTime() - 15_001),
    },
    {
      id: thirdParticipantId,
      workspaceId,
      sessionId,
      nickname: "Oak",
      tokenHash: "oak-token-hash",
      joinedAt: new Date("2026-09-24T17:59:30.000Z"),
      lastSeenAt: new Date(NOW.getTime() - 60_000),
    },
  ];
  const previousResponse: PresentationSessionResponseRecord = {
    id: randomUUID(),
    workspaceId,
    sessionId,
    participantId,
    blockId: randomUUID(),
    questionId: randomUUID(),
    response: { choiceIds: [correctChoiceId], confidence: 2 },
    correct: true,
    score: 200,
    responseMs: 10_000,
    submittedAt: new Date("2026-09-24T17:59:50.000Z"),
    idempotencyKey: "previous-response",
    requestHash: "previous-request",
  };
  const currentResponse: PresentationSessionResponseRecord = {
    id: randomUUID(),
    workspaceId,
    sessionId,
    participantId,
    blockId,
    questionId,
    response: { choiceIds: [correctChoiceId], confidence: 3 },
    correct: true,
    score: 1_000,
    responseMs: 30_000,
    submittedAt: new Date("2026-09-24T18:00:20.000Z"),
    idempotencyKey: "current-response",
    requestHash: "current-request",
  };
  return {
    session,
    participants,
    previousResponse,
    currentResponse,
    ids: { participantId, thirdParticipantId, correctChoiceId },
  };
}

describe("Presentation session projections", () => {
  it("copies nearby frozen scene tokens to every live activity projection without private data", () => {
    const { session, participants, ids } = fixture();
    const activity = session.content.blocks[0]!;
    const native = themedSceneBlock("sunset");
    const draft = PresentationDraftSchema.parse({
      ...session.content,
      schemaVersion: 7,
      blocks: [native, activity],
    });
    const publication = PresentationContentSchema.parse(preparePresentationPublication(draft));
    const frozenSession = {
      ...session,
      content: structuredClone(publication),
      currentBlockIndex: 1,
    };
    const data = buildPresentationProjectionData(frozenSession, participants, []);
    const host = buildPresentationHostSnapshot(frozenSession, data);
    const stage = buildPresentationStageSnapshot(frozenSession, data);
    const participant = buildPresentationParticipantSnapshot(
      frozenSession,
      ids.participantId,
      data,
    );
    const companion = buildPresentationCompanionSnapshot(frozenSession, data);
    const list = buildPresentationListSnapshot(frozenSession, participants, []);
    const legacy = presentationParticipantBlock(frozenSession.content.blocks[1]!, frozenSession);
    const next = buildPresentationHostSnapshot(
      { ...frozenSession, phase: "content", currentBlockIndex: 0 },
      data,
    ).presenter?.nextBlock;
    const design = { theme: "sunset", font: "serif", spacing: "relaxed" };
    for (const block of [
      host.currentBlock,
      stage.currentBlock,
      participant.currentBlock,
      companion.currentBlock,
      list.currentBlock,
      legacy,
      next,
    ]) {
      expect(block).toMatchObject({ kind: "question", design });
      expect(Object.keys(block?.design ?? {}).sort()).toEqual(["font", "spacing", "theme"]);
      const serialized = JSON.stringify(block);
      for (const privateField of [
        "isCorrect",
        "correctChoiceIds",
        "sourceCitations",
        "citations",
        "speakerNotes",
        "sourceDisclosure",
      ])
        expect(serialized).not.toContain(`"${privateField}"`);
      expect(serialized).not.toContain("private answer explanation");
      expect(serialized).not.toContain("PRIVATE native speaker note");
    }
    const frozenScene = frozenSession.content.blocks[0];
    if (frozenScene?.kind !== "content") throw new Error("Expected native content");
    expect(host.currentBlock?.design).not.toBe(frozenScene.scene?.design);
    for (const authored of [draft, publication]) {
      const block = authored.blocks[0];
      if (block?.kind !== "content" || !block.scene?.design)
        throw new Error("Expected explicit native design");
      block.scene.design.theme = "ocean";
    }
    expect(buildPresentationHostSnapshot(frozenSession, data).currentBlock?.design).toEqual(design);
    expect(buildPresentationStageSnapshot(frozenSession, data).currentBlock?.design).toEqual(
      design,
    );
    const revealed = buildPresentationStageSnapshot(
      { ...frozenSession, phase: "question_reveal", questionClosesAt: null },
      data,
    );
    expect(revealed.revealedAnswer).toMatchObject({ kind: "choice" });
    expect(revealed.currentBlock?.design).toEqual(design);
  });

  it("uses each visible block's nearest explicit design, with following and legacy fallbacks", () => {
    const { session, participants } = fixture();
    const activity = session.content.blocks[0]!;
    if (activity.kind !== "question" || !("choices" in activity.question))
      throw new Error("Expected choice question fixture");
    const question = activity.question;
    const duplicateActivity = () => ({
      ...activity,
      id: randomUUID(),
      question: {
        ...question,
        id: randomUUID(),
        choices: question.choices.map((choice) => ({ ...choice, id: randomUUID() })),
      },
    });
    const sunset = themedSceneBlock("sunset");
    const midnight = designSceneBlock();
    const hidden = { ...themedSceneBlock("ocean"), hidden: true as const };
    const legacyContent = {
      id: randomUUID(),
      kind: "content",
      layout: "title",
      textElements: [
        { id: "title", role: "title", text: "Imported text", region: "top_center", order: 0 },
      ],
      mediaId: null,
      mediaAlt: null,
      speakerNotes: "Private imported cue",
      citations: [{ locator: "Private imported locator", excerpt: "Private imported excerpt" }],
    };
    const draft = PresentationDraftSchema.parse({
      ...session.content,
      schemaVersion: 7,
      blocks: [
        duplicateActivity(),
        sunset,
        hidden,
        legacyContent,
        activity,
        midnight,
        duplicateActivity(),
      ],
    });
    const content = PresentationContentSchema.parse(preparePresentationPublication(draft));
    expect(content.blocks).toHaveLength(6);
    expect(content.blocks.some(({ id }) => id === hidden.id)).toBe(false);
    const themedSession = { ...session, content };
    for (const [index, theme] of [
      [0, "sunset"],
      [1, "sunset"],
      [2, "sunset"],
      [3, "sunset"],
      [4, "midnight"],
      [5, "midnight"],
    ] as const) {
      const current = { ...themedSession, currentBlockIndex: index };
      const data = buildPresentationProjectionData(current, participants, []);
      const projected = presentationParticipantBlock(content.blocks[index]!, current);
      expect(projected?.design?.theme).toBe(theme);
      expect(buildPresentationHostSnapshot(current, data).currentBlock?.design?.theme).toBe(theme);
      if (projected?.kind === "content") {
        expect(JSON.stringify(projected)).not.toContain("Private imported");
        expect(projected).not.toHaveProperty("speakerNotes");
        expect(projected).not.toHaveProperty("citations");
      }
    }
    const oldSession = {
      ...session,
      content: PresentationContentSchema.parse({
        ...session.content,
        blocks: [legacyContent, activity],
      }),
    };
    for (const block of oldSession.content.blocks)
      expect(presentationParticipantBlock(block, oldSession)).not.toHaveProperty("design");
  });

  it("keeps content-only rosters without inventing standings or an assessment dashboard", () => {
    const { session, participants, currentResponse, ids } = fixture();
    const slideId = randomUUID();
    const content = PresentationContentSchema.parse({
      ...session.content,
      blocks: [
        {
          id: slideId,
          kind: "content",
          layout: "title",
          textElements: [
            {
              id: "title",
              role: "title",
              text: "A project update",
              region: "top_center",
              order: 0,
            },
          ],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "Private cue",
        },
      ],
    });
    for (const phase of ["lobby", "content", "finished"] as const) {
      const contentSession: PresentationSessionRecord = {
        ...session,
        content,
        phase,
        status: phase === "finished" ? "finished" : "active",
        currentBlockIndex: phase === "lobby" ? -1 : 0,
        questionOpenedAt: null,
        questionClosesAt: null,
        finishedAt: phase === "finished" ? NOW : null,
      };
      const data = buildPresentationProjectionData(contentSession, participants, []);
      const host = buildPresentationHostSnapshot(contentSession, data);
      expect(host.participants).toHaveLength(participants.length);
      expect(host.participantCount).toBe(participants.length);
      expect(host).not.toHaveProperty("competitionStandings");
      const listed = buildPresentationListSnapshot(contentSession, participants, []);
      expect(listed).toMatchObject({
        participants: participants.map(({ id }) => ({ id })),
      });
      expect(listed.leaderboard).toEqual(listed.participants);
      expect(
        buildPresentationParticipantSnapshot(contentSession, ids.participantId, data),
      ).toMatchObject({ standing: null, responseResult: null, responseSubmitted: false });
      expect(buildPresentationCompanionSnapshot(contentSession, data)).toMatchObject({
        resultSummary: null,
        questionOpenedAt: null,
        questionClosesAt: null,
      });
      expect(
        buildTargetedPresentationParticipantSnapshot(
          contentSession,
          ids.participantId,
          {
            participantCount: participants.length,
            currentResponse: null,
            standing: { rank: 1, score: 200 },
          },
          currentResponse,
        ).standing,
      ).toBeNull();
    }
  });

  it("retains an unscored poll dashboard when nobody has responded", () => {
    const { session, participants } = fixture();
    const block = session.content.blocks[0]!;
    if (block.kind !== "question" || !("choices" in block.question))
      throw new Error("Choice fixture required");
    const content = PresentationContentSchema.parse({
      ...session.content,
      blocks: [
        {
          ...block,
          question: {
            ...block.question,
            type: "poll",
            purpose: "opinion",
            confidence: "off",
            basePoints: 0,
            choices: block.question.choices.map(({ id, label }) => ({
              id,
              label,
              isCorrect: false,
            })),
          },
        },
      ],
    });
    const pollSession = { ...session, content };
    expect(
      buildPresentationHostSnapshot(
        pollSession,
        buildPresentationProjectionData(pollSession, participants, []),
      ),
    ).toMatchObject({
      competitionStandings: {
        status: "unscored",
        entries: [],
        totalParticipants: participants.length,
      },
    });
  });

  it("shows only current-question choice aggregates after reveal with zero defaults", () => {
    const { session, participants, currentResponse, previousResponse } = fixture();
    const data = buildPresentationProjectionData(session, participants, [
      currentResponse,
      previousResponse,
    ]);
    expect(buildPresentationCompanionSnapshot(session, data).resultSummary).toBeNull();
    const block = session.content.blocks[0]!;
    if (block.kind !== "question" || !("choices" in block.question))
      throw new Error("Choice fixture required");
    for (const phase of ["question_reveal", "intervention", "finished"] as const) {
      const revealed = {
        ...session,
        phase,
        status: phase === "finished" ? ("finished" as const) : ("active" as const),
        finishedAt: phase === "finished" ? NOW : null,
        questionClosesAt: null,
      };
      expect(buildPresentationCompanionSnapshot(revealed, data).resultSummary).toEqual({
        blockId: block.id,
        responseCount: 1,
        choiceCounts: block.question.choices.map(({ id }) => ({
          choiceId: id,
          count: id === currentResponse.response.choiceIds?.[0] ? 1 : 0,
        })),
      });
      expect(
        buildPresentationCompanionSnapshot(
          revealed,
          buildPresentationProjectionData(revealed, participants, []),
        ).resultSummary,
      ).toEqual({
        blockId: block.id,
        responseCount: 0,
        choiceCounts: block.question.choices.map(({ id }) => ({ choiceId: id, count: 0 })),
      });
    }
  });

  it.each(["numeric", "rating"] as const)(
    "exposes only a response count for %s results",
    (type) => {
      const { session, participants, currentResponse } = fixture();
      const original = session.content.blocks[0]!;
      if (original.kind !== "question") throw new Error("Question fixture required");
      const question = Object.fromEntries(
        Object.entries(original.question).filter(([key]) => key !== "choices"),
      );
      const content = PresentationContentSchema.parse({
        ...session.content,
        blocks: [
          {
            ...original,
            question: {
              ...question,
              type,
              ...(type === "numeric"
                ? { correctValue: "42", tolerance: "0", unit: "private-units" }
                : {
                    min: 1,
                    max: 5,
                    minLabel: "Low",
                    maxLabel: "High",
                    purpose: "opinion",
                    confidence: "off",
                    basePoints: 0,
                  }),
            },
          },
        ],
      });
      const revealed = {
        ...session,
        content,
        phase: "question_reveal" as const,
        questionClosesAt: null,
      };
      const response = {
        ...currentResponse,
        response: type === "numeric" ? { numericValue: "42" } : { ratingValue: 5 },
      };
      const snapshot = buildPresentationCompanionSnapshot(
        revealed,
        buildPresentationProjectionData(revealed, participants, [response]),
      );
      expect(snapshot.resultSummary).toEqual({
        blockId: original.id,
        responseCount: 1,
        choiceCounts: [],
      });
      for (const key of [
        "numericValue",
        "ratingValue",
        "correctValue",
        "correct",
        "score",
        "responseMs",
        "revealedAnswer",
      ])
        expect(JSON.stringify(snapshot)).not.toContain(`"${key}"`);
    },
  );

  it("keeps participant and companion blocks on explicit allowlists before and after reveal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, participants, ids } = fixture();
    const data = buildPresentationProjectionData(session, participants, []);

    const openHost = buildPresentationHostSnapshot(session, data);
    const participant = buildPresentationParticipantSnapshot(session, ids.participantId, data);
    const companion = buildPresentationCompanionSnapshot(session, data);
    expect(openHost).toMatchObject({
      currentBlock: {
        kind: "question",
        question: { purpose: "diagnostic" },
        revealedAnswer: null,
      },
    });
    expect(participant.currentBlock).toMatchObject({ kind: "question" });
    expect(
      participant.currentBlock?.kind === "question"
        ? participant.currentBlock.question.choices
        : [],
    ).toEqual([
      { id: ids.correctChoiceId, label: "The allowlisted projection" },
      expect.objectContaining({ label: "The authoring record" }),
    ]);

    for (const snapshot of [participant, companion]) {
      const serialized = JSON.stringify(snapshot);
      for (const privateValue of [
        "private source disclosure",
        "private block citation",
        "private correct feedback",
        "private-misconception",
        "private answer explanation",
        "private question citation",
      ]) {
        expect(serialized).not.toContain(privateValue);
      }
      for (const privateField of [
        "purpose",
        "isCorrect",
        "feedback",
        "misconceptionKey",
        "conceptKeys",
        "explanation",
        "sourceCitations",
        "citations",
        "sourceDisclosure",
        "revealedAnswer",
      ]) {
        expect(serialized).not.toContain(`"${privateField}"`);
      }
    }

    const revealedSession: PresentationSessionRecord = {
      ...session,
      phase: "question_reveal",
      questionClosesAt: null,
    };
    const revealedData = buildPresentationProjectionData(revealedSession, participants, []);
    const revealedHost = buildPresentationHostSnapshot(revealedSession, revealedData);
    const revealedParticipant = buildPresentationParticipantSnapshot(
      revealedSession,
      ids.participantId,
      revealedData,
    );
    expect(revealedHost).toMatchObject({
      currentBlock: {
        kind: "question",
        revealedAnswer: {
          kind: "choice",
          correctChoiceIds: [ids.correctChoiceId],
          explanation: "private answer explanation",
        },
      },
    });
    expect(JSON.stringify(revealedParticipant)).not.toContain("private answer explanation");
  });

  it("hides current-question score and result until reveal while retaining the latest receipt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, participants, previousResponse, currentResponse, ids } = fixture();
    const openData = buildPresentationProjectionData(session, participants, [
      previousResponse,
      currentResponse,
    ]);
    const openHost = buildPresentationHostSnapshot(session, openData);
    const openParticipant = buildPresentationParticipantSnapshot(
      session,
      ids.participantId,
      openData,
    );

    expect(openHost.participants[0]).toMatchObject({ nickname: "River", score: 200, rank: 1 });
    expect(openParticipant).toMatchObject({
      responseSubmitted: true,
      responseReceipt: {
        responseId: currentResponse.id,
        idempotencyKey: "current-response",
      },
      standing: null,
      responseResult: null,
    });

    const revealedSession: PresentationSessionRecord = {
      ...session,
      phase: "question_reveal",
      questionClosesAt: null,
    };
    const revealedData = buildPresentationProjectionData(revealedSession, participants, [
      previousResponse,
      currentResponse,
    ]);
    const revealedHost = buildPresentationHostSnapshot(revealedSession, revealedData);
    const revealedParticipant = buildPresentationParticipantSnapshot(
      revealedSession,
      ids.participantId,
      revealedData,
    );
    expect(revealedHost.participants[0]).toMatchObject({ score: 1_200, rank: 1 });
    expect(revealedParticipant).toMatchObject({
      standing: { score: 1_200, rank: 1 },
      responseResult: { correct: true, score: 1_000 },
    });
  });

  it("uses participant ID as the final deterministic leaderboard tie-breaker", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, participants } = fixture();
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";
    const tiedParticipants = participants.slice(0, 2).map((participant, index) => ({
      ...participant,
      id: index === 0 ? secondId : firstId,
      nickname: "Same nickname",
      joinedAt: new Date("2026-09-24T17:59:10.000Z"),
    }));
    const revealedSession: PresentationSessionRecord = {
      ...session,
      phase: "question_reveal",
      questionClosesAt: null,
    };
    const data = buildPresentationProjectionData(revealedSession, tiedParticipants, []);

    expect(
      buildPresentationHostSnapshot(revealedSession, data).participants.map(({ id, rank }) => ({
        id,
        rank,
      })),
    ).toEqual([
      { id: firstId, rank: 1 },
      { id: secondId, rank: 2 },
    ]);
    expect(buildPresentationParticipantSnapshot(revealedSession, secondId, data)).toMatchObject({
      standing: { rank: 2, score: 0 },
    });
  });

  it("uses nickname before participant ID when scores and join timestamps tie", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, participants } = fixture();
    const idThatSortsFirst = "00000000-0000-4000-8000-000000000001";
    const idThatSortsLast = "00000000-0000-4000-8000-000000000002";
    const tiedParticipants = participants.slice(0, 2).map((participant, index) => ({
      ...participant,
      id: index === 0 ? idThatSortsFirst : idThatSortsLast,
      nickname: index === 0 ? "Zulu" : "Alpha",
      joinedAt: new Date("2026-09-24T17:59:10.000Z"),
    }));
    const revealedSession: PresentationSessionRecord = {
      ...session,
      phase: "question_reveal",
      questionClosesAt: null,
    };
    const data = buildPresentationProjectionData(revealedSession, tiedParticipants, []);

    expect(
      buildPresentationHostSnapshot(revealedSession, data).participants.map(
        ({ id, nickname, rank }) => ({ id, nickname, rank }),
      ),
    ).toEqual([
      { id: idThatSortsLast, nickname: "Alpha", rank: 1 },
      { id: idThatSortsFirst, nickname: "Zulu", rank: 2 },
    ]);
  });

  it("uses the inclusive heartbeat window plus socket presence only in staff room status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, participants, ids } = fixture();
    const data = buildPresentationProjectionData(session, participants, []);
    const host = buildPresentationHostSnapshot(session, data, new Set([ids.thirdParticipantId]));
    const participant = buildPresentationParticipantSnapshot(session, ids.participantId, data);

    expect(host.roomStatus).toMatchObject({
      joinedCount: 3,
      connectedCount: 2,
      notCurrentlyConnectedCount: 1,
    });
    expect(participant).not.toHaveProperty("roomStatus");
  });

  it("preserves deadline boundaries and the targeted lost-ack response override", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, currentResponse, ids } = fixture();
    const closesAt = session.questionClosesAt!;
    expect(presentationAcceptingResponses(session, closesAt)).toBe(true);
    expect(presentationAcceptingResponses(session, new Date(closesAt.getTime() + 1))).toBe(false);
    expect(
      presentationAcceptingResponses({
        ...session,
        settings: { timeMode: "flex" },
        questionClosesAt: null,
      }),
    ).toBe(true);
    expect(presentationAcceptingResponses({ ...session, phase: "question_reveal" })).toBe(false);

    const projection: PresentationParticipantSnapshotProjection = {
      participantCount: 1,
      standing: { rank: 1, score: 1_000 },
      currentResponse: null,
    };
    const open = buildTargetedPresentationParticipantSnapshot(
      session,
      ids.participantId,
      projection,
      currentResponse,
    );
    expect(open).toMatchObject({
      responseSubmitted: true,
      standing: null,
      responseResult: null,
    });

    const revealed = buildTargetedPresentationParticipantSnapshot(
      { ...session, phase: "question_reveal", questionClosesAt: null },
      ids.participantId,
      projection,
      currentResponse,
    );
    expect(revealed).toMatchObject({
      responseSubmitted: true,
      standing: { rank: 1, score: 1_000 },
      responseResult: { correct: true, score: 1_000 },
    });
  });
});

describe("Presentation competition dashboard", () => {
  function rankHistoryFixture() {
    const { session, participants, currentResponse } = fixture();
    const firstBlock = session.content.blocks[0]!;
    if (firstBlock.kind !== "question" || !("choices" in firstBlock.question))
      throw new Error("Expected choice question fixture");
    const secondBlock = {
      ...firstBlock,
      id: randomUUID(),
      question: {
        ...firstBlock.question,
        id: randomUUID(),
        choices: firstBlock.question.choices.map((choice) => ({ ...choice, id: randomUUID() })),
      },
    };
    // A delayed admission can carry a request-time joinedAt earlier than the published roster.
    const lateParticipant = {
      ...participants[0]!,
      id: randomUUID(),
      nickname: "Late learner",
      joinedAt: session.createdAt,
    };
    const openSecond: PresentationSessionRecord = {
      ...session,
      content: PresentationContentSchema.parse({
        ...session.content,
        blocks: [firstBlock, secondBlock],
      }),
      currentBlockIndex: 1,
      eventSeq: 8,
    };
    const timeline: PresentationSessionTimelineRecord[] = [
      {
        id: randomUUID(),
        workspaceId: session.workspaceId,
        sessionId: session.id,
        sequence: 5,
        type: "question.revealed",
        blockIndex: 0,
        blockId: firstBlock.id,
        occurredAt: NOW,
        revealedParticipantIds: participants.map((participant) => participant.id),
      },
    ];
    const responses = [
      { ...currentResponse, score: 200 },
      {
        ...currentResponse,
        id: randomUUID(),
        participantId: participants[1]!.id,
        blockId: secondBlock.id,
        questionId: secondBlock.question.id,
        response: { choiceIds: [secondBlock.question.choices[0]!.id] },
      },
      {
        ...currentResponse,
        id: randomUUID(),
        participantId: lateParticipant.id,
        blockId: secondBlock.id,
        questionId: secondBlock.question.id,
        response: { choiceIds: [secondBlock.question.choices[0]!.id] },
        score: 600,
      },
    ];
    return {
      openSecond,
      participants: [...participants, lateParticipant],
      responses,
      timeline,
      priorParticipants: participants,
      lateParticipant,
    };
  }

  it("recognizes a participant climbing from a published zero-score rank after skipping Q1", () => {
    const { openSecond, participants, responses, timeline, priorParticipants, lateParticipant } =
      rankHistoryFixture();
    const firstReveal = { ...openSecond, currentBlockIndex: 0, phase: "question_reveal" as const };
    const firstData = buildPresentationProjectionData(
      firstReveal,
      priorParticipants,
      responses,
      timeline,
    );
    expect(
      buildPresentationHostSnapshot(firstReveal, firstData).competitionStandings?.entries.find(
        (entry) => entry.id === priorParticipants[1]!.id,
      ),
    ).toMatchObject({ rank: 2, score: 0, previousRank: null });

    const openData = buildPresentationProjectionData(openSecond, participants, responses, timeline);
    const openStandings = buildPresentationHostSnapshot(openSecond, openData).competitionStandings!;
    expect(
      openStandings.entries.find((entry) => entry.id === priorParticipants[1]!.id),
    ).toMatchObject({ score: 0, lastScoreDelta: 0, previousRank: null, correctStreak: 0 });
    const revealed = { ...openSecond, phase: "question_reveal" as const };
    const data = buildPresentationProjectionData(revealed, participants, responses, timeline);
    const standings = buildPresentationHostSnapshot(revealed, data).competitionStandings!;
    expect(standings.entries.find((entry) => entry.id === priorParticipants[1]!.id)).toMatchObject({
      rank: 1,
      previousRank: 2,
      score: 1000,
      lastScoreDelta: 1000,
      correctStreak: 1,
    });
    // The late admission sorts before prior zero-score participants by joinedAt, but cannot
    // displace their historical ranks or acquire a historical rank of its own.
    expect(standings.entries.find((entry) => entry.id === lateParticipant.id)).toMatchObject({
      rank: 2,
      previousRank: null,
    });
    expect(standings.entries.find((entry) => entry.id === priorParticipants[2]!.id)).toMatchObject({
      rank: 4,
      previousRank: 3,
    });
  });

  it.each(["missing", "legacy", "future"] as const)(
    "does not invent previous ranks from %s reveal roster history",
    (history) => {
      const { openSecond, participants, responses, timeline } = rankHistoryFixture();
      const revealed = { ...openSecond, phase: "question_reveal" as const };
      const unavailableTimeline =
        history === "missing"
          ? []
          : timeline.map((event) => ({
              ...event,
              ...(history === "legacy"
                ? { revealedParticipantIds: null }
                : { sequence: revealed.eventSeq + 1 }),
            }));
      const data = buildPresentationProjectionData(
        revealed,
        participants,
        responses,
        unavailableTimeline,
      );
      expect(
        buildPresentationHostSnapshot(revealed, data).competitionStandings?.entries.map(
          (entry) => entry.previousRank,
        ),
      ).toEqual([null, null, null, null]);
    },
  );

  it("never releases an open response through staff standings or expands audience identity access", () => {
    const { session, participants, currentResponse, ids } = fixture();
    const data = buildPresentationProjectionData(session, participants, [currentResponse]);
    expect(buildPresentationHostSnapshot(session, data).competitionStandings).toMatchObject({
      status: "waiting",
      entries: [],
      totalParticipants: 3,
      completedScoredQuestions: 0,
    });
    expect(
      buildPresentationParticipantSnapshot(session, ids.participantId, data),
    ).not.toHaveProperty("competitionStandings");
    const revealed = { ...session, phase: "question_reveal" as const };
    const revealedData = buildPresentationProjectionData(revealed, participants, [currentResponse]);
    expect(
      buildPresentationParticipantSnapshot(revealed, ids.participantId, revealedData),
    ).not.toHaveProperty("competitionStandings");
  });

  it("retains final top-three scores, gaps and explicit points ties for the facilitator", () => {
    const { session, participants, currentResponse } = fixture();
    const finished = { ...session, phase: "finished" as const, status: "finished" as const };
    const secondResponse = {
      ...currentResponse,
      id: randomUUID(),
      participantId: participants[1]!.id,
    };
    const data = buildPresentationProjectionData(finished, participants, [
      currentResponse,
      secondResponse,
    ]);
    const standings = buildPresentationHostSnapshot(finished, data).competitionStandings!;
    expect(standings).toMatchObject({
      status: "final",
      completedScoredQuestions: 1,
      totalScoredQuestions: 1,
      tieBreak: "score_join_order",
    });
    expect(
      standings.entries.map(({ rank, score, tied, pointsToLeader, pointsToNextRank }) => ({
        rank,
        score,
        tied,
        pointsToLeader,
        pointsToNextRank,
      })),
    ).toEqual([
      { rank: 1, score: 1000, tied: true, pointsToLeader: 0, pointsToNextRank: null },
      { rank: 2, score: 1000, tied: true, pointsToLeader: 0, pointsToNextRank: 0 },
      { rank: 3, score: 0, tied: false, pointsToLeader: 1000, pointsToNextRank: 1000 },
    ]);
  });

  it("does not crown winners in an opinion-only Presentation", () => {
    const { session, participants } = fixture();
    const questionBlock = session.content.blocks[0]!;
    if (questionBlock.kind !== "question" || !("choices" in questionBlock.question))
      throw new Error("Question fixture expected");
    const content = PresentationContentSchema.parse({
      ...session.content,
      blocks: [
        {
          ...questionBlock,
          question: {
            ...questionBlock.question,
            type: "poll",
            purpose: "opinion",
            confidence: "off",
            basePoints: 0,
            choices: questionBlock.question.choices.map((choice) => ({
              ...choice,
              isCorrect: false,
            })),
          },
        },
      ],
    });
    const finished = {
      ...session,
      content,
      phase: "finished" as const,
      status: "finished" as const,
    };
    const data = buildPresentationProjectionData(finished, participants, []);
    expect(buildPresentationHostSnapshot(finished, data).competitionStandings).toMatchObject({
      status: "unscored",
      entries: [],
      totalScoredQuestions: 0,
    });
  });
});

it("keeps Presentation recognition on revealed checkpoints and breaks missed-question streaks", () => {
  const { session, participants, currentResponse } = fixture();
  const firstBlock = session.content.blocks[0]!;
  if (firstBlock.kind !== "question" || !("choices" in firstBlock.question))
    throw new Error("Expected scored choice question");
  const secondBlock = {
    ...firstBlock,
    id: randomUUID(),
    question: {
      ...firstBlock.question,
      id: randomUUID(),
      choices: firstBlock.question.choices.map((choice) => ({ ...choice, id: randomUUID() })),
    },
  };
  const content = PresentationContentSchema.parse({
    ...session.content,
    blocks: [firstBlock, secondBlock],
  });
  const firstResponses = [
    currentResponse,
    { ...currentResponse, id: randomUUID(), participantId: participants[1]!.id },
  ];
  const pending = {
    ...currentResponse,
    id: randomUUID(),
    blockId: secondBlock.id,
    questionId: secondBlock.question.id,
    response: { ...currentResponse.response, choiceIds: [secondBlock.question.choices[0]!.id] },
  };
  const openSecond = { ...session, content, currentBlockIndex: 1, phase: "question_open" as const };
  const responses = [...firstResponses, pending];
  const openData = buildPresentationProjectionData(openSecond, participants, responses);
  const openStandings = buildPresentationHostSnapshot(openSecond, openData).competitionStandings!;
  expect(
    openStandings.entries.slice(0, 2).map(({ score, lastScoreDelta, correctStreak }) => ({
      score,
      lastScoreDelta,
      correctStreak,
    })),
  ).toEqual([
    { score: 1000, lastScoreDelta: 1000, correctStreak: 1 },
    { score: 1000, lastScoreDelta: 1000, correctStreak: 1 },
  ]);
  const revealed = { ...openSecond, phase: "question_reveal" as const };
  const revealedData = buildPresentationProjectionData(revealed, participants, responses);
  const standings = buildPresentationHostSnapshot(revealed, revealedData).competitionStandings!;
  expect(
    standings.entries.find((entry) => entry.id === currentResponse.participantId),
  ).toMatchObject({ score: 2000, lastScoreDelta: 1000, correctStreak: 2 });
  expect(standings.entries.find((entry) => entry.id === participants[1]!.id)).toMatchObject({
    score: 1000,
    lastScoreDelta: 0,
    correctStreak: 0,
  });
});

it("keeps v12 standings on actual closed visit order across backward jumps and skipped questions", () => {
  const { session, participants, currentResponse } = fixture();
  const original = session.content.blocks[0]!;
  if (original.kind !== "question" || !("choices" in original.question))
    throw new Error("Expected scored question");
  const originalQuestion = original.question;
  const question = () => ({
    ...original,
    id: randomUUID().toUpperCase(),
    question: {
      ...originalQuestion,
      id: randomUUID(),
      choices: originalQuestion.choices.map((choice) => ({ ...choice, id: randomUUID() })),
    },
  });
  const skipped = question();
  const firstVisited = question();
  const lastVisited = question();
  const content = PresentationContentSchema.parse({
    ...session.content,
    schemaVersion: 12,
    blocks: [skipped, lastVisited, firstVisited],
  });
  const progress = (blockId: string) => ({
    blockId,
    phase: "question_reveal" as const,
    questionOpenedAt: session.questionOpenedAt!.toISOString(),
    questionClosesAt: session.questionClosesAt!.toISOString(),
  });
  const closed = {
    ...session,
    content,
    phase: "question_reveal" as const,
    currentBlockIndex: 2,
    eventSeq: 20,
    navigationState: { returnBlockId: null, blocks: [progress(firstVisited.id)] },
  };
  const response = {
    ...currentResponse,
    blockId: firstVisited.id.toLowerCase(),
    questionId: firstVisited.question.id,
    score: 600,
  };
  const timeline: PresentationSessionTimelineRecord[] = [
    {
      id: randomUUID(),
      workspaceId: session.workspaceId,
      sessionId: session.id,
      sequence: 10,
      type: "question.revealed",
      blockIndex: 2,
      blockId: firstVisited.id.toLowerCase(),
      occurredAt: NOW,
      revealedParticipantIds: participants.map((participant) => participant.id),
    },
  ];
  const first = buildPresentationHostSnapshot(
    closed,
    buildPresentationProjectionData(closed, participants, [response], timeline),
  );
  expect(first.competitionStandings).toMatchObject({
    completedScoredQuestions: 1,
    totalScoredQuestions: 3,
  });
  expect(first.competitionStandings!.entries[0]).toMatchObject({
    score: 600,
    lastScoreDelta: 600,
    correctStreak: 1,
  });
  // Jump backward to an unvisited question: the earlier closed answer stays published.
  const open = {
    ...closed,
    phase: "question_open" as const,
    currentBlockIndex: 1,
    navigationState: {
      ...closed.navigationState,
      blocks: [
        ...closed.navigationState.blocks,
        { ...progress(lastVisited.id), phase: "question_open" as const },
      ],
    },
  };
  const hiddenResponse = {
    ...currentResponse,
    id: randomUUID(),
    blockId: lastVisited.id.toLowerCase(),
    questionId: lastVisited.question.id,
    score: 1000,
  };
  const openSnapshot = buildPresentationHostSnapshot(
    open,
    buildPresentationProjectionData(open, participants, [response, hiddenResponse], timeline),
  );
  expect(openSnapshot.competitionStandings).toMatchObject({ completedScoredQuestions: 1 });
  expect(openSnapshot.competitionStandings!.entries[0]).toMatchObject({
    score: 600,
    lastScoreDelta: 600,
  });
  expect(openSnapshot.participants[0]!.score).toBe(600);
  const revealed = {
    ...open,
    phase: "question_reveal" as const,
    navigationState: {
      ...open.navigationState,
      blocks: [progress(firstVisited.id), progress(lastVisited.id)],
    },
  };
  const last = buildPresentationHostSnapshot(
    revealed,
    buildPresentationProjectionData(revealed, participants, [response, hiddenResponse], timeline),
  );
  expect(last.competitionStandings).toMatchObject({ completedScoredQuestions: 2 });
  expect(last.competitionStandings!.entries[0]).toMatchObject({
    score: 1600,
    lastScoreDelta: 1000,
    previousRank: 1,
    correctStreak: 2,
  });
  const revisit = { ...revealed, currentBlockIndex: 2 };
  const revisited = buildPresentationHostSnapshot(
    revisit,
    buildPresentationProjectionData(revisit, participants, [response, hiddenResponse], timeline),
  );
  expect(revisited.competitionStandings).toEqual(last.competitionStandings);
});
