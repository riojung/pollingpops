import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationCommandSchema,
  PresentationCompanionCommandSchema,
  PresentationCompanionPassResponseSchema,
  PresentationControlCommandSchema,
  PresentationCompanionSnapshotSchema,
  PresentationHostSnapshotSchema,
  PresentationParticipantCurrentBlockSchema,
  PresentationParticipantSnapshotSchema,
  PresentationRestV1CreateSessionResponseSchema,
  PresentationRestV1HostSnapshotSchema,
  PresentationRestV1JoinSessionResponseSchema,
  PresentationRestV1ParticipantSnapshotSchema,
  PresentationRestV1ResponseAckSchema,
  PresentationResponseAckSchema,
  PresentationRestResponseSubmitSchema,
  PresentationResponseSubmitSchema,
  PresentationRoomStatusSchema,
  PresentationSyncRequestSchema,
  PresentationSyncResponseSchema,
  SessionSettingsSchema,
  SubmitPresentationSessionResponseSchema,
  TrustModeSchema,
} from "../src/index";

const NOW = "2026-09-23T12:00:00.000Z";

function roomStatus(sessionId: string) {
  return {
    sessionId,
    joinedCount: 2,
    connectedCount: 1,
    notCurrentlyConnectedCount: 1,
    responseCount: 1,
    sampledAt: NOW,
  };
}

function snapshotBase() {
  const sessionId = randomUUID();
  return {
    sessionId,
    artifactType: "presentation" as const,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: "Live recovery check",
    code: "1234567",
    status: "active" as const,
    phase: "question_open" as const,
    currentBlockIndex: 0,
    blockCount: 1,
    revision: 3,
    seq: 7,
    serverTime: NOW,
    questionOpenedAt: NOW,
    questionClosesAt: "2026-09-23T12:00:30.000Z",
    acceptingResponses: true,
    settings: { timeMode: "timed" as const },
  };
}

describe("Presentation realtime contracts", () => {
  it.each(["content", "finished"] as const)(
    "already supports content-only %s snapshots without question results or audience standings",
    (phase) => {
      const source = snapshotBase();
      const base = {
        ...source,
        title: "Project update",
        status: phase === "finished" ? "finished" : "active",
        phase,
        questionOpenedAt: null,
        questionClosesAt: null,
        acceptingResponses: false,
        currentBlock: {
          id: randomUUID(),
          kind: "content",
          layout: "title",
          textElements: [
            { id: "heading", role: "title", text: "Next steps", region: "middle_center", order: 0 },
          ],
          mediaId: null,
          mediaAlt: null,
        },
        finishedAt: phase === "finished" ? NOW : null,
      };
      const room = { ...roomStatus(source.sessionId), responseCount: 0 };
      const host = PresentationHostSnapshotSchema.parse({
        ...base,
        projection: "host",
        participantCount: 2,
        responseCount: 0,
        // Retain the existing staff roster wire shape; it does not imply an assessed session.
        participants: [
          { id: randomUUID(), nickname: "Robin", joinedAt: NOW, score: 0, rank: 1 },
          { id: randomUUID(), nickname: "Sage", joinedAt: NOW, score: 0, rank: 2 },
        ],
        roomStatus: room,
      });
      expect(host.currentBlock?.kind).toBe("content");
      expect(
        PresentationRestV1HostSnapshotSchema.parse({
          ...host,
          id: host.sessionId,
          eventSeq: host.seq,
          trustMode: host.settings.trustMode,
          leaderboard: host.participants,
          createdAt: NOW,
          updatedAt: NOW,
        }).currentBlock?.kind,
      ).toBe("content");
      const participant = PresentationParticipantSnapshotSchema.parse({
        ...base,
        projection: "participant",
        participantId: randomUUID(),
        participantCount: 2,
        responseSubmitted: false,
        standing: null,
        responseResult: null,
      });
      expect(participant).toMatchObject({ standing: null, responseResult: null });
      expect(
        PresentationRestV1ParticipantSnapshotSchema.parse({
          ...participant,
          id: participant.sessionId,
          eventSeq: participant.seq,
          trustMode: participant.settings.trustMode,
        }).currentBlock?.kind,
      ).toBe("content");
      expect(
        PresentationCompanionSnapshotSchema.parse({
          ...base,
          projection: "companion",
          roomStatus: room,
          primaryAction: phase === "finished" ? "none" : "advance",
          resultSummary: null,
        }),
      ).toMatchObject({ resultSummary: null, acceptingResponses: false });
    },
  );

  it("keeps companion live commands strict and separately credentialed", () => {
    const command = {
      sessionId: randomUUID(),
      companionToken: "c".repeat(32),
      commandId: randomUUID(),
      expectedRevision: 2,
      action: "advance",
    };
    expect(PresentationCompanionCommandSchema.parse(command)).toEqual(command);
    expect(PresentationControlCommandSchema.parse(command)).toEqual(command);
    expect(PresentationCommandSchema.safeParse(command).success).toBe(false);
    for (const extra of [
      { controlToken: "h".repeat(32) },
      { action: "start_recovery_card", recoveryPackCard: { cardId: randomUUID() } },
      { action: "kick", participantId: randomUUID() },
      { settings: { timeMode: "flex" } },
    ]) {
      expect(PresentationControlCommandSchema.safeParse({ ...command, ...extra }).success).toBe(
        false,
      );
    }
    expect(
      PresentationCompanionPassResponseSchema.parse({
        credentialId: randomUUID(),
        companionToken: command.companionToken,
        expiresAt: NOW,
      }).companionToken,
    ).toBe(command.companionToken);
    expect(
      PresentationCompanionPassResponseSchema.safeParse({
        credentialId: randomUUID(),
        companionToken: command.companionToken,
        expiresAt: NOW,
        controlToken: "h".repeat(32),
      }).success,
    ).toBe(false);
  });

  it("only accepts current-block aggregate companion results after reveal", () => {
    const base = snapshotBase();
    const choiceId = randomUUID();
    const blockId = randomUUID();
    const snapshot = {
      ...base,
      projection: "companion",
      currentBlock: {
        id: blockId,
        kind: "question",
        question: {
          id: randomUUID(),
          type: "single_select",
          prompt: "Synthetic choice",
          confidence: "off",
          choices: [{ id: choiceId, label: "Option" }],
          timeLimitSeconds: 30,
          basePoints: 100,
          mediaId: null,
          mediaAlt: null,
        },
      },
      roomStatus: roomStatus(base.sessionId),
      primaryAction: "advance",
      finishedAt: null,
      resultSummary: { blockId, responseCount: 1, choiceCounts: [{ choiceId, count: 1 }] },
    };
    expect(PresentationCompanionSnapshotSchema.safeParse(snapshot).success).toBe(false);
    const revealed = { ...snapshot, phase: "question_reveal", acceptingResponses: false };
    expect(PresentationCompanionSnapshotSchema.parse(revealed).resultSummary).toEqual(
      snapshot.resultSummary,
    );
    for (const extra of [
      { blockId: randomUUID() },
      { choiceCounts: [{ choiceId: randomUUID(), count: 1 }] },
      { choiceCounts: [{ choiceId, count: 2 }] },
      {
        choiceCounts: [
          { choiceId, count: 1 },
          { choiceId, count: 0 },
        ],
      },
      { correctCount: 1 },
      { participantResponses: [{ participantId: randomUUID(), choiceIds: [choiceId] }] },
    ]) {
      expect(
        PresentationCompanionSnapshotSchema.safeParse({
          ...revealed,
          resultSummary: { ...snapshot.resultSummary, ...extra },
        }).success,
      ).toBe(false);
    }
    expect(
      PresentationCompanionSnapshotSchema.safeParse({ ...revealed, acceptingResponses: true })
        .success,
    ).toBe(false);
    expect(
      PresentationCompanionSnapshotSchema.safeParse({ ...revealed, participants: [] }).success,
    ).toBe(false);
  });

  it("defaults accountless session settings to Learning mode", () => {
    expect(TrustModeSchema.options).toEqual(["learning", "verified"]);
    expect(
      SessionSettingsSchema.parse({
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      }),
    ).toMatchObject({ trustMode: "learning", resultVisibility: "private" });
  });

  it("validates strict, role-specific snapshots and resolves their settings defaults", () => {
    const hostBase = snapshotBase();
    const host = PresentationHostSnapshotSchema.parse({
      ...hostBase,
      projection: "host",
      currentBlock: null,
      participantCount: 2,
      responseCount: 1,
      participants: [
        { id: randomUUID(), nickname: "Robin", joinedAt: NOW, score: 500, rank: 1 },
        { id: randomUUID(), nickname: "Sage", joinedAt: NOW, score: 0, rank: 2 },
      ],
      roomStatus: roomStatus(hostBase.sessionId),
      finishedAt: null,
    });
    expect(host.settings).toEqual({ timeMode: "timed", trustMode: "learning" });
    const restHost = PresentationRestV1HostSnapshotSchema.parse({
      ...host,
      id: host.sessionId,
      eventSeq: host.seq,
      trustMode: host.settings.trustMode,
      leaderboard: host.participants,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(restHost).toMatchObject({ id: host.sessionId, trustMode: "learning" });
    expect(
      PresentationRestV1CreateSessionResponseSchema.safeParse({
        snapshot: restHost,
        controlToken: "h".repeat(32),
        controlCredentialId: randomUUID(),
        unexpected: true,
      }).success,
    ).toBe(false);

    const participantBase = snapshotBase();
    const participant = PresentationParticipantSnapshotSchema.parse({
      ...participantBase,
      projection: "participant",
      participantId: randomUUID(),
      currentBlock: null,
      participantCount: 2,
      responseSubmitted: false,
      standing: null,
      responseResult: null,
      finishedAt: null,
    });
    expect(participant.projection).toBe("participant");
    const restParticipant = PresentationRestV1ParticipantSnapshotSchema.parse({
      ...participant,
      id: participant.sessionId,
      eventSeq: participant.seq,
      trustMode: participant.settings.trustMode,
    });
    expect(restParticipant).toMatchObject({
      id: participant.sessionId,
      eventSeq: participant.seq,
    });
    expect(
      PresentationRestV1JoinSessionResponseSchema.parse({
        participantToken: "p".repeat(32),
        snapshot: restParticipant,
      }).snapshot,
    ).toEqual(restParticipant);

    const companionBase = snapshotBase();
    expect(
      PresentationCompanionSnapshotSchema.parse({
        ...companionBase,
        projection: "companion",
        currentBlock: null,
        roomStatus: roomStatus(companionBase.sessionId),
        primaryAction: "advance",
        finishedAt: null,
      }).projection,
    ).toBe("companion");
  });

  it("strips answer material from participant question blocks and rejects authoring fields", () => {
    const parsed = PresentationParticipantCurrentBlockSchema.parse({
      id: randomUUID(),
      kind: "question",
      question: {
        id: randomUUID(),
        type: "single_select",
        prompt: "Which choice is supported?",
        confidence: "off",
        choices: [
          { id: randomUUID(), label: "A", isCorrect: true },
          { id: randomUUID(), label: "B", isCorrect: false },
        ],
        timeLimitSeconds: 30,
        basePoints: 1_000,
        mediaId: null,
        mediaAlt: null,
      },
    });
    expect(JSON.stringify(parsed)).not.toContain("isCorrect");

    expect(
      PresentationParticipantCurrentBlockSchema.safeParse({
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        textElements: [
          {
            id: randomUUID(),
            role: "title",
            text: "Visible",
            region: "top_center",
            order: 0,
          },
          {
            id: randomUUID(),
            role: "body",
            text: "Visible",
            region: "middle_center",
            order: 0,
          },
        ],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "Host only",
      }).success,
    ).toBe(false);
  });

  it("permits answer material for hosts only after the reveal fence", () => {
    const base = snapshotBase();
    const choiceId = randomUUID();
    const currentBlock = {
      id: randomUUID(),
      kind: "question" as const,
      question: {
        id: randomUUID(),
        type: "single_select" as const,
        prompt: "Which choice is supported?",
        confidence: "off" as const,
        choices: [{ id: choiceId, label: "A" }],
        timeLimitSeconds: 30,
        basePoints: 1_000,
        mediaId: null,
        mediaAlt: null,
        purpose: "diagnostic" as const,
        linkedRecheckAvailable: false,
      },
      revealedAnswer: {
        kind: "choice" as const,
        correctChoiceIds: [choiceId],
        explanation: "A is supported by the evidence.",
      },
    };
    const snapshot = {
      ...base,
      projection: "host" as const,
      currentBlock,
      participantCount: 0,
      responseCount: 0,
      participants: [],
      roomStatus: {
        ...roomStatus(base.sessionId),
        joinedCount: 0,
        connectedCount: 0,
        notCurrentlyConnectedCount: 0,
        responseCount: 0,
      },
      finishedAt: null,
    };

    expect(PresentationHostSnapshotSchema.safeParse(snapshot).success).toBe(false);
    expect(
      PresentationHostSnapshotSchema.parse({
        ...snapshot,
        phase: "question_reveal",
        acceptingResponses: false,
      }).currentBlock,
    ).toMatchObject({ revealedAnswer: { correctChoiceIds: [choiceId] } });
  });

  it("requires block, revision, and idempotency fences on REST and realtime submissions", () => {
    const sessionId = randomUUID();
    const blockId = randomUUID();
    const participantToken = "p".repeat(32);
    const payload = {
      participantToken,
      blockId,
      expectedRevision: 3,
      idempotencyKey: randomUUID(),
      response: { choiceIds: [randomUUID()] },
    };

    expect(SubmitPresentationSessionResponseSchema.safeParse(payload).success).toBe(true);
    expect(
      SubmitPresentationSessionResponseSchema.safeParse({
        participantToken,
        response: payload.response,
      }).success,
    ).toBe(false);
    expect(
      PresentationRestResponseSubmitSchema.safeParse({
        participantToken,
        response: payload.response,
      }).success,
    ).toBe(true);
    expect(PresentationResponseSubmitSchema.parse({ sessionId, ...payload })).toMatchObject({
      sessionId,
      blockId,
      expectedRevision: 3,
    });
  });

  it("validates command, sync, event, room status, and acknowledgement envelopes", () => {
    const host = snapshotBase();
    const snapshot = PresentationHostSnapshotSchema.parse({
      ...host,
      projection: "host",
      currentBlock: null,
      participantCount: 2,
      responseCount: 1,
      participants: [],
      roomStatus: roomStatus(host.sessionId),
      finishedAt: null,
    });
    const command = PresentationCommandSchema.parse({
      sessionId: host.sessionId,
      controlToken: "h".repeat(32),
      commandId: randomUUID(),
      expectedRevision: host.revision,
      action: "advance",
    });
    expect(command.action).toBe("advance");
    expect(
      PresentationSyncRequestSchema.parse({
        sessionId: host.sessionId,
        projection: "host",
        controlToken: "h".repeat(32),
      }).afterSeq,
    ).toBe(0);
    expect(
      PresentationSyncResponseSchema.parse({
        resetRequired: false,
        events: [
          {
            eventId: randomUUID(),
            sessionId: host.sessionId,
            revision: host.revision,
            seq: host.seq,
            type: "presentation.session.updated",
            serverTime: NOW,
            payload: snapshot,
          },
        ],
        snapshot,
      }).events,
    ).toHaveLength(1);

    expect(
      PresentationRoomStatusSchema.safeParse({
        ...roomStatus(host.sessionId),
        connectedCount: 2,
      }).success,
    ).toBe(false);

    const participantBase = snapshotBase();
    const participantSnapshot = PresentationParticipantSnapshotSchema.parse({
      ...participantBase,
      projection: "participant",
      participantId: randomUUID(),
      currentBlock: null,
      participantCount: 2,
      responseSubmitted: true,
      standing: null,
      responseResult: null,
      finishedAt: null,
    });
    const responseId = randomUUID();
    const blockId = randomUUID();
    const idempotencyKey = randomUUID();
    const acknowledgement = {
      sessionId: participantBase.sessionId,
      blockId,
      idempotencyKey,
      accepted: true,
      duplicate: false,
      responseId,
      acceptedAt: NOW,
      snapshot: {
        ...participantSnapshot,
        responseReceipt: { responseId, blockId, idempotencyKey, acceptedAt: NOW },
      },
    };
    expect(PresentationResponseAckSchema.parse(acknowledgement).accepted).toBe(true);
    expect(
      PresentationRestV1ResponseAckSchema.parse({
        ...acknowledgement,
        snapshot: {
          ...acknowledgement.snapshot,
          id: acknowledgement.sessionId,
          eventSeq: acknowledgement.snapshot.seq,
          trustMode: acknowledgement.snapshot.settings.trustMode,
        },
        revision: acknowledgement.snapshot.revision,
        submittedAt: acknowledgement.acceptedAt,
      }).accepted,
    ).toBe(true);
    expect(
      PresentationResponseAckSchema.safeParse({
        ...acknowledgement,
        sessionId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      PresentationResponseAckSchema.safeParse({
        ...acknowledgement,
        blockId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      PresentationResponseAckSchema.safeParse({
        ...acknowledgement,
        idempotencyKey: randomUUID(),
      }).success,
    ).toBe(false);
  });
});
